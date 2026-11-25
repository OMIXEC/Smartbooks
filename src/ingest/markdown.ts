import type { TocEntry } from '../types.js'
import { oneLine } from '../util.js'
import { makePage, tocFromHeadings } from './index.js'
import type { ParsedDocument } from './pdf.js'

export function ingestMarkdown(raw: string, fallbackTitle: string): ParsedDocument {
  const text = raw.replace(/\r\n?/g, '\n')
  const lines = text.split('\n')
  const h1 = lines.filter(l => /^#\s+\S/.test(l))
  const splitLevel = h1.length > 0 ? 1 : 2
  const splitRe = splitLevel === 1 ? /^#\s+\S/ : /^##\s+\S/

  const sections: { heading: string; lines: string[] }[] = []
  let current: { heading: string; lines: string[] } | null = null
  for (const line of lines) {
    if (splitRe.test(line)) {
      if (current) sections.push(current)
      current = { heading: line.replace(/^#{1,6}\s+/, '').trim(), lines: [line] }
    } else if (current) {
      current.lines.push(line)
    } else {
      current = { heading: '', lines: [line] }
    }
  }
  if (current) sections.push(current)
  if (sections.length === 0) sections.push({ heading: '', lines })

  const pages = sections.map((s, i) => makePage(i + 1, s.heading || `Page ${i + 1}`, s.lines.join('\n')))
  const headings: { title: string; page: number; level: number }[] = []
  let page = 1
  for (const line of lines) {
    const m = /^(#{1,6})\s+(.+)$/.exec(line)
    if (m) {
      headings.push({ title: m[2]!.trim(), page, level: m[1]!.length })
    } else if (splitRe.test(line)) {
      page++
    }
  }
  // Recompute page numbers by section boundaries, which is what readers see.
  const toc: TocEntry[] = []
  let sectionPage = 1
  for (const s of sections) {
    if (s.heading) toc.push({ title: s.heading, page: sectionPage, level: 1 })
    for (const line of s.lines) {
      const m = /^(#{2,6})\s+(.+)$/.exec(line)
      if (m) toc.push({ title: m[2]!.trim(), page: sectionPage, level: m[1]!.length })
    }
    sectionPage++
  }
  const title = oneLine(sections[0]?.heading || fallbackTitle)
  const description = oneLine(
    sections
      .flatMap(s => s.lines)
      .filter(l => l.trim() && !/^#{1,6}\s/.test(l))
      .slice(0, 6)
      .join(' '),
  ).slice(0, 240)
  return {
    title: title || fallbackTitle,
    author: null,
    description,
    pages,
    toc: toc.length ? tocFromHeadings(toc) : tocFromHeadings(headings),
  }
}
