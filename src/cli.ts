import { Command } from 'commander'
import { startMcpServer } from './mcp.js'
import { registerAccess } from './commands/access.js'
import { registerAuth } from './commands/auth.js'
import { registerConfig } from './commands/config.js'
import { registerItems } from './commands/items.js'
import { registerLibrarian } from './commands/librarian.js'
import { registerMarketplace } from './commands/marketplace.js'
import { registerMs } from './commands/ms.js'
import { registerScan } from './commands/scan.js'
import { registerSetup } from './commands/setup.js'
import { registerShelf } from './commands/shelf.js'
import { registerVersion, VERSION } from './commands/version.js'
import { addCommon, emit, setGlobalOptions } from './commands/common.js'

const program = new Command()
program
  .name('sbs')
  .description('A free, local-first library for coding agents: browse by table of contents, read by page, cite exact quotes.')
  .version(VERSION)
  .option('--json', 'Output in JSON format')
  .option('--no-session', 'Do not record this call in the current research session')
  .option('--no-update-check', 'Skip the update check (local mode has no update check)')

program.hook('preAction', () => {
  setGlobalOptions(program.opts())
})

registerItems(program)
registerMs(program)
registerMarketplace(program)
registerShelf(program)
registerLibrarian(program)
registerAccess(program)
registerConfig(program)
registerAuth(program)
registerScan(program)
registerSetup(program)
registerVersion(program)
program.command('mcp').description('Serve the local library over MCP stdio').action(startMcpServer)

addCommon(
  program
    .command('tour')
    .description('A short guided tour of the local library')
    .action(async cmd => {
      emit(
        cmd,
        [
          'sbs tour',
          '',
          '1. See what is on the shelf:',
          '   sbs items list',
          '',
          '2. Open a table of contents:',
          '   sbs items toc <id>',
          '',
          '3. Read a page range:',
          '   sbs items read <id> --pages 1-3',
          '',
          '4. Verify a quote before citing it:',
          '   sbs items cite <id>:3 --quote "exact words"',
          '',
          '5. Ask an agent to use it: the Smartbooks skill spawns a librarian and readers.',
        ].join('\n'),
        { tour: true },
      )
    }),
)

program.parseAsync(process.argv).catch(err => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
