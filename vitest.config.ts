import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Repo root, no trailing slash — mirrors tsconfig.json's "@/*" -> "./*" path
// mapping. Next's bundler resolves "@/..." via that tsconfig entry; Vitest
// runs outside Next's bundler, so it needs the equivalent Vite alias or any
// test file (or module a test file transitively imports) that uses "@/..."
// fails to resolve at collection time (2026-09-16, hit by lib/auth/session.ts
// importing "@/lib/supabase/server").
const rootDir = fileURLToPath(new URL(".", import.meta.url)).replace(/[\\/]+$/, "");

export default defineConfig({
  resolve: {
    // Array form (not the plain-object shorthand) so the "react" entry can
    // use an EXACT regex match (security review 2026-09-17, M2) — the object
    // shorthand's prefix matching would also rewrite "react-dom", "react/
    // jsx-runtime", "react-server-dom-*", etc. to the same single file,
    // which is only correct for the bare "react" specifier itself.
    alias: [
      { find: "@", replacement: rootDir },
      // "server-only"'s default export condition throws unconditionally
      // (guards against accidental client-bundle imports); Next.js only
      // avoids that by resolving the package's "react-server" export
      // condition (-> empty.js) when building the server component graph.
      // Vitest runs plain Node, so it hits the throwing default export —
      // alias straight to the no-op stub (by absolute path — the package's
      // `exports` map doesn't expose "./empty.js" as an importable subpath,
      // so a bare specifier alias 404s) so lib/**/*.test.ts can import
      // server-only modules (e.g. lib/import/order-report.ts) directly, same
      // as Next's server runtime does.
      {
        find: "server-only",
        replacement: fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
      },
      // The plain "react" package (18.3.1, our declared dependency) does NOT
      // export `cache` — Next.js's App Router only gets `React.cache()` by
      // aliasing "react" to its own vendored copy (next/dist/compiled/react)
      // at build time, for every server component/module. Vitest runs
      // outside Next's bundler and would otherwise resolve plain node_modules
      // react, so `import { cache } from "react"` (lib/auth/role.ts, 17 ก.ย.
      // 69) throws "cache is not a function" under test even though it works
      // fine under `next build`/`next dev`. Same fix pattern as the
      // "server-only" alias above — point at the same file Next's bundler
      // would resolve to. `find: /^react$/` (exact match only) so this never
      // touches "react-dom" or "react/jsx-runtime" imports.
      {
        find: /^react$/,
        replacement: fileURLToPath(new URL("./node_modules/next/dist/compiled/react/index.js", import.meta.url)),
      },
    ],
  },
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts", "supabase/tests/**/*.test.ts", "lib/**/*.test.ts", "scripts/**/*.test.mjs"],
    testTimeout: 30_000, // integration tests hit a real local Postgres — CI/cold cache can be slow
    hookTimeout: 30_000,
    // IMPORTANT: supabase/tests/* are integration tests sharing ONE stateful local
    // Postgres instance. `release_expired_reservations()` in particular has no
    // shop_id/tenant scoping (design: it's a global pg_cron job) — running test
    // FILES in parallel worker processes could interleave a global scan from one
    // file with backdated fixture rows another file is mid-way through asserting
    // on. Disabling file parallelism trades some wall-clock time for eliminating
    // that whole class of test flakiness. Tests within a single file already run
    // sequentially by default (vitest doesn't parallelize `it()` blocks unless
    // marked `.concurrent`), so this only affects cross-file scheduling.
    fileParallelism: false,
  },
});
