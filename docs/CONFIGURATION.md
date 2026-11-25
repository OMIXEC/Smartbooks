# Smartbooks configuration

Smartbooks loads built-in defaults, `config.json` from the library home, and `smartbooks.config.json` from the current working directory in that order. Later values take precedence.

Set `SMARTBOOKS_HOME` to choose the library directory. Its default is `~/.smartbooks`. Project shelf manifests live under `.smartbooks/shelf.json`.

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

Run `sbs config show` to inspect the effective configuration, `sbs scan` to preview matching files, and `sbs sync` to ingest them. `sbs config set --project` writes the project configuration. `sbs setup --status` reports detected agent integrations.

Keep the library directory and backups private. It contains extracted page text and metadata from your source documents.
