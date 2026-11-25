import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Item, ItemKind, SourceType, TocEntry } from '../types.js'
import { contentHash, normalizeText, nowIso, oneLine, slugify } from '../util.js'
import { newItemId } from '../store.js'
import { ingestPdf } from './pdf.js'
import { ingestEpub } from './epub.js'
import { ingestMarkdown } from './markdown.js'
import { ingestHtml } from './html.js'
import { ingestText } from './text.js'

export interface IngestOptions {
  kind?: ItemKind
  title?: string
  author?: string | null
  description?: string
}

export function sourceTypeOf(file: string): SourceType | null {
  const ext = path.extname(file).toLowerCase()
  if (ext === '.pdf') return 'pdf'
  if (ext === '.epub') return 'epub'
  if (ext === '.md' || ext === '.markdown') return 'markdown'
  if (ext === '.html' || ext === '.htm') return 'html'
  if (ext === '.txt' || ext === '.text') return 'text'
  return null
}

export function titleFromFile(file: string): string {
  return oneLine(path.basename(file, path.extname(file)).replace(/[-_]+/g, ' '))
}

export async function ingestFile(file: string, opts: IngestOptions = {}): Promise<Item> {
  const abs = path.resolve(file)
  const type = sourceTypeOf(abs)
  if (!type) throw new Error(`Unsupported file type: ${path.extname(abs) || abs}`)

  const raw = await fs.readFile(abs)
  const hash = contentHash(raw.toString('base64'))
  const fallbackTitle = opts.title || titleFromFile(abs)
  let parsed: { title: string; author: string | null; description: string; pages: { n: number; label: string; text: string }[]; toc: TocEntry[] }

  switch (type) {
    case 'pdf':
      parsed = await ingestPdf(abs, raw, fallbackTitle)
      break
    case 'epub':
      parsed = await ingestEpub(abs, raw, fallbackTitle)
      break
    case 'markdown':
      parsed = ingestMarkdown(raw.toString('utf8'), fallbackTitle)
      break
    case 'html':
      parsed = ingestHtml(raw.toString('utf8'), fallbackTitle)
      break
    default:
      parsed = ingestText(raw.toString('utf8'), fallbackTitle)
      break
  }

  const title = oneLine(opts.title || parsed.title || fallbackTitle)
  const id = newItemId(`${abs}:${hash}`)
  const now = nowIso()
  return {
    id,
    title,
    author: opts.author ?? parsed.author ?? null,
    description: oneLine(opts.description || parsed.description || ''),
    sourceType: type,
    sourcePath: abs,
    pageCount: parsed.pages.length,
    addedAt: now,
    updatedAt: now,
    contentHash: hash,
    shelves: [],
    proOnly: false,
    tags: [],
    kind: opts.kind || 'book',
    pages: parsed.pages,
    toc: parsed.toc,
  }
}

export function ingestContent(
  raw: string,
  title: string,
  type: SourceType = 'markdown',
  opts: IngestOptions = {},
): Item {
  const hash = contentHash(raw)
  const fallbackTitle = opts.title || title
  const parsed =
    type === 'html'
      ? ingestHtml(raw, fallbackTitle)
      : type === 'text'
        ? ingestText(raw, fallbackTitle)
        : ingestMarkdown(raw, fallbackTitle)
  const id = newItemId(`content:${hash}`)
  const now = nowIso()
  return {
    id,
    title: oneLine(opts.title || parsed.title || fallbackTitle),
    author: opts.author ?? parsed.author ?? null,
    description: oneLine(opts.description || parsed.description || ''),
    sourceType: type,
    sourcePath: null,
    pageCount: parsed.pages.length,
    addedAt: now,
    updatedAt: now,
    contentHash: hash,
    shelves: [],
    proOnly: false,
    tags: [],
    kind: opts.kind || 'doc',
    pages: parsed.pages,
    toc: parsed.toc,
  }
}

export function defaultDescription(item: Item): string {
  const first = item.pages.find(p => p.text.trim())
  const text = first ? first.text.replace(/\s+/g, ' ').trim() : ''
  return text.slice(0, 240)
}

export function tocFromHeadings(
  headings: { title: string; page: number; level: number }[],
): TocEntry[] {
  const seen = new Set<string>()
  const out: TocEntry[] = []
  for (const h of headings) {
    const title = oneLine(h.title)
    if (!title || title.length > 160) continue
    const key = `${title}|${h.page}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ title, page: h.page, level: Math.max(1, Math.min(3, h.level)) })
  }
  return out.slice(0, 300)
}

export function tocFromTocPage(pages: { n: number; text: string }[]): TocEntry[] {
  const tocPage = pages.slice(0, 40).find(p => /^(table of contents|contents)\s*$/im.test(p.text))
  if (!tocPage) return []
  const lines = tocPage.text
    .split('\n')
    .map(l => oneLine(l))
    .filter(Boolean)
  const start = lines.findIndex(l => /^(table of contents|contents)$/i.test(l))
  const candidates = lines
    .slice(start + 1)
    .filter(l => {
      if (l.length < 3 || l.length > 110) return false
      if (/^\d+$/.test(l)) return false
      if (/^(table of contents|contents)$/i.test(l)) return false
      if (/©|copyright|all rights reserved/i.test(l)) return false
      if (/^[a-z]/.test(l) && l.split(/\s+/).length > 14) return false
      return l.split(/\s+/).length <= 14
    })
    .slice(0, 120)
  const entries: TocEntry[] = []
  const seen = new Set<string>()
  for (const title of candidates) {
    const needle = title.toLowerCase().slice(0, 48)
    if (needle.length < 3) continue
    const page = pages.find(p => p.n > tocPage.n && p.text.toLowerCase().includes(needle))
    if (!page) continue
    const key = `${needle}|${page.n}`
    if (seen.has(key)) continue
    seen.add(key)
    entries.push({ title, page: page.n, level: 1 })
  }
  return entries.length >= 2 ? entries : []
}

export function fallbackToc(pages: { n: number; text: string }[]): TocEntry[] {
  const entries: TocEntry[] = []
  const headingRe =
    /^(?:chapter|part|section|appendix|lesson|module)\b[\s:.-]*(?:\d+|[ivxlcdm]+)?\b.*$/i
  const numberedRe = /^\d+(?:\.\d+){0,3}\s+\S.{2,80}$/
  const seen = new Set<string>()
  for (const p of pages) {
    const lines = p.text.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 12)
    for (const line of lines) {
      if (line.length < 3 || line.length > 90) continue
      if (/[.!?;:,]$/.test(line)) continue
      if (/^\d+$/.test(line)) continue
      const isHeading = headingRe.test(line) || numberedRe.test(line)
      if (!isHeading) continue
      const key = line.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      entries.push({
        title: line,
        page: p.n,
        level: /^(?:chapter|part|appendix)\b/i.test(line) ? 1 : 2,
      })
      break
    }
  }
  if (entries.length === 0) {
    for (let n = 1; n <= pages.length; n += 10) entries.push({ title: `Page ${n}`, page: n, level: 1 })
  }
  return entries.slice(0, 300)
}

export function cleanPageText(text: string): string {
  return normalizeText(text)
}

export function makePage(n: number, label: string, text: string) {
  return { n, label: oneLine(label) || `Page ${n}`, text: cleanPageText(text) }
}

export function slugFor(title: string): string {
  return slugify(title)
}
