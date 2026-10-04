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
    "/images/logo.png",
    "/some/deep/path/photo.jpg",
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
