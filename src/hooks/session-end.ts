import { completeAccess } from '../store.js'

async function main(): Promise<void> {
  await completeAccess()
}

main().catch(() => process.exit(0))
