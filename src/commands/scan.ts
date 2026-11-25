import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Command } from 'commander'
import { loadConfig, resolveRoots } from '../config.js'
import { ingestFile, sourceTypeOf } from '../ingest/index.js'
import { findItemBySource, listItems, removeItem, saveItem } from '../store.js'
import { formatBytes, walkFiles } from '../util.js'
import { addCommon, emit, loadCatalog, optsOf } from './common.js'

export function registerScan(program: Command): void {
  addCommon(
    program
      .command('scan')
      .description('List documents on this machine worth adding to your library')
      .action(async cmd => {
        const cfg = await loadConfig()
        const roots = resolveRoots(cfg)
        const known = new Set((await listItems()).map(i => i.sourcePath).filter(Boolean) as string[])
        const rows: { path: string; type: string; bytes: number; known: boolean }[] = []
        for (const root of roots) {
          for (const file of await walkFiles(root.path, cfg.ingest.include, cfg.ingest.exclude)) {
            const st = await fs.stat(file).catch(() => null)
            if (!st) continue
            rows.push({ path: file, type: sourceTypeOf(file) ?? 'unknown', bytes: st.size, known: known.has(file) })
          }
        }
        emit(
          cmd,
          rows
            .map(r => `${r.known ? '✓' : '·'} ${r.path} (${r.type}, ${formatBytes(r.bytes)})`)
            .join('\n') || 'No documents found.',
          { roots: roots.map(r => r.path), files: rows },
        )
      }),
  )

  addCommon(
    program
      .command('sync')
      .description('Ingest every configured book and document')
      .option('--prune', 'Remove items whose source file no longer exists')
      .action(async cmd => {
        const cfg = await loadConfig()
        const roots = resolveRoots(cfg)
        const files: string[] = []
        for (const root of roots) {
          files.push(...(await walkFiles(root.path, cfg.ingest.include, cfg.ingest.exclude)))
        }
        const { listings, baseDir } = await loadCatalog()
        const byFile = new Map<string, (typeof listings)[number]>()
        for (const listing of listings) {
          if (!listing.file) continue
          const abs = path.isAbsolute(listing.file)
            ? listing.file
            : path.resolve(baseDir, listing.file)
          byFile.set(abs, listing)
          byFile.set(path.resolve(baseDir, '..', listing.file), listing)
        }
        const added: string[] = []
        const updated: string[] = []
        const failed: { file: string; error: string }[] = []
        for (const file of files) {
          try {
            const existing = await findItemBySource(file)
            const listing = byFile.get(path.resolve(file))
            const item = await ingestFile(file, {
              kind: existing?.kind ?? kindFor(file),
              title: listing?.item.title ?? existing?.title,
              author: listing?.item.author ?? undefined,
              description: listing?.item.description,
            })
            if (existing) {
              item.id = existing.id
              item.addedAt = existing.addedAt
              item.shelves = existing.shelves
              item.tags = existing.tags
              if (item.contentHash !== existing.contentHash) updated.push(item.id)
            } else {
              added.push(item.id)
            }
            await saveItem(item)
          } catch (e) {
            failed.push({ file, error: e instanceof Error ? e.message : String(e) })
          }
        }
        let pruned: string[] = []
        if (optsOf(cmd).prune) {
          for (const item of await listItems()) {
            if (!item.sourcePath) continue
            try {
              await fs.access(item.sourcePath)
            } catch {
              await removeItem(item.id)
              pruned.push(item.id)
            }
          }
        }
        emit(
          cmd,
          `Synced ${files.length} files: ${added.length} added, ${updated.length} updated, ${failed.length} failed${pruned.length ? `, ${pruned.length} pruned` : ''}.`,
          { files: files.length, added, updated, failed, pruned },
        )
        if (failed.length) process.exitCode = 1
      }),
  )
}

function kindFor(file: string): 'book' | 'doc' {
  return /(^|[/\\])(Ebooks|books|library)([/\\]|$)/i.test(file) ? 'book' : 'doc'
}
