# Smartbooks

Smartbooks is a local-first library for coding agents. It turns your books and documents into a searchable library with tables of contents, bounded page reads, and verifiable citations. Its CLI is called **`sbs`**.

Use it to give an agent access to specific documents during a task, inspect the passages it reads, and check a quotation against its source. The library and source files stay on your machine when using the local CLI.

## What it does

- Ingests EPUB, PDF, Markdown, HTML, and plain text.
- Builds item records, pages, and a table of contents from each source.
- Lists and searches the library, reads selected page ranges, and verifies exact quotations.
- Provides project shelves, a librarian ledger, manuscripts, and local catalog commands.
- Installs agent integrations for Claude Code, Codex, OpenCode, OMP, Gemini CLI, Cursor, GitHub Copilot, and Grok when their local directories are detected.
- Produces JSON output for scripts and agent tools.

Smartbooks is an early local release. EPUB pages correspond to extracted spine items, so their numbers can differ from a printed edition. PDF extraction depends on the source text and may need OCR for scanned pages. Check extraction and citations against the original before relying on them.

## Requirements

- Node.js **22.12 or later** and npm.
- A local directory containing books or documents you are allowed to process.
- For agent integration, an installed and detected supported agent.

## Install

```sh
git clone https://github.com/OMIXEC/Smartbooks.git
cd Smartbooks
npm ci
npm run build
node dist/cli.js setup
```

Setup installs `sbs` under `~/.local/bin` and configures detected agents. Open a new terminal if that directory is not on your PATH.

```sh
sbs version
sbs setup --status
sbs --help
```

Setup keeps existing `candle`, `candlekeep`, and `sumbookit` executables or links in place. Where those names are available, it creates compatibility aliases. The installed wrapper points to this checkout, so keep the checkout in its installed location.

To enable or disable a specific agent integration:

```sh
sbs setup --list
sbs setup --enable codex
sbs setup --disable codex
```

## Add and read a book

```sh
sbs items add /path/to/book.epub
sbs items list
sbs items toc BOOK_ID
sbs items read BOOK_ID --pages 1-2
```

Replace `BOOK_ID` with the ID returned by `items add` or `items list`. An item can also be added from a PDF, Markdown, HTML, or text file.

```sh
sbs items search "a phrase" --book BOOK_ID
sbs items cite BOOK_ID:1 --quote "exact words from the page"
sbs items status
```

Citation verification uses the extracted page text. Inspect the relevant page first, especially for PDFs and EPUBs. Reads stop at a 20,000-byte output boundary and provide continuation information when more text remains.

For automation, add `--json`. Use `--no-session` when a read should not be recorded in the current research session.

```sh
sbs items toc BOOK_ID --json --no-session
sbs items read BOOK_ID --pages 1-2 --json --no-session
```

## Configure a library

By default, Smartbooks uses `~/.candle` so existing Candle items and their IDs remain available. Set `SMARTBOOKS_HOME` to use another library directory. Resolution order is `SMARTBOOKS_HOME`, `CANDLE_HOME`, `SUMBOOKIT_HOME`, then `~/.candle`.

To scan a folder, create `smartbooks.config.json` in your working directory:

```json
{
  "library": {
    "roots": [
      { "path": "./books", "kind": "book" },
      { "path": "./docs", "kind": "doc" }
    ]
  }
}
```

Relative paths resolve from the working directory. Review discovered files before ingesting them:

```sh
sbs config show
sbs scan
sbs sync
```

`sync` processes files under the configured roots and reports failures. `sync --prune` also removes library items whose source files are missing. Review the scan and your backup before using it.

Configuration merges built-in defaults, the library home's `config.json`, `candle.config.json`, and then `smartbooks.config.json`. The legacy project config remains supported. Currently, `sbs config set --project` writes `candle.config.json`, so values in an existing `smartbooks.config.json` can override it.

## Shelves and manuscripts

A shelf associates selected items with a project and can record the topics they cover.

```sh
sbs shelf init --name "My project"
sbs shelf add BOOK_ID --topics "architecture,security" --why "Project reference"
sbs shelf show
```

The project shelf uses `.candle/shelf.json` for compatibility. Review its contents before committing it, particularly titles and item IDs.

Manuscript commands manage locally stored writing projects:

```sh
sbs ms list
sbs ms show MANUSCRIPT_ID
```

See [the CLI reference](docs/CLI-SPEC.md) or run `sbs COMMAND --help` for editing, version checks, the librarian ledger, and catalog commands. The shipped local catalog starts empty; add only material you have permission to use.

## Existing Candle libraries

Smartbooks reads the existing library location and understands the legacy configuration and command names. Installation does not migrate or delete library content. Back up your library directory before changing locations or performing bulk operations.

To use a separate test library without changing the existing one:

```sh
export SMARTBOOKS_HOME="$HOME/smartbooks-test-library"
sbs items list
```

Clear the variable to return to the normal resolution order.

## Privacy and integration

The CLI stores extracted content and metadata in the selected local library directory. Protect that directory and its backups as you would the original books. Smartbooks does not provide a multi-user authentication or authorization boundary. A hosted integration must enforce identity, book entitlements, filesystem isolation, resource limits, and rights before returning content.

The separate Sumbooks integration is being developed as **Isumbooks**. It is not required to use this standalone plugin.

## Development

```sh
npm ci
npm run typecheck
npm run build
npm test
```

The package contains an installer, agent integrations, and source adapters. Tests use generated sample documents and temporary library homes.

## Origin and license

Smartbooks derives from the local Candle clean-room implementation. The MIT license and existing library format are retained. This repository does not include private source books or a personal library. See [LICENSE](LICENSE).
