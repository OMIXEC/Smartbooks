import { oneLine } from '../util.js'
import { makePage, tocFromHeadings } from './index.js'
import type { ParsedDocument } from './pdf.js'

export function ingestText(raw: string, fallbackTitle: string): ParsedDocument {
  const text = raw.replace(/\r\n?/g, '\n')
  const chunks = text.includes('\f') ? text.split('\f') : chunkByLength(text, 6000)
  const pages = chunks.map((chunk, i) => makePage(i + 1, `Page ${i + 1}`, chunk))
  const toc = pages.map(p => ({ title: `Page ${p.n}`, page: p.n, level: 1 }))
  const description = oneLine(pages[0]?.text ?? '').slice(0, 240)
  return {
    title: fallbackTitle,
    author: null,
    description,
    pages,
    toc: tocFromHeadings(toc),
  }
}

function chunkByLength(text: string, size: number): string[] {
  const lines = text.split('\n')
  const out: string[] = []
  let buf: string[] = []
  let bytes = 0
  for (const line of lines) {
    const add = Buffer.byteLength(line) + 1
    if (bytes + add > size && buf.length > 0) {
      out.push(buf.join('\n'))
      buf = []
      bytes = 0
    }
    buf.push(line)
    bytes += add
  }
  if (buf.length > 0) out.push(buf.join('\n'))
  return out.length > 0 ? out : ['']
}
