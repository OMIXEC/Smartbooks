import type { Command } from 'commander'
import { listItems } from '../store.js'
import type { WhoAmI } from '../types.js'
import { addCommon, emit } from './common.js'

export function registerAuth(program: Command): void {
  const auth = program.command('auth').description('Authentication commands')

  addCommon(
    auth
      .command('whoami')
      .description('Show the local identity')
      .action(async cmd => {
        const who: WhoAmI = {
          email: 'local@candle',
          name: 'Local library',
          tier: 'LOCAL',
          monthlyReadLimit: null,
          monthlyReadsUsed: 0,
          itemLimit: null,
          itemCount: (await listItems()).length,
          trial: { active: false },
        }
        emit(cmd, `Signed in locally as ${who.name} (${who.itemCount} items).`, who)
      }),
  )

  addCommon(
    auth
      .command('login')
      .description('No sign-in is needed for the local library')
      .action(async cmd => {
        emit(cmd, 'Smartbooks is local-first: there is no account and nothing to sign in to.', { status: 'local' })
      }),
  )

  addCommon(
    auth
      .command('logout')
      .description('No-op for the local library')
      .action(async cmd => {
        emit(cmd, 'Smartbooks has no account to sign out of.', { status: 'local' })
      }),
  )
}
