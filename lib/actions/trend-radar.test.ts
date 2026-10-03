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

function rawUrlFor(name: string): string {
  return `https://raw.githubusercontent.com/markawanma/oms-3j/trend-radar-feed/docs/3j-jewelry/marketing/trend-radar/${name}`;
}

function listingItem(name: string, type: "file" | "dir" = "file") {
  return { name, type, path: `docs/3j-jewelry/marketing/trend-radar/${name}`, sha: "x", size: 1 };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

function textResponse(body: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
    json: () => Promise.reject(new Error("not json")),
  } as unknown as Response;
}

const NOTHING_NEW_MD = `# Trend Radar — test
## วันนี้ไม่มีอะไรใหม่

ไม่มีมุมไหนผ่านเกณฑ์วันนี้
`;

beforeEach(() => {
  vi.clearAllMocks();
  getEffectiveRoleMock.mockResolvedValue("owner");
});

afterEach(() => {
  vi.unstubAllGlobals();
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
      if (url === rawUrlFor("2026-09-23.md")) return textResponse("## มุมที่หยิบไปทำได้เลย\n**1. ทดสอบ**\n- **ประเภท:** craft\n");
      if (url === rawUrlFor("2026-09-27.md")) return textResponse(NOTHING_NEW_MD);
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
    expect(fetchedUrls).not.toContain(rawUrlFor("README.md"));
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
      if (url === rawUrlFor("2026-09-27.md")) return textResponse(NOTHING_NEW_MD);
      if (url === rawUrlFor("2026-09-28.md")) return jsonResponse({}, 500); // .ok === false
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
