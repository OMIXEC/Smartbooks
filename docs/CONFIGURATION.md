# Smartbooks configuration

## Precedence

1. Built-in defaults (`src/config.ts`).
2. Global config: `~/.candle/config.json`.
3. Project config: `./candle.config.json` (nearest to the working directory).

`candle config show` prints the merged result. `candle config set` writes the
project file when it exists, otherwise the global file; use `--global` or
`--project` to force one.

## Configuration shape

```json
{
  "library": {
    "roots": [
      { "path": "../Ebooks", "kind": "book" },
      { "path": "../docs", "kind": "doc" },
      { "path": "../README.md", "kind": "doc" }
    ]
  },
  "ingest": {
    "include": ["**/*.pdf", "**/*.epub", "**/*.md", "**/*.html", "**/*.htm", "**/*.txt"],
    "exclude": ["node_modules/**", ".git/**", "dist/**", ".candle/**"]
  },
  "plugin": {
    "agents": ["claude-code", "codex", "gemini-cli", "cursor"],
    "planMode": "always",
    "autoMode": true,
    "marketAutoAdd": true
  },
  "model": {
    "baseUrl": "http://localhost:11434/v1",
    "model": "qwen2.5",
    "apiKeyEnv": "CANDLE_MODEL_API_KEY"
  }
}
```

- `library.roots[].path` may be absolute or relative to the working directory.
  `kind` is `book`, `doc` or `manuscript`.
- `ingest.include/exclude` are glob patterns matched against the path relative
  to each root and against the file name.
- `plugin.planMode`: `always`, `smart`, `ask` or `off` (the session hook).
- `plugin.autoMode`: emit the AUTO MODE directive when the ledger has rows.
- `plugin.agents`: the agents `setup` should target when detected.
- `model` is reserved for optional model-backed commands; the core never calls
  a model.

## Environment variables

| Variable | Effect |
|---|---|
| `CANDLE_HOME` | Library home (default `~/.candle`) |
| `SUMBOOKIT_HOME` | Alias for `CANDLE_HOME` |
| `CANDLE_MODEL_API_KEY` | Reserved for model-backed commands |
| `CANDLE_MODEL_BASE_URL` | Reserved |
| `CANDLE_MODEL` | Reserved |

## Local catalog

`catalog/books.json` is a local marketplace. Each listing points at a local
file:

```json
{
  "listings": [{
    "id": "l_example",
    "slug": "example-book",
    "category": "PROGRAMMING",
    "proOnly": false,
    "tags": [{ "name": "architecture", "slug": "architecture" }],
    "item": {
      "title": "Example Book",
      "description": "Use when…",
      "author": "Author",
      "sourceType": "markdown",
      "pageCount": 1
    },
    "seller": { "name": "Local library" },
    "subscriberCount": 0,
    "createdAt": "2026-01-01T00:00:00.000Z",
    "file": "../docs/ARCHITECTURE.md"
  }]
}
```

`file` is resolved relative to `catalog/` (or the repo root). `subscribe`
ingests the file and records the subscription in
`~/.candle/subscriptions.json`. If the file is already in the library, it
returns `CONFLICT` with the existing item id.

## Project shelf

`.candle/shelf.json` (or `.candlekeep/shelf.json`) is committed with the
project:

```json
{
  "shelf": "sumbooks",
  "books": [
    {
      "id": "c_e75dd6ad677f",
      "title": "sumbooks — Architecture",
      "topics": ["architecture", "mcp"],
      "why": "The module map and seams"
    }
  ]
}
```

The session hook renders it as a `PROJECT SHELF` block, capped at 1,400 bytes.
`candle shelf add/remove` edits it.

## Library home

```
~/.candle/
  config.json
  library/items.json
  library/pages/<id>.json
  manuscripts.json
  subscriptions.json
  reads.json
  access.json
  gaps.json
  agents.json
  env.sh
  projects/<hash>/explored.json
  projects/<hash>/active-shelf.json
```

Delete `~/.candle` to reset the library. The source files are never modified.

## Agents

`sbs setup` detects `~/.claude`, `~/.codex`, `~/.config/opencode`, `~/.omp`,
`~/.gemini`, `~/.cursor`, `~/.copilot`, `~/.grok`. It writes:

- `~/.local/bin/candle` (and a `sumbookit` symlink)
- `~/.candle/env.sh` and a marked PATH block in the shell rc
- Claude Code: plugin cache, local marketplace, `installed_plugins.json`,
  `known_marketplaces.json`, `settings.json`, `~/.claude/skills/candle`
- Codex: `~/.agents/skills/candle`, `~/.codex/agents/candle-*.toml`,
  `~/.codex/rules/candle.rules`, `~/.codex/AGENTS.md`
- OpenCode: `~/.config/opencode/skills/candle`, `~/.config/opencode/agents/candle-*.md`,
  `~/.config/opencode/commands/candle-*.md`, `~/.config/opencode/AGENTS.md`
- OMP: `~/.omp/agent/skills/candle`, `~/.omp/agent/agents/candle-*.md`,
  `~/.omp/agent/AGENTS.md`
- Gemini/Cursor/Grok: `~/.<agent>/skills/candle/SKILL.md`
- Copilot: skill and `copilot-instructions.md`

`sbs setup --disable <agent>` removes only candle's files and settings keys.
