import type { Command } from 'commander'
import { smartbooksHome, listItems, listManuscripts } from '../store.js'
import { addCommon, emit } from './common.js'

export const VERSION = '0.1.0'

export function registerVersion(program: Command): void {
  addCommon(
    program
      .command('version')
      .description('Show the installed Smartbooks version')
      .action(async cmd => {
        emit(cmd, `Smartbooks ${VERSION} (local)`, { version: VERSION, local: true })
      }),
  )

  addCommon(
    program
      .command('welcome')
      .description('Show the local library at a glance')
      .action(async cmd => {
        const items = await listItems()
        const ms = await listManuscripts()
        emit(
          cmd,
          [
            'Smartbooks — a free, local-first library for coding agents.',
            `Home: ${smartbooksHome()}`,
            `Books and docs: ${items.length}`,
            `Manuscripts: ${ms.length}`,
            '',
            'Try: sbs items list',
            '     sbs items toc <id>',
            '     sbs items read <id> --pages 1-3',
            '     sbs sync',
          ].join('\n'),
          { home: smartbooksHome(), items: items.length, manuscripts: ms.length },
        )
      }),
  )
}
