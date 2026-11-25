import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Command } from 'commander'
import type { Item, Listing, Page } from '../types.js'
import { candleHome } from '../store.js'
import { parsePageRange } from '../util.js'

export const PAGE_LIMIT_BYTES = 20_000

export function addCommon(cmd: Command): Command {
  return cmd
    .option('--json', 'Output in JSON format')
    .option('--no-session', 'Do not record this call in the current research session')
    .option('--no-update-check', 'Skip the update check (local mode has no update check)')
}

let GLOBAL_OPTS: Record<string, any> = {}

export function setGlobalOptions(value: Record<string, any>): void {
  GLOBAL_OPTS = value
}

export function optsOf(value: unknown): Record<string, any> {
  let local: Record<string, any> = {}
  if (value && typeof value === 'object' && 'opts' in value) {
    const fn = value.opts
    if (typeof fn === 'function') {
      const result = fn.call(value)
      if (result && typeof result === 'object') local = result as Record<string, any>
    }
  } else if (value && typeof value === 'object') {
    local = value as Record<string, any>
  }
  return { ...GLOBAL_OPTS, ...local }
}

export function wantJson(cmd: unknown): boolean {
  return Boolean(optsOf(cmd).json)
}

export function emit(cmd: unknown, human: string, value: unknown): void {
  if (wantJson(cmd)) process.stdout.write(JSON.stringify(value, null, 2) + '\n')
  else process.stdout.write(human.endsWith('\n') ? human : human + '\n')
}

export function parseTargets(args: string[]): { id: string; pages: string | null }[] {
  const out: { id: string; pages: string | null }[] = []
  for (const arg of args) {
    for (const part of arg.split(',')) {
      const trimmed = part.trim()
      if (!trimmed) continue
      const idx = trimmed.lastIndexOf(':')
      if (idx > 0) out.push({ id: trimmed.slice(0, idx), pages: trimmed.slice(idx + 1) })
      else out.push({ id: trimmed, pages: null })
    }
  }
  return out
}

export function splitParts(text: string, limit = PAGE_LIMIT_BYTES): string[] {
  if (Buffer.byteLength(text) <= limit) return [text]
  const lines = text.split('\n')
  const parts: string[] = []
  let buf: string[] = []
  let bytes = 0
  for (const line of lines) {
    const add = Buffer.byteLength(line) + 1
    if (bytes + add > limit && buf.length > 0) {
      parts.push(buf.join('\n'))
      buf = []
      bytes = 0
    }
    buf.push(line)
    bytes += add
  }
  if (buf.length > 0) parts.push(buf.join('\n'))
  return parts.length > 0 ? parts : ['']
}

export interface ReadResult {
  pages: { n: number; text: string; part?: number; parts?: number }[]
  next: { pages: string; part?: number } | null
  stopped: boolean
}

export function readPages(
  item: Item,
  range: [number, number],
  part: number | null,
  limit = PAGE_LIMIT_BYTES,
): ReadResult {
  const [lo, hi] = range
  const pages: ReadResult['pages'] = []
  let bytes = 0
  let lastRead = lo - 1
  for (let n = lo; n <= hi && n <= item.pages.length; n++) {
    const page = item.pages[n - 1]
    if (!page) continue
    if (part !== null) {
      const parts = splitParts(page.text, limit)
      const idx = Math.max(0, Math.min(parts.length - 1, part - 1))
      pages.push({ n, text: parts[idx] ?? '', part: idx + 1, parts: parts.length })
      lastRead = n
      if (idx + 1 < parts.length) {
        return { pages, next: { pages: String(n), part: idx + 2 }, stopped: true }
      }
      continue
    }
    const pageBytes = Buffer.byteLength(page.text)
    if (bytes + pageBytes > limit && pages.length > 0) {
      return { pages, next: { pages: `${n}-${hi}` }, stopped: true }
    }
    if (pageBytes > limit) {
      const parts = splitParts(page.text, limit)
      pages.push({ n, text: parts[0] ?? '', part: 1, parts: parts.length })
      return { pages, next: { pages: String(n), part: 2 }, stopped: true }
    }
    pages.push({ n, text: page.text })
    bytes += pageBytes
    lastRead = n
  }
  const nextPage = lastRead + 1
  return {
    pages,
    next: nextPage <= Math.min(hi, item.pages.length) ? { pages: `${nextPage}-${hi}` } : null,
    stopped: false,
  }
}

export function rangeFor(item: Item, spec: string | null, pageOpt: string | undefined): [number, number] {
  const parsed = parsePageRange(spec ?? pageOpt)
  if (parsed) return [parsed[0], Math.min(parsed[1], item.pageCount)]
  return [1, Math.min(10, item.pageCount)]
}

export function renderRead(item: Item, result: ReadResult): string {
  const lines: string[] = []
  lines.push(item.title)
  lines.push(`ID: ${item.id} | ${item.pageCount} pages`)
  lines.push(`Version: ${item.updatedAt}`)
  for (const p of result.pages) {
    const label = p.parts ? `── Page ${p.n} (part ${p.part} of ${p.parts}) ──` : `── Page ${p.n} ──`
    lines.push(label)
    lines.push(p.text)
  }
  if (result.next) {
    const next = result.next.part
      ? `Page ${result.next.pages} continues (part ${result.next.part}). Next: sbs items read ${item.id} --pages ${result.next.pages} --part ${result.next.part}`
      : `Stopped after page ${result.pages.at(-1)?.n ?? 0} to stay under 20,000 bytes. Next: sbs items read ${item.id} --pages ${result.next.pages}`
    lines.push(next)
  }
  return lines.join('\n')
}

export async function catalogPath(): Promise<string> {
  const candidates = [
    path.join(process.cwd(), 'catalog', 'books.json'),
    path.join(candleHome(), 'catalog.json'),
  ]
  for (const p of candidates) {
    try {
      await fs.access(p)
      return p
    } catch {
      // keep looking
    }
  }
  return candidates[0]!
}

export async function loadCatalog(): Promise<{ listings: Listing[]; baseDir: string }> {
  const p = await catalogPath()
  try {
    const raw = await fs.readFile(p, 'utf8')
    const parsed = JSON.parse(raw) as { listings?: Listing[] } | Listing[]
    const listings = Array.isArray(parsed) ? parsed : parsed.listings ?? []
    return { listings, baseDir: path.dirname(p) }
  } catch {
    return { listings: [], baseDir: path.dirname(p) }
  }
}

export function listingHuman(l: Listing): string {
  return `${l.id}  ${l.item.title}${l.item.author ? ` — ${l.item.author}` : ''} (${l.item.pageCount} pages, ${l.proOnly ? 'Professional' : 'Free'})`
}

export function pageSnippet(text: string, query: string, width = 160): string {
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx < 0) return text.replace(/\s+/g, ' ').slice(0, width)
  const start = Math.max(0, idx - Math.floor(width / 2))
  return text.slice(start, start + width).replace(/\s+/g, ' ')
}

export function pageLabel(p: Page): string {
  return p.label || `Page ${p.n}`
}
