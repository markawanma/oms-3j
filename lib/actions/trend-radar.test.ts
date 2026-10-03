// lib/actions/trend-radar.test.ts
//
// global.fetch is ALWAYS mocked — never a real GitHub request, same hard
// rule this repo already applies to TikTok (lib/marketing/tiktok-oembed.
// test.ts's header). getEffectiveRole is mocked the same way
// lib/actions/content.test.ts/oem.test.ts do it, so this file never touches
// the real "server-only" lib/auth/role module.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getEffectiveRoleMock = vi.fn();

vi.mock("@/lib/auth/role", () => ({
  getEffectiveRole: () => getEffectiveRoleMock(),
}));

const LISTING_URL =
  "https://api.github.com/repos/markawanma/oms-3j/contents/docs/3j-jewelry/marketing/trend-radar?ref=trend-radar-feed";

// Fix 1 (private-repo support): per-day content now goes through the same
// Contents API as the listing — api.github.com, NOT raw.githubusercontent.com
// (that CDN domain doesn't reliably serve private repos even with a token).
function contentUrlFor(name: string): string {
  return `https://api.github.com/repos/markawanma/oms-3j/contents/docs/3j-jewelry/marketing/trend-radar/${name}?ref=trend-radar-feed`;
}

function listingItem(name: string, type: "file" | "dir" = "file") {
  return { name, type, path: `docs/3j-jewelry/marketing/trend-radar/${name}`, sha: "x", size: 1 };
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: new Headers(headers),
  } as unknown as Response;
}

function textResponse(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
    json: () => Promise.reject(new Error("not json")),
    headers: new Headers(headers),
  } as unknown as Response;
}

const NOTHING_NEW_MD = `# Trend Radar — test
## วันนี้ไม่มีอะไรใหม่

ไม่มีมุมไหนผ่านเกณฑ์วันนี้
`;

// Fix 1 — GITHUB_TRENDRADAR_TOKEN must never leak into the suite from
// whatever shell ran `vitest`, and must be restored after, same save/restore
// shape as lib/auth/role.test.ts's AUTH_GATE handling.
const originalGithubToken = process.env.GITHUB_TRENDRADAR_TOKEN;

beforeEach(() => {
  vi.clearAllMocks();
  getEffectiveRoleMock.mockResolvedValue("owner");
  delete process.env.GITHUB_TRENDRADAR_TOKEN;
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalGithubToken === undefined) delete process.env.GITHUB_TRENDRADAR_TOKEN;
  else process.env.GITHUB_TRENDRADAR_TOKEN = originalGithubToken;
});

describe("getTrendRadarFeed — gate", () => {
  it("staff is rejected before any fetch call at all", async () => {
    getEffectiveRoleMock.mockResolvedValue("staff");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { getTrendRadarFeed } = await import("./trend-radar");
    const result = await getTrendRadarFeed();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("เจ้าของร้าน/แอดมิน");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("owner and admin both pass the gate (fetch gets called)", async () => {
    for (const role of ["owner", "admin"]) {
      vi.clearAllMocks();
      getEffectiveRoleMock.mockResolvedValue(role);
      const fetchMock = vi.fn(async (url: string) => {
        if (url === LISTING_URL) return jsonResponse([]);
        throw new Error("unexpected url " + url);
      });
      vi.stubGlobal("fetch", fetchMock);

      const { getTrendRadarFeed } = await import("./trend-radar");
      const result = await getTrendRadarFeed();
      expect(result.ok).toBe(true);
      expect(fetchMock).toHaveBeenCalled();
    }
  });
});

describe("getTrendRadarFeed — happy path", () => {
  it("lists, fetches each file's raw content, parses, returns newest-first", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === LISTING_URL) {
        return jsonResponse([
          listingItem("2026-09-23.md"),
          listingItem("2026-09-27.md"),
          listingItem("README.md"), // not a day file — must be filtered out, no fetch for it
          listingItem("subdir", "dir"), // a directory entry — must be filtered out too
        ]);
      }
      if (url === contentUrlFor("2026-09-23.md")) return textResponse("## มุมที่หยิบไปทำได้เลย\n**1. ทดสอบ**\n- **ประเภท:** craft\n");
      if (url === contentUrlFor("2026-09-27.md")) return textResponse(NOTHING_NEW_MD);
      throw new Error("unexpected url " + url);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { getTrendRadarFeed } = await import("./trend-radar");
    const result = await getTrendRadarFeed();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.map((d) => d.date)).toEqual(["2026-09-27", "2026-09-23"]); // newest first
    expect(result.data.find((d) => d.date === "2026-09-23")?.angles[0]?.contentTypeCode).toBe("craft");
    expect(result.data.find((d) => d.date === "2026-09-27")?.hasNothing).toBe(true);

    // README.md and the directory entry must never have been fetched.
    const fetchedUrls = fetchMock.mock.calls.map((c) => c[0]);
    expect(fetchedUrls).not.toContain(contentUrlFor("README.md"));
    expect(fetchedUrls.some((u) => String(u).includes("subdir"))).toBe(false);
  });

  it("respects the limit argument (only the N most recent file names are fetched)", async () => {
    const names = ["2026-09-23.md", "2026-09-24.md", "2026-09-27.md", "2026-09-28.md", "2026-09-29.md"];
    const fetchMock = vi.fn(async (url: string) => {
      if (url === LISTING_URL) return jsonResponse(names.map((n) => listingItem(n)));
      return textResponse(NOTHING_NEW_MD);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { getTrendRadarFeed } = await import("./trend-radar");
    const result = await getTrendRadarFeed(2);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.map((d) => d.date)).toEqual(["2026-09-29", "2026-09-28"]);
  });

  it("an empty-but-valid listing (no day files at all) is a success with an empty array, not an error", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === LISTING_URL) return jsonResponse([]);
      throw new Error("unexpected url " + url);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { getTrendRadarFeed } = await import("./trend-radar");
    const result = await getTrendRadarFeed();
    expect(result).toEqual({ ok: true, data: [] });
  });
});

describe("getTrendRadarFeed — partial content failures are tolerated", () => {
  it("one file's raw content fetch failing skips that day but still returns the rest", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === LISTING_URL) return jsonResponse([listingItem("2026-09-27.md"), listingItem("2026-09-28.md")]);
      if (url === contentUrlFor("2026-09-27.md")) return textResponse(NOTHING_NEW_MD);
      if (url === contentUrlFor("2026-09-28.md")) return jsonResponse({}, 500); // .ok === false
      throw new Error("unexpected url " + url);
    });
    vi.stubGlobal("fetch", fetchMock);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { getTrendRadarFeed } = await import("./trend-radar");
    const result = await getTrendRadarFeed();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(1);
    expect(result.data[0].date).toBe("2026-09-27");
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("every file's content fetch failing -> ok:false with a readable Thai error, no throw", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === LISTING_URL) return jsonResponse([listingItem("2026-09-27.md")]);
      return jsonResponse({}, 500);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { getTrendRadarFeed } = await import("./trend-radar");
    const result = await getTrendRadarFeed();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(typeof result.error).toBe("string");
    expect(result.error.length).toBeGreaterThan(0);
  });
});

describe("getTrendRadarFeed — listing failures never throw", () => {
  it("listing fetch rejecting (network error/timeout) -> ok:false, readable Thai error", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { getTrendRadarFeed } = await import("./trend-radar");
    const result = await getTrendRadarFeed();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("GitHub");
  });

  it("listing 404 -> ok:false with a branch/path-specific message", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ message: "Not Found" }, 404));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { getTrendRadarFeed } = await import("./trend-radar");
    const result = await getTrendRadarFeed();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("trend-radar-feed");
  });

  it("listing 500 -> ok:false, status surfaced in the message", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, 500));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { getTrendRadarFeed } = await import("./trend-radar");
    const result = await getTrendRadarFeed();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("500");
  });

  it("listing body that parses but isn't an array -> ok:false, no throw", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ message: "not an array" }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { getTrendRadarFeed } = await import("./trend-radar");
    const result = await getTrendRadarFeed();
    expect(result.ok).toBe(false);
  });

  it("listing body that isn't valid JSON -> ok:false, no throw", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: () => Promise.reject(new SyntaxError("bad json")),
    }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { getTrendRadarFeed } = await import("./trend-radar");
    const result = await getTrendRadarFeed();
    expect(result.ok).toBe(false);
  });
});

describe("getTrendRadarFeed — every GitHub request is cache: 'no-store'", () => {
  it("the listing request opts out of Next.js's fetch cache", async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url === LISTING_URL) return jsonResponse([]);
      throw new Error("unexpected url " + url);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { getTrendRadarFeed } = await import("./trend-radar");
    await getTrendRadarFeed();

    const [, init] = fetchMock.mock.calls[0];
    expect(init?.cache).toBe("no-store");
  });
});

describe("getTrendRadarFeed — optional auth token (Fix 1, backward-compatible)", () => {
  it("no GITHUB_TRENDRADAR_TOKEN set -> every request has no authorization header at all", async () => {
    // beforeEach already deletes the env var, but this test asserts the
    // behavior explicitly rather than relying on that as an implicit given —
    // this is the exact "repo still public, owner hasn't made a token yet"
    // state the fix must not break.
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url === LISTING_URL) return jsonResponse([listingItem("2026-09-27.md")]);
      if (url === contentUrlFor("2026-09-27.md")) return textResponse(NOTHING_NEW_MD);
      throw new Error("unexpected url " + url);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { getTrendRadarFeed } = await import("./trend-radar");
    const result = await getTrendRadarFeed();

    expect(result.ok).toBe(true);
    for (const call of fetchMock.mock.calls) {
      const init = call[1];
      const headers = new Headers(init?.headers);
      expect(headers.has("authorization")).toBe(false);
    }
  });

  it("GITHUB_TRENDRADAR_TOKEN set -> every GitHub request (listing AND per-file content) carries it as a Bearer header", async () => {
    process.env.GITHUB_TRENDRADAR_TOKEN = "fake-fine-grained-pat-for-test-only";
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url === LISTING_URL) return jsonResponse([listingItem("2026-09-27.md")]);
      if (url === contentUrlFor("2026-09-27.md")) return textResponse(NOTHING_NEW_MD);
      throw new Error("unexpected url " + url);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { getTrendRadarFeed } = await import("./trend-radar");
    const result = await getTrendRadarFeed();

    expect(result.ok).toBe(true);
    expect(fetchMock.mock.calls).toHaveLength(2); // listing + 1 file — both must be checked, not just one
    for (const call of fetchMock.mock.calls) {
      const init = call[1];
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer fake-fine-grained-pat-for-test-only");
    }
  });

  it("the per-file content request's accept header asks for raw content via the Contents API, not the old raw.githubusercontent.com host", async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url === LISTING_URL) return jsonResponse([listingItem("2026-09-27.md")]);
      if (url === contentUrlFor("2026-09-27.md")) return textResponse(NOTHING_NEW_MD);
      throw new Error("unexpected url " + url);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { getTrendRadarFeed } = await import("./trend-radar");
    await getTrendRadarFeed();

    const contentCall = fetchMock.mock.calls.find((c) => c[0] === contentUrlFor("2026-09-27.md"));
    expect(contentCall).toBeDefined();
    const headers = new Headers(contentCall?.[1]?.headers);
    expect(headers.get("accept")).toBe("application/vnd.github.raw+json");
    // The old channel must be fully gone, not just unused by accident.
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("raw.githubusercontent.com"))).toBe(false);
  });
});

describe("getTrendRadarFeed — oversized file guard (Fix 2)", () => {
  // Mirrors the private MAX_FILE_CHARS constant in trend-radar.ts — kept as
  // a literal here rather than imported since the constant is intentionally
  // not exported (no other module needs it).
  const MAX_FILE_CHARS = 256 * 1024;

  it("a content-length header reporting an oversized file skips that day WITHOUT needing to read an actually-huge body", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === LISTING_URL) return jsonResponse([listingItem("2026-09-27.md"), listingItem("2026-09-28.md")]);
      if (url === contentUrlFor("2026-09-27.md")) return textResponse(NOTHING_NEW_MD);
      if (url === contentUrlFor("2026-09-28.md")) {
        // Body itself is tiny — only the header lies about size, proving the
        // guard trips on content-length rather than silently passing because
        // the mock body happens to be short.
        return textResponse("tiny", 200, { "content-length": String(MAX_FILE_CHARS + 1) });
      }
      throw new Error("unexpected url " + url);
    });
    vi.stubGlobal("fetch", fetchMock);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { getTrendRadarFeed } = await import("./trend-radar");
    const result = await getTrendRadarFeed();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(1);
    expect(result.data[0].date).toBe("2026-09-27");
    expect(consoleSpy).toHaveBeenCalledWith(
      "getTrendRadarFeed: one file's content fetch failed, skipping that day",
      expect.objectContaining({ reason: expect.stringContaining("too large") })
    );
  });

  it("an actually oversized body is rejected even when content-length is absent (header lying the other way / missing)", async () => {
    const hugeBody = "a".repeat(MAX_FILE_CHARS + 1);
    const fetchMock = vi.fn(async (url: string) => {
      if (url === LISTING_URL) return jsonResponse([listingItem("2026-09-27.md"), listingItem("2026-09-28.md")]);
      if (url === contentUrlFor("2026-09-27.md")) return textResponse(NOTHING_NEW_MD);
      if (url === contentUrlFor("2026-09-28.md")) return textResponse(hugeBody); // no content-length header at all
      throw new Error("unexpected url " + url);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { getTrendRadarFeed } = await import("./trend-radar");
    const result = await getTrendRadarFeed();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(1);
    expect(result.data[0].date).toBe("2026-09-27");
  });

  it("a file right at the limit still renders (boundary is 'over', not 'at')", async () => {
    const exactlyAtLimit = `## วันนี้ไม่มีอะไรใหม่\n` + "x".repeat(MAX_FILE_CHARS - 40);
    const fetchMock = vi.fn(async (url: string) => {
      if (url === LISTING_URL) return jsonResponse([listingItem("2026-09-27.md")]);
      if (url === contentUrlFor("2026-09-27.md")) return textResponse(exactlyAtLimit);
      throw new Error("unexpected url " + url);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { getTrendRadarFeed } = await import("./trend-radar");
    const result = await getTrendRadarFeed();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(1);
  });
});
