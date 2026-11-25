# Smartbooks

Smartbooks is a local-first library for coding agents. It ingests EPUB, PDF, Markdown, HTML, and text, provides a table of contents, reads selected pages, and verifies exact citations. The source library stays on your machine.

## Install

Use Node 22 or later.

```sh
npm ci
npm run build
npm link
sbs --help
```

The CLI's primary name is `sbs`. The `candle`, `candlekeep`, and `sumbookit` aliases remain available for existing workflows. `sbs setup` installs agent integrations. It preserves existing legacy executable paths.

```sh
sbs items add /path/to/book.epub
sbs items list
sbs items toc BOOK_ID
sbs items read BOOK_ID --pages 1-2
sbs items cite BOOK_ID:1 --quote "exact words"
```

Smartbooks uses the existing `~/.candle` library by default. Set `SMARTBOOKS_HOME` for an isolated library; `CANDLE_HOME` and `SUMBOOKIT_HOME` remain supported. `smartbooks.config.json` is optional and takes precedence over `candle.config.json`.

## Provenance and safety

Smartbooks is based on the local Candle clean-room implementation. Its MIT license and existing library format are retained. Source books and private libraries are not included in this repository.

This is a local tool, not a multi-user authorization boundary. A hosted integration must enforce identity, entitlement, resource limits, and isolation before calling it.
