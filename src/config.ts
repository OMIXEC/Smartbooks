import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { SmartbooksConfig, RootConfig } from './types.js'
import { readJson } from './util.js'

export const DEFAULT_CONFIG: SmartbooksConfig = {
  library: {
    roots: [
      { path: 'Ebooks', kind: 'book' },
      { path: 'docs', kind: 'doc' },
      { path: 'README.md', kind: 'doc' },
    ],
  },
  ingest: {
    include: ['**/*.pdf', '**/*.epub', '**/*.md', '**/*.markdown', '**/*.html', '**/*.htm', '**/*.txt'],
    exclude: ['node_modules/**', '.git/**', 'dist/**', '.smartbooks/**', '**/.DS_Store'],
  },
  plugin: {
    agents: ['claude-code', 'codex', 'gemini-cli', 'cursor'],
    planMode: 'always',
    autoMode: true,
    marketAutoAdd: true,
  },
}

export function homeDir(): string {
  return process.env.SMARTBOOKS_HOME || path.join(os.homedir(), '.smartbooks')
}

export async function loadConfig(cwd = process.cwd()): Promise<SmartbooksConfig> {
  const home = homeDir()
  const homeConfig = await readJson<Partial<SmartbooksConfig>>(path.join(home, 'config.json'), {})
  const projectConfig = await readJson<Partial<SmartbooksConfig>>(
    path.join(cwd, 'smartbooks.config.json'),
    {},
  )
  return mergeConfig(DEFAULT_CONFIG, homeConfig, projectConfig)
}

export function mergeConfig(
  base: SmartbooksConfig,
  ...overrides: Partial<SmartbooksConfig>[]
): SmartbooksConfig {
  const out: SmartbooksConfig = {
    library: { roots: [...base.library.roots] },
    ingest: { ...base.ingest },
    plugin: { ...base.plugin },
    model: base.model ? { ...base.model } : undefined,
  }
  for (const o of overrides) {
    if (!o) continue
    if (o.library?.roots) out.library.roots = o.library.roots
    if (o.ingest?.include) out.ingest.include = o.ingest.include
    if (o.ingest?.exclude) out.ingest.exclude = o.ingest.exclude
    if (o.plugin) out.plugin = { ...out.plugin, ...o.plugin }
    if (o.model) out.model = { ...out.model, ...o.model }
  }
  return out
}

export function resolveRoots(config: SmartbooksConfig, cwd = process.cwd()): RootConfig[] {
  return config.library.roots.map(r => ({
    ...r,
    path: path.isAbsolute(r.path) ? r.path : path.resolve(cwd, r.path),
  }))
}

export async function writeProjectConfig(cwd: string, config: SmartbooksConfig): Promise<void> {
  await fs.writeFile(
    path.join(cwd, 'smartbooks.config.json'),
    JSON.stringify(config, null, 2) + '\n',
    'utf8',
  )
}
