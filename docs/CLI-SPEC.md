# Smartbooks CLI spec

The primary binary is `sbs`; `candle`, `candlekeep` and `sumbookit` are aliases. All commands
accept `--json`, `--no-session` and `--no-update-check` (the latter two are
compatibility no-ops).

## Global behavior

- Human output is line-oriented; JSON output is a single JSON document.
- Errors in JSON mode are `{ code, error, hint, status, upgradeUrl }`.
- Exit code `0` on success, `1` on a handled error (not found, conflict,
  page too large, unverified quote), `2` for a commander usage error.
- `--json` may be placed before or after the subcommand.

## Reading

### `items list [--json]`

Human: `<id>  <title> (<n> pages, <type>)`.

JSON: `{ items: ItemMeta[] }`, newest first.

### `items toc <id> [--json]`

Human: indented `title (p. N)`.

JSON: `{ id, title, toc: [{ title, page, level }] }`.

### `items read <ids...> [--pages <range>] [--page <n>] [--part <n>] [--json]`

`<ids...>` accepts `id`, `id:range`, and comma-separated combinations, e.g.
`c_abc:7-9,c_def:1-2`. `--pages 3-7` applies to targets without an inline
range. Omitting both reads the first 10 pages.

The reader stops before 20,000 bytes and prints:

```
Stopped after page 9 to stay under 20,000 bytes. Next: sbs items read <id> --pages 10-12
```

A page over 20,000 bytes is split:

```
── Page 15 (part 1 of 3) ──
...
Page 15 continues (part 2 of 3). Next: sbs items read <id> --pages 15 --part 2
```

JSON for one target:

```json
{ "id": "...", "title": "...", "version": "ISO", "pages": [{ "n": 1, "text": "..." }], "next": null }
```

For several targets: `{ "items": [ ... ] }`.

### `items get <id>[:page] [--pages] [--page] [--part] [--json]`

Alias for `items read` with a single target.

### `items cite <id>:<page> --quote "<text>" [--json]`

Whitespace-normalized exact match against the page. JSON:
`{ verified, id, page, quote, title }`. Exit `1` when not verified.

### `items search <query> [--book <id>] [--limit <n>] [--json]`

JSON: `{ query, hits: [{ id, title, page, snippet }] }`.

### `items status [--json]`

JSON: `{ items, pages, byType }`.

## Authoring

| Command | Notes |
|---|---|
| `items add <file> [--title] [--author] [--kind]` | PDF/EPUB/MD/HTML/TXT; re-add updates the same item |
| `items import <file> [--title] [--author]` | Markdown book import |
| `items create <title> [--file] [--content] [--kind]` | Create a Markdown item |
| `items put <id>[:page] [--file] [--content] [--expect-version]` | Replace a page or whole document |
| `items append <id> [--file] [--content] [--prepend]` | Append/prepend content |
| `items remove <id> [--yes]` | Remove from the library |
| `items enrich <id> [--title] [--author] [--description]` | Metadata only |
| `items reprocess <id>` | Re-ingest from the source file |

`items put` refuses a page over 20,000 bytes with `PAGE_TOO_LARGE` and refuses a
stale `--expect-version` with `VERSION_CONFLICT`. The `Version:` line from a read
is the expected value.

## Manuscripts

| Command | Notes |
|---|---|
| `ms list [--active] [--json]` | Rows with `[ms:]`, `[book:]`, `[wiki]`, `[auto-update]` |
| `ms show <id> [--json]` | Full criteria and the book item |
| `ms create <title> [--topics] [--criteria] [--trigger] [--auto-update] [--wiki] [--content]` | Creates a manuscript item and record |
| `ms update <id> [--title] [--topics] [--criteria] [--trigger] [--auto-update|--no-auto-update] [--pause|--resume|--archive]` | |
| `ms archive <id>` / `ms remove <id>` | |

`ms show` accepts either the manuscript id or its `itemId`.

## Catalog

| Command | Notes |
|---|---|
| `marketplace browse [--limit] [--sort newest\|popular\|az] [--tag] [--compact] [--json]` | Local `catalog/books.json` |
| `marketplace subscribe <listing-id> [--json]` | Ingests the listing file; returns `{ code, itemId, title }`; `CONFLICT` when already present |
| `marketplace unsubscribe <listing-id>` | Removes the subscribed item |
| `marketplace publish <id> [--submit]` | Local readiness checks |
| `marketplace status <id>` | Subscription/item state |

## Shelf

| Command | Notes |
|---|---|
| `shelf init [--name]` | Writes `./.candle/shelf.json` at the project root |
| `shelf current [--local] [--json]` | `{ slug, source }` |
| `shelf show [slug] [--json]` | Shelf and books |
| `shelf use <slug>` | Sets the local active pointer |
| `shelf add <id> [--topics] [--why]` / `shelf remove <id>` | |
| `shelf create <name>` / `shelf delete <slug>` / `shelf sync` | |

The project root is the nearest ancestor holding `.candle/shelf.json`,
`.candlekeep/shelf.json` or `.git`, never `$HOME`.

## Librarian

| Command | Notes |
|---|---|
| `librarian ledger show [--render]` | JSON ledger or the rendered `EXPLORED (…)` block |
| `librarian ledger tick --session <id> [--render]` | Idempotent session counter |
| `librarian ledger record --domain <d> --outcome hit\|miss\|declined [--book <id>]` | |
| `librarian report-gap --intent --category --subcategory [--suggested-title] [--suggested-author] [--domain]` | Appends to `~/.candle/gaps.json`; prints `Gap reported.` |

## Sessions

| Command | Notes |
|---|---|
| `access start [--intent]` | Opens a session |
| `access complete` | Closes the current session |
| `access value` | Sessions, read count, top books |

## Setup and configuration

| Command | Notes |
|---|---|
| `setup` | Installs into every detected agent |
| `setup --status` / `setup --list [--json]` | Detection/install state |
| `setup --enable <agents|all>` / `--disable <agents|all>` | |
| `config show [--json]` | Effective merged config |
| `config get <key>` | Dot path |
| `config set <key> <value> [--project|--global]` | Defaults to the project config when present |
| `auth whoami [--json]` | Local identity |
| `auth login` / `auth logout` | No-op messages |
| `scan [--json]` | Files under the roots and whether they are ingested |
| `sync [--prune] [--json]` | Ingest/update; `--prune` removes missing sources |
| `version` / `welcome` / `tour` | |

## Error codes

| Code | Meaning |
|---|---|
| `NOT_FOUND` | Item, manuscript or listing id not found |
| `USAGE` | Missing or invalid argument |
| `VERSION_CONFLICT` | `--expect-version` does not match |
| `PAGE_TOO_LARGE` | A page exceeds 20,000 bytes |
| `NO_SOURCE` | `reprocess` on an item with no source file |
| `NO_SHELF` | No project shelf manifest |
| `CONFLICT` | Marketplace listing already in the library |
| `LISTING_FILE_MISSING` | Catalog listing points at a missing file |
| `NOT_AUTHENTICATED` | Reserved; local mode never emits it |
