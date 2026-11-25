export type SourceType = 'pdf' | 'epub' | 'markdown' | 'html' | 'text'
export type ItemKind = 'book' | 'doc' | 'manuscript'

export interface TocEntry {
  title: string
  page: number
  level: number
}

export interface Page {
  n: number
  label: string
  text: string
}

export interface ItemMeta {
  id: string
  title: string
  author: string | null
  description: string
  sourceType: SourceType
  sourcePath: string | null
  pageCount: number
  addedAt: string
  updatedAt: string
  contentHash: string
  shelves: string[]
  proOnly: boolean
  tags: string[]
  kind: ItemKind
  manuscriptId?: string
}

export interface Item extends ItemMeta {
  pages: Page[]
  toc: TocEntry[]
}

export interface Manuscript {
  id: string
  itemId: string
  title: string
  description: string
  topics: string[]
  criteria: string[]
  trigger: string
  autoUpdate: boolean
  isSystem: boolean
  status: 'active' | 'paused' | 'archived'
  createdAt: string
  updatedAt: string
}

export interface Listing {
  id: string
  slug: string
  category: string
  proOnly: boolean
  tags: { name: string; slug: string }[]
  item: {
    title: string
    description: string
    author: string | null
    sourceType: SourceType
    pageCount: number
  }
  seller: { name: string }
  subscriberCount: number
  createdAt: string
  file: string
}

export interface ShelfManifest {
  shelf: string
  books: { id: string; title: string; topics?: string[]; why?: string }[]
}

export interface LedgerRow {
  domain: string
  outcome: 'hit' | 'miss' | 'declined'
  book: string | null
  session: number
  at: string
}

export interface LedgerFile {
  project: string
  session: number
  seenSessions: string[]
  rows: LedgerRow[]
}

export interface AccessSession {
  id: string
  intent: string
  startedAt: string
  completedAt?: string
  reads: { id: string; title: string; at: string }[]
}

export interface AccessFile {
  sessions: AccessSession[]
}

export interface RootConfig {
  path: string
  kind?: ItemKind
  title?: string
}

export interface SmartbooksConfig {
  library: {
    roots: RootConfig[]
  }
  ingest: {
    include: string[]
    exclude: string[]
  }
  plugin: {
    agents: string[]
    planMode: 'always' | 'smart' | 'ask' | 'off'
    autoMode: boolean
    marketAutoAdd: boolean
  }
  model?: {
    baseUrl?: string
    model?: string
    apiKeyEnv?: string
  }
}

export interface WhoAmI {
  email: string
  name: string
  tier: 'LOCAL'
  monthlyReadLimit: null
  monthlyReadsUsed: number
  itemLimit: number | null
  itemCount: number
  trial: { active: false }
}

export interface SmartbooksError {
  code: string
  error: string
  hint: string | null
  status: number | null
  upgradeUrl: string | null
}
