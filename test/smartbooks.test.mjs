import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { zipSync, strToU8 } from 'fflate'

const root = path.resolve(import.meta.dirname, '..')
const cli = path.join(root, 'dist/cli.js')
function run(home, ...args) {
  return execFileSync(process.execPath, [cli, ...args, '--json', '--no-session'], {
    cwd: root, encoding: 'utf8',
    env: { ...process.env, HOME: home, SMARTBOOKS_HOME: path.join(home, 'library') },
  })
}

test('EPUB chapters, reading and citations survive the Smartbooks interface', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'smartbooks-test-'))
  const epub = path.join(home, 'sample.epub')
  const files = {
    'META-INF/container.xml': '<container><rootfile full-path="OEBPS/book.opf"/></container>',
    'OEBPS/book.opf': '<package><metadata><dc:title>Example</dc:title></metadata><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="two"/><itemref idref="one"/></spine></package>',
    'OEBPS/one.xhtml': '<html><body><h1>First</h1><p>First passage.</p></body></html>',
    'OEBPS/two.xhtml': '<html><body><h1>Second</h1><p>Second passage.</p></body></html>',
  }
  writeFileSync(epub, zipSync(Object.fromEntries(Object.entries(files).map(([k,v]) => [k, strToU8(v)]))))
  const item = JSON.parse(run(home, 'items', 'add', epub)).item
  const page = JSON.parse(run(home, 'items', 'read', item.id, '--page', '1'))
  assert.match(page.pages[0].text, /Second passage/)
  assert.equal(JSON.parse(run(home, 'items', 'cite', item.id + ':1', '--quote', 'Second passage')).verified, true)
  assert.equal(JSON.parse(run(home, 'items', 'toc', item.id)).toc.length, 2)
})

test('setup creates sbs and preserves an existing candle executable', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'smartbooks-setup-'))
  mkdirSync(path.join(home, '.codex'), { recursive: true })
  mkdirSync(path.join(home, '.local/bin'), { recursive: true })
  const old = path.join(home, '.local/bin/candle')
  writeFileSync(old, 'original')
  const result = JSON.parse(run(home, 'setup'))
  assert.deepEqual(result.failed, [])
  assert.equal(readFileSync(old, 'utf8'), 'original')
  assert.ok(existsSync(path.join(home, '.local/bin/sbs')))
  assert.ok(existsSync(path.join(home, '.agents/skills/smartbooks/SKILL.md')))
  assert.ok(existsSync(path.join(home, '.codex/agents/smartbooks-librarian.toml')))
})
