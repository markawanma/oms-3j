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
    alias: {
      "@": rootDir,
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
      "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
    },
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
