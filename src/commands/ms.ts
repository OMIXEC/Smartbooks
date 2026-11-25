import type { Command } from 'commander'
import { ingestContent } from '../ingest/index.js'
import {
  getItem,
  listManuscripts,
  removeManuscript,
  saveItem,
  saveManuscript,
} from '../store.js'
import type { Manuscript } from '../types.js'
import { nowIso, oneLine, printError, shortHash } from '../util.js'
import { addCommon, emit, optsOf, wantJson } from './common.js'

export function registerMs(program: Command): void {
  const ms = program.command('ms').description('Manage manuscripts')

  addCommon(
    ms
      .command('list')
      .description('List manuscripts')
      .option('--active', 'Show only active manuscripts')
      .action(async cmd => {
        const all = (await listManuscripts()).filter(m => !optsOf(cmd).active || m.status === 'active')
        emit(
          cmd,
          all
            .map(
              m =>
                `- [ms:${m.id}] [book:${m.itemId}]${m.isSystem ? ' [wiki]' : ''}${m.autoUpdate ? ' [auto-update]' : ''} "${m.title}"\n    log when: ${m.trigger || m.criteria[0] || ''}`,
            )
            .join('\n') || 'No manuscripts.',
          { manuscripts: all },
        )
      }),
  )

  addCommon(
    ms
      .command('show <id>')
      .description('Show a manuscript and its full criteria')
      .action(async (id: string, cmd: Command) => {
        const m = await findManuscript(id)
        if (!m) return notFound(cmd, id)
        const item = await getItem(m.itemId)
        emit(
          cmd,
          [
            `# ${m.title}`,
            `ID: ${m.id}`,
            `Book ID: ${m.itemId}`,
            `Status: ${m.status}`,
            `Auto-update: ${m.autoUpdate ? 'yes' : 'no'}`,
            `Topics: ${m.topics.join(', ')}`,
            `Criteria: ${m.criteria.join('; ')}`,
            `Log when: ${m.trigger}`,
            '',
            item?.pages.map(p => p.text).join('\n\n') ?? '',
          ].join('\n'),
          { manuscript: m, id: m.id, itemId: m.itemId, title: m.title, item },
        )
      }),
  )

  addCommon(
    ms
      .command('create <title>')
      .description('Create a manuscript')
      .option('--topics <topics>', 'Comma-separated topics')
      .option('--criteria <criteria>', 'Semicolon-separated acceptance criteria')
      .option('--trigger <trigger>', 'One-line "log when" routing trigger')
      .option('--description <description>')
      .option('--auto-update', 'Maintain silently at task completion')
      .option('--wiki', 'Mark as the seeded general wiki')
      .option('--content <text>', 'Initial content')
      .action(async (title: string, cmd: Command) => {
        const topics = splitList(optsOf(cmd).topics)
        const criteria = splitList(optsOf(cmd).criteria, ';')
        const trigger = oneLine(optsOf(cmd).trigger || criteria[0] || '')
        const body =
          optsOf(cmd).content ||
          [
            `# ${title}`,
            '',
            '## Scope',
            topics.length ? topics.map(t => `- ${t}`).join('\n') : '- General knowledge',
            '',
            '## Entries',
            '',
          ].join('\n')
        const item = ingestContent(body, title, 'markdown', {
          title,
          kind: 'manuscript',
          description: optsOf(cmd).description,
        })
        await saveItem(item)
        const manuscript: Manuscript = {
          id: `ms_${shortHash(item.id + title, 6)}`,
          itemId: item.id,
          title,
          description: oneLine(optsOf(cmd).description || ''),
          topics,
          criteria,
          trigger,
          autoUpdate: Boolean(optsOf(cmd).autoUpdate),
          isSystem: Boolean(optsOf(cmd).wiki),
          status: 'active',
          createdAt: nowIso(),
          updatedAt: nowIso(),
        }
        await saveManuscript(manuscript)
        emit(cmd, `Created manuscript ${manuscript.id} (${item.id})`, { manuscript, item })
      }),
  )

  addCommon(
    ms
      .command('update <id>')
      .description('Update manuscript settings')
      .option('--title <title>')
      .option('--description <description>')
      .option('--topics <topics>')
      .option('--criteria <criteria>')
      .option('--trigger <trigger>')
      .option('--auto-update', 'Turn on auto-update')
      .option('--no-auto-update', 'Turn off auto-update')
      .option('--pause', 'Pause the manuscript')
      .option('--resume', 'Resume the manuscript')
      .option('--archive', 'Archive the manuscript')
      .action(async (id: string, cmd: Command) => {
        const m = await findManuscript(id)
        if (!m) return notFound(cmd, id)
        const o = optsOf(cmd)
        if (o.title !== undefined) m.title = oneLine(o.title)
        if (o.description !== undefined) m.description = oneLine(o.description)
        if (o.topics !== undefined) m.topics = splitList(o.topics)
        if (o.criteria !== undefined) m.criteria = splitList(o.criteria, ';')
        if (o.trigger !== undefined) m.trigger = oneLine(o.trigger)
        if (o.autoUpdate === true) m.autoUpdate = true
        if (o.autoUpdate === false) m.autoUpdate = false
        if (o.pause) m.status = 'paused'
        if (o.resume) m.status = 'active'
        if (o.archive) m.status = 'archived'
        m.updatedAt = nowIso()
        await saveManuscript(m)
        emit(cmd, `Updated ${m.title}`, { manuscript: m })
      }),
  )

  addCommon(
    ms
      .command('archive <id>')
      .description('Archive a manuscript')
      .action(async (id: string, cmd: Command) => {
        const m = await findManuscript(id)
        if (!m) return notFound(cmd, id)
        m.status = 'archived'
        m.updatedAt = nowIso()
        await saveManuscript(m)
        emit(cmd, `Archived ${m.title}`, { manuscript: m })
      }),
  )

  addCommon(
    ms
      .command('remove <id>')
      .description('Remove a manuscript record (the book is kept)')
      .action(async (id: string, cmd: Command) => {
        const m = await findManuscript(id)
        if (!m) return notFound(cmd, id)
        await removeManuscript(m.id)
        emit(cmd, `Removed manuscript ${m.id}`, { removed: m.id })
      }),
  )
}

async function findManuscript(id: string): Promise<Manuscript | undefined> {
  const all = await listManuscripts()
  return all.find(m => m.id === id || m.itemId === id)
}

function splitList(value: unknown, sep = ','): string[] {
  if (typeof value !== 'string') return []
  return value
    .split(sep)
    .map(s => oneLine(s))
    .filter(Boolean)
}

function notFound(cmd: Command, id: string): void {
  if (wantJson(cmd)) {
    process.stdout.write(JSON.stringify({ code: 'NOT_FOUND', error: `Manuscript not found: ${id}`, hint: null, status: null, upgradeUrl: null }, null, 2) + '\n')
  } else {
    printError('NOT_FOUND', `Manuscript not found: ${id}`)
  }
  process.exitCode = 1
}
