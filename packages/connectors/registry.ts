// packages/connectors/registry.ts
//
// getConnector() — design §4: "mock ได้เมื่อ channel_account.is_sandbox".
// Real shopee/lazada/tiktok connectors are NOT implemented in this batch
// (marketplace credentials pending — design R1/R2). Calling getConnector with
// sandbox=false throws instead of silently returning a mock, so a
// misconfigured `channel_account.is_sandbox=false` fails loudly rather than
// pretending to talk to a real marketplace.
//
// S3 DECISION (code-review, C-3PO): this package is imported from BOTH the
// Node/Next.js webhook route (app/api/webhooks/[channel]/route.ts, via an
// extensionless specifier — standard bundler style) and the Deno-run
// sync-worker Edge Function (supabase/functions/sync-worker/index.ts, via
// explicit `.ts` specifiers — Deno never auto-resolves an extensionless
// relative import, this is a hard Deno requirement, not a style choice).
// The imports below (`./mock.ts`, `./types.ts`) therefore keep their
// explicit `.ts` extension so Deno can load this file directly.
//
// Considered alternatives and why they were rejected:
//   - Stripping the extension here (Next/tsc-canonical style) breaks Deno
//     outright — Deno's relative-import resolution does a literal path
//     check with no extension-guessing, confirmed by this being the exact
//     reason types.ts already documents the same convention.
//   - Bridging via a Deno `deno.json` import map that remaps the
//     extensionless form back to `.ts` was considered and rejected: per the
//     import-maps spec Deno implements, "./"-prefixed specifiers are first
//     resolved to an absolute URL *before* being matched against map
//     entries, so a portable, environment-independent bare-relative-key
//     mapping (`"./mock"` -> `"./mock.ts"`) is not reliably expressible
//     without hardcoding an absolute path that would differ per
//     machine/deployment — worse than the problem it would solve.
//   - Duplicating registry.ts/mock.ts/types.ts into a Deno-only copy would
//     remove all ambiguity but reintroduces real drift risk (two copies of
//     the connector contract and status-mapping table to keep in sync) for
//     ~250 lines total — not worth it at this size.
//
// Why keeping `.ts` here is expected to be safe for the Next.js/webpack side
// too: tsconfig.json already sets `moduleResolution: "Bundler"` +
// `allowImportingTsExtensions: true` (the exact, official TS mechanism for
// this scenario — without it, tsc raises TS5097 "An import path can only
// end with a '.ts' extension when 'allowImportingTsExtensions' is
// enabled"), and webpack's resolver (enhanced-resolve) tries a request's
// literal path before consulting `resolve.extensions`, so `./mock.ts`
// resolves directly since that file exists verbatim.
//
// NOT VERIFIED THIS BATCH (no node/npm/deno available in this environment —
// see report): run `npm run typecheck` and `next build` (or `next dev`) on a
// machine with the toolchain installed to confirm the Next.js bundle
// actually resolves this import graph before treating this as closed.

import type { ChannelCode, MarketplaceConnector } from "./types.ts";
import { MockConnector } from "./mock.ts";

export interface ConnectorOptions {
  sandbox?: boolean;
}

const SUPPORTED_CHANNELS: readonly ChannelCode[] = ["shopee", "lazada", "tiktok"];

export function getConnector(channelCode: string, options: ConnectorOptions = {}): MarketplaceConnector {
  if (typeof channelCode !== "string" || channelCode.trim() === "") {
    throw new Error("getConnector: channelCode is required");
  }

  if (!SUPPORTED_CHANNELS.includes(channelCode as ChannelCode)) {
    throw new Error(`getConnector: unsupported channel "${channelCode}"`);
  }

  if (options.sandbox) {
    return new MockConnector(channelCode as ChannelCode);
  }

  throw new Error(
    `getConnector: no live connector implemented yet for "${channelCode}" ` +
      "(marketplace credentials pending — see design R1/R2). " +
      "Pass { sandbox: true } to use the mock connector.",
  );
}
