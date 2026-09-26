// lib/marketing/tiktok-link.test.ts
//
// Unit tests for canonicalizeTikTokLink (lib/marketing/tiktok-link.ts).
// Pure in-memory tests — global.fetch is ALWAYS mocked, never real. Hitting
// TikTok's real servers from an automated test suite would violate their
// ToS and risk the account this shop's TikTok live selling depends on for
// 83% of TikTok orders (see memory live-selling-rhythm) — this is a hard
// rule, not a style preference.
//
// Every mock Response's .text()/.json() throws — if the implementation
// ever reads the body (it must not: brief says headers/status only), any
// test that reaches that response will fail loudly instead of silently
// passing. Every mock Response's .body.cancel() resolves normally so the
// implementation's best-effort cleanup call is a no-op in tests, exactly
// like the real fetch API.
//
// Thai error strings are pinned as literal copies here (not imported from
// tiktok-link.ts) — same convention as calendar-errors.test.ts — so an
// accidental wording change shows up as a test diff a reviewer actually
// reads, instead of silently staying in sync because both sides import the
// same constant.

import { afterEach, describe, expect, it, vi } from "vitest";
import { canonicalizeTikTokLink } from "./tiktok-link";
import { deriveExternalId } from "./content-types";

const TH_LIVE_LINK = "ลิงก์นี้เป็นลิงก์ไลฟ์ ไม่ใช่โพสต์คลิป — ระบบนี้เก็บได้เฉพาะคลิป (ยอดไลฟ์ดูที่หน้าไลฟ์)";
const TH_PROFILE_LINK =
  'ลิงก์นี้เป็นลิงก์หน้าโปรไฟล์ ไม่ใช่ลิงก์คลิป — เปิดคลิปที่ต้องการแล้วกด "คัดลอกลิงก์" จากหน้าคลิปมาวางแทน';
const TH_UNRECOGNIZED =
  'ระบบไม่รู้จักลิงก์ TikTok รูปแบบนี้ — เปิดคลิปใน TikTok แล้วกด "คัดลอกลิงก์" จากหน้าคลิป (ลิงก์ยาวที่มีคำว่า /video/) มาวางแทน';
const TH_SHORT_LINK_FAILED =
  'เปิดลิงก์สั้นไม่สำเร็จ — เปิดคลิปใน TikTok แล้วกด "คัดลอกลิงก์" จากหน้าคลิป (ลิงก์ยาวที่มีคำว่า /video/) มาวางแทน';

// ---- fetch mock helpers ----------------------------------------------

function throwingBody() {
  return {
    cancel: () => Promise.resolve(undefined),
  };
}

/** A 3xx response carrying a Location header — body reads throw. */
function redirectResponse(location: string, status = 302): Response {
  return {
    status,
    headers: new Headers({ location }),
    body: throwingBody(),
    text: () => {
      throw new Error("test: must not read response body (redirect)");
    },
    json: () => {
      throw new Error("test: must not read response body (redirect)");
    },
  } as unknown as Response;
}

/** A final (non-redirect) response — body reads throw. */
function finalResponse(status = 200): Response {
  return {
    status,
    headers: new Headers(),
    body: throwingBody(),
    text: () => {
      throw new Error("test: must not read response body (final)");
    },
    json: () => {
      throw new Error("test: must not read response body (final)");
    },
  } as unknown as Response;
}

function stubFetchSequence(...responses: Response[]) {
  const fetchMock = vi.fn();
  for (const r of responses) fetchMock.mockResolvedValueOnce(r);
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

function stubFetchRejecting(err: unknown) {
  const fetchMock = vi.fn().mockRejectedValueOnce(err);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---- 1. Non-TikTok hosts pass through untouched, zero network ---------

describe("non-TikTok URLs — untouched, zero network (ห้ามพัง)", () => {
  it("Facebook link passes through unchanged", async () => {
    const fetchMock = stubFetchMustNotBeCalled();
    const url = "https://www.facebook.com/3jjewelry/posts/123456";
    const result = await canonicalizeTikTokLink(url);
    expect(result).toEqual({ ok: true, url });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Instagram link passes through unchanged", async () => {
    const fetchMock = stubFetchMustNotBeCalled();
    const url = "https://www.instagram.com/p/Cabc123XYZ/";
    const result = await canonicalizeTikTokLink(url);
    expect(result).toEqual({ ok: true, url });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("LINE OA link passes through unchanged", async () => {
    const fetchMock = stubFetchMustNotBeCalled();
    const url = "https://liff.line.me/1234567890-abcdefgh/oa/announcement/1";
    const result = await canonicalizeTikTokLink(url);
    expect(result).toEqual({ ok: true, url });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a string that isn't a parseable URL at all passes through unchanged", async () => {
    const fetchMock = stubFetchMustNotBeCalled();
    const result = await canonicalizeTikTokLink("not a url at all");
    expect(result).toEqual({ ok: true, url: "not a url at all" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ---- host matching must be exact/suffix, never substring ---------------

describe("host matching — exact 'tiktok.com' or '.tiktok.com' suffix only (ห้ามผ่าน)", () => {
  it("'evil-tiktok.com' is NOT treated as TikTok — passes through unchanged, no network", async () => {
    const fetchMock = stubFetchMustNotBeCalled();
    const url = "https://evil-tiktok.com/@user/video/123";
    const result = await canonicalizeTikTokLink(url);
    expect(result).toEqual({ ok: true, url });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("'tiktok.com.evil.net' is NOT treated as TikTok — passes through unchanged, no network", async () => {
    const fetchMock = stubFetchMustNotBeCalled();
    const url = "https://tiktok.com.evil.net/@user/video/123";
    const result = await canonicalizeTikTokLink(url);
    expect(result).toEqual({ ok: true, url });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ---- 2. Already video/photo path — local canonicalization, zero network ----

describe("already /video/ or /photo/ in the path — canonicalized locally (ห้ามพัง)", () => {
  it("canonical URL with tracking query params + hash is cleaned, no network call", async () => {
    const fetchMock = stubFetchMustNotBeCalled();
    const result = await canonicalizeTikTokLink(
      "https://www.tiktok.com/@3jjewelry/video/7688660180707446023?is_copy_url=1&is_from_webapp=1#foo"
    );
    expect(result).toEqual({ ok: true, url: "https://www.tiktok.com/@3jjewelry/video/7688660180707446023" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("/photo/<id> (multi-photo TikTok post) is accepted, not treated as a live link", async () => {
    const fetchMock = stubFetchMustNotBeCalled();
    const result = await canonicalizeTikTokLink("https://www.tiktok.com/@3jjewelry/photo/7688660180707446023?foo=bar");
    expect(result).toEqual({ ok: true, url: "https://www.tiktok.com/@3jjewelry/photo/7688660180707446023" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("bare 'tiktok.com' (no www) and other subdomains are normalized to www.tiktok.com", async () => {
    const fetchMock = stubFetchMustNotBeCalled();
    const result = await canonicalizeTikTokLink("https://tiktok.com/@3jjewelry/video/123");
    expect(result).toEqual({ ok: true, url: "https://www.tiktok.com/@3jjewelry/video/123" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a plain http:// canonical link is upgraded to https:// output, no network needed", async () => {
    const fetchMock = stubFetchMustNotBeCalled();
    const result = await canonicalizeTikTokLink("http://www.tiktok.com/@3jjewelry/video/123");
    expect(result).toEqual({ ok: true, url: "https://www.tiktok.com/@3jjewelry/video/123" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("trailing slash after the id is stripped", async () => {
    const fetchMock = stubFetchMustNotBeCalled();
    const result = await canonicalizeTikTokLink("https://www.tiktok.com/@3jjewelry/video/123/");
    expect(result).toEqual({ ok: true, url: "https://www.tiktok.com/@3jjewelry/video/123" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("query-param-only difference on the SAME clip collapses to the same external_id via deriveExternalId", async () => {
    stubFetchMustNotBeCalled();
    const a = await canonicalizeTikTokLink("https://www.tiktok.com/@x/video/1?_r=1");
    const b = await canonicalizeTikTokLink("https://www.tiktok.com/@x/video/1?utm_source=copy&utm_medium=share");
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(deriveExternalId(a.url)).toBe(deriveExternalId(b.url));
    }
  });
});

// ---- direct paste of a live / profile-only link — rejected, zero network ----

describe("direct paste of a live or profile link (not through a short link) — rejected, zero network", () => {
  it("/@user/live pasted directly is rejected with the live-link message", async () => {
    const fetchMock = stubFetchMustNotBeCalled();
    const result = await canonicalizeTikTokLink("https://www.tiktok.com/@3jjewelry/live");
    expect(result).toEqual({ ok: false, error: TH_LIVE_LINK });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("/@user profile-only pasted directly is rejected with the profile-link message", async () => {
    const fetchMock = stubFetchMustNotBeCalled();
    const result = await canonicalizeTikTokLink("https://www.tiktok.com/@3jjewelry");
    expect(result).toEqual({ ok: false, error: TH_PROFILE_LINK });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("/@user/ (trailing slash) profile-only is also rejected", async () => {
    const fetchMock = stubFetchMustNotBeCalled();
    const result = await canonicalizeTikTokLink("https://www.tiktok.com/@3jjewelry/");
    expect(result).toEqual({ ok: false, error: TH_PROFILE_LINK });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("an unrecognized TikTok page shape (e.g. search) is rejected, not guessed at", async () => {
    const fetchMock = stubFetchMustNotBeCalled();
    const result = await canonicalizeTikTokLink("https://www.tiktok.com/search?q=silver");
    expect(result).toEqual({ ok: false, error: TH_UNRECOGNIZED });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("the bare root path (no @user at all) is rejected as unrecognized", async () => {
    const fetchMock = stubFetchMustNotBeCalled();
    const result = await canonicalizeTikTokLink("https://www.tiktok.com/");
    expect(result).toEqual({ ok: false, error: TH_UNRECOGNIZED });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ---- 3. Short links — resolved via manual-redirect fetch ---------------

describe("short links — resolved via redirect, then canonicalized (happy paths)", () => {
  it("vt.tiktok.com resolves through ONE redirect to a video page", async () => {
    const fetchMock = stubFetchSequence(
      redirectResponse("https://www.tiktok.com/@3jjewelry/video/7688660180707446023", 301),
      finalResponse(200)
    );
    const result = await canonicalizeTikTokLink("https://vt.tiktok.com/ZSbYUGv9e");
    expect(result).toEqual({ ok: true, url: "https://www.tiktok.com/@3jjewelry/video/7688660180707446023" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("vm.tiktok.com short links are also resolved", async () => {
    stubFetchSequence(redirectResponse("https://www.tiktok.com/@3jjewelry/video/999", 302), finalResponse(200));
    const result = await canonicalizeTikTokLink("https://vm.tiktok.com/ZAbc123/");
    expect(result).toEqual({ ok: true, url: "https://www.tiktok.com/@3jjewelry/video/999" });
  });

  it("www.tiktok.com/t/<code> short links are resolved the same way", async () => {
    stubFetchSequence(redirectResponse("https://www.tiktok.com/@3jjewelry/video/888", 302), finalResponse(200));
    const result = await canonicalizeTikTokLink("https://www.tiktok.com/t/ZQdAbCdEf/");
    expect(result).toEqual({ ok: true, url: "https://www.tiktok.com/@3jjewelry/video/888" });
  });

  it("a relative Location header resolves against the current URL's origin", async () => {
    const fetchMock = stubFetchSequence(
      redirectResponse("/@3jjewelry/video/555", 302), // relative, no scheme/host
      finalResponse(200)
    );
    const result = await canonicalizeTikTokLink("https://vt.tiktok.com/ZSrelative");
    expect(result).toEqual({ ok: true, url: "https://www.tiktok.com/@3jjewelry/video/555" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fetch is called with redirect:'manual', credentials:'omit', and an AbortSignal (no cookies, no auto-follow)", async () => {
    const fetchMock = stubFetchSequence(
      redirectResponse("https://www.tiktok.com/@3jjewelry/video/1", 302),
      finalResponse(200)
    );
    await canonicalizeTikTokLink("https://vt.tiktok.com/ZS1");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.redirect).toBe("manual");
    expect(init.credentials).toBe("omit");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("the SAME AbortSignal instance is reused across every hop (total timeout, not per-hop)", async () => {
    const fetchMock = stubFetchSequence(
      redirectResponse("https://www.tiktok.com/@3jjewelry/video/1", 302),
      finalResponse(200)
    );
    await canonicalizeTikTokLink("https://vt.tiktok.com/ZS1");
    const signal0 = (fetchMock.mock.calls[0][1] as RequestInit).signal;
    const signal1 = (fetchMock.mock.calls[1][1] as RequestInit).signal;
    expect(signal0).toBe(signal1);
  });

});

describe("short links — the exact production incident (26 ก.ย. 69)", () => {
  it("vt.tiktok.com/ZSbYUGv9e (real short link) resolves to the real clip, matching the full link's canonical form", async () => {
    stubFetchSequence(
      redirectResponse("https://www.tiktok.com/@3jjewelry/video/7688660180707446023?checksum=abc", 301),
      finalResponse(200)
    );
    const fromShortLink = await canonicalizeTikTokLink("https://vt.tiktok.com/ZSbYUGv9e");
    const fromFullLink = await canonicalizeTikTokLink(
      "https://www.tiktok.com/@3jjewelry/video/7688660180707446023"
    );
    expect(fromShortLink).toEqual(fromFullLink);
  });

  it("vt.tiktok.com/ZS9As5qtoAyuL-dgskp (real short link) resolves to /@3jjewelry/live and is rejected, not saved", async () => {
    stubFetchSequence(redirectResponse("https://www.tiktok.com/@3jjewelry/live", 301), finalResponse(200));
    const result = await canonicalizeTikTokLink("https://vt.tiktok.com/ZS9As5qtoAyuL-dgskp");
    expect(result).toEqual({ ok: false, error: TH_LIVE_LINK });
  });
});

describe("short links resolving to a non-post destination (ห้ามผ่าน)", () => {
  it("resolves to /@user/live -> rejected with the live-link message", async () => {
    stubFetchSequence(redirectResponse("https://www.tiktok.com/@someuser/live", 302), finalResponse(200));
    const result = await canonicalizeTikTokLink("https://vt.tiktok.com/ZSabc");
    expect(result).toEqual({ ok: false, error: TH_LIVE_LINK });
  });

  it("resolves to a bare profile page -> rejected with the profile-link message", async () => {
    stubFetchSequence(redirectResponse("https://www.tiktok.com/@someuser", 302), finalResponse(200));
    const result = await canonicalizeTikTokLink("https://vt.tiktok.com/ZSabc");
    expect(result).toEqual({ ok: false, error: TH_PROFILE_LINK });
  });

  it("resolves to some other unrecognized page -> rejected as unrecognized", async () => {
    stubFetchSequence(redirectResponse("https://www.tiktok.com/search?q=x", 302), finalResponse(200));
    const result = await canonicalizeTikTokLink("https://vt.tiktok.com/ZSabc");
    expect(result).toEqual({ ok: false, error: TH_UNRECOGNIZED });
  });
});

// ---- SSRF guards on the redirect chain ----------------------------------

describe("redirect-hop safety — SSRF guards (ห้ามผ่าน, ห้ามยิงต่อ)", () => {
  it("a redirect to a non-tiktok.com host is rejected WITHOUT sending a request to it", async () => {
    const fetchMock = stubFetchSequence(redirectResponse("https://evil.com/steal-tokens", 302));
    const result = await canonicalizeTikTokLink("https://vt.tiktok.com/ZSabc");
    expect(result).toEqual({ ok: false, error: TH_SHORT_LINK_FAILED });
    expect(fetchMock).toHaveBeenCalledTimes(1); // never followed to evil.com
  });

  it("a redirect downgrading to http:// (not https) is rejected", async () => {
    const fetchMock = stubFetchSequence(redirectResponse("http://www.tiktok.com/@user/video/1", 302));
    const result = await canonicalizeTikTokLink("https://vt.tiktok.com/ZSabc");
    expect(result).toEqual({ ok: false, error: TH_SHORT_LINK_FAILED });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a redirect to an IPv4 loopback literal (127.0.0.1) is rejected", async () => {
    const fetchMock = stubFetchSequence(redirectResponse("https://127.0.0.1/admin", 302));
    const result = await canonicalizeTikTokLink("https://vt.tiktok.com/ZSabc");
    expect(result).toEqual({ ok: false, error: TH_SHORT_LINK_FAILED });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a redirect to the cloud metadata link-local address (169.254.169.254) is rejected", async () => {
    const fetchMock = stubFetchSequence(redirectResponse("https://169.254.169.254/latest/meta-data", 302));
    const result = await canonicalizeTikTokLink("https://vt.tiktok.com/ZSabc");
    expect(result).toEqual({ ok: false, error: TH_SHORT_LINK_FAILED });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a redirect to a named 'localhost' host is rejected", async () => {
    const fetchMock = stubFetchSequence(redirectResponse("https://localhost/admin", 302));
    const result = await canonicalizeTikTokLink("https://vt.tiktok.com/ZSabc");
    expect(result).toEqual({ ok: false, error: TH_SHORT_LINK_FAILED });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a redirect to the IPv6 loopback literal (::1) is rejected", async () => {
    const fetchMock = stubFetchSequence(redirectResponse("https://[::1]/admin", 302));
    const result = await canonicalizeTikTokLink("https://vt.tiktok.com/ZSabc");
    expect(result).toEqual({ ok: false, error: TH_SHORT_LINK_FAILED });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a redirect to 'tiktok.com.evil.net' (substring, not a real subdomain) is rejected", async () => {
    const fetchMock = stubFetchSequence(redirectResponse("https://tiktok.com.evil.net/@user/video/1", 302));
    const result = await canonicalizeTikTokLink("https://vt.tiktok.com/ZSabc");
    expect(result).toEqual({ ok: false, error: TH_SHORT_LINK_FAILED });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("the initial fetch itself is rejected (no network) when the short link URL is http://, not https://", async () => {
    // Applying the same https-only rule to hop 0 as every later hop — see
    // tiktok-link.ts's isSafeHopUrl comment. A plaintext request to resolve
    // a short link has no legitimate reason to exist, and this keeps ONE
    // safety check covering every hop instead of a special first-hop case.
    const fetchMock = stubFetchMustNotBeCalled();
    const result = await canonicalizeTikTokLink("http://vt.tiktok.com/ZSabc");
    expect(result).toEqual({ ok: false, error: TH_SHORT_LINK_FAILED });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("redirect loop guard — max 5 hops (ห้ามผ่าน)", () => {
  it("6 chained redirects (never landing) is rejected as too many redirects", async () => {
    const fetchMock = stubFetchSequence(
      redirectResponse("https://www.tiktok.com/hop1", 302),
      redirectResponse("https://www.tiktok.com/hop2", 302),
      redirectResponse("https://www.tiktok.com/hop3", 302),
      redirectResponse("https://www.tiktok.com/hop4", 302),
      redirectResponse("https://www.tiktok.com/hop5", 302),
      redirectResponse("https://www.tiktok.com/hop6", 302) // the 6th hop — must NOT be followed
    );
    const result = await canonicalizeTikTokLink("https://vt.tiktok.com/ZSabc");
    expect(result).toEqual({ ok: false, error: TH_SHORT_LINK_FAILED });
    // 6 fetches observed (initial + 5 follows); the 6th response is a
    // redirect too but is rejected before a 7th fetch would ever happen.
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("exactly 5 redirects then a landing page succeeds — the boundary must NOT be off-by-one (ห้ามพัง)", async () => {
    const fetchMock = stubFetchSequence(
      redirectResponse("https://www.tiktok.com/hop1", 302),
      redirectResponse("https://www.tiktok.com/hop2", 302),
      redirectResponse("https://www.tiktok.com/hop3", 302),
      redirectResponse("https://www.tiktok.com/hop4", 302),
      redirectResponse("https://www.tiktok.com/@3jjewelry/video/321", 302), // 5th redirect lands here
      finalResponse(200)
    );
    const result = await canonicalizeTikTokLink("https://vt.tiktok.com/ZSabc");
    expect(result).toEqual({ ok: true, url: "https://www.tiktok.com/@3jjewelry/video/321" });
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });
});

// ---- network failure paths — must reject with an actionable message, --
// ---- never silently fall back to storing the raw short link -----------

describe("network failures — reject with an actionable message, never silently store the short link (ห้ามผ่าน)", () => {
  it("fetch throwing a network error is rejected with the short-link-failed message", async () => {
    const fetchMock = stubFetchRejecting(new TypeError("fetch failed"));
    const result = await canonicalizeTikTokLink("https://vt.tiktok.com/ZSabc");
    expect(result).toEqual({ ok: false, error: TH_SHORT_LINK_FAILED });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fetch aborting on the shared timeout is rejected with the short-link-failed message", async () => {
    const abortError = new DOMException("The operation was aborted.", "AbortError");
    stubFetchRejecting(abortError);
    const result = await canonicalizeTikTokLink("https://vt.tiktok.com/ZSabc");
    expect(result).toEqual({ ok: false, error: TH_SHORT_LINK_FAILED });
  });

  it("a 404 response is rejected, not stored as the short link", async () => {
    stubFetchSequence(finalResponse(404));
    const result = await canonicalizeTikTokLink("https://vt.tiktok.com/ZSabc");
    expect(result).toEqual({ ok: false, error: TH_SHORT_LINK_FAILED });
  });

  it("a 500 response is rejected, not stored as the short link", async () => {
    stubFetchSequence(finalResponse(500));
    const result = await canonicalizeTikTokLink("https://vt.tiktok.com/ZSabc");
    expect(result).toEqual({ ok: false, error: TH_SHORT_LINK_FAILED });
  });

  it("a redirect response with no Location header is rejected", async () => {
    const noLocationRedirect = {
      status: 302,
      headers: new Headers(),
      body: throwingBody(),
      text: () => {
        throw new Error("must not read body");
      },
      json: () => {
        throw new Error("must not read body");
      },
    } as unknown as Response;
    stubFetchSequence(noLocationRedirect);
    const result = await canonicalizeTikTokLink("https://vt.tiktok.com/ZSabc");
    expect(result).toEqual({ ok: false, error: TH_SHORT_LINK_FAILED });
  });

  it("a redirect response with an unparseable Location header is rejected", async () => {
    stubFetchSequence(redirectResponse("http://[not a valid url", 302));
    const result = await canonicalizeTikTokLink("https://vt.tiktok.com/ZSabc");
    expect(result).toEqual({ ok: false, error: TH_SHORT_LINK_FAILED });
  });
});

// ---- response body is never read ---------------------------------------

describe("response body is never read (ข้อบังคับเรื่อง network)", () => {
  it("a full successful resolution (redirect + landing page) never calls .text()/.json() on either response", async () => {
    // redirectResponse()/finalResponse() throw if .text()/.json() is ever
    // called — this test passing at all (not throwing) IS the proof.
    stubFetchSequence(
      redirectResponse("https://www.tiktok.com/@3jjewelry/video/1", 302),
      finalResponse(200)
    );
    const result = await canonicalizeTikTokLink("https://vt.tiktok.com/ZSabc");
    expect(result.ok).toBe(true);
  });
});

// ---- PII discipline in logs ----------------------------------------------

describe("logging never includes the full destination URL / query string (PII)", () => {
  it("a redirect Location carrying TikTok account identifiers never appears in any console.error call", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    stubFetchSequence(
      redirectResponse(
        "https://www.tiktok.com/@3jjewelry/live?sec_user_id=SECRET_SEC_USER_ID&share_from_user_id=SECRET_SHARE_ID",
        302
      ),
      finalResponse(200)
    );
    const result = await canonicalizeTikTokLink("https://vt.tiktok.com/ZSabc");
    expect(result).toEqual({ ok: false, error: TH_LIVE_LINK });

    const serialized = JSON.stringify(consoleSpy.mock.calls);
    expect(serialized).not.toContain("SECRET_SEC_USER_ID");
    expect(serialized).not.toContain("SECRET_SHARE_ID");
  });
});

// ---- round-trip: canonical post_url stored -> re-derive matches (ห้ามพัง) --

describe("round-trip — updateContentPostType's drift assert must still hold once post_url is canonical", () => {
  it("canonicalizing an already-canonical URL a second time (as if re-read from DB) is idempotent and needs no network", async () => {
    // Simulates: upsertContentPost stores canonicalPostUrl (from a short
    // link) -> owner later edits content_type_code -> updateContentPostType
    // re-derives from the STORED post_url (now canonical) and compares
    // against the stored external_id. Both steps must agree without a
    // second network call.
    stubFetchSequence(
      redirectResponse("https://www.tiktok.com/@3jjewelry/video/7688660180707446023", 301),
      finalResponse(200)
    );
    const firstSave = await canonicalizeTikTokLink("https://vt.tiktok.com/ZSbYUGv9e");
    expect(firstSave.ok).toBe(true);
    if (!firstSave.ok) return;

    const storedPostUrl = firstSave.url;
    const storedExternalId = deriveExternalId(storedPostUrl);

    // Re-run as if this were a later edit reading the row back from DB —
    // must NOT need the network this time (already-canonical path).
    const fetchMockOnSecondRun = stubFetchMustNotBeCalled();
    const reCanonicalized = await canonicalizeTikTokLink(storedPostUrl);
    expect(reCanonicalized).toEqual({ ok: true, url: storedPostUrl });
    expect(fetchMockOnSecondRun).not.toHaveBeenCalled();

    if (reCanonicalized.ok) {
      expect(deriveExternalId(reCanonicalized.url)).toBe(storedExternalId);
    }
  });
});
