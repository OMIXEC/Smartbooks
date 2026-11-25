import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { z } from 'zod'

import { readPages } from './commands/common.js'
import { getItem, listItems } from './store.js'

const reply = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data) }],
})

export function startMcpServer(): void {
  serveStdio(() => {
    const server = new McpServer({ name: 'smartbooks', version: '0.1.0' })
    server.registerTool('list_books', {
      description: 'List locally indexed books and documents.',
      inputSchema: z.object({
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(100).default(50),
      }),
    }, async ({ offset, limit }) => {
      const items = await listItems()
      return reply({ items: items.slice(offset, offset + limit).map(({ id, title, author, pageCount, sourceType }) => (
        { id, title, author, pageCount, sourceType }
      )), nextOffset: offset + limit < items.length ? offset + limit : null })
    })
    server.registerTool('book_toc', {
      description: 'Get a book’s table of contents.',
      inputSchema: z.object({ id: z.string().min(1).max(256) }),
    }, async ({ id }) => {
      const item = await getItem(id)
      if (!item) return { ...reply({ error: 'Item not found' }), isError: true }
      return reply({ id, title: item.title, toc: item.toc })
    })
    server.registerTool('read_pages', {
      description: 'Read selected pages with bounded output and continuation information.',
      inputSchema: z.object({
        id: z.string().min(1).max(256),
        first: z.number().int().min(1),
        last: z.number().int().min(1),
        part: z.number().int().min(1).optional(),
      }),
    }, async ({ id, first, last, part }) => {
      const item = await getItem(id)
      if (!item) return { ...reply({ error: 'Item not found' }), isError: true }
      if (last < first || first > item.pageCount) {
        return { ...reply({ error: 'Invalid page range' }), isError: true }
      }
      return reply({ id, title: item.title, version: item.updatedAt,
        ...readPages(item, [first, Math.min(last, item.pageCount)], part ?? null) })
    })
    server.registerTool('search_books', {
      description: 'Search locally indexed page text for a phrase.',
      inputSchema: z.object({
        query: z.string().min(1).max(1000),
        id: z.string().max(256).optional(),
        limit: z.number().int().min(1).max(100).default(20),
      }),
    }, async ({ query, id, limit }) => {
      const candidates = id ? [{ id }] : await listItems()
      const hits: { id: string; title: string; page: number }[] = []
      for (const candidate of candidates) {
        const item = await getItem(candidate.id)
        if (!item) continue
        for (const page of item.pages) {
          if (page.text.toLowerCase().includes(query.toLowerCase())) {
            hits.push({ id: item.id, title: item.title, page: page.n })
            if (hits.length >= limit) return reply({ hits })
          }
        }
      }
      return reply({ hits })
    })
    server.registerTool('verify_quote', {
      description: 'Verify that a quotation appears on an indexed page.',
      inputSchema: z.object({
        id: z.string().min(1).max(256),
        page: z.number().int().min(1),
        quote: z.string().min(1).max(4000),
      }),
    }, async ({ id, page, quote }) => {
      const item = await getItem(id)
      if (!item) return { ...reply({ error: 'Item not found' }), isError: true }
      const normalized = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase()
      const text = item.pages[page - 1]?.text
      return reply({ id, title: item.title, page, verified: Boolean(text && normalized(text).includes(normalized(quote))) })
    })
    return server
  })
}
