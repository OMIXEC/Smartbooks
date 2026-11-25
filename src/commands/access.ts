import path from 'node:path'
import type { Command } from 'commander'
import { candleHome, completeAccess, getItem, readAccess, startAccess } from '../store.js'
import { readJson } from '../util.js'
import { addCommon, emit, optsOf } from './common.js'

export function registerAccess(program: Command): void {
  const access = program.command('access').description('Reading sessions and the value report')

  addCommon(
    access
      .command('start')
      .description('Open a reading session')
      .option('--intent <intent>', 'What this session is trying to learn')
      .action(async cmd => {
        const session = await startAccess(String(optsOf(cmd).intent || ''))
        emit(cmd, session.id, { session })
      }),
  )

  addCommon(
    access
      .command('complete')
      .description('Close the current reading session')
      .action(async cmd => {
        const session = await completeAccess()
        emit(cmd, session ? `Completed ${session.id}` : 'No open session.', { session: session ?? null })
      }),
  )

  addCommon(
    access
      .command('value')
      .description('See what your agents have been reading')
      .action(async cmd => {
        const file = await readAccess()
        const tracked = await readJson<{ id: string; title: string }[]>(
          path.join(candleHome(), 'reads.json'),
          [],
        )
        const reads = [...file.sessions.flatMap(s => s.reads), ...tracked]
        const byBook = new Map<string, { id: string; title: string; count: number }>()
        for (const r of reads) {
          const row = byBook.get(r.id) ?? { id: r.id, title: r.title, count: 0 }
          row.count += 1
          if (!row.title) row.title = (await getItem(r.id))?.title ?? ''
          byBook.set(r.id, row)
        }
        const top = [...byBook.values()].sort((a, b) => b.count - a.count).slice(0, 10)
        emit(
          cmd,
          [
            `${file.sessions.length} sessions, ${reads.length} reads.`,
            ...top.map(t => `- ${t.title} (${t.id}): ${t.count} reads`),
          ].join('\n'),
          { sessions: file.sessions.length, reads: reads.length, top },
        )
      }),
  )
}
