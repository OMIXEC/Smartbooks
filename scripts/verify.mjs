#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cli = path.join(root, 'dist', 'cli.js')
let failures = 0

function run(args) {
  return execFileSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, CANDLE_HOME: process.env.CANDLE_HOME || path.join(root, '.candle') },
  })
}

function check(name, fn) {
  try {
    const value = fn()
    console.log(`PASS ${name}${value ? `: ${value}` : ''}`)
  } catch (e) {
    failures++
    console.log(`FAIL ${name}: ${e instanceof Error ? e.message : String(e)}`)
  }
}

check('version', () => run(['version']).trim())
check('items list', () => {
  const data = JSON.parse(run(['items', 'list', '--json']))
  if (!Array.isArray(data.items) || data.items.length === 0) throw new Error('library is empty; run `candle sync`')
  return `${data.items.length} items`
})
check('items toc', () => {
  const data = JSON.parse(run(['items', 'list', '--json']))
  const id = data.items[0].id
  const toc = JSON.parse(run(['items', 'toc', id, '--json']))
  if (!Array.isArray(toc.toc) || toc.toc.length === 0) throw new Error('empty TOC')
  return `${toc.toc.length} entries`
})
check('items read', () => {
  const data = JSON.parse(run(['items', 'list', '--json']))
  const id = data.items[0].id
  const read = JSON.parse(run(['items', 'read', id, '--pages', '1-2', '--json']))
  if (!Array.isArray(read.pages) || read.pages.length === 0) throw new Error('no pages returned')
  return `${read.pages.length} pages`
})
check('items cite', () => {
  const data = JSON.parse(run(['items', 'list', '--json']))
  const id = data.items[0].id
  const read = JSON.parse(run(['items', 'read', id, '--pages', '1', '--json']))
  const text = read.pages[0].text.replace(/\s+/g, ' ').trim()
  const quote = text.slice(0, Math.min(40, text.length))
  if (!quote) throw new Error('page 1 is empty')
  const cite = JSON.parse(run(['items', 'cite', `${id}:1`, '--quote', quote, '--json']))
  if (!cite.verified) throw new Error('quote did not verify')
  return 'verified'
})
check('ms list', () => {
  const data = JSON.parse(run(['ms', 'list', '--json']))
  return `${data.manuscripts.length} manuscripts`
})
check('marketplace browse', () => {
  const data = JSON.parse(run(['marketplace', 'browse', '--json', '--limit', '3']))
  return `${data.listings.length} listings`
})
check('ledger', () => {
  const out = run(['librarian', 'ledger', 'show', '--render'])
  if (!out.startsWith('EXPLORED (')) throw new Error('unexpected ledger output')
  return 'rendered'
})
check('setup status', () => {
  const data = JSON.parse(run(['setup', '--status', '--json']))
  return `${data.agents.length} agents`
})

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`)
  process.exit(1)
}
console.log('\nAll checks passed.')
