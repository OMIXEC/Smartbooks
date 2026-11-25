import type { TocEntry } from '../types.js'
import { oneLine } from '../util.js'
import { makePage, tocFromHeadings } from './index.js'
import type { ParsedDocument } from './pdf.js'

export function ingestHtml(raw: string, fallbackTitle: string): ParsedDocument {
  const html = raw
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  const h1Match = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)
  const title = oneLine(stripHtml(titleMatch?.[1] || h1Match?.[1] || fallbackTitle)) || fallbackTitle

  const splitRe = /<h([12])\b[^>]*>([\s\S]*?)<\/h\1>/gi
  const marks: { index: number; level: number; title: string }[] = []
  let m: RegExpExecArray | null
  while ((m = splitRe.exec(html))) {
    marks.push({ index: m.index, level: Number(m[1]), title: oneLine(stripHtml(m[2]!)) })
  }

  const sections: { title: string; html: string }[] = []
  if (marks.length === 0) {
    sections.push({ title, html })
  } else {
    if (marks[0]!.index > 0) sections.push({ title, html: html.slice(0, marks[0]!.index) })
    for (let i = 0; i < marks.length; i++) {
      const start = marks[i]!.index
      const end = i + 1 < marks.length ? marks[i + 1]!.index : html.length
      sections.push({ title: marks[i]!.title, html: html.slice(start, end) })
    }
  }

  const pages = sections.map((s, i) => makePage(i + 1, s.title || `Page ${i + 1}`, stripHtml(s.html)))
  const toc: TocEntry[] = sections.map((s, i) => ({
    title: s.title || `Page ${i + 1}`,
    page: i + 1,
    level: 1,
  }))
  const description = oneLine(pages.map(p => p.text).join(' ')).slice(0, 240)
  return { title, author: null, description, pages, toc: tocFromHeadings(toc) }
}

export function stripHtml(s: string): string {
  return decodeEntities(
    s
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function decodeEntities(s: string): string {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    mdash: '—',
    ndash: '–',
    hellip: '…',
    rsquo: '’',
    lsquo: '‘',
    rdquo: '”',
    ldquo: '“',
  }
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (all, name) => named[String(name).toLowerCase()] ?? all)
}
