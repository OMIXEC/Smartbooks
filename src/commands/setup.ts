import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Command } from 'commander'
import { candleHome as smartbooksHome, ensureHome } from '../store.js'
import { exists, nowIso, readJson, writeJson } from '../util.js'
import { addCommon, emit, optsOf } from './common.js'
import { VERSION } from './version.js'

type AgentName =
  | 'claude-code'
  | 'codex'
  | 'opencode'
  | 'omp'
  | 'gemini-cli'
  | 'cursor'
  | 'github-copilot'
  | 'grok'

interface AgentSpec {
  name: AgentName
  displayName: string
  detectionPath: string
  skillsDir: string
  installType: string
}

interface AgentsFile {
  version: number
  disabled: AgentName[]
  installed: Partial<Record<AgentName, { installedAt: string; version: string }>>
}

const AGENTS: AgentSpec[] = [
  {
    name: 'claude-code',
    displayName: 'Claude Code',
    detectionPath: '.claude',
    skillsDir: '.claude/skills/smartbooks',
    installType: 'plugin+skill',
  },
  {
    name: 'codex',
    displayName: 'Codex',
    detectionPath: '.codex',
    skillsDir: '.agents/skills/smartbooks',
    installType: 'codex bundle',
  },
  {
    name: 'opencode',
    displayName: 'OpenCode',
    detectionPath: '.config/opencode',
    skillsDir: '.config/opencode/skills/smartbooks',
    installType: 'skill+agents',
  },
  {
    name: 'omp',
    displayName: 'OMP',
    detectionPath: '.omp',
    skillsDir: '.omp/agent/skills/smartbooks',
    installType: 'skill+agents',
  },
  {
    name: 'gemini-cli',
    displayName: 'Gemini CLI',
    detectionPath: '.gemini',
    skillsDir: '.gemini/skills/smartbooks',
    installType: 'skill',
  },
  {
    name: 'cursor',
    displayName: 'Cursor',
    detectionPath: '.cursor',
    skillsDir: '.cursor/skills/smartbooks',
    installType: 'skill',
  },
  {
    name: 'github-copilot',
    displayName: 'GitHub Copilot',
    detectionPath: '.copilot',
    skillsDir: '.copilot/skills/smartbooks',
    installType: 'skill+bundle',
  },
  {
    name: 'grok',
    displayName: 'Grok',
    detectionPath: '.grok',
    skillsDir: '.grok/skills/smartbooks',
    installType: 'skill',
  },
]

export function registerSetup(program: Command): void {
  addCommon(
    program
      .command('setup')
      .description('Set up smartbooks in your coding agents')
      .option('--status', 'Show live per-agent status')
      .option('--list', 'List every supported agent')
      .option('--enable <agents>', 'Turn smartbooks ON for these agents (comma-separated, or all)')
      .option('--disable <agents>', 'Turn smartbooks OFF for these agents (comma-separated, or all)')
      .action(async cmd => {
        const opts = optsOf(cmd)
        if (opts.status || opts.list) {
          const rows = await statusRows()
          emit(
            cmd,
            rows
              .map(r => `${r.name}\t${r.detected ? 'detected' : '-'}\t${r.installed ? 'installed' : '-'}\t${r.enabled ? 'enabled' : 'disabled'}\t${r.install_type}`)
              .join('\n'),
            { agents: rows },
          )
          return
        }
        if (opts.enable || opts.disable) {
          const names = parseAgents(String(opts.enable || opts.disable))
          const enable = Boolean(opts.enable)
          const result = await setEnabled(names, enable)
          emit(cmd, `${enable ? 'Enabled' : 'Disabled'} ${names.join(', ')}`, result)
          if (result.failed.length) process.exitCode = 1
          return
        }
        const result = await installAll()
        emit(
          cmd,
          `Installed smartbooks ${VERSION}: ${result.installed.join(', ') || 'no agents detected'}.`,
          result,
        )
        if (result.failed.length) process.exitCode = 1
      }),
  )
}

function pluginRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
}

function homePath(...parts: string[]): string {
  return path.join(os.homedir(), ...parts)
}

async function readAgentsFile(): Promise<AgentsFile> {
  return readJson<AgentsFile>(path.join(smartbooksHome(), 'agents.json'), {
    version: 1,
    disabled: [],
    installed: {},
  })
}

async function writeAgentsFile(file: AgentsFile): Promise<void> {
  await ensureHome()
  await writeJson(path.join(smartbooksHome(), 'agents.json'), file)
}

async function detect(spec: AgentSpec): Promise<boolean> {
  return exists(homePath(spec.detectionPath))
}

async function installed(spec: AgentSpec): Promise<boolean> {
  return exists(homePath(spec.skillsDir, 'SKILL.md'))
}

async function statusRows() {
  const file = await readAgentsFile()
  return Promise.all(
    AGENTS.map(async spec => ({
      name: spec.name,
      display_name: spec.displayName,
      detected: await detect(spec),
      installed: await installed(spec),
      enabled: !file.disabled.includes(spec.name),
      install_type: spec.installType,
      skills_dir: homePath(spec.skillsDir),
      detection_path: homePath(spec.detectionPath),
    })),
  )
}

async function installAll() {
  const file = await readAgentsFile()
  const installedNames: string[] = []
  const failed: { agent: string; error: string }[] = []
  for (const spec of AGENTS) {
    if (file.disabled.includes(spec.name)) continue
    if (!(await detect(spec))) continue
    try {
      await installAgent(spec)
      file.installed[spec.name] = { installedAt: nowIso(), version: VERSION }
      installedNames.push(spec.name)
    } catch (e) {
      failed.push({ agent: spec.name, error: e instanceof Error ? e.message : String(e) })
    }
  }
  await writeAgentsFile(file)
  try {
    await installBinary()
  } catch (e) {
    failed.push({ agent: 'binary', error: e instanceof Error ? e.message : String(e) })
  }
  try {
    await installShell()
  } catch (e) {
    failed.push({ agent: 'shell', error: e instanceof Error ? e.message : String(e) })
  }
  return { installed: installedNames, failed }
}

async function setEnabled(names: AgentName[], enable: boolean) {
  const file = await readAgentsFile()
  const installedNames: string[] = []
  const removed: string[] = []
  const notDetected: string[] = []
  const failed: { agent: string; error: string }[] = []
  for (const name of names) {
    const spec = AGENTS.find(a => a.name === name)
    if (!spec) continue
    if (enable) {
      file.disabled = file.disabled.filter(n => n !== name)
      if (await detect(spec)) {
        try {
          await installAgent(spec)
          file.installed[name] = { installedAt: nowIso(), version: VERSION }
          installedNames.push(name)
        } catch (e) {
          failed.push({ agent: name, error: e instanceof Error ? e.message : String(e) })
        }
      } else {
        notDetected.push(name)
      }
    } else {
      if (!file.disabled.includes(name)) file.disabled.push(name)
      try {
        await removeAgent(spec)
        delete file.installed[name]
        removed.push(name)
      } catch (e) {
        failed.push({ agent: name, error: e instanceof Error ? e.message : String(e) })
      }
    }
  }
  await writeAgentsFile(file)
  return { op: enable ? 'enable' : 'disable', installed: installedNames, removed, not_detected: notDetected, failed }
}

async function installAgent(spec: AgentSpec): Promise<void> {
  switch (spec.name) {
    case 'claude-code':
      return installClaudeCode()
    case 'codex':
      return installCodex()
    case 'opencode':
      return installOpencode()
    case 'omp':
      return installOmp()
    case 'github-copilot':
      return installCopilot()
    default:
      return installSkillOnly(spec)
  }
}

async function installSkillOnly(spec: AgentSpec): Promise<void> {
  const dest = homePath(spec.skillsDir)
  await fs.mkdir(dest, { recursive: true })
  await fs.copyFile(path.join(pluginRoot(), 'skills', 'smartbooks', 'SKILL.md'), path.join(dest, 'SKILL.md'))
}

async function installClaudeCode(): Promise<void> {
  const root = pluginRoot()
  const version = VERSION
  const cacheDir = homePath('.claude', 'plugins', 'cache', 'smartbooks', 'smartbooks', version)
  const marketDir = homePath('.claude', 'plugins', 'marketplaces', 'smartbooks')
  await copyPlugin(root, cacheDir)
  await fs.rm(marketDir, { recursive: true, force: true })
  await fs.mkdir(path.join(marketDir, '.claude-plugin'), { recursive: true })
  await copyPlugin(root, path.join(marketDir, 'plugins', 'smartbooks'))
  await writeJson(path.join(marketDir, '.claude-plugin', 'marketplace.json'), {
    metadata: { description: 'Access your local smartbooks library from Claude Code', version },
    name: 'smartbooks',
    owner: { name: 'smartbooks', email: 'local@smartbooks' },
    plugins: [{ name: 'smartbooks', description: 'Local books and docs with page citations', source: './plugins/smartbooks' }],
  })

  const pluginsFile = homePath('.claude', 'plugins', 'installed_plugins.json')
  const plugins = await readJson<Record<string, unknown>>(pluginsFile, { plugins: {}, version: 2 })
  const map = (plugins.plugins ?? {}) as Record<string, unknown>
  map['smartbooks@smartbooks'] = [
    {
      gitCommitSha: createHash('sha256').update(`smartbooks:${version}`).digest('hex'),
      installPath: cacheDir,
      installedAt: nowIso(),
      lastUpdated: nowIso(),
      scope: 'user',
      version,
    },
  ]
  plugins.plugins = map
  plugins.version = 2
  await writeJson(pluginsFile, plugins)

  const knownFile = homePath('.claude', 'plugins', 'known_marketplaces.json')
  const known = await readJson<Record<string, unknown>>(knownFile, {})
  known.smartbooks = {
    installLocation: marketDir,
    lastUpdated: nowIso(),
    source: { path: marketDir, source: 'directory' },
  }
  await writeJson(knownFile, known)

  const settingsFile = homePath('.claude', 'settings.json')
  const settings = await readJson<Record<string, unknown>>(settingsFile, {})
  const enabled = (settings.enabledPlugins ?? {}) as Record<string, boolean>
  enabled['smartbooks@smartbooks'] = true
  settings.enabledPlugins = enabled
  const extra = (settings.extraKnownMarketplaces ?? {}) as Record<string, unknown>
  extra.smartbooks = { source: { path: marketDir, source: 'directory' } }
  settings.extraKnownMarketplaces = extra
  const permissions = (settings.permissions ?? {}) as Record<string, unknown>
  const allow = Array.isArray(permissions.allow) ? (permissions.allow as string[]) : []
  for (const cmd of [
    'Bash(sbs items list:*)',
    'Bash(sbs items toc:*)',
    'Bash(sbs items read:*)',
    'Bash(sbs items get:*)',
    'Bash(sbs items search:*)',
    'Bash(sbs items cite:*)',
    'Bash(sbs ms list:*)',
    'Bash(sbs ms show:*)',
    'Bash(sbs marketplace browse:*)',
    'Bash(sbs marketplace subscribe:*)',
    'Bash(sbs librarian ledger:*)',
    'Bash(sbs librarian report-gap:*)',
    'Bash(sbs access:*)',
    'Bash(sbs auth whoami:*)',
    'Bash(sbs --help:*)',
    'Bash(sumbookit items list:*)',
    'Bash(sumbookit items toc:*)',
    'Bash(sumbookit items read:*)',
    'Bash(sumbookit items get:*)',
  ]) {
    if (!allow.includes(cmd)) allow.push(cmd)
  }
  permissions.allow = allow
  settings.permissions = permissions
  await writeJson(settingsFile, settings)

  const skillDir = homePath('.claude', 'skills', 'smartbooks')
  await fs.mkdir(skillDir, { recursive: true })
  await fs.copyFile(path.join(root, 'skills', 'smartbooks', 'SKILL.md'), path.join(skillDir, 'SKILL.md'))
}

async function installCodex(): Promise<void> {
  const root = pluginRoot()
  const skillDir = homePath('.agents', 'skills', 'smartbooks')
  await fs.mkdir(skillDir, { recursive: true })
  await fs.copyFile(path.join(root, 'skills', 'smartbooks', 'SKILL.md'), path.join(skillDir, 'SKILL.md'))

  const agentsDir = homePath('.codex', 'agents')
  await fs.mkdir(agentsDir, { recursive: true })
  for (const f of await fs.readdir(path.join(root, 'codex', 'agents'))) {
    await fs.copyFile(path.join(root, 'codex', 'agents', f), path.join(agentsDir, f))
  }
  const rulesDir = homePath('.codex', 'rules')
  await fs.mkdir(rulesDir, { recursive: true })
  await fs.copyFile(path.join(root, 'codex', 'rules', 'smartbooks.rules'), path.join(rulesDir, 'smartbooks.rules'))

  const agentsFile = homePath('.codex', 'AGENTS.md')
  const fragment = await fs.readFile(path.join(root, 'codex', 'AGENTS.fragment.md'), 'utf8')
  await upsertBlock(agentsFile, 'smartbooks', fragment)
}

async function installCopilot(): Promise<void> {
  const root = pluginRoot()
  const skillDir = homePath('.copilot', 'skills', 'smartbooks')
  await fs.mkdir(skillDir, { recursive: true })
  await fs.copyFile(path.join(root, 'skills', 'smartbooks', 'SKILL.md'), path.join(skillDir, 'SKILL.md'))
  const fragment = await fs.readFile(path.join(root, 'codex', 'AGENTS.fragment.md'), 'utf8')
  await upsertBlock(homePath('.copilot', 'copilot-instructions.md'), 'smartbooks', fragment)
}

interface HarnessAgentProfile {
  tools: string
  readOnly: boolean
}

const HARNESS_AGENTS: Record<string, HarnessAgentProfile> = {
  librarian: { tools: 'read, grep, glob, bash', readOnly: true },
  'item-reader': { tools: 'read, grep, glob, bash', readOnly: true },
  'book-writer': { tools: 'read, grep, glob, bash, write, edit', readOnly: false },
  'book-enricher': { tools: 'read, grep, glob, bash', readOnly: true },
}

async function copySkillTo(relativeDir: string): Promise<void> {
  const dest = homePath(relativeDir)
  await fs.mkdir(dest, { recursive: true })
  await fs.copyFile(path.join(pluginRoot(), 'skills', 'smartbooks', 'SKILL.md'), path.join(dest, 'SKILL.md'))
}

async function readAgentSource(file: string): Promise<{ description: string; body: string }> {
  const raw = await fs.readFile(path.join(pluginRoot(), 'agents', file), 'utf8')
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw)
  if (!match) return { description: '', body: raw }
  const frontmatter = match[1] ?? ''
  const descLine = frontmatter.split('\n').find(line => /^description:\s*/.test(line))
  return {
    description: descLine ? descLine.replace(/^description:\s*/, '').trim() : '',
    body: match[2] ?? '',
  }
}

async function installOmp(): Promise<void> {
  const root = pluginRoot()
  await copySkillTo('.omp/agent/skills/smartbooks')

  const agentsDir = homePath('.omp', 'agent', 'agents')
  await fs.mkdir(agentsDir, { recursive: true })
  for (const [file, profile] of Object.entries(HARNESS_AGENTS)) {
    const { description, body } = await readAgentSource(`${file}.md`)
    const name = `smartbooks-${file}`
    const content = [
      '---',
      `name: ${name}`,
      `description: ${JSON.stringify(description)}`,
      `tools: ${profile.tools}`,
      '---',
      body.trim(),
      '',
    ].join('\n')
    await fs.writeFile(path.join(agentsDir, `${name}.md`), content, 'utf8')
  }

  const fragment = await fs.readFile(path.join(root, 'context', 'smartbooks.md'), 'utf8')
  await upsertMarkdownBlock(homePath('.omp', 'agent', 'AGENTS.md'), 'smartbooks', fragment)
}

async function installOpencode(): Promise<void> {
  const root = pluginRoot()
  await copySkillTo('.config/opencode/skills/smartbooks')

  const agentsDir = homePath('.config', 'opencode', 'agents')
  await fs.mkdir(agentsDir, { recursive: true })
  for (const [file, profile] of Object.entries(HARNESS_AGENTS)) {
    const { description, body } = await readAgentSource(`${file}.md`)
    const name = `smartbooks-${file}`
    const permissions = [
      'permissions:',
      '  - action: edit',
      '    resource: "*"',
      `    effect: ${profile.readOnly ? 'deny' : 'allow'}`,
      '  - action: shell',
      '    resource: "sbs *"',
      '    effect: allow',
      '  - action: shell',
      '    resource: "sumbookit *"',
      '    effect: allow',
      '  - action: skill',
      '    resource: "smartbooks"',
      '    effect: allow',
    ].join('\n')
    const content = [
      '---',
      `description: ${JSON.stringify(description)}`,
      'mode: subagent',
      permissions,
      '---',
      body.trim(),
      '',
    ].join('\n')
    await fs.writeFile(path.join(agentsDir, `${name}.md`), content, 'utf8')
  }

  const commandsDir = homePath('.config', 'opencode', 'commands')
  await fs.mkdir(commandsDir, { recursive: true })
  for (const file of ['smartbooks-browse.md', 'smartbooks-research.md', 'smartbooks-write.md']) {
    await fs.copyFile(path.join(root, 'opencode', 'commands', file), path.join(commandsDir, file))
  }

  const fragment = await fs.readFile(path.join(root, 'context', 'smartbooks.md'), 'utf8')
  await upsertMarkdownBlock(homePath('.config', 'opencode', 'AGENTS.md'), 'smartbooks', fragment)
}

async function installBinary(): Promise<void> {
  const root = pluginRoot()
  const binDir = homePath('.local', 'bin')
  await fs.mkdir(binDir, { recursive: true })
  const wrapper = `#!/bin/sh\nexec node ${JSON.stringify(path.join(root, 'dist', 'cli.js'))} "$@"\n`
  const target = path.join(binDir, 'sbs')
  await fs.writeFile(target, wrapper, { mode: 0o755 })
  for (const name of ['candle', 'candlekeep', 'sumbookit']) {
    const alias = path.join(binDir, name)
    try {
      await fs.symlink('sbs', alias)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
}

async function installShell(): Promise<void> {
  const envFile = path.join(smartbooksHome(), 'env.sh')
  await ensureHome()
  await fs.writeFile(envFile, 'export PATH="$HOME/.local/bin:$PATH"\n', 'utf8')
  const shell = path.basename(process.env.SHELL || '')
  if (shell === 'fish') {
    const fishFile = homePath('.config', 'fish', 'conf.d', 'smartbooks.fish')
    await fs.mkdir(path.dirname(fishFile), { recursive: true })
    await fs.writeFile(fishFile, 'set -gx PATH $HOME/.local/bin $PATH\n', 'utf8')
    return
  }
  const rc =
    shell === 'zsh'
      ? homePath('.zshrc')
      : shell === 'bash'
        ? process.platform === 'darwin'
          ? homePath('.bash_profile')
          : homePath('.bashrc')
        : homePath('.profile')
  await upsertBlock(rc, 'smartbooks', 'export PATH="$HOME/.local/bin:$PATH"')
}

async function upsertBlock(file: string, name: string, body: string): Promise<void> {
  const start = `# >>> ${name} >>>`
  const end = `# <<< ${name} <<<`
  let current = ''
  try {
    current = await fs.readFile(file, 'utf8')
  } catch {
    current = ''
  }
  const re = new RegExp(`${escapeRe(start)}[\\s\\S]*?${escapeRe(end)}\\n?`, 'g')
  const next = current.replace(re, '').trimEnd()
  const block = `${start}\n${body.trimEnd()}\n${end}\n`
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, `${next ? next + '\n\n' : ''}${block}`, 'utf8')
}

async function upsertMarkdownBlock(file: string, name: string, body: string): Promise<void> {
  const start = `<!-- ${name}:start -->`
  const end = `<!-- ${name}:end -->`
  let current = ''
  try {
    current = await fs.readFile(file, 'utf8')
  } catch {
    current = ''
  }
  const re = new RegExp(`${escapeRe(start)}[\\s\\S]*?${escapeRe(end)}\\n?`, 'g')
  const next = current.replace(re, '').trimEnd()
  const block = `${start}\n${body.trimEnd()}\n${end}\n`
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, `${next ? next + '\n\n' : ''}${block}`, 'utf8')
}

async function removeAgent(spec: AgentSpec): Promise<void> {
  if (spec.name === 'claude-code') {
    await fs.rm(homePath('.claude', 'plugins', 'cache', 'smartbooks'), { recursive: true, force: true })
    await fs.rm(homePath('.claude', 'plugins', 'marketplaces', 'smartbooks'), { recursive: true, force: true })
    await fs.rm(homePath('.claude', 'skills', 'smartbooks'), { recursive: true, force: true })
    const settingsFile = homePath('.claude', 'settings.json')
    const settings = await readJson<Record<string, unknown>>(settingsFile, {})
    const enabled = (settings.enabledPlugins ?? {}) as Record<string, boolean>
    delete enabled['smartbooks@smartbooks']
    const extra = (settings.extraKnownMarketplaces ?? {}) as Record<string, unknown>
    delete extra.smartbooks
    await writeJson(settingsFile, settings)
    const pluginsFile = homePath('.claude', 'plugins', 'installed_plugins.json')
    const plugins = await readJson<Record<string, unknown>>(pluginsFile, { plugins: {}, version: 2 })
    const map = (plugins.plugins ?? {}) as Record<string, unknown>
    delete map['smartbooks@smartbooks']
    await writeJson(pluginsFile, plugins)
    return
  }
  if (spec.name === 'codex') {
    await fs.rm(homePath('.agents', 'skills', 'smartbooks'), { recursive: true, force: true })
    for (const f of await fs.readdir(homePath('.codex', 'agents')).catch(() => [])) {
      if (f.startsWith('smartbooks-')) await fs.rm(path.join(homePath('.codex', 'agents'), f), { force: true })
    }
    await fs.rm(homePath('.codex', 'rules', 'smartbooks.rules'), { force: true })
    await removeBlock(homePath('.codex', 'AGENTS.md'), 'smartbooks')
    return
  }
  if (spec.name === 'opencode') {
    await fs.rm(homePath('.config', 'opencode', 'skills', 'smartbooks'), { recursive: true, force: true })
    for (const f of await fs.readdir(homePath('.config', 'opencode', 'agents')).catch(() => [])) {
      if (f.startsWith('smartbooks-')) await fs.rm(path.join(homePath('.config', 'opencode', 'agents'), f), { force: true })
    }
    for (const f of await fs.readdir(homePath('.config', 'opencode', 'commands')).catch(() => [])) {
      if (f.startsWith('smartbooks-')) await fs.rm(path.join(homePath('.config', 'opencode', 'commands'), f), { force: true })
    }
    await removeMarkdownBlock(homePath('.config', 'opencode', 'AGENTS.md'), 'smartbooks')
    return
  }
  if (spec.name === 'omp') {
    await fs.rm(homePath('.omp', 'agent', 'skills', 'smartbooks'), { recursive: true, force: true })
    for (const f of await fs.readdir(homePath('.omp', 'agent', 'agents')).catch(() => [])) {
      if (f.startsWith('smartbooks-')) await fs.rm(path.join(homePath('.omp', 'agent', 'agents'), f), { force: true })
    }
    await removeMarkdownBlock(homePath('.omp', 'agent', 'AGENTS.md'), 'smartbooks')
    return
  }
  if (spec.name === 'github-copilot') {
    await fs.rm(homePath('.copilot', 'skills', 'smartbooks'), { recursive: true, force: true })
    await removeBlock(homePath('.copilot', 'copilot-instructions.md'), 'smartbooks')
    return
  }
  await fs.rm(homePath(spec.skillsDir), { recursive: true, force: true })
}

async function removeBlock(file: string, name: string): Promise<void> {
  const start = `# >>> ${name} >>>`
  const end = `# <<< ${name} <<<`
  try {
    const current = await fs.readFile(file, 'utf8')
    const re = new RegExp(`${escapeRe(start)}[\\s\\S]*?${escapeRe(end)}\\n?`, 'g')
    await fs.writeFile(file, current.replace(re, '').trimEnd() + '\n', 'utf8')
  } catch {
    // nothing to remove
  }
}

async function removeMarkdownBlock(file: string, name: string): Promise<void> {
  const start = `<!-- ${name}:start -->`
  const end = `<!-- ${name}:end -->`
  try {
    const current = await fs.readFile(file, 'utf8')
    const re = new RegExp(`${escapeRe(start)}[\\s\\S]*?${escapeRe(end)}\\n?`, 'g')
    await fs.writeFile(file, current.replace(re, '').trimEnd() + '\n', 'utf8')
  } catch {
    // nothing to remove
  }
}

async function copyPlugin(src: string, dest: string): Promise<void> {
  const skip: Record<string, true> = {
    node_modules: true,
    src: true,
    test: true,
    scripts: true,
    '.git': true,
    '.smartbooks': true,
    dist: true,
    '.DS_Store': true,
  }
  await fs.rm(dest, { recursive: true, force: true })
  await fs.mkdir(dest, { recursive: true })
  const entries = await fs.readdir(src, { withFileTypes: true })
  for (const e of entries) {
    if (skip[e.name] || e.name.endsWith('.tmp')) continue
    const from = path.join(src, e.name)
    const to = path.join(dest, e.name)
    await fs.cp(from, to, { recursive: true })
  }
  // Hooks and the CLI run from dist; copy it after the source tree.
  const dist = path.join(src, 'dist')
  if (await exists(dist)) await fs.cp(dist, path.join(dest, 'dist'), { recursive: true })
}

function parseAgents(value: string): AgentName[] {
  const all = AGENTS.map(a => a.name)
  if (value.trim() === 'all') return all
  return value
    .split(',')
    .map(s => s.trim())
    .filter((s): s is AgentName => (all as string[]).includes(s))
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
