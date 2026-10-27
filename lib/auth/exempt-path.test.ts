// lib/auth/exempt-path.test.ts — proves middleware.ts's config.matcher
// anchoring (H3, security review 2026-09-16) via its pure mirror,
// lib/auth/exempt-path.ts. See that file's header for why this can't test
// the real matcher directly.
import { describe, expect, it } from "vitest";
import { isExemptPath } from "./exempt-path";

describe("isExemptPath — must NOT exempt (prefix look-alikes)", () => {
  it.each([
    ["/shopee-import", "starts with 'shop' but is not /shop or /shop/..."],
    ["/shopping-cart", "same 'shop' prefix trap"],
    ["/stock/heroes", "starts with 'stock/hero' but is a different route"],
    ["/stock/heroic-sales", "same 'stock/hero' prefix trap"],
    ["/api/webhooksx", "starts with 'api/webhooks' but is a different route"],
    ["/api/webhooks-legacy", "same 'api/webhooks' prefix trap"],
    ["/gem-quizzes", "starts with 'gem-quiz' but is a different route (R-10)"],
    ["/gem-quiz-admin", "same 'gem-quiz' prefix trap (R-10)"],
    ["/gem-quiz/admin", "subtree under /gem-quiz, not the exact page (M3)"],
    ["/api/gem-quiz-x", "starts with 'api/gem-quiz' but is a different route (R-10)"],
    ["/api/gem-quizzes", "same 'api/gem-quiz' prefix trap (R-10)"],
    ["/api/gem-quiz", "only /submit under this prefix is exempt, not the bare prefix (M3)"],
    ["/api/gem-quiz/stats", "a future route under this prefix must earn its own exemption (M3)"],
    ["/api/gem-quiz/submit/extra", "subtree under /submit, not the exact endpoint (M3)"],
  ])("%s (%s)", (path) => {
    expect(isExemptPath(path)).toBe(false);
  });
});

// Security review 2026-10-24 (H1, /ring-size review): the OLD static-asset
// exemption was a blanket `.*\.(png|jpg|...)$`. Next's dynamic `[id]` captures
// dots, so EVERY dynamic route with an image-suffixed id bypassed the gate —
// and because Next dispatches server actions by a GLOBAL id (not bound to the
// POSTed page), a bypassed path is a live entry point to any "use server"
// action. These are the paths that MUST now stay gated. The matcher fix
// replaces the extension wildcard with anchored literals for the 3 real
// public assets (see exempt-path.ts header), so none of these match anymore.
describe("isExemptPath — H1: image-suffixed dynamic routes must NOT bypass the gate", () => {
  it.each([
    ["/oem/quotes/x.png", "the reported vector — /oem/quotes/[id] with id=x.png"],
    ["/oem/quotes/evil.jpg", "same route, other extension"],
    ["/oem/invoices/x.png", "OEM invoice [id]"],
    ["/oem/receipts/x.webp", "OEM receipt [id]"],
    ["/orders/123.png", "/orders/[id] — raw buyer PII action lives here"],
    ["/crm/customers/x.png", "/crm/customers/[id] — customer registry"],
    ["/production/x.gif", "/production/[id]"],
    ["/jobs/x.ico", "/jobs/[id]"],
    ["/live/x.svg", "/live/[id]"],
    ["/settings/members.png", "flat gated page + fake extension"],
    ["/dashboard.png", "flat gated page + fake extension"],
    ["/w/x.png", "worker token slot can't carry a dot — must stay gated"],
    ["/w/s/x.png", "shop-QR token slot can't carry a dot — must stay gated"],
    ["/oem/quotes/3j-logo.png", "anti-smuggle: real asset NAME under a gated route stays gated"],
    ["/x/gem-quiz/og.png", "anti-smuggle: real asset path NOT at root stays gated"],
    ["/3j-logo.png.evil", "anti-smuggle: trailing junk after the real asset name"],
    ["/3j-logo.pngx", "anti-smuggle: extra char right after the extension"],
    ["/3j-logo.jpg", "wrong extension for the logo (only png/svg are real)"],
    ["/gem-quiz/og.jpg", "wrong extension for the OG image (only png is real)"],
    ["/3j-logo.PNG", "case-sensitive: uppercase ext is not the real lowercase file"],
    ["/3j-logo.png/", "trailing slash: not the exact asset path"],
    ["//3j-logo.png", "leading double slash: not the exact asset path"],
  ])("%s (%s)", (path) => {
    expect(isExemptPath(path)).toBe(false);
  });
});

describe("isExemptPath — must exempt (the real routes + their subpaths)", () => {
  it.each([
    "/shop",
    "/shop/some-product-slug",
    "/stock/hero",
    "/stock/hero/",
    "/api/webhooks/tiktok",
    "/api/webhooks/shopee",
    "/gem-quiz",
    "/gem-quiz/",
    "/api/gem-quiz/submit",
    "/_next/static/chunk.js",
    "/_next/image?url=x",
    "/favicon.ico",
    // The exactly-three real public assets in /public that an unauthenticated
    // page / OG crawler must load (exempt-path.ts header). No wildcard — a new
    // public asset must be added here + to the matcher + its test, by hand.
    "/3j-logo.png",
    "/3j-logo.svg",
    "/gem-quiz/og.png",
  ])("%s", (path) => {
    expect(isExemptPath(path)).toBe(true);
  });
});

describe("isExemptPath — ordinary gated pages, unaffected either way", () => {
  it.each(["/dashboard", "/catalog", "/settings/members", "/login", "/register", "/pending", "/"])(
    "%s is not exempt",
    (path) => {
      expect(isExemptPath(path)).toBe(false);
    }
  );
});
