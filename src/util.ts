import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import type { Dirent } from 'node:fs'
import path from 'node:path'

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

export function arr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : []
}

export function oneLine(s: string): string {
  return s.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim()
}

export function clip(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, Math.max(0, n - 1)).trimEnd() + '…'
}

export function slugify(s: string): string {
  return oneLine(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'item'
}

export function shortHash(s: string, bytes = 8): string {
  return createHash('sha256').update(s).digest('hex').slice(0, bytes * 2)
}

export function contentHash(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function normalizeText(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
}

export function parsePageRange(spec: string | undefined): [number, number] | null {
  if (!spec) return null
  const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(spec.trim())
  if (!m) return null
  const a = Number(m[1])
  const b = m[2] ? Number(m[2]) : a
  if (!Number.isFinite(a) || !Number.isFinite(b) || a < 1 || b < a) return null
  return [a, b]
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

export async function readJson<T>(p: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(p, 'utf8')
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export async function writeJson(p: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(p), { recursive: true })
  const tmp = `${p}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8')
  await fs.rename(tmp, p)
}

export async function walkFiles(
  root: string,
  include: string[],
  exclude: string[],
): Promise<string[]> {
  const out: string[] = []
  const includeRe = include.map(globToRegExp)
  const excludeRe = exclude.map(globToRegExp)
  async function visit(dir: string): Promise<void> {
    let entries: Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      const rel = path.relative(root, full)
      if (excludeRe.some(re => re.test(rel) || re.test(e.name))) continue
      if (e.isDirectory()) {
        await visit(full)
      } else if (e.isFile()) {
        if (includeRe.length === 0 || includeRe.some(re => re.test(rel) || re.test(e.name))) {
          out.push(full)
        }
      }
    }
  }
  const st = await fs.stat(root).catch(() => null)
  if (!st) return out
  if (st.isFile()) {
    if (includeRe.length === 0 || includeRe.some(re => re.test(path.basename(root)))) out.push(root)
    return out
  }
  await visit(root)
  return out
}

function globToRegExp(glob: string): RegExp {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*'
        i++
        if (glob[i + 1] === '/') i++
      } else {
        re += '[^/]*'
      }
    } else if (c === '?') {
      re += '[^/]'
    } else {
      re += escapeRegExp(c)
    }
  }
  return new RegExp(`^${re}$`)
}

export function printError(code: string, error: string, hint: string | null = null): void {
  process.stderr.write(JSON.stringify({ code, error, hint, status: null, upgradeUrl: null }, null, 2) + '\n')
}

export function fail(code: string, error: string, hint: string | null = null): never {
  printError(code, error, hint)
  process.exit(1)
}
