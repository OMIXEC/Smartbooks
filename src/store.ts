import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type {
  AccessFile,
  AccessSession,
  Item,
  ItemMeta,
  LedgerFile,
  LedgerRow,
  Manuscript,
  ShelfManifest,
} from './types.js'
import { homeDir } from './config.js'
import { nowIso, readJson, shortHash, writeJson } from './util.js'

export function candleHome(): string {
  return homeDir()
}

export async function ensureHome(): Promise<string> {
  const home = candleHome()
  await fs.mkdir(path.join(home, 'library', 'pages'), { recursive: true })
  await fs.mkdir(path.join(home, 'projects'), { recursive: true })
  return home
}

export function indexPath(): string {
  return path.join(candleHome(), 'library', 'items.json')
}

export function pagesPath(id: string): string {
  return path.join(candleHome(), 'library', 'pages', `${id}.json`)
}

export async function listItems(): Promise<ItemMeta[]> {
  const items = await readJson<ItemMeta[]>(indexPath(), [])
  return [...items].sort((a, b) => (a.addedAt < b.addedAt ? 1 : -1))
}

export async function findItem(id: string): Promise<ItemMeta | undefined> {
  return (await listItems()).find(i => i.id === id)
}

export async function findItemBySource(sourcePath: string): Promise<ItemMeta | undefined> {
  const abs = path.resolve(sourcePath)
  return (await listItems()).find(i => i.sourcePath && path.resolve(i.sourcePath) === abs)
}

export async function getItem(id: string): Promise<Item | undefined> {
  const meta = await findItem(id)
  if (!meta) return undefined
  const body = await readJson<{ pages: Item['pages']; toc: Item['toc'] }>(pagesPath(id), {
    pages: [],
    toc: [],
  })
  return { ...meta, pages: body.pages, toc: body.toc }
}

export async function saveItem(item: Item): Promise<void> {
  await ensureHome()
  const { pages, toc, ...meta } = item
  await writeJson(pagesPath(item.id), { pages, toc })
  const items = await listItems()
  const next = items.filter(i => i.id !== item.id)
  next.push(meta)
  await writeJson(indexPath(), next)
}

export async function updateItemMeta(id: string, patch: Partial<ItemMeta>): Promise<ItemMeta | undefined> {
  const items = await listItems()
  const idx = items.findIndex(i => i.id === id)
  if (idx < 0) return undefined
  items[idx] = { ...items[idx]!, ...patch, id, updatedAt: nowIso() }
  await writeJson(indexPath(), items)
  return items[idx]
}

export async function removeItem(id: string): Promise<boolean> {
  const items = await listItems()
  const next = items.filter(i => i.id !== id)
  if (next.length === items.length) return false
  await writeJson(indexPath(), next)
  await fs.rm(pagesPath(id), { force: true })
  return true
}

export function newItemId(seed: string): string {
  return `c_${shortHash(seed, 6)}`
}

// ---- manuscripts ----

export function manuscriptsPath(): string {
  return path.join(candleHome(), 'manuscripts.json')
}

export async function listManuscripts(): Promise<Manuscript[]> {
  return readJson<Manuscript[]>(manuscriptsPath(), [])
}

export async function saveManuscript(ms: Manuscript): Promise<void> {
  await ensureHome()
  const all = await listManuscripts()
  const next = all.filter(m => m.id !== ms.id)
  next.push(ms)
  await writeJson(manuscriptsPath(), next)
}

export async function removeManuscript(id: string): Promise<boolean> {
  const all = await listManuscripts()
  const next = all.filter(m => m.id !== id)
  if (next.length === all.length) return false
  await writeJson(manuscriptsPath(), next)
  return true
}

// ---- project identity ----

export async function projectRoot(start = process.cwd()): Promise<string> {
  const home = path.resolve(os.homedir())
  let dir = path.resolve(start)
  for (let i = 0; i < 40; i++) {
    if (dir === home || dir === path.dirname(dir)) break
    for (const marker of ['.candle/shelf.json', '.candlekeep/shelf.json', '.git']) {
      try {
        await fs.access(path.join(dir, marker))
        return dir
      } catch {
        // keep walking
      }
    }
    dir = path.dirname(dir)
  }
  return path.resolve(start)
}

export function projectHash(root: string): string {
  return createHash('sha256').update(root).digest('hex').slice(0, 16)
}

export async function projectStateDir(start = process.cwd()): Promise<string> {
  const root = await projectRoot(start)
  const dir = path.join(candleHome(), 'projects', projectHash(root))
  await fs.mkdir(dir, { recursive: true })
  return dir
}

// ---- ledger ----

export async function ledgerFile(start = process.cwd()): Promise<LedgerFile> {
  const dir = await projectStateDir(start)
  return readJson<LedgerFile>(path.join(dir, 'explored.json'), {
    project: projectHash(await projectRoot(start)),
    session: 0,
    seenSessions: [],
    rows: [],
  })
}

export async function saveLedger(file: LedgerFile, start = process.cwd()): Promise<void> {
  const dir = await projectStateDir(start)
  await writeJson(path.join(dir, 'explored.json'), file)
}

export async function tickLedger(sessionId: string, start = process.cwd()): Promise<LedgerFile> {
  const file = await ledgerFile(start)
  if (sessionId && !file.seenSessions.includes(sessionId)) {
    file.seenSessions.push(sessionId)
    file.seenSessions = file.seenSessions.slice(-200)
    file.session += 1
    await saveLedger(file, start)
  }
  return file
}

export async function recordLedger(
  row: Omit<LedgerRow, 'session' | 'at'>,
  start = process.cwd(),
): Promise<LedgerFile> {
  const file = await ledgerFile(start)
  const existing = file.rows.findIndex(r => r.domain === row.domain)
  const next: LedgerRow = { ...row, session: file.session, at: nowIso() }
  if (existing >= 0) file.rows[existing] = next
  else file.rows.push(next)
  await saveLedger(file, start)
  return file
}

export function renderLedger(file: LedgerFile): string {
  const header = `EXPLORED (session ${file.session}; miss and declined rows are re-checked after 3 sessions):`
  const rows = file.rows
    .slice()
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, 12)
    .map(r => `${r.domain} | ${r.outcome} | ${r.book ?? '-'} | s${r.session}`)
  return [header, ...rows].join('\n')
}

// ---- shelves ----

export async function readShelfManifest(start = process.cwd()): Promise<ShelfManifest | null> {
  const root = await projectRoot(start)
  for (const rel of ['.candle/shelf.json', '.candlekeep/shelf.json']) {
    const p = path.join(root, rel)
    const manifest = await readJson<ShelfManifest | null>(p, null)
    if (manifest && typeof manifest.shelf === 'string' && Array.isArray(manifest.books)) return manifest
  }
  return null
}

export async function writeShelfManifest(manifest: ShelfManifest, start = process.cwd()): Promise<string> {
  const root = await projectRoot(start)
  const p = path.join(root, '.candle', 'shelf.json')
  await writeJson(p, manifest)
  return p
}

export async function activeShelf(start = process.cwd()): Promise<{ slug: string | null; source: string | null }> {
  const dir = await projectStateDir(start)
  return readJson<{ slug: string | null; source: string | null }>(
    path.join(dir, 'active-shelf.json'),
    { slug: null, source: null },
  )
}

export async function setActiveShelf(slug: string | null, start = process.cwd()): Promise<void> {
  const dir = await projectStateDir(start)
  await writeJson(path.join(dir, 'active-shelf.json'), {
    slug,
    source: slug ? 'local' : null,
  })
}

// ---- access / value ----

export function accessPath(): string {
  return path.join(candleHome(), 'access.json')
}

export async function readAccess(): Promise<AccessFile> {
  return readJson<AccessFile>(accessPath(), { sessions: [] })
}

export async function startAccess(intent: string): Promise<AccessSession> {
  await ensureHome()
  const file = await readAccess()
  const session: AccessSession = {
    id: `a_${shortHash(intent + nowIso(), 6)}`,
    intent,
    startedAt: nowIso(),
    reads: [],
  }
  file.sessions.push(session)
  file.sessions = file.sessions.slice(-500)
  await writeJson(accessPath(), file)
  return session
}

export async function completeAccess(): Promise<AccessSession | undefined> {
  const file = await readAccess()
  const session = [...file.sessions].reverse().find(s => !s.completedAt)
  if (!session) return undefined
  session.completedAt = nowIso()
  await writeJson(accessPath(), file)
  return session
}

export async function recordAccessRead(id: string, title: string): Promise<void> {
  const file = await readAccess()
  const session = [...file.sessions].reverse().find(s => !s.completedAt)
  if (!session) return
  session.reads.push({ id, title, at: nowIso() })
  await writeJson(accessPath(), file)
}
