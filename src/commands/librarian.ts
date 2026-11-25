import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Command } from 'commander'
import { smartbooksHome, ledgerFile, recordLedger, renderLedger, tickLedger } from '../store.js'
import { nowIso, oneLine, printError, readJson, writeJson } from '../util.js'
import { addCommon, emit, optsOf } from './common.js'

interface Gap {
  intent: string
  category: string
  subcategory: string
  suggestedTitle?: string
  suggestedAuthor?: string
  domain?: string
  at: string
}

export function registerLibrarian(program: Command): void {
  const librarian = program.command('librarian').description('Librarian notebook and gap signals')

  const ledger = librarian.command('ledger').description('The project exploration ledger')

  addCommon(
    ledger
      .command('show')
      .description('Show the explored ledger')
      .option('--render', 'Render the block injected at session start')
      .action(async cmd => {
        const file = await ledgerFile()
        emit(cmd, renderLedger(file), file)
      }),
  )

  addCommon(
    ledger
      .command('tick')
      .description('Count a genuine new session')
      .requiredOption('--session <id>', 'Session id')
      .option('--render', 'Render the block injected at session start')
      .action(async cmd => {
        const file = await tickLedger(String(optsOf(cmd).session))
        emit(cmd, renderLedger(file), file)
      }),
  )

  addCommon(
    ledger
      .command('record')
      .description('Record a hit, miss or decline for a domain')
      .requiredOption('--domain <domain>', 'Sub-domain at the object-of-interest level')
      .requiredOption('--outcome <outcome>', 'hit, miss or declined')
      .option('--book <id>', 'Book id for a hit')
      .action(async cmd => {
        const outcome = String(optsOf(cmd).outcome)
        if (!['hit', 'miss', 'declined'].includes(outcome)) {
          return printError('USAGE', 'Outcome must be hit, miss or declined.')
        }
        const file = await recordLedger({
          domain: oneLine(String(optsOf(cmd).domain)).toLowerCase(),
          outcome: outcome as 'hit' | 'miss' | 'declined',
          book: optsOf(cmd).book ? String(optsOf(cmd).book) : null,
        })
        emit(cmd, renderLedger(file), file)
      }),
  )

  addCommon(
    librarian
      .command('report-gap')
      .description('Record a topic the library lacks')
      .option('--intent <intent>', 'Abstracted topic, no PII')
      .option('--category <category>', 'One word category')
      .option('--subcategory <subcategory>', '2-4 words')
      .option('--suggested-title <title>')
      .option('--suggested-author <author>')
      .option('--domain <domain>')
      .action(async cmd => {
        const gap: Gap = {
          intent: oneLine(String(optsOf(cmd).intent || '')),
          category: oneLine(String(optsOf(cmd).category || 'general')),
          subcategory: oneLine(String(optsOf(cmd).subcategory || '')),
          suggestedTitle: optsOf(cmd).suggestedTitle ? oneLine(String(optsOf(cmd).suggestedTitle)) : undefined,
          suggestedAuthor: optsOf(cmd).suggestedAuthor ? oneLine(String(optsOf(cmd).suggestedAuthor)) : undefined,
          domain: optsOf(cmd).domain ? oneLine(String(optsOf(cmd).domain)) : undefined,
          at: nowIso(),
        }
        const p = path.join(smartbooksHome(), 'gaps.json')
        const gaps = await readJson<Gap[]>(p, [])
        gaps.push(gap)
        await fs.mkdir(smartbooksHome(), { recursive: true })
        await writeJson(p, gaps.slice(-500))
        if (optsOf(cmd).domain) {
          await recordLedger({
            domain: oneLine(String(optsOf(cmd).domain)).toLowerCase(),
            outcome: 'miss',
            book: null,
          })
        }
        emit(cmd, 'Gap reported.', { reported: true, gap })
      }),
  )
}
