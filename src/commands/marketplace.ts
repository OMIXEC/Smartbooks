import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Command } from 'commander'
import { candleHome, findItemBySource, getItem, removeItem, saveItem } from '../store.js'
import { ingestFile } from '../ingest/index.js'
import type { Listing } from '../types.js'
import { exists, nowIso, printError, readJson, writeJson } from '../util.js'
import { addCommon, emit, loadCatalog, optsOf, wantJson } from './common.js'

interface Subscription {
  listingId: string
  itemId: string
  subscribedAt: string
}

export function registerMarketplace(program: Command): void {
  const market = program.command('marketplace').description('Browse and subscribe to local catalog books')

  addCommon(
    market
      .command('browse')
      .description('Browse marketplace listings (no account required)')
      .option('--limit <n>', 'Maximum results', '20')
      .option('--sort <sort>', 'newest, popular, az', 'newest')
      .option('--tag <tag>', 'Filter by tag slug')
      .option('--compact', 'Two plain lines per listing')
      .action(async cmd => {
        const { listings } = await loadCatalog()
        let rows = [...listings]
        if (optsOf(cmd).tag) rows = rows.filter(l => l.tags.some(t => t.slug === optsOf(cmd).tag))
        const sort = String(optsOf(cmd).sort)
        rows.sort((a, b) => {
          if (sort === 'popular') return b.subscriberCount - a.subscriberCount
          if (sort === 'az') return a.item.title.localeCompare(b.item.title)
          return a.createdAt < b.createdAt ? 1 : -1
        })
        const limit = Math.max(1, Number(optsOf(cmd).limit) || 20)
        rows = rows.slice(0, limit)
        const human = rows
          .map(l =>
            optsOf(cmd).compact
              ? `${l.id}  ${l.item.title} — ${l.item.author ?? 'Unknown'} (${l.item.pageCount} pages, ${l.proOnly ? 'Professional' : 'Free'})\n  ${l.item.description}`
              : `${l.id}  ${l.item.title} — ${l.item.author ?? 'Unknown'} (${l.item.pageCount} pages, ${l.proOnly ? 'Professional' : 'Free'})`,
          )
          .join('\n')
        emit(cmd, human || 'No listings.', {
          listings: rows,
          total: rows.length,
          page: 1,
          totalPages: 1,
        })
      }),
  )

  addCommon(
    market
      .command('subscribe <listingId>')
      .description('Subscribe to a local catalog listing')
      .option('--domain <domain>', 'Record the resulting hit under this ledger domain')
      .action(async (listingId: string, cmd: Command) => {
        const { listings, baseDir } = await loadCatalog()
        const listing = listings.find(l => l.id === listingId || l.slug === listingId)
        if (!listing) return notFound(cmd, listingId)
        const file = await resolveListingFile(listing, baseDir)
        if (!file) return printError('LISTING_FILE_MISSING', `Listing ${listingId} points at a missing file: ${listing.file}`)
        const existing = await findItemBySource(file)
        if (existing) {
          await recordSubscription(listing.id, existing.id)
          emit(cmd, `Already in your library: ${existing.title} (${existing.id})`, {
            code: 'CONFLICT',
            itemId: existing.id,
            title: existing.title,
          })
          return
        }
        const item = await ingestFile(file, {
          title: listing.item.title,
          author: listing.item.author,
          description: listing.item.description,
          kind: 'book',
        })
        await saveItem(item)
        await recordSubscription(listing.id, item.id)
        emit(cmd, `Added "${item.title}" to your library (${item.id})`, {
          code: 'SUBSCRIBED',
          itemId: item.id,
          title: item.title,
          pageCount: item.pageCount,
        })
      }),
  )

  addCommon(
    market
      .command('unsubscribe <listingId>')
      .description('Unsubscribe from a listing and remove its book')
      .action(async (listingId: string, cmd: Command) => {
        const subs = await readSubscriptions()
        const sub = subs.find(s => s.listingId === listingId)
        if (!sub) return notFound(cmd, listingId)
        const removed = await removeItem(sub.itemId)
        await writeSubscriptions(subs.filter(s => s.listingId !== listingId))
        emit(cmd, removed ? `Removed ${sub.itemId}.` : `Listing ${listingId} was not in the library.`, {
          removed: removed ? sub.itemId : null,
        })
      }),
  )

  addCommon(
    market
      .command('publish <id>')
      .description('Check whether a local book is ready to publish')
      .option('--submit', 'Mark the listing as submitted (local only)')
      .action(async (id: string, cmd: Command) => {
        const item = await getItem(id)
        if (!item) return notFound(cmd, id)
        const checks = [
          check('title', Boolean(item.title && item.title.length <= 120), 'Title is present and under 120 characters.'),
          check('description', item.description.length >= 40, 'Description is at least 40 characters.'),
          check('page1_scope', /scope|use when|purpose/i.test(item.pages[0]?.text ?? ''), 'Page 1 names the scope.'),
          check('pages', item.pageCount > 0, 'The book has at least one page.'),
        ]
        const ok = checks.every(c => c.ok)
        emit(
          cmd,
          checks.map(c => `${c.ok ? '✓' : '✗'} ${c.name}: ${c.message}`).join('\n') + (ok ? '\nReady to publish locally.' : ''),
          { id, title: item.title, checks, ready: ok, submitted: Boolean(optsOf(cmd).submit) },
        )
        if (!ok) process.exitCode = 1
      }),
  )

  addCommon(
    market
      .command('status <id>')
      .description('Show local listing status')
      .action(async (id: string, cmd: Command) => {
        const subs = await readSubscriptions()
        const sub = subs.find(s => s.listingId === id || s.itemId === id)
        const item = sub ? await getItem(sub.itemId) : await getItem(id)
        emit(cmd, sub ? `Subscribed: ${item?.title ?? sub.itemId}` : `Not subscribed: ${id}`, {
          listingId: id,
          subscription: sub ?? null,
          item: item ? { id: item.id, title: item.title, pageCount: item.pageCount } : null,
        })
      }),
  )
}

function check(name: string, ok: boolean, message: string) {
  return { name, ok, message }
}

async function resolveListingFile(listing: Listing, baseDir: string): Promise<string | null> {
  if (path.isAbsolute(listing.file)) return (await exists(listing.file)) ? listing.file : null
  for (const candidate of [path.resolve(baseDir, listing.file), path.resolve(baseDir, '..', listing.file)]) {
    if (await exists(candidate)) return candidate
  }
  return null
}

function subscriptionsPath(): string {
  return path.join(candleHome(), 'subscriptions.json')
}

async function readSubscriptions(): Promise<Subscription[]> {
  return readJson<Subscription[]>(subscriptionsPath(), [])
}

async function writeSubscriptions(subs: Subscription[]): Promise<void> {
  await fs.mkdir(candleHome(), { recursive: true })
  await writeJson(subscriptionsPath(), subs)
}

async function recordSubscription(listingId: string, itemId: string): Promise<void> {
  const subs = await readSubscriptions()
  if (!subs.some(s => s.listingId === listingId)) {
    subs.push({ listingId, itemId, subscribedAt: nowIso() })
    await writeSubscriptions(subs)
  }
}

function notFound(cmd: Command, id: string): void {
  if (wantJson(cmd)) {
    process.stdout.write(JSON.stringify({ code: 'NOT_FOUND', error: `Listing not found: ${id}`, hint: null, status: null, upgradeUrl: null }, null, 2) + '\n')
  } else {
    printError('NOT_FOUND', `Listing not found: ${id}`)
  }
  process.exitCode = 1
}
