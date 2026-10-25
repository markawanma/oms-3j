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
    ["/GEM-QUIZ", "matching is case-sensitive: an upper-case look-alike is not exempt (same rule as /RING-SIZE)"],
    // ring-size (public ring-size measuring tool, 24 ต.ค. 69) — exact page only, same anchoring as gem-quiz
    ["/ring-sizes", "starts with 'ring-size' but is a different route (R-10)"],
    ["/ring-size-admin", "same 'ring-size' prefix trap (R-10)"],
    ["/ring-size/x", "subtree under /ring-size, not the exact page (M3)"],
    ["/ring-size/x/y", "deeper subtree (M3)"],
    ["/ring-size//", "double slash"],
    ["/api/ring-size-x", "starts with 'api/ring-size' but is a different route (R-10)"],
    ["/api/ring-size", "only the exact /event endpoint is exempt, not the bare prefix (M3)"],
    ["/api/ring-size/", "bare prefix with trailing slash"],
    ["/api/ring-size/track", "a future route must earn its own exemption (M3)"],
    ["/api/ring-size/stats", "a future stats/export route must earn its own exemption (M3)"],
    ["/api/ring-size/event/x", "subtree under the exact endpoint (M3)"],
    ["/api/ring-size/event/x/y", "deeper subtree under the endpoint"],
    ["/api/ring-size/events", "look-alike: plural"],
    ["/api/ring-size/event-x", "look-alike: suffix"],
    ["/api/ring-size/eventx", "look-alike: suffix without dash"],
    ["/api/ring-size/Event", "case-sensitive: capitalised endpoint"],
    ["/api/ring-size/EVENT", "case-sensitive: upper-case endpoint"],
    ["/api/RING-SIZE/event", "case-sensitive: upper-case prefix"],
    ["/api/ring-sizes/event", "look-alike: ring-sizes"],
    ["/api/ring-size-x/event", "look-alike: ring-size-x"],
    ["/api/ring-size/event//", "double slash after the endpoint"],
    ["/api/ring-size//event", "double slash before the endpoint"],
    ["/api/ring-size/event%2F", "encoded slash"],
    ["/api/ring-size/event%2fx", "encoded slash + tail"],
    ["/api/ring-size/event/..", "traversal"],
    ["/api/ring-size/event/../../oem", "traversal into a gated page"],
    ["/api/ring-size/event ", "trailing space"],
    ["/api/ring-size/event?x=1", "query glued into the path (pathname never carries it — guarded anyway)"],
    ["/x/api/ring-size/event", "nested under another page"],
    ["/ring-size/api/ring-size/event", "nested under the exempt page"],
    ["/api/ring-size/event/api/ring-size/event", "endpoint repeated inside its own subtree"],
    ["/RING-SIZE", "case-sensitive: upper-case is not exempt (same as gem-quiz)"],
    ["/Ring-Size", "case-sensitive: mixed-case is not exempt"],
    ["/ring-size%2F..", "encoded slash + traversal tail"],
    ["/ring-size%2fx", "encoded slash"],
    ["/ring-size/..", "traversal"],
    ["/ring-size/../oem", "traversal into a gated page"],
    ["/ring-size?x=1", "query glued into the path (pathname never carries it — guarded anyway)"],
    ["/ring-size ", "trailing space"],
    ["/x/ring-size", "nested under another page"],
    ["/oem/ring-size", "nested under a gated page"],
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
    "/api/ring-size/event",
    "/api/ring-size/event/",
    "/ring-size",
    "/ring-size/",
    "/ring-size/3j-mark.png", // static asset of the page (exempt by extension, not by the ring-size rule)
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
