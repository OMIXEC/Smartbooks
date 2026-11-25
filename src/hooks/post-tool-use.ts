import { promises as fs } from 'node:fs'
import path from 'node:path'
import { candleHome, recordAccessRead } from '../store.js'
import { nowIso, readJson, writeJson } from '../util.js'

interface HookPayload {
  tool_name?: string
  tool_input?: { command?: string }
  tool_response?: unknown
  tool_result?: unknown
}

interface ReadRow {
  id: string
  title: string
  at: string
}

const CMD_RE = /(?:^|[\s;&|(`'"/])(?:sbs|candle|candlekeep|sumbookit)(?:\s+--?[A-Za-z][\w-]*(?:=[^\s;&|]+|\s+(?!-)[^\s;&|]+)?)*\s+items\s+(?:read|get)\b([^;&|\n]*)/g

async function main(): Promise<void> {
  const payload = await readPayload()
  const command = payload.tool_input?.command ?? ''
  if (!command) return
  const ids = readsInCommand(command)
  if (ids.length === 0) return
  const rows = await readJson<ReadRow[]>(path.join(candleHome(), 'reads.json'), [])
  for (const id of ids) {
    rows.push({ id, title: '', at: nowIso() })
    await recordAccessRead(id, '')
  }
  await fs.mkdir(candleHome(), { recursive: true })
  await writeJson(path.join(candleHome(), 'reads.json'), rows.slice(-2000))
}

function readsInCommand(command: string): string[] {
  const out: string[] = []
  const text = command.slice(0, 8000)
  let m: RegExpExecArray | null
  while ((m = CMD_RE.exec(text))) {
    const tail = m[1] ?? ''
    for (const word of tail.split(/\s+/)) {
      const clean = word.replace(/^["']|["']$/g, '')
      if (!clean) continue
      if (clean.startsWith('-')) break
      const id = clean.split(':')[0] ?? ''
      if (/^[A-Za-z0-9_-]{2,64}$/.test(id)) out.push(id)
    }
  }
  return [...new Set(out)]
}

async function readPayload(): Promise<HookPayload> {
  if (process.stdin.isTTY) return {}
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) return {}
  try {
    return JSON.parse(raw) as HookPayload
  } catch {
    return {}
  }
}

main().catch(() => process.exit(0))
