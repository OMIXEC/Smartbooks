import path from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import type { TocEntry } from '../types.js'
import { oneLine } from '../util.js'
import { makePage, tocFromHeadings } from './index.js'
import { stripHtml } from './html.js'
import type { ParsedDocument } from './pdf.js'

interface ManifestItem {
  id: string
  href: string
  type: string
  properties: string
}

export async function ingestEpub(_file: string, raw: Buffer, fallbackTitle: string): Promise<ParsedDocument> {
  const files = unzipSync(new Uint8Array(raw))
  const get = (name: string): string => {
    const entry = files[name]
    return entry ? strFromU8(entry) : ''
  }

  const container = get('META-INF/container.xml')
  const opfPath = /full-path="([^"]+)"/i.exec(container)?.[1] ?? findOpf(files)
  if (!opfPath) throw new Error('EPUB has no OPF package document')
  const opf = get(opfPath)
  const opfDir = path.posix.dirname(opfPath)

  const manifest = new Map<string, ManifestItem>()
  for (const m of opf.matchAll(/<item\b([^>]*)\/?>/gi)) {
    const attrs = m[1] ?? ''
    const id = attr(attrs, 'id')
    const href = attr(attrs, 'href')
    if (!id || !href) continue
    manifest.set(id, {
      id,
      href: resolve(opfDir, href),
      type: attr(attrs, 'media-type') || '',
      properties: attr(attrs, 'properties') || '',
    })
  }

  const spine: string[] = []
  for (const m of opf.matchAll(/<itemref\b([^>]*)\/?>/gi)) {
    const idref = attr(m[1] ?? '', 'idref')
    if (idref && manifest.has(idref)) spine.push(idref)
  }

  const navItem =
    [...manifest.values()].find(i => i.properties.split(/\s+/).includes('nav')) ??
    [...manifest.values()].find(i => i.href.endsWith('.ncx'))
  const nav = navItem ? get(navItem.href) : ''
  const navEntries = parseNav(nav, opfDir)

  const pageByHref = new Map<string, number>()
  spine.forEach((id, i) => {
    const item = manifest.get(id)
    if (item) pageByHref.set(item.href, i + 1)
  })

  const pages = spine.map((id, i) => {
    const item = manifest.get(id)
    const html = item ? get(item.href) : ''
    const text = stripHtml(html)
    const label =
      navEntries.find(n => pageByHref.get(n.href) === i + 1)?.title ||
      firstHeading(html) ||
      `Page ${i + 1}`
    return makePage(i + 1, label, text)
  })

  const toc: TocEntry[] = []
  for (const n of navEntries) {
    const page = pageByHref.get(n.href)
    if (page) toc.push({ title: n.title, page, level: n.level })
  }
  if (toc.length === 0) {
    for (const p of pages) {
      if (p.label && !/^Page \d+$/.test(p.label)) toc.push({ title: p.label, page: p.n, level: 1 })
    }
  }
  if (toc.length === 0) toc.push(...pages.map(p => ({ title: `Page ${p.n}`, page: p.n, level: 1 })))

  const title = oneLine(
    /<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i.exec(opf)?.[1]?.replace(/<[^>]+>/g, '') || fallbackTitle,
  )
  const author = oneLine(
    /<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i.exec(opf)?.[1]?.replace(/<[^>]+>/g, '') || '',
  ) || null
  const description = oneLine(
    /<dc:description[^>]*>([\s\S]*?)<\/dc:description>/i.exec(opf)?.[1]?.replace(/<[^>]+>/g, '') || '',
  ).slice(0, 240)

  return { title: title || fallbackTitle, author, description, pages, toc: tocFromHeadings(toc) }
}

function findOpf(files: Record<string, Uint8Array>): string | null {
  return Object.keys(files).find(n => n.toLowerCase().endsWith('.opf')) ?? null
}

function attr(attrs: string, name: string): string {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(attrs)
  return m ? (m[2] ?? m[3] ?? '') : ''
}

function resolve(dir: string, href: string): string {
  return path.posix.normalize(path.posix.join(dir, decodeURIComponent(href.split('#')[0] ?? href)))
}

function firstHeading(html: string): string {
  const m = /<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/i.exec(html)
  return m ? oneLine(stripHtml(m[2]!)) : ''
}

function parseNav(nav: string, opfDir: string): { title: string; href: string; level: number }[] {
  const out: { title: string; href: string; level: number }[] = []
  if (!nav) return out
  const navList = /<nav\b[^>]*>([\s\S]*?)<\/nav>/i.exec(nav)?.[1] ?? nav
  let level = 1
  for (const m of navList.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attr(m[1] ?? '', 'href')
    const title = oneLine(stripHtml(m[2]!))
    if (!href || !title) continue
    out.push({ title, href: resolve(opfDir, href), level })
    level = 1
  }
  if (out.length === 0) {
    for (const m of nav.matchAll(/<navPoint\b[\s\S]*?<text>([\s\S]*?)<\/text>[\s\S]*?<content\b([^>]*)\/?>/gi)) {
      const title = oneLine(stripHtml(m[1]!))
      const src = attr(m[2] ?? '', 'src')
      if (title && src) out.push({ title, href: resolve(opfDir, src), level: 1 })
    }
  }
  return out
}
