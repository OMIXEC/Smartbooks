import { getDocumentProxy, getMeta, extractText } from 'unpdf'
import type { TocEntry } from '../types.js'
import { oneLine } from '../util.js'
import { fallbackToc, makePage, tocFromHeadings, tocFromTocPage } from './index.js'

export interface ParsedDocument {
  title: string
  author: string | null
  description: string
  pages: { n: number; label: string; text: string }[]
  toc: TocEntry[]
}

export async function ingestPdf(_file: string, raw: Buffer, fallbackTitle: string): Promise<ParsedDocument> {
  const bytes = new Uint8Array(raw)
  const extracted = await extractText(new Uint8Array(bytes), { mergePages: false })
  const pages = extracted.text.map((text, i) => makePage(i + 1, `Page ${i + 1}`, text))

  let title = fallbackTitle
  let author: string | null = null
  try {
    const meta = await getMeta(new Uint8Array(bytes))
    const info = meta.info as Record<string, unknown>
    const metaTitle = typeof info.Title === 'string' ? oneLine(info.Title) : ''
    if (metaTitle && !/^(untitled|001-book-pdf|document)$/i.test(metaTitle)) title = metaTitle
    if (typeof info.Author === 'string' && oneLine(info.Author)) author = oneLine(info.Author)
  } catch {
    // metadata is optional
  }

  let toc: TocEntry[] = []
  try {
    toc = await outlineToc(bytes)
  } catch {
    toc = []
  }
  if (toc.length === 0) toc = tocFromTocPage(pages)
  if (toc.length === 0) toc = fallbackToc(pages)
  if (toc.length === 0) toc = tocFromHeadings([])

  const description = oneLine(pages.find(p => p.text.trim())?.text ?? '').slice(0, 240)
  return { title, author, description, pages, toc }
}

async function outlineToc(bytes: Uint8Array): Promise<TocEntry[]> {
  const doc = await getDocumentProxy(new Uint8Array(bytes))
  const outline = await doc.getOutline()
  if (!outline || outline.length === 0) return []
  const out: TocEntry[] = []
  const seen = new Set<string>()

  async function pageOf(dest: unknown): Promise<number | null> {
    try {
      let resolved = dest
      if (typeof resolved === 'string') resolved = await doc.getDestination(resolved)
      if (!Array.isArray(resolved) || resolved.length === 0) return null
      const ref = resolved[0] as { num?: number; gen?: number } | number
      if (typeof ref === 'number') return ref + 1
      if (ref && typeof ref === 'object' && typeof ref.num === 'number') {
        return (await doc.getPageIndex(ref as never)) + 1
      }
      return null
    } catch {
      return null
    }
  }

  async function visit(items: typeof outline, level: number): Promise<void> {
    for (const item of items) {
      const title = oneLine(item.title || '')
      const page = await pageOf(item.dest)
      if (title && page && page > 0) {
        const key = `${title}|${page}`
        if (!seen.has(key)) {
          seen.add(key)
          out.push({ title, page, level: Math.min(3, level) })
        }
      }
      if (item.items && item.items.length) await visit(item.items, level + 1)
    }
  }
  await visit(outline, 1)
  return out.slice(0, 300)
}
