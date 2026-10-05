import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Repo root, no trailing slash — mirrors tsconfig.json's "@/*" -> "./*" path
// mapping. Next's bundler resolves "@/..." via that tsconfig entry; Vitest
// runs outside Next's bundler, so it needs the equivalent Vite alias or any
// test file (or module a test file transitively imports) that uses "@/..."
// fails to resolve at collection time (2026-09-16, hit by lib/auth/session.ts
// importing "@/lib/supabase/server").
const rootDir = fileURLToPath(new URL(".", import.meta.url)).replace(/[\\/]+$/, "");

const atAlias = { find: "@", replacement: rootDir };

// "server-only"'s default export condition throws unconditionally (guards
// against accidental client-bundle imports); Next.js only avoids that by
// resolving the package's "react-server" export condition (-> empty.js)
// when building the server component graph. Vitest runs plain Node, so it
// hits the throwing default export — alias straight to the no-op stub (by
// absolute path — the package's `exports` map doesn't expose "./empty.js"
// as an importable subpath, so a bare specifier alias 404s) so test files
// can import server-only modules (e.g. lib/import/order-report.ts) directly,
// same as Next's server runtime does. Harmless for the component project
// too (no component test imports a server-only module today), so it's
// shared rather than duplicated per project.
const serverOnlyAlias = {
  find: "server-only",
  replacement: fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
};

export default defineConfig({
  test: {
    // Split into two projects instead of one shared config because the
    // "node" suites and the "components" suite need DIFFERENT, mutually
    // incompatible resolutions of the bare "react" specifier — see the
    // comment on the "react" alias below for why aliasing it breaks real
    // DOM rendering. `projects` makes each side its own independent Vite
    // config (own resolve.alias/transform) while still running from one
    // `vitest run` invocation. Added 4 ต.ค. 69 alongside
    // components/ui/CollapsibleSection.test.tsx, the first component-level
    // (React-rendering) test in this repo — until then everything fit in
    // one flat config.
    projects: [
      {
        resolve: {
          // Array form (not the plain-object shorthand) so the "react" entry
          // can use an EXACT regex match (security review 2026-09-17, M2) —
          // the object shorthand's prefix matching would also rewrite
          // "react-dom", "react/jsx-runtime", "react-server-dom-*", etc. to
          // the same single file, which is only correct for the bare "react"
          // specifier itself.
          alias: [
            atAlias,
            serverOnlyAlias,
            // The plain "react" package (18.3.1, our declared dependency)
            // does NOT export `cache` — Next.js's App Router only gets
            // `React.cache()` by aliasing "react" to its own vendored copy
            // (next/dist/compiled/react) at build time, for every server
            // component/module. Vitest runs outside Next's bundler and would
            // otherwise resolve plain node_modules react, so
            // `import { cache } from "react"` (lib/auth/role.ts, 17 ก.ย. 69)
            // throws "cache is not a function" under test even though it
            // works fine under `next build`/`next dev`. Same fix pattern as
            // the "server-only" alias above — point at the same file Next's
            // bundler would resolve to. `find: /^react$/` (exact match only)
            // so this never touches "react-dom" or "react/jsx-runtime"
            // imports.
            //
            // ONLY safe here because this project's suites (lib/**,
            // supabase/tests/**, packages/**, scripts/**) never render
            // through react-dom — they call plain functions/RPCs. The
            // "components" project below deliberately does NOT carry this
            // alias; see its comment for why.
            {
              find: /^react$/,
              replacement: fileURLToPath(new URL("./node_modules/next/dist/compiled/react/index.js", import.meta.url)),
            },
          ],
        },
        test: {
          name: "node",
          environment: "node",
          // "app/**/*.test.ts" added 4 ต.ค. 69 (gem-quiz backend) — the first
          // Route Handler test in this repo (app/api/gem-quiz/submit/
          // route.test.ts), co-located with the route it tests the same way
          // lib/**/*.test.ts sits next to its source. Deliberately NOT
          // "app/**/*.test.tsx" — that would collide with the "components"
          // project's jsdom environment below for any future page-level
          // React test; route handlers are plain functions, same "node"
          // environment as everything else in this project.
          include: [
            "packages/**/*.test.ts",
            "supabase/tests/**/*.test.ts",
            "lib/**/*.test.ts",
            "app/**/*.test.ts",
            "scripts/**/*.test.mjs",
          ],
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
      },
      {
        // tsconfig.json sets `jsx: "preserve"` because Next's own SWC
        // pipeline does the JSX transform at build time — Vite (this
        // project's `vite@8` default transform is oxc, not esbuild) reads
        // that same tsconfig and takes "preserve" literally, i.e. it does
        // NOT transform JSX at all, leaving raw `<Foo />` syntax for the
        // next plugin in the chain (import-analysis) to choke on with
        // "invalid JS syntax". `esbuild.jsx` alone does NOT fix this on
        // vite@8 — oxc is the active transformer and silently ignores
        // esbuild options when both are set ("oxc options will be used and
        // esbuild options will be ignored"). Overriding oxc's jsx mode here
        // forces Vitest to actually transform JSX in every .tsx file this
        // project loads, without touching the tsconfig Next.js relies on.
        // Object form, not the `"react-jsx"` string shorthand — the type
        // vite's `UserConfig["oxc"]` actually exposes only accepts
        // `"preserve" | JsxOptions`, not oxc's own looser string-shorthand
        // union (`tsc --noEmit` rejects the string form here even though
        // oxc itself accepts it fine at runtime).
        oxc: {
          jsx: { runtime: "automatic" },
        },
        resolve: {
          // Deliberately NO alias for the bare "react" specifier (contrast
          // with the "node" project above). Component tests render through
          // the real, plain npm "react-dom" package (via
          // @testing-library/react), and react-dom's own internal
          // `require("react")` resolves to the SAME plain npm "react"
          // package it was built/tested against. `next/dist/compiled/react`
          // is a separate internal React build Next.js pairs with its own
          // `next/dist/compiled/react-dom` — it does not share hook
          // dispatcher state with the plain npm react-dom package. Aliasing
          // "react" to Next's compiled copy here (as the "node" project
          // does) makes every component's hook call reach into one React
          // module instance while react-dom's renderer sets up the
          // dispatcher on a different instance, so EVERY hook call throws
          // "Cannot read properties of null (reading 'useState')" the
          // moment a component actually renders. Confirmed by reproducing
          // this exact failure while building
          // components/ui/CollapsibleSection.test.tsx (4 ต.ค. 69) — removing
          // the react alias for this project fixed it immediately. No
          // component test in this repo needs `React.cache()` (that's a
          // server-component/RSC API; these are client "use client" leaf
          // components), so there's no competing need to keep it aliased.
          alias: [atAlias, serverOnlyAlias],
        },
        test: {
          name: "components",
          environment: "jsdom",
          // "app/(quiz)/**/*.test.tsx" added 5 ต.ค. 69 (gem-quiz frontend) —
          // GemQuizClient.tsx is the first React component that lives under
          // app/ instead of components/ (design doc §8 puts it at
          // app/(quiz)/gem-quiz/GemQuizClient.tsx, co-located with the page
          // it belongs to, not under components/domain/**). Scoped to the
          // "(quiz)" route group specifically (not a bare "app/**/*.test.tsx")
          // so a future Route Handler test accidentally named *.test.tsx
          // under app/api/** doesn't get pulled into this jsdom project by
          // mistake — route handlers belong in the "node" project above.
          // Parens in "(quiz)" are glob/extglob metacharacters to picomatch
          // (the matcher vitest's file collector uses) — an unescaped
          // "app/(quiz)/**/*.test.tsx" silently matches ZERO files (verified
          // 5 ต.ค. 69: GemQuizClient.test.tsx did not run until this was
          // fixed) instead of erroring, so a missing test here would have
          // gone unnoticed. Bracket-escaping each paren (not backslash —
          // picomatch's own escape char is inconsistent across its glob
          // modes) sidesteps the extglob grouping entirely.
          include: ["components/**/*.test.tsx", "app/[(]quiz[)]/**/*.test.tsx"],
        },
      },
    ],
  },
});
