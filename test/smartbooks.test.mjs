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

test('setup creates sbs and preserves unrelated executables', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'smartbooks-setup-'))
  mkdirSync(path.join(home, '.codex'), { recursive: true })
  mkdirSync(path.join(home, '.local/bin'), { recursive: true })
  const old = path.join(home, '.local/bin/existing-tool')
  writeFileSync(old, 'original')
  const result = JSON.parse(run(home, 'setup'))
  assert.deepEqual(result.failed, [])
  assert.equal(readFileSync(old, 'utf8'), 'original')
  assert.ok(existsSync(path.join(home, '.local/bin/sbs')))
  assert.ok(existsSync(path.join(home, '.agents/skills/smartbooks/SKILL.md')))
  assert.ok(existsSync(path.join(home, '.codex/agents/smartbooks-librarian.toml')))
})

test('long Unicode passages can be reconstructed within byte limits and continue to later pages', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'smartbooks-long-'))
  const file = path.join(home, 'book.md')
  writeFileSync(file, '# One\n\n' + 'אבג🙂'.repeat(8000) + '\n\n# Two\n\nSecond chapter.')
  const item = JSON.parse(run(home, 'items', 'add', file)).item
  const expected = item.pages.map(p => p.text).join('')
  let result = JSON.parse(run(home, 'items', 'read', item.id, '--pages', '1-2'))
  let combined = ''
  for (let i = 0; i < 30; i++) {
    for (const page of result.pages) {
      assert.ok(Buffer.byteLength(page.text) <= 20000)
      combined += page.text
    }
    if (!result.next) break
    const args = ['items', 'read', item.id, '--pages', result.next.pages]
    if (result.next.part) args.push('--part', String(result.next.part))
    result = JSON.parse(run(home, ...args))
  }
  assert.equal(combined, expected)
})

test('missing EPUB spine content is reported instead of stored as an empty chapter', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'smartbooks-broken-'))
  const epub = path.join(home, 'broken.epub')
  const files = {
    'META-INF/container.xml': "<container><rootfile full-path='book.opf'/></container>",
    'book.opf': '<package><manifest><item id="one" href="missing.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/></spine></package>',
  }
  writeFileSync(epub, zipSync(Object.fromEntries(Object.entries(files).map(([k,v]) => [k, strToU8(v)]))))
  assert.throws(() => run(home, 'items', 'add', epub))
})

test('corrupt library index fails closed and is never replaced by an empty index', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'smartbooks-corrupt-'))
  const library = path.join(home, 'library', 'library')
  mkdirSync(library, { recursive: true })
  const index = path.join(library, 'items.json')
  writeFileSync(index, '{broken')
  assert.throws(() => run(home, 'items', 'list'))
  assert.equal(readFileSync(index, 'utf8'), '{broken')
})

test('all-book reading reaches every page through bounded continuations', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'smartbooks-full-'))
  const file = path.join(home, 'book.md')
  writeFileSync(file, Array.from({ length: 15 }, (_, i) => '# Chapter ' + (i + 1) + '\n\n' + ('content ' + i + ' ').repeat(400)).join('\n\n'))
  const item = JSON.parse(run(home, 'items', 'add', file)).item
  let data = JSON.parse(run(home, 'items', 'read', item.id, '--all'))
  const seen = []
  for (let i = 0; i < 30; i++) {
    for (const page of data.pages) seen.push(page.text)
    if (!data.next) break
    const args = ['items', 'read', item.id, '--pages', data.next.pages]
    if (data.next.part) args.push('--part', String(data.next.part))
    data = JSON.parse(run(home, ...args))
  }
  assert.equal(seen.join(''), item.pages.map(p => p.text).join(''))
})

test('MCP clients can discover and read a local book with citations', async () => {
  const { spawn } = await import('node:child_process')
  const { createInterface } = await import('node:readline')
  const home = mkdtempSync(path.join(tmpdir(), 'smartbooks-mcp-'))
  const file = path.join(home, 'book.md')
  writeFileSync(file, '# Example\n\nA verifiable passage.')
  const item = JSON.parse(run(home, 'items', 'add', file)).item
  const child = spawn(process.execPath, [cli, 'mcp'], {
    cwd: root,
    env: { ...process.env, HOME: home, SMARTBOOKS_HOME: path.join(home, 'library') },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]()
  const send = value => child.stdin.write(JSON.stringify(value) + '\n')
  const request = async (id, method, params) => {
    send({ jsonrpc: '2.0', id, method, params })
    const response = JSON.parse((await lines.next()).value)
    assert.equal(response.id, id)
    assert.equal(response.error, undefined)
    return response.result
  }
  try {
    const initialized = await request(1, 'initialize', {
      protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' },
    })
    assert.equal(initialized.serverInfo.name, 'smartbooks')
    send({ jsonrpc: '2.0', method: 'notifications/initialized' })
    const tools = await request(2, 'tools/list', {})
    assert.ok(tools.tools.some(tool => tool.name === 'read_pages'))
    const page = await request(3, 'tools/call', { name: 'read_pages', arguments: { id: item.id, first: 1, last: 1 } })
    assert.match(JSON.parse(page.content[0].text).pages[0].text, /verifiable passage/)
    const citation = await request(4, 'tools/call', { name: 'verify_quote', arguments: { id: item.id, page: 1, quote: 'verifiable passage' } })
    assert.equal(JSON.parse(citation.content[0].text).verified, true)
  } finally {
    child.stdin.end()
    child.kill()
  }
})

test('EPUB navigation resolves paths relative to the navigation document', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'smartbooks-nav-'))
  const epub = path.join(home, 'book.epub')
  const files = {
    'META-INF/container.xml': '<container><rootfile full-path="OEBPS/book.opf"/></container>',
    'OEBPS/book.opf': '<package><manifest><item id="nav" href="nav/toc.xhtml" properties="nav" media-type="application/xhtml+xml"/><item id="one" href="chapters/one.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/></spine></package>',
    'OEBPS/nav/toc.xhtml': '<nav><a href="../chapters/one.xhtml">A named chapter</a></nav>',
    'OEBPS/chapters/one.xhtml': '<html><body><p>Chapter text.</p></body></html>',
  }
  writeFileSync(epub, zipSync(Object.fromEntries(Object.entries(files).map(([k,v]) => [k, strToU8(v)]))))
  const item = JSON.parse(run(home, 'items', 'add', epub)).item
  assert.equal(JSON.parse(run(home, 'items', 'toc', item.id)).toc[0].title, 'A named chapter')
})

test('invalid continuation parts are rejected', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'smartbooks-part-'))
  const file = path.join(home, 'book.md')
  writeFileSync(file, '# Test\n\nShort text.')
  const item = JSON.parse(run(home, 'items', 'add', file)).item
  assert.throws(() => run(home, 'items', 'read', item.id, '--page', '1', '--part', '2'))
})
