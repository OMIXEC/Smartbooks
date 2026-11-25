import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Command } from 'commander'
import { ingestContent, ingestFile, sourceTypeOf } from '../ingest/index.js'
import {
  findItemBySource,
  getItem,
  listItems,
  removeItem,
  saveItem,
  updateItemMeta,
} from '../store.js'
import type { Item } from '../types.js'
import { normalizeText, nowIso, oneLine, printError } from '../util.js'
import {
  addCommon,
  emit,
  optsOf,
  pageSnippet,
  parseTargets,
  rangeFor,
  readPages,
  renderRead,
  wantJson,
} from './common.js'

export function registerItems(program: Command): void {
  const items = program.command('items').description('Item management commands')

  addCommon(
    items
      .command('list')
      .description('List all items in your library')
      .action(async cmd => {
        const all = await listItems()
        const withToc = await Promise.all(
          all.map(async i => ({ ...i, toc: (await getItem(i.id))?.toc ?? [] })),
        )
        emit(
          cmd,
          all.map(i => `${i.id}  ${i.title} (${i.pageCount} pages, ${i.sourceType}${i.kind === 'manuscript' ? ', manuscript' : ''})`).join('\n') || 'No items.',
          { items: withToc },
        )
      }),
  )

  addCommon(
    items
      .command('toc <id>')
      .description('Show table of contents for an item')
      .action(async (id: string, cmd: Command) => {
        const item = await getItem(id)
        if (!item) return notFound(cmd, id)
        emit(
          cmd,
          item.toc.map(t => `${'  '.repeat(Math.max(0, t.level - 1))}${t.title} (p. ${t.page})`).join('\n') ||
            'No table of contents.',
          { id: item.id, title: item.title, toc: item.toc },
        )
      }),
  )

  addCommon(
    items
      .command('read <ids...>')
      .description('Read content from items')
      .option('--pages <range>', 'Page range, e.g. 3-7')
      .option('--page <n>', 'Read one page')
      .option('--part <n>', 'Read one part of a large page')
      .action(async (ids: string[], cmd: Command) => {
        const targets = parseTargets(ids)
        const part = optsOf(cmd).part ? Number(optsOf(cmd).part) : null
        if (targets.length === 0) return printError('USAGE', 'Provide at least one item id.')
        const results: unknown[] = []
        const human: string[] = []
        for (const t of targets) {
          const item = await getItem(t.id)
          if (!item) {
            if (targets.length === 1) return notFound(cmd, t.id)
            human.push(`Items not found: ${t.id}`)
            continue
          }
          const pagesOpt = optsOf(cmd).pages ? String(optsOf(cmd).pages) : null
          const range = rangeFor(item, t.pages ?? pagesOpt, optsOf(cmd).page)
          const result = readPages(item, range, part)
          results.push({ id: item.id, title: item.title, version: item.updatedAt, pages: result.pages, next: result.next })
          human.push(renderRead(item, result))
        }
        emit(cmd, human.join('\n\n'), results.length === 1 ? results[0] : { items: results })
      }),
  )

  addCommon(
    items
      .command('get <id>')
      .description('Read a book or one page: same as `items read`')
      .option('--pages <range>', 'Page range, e.g. 3-7')
      .option('--page <n>', 'Read one page')
      .option('--part <n>', 'Read one part of a large page')
      .action(async (id: string, cmd: Command) => {
        const idx = id.lastIndexOf(':')
        const realId = idx > 0 ? id.slice(0, idx) : id
        const inline = idx > 0 ? id.slice(idx + 1) : null
        const item = await getItem(realId)
        if (!item) return notFound(cmd, realId)
        const part = optsOf(cmd).part ? Number(optsOf(cmd).part) : null
        const range = rangeFor(item, optsOf(cmd).pages ? String(optsOf(cmd).pages) : inline, optsOf(cmd).page)
        const result = readPages(item, range, part)
        emit(cmd, renderRead(item, result), {
          id: item.id,
          title: item.title,
          version: item.updatedAt,
          pages: result.pages,
          next: result.next,
        })
      }),
  )

  addCommon(
    items
      .command('add <file>')
      .description('Add a PDF, EPUB, Markdown, HTML or text file to your library')
      .option('--title <title>', 'Title override')
      .option('--author <author>', 'Author override')
      .option('--kind <kind>', 'book, doc or manuscript', 'book')
      .action(async (file: string, cmd: Command) => {
        const item = await ingestAndSave(file, optsOf(cmd))
        emit(cmd, `Added ${item.title} (${item.id}, ${item.pageCount} pages)`, { item })
      }),
  )

  addCommon(
    items
      .command('import <file>')
      .description('Import a Markdown file as a new book')
      .option('--title <title>', 'Title override')
      .option('--author <author>', 'Author override')
      .action(async (file: string, cmd: Command) => {
        const item = await ingestAndSave(file, { ...optsOf(cmd), kind: 'book' })
        emit(cmd, `Imported ${item.title} (${item.id}, ${item.pageCount} pages)`, { item })
      }),
  )

  addCommon(
    items
      .command('create <title>')
      .description('Create a new markdown document')
      .option('--file <file>', 'Read initial content from a file')
      .option('--content <text>', 'Initial content')
      .option('--kind <kind>', 'book, doc or manuscript', 'doc')
      .action(async (title: string, cmd: Command) => {
        const raw = await contentFrom(optsOf(cmd))
        const item = ingestContent(raw || `# ${title}\n`, title, 'markdown', {
          title,
          kind: optsOf(cmd).kind,
        })
        await saveItem(item)
        emit(cmd, `Created ${item.title} (${item.id}, ${item.pageCount} pages)`, { item })
      }),
  )

  addCommon(
    items
      .command('put <target>')
      .description('Replace document content, or one page with <id>:<page>')
      .option('--file <file>', 'Read content from a file')
      .option('--content <text>', 'Content')
      .option('--expect-version <version>', 'Refuse when the item changed since this version')
      .action(async (target: string, cmd: Command) => {
        const idx = target.lastIndexOf(':')
        const id = idx > 0 ? target.slice(0, idx) : target
        const page = idx > 0 ? Number(target.slice(idx + 1)) : null
        const item = await getItem(id)
        if (!item) return notFound(cmd, id)
        if (optsOf(cmd).expectVersion && optsOf(cmd).expectVersion !== item.updatedAt) {
          return printError('VERSION_CONFLICT', `Item ${id} changed; expected ${optsOf(cmd).expectVersion}, found ${item.updatedAt}.`)
        }
        const raw = await contentFrom(optsOf(cmd))
        if (page !== null) {
          if (!Number.isInteger(page) || page < 1) return printError('USAGE', 'Page must be a positive integer.')
          while (item.pages.length < page) item.pages.push({ n: item.pages.length + 1, label: `Page ${item.pages.length + 1}`, text: '' })
          const old = item.pages[page - 1]!
          const pageText = normalizeText(raw)
          const pageBytes = Buffer.byteLength(pageText)
          if (pageBytes > 20_000) {
            return printError('PAGE_TOO_LARGE', `Page ${page} is ${pageBytes} bytes; the limit is 20,000. Split it into pages, each starting with "# ".`)
          }
          item.pages[page - 1] = { ...old, text: pageText }
          item.pageCount = item.pages.length
          item.updatedAt = nowIso()
          await saveItem(item)
          emit(cmd, `Updated ${item.title} page ${page}`, { id: item.id, page, updatedAt: item.updatedAt })
          return
        }
        const replacement = ingestContent(raw, item.title, item.sourceType === 'html' ? 'html' : 'markdown', {
          title: item.title,
          author: item.author,
          kind: item.kind,
        })
        const tooBig = replacement.pages.find(p => Buffer.byteLength(p.text) > 20_000)
        if (tooBig) {
          return printError('PAGE_TOO_LARGE', `Page ${tooBig.n} is ${Buffer.byteLength(tooBig.text)} bytes; the limit is 20,000. Split it into pages, each starting with "# ".`)
        }
        item.pages = replacement.pages
        item.toc = replacement.toc
        item.pageCount = replacement.pages.length
        item.contentHash = replacement.contentHash
        item.updatedAt = nowIso()
        await saveItem(item)
        emit(cmd, `Replaced ${item.title} (${item.pageCount} pages)`, { item })
      }),
  )

  addCommon(
    items
      .command('append <id>')
      .description('Append content to a document without re-sending the whole body')
      .option('--file <file>', 'Read content from a file')
      .option('--content <text>', 'Content')
      .option('--prepend', 'Prepend instead of append')
      .action(async (id: string, cmd: Command) => {
        const item = await getItem(id)
        if (!item) return notFound(cmd, id)
        const raw = normalizeText(await contentFrom(optsOf(cmd)))
        if (!raw) return printError('USAGE', 'Provide --file or --content.')
        if (optsOf(cmd).prepend) {
          const first = item.pages[0]
          if (first) first.text = `${raw}\n\n${first.text}`
          else item.pages.push({ n: 1, label: 'Page 1', text: raw })
        } else {
          const last = item.pages.at(-1)
          if (last) last.text = `${last.text}\n\n${raw}`
          else item.pages.push({ n: 1, label: 'Page 1', text: raw })
        }
        const big = item.pages.find(p => Buffer.byteLength(p.text) > 20_000)
        if (big) {
          return printError('PAGE_TOO_LARGE', `Page ${big.n} would be ${Buffer.byteLength(big.text)} bytes; the limit is 20,000. Split it into pages, each starting with "# ".`)
        }
        item.pageCount = item.pages.length
        item.updatedAt = nowIso()
        await saveItem(item)
        emit(cmd, `Updated ${item.title} (${item.pageCount} pages)`, { id: item.id, pageCount: item.pageCount })
      }),
  )

  addCommon(
    items
      .command('remove <id>')
      .description('Remove an item from your library')
      .option('--yes', 'Skip confirmation prompt')
      .action(async (id: string, cmd: Command) => {
        const ok = await removeItem(id)
        if (!ok) return notFound(cmd, id)
        emit(cmd, `Removed ${id}.`, { removed: id })
      }),
  )

  addCommon(
    items
      .command('enrich <id>')
      .description('Enrich item metadata (title, author, description)')
      .option('--title <title>')
      .option('--author <author>')
      .option('--description <description>')
      .action(async (id: string, cmd: Command) => {
        const patch: Record<string, string> = {}
        for (const k of ['title', 'author', 'description'] as const) {
          if (optsOf(cmd)[k] !== undefined) patch[k] = oneLine(optsOf(cmd)[k])
        }
        const meta = await updateItemMeta(id, patch)
        if (!meta) return notFound(cmd, id)
        emit(cmd, `Updated ${meta.title}`, { item: meta })
      }),
  )

  addCommon(
    items
      .command('reprocess <id>')
      .description('Re-import a book from the file it was originally added from')
      .action(async (id: string, cmd: Command) => {
        const item = await getItem(id)
        if (!item) return notFound(cmd, id)
        if (!item.sourcePath) return printError('NO_SOURCE', `Item ${id} has no source file.`)
        const fresh = await ingestFile(item.sourcePath, { kind: item.kind, title: item.title })
        fresh.id = item.id
        fresh.addedAt = item.addedAt
        fresh.shelves = item.shelves
        await saveItem(fresh)
        emit(cmd, `Reprocessed ${fresh.title} (${fresh.pageCount} pages)`, { item: fresh })
      }),
  )

  addCommon(
    items
      .command('search <query>')
      .description('Search page text across the library')
      .option('--book <id>', 'Restrict to one item')
      .option('--limit <n>', 'Maximum results', '20')
      .action(async (query: string, cmd: Command) => {
        const limit = Number(optsOf(cmd).limit) || 20
        const all = optsOf(cmd).book ? [await getItem(optsOf(cmd).book)].filter(Boolean) as Item[] : await Promise.all((await listItems()).map(i => getItem(i.id)))
        const hits: { id: string; title: string; page: number; snippet: string }[] = []
        for (const item of all) {
          if (!item) continue
          for (const p of item.pages) {
            if (p.text.toLowerCase().includes(query.toLowerCase())) {
              hits.push({ id: item.id, title: item.title, page: p.n, snippet: pageSnippet(p.text, query) })
              if (hits.length >= limit) break
            }
          }
          if (hits.length >= limit) break
        }
        emit(
          cmd,
          hits.map(h => `${h.title} (${h.id}) p. ${h.page}: ${h.snippet}`).join('\n') || 'No matches.',
          { query, hits },
        )
      }),
  )

  addCommon(
    items
      .command('cite <target>')
      .description('Verify that a quote exists on a page')
      .option('--quote <quote>', 'Verbatim quote to verify')
      .action(async (target: string, cmd: Command) => {
        const idx = target.lastIndexOf(':')
        const id = idx > 0 ? target.slice(0, idx) : target
        const page = idx > 0 ? Number(target.slice(idx + 1)) : 1
        const item = await getItem(id)
        if (!item) return notFound(cmd, id)
        const p = item.pages[page - 1]
        const quote = oneLine(optsOf(cmd).quote ?? '')
        const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()
        const verified = Boolean(p && quote && norm(p.text).includes(norm(quote)))
        emit(cmd, verified ? `Verified: ${item.title}, p. ${page}` : `Not verified: quote not found on ${item.title}, p. ${page}`, {
          verified,
          id,
          page,
          quote,
          title: item.title,
        })
        if (!verified) process.exitCode = 1
      }),
  )

  addCommon(
    items
      .command('status')
      .description('Show library status')
      .action(async cmd => {
        const all = await listItems()
        const pages = all.reduce((n, i) => n + i.pageCount, 0)
        emit(cmd, `${all.length} items, ${pages} pages.`, {
          items: all.length,
          pages,
          byType: countBy(all.map(i => i.sourceType)),
        })
      }),
  )
}

async function ingestAndSave(file: string, opts: Record<string, unknown>): Promise<Item> {
  if (!sourceTypeOf(file)) throw new Error(`Unsupported file type: ${path.extname(file) || file}`)
  const existing = await findItemBySource(file)
  const item = await ingestFile(file, {
    title: typeof opts.title === 'string' ? opts.title : undefined,
    author: typeof opts.author === 'string' ? opts.author : undefined,
    kind: (opts.kind as Item['kind']) || 'book',
  })
  if (existing) {
    item.id = existing.id
    item.addedAt = existing.addedAt
    item.shelves = existing.shelves
    item.tags = existing.tags
  }
  await saveItem(item)
  return item
}

async function contentFrom(opts: Record<string, unknown>): Promise<string> {
  if (typeof opts.content === 'string') return opts.content
  if (typeof opts.file === 'string') {
    if (opts.file === '-') return await readStdin()
    return await fs.readFile(opts.file, 'utf8')
  }
  return ''
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

function notFound(cmd: Command, id: string): void {
  if (wantJson(cmd)) {
    process.stdout.write(JSON.stringify({ code: 'NOT_FOUND', error: `Item not found: ${id}`, hint: null, status: null, upgradeUrl: null }, null, 2) + '\n')
  } else {
    printError('NOT_FOUND', `Item not found: ${id}`)
  }
  process.exitCode = 1
}

function countBy(values: string[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const v of values) out[v] = (out[v] ?? 0) + 1
  return out
}
