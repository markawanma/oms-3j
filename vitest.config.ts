import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts", "supabase/tests/**/*.test.ts"],
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
