/**
 * Bundles the non-Next.js entry points into self-contained ESM files under `dist/`, so the
 * production image runs them with plain `node` and needs no `node_modules` beyond Next.js's
 * standalone output (D-042).
 *
 * The output keeps the `src/` layout (`dist/db/migrate_cli.mjs`...) because the migrator and the
 * seed find `drizzle/` and `data/standards/` relative to their own file.
 */
import { build } from 'esbuild'

export const SERVICE_ENTRY_POINTS = [
  'src/worker/main.ts',
  'src/collab/main.ts',
  'src/db/migrate_cli.ts',
  'src/db/seed/seed_cli.ts',
]

await build({
  entryPoints: SERVICE_ENTRY_POINTS,
  outbase: 'src',
  outdir: 'dist',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  // Optional native add-ons that pg and ws load inside try/catch.
  external: ['pg-native', 'bufferutil', 'utf-8-validate'],
  // Bundled CommonJS packages call require() for Node built-ins, which ESM doesn't define.
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  logLevel: 'warning',
})
console.log(`Bundled ${SERVICE_ENTRY_POINTS.length} entry points into dist/`)
