import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    cli: 'src/cli.ts',
    'hooks/session-start': 'src/hooks/session-start.ts',
    'hooks/post-tool-use': 'src/hooks/post-tool-use.ts',
    'hooks/session-end': 'src/hooks/session-end.ts',
  },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  dts: false,
  clean: true,
  splitting: false,
  noExternal: ['commander', 'unpdf', 'fflate'],
  sourcemap: false,
  banner: { js: '#!/usr/bin/env node' },
})
