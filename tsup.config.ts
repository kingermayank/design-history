import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  clean: false,
  splitting: false,
  sourcemap: false,
  shims: true,
  banner: { js: '#!/usr/bin/env node' },
  external: ['playwright', '@modelcontextprotocol/sdk', 'zod', 'sharp'],
});
