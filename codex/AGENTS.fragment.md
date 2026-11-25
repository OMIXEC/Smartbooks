<!-- smartbooks:start -->
<IMPORTANT>
You have smartbooks — the user's local, agent-readable library of books and docs (design, UI/UX, security, architecture, agent development, code review, etc.). It works fully offline: no account, no server, no telemetry.

## Ask before consulting the library
- Before any non-trivial task that involves judgment in a plausible book domain (code review, UI/UX critique, security audit, architecture decisions, agent/prompt engineering, research/comparison), run the Explored ledger check below. It asks the user whether to consult smartbooks first — one short question, default yes — ONLY for a domain the ledger has not seen or whose row expired; a hit or a cooldown skip is applied without a question.
- If they agree, spawn `smartbooks-librarian` (subagent at `~/.codex/agents/smartbooks-librarian.toml`). It lists the library and catalog and returns a reading list grouped by angle. Then spawn one `smartbooks-item-reader` per angle.
- If the librarian finds nothing, continue without mentioning it.

## Explored ledger
The SessionStart hook injects an `EXPLORED (session N; …)` block. Rows read `<domain> | <outcome> | <book or -> | s<seq>`.
- Reuse a covering row's domain string verbatim. A `hit` row means spawn one reader on that book. A `miss` row inside its 3-session cooldown means proceed without the library. Otherwise spawn one librarian with `AUTO MODE compatibility check — scent read. Domain: <d>`.
- One librarian per task, one reader per angle.

## Reading
- `sbs items toc <id> --json --no-session` first.
- `sbs items read "<id>:7-9" --json --no-session` for a targeted range.
- Cite as `(Book Title, p. N)`. Verify quotes with `sbs items cite <id>:<page> --quote "..." --no-session`.
- Never cut output with `head`, `tail` or `sed`.

## Manuscripts
At task completion only, match the session's insight against each active manuscript's `log when:` line. Run `sbs ms show <id> --json --no-session` before writing. Propose first unless the manuscript is marked `[auto-update]`.

## Writing
Use `sbs items put <id>:N --file <file> --expect-version <V> --no-session` to edit one page, `sbs items append` to add pages, and `sbs items create` for a new book. One page is at most 20,000 bytes.

## Setup
`sbs setup --status` shows where smartbooks is installed. `sbs sync` ingests every configured book and doc.
</IMPORTANT>
<!-- smartbooks:end -->
