# Agent workflows and verification

Smartbooks ships a core skill, four agent roles, host-specific setup assets, and a local MCP server. This inventory distinguishes shipped capabilities from per-host behavior that still needs verification.

| Capability | Current Smartbooks support | Evidence needed |
| --- | --- | --- |
| Research | Librarian selects sources, readers retrieve bounded page ranges, and the host assembles a cited answer. | Run the complete workflow on a fixed corpus and verify citations and misses. |
| Library maintenance | Writer and enricher manage books and their metadata through version-aware CLI actions. | Test stale revisions, metadata updates, and recovery on each host that supports these roles. |
| Complete reading | The CLI can traverse all indexed text, and both CLI and MCP expose continuations. | Verify continuation across revisions and surface OCR and layout limitations. |
| Host variants | Codex, Claude Code, OpenCode, and OMP have role definitions. Other integrations receive host-specific instructions or the core skill as supported. | Test install, upgrade, removal, and manual fallbacks in isolated homes for every supported host. |
| Hooks | Claude Code includes session start, Bash post-tool-use, and session end hooks. | Test triggers, ledger context, and read tracking, including missed triggers and unlogged reads. |
| Catalog and sharing | The catalog is local, and MCP uses local stdio. | Specify and verify approved publication, team access, sync conflicts, and catalog withdrawal in a disposable service stack. |

Start with the source in [agents](../../agents), the [Smartbooks skill](../../skills/smartbooks/SKILL.md), the [hook manifest](../../hooks/hooks.json), and the [CLI and MCP tests](../../test/smartbooks.test.mjs). Keep findings and citations tied to a tested Smartbooks version.
