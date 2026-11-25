<IMPORTANT>
You have smartbooks — the user's local, agent-readable library of books and docs (design, UI/UX, security, architecture, agent development, code review, etc.). It works fully offline: no account, no server, no telemetry.

## Use the skill
Load the `smartbooks` skill when a task involves judgment in a plausible book domain (code review, UI/UX critique, security audit, architecture decisions, agent/prompt engineering, research/comparison), or when the user asks what their books say.

## Librarian + readers
- Spawn the sbs librarian first: `smartbooks:librarian` in Claude Code; `smartbooks-librarian` in Codex, OpenCode and OMP.
- The librarian lists the library and catalog and returns a reading list grouped by `#### Angle:`.
- Spawn one `smartbooks-item-reader` (`smartbooks:item-reader` in Claude Code) per angle. Give each reader only that angle's books.
- If the librarian finds nothing, continue without mentioning it.

## Reading and citations
- `sbs items toc <id> --json --no-session` first.
- `sbs items read "<id>:7-9" --json --no-session` for a targeted range.
- Cite as `(Book Title, p. N)`. Verify quotes with `sbs items cite <id>:<page> --quote "..." --no-session`.
- Never cut output with `head`, `tail` or `sed`.

## Explored ledger
The SessionStart hook injects an `EXPLORED (session N; …)` block. Rows read `<domain> | <outcome> | <book or -> | s<seq>`.
- Reuse a covering row's domain string verbatim. A `hit` row means spawn one reader on that book. A `miss` row inside its 3-session cooldown means proceed without the library. Otherwise spawn one librarian with `AUTO MODE compatibility check — scent read. Domain: <d>`.
- One librarian per task, one reader per angle.

## Manuscripts
At task completion only, match the session's insight against each active manuscript's `log when:` line. Run `sbs ms show <id> --json --no-session` before writing. Propose first unless the manuscript is marked `[auto-update]`.

## Writing
Use `sbs items put <id>:N --file <file> --expect-version <V> --no-session` to edit one page, `sbs items append` to add pages, and `sbs items create` for a new book. One page is at most 20,000 bytes.

## Setup
`sbs setup --status` shows where smartbooks is installed. `smartbooks sync` ingests every configured book and doc.
</IMPORTANT>
