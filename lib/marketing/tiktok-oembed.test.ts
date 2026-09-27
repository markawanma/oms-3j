// lib/marketing/tiktok-oembed.test.ts
//
// Pure in-memory tests — global.fetch is ALWAYS mocked, never real, same
// hard rule as tiktok-link.test.ts's header explains (ToS + the account
// this shop's live selling depends on for 83% of TikTok orders).

import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchTikTokOEmbed } from "./tiktok-oembed";

const CANONICAL_URL = "https://www.tiktok.com/@3jjewelry/video/7689107132976827655";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function throwingJsonResponse(status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.reject(new SyntaxError("Unexpected token < in JSON")),
  } as unknown as Response;
}

function stubFetch(response: Response) {
  const fetchMock = vi.fn().mockResolvedValueOnce(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function stubFetchRejecting(err: unknown) {
  const fetchMock = vi.fn().mockRejectedValueOnce(err);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function stubFetchMustNotBeCalled() {
  const fetchMock = vi.fn(() => {
    throw new Error("test: fetch must not be called for this input");
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fetchTikTokOEmbed — happy path", () => {
  it("extracts title as caption and author_name as authorName", async () => {
    stubFetch(
      jsonResponse({
        title: "ชอบพลอยสีไหนกันบ้างครับ #เงิน925 #พลอยแท้",
        author_name: "3jjewelry",
        thumbnail_url: "https://example.com/thumb.jpg",
      })
    );
    const result = await fetchTikTokOEmbed(CANONICAL_URL);
    expect(result).toEqual({
      ok: true,
      caption: "ชอบพลอยสีไหนกันบ้างครับ #เงิน925 #พลอยแท้",
      authorName: "3jjewelry",
    });
  });

  it("requests exactly https://www.tiktok.com/oembed?url=<encoded canonical url>, credentials omitted, no auto-follow redirects", async () => {
    const fetchMock = stubFetch(jsonResponse({ title: "x", author_name: "y" }));
    await fetchTikTokOEmbed(CANONICAL_URL);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://www.tiktok.com/oembed?url=${encodeURIComponent(CANONICAL_URL)}`);
    expect(init.credentials).toBe("omit");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    // 🔴 M-2 fix (security รอบ 4, 27 ก.ย. 69) — default fetch behavior
    // ("follow") would chase a 3xx anywhere, off tiktok.com or down to
    // http://, before this module ever gets a chance to look at it.
    expect(init.redirect).toBe("error");
  });
});

describe("fetchTikTokOEmbed — 🔴 caption too long is truncated, never rejected outright", () => {
  it("a title longer than 500 chars is truncated to exactly 500", async () => {
    const longTitle = "ก".repeat(600);
    stubFetch(jsonResponse({ title: longTitle, author_name: "3jjewelry" }));
    const result = await fetchTikTokOEmbed(CANONICAL_URL);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.caption).toHaveLength(500);
      expect(result.caption).toBe(longTitle.slice(0, 500));
    }
  });

  it("a title of exactly 500 chars is NOT truncated (boundary, not off-by-one)", async () => {
    const exactTitle = "ก".repeat(500);
    stubFetch(jsonResponse({ title: exactTitle, author_name: null }));
    const result = await fetchTikTokOEmbed(CANONICAL_URL);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.caption).toBe(exactTitle);
  });

  // 🔴 M-3 fix (security รอบ 4, 27 ก.ย. 69) — integration-level proof that
  // the surrogate-pair-safe truncateUtf16Safe (lib/marketing/text-safe-
  // truncate.ts, unit-tested on its own) is actually WIRED IN here, not just
  // correct in isolation.
  it("a title with an emoji straddling the 500-char cut point never produces a lone surrogate", async () => {
    const emoji = "\u{1F600}"; // 😀 — 2 UTF-16 code units
    const title = "a".repeat(499) + emoji; // 501 code units total
    stubFetch(jsonResponse({ title, author_name: null }));
    const result = await fetchTikTokOEmbed(CANONICAL_URL);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Whole emoji dropped, never a half-emoji lone surrogate left dangling.
      expect(result.caption).toBe("a".repeat(499));
      const lastCode = result.caption?.charCodeAt((result.caption?.length ?? 1) - 1);
      expect(lastCode).not.toBeGreaterThanOrEqual(0xd800);
    }
  });
});

describe("fetchTikTokOEmbed — 🔴 failures must never throw, and never block saving (caller contract)", () => {
  it("a non-2xx response -> { ok: false }, no throw", async () => {
    stubFetch(jsonResponse({}, 404));
    const result = await fetchTikTokOEmbed(CANONICAL_URL);
    expect(result).toEqual({ ok: false });
  });

  it("a 500 response -> { ok: false }, no throw", async () => {
    stubFetch(jsonResponse({}, 500));
    const result = await fetchTikTokOEmbed(CANONICAL_URL);
    expect(result).toEqual({ ok: false });
  });

  it("fetch throwing a network error -> { ok: false }, no throw", async () => {
    stubFetchRejecting(new TypeError("fetch failed"));
    const result = await fetchTikTokOEmbed(CANONICAL_URL);
    expect(result).toEqual({ ok: false });
  });

  it("fetch aborting on the timeout -> { ok: false }, no throw", async () => {
    stubFetchRejecting(new DOMException("The operation was aborted.", "AbortError"));
    const result = await fetchTikTokOEmbed(CANONICAL_URL);
    expect(result).toEqual({ ok: false });
  });

  it("response.json() rejecting (malformed/non-JSON body, e.g. an HTML error page) -> { ok: false }, no throw", async () => {
    stubFetch(throwingJsonResponse());
    const result = await fetchTikTokOEmbed(CANONICAL_URL);
    expect(result).toEqual({ ok: false });
  });

  it("a JSON body that parses but isn't an object (e.g. a bare string) -> { ok: false }, no throw", async () => {
    stubFetch(jsonResponse("unexpected string body"));
    const result = await fetchTikTokOEmbed(CANONICAL_URL);
    expect(result).toEqual({ ok: false });
  });

  it("a JSON body that is null -> { ok: false }, no throw", async () => {
    stubFetch(jsonResponse(null));
    const result = await fetchTikTokOEmbed(CANONICAL_URL);
    expect(result).toEqual({ ok: false });
  });

  it("a JSON body missing both title and author_name -> ok:true with both fields null (not a failure)", async () => {
    stubFetch(jsonResponse({ thumbnail_url: "https://example.com/thumb.jpg" }));
    const result = await fetchTikTokOEmbed(CANONICAL_URL);
    expect(result).toEqual({ ok: true, caption: null, authorName: null });
  });
});

describe("fetchTikTokOEmbed — 🔴 refuses to build a request from anything but a canonical TikTok post URL, zero network", () => {
  it("a non-canonical (e.g. short link) URL is refused without ever calling fetch", async () => {
    const fetchMock = stubFetchMustNotBeCalled();
    const result = await fetchTikTokOEmbed("https://vt.tiktok.com/ZSbYUGv9e");
    expect(result).toEqual({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a live-page URL is refused without ever calling fetch", async () => {
    const fetchMock = stubFetchMustNotBeCalled();
    const result = await fetchTikTokOEmbed("https://www.tiktok.com/@3jjewelry/live");
    expect(result).toEqual({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a non-TikTok URL is refused without ever calling fetch", async () => {
    const fetchMock = stubFetchMustNotBeCalled();
    const result = await fetchTikTokOEmbed("https://www.facebook.com/3jjewelry/posts/123");
    expect(result).toEqual({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("an http:// (not https) canonical-shaped URL is refused without ever calling fetch", async () => {
    const fetchMock = stubFetchMustNotBeCalled();
    const result = await fetchTikTokOEmbed("http://www.tiktok.com/@3jjewelry/video/123");
    expect(result).toEqual({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("not a URL at all is refused without ever calling fetch", async () => {
    const fetchMock = stubFetchMustNotBeCalled();
    const result = await fetchTikTokOEmbed("not a url at all");
    expect(result).toEqual({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("fetchTikTokOEmbed — logging never includes the raw response body (PII/content discipline)", () => {
  it("a failing response's status/host are logged, but the JSON body content never appears in a console.error call", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    stubFetch(jsonResponse({ secret_field: "SECRET_VALUE_SHOULD_NOT_LOG" }, 500));
    await fetchTikTokOEmbed(CANONICAL_URL);
    const serialized = JSON.stringify(consoleSpy.mock.calls);
    expect(serialized).not.toContain("SECRET_VALUE_SHOULD_NOT_LOG");
  });
});
