import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Command } from 'commander'
import { loadConfig, homeDir } from '../config.js'
import type { CandleConfig } from '../types.js'
import { readJson, writeJson } from '../util.js'
import { addCommon, emit, optsOf } from './common.js'

export function registerConfig(program: Command): void {
  const config = program.command('config').description('View or change your candle configuration')

  addCommon(
    config
      .command('show')
      .description('Show your effective configuration')
      .action(async cmd => {
        const cfg = await loadConfig()
        emit(cmd, JSON.stringify(cfg, null, 2), cfg)
      }),
  )

  addCommon(
    config
      .command('get <key>')
      .description('Get a single config value (e.g. plugin.planMode)')
      .action(async (key: string, cmd: Command) => {
        const cfg = await loadConfig()
        const value = getPath(cfg, key)
        emit(cmd, value === undefined ? '' : JSON.stringify(value), { key, value: value ?? null })
      }),
  )

  addCommon(
    config
      .command('set <key> <value>')
      .description('Set a config value')
      .option('--project', 'Write to ./candle.config.json')
      .option('--global', 'Write to ~/.candle/config.json')
      .action(async (key: string, value: string, cmd: Command) => {
        const projectFile = path.join(process.cwd(), 'candle.config.json')
        const hasProject = await fs.access(projectFile).then(() => true).catch(() => false)
        const target = optsOf(cmd).global
          ? path.join(homeDir(), 'config.json')
          : optsOf(cmd).project || hasProject
            ? projectFile
            : path.join(homeDir(), 'config.json')
        const current = await readJson<Partial<CandleConfig>>(target, {})
        setPath(current as Record<string, unknown>, key, parseValue(value))
        await fs.mkdir(path.dirname(target), { recursive: true })
        await writeJson(target, current)
        emit(cmd, `Set ${key} in ${target}`, { key, value: parseValue(value), path: target })
      }),
  )
}

function getPath(obj: unknown, key: string): unknown {
  let cur = obj
  for (const part of key.split('.')) {
    if (typeof cur !== 'object' || cur === null) return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

function setPath(obj: Record<string, unknown>, key: string, value: unknown): void {
  const parts = key.split('.')
  let cur = obj
  for (const part of parts.slice(0, -1)) {
    const next = cur[part]
    if (typeof next !== 'object' || next === null || Array.isArray(next)) cur[part] = {}
    cur = cur[part] as Record<string, unknown>
  }
  cur[parts.at(-1)!] = value
}

function parseValue(value: string): unknown {
  if (value === 'true') return true
  if (value === 'false') return false
  if (value === 'null') return null
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value)
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}
