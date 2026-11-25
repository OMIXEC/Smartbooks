# Smartbooks architecture

candle is a local-first CLI plus a coding-agent plugin. The CLI owns the
library, the catalog, manuscripts, the project ledger and the setup. The plugin
tells an agent how to use the CLI and injects the session context that makes the
workflow fire at the right moment.

## Repository layout

```
.claude-plugin/       Claude Code plugin + marketplace manifests, icon
agents/               librarian, item-reader, book-writer, book-enricher (Claude Code)
bin/candle            plugin entrypoint
catalog/books.json    local marketplace listings
codex/                Codex agents, rules and AGENTS.md fragment
docs/                 this architecture, CLI spec, configuration, reverse-engineering
hooks/hooks.json      SessionStart, PostToolUse, SessionEnd
scripts/              install.sh, verify.mjs
skills/candle/        SKILL.md
src/
  cli.ts              command registration
  config.ts           config merge and root resolution
  store.ts            JSON store, project identity, ledger, shelves, access
  types.ts            data contracts
  util.ts             pure helpers
  ingest/             pdf, epub, markdown, html, text adapters
  commands/           items, ms, marketplace, shelf, librarian, access,
                      config, setup, auth, scan, version
  hooks/              session-start, post-tool-use, session-end
```

## Data model

```
ItemMeta  id, title, author, description, sourceType, sourcePath,
          pageCount, addedAt, updatedAt, contentHash, shelves,
          proOnly, tags, kind, manuscriptId?
Page      n, label, text
TocEntry  title, page, level
Manuscript id, itemId, title, description, topics, criteria,
          trigger, autoUpdate, isSystem, status, timestamps
Listing   id, slug, category, proOnly, tags, item{...}, seller,
          subscriberCount, createdAt, file
Shelf     shelf (slug), books[{ id, title, topics?, why? }]
Ledger    project, session, seenSessions, rows[{ domain, outcome,
          book, session, at }]
```

Ids are stable: `c_` + 12 hex from `sha256(absolute source path + content hash)`.
Manuscript ids are `ms_` + 12 hex. Page numbers are 1-based and format
independent.

## Storage

Default home: `~/.candle` (override with `CANDLE_HOME` or `SUMBOOKIT_HOME`).

```
~/.candle/
  config.json                 global config
  library/items.json          ItemMeta[]
  library/pages/<id>.json     { pages, toc }
  manuscripts.json            Manuscript[]
  subscriptions.json          catalog subscriptions
  reads.json                  tool-hook read log
  access.json                 reading sessions
  gaps.json                   librarian report-gap signals
  projects/<hash>/explored.json
  projects/<hash>/active-shelf.json
  agents.json                 installed/disabled agents
  env.sh                      PATH helper
```

All writes are atomic (write a temp file, then rename). There is no database
server and no native module.

## Ingest pipeline

1. `sync`/`scan` walk the configured roots with `include`/`exclude` globs.
2. A catalog listing for the same absolute path supplies title, author and
   description, so PDF metadata like `001-BOOK-pdf` does not become a title.
3. The adapter extracts pages and a TOC:
   - **PDF** — `unpdf` text per page; PDF outline when present; otherwise a
     `Table of Contents` page parser; otherwise conservative heading detection;
     otherwise one entry per 10 pages.
   - **EPUB** — unzip with `fflate`, parse the OPF manifest/spine, convert nav /
     NCX to page-numbered TOC, one spine item = one page.
   - **Markdown** — split on `# ` headings (or `## ` when no H1); TOC from
     headings with page numbers.
   - **HTML** — split on `<h1>`/`<h2>`; strip scripts/styles/tags; decode
     entities.
   - **Text** — form-feed pages or chunks at line boundaries.
4. Text is normalized: CRLF → LF, NBSP → space, trailing spaces removed,
   excessive blank lines collapsed.
5. The item is saved: `ItemMeta` in `items.json`, pages/TOC in `pages/<id>.json`.

## Read path

`items read` resolves each target (`id` or `id:range`), clamps to the page
count, and returns pages. It stops before 20,000 bytes and prints a `Next:`
line. A single page over 20,000 bytes is split into parts; `--part N` selects
one. `items cite` compares whitespace-normalized page text to the quote and
exits non-zero when it does not match.

## CLI

`src/cli.ts` registers one commander command per group. Optional flags are added
by `addCommon` to leaf commands only, so `--json` is not consumed by the parent
group. `optsOf` merges global options with the leaf options. Each command prints
human text or JSON via `emit`.

## Plugin

- `skills/candle/SKILL.md` — the workflow: plan mode, auto mode, explicit
  research, citations, manuscripts, writing, shelf, health.
- `agents/*.md` — Claude Code subagents with frontmatter.
- `hooks/hooks.json` — `SessionStart` runs `dist/hooks/session-start.js`;
  `PostToolUse` runs the read tracker; `SessionEnd` closes the access session.
- `dist/hooks/session-start.js` — reads config, items, manuscripts, shelf and
  ledger; assembles `<candle>` with header, manuscripts, shelf, EXPLORED, plan
  and auto directives; caps at 9,500 bytes and sheds manuscripts then shelf.
- `PostToolUse` parses `candle|sumbookit items read|get` commands, records item
  ids in `reads.json` and the open access session.
- `SessionEnd` completes the open access session.

## Setup

`sbs setup` detects `~/.claude`, `~/.codex`, `~/.gemini`, `~/.cursor`,
`~/.copilot`, `~/.grok`. For each detected agent it copies only candle's files:

- Claude Code: plugin cache + local marketplace + `installed_plugins.json` +
  `known_marketplaces.json` + `settings.json` merge (enabled plugin, marketplace,
  read-only permissions) + `~/.claude/skills/candle`.
- Codex: skill, four TOML agents, rules, AGENTS.md block.
- OpenCode: `~/.config/opencode/skills/candle`, four subagents in
  `~/.config/opencode/agents`, three commands, and an AGENTS.md block.
- OMP: `~/.omp/agent/skills/candle`, four subagents in
  `~/.omp/agent/agents`, and an AGENTS.md block.
- Others: skill (Copilot also gets the instructions block).

It also writes `~/.local/bin/candle` (and a `sumbookit` symlink) and a marked
PATH block in the shell rc. `--disable` removes only those files and settings
keys.

## Trust model

The library is local and the CLI is not a security boundary. Book text and
manuscript titles are **data**, never instructions: the skill and hooks say so
explicitly, and the session hook strips control characters and caps fields. The
project shelf is repo-controlled input and is capped and stripped before it
enters context. The plugin's permissions allow only read/list/cite commands;
writes remain interactive.
