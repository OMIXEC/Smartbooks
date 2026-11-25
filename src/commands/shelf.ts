import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Command } from 'commander'
import {
  activeShelf,
  getItem,
  listItems,
  projectRoot,
  readShelfManifest,
  setActiveShelf,
  writeShelfManifest,
} from '../store.js'
import type { ShelfManifest } from '../types.js'
import { printError, slugify } from '../util.js'
import { addCommon, emit, optsOf } from './common.js'

export function registerShelf(program: Command): void {
  const shelf = program.command('shelf').description('Manage local shelves — curated sub-libraries')

  addCommon(
    shelf
      .command('init')
      .description('Create this project\'s shelf manifest (./.smartbooks/shelf.json)')
      .option('--name <name>', 'Shelf name')
      .action(async cmd => {
        const root = await projectRoot()
        const name = optsOf(cmd).name || path.basename(root)
        const manifest: ShelfManifest = { shelf: slugify(name), books: [] }
        const p = await writeShelfManifest(manifest)
        emit(cmd, `Created ${p}`, { path: p, shelf: manifest })
      }),
  )

  addCommon(
    shelf
      .command('current')
      .description('Show the active shelf for this project')
      .option('--local', 'Read only local state (no network)')
      .action(async cmd => {
        const manifest = await readShelfManifest()
        const active = await activeShelf()
        const slug = manifest?.shelf ?? active.slug
        const source = manifest ? 'manifest' : active.source
        emit(cmd, slug ? `Active shelf: ${slug}${source ? ` (${source})` : ''}` : 'No active shelf.', { slug, source })
      }),
  )

  addCommon(
    shelf
      .command('show [slug]')
      .description('Show a shelf and its books')
      .action(async (slug: string | undefined, cmd: Command) => {
        const manifest = await readShelfManifest()
        if (!manifest) return printError('NO_SHELF', 'No shelf manifest in this project. Run `sbs shelf init`.')
        if (slug && slug !== manifest.shelf) return printError('NOT_FOUND', `Shelf not found: ${slug}`)
        const books = await Promise.all(manifest.books.map(async b => ({ ...b, item: await getItem(b.id) })))
        emit(
          cmd,
          [`Shelf: ${manifest.shelf}`, ...books.map(b => `- ${b.title} (${b.id})`)].join('\n'),
          {
            shelf: {
              slug: manifest.shelf,
              name: manifest.shelf,
              itemCount: manifest.books.length,
              books,
            },
          },
        )
      }),
  )

  addCommon(
    shelf
      .command('use <slug>')
      .description('Set the active shelf for this project')
      .option('--local', 'Local only')
      .action(async (slug: string, cmd: Command) => {
        const manifest = await readShelfManifest()
        if (!manifest || manifest.shelf !== slug) return printError('NOT_FOUND', `Shelf not found: ${slug}`)
        await setActiveShelf(slug)
        emit(cmd, `Active shelf: ${slug}`, { slug, source: 'local' })
      }),
  )

  addCommon(
    shelf
      .command('add <id>')
      .description('Add a book to the project shelf')
      .option('--topics <topics>', 'Comma-separated topics')
      .option('--why <why>', 'Why this book belongs on the shelf')
      .action(async (id: string, cmd: Command) => {
        const item = await getItem(id)
        if (!item) return printError('NOT_FOUND', `Item not found: ${id}`)
        const manifest = (await readShelfManifest()) ?? { shelf: slugify(path.basename(await projectRoot())), books: [] }
        if (!manifest.books.some(b => b.id === id)) {
          manifest.books.push({
            id,
            title: item.title,
            topics: splitList(optsOf(cmd).topics),
            why: optsOf(cmd).why || '',
          })
        }
        const p = await writeShelfManifest(manifest)
        emit(cmd, `Added ${item.title} to ${manifest.shelf}`, { path: p, shelf: manifest })
      }),
  )

  addCommon(
    shelf
      .command('remove <id>')
      .description('Remove a book from the project shelf')
      .action(async (id: string, cmd: Command) => {
        const manifest = await readShelfManifest()
        if (!manifest) return printError('NO_SHELF', 'No shelf manifest in this project.')
        manifest.books = manifest.books.filter(b => b.id !== id)
        const p = await writeShelfManifest(manifest)
        emit(cmd, `Removed ${id}`, { path: p, shelf: manifest })
      }),
  )

  addCommon(
    shelf
      .command('create <name>')
      .description('Create a new local shelf')
      .action(async (name: string, cmd: Command) => {
        const manifest: ShelfManifest = { shelf: slugify(name), books: [] }
        const p = await writeShelfManifest(manifest)
        emit(cmd, `Created ${p}`, { path: p, shelf: manifest })
      }),
  )

  addCommon(
    shelf
      .command('delete <slug>')
      .description('Delete the local shelf manifest')
      .action(async (slug: string, cmd: Command) => {
        const manifest = await readShelfManifest()
        if (!manifest || manifest.shelf !== slug) return printError('NOT_FOUND', `Shelf not found: ${slug}`)
        const root = await projectRoot()
        await fs.rm(path.join(root, '.smartbooks', 'shelf.json'), { force: true })
        await setActiveShelf(null)
        emit(cmd, `Deleted ${slug}`, { deleted: slug })
      }),
  )

  addCommon(
    shelf
      .command('sync')
      .description('Reconcile the local shelf manifest (local only)')
      .action(async cmd => {
        const manifest = await readShelfManifest()
        if (!manifest) return printError('NO_SHELF', 'No shelf manifest in this project.')
        const known = new Set((await listItems()).map(i => i.id))
        const missing = manifest.books.filter(b => !known.has(b.id))
        emit(cmd, missing.length ? `Missing books: ${missing.map(b => b.id).join(', ')}` : `Shelf ${manifest.shelf} is in sync.`, {
          shelf: manifest,
          missing,
        })
      }),
  )
}

function splitList(value: unknown): string[] {
  if (typeof value !== 'string') return []
  return value.split(',').map(s => s.trim()).filter(Boolean)
}
