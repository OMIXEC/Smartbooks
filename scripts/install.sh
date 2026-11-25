#!/bin/sh
# candle installer: build the CLI, ingest the configured books and docs, and
# install the plugin into every detected coding agent.
set -eu
cd "$(dirname "$0")/.."

npm ci --no-audit --no-fund
npm run build
node dist/cli.js setup

printf '\n'
printf 'Smartbooks is ready.\n'
printf '  sbs items list\n'
printf '  sbs items toc <id>\n'
printf '  sbs items read <id> --pages 1-3\n'
printf '  sbs setup --status\n'
