// lib/site/tools-host.test.ts — กฎ host tools.3jthailand.com (design-tools-hub §4: T1–T12 ต้องไม่ผ่าน · N1–N6 ต้องไม่พัง)
// 🔴 ห้ามเขียน regex จำลองเอง: redirects() ผ่าน getPathMatch + modifyRouteRegex + matchHas ของ Next ตัวเดียวกับที่ next start ใช้
//    (next/dist/server/lib/router-utils/filesystem.js buildCustomRoute · resolve-routes.js) · middleware ผ่านฟังก์ชัน middleware จริง
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as pageStaticInfo from "next/dist/build/analysis/get-page-static-info";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import { matchHas } from "next/dist/shared/lib/router/utils/prepare-destination";
import { modifyRouteRegex } from "next/dist/lib/redirect-status";
import nextConfig from "../../next.config.mjs";
import { config as mwConfig, middleware } from "../../middleware";
import { getMiddlewareRouteMatcher } from "next/dist/shared/lib/router/utils/middleware-route-matcher";
import { isExemptPath } from "../auth/exempt-path";
import { APP_HOST, TOOLS_HOST, TOOLS_ORIGIN, TOOLS_PASSTHROUGH_ALTERNATIVES, isToolsHost, isToolsPassthroughPath, normalizeHost } from "./hosts";

type Has = { type: "host"; value: string };
type Redirect = { source: string; has?: Has[]; destination: string; permanent: boolean };
type HeaderRule = { source: string; has?: Has[]; headers: Array<{ key: string; value: string }> };

const cfg = nextConfig as unknown as { redirects: () => Promise<Redirect[]>; headers: () => Promise<HeaderRule[]> };

/** คืน destination ถ้า redirects() ของ Next จะส่ง request นี้ไปที่อื่น — null = ไม่ redirect */
async function redirectFor(host: string, pathname: string, extra: Record<string, string> = {}): Promise<string | null> {
  for (const item of await cfg.redirects()) {
    const match = getPathMatch(item.source, {
      strict: true,
      removeUnnamedParams: true,
      regexModifier: (r: string) => modifyRouteRegex(r, ["/_next"]),
      sensitive: false,
    });
    const params = match(pathname);
    if (!params) continue;
    if (item.has && !matchHas({ headers: { host, ...extra } } as never, {}, item.has, [])) continue;
    return item.destination;
  }
  return null;
}

async function toolsHeadersFor(host: string, pathname: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const rule of await cfg.headers()) {
    const match = getPathMatch(rule.source, { strict: true, removeUnnamedParams: true, sensitive: false });
    if (!match(pathname)) continue;
    if (rule.has && !matchHas({ headers: { host } } as never, {}, rule.has, [])) continue;
    for (const h of rule.headers) out[h.key] = h.value;
  }
  return out;
}

const getMiddlewareMatchers = (
  pageStaticInfo as unknown as { getMiddlewareMatchers: (m: unknown, c: Record<string, unknown>) => Array<{ regexp: string }> }
).getMiddlewareMatchers;
function middlewareRuns(pathname: string): boolean {
  const mw = readFileSync(join(process.cwd(), "middleware.ts"), "utf8");
  const src = JSON.parse(`"${/matcher:\s*\[\s*"([^"]+)"/.exec(mw)![1]}"`) as string;
  const [m] = getMiddlewareMatchers(src, {} as never);
  return new RegExp(m.regexp).test(pathname);
}

const T = TOOLS_HOST;
const TOKEN = "Ab3-_xYz0123456789AbCdEfGhIjKlMnOpQrStUvWxY";

describe("hosts.ts — normalizeHost / isToolsHost (T9 · T11)", () => {
  it.each([
    ["tools.3jthailand.com", true],
    ["TOOLS.3JTHAILAND.COM", true],
    ["tools.3jthailand.com.", true],
    ["tools.3jthailand.com:443", true],
    ["Tools.3jthailand.com.:8080", true],
    ["evil-tools.3jthailand.com", false],
    ["xtools.3jthailand.com", false],
    ["tools.3jthailand.com.evil.com", false],
    ["tools.3jthailand.com..", false],
    ["app.3jthailand.com", false],
    ["3jthailand.com", false],
    ["oms-3j.vercel.app", false],
    ["localhost:3000", false],
    ["", false],
    [" tools.3jthailand.com", false],
    ["tools.3jthailand.com/x", false],
    ["tools.3jthailand.com@evil.com", false],
    ["[::1]", false],
  ])("%j → %s", (host, expected) => {
    expect(isToolsHost(host)).toBe(expected);
  });
  it("null/undefined → ไม่ใช่ tools.", () => {
    expect(isToolsHost(null)).toBe(false);
    expect(isToolsHost(undefined)).toBe(false);
    expect(normalizeHost(null)).toBeNull();
  });
  it("ค่าคงที่ตรงกัน", () => {
    expect(TOOLS_ORIGIN).toBe(`https://${TOOLS_HOST}`);
    expect(APP_HOST).toBe("app.3jthailand.com");
  });
});

describe("next.config.mjs — literal host ตรงกับ TOOLS_HOST (กัน drift)", () => {
  it("TOOLS_HOST_REGEX ผ่าน RegExp anchored แล้วตรง TOOLS_HOST เท่านั้น", async () => {
    const mod = (await import("../../next.config.mjs")) as unknown as { TOOLS_HOST_REGEX: string };
    const re = new RegExp(`^${mod.TOOLS_HOST_REGEX}$`);
    expect(re.test(TOOLS_HOST)).toBe(true);
    expect(re.test(`${TOOLS_HOST}.`)).toBe(true);
    for (const bad of ["evil-tools.3jthailand.com", "xtools.3jthailand.com", `${TOOLS_HOST}.evil.com`, "toolsX3jthailandYcom", "app.3jthailand.com", `${TOOLS_HOST}..`]) {
      expect(re.test(bad), bad).toBe(false);
    }
  });
});

describe("redirects ชั้น (1) บน tools. — ผ่านฟังก์ชันของ Next จริง", () => {
  it("2 rule (Next-Action + นอก allowlist) · ทุกตัว 307 (permanent=false) · destination '/' · ผูก host tools. เสมอ", async () => {
    const r = await cfg.redirects();
    expect(r).toHaveLength(2);
    for (const x of r) {
      expect(x.permanent).toBe(false);
      expect(x.destination).toBe("/");
      expect(x.has?.[0]).toEqual({ type: "host", value: expect.any(String) });
    }
  });

  // T8: Next หา action ตาม id จากทุก worker (พบจริงบน next start) — header next-action บน tools. ต้องถูกตัดก่อนถึง handler ทุก path รวมหน้าลูกค้า
  it.each(["/ring-size", "/gem-quiz", "/ring-builder", "/api/gem-quiz/submit", "/dashboard"])("T8: POST %s + Next-Action บน tools. → '/'", async (p) => {
    expect(await redirectFor(T, p, { "next-action": "004083b42856f862733af2932e6508a77377c0a638" })).toBe("/");
  });
  it("T8: POST '/' + Next-Action ไม่ถูก redirect ชั้น (1) (กันวนตัวเอง) — ตกชั้น (2) ได้ 405 (ดู middleware test)", async () => {
    expect(await redirectFor(T, "/", { "next-action": "x" })).toBeNull();
  });
  it("T8: บน app./localhost ไม่โดน (ไม่เปลี่ยนพฤติกรรมเดิม N1/N2)", async () => {
    for (const h of [APP_HOST, "localhost:3000", "evil-tools.3jthailand.com"]) expect(await redirectFor(h, "/ring-size", { "next-action": "x" }), h).toBeNull();
  });

  // T1–T7: ทุกอย่างนอก allowlist → "/"
  it.each([
    // T1
    "/dashboard", "/catalog/x", "/oem", "/jobs/1/print", "/orders/x.png",
    // T2
    "/login", "/register", "/pending",
    // T3 — middleware ไม่รัน path พวกนี้ → ชั้น (1) เท่านั้นที่กัน
    "/shop", "/shop/abc", "/stock/hero", `/w/${TOKEN}`, `/w/s/${TOKEN}`,
    // T4
    "/api/webhooks/x", "/api/webhooks/tiktok", "/api/ring-size", "/api/ring-size/event/x", "/api/ring-builder/quote/x", "/api/gem-quiz/submitx", "/api/gem-quiz", "/api/ring-builder",
    // T7
    "/ring-size/x", "/gem-quiz/deep/x.png", "/ring-builders", "/ring-sizes", "/tools/x", "/toolsx", "/tools", "/tools/", "/ring-size-admin",
    // T6
    "/ring-size/../dashboard", "/ring-size/..%2fdashboard", "/%2e%2e/dashboard", "//dashboard", "/ring-size//", "/ring-size/%2e%2e/dashboard",
    // อื่นๆ
    "/index", "/robots.txt", "/sitemap.xml", "/x/y.png", "/gem-quiz/a/b.png", "/ring-size/a/b.png",
  ])("%s → '/'", async (p) => {
    expect(await redirectFor(T, p)).toBe("/");
  });

  // Next กัน redirects() ไม่ให้แตะทุก path ที่ขึ้นต้น `/_next` (modifyRouteRegex) — look-alike เหล่านี้จึงตกชั้น (2): matcher ต้องรัน middleware แล้วได้ 307
  it.each(["/_nextx/static/a.js", "/_next-static/x", "/_next"])("look-alike %s: ชั้น (1) ไม่แตะ แต่ matcher รัน middleware (ชั้น 2 จับ)", async (p) => {
    expect(await redirectFor(T, p)).toBeNull();
    expect(middlewareRuns(p)).toBe(true);
    expect((await middleware(new NextRequest(`http://localhost:3000${p}`, { headers: { host: T } }))).status).toBe(307);
  });

  // N4 — ต้องไม่ถูก redirect (เปิดได้บน tools.)
  it.each([
    "/", "/ring-size", "/ring-size/", "/gem-quiz", "/gem-quiz/", "/ring-builder", "/ring-builder/",
    "/api/gem-quiz/submit", "/api/gem-quiz/submit/", "/api/ring-size/event", "/api/ring-builder/quote",
    "/_next/static/chunks/main.js", "/_next/image",
    "/3j-logo.png", "/3j-logo.svg", "/favicon.ico", "/gem-quiz/og.png", "/ring-size/og.png", "/ring-size/3j-mark.png",
  ])("N4: %s → ไม่ redirect", async (p) => {
    expect(await redirectFor(T, p)).toBeNull();
  });

  // T5 — ตัวพิมพ์ใหญ่: redirects ของ Next ไม่สนตัวพิมพ์ (sensitive:false) → ชั้น (2) ใน middleware ต้องจับ (ดู middleware test ด้านล่าง)
  it.each(["/RING-SIZE", "/Gem-Quiz", "/Ring-Builder"])("T5: %s ผ่านชั้น (1) ได้ แต่ matcher ของ middleware ต้องรัน (ถูก gate/ชั้น 2)", async (p) => {
    expect(middlewareRuns(p)).toBe(true);
  });
  it("T5: /Dashboard → '/'", async () => {
    expect(await redirectFor(T, "/Dashboard")).toBe("/");
  });

  // T9 — ทุกรูปแบบ host ของ tools. ต้องได้พฤติกรรมเดียวกัน
  it.each(["TOOLS.3JTHAILAND.COM", "tools.3jthailand.com.", "tools.3jthailand.com:443", "Tools.3jthailand.com.:8080"])("T9: Host %s → /dashboard ถูก redirect", async (h) => {
    expect(await redirectFor(h, "/dashboard")).toBe("/");
    expect(await redirectFor(h, "/shop")).toBe("/");
  });

  // T11 / N1-N3 — host อื่นไม่โดนกฎเลย
  it.each(["evil-tools.3jthailand.com", "tools.3jthailand.com.evil.com", "xtools.3jthailand.com", "app.3jthailand.com", "oms-3j.vercel.app", "localhost:3000", "3jthailand.com"])(
    "T11/N2: Host %s ไม่โดนกฎ tools. (dashboard · shop · w/* คงเดิม)",
    async (h) => {
      for (const p of ["/dashboard", "/shop", `/w/${TOKEN}`, "/api/webhooks/x", "/login", "/tools"]) expect(await redirectFor(h, p), `${h} ${p}`).toBeNull();
    },
  );
});

describe("regex 3 ก้อนต้องตรงกัน — allowlist (1) · matcher · mirror", () => {
  const CUSTOMER_PATHS = [
    "/ring-size", "/ring-size/", "/gem-quiz", "/gem-quiz/", "/ring-builder", "/ring-builder/",
    "/api/gem-quiz/submit", "/api/ring-size/event", "/api/ring-builder/quote",
    "/_next/static/x.js", "/_next/image", "/3j-logo.png", "/favicon.ico", "/gem-quiz/og.png", "/ring-size/og.png", "/ring-size/3j-mark.png",
  ];
  it.each(CUSTOMER_PATHS)("%s อยู่ใน allowlist (ไม่ redirect บน tools.) และ exempt ใน matcher ด้วย", async (p) => {
    expect(await redirectFor(T, p)).toBeNull();
    expect(middlewareRuns(p), p).toBe(false);
    expect(isExemptPath(p), p).toBe(true);
  });
  it("path ที่ exempt แต่ไม่ใช่ลูกค้า (shop · stock/hero · w/* · webhooks) ต้องไม่อยู่ใน allowlist", async () => {
    for (const p of ["/shop", "/stock/hero", `/w/${TOKEN}`, `/w/s/${TOKEN}`, "/api/webhooks/x", "/tools"]) {
      expect(isExemptPath(p), p).toBe(true);
      expect(await redirectFor(T, p), p).toBe("/");
    }
  });
});

describe("headers — hub ห้ามฝัง iframe (ทุกทางเข้า)", () => {
  it("'/' บน tools. (หลัง rewrite จึงต้องมี rule แยก) ได้ XFO DENY + CSP frame-ancestors 'none'", async () => {
    const h = await toolsHeadersFor(T, "/");
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["Content-Security-Policy"]).toBe("frame-ancestors 'none'");
  });
  it("'/' บน host อื่น (app. = dashboard) ไม่ได้ header ชุดนี้", async () => {
    expect(await toolsHeadersFor(APP_HOST, "/")).toEqual({});
    expect(await toolsHeadersFor("localhost:3000", "/")).toEqual({});
  });
  it("/tools ทุก host ได้ XFO + CSP", async () => {
    for (const host of [APP_HOST, T, "localhost:3000"]) {
      const h = await toolsHeadersFor(host, "/tools");
      expect(h["X-Frame-Options"], host).toBe("DENY");
      expect(h["Content-Security-Policy"], host).toBe("frame-ancestors 'none'");
    }
  });
  it("header ของ 3 หน้าเดิมไม่เปลี่ยน (ring-size ครบ 3 ตัว · ring-builder 2 ตัว)", async () => {
    expect(Object.keys(await toolsHeadersFor(T, "/ring-size")).sort()).toEqual(["Content-Security-Policy", "Permissions-Policy", "X-Frame-Options"]);
    expect(Object.keys(await toolsHeadersFor(T, "/ring-builder")).sort()).toEqual(["Content-Security-Policy", "X-Frame-Options"]);
  });
});

describe("middleware ชั้น (2) บน tools. — ฟังก์ชันจริง", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    // ตั้ง AUTH_GATE=on แต่ไม่ตั้ง Supabase env — app. จะได้ 503 · tools. ต้องไม่แตะ env เลย (ตัดสิทธิ์อย่างเดียว)
    process.env.AUTH_GATE = "on";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  const req = (host: string, path: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
    new NextRequest(`http://localhost:3000${path}`, { method: init.method ?? "GET", headers: { host, ...(init.headers ?? {}) } });

  it("'/' → rewrite ไป /tools (ไม่ใช่ redirect/login) · ไม่มี set-cookie (T12)", async () => {
    const res = await middleware(req(T, "/"));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-rewrite")).toContain("/tools");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it.each(["/dashboard", "/catalog/x", "/oem", "/jobs/1/print", "/login", "/register", "/pending", "/RING-SIZE", "/Gem-Quiz", "/Dashboard", "/ring-size/..%2fdashboard", "/ring-size/../dashboard", "//dashboard", "/api/foo"])(
    "T1/T2/T5/T6: %s → 307 absolute TOOLS_ORIGIN/ · ไม่ใช่ /login · ไม่มี set-cookie",
    async (p) => {
      const res = await middleware(req(T, p));
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toBe(`${TOOLS_ORIGIN}/`);
      expect(res.headers.get("set-cookie")).toBeNull();
    },
  );

  it.each(["TOOLS.3JTHAILAND.COM", "tools.3jthailand.com.", "tools.3jthailand.com:443"])("T9: Host %s ได้พฤติกรรม tools. (ไม่ตกเป็น app.)", async (h) => {
    expect((await middleware(req(h, "/dashboard"))).status).toBe(307);
    expect((await middleware(req(h, "/"))).headers.get("x-middleware-rewrite")).toContain("/tools");
  });

  it.each(["POST", "PUT", "DELETE", "PATCH"])("T8: %s '/' พร้อม Next-Action → 405 (action ไม่รัน)", async (method) => {
    const res = await middleware(req(T, "/", { method, headers: { "next-action": "deadbeef00", "content-type": "text/plain;charset=UTF-8" } }));
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, HEAD");
    expect(res.headers.get("set-cookie")).toBeNull();
  });
  it("T8: POST path อื่นบน tools. → 307 '/' (ตามไปแล้วชน 405)", async () => {
    expect((await middleware(req(T, "/dashboard", { method: "POST", headers: { "next-action": "x" } }))).status).toBe(307);
  });
  it("HEAD '/' ได้ rewrite เหมือน GET", async () => {
    expect((await middleware(req(T, "/", { method: "HEAD" }))).headers.get("x-middleware-rewrite")).toContain("/tools");
  });

  it.each(["evil-tools.3jthailand.com", "tools.3jthailand.com.evil.com", "xtools.3jthailand.com", "app.3jthailand.com", "oms-3j.vercel.app", "localhost:3000"])(
    "T10/T11/N1/N2: Host %s → ตรรกะ app. เดิม (AUTH_GATE=on + env ขาด = 503 fail-closed ไม่ใช่ hub)",
    async (h) => {
      const res = await middleware(req(h, "/dashboard"));
      expect(res.status).toBe(503);
      expect(res.headers.get("x-middleware-rewrite")).toBeNull();
      const root = await middleware(req(h, "/"));
      expect(root.status).toBe(503);
    },
  );

  it("หลักข้อ 0: Host tools. ปลอมได้แค่ 'เห็นน้อยลง' — ทุก path ที่ gate อยู่ได้ hub/redirect ไม่มีทางได้หน้า", async () => {
    for (const p of ["/dashboard", "/oem", "/settings/members", "/crm", "/live/x.png"]) {
      const res = await middleware(req(T, p));
      expect([307, 200]).toContain(res.status);
      expect(res.headers.get("location") ?? "").not.toContain("/login");
    }
  });
});

// ───────── security M1 (18 พ.ย. 69): ชั้น (2) ต้องครอบ "ทุก path" บน tools. โดยไม่พึ่งชั้น (1) ─────────
type CompiledMatcher = { regexp: string; has?: unknown[]; missing?: unknown[] };
const fullMatchers = () => getMiddlewareMatchers(mwConfig.matcher as unknown, {} as never) as unknown as CompiledMatcher[];
/** middleware "จะรัน" ไหมสำหรับ Host + path — ตัวเดียวกับที่ next start ใช้ (getMiddlewareRouteMatcher + matchHas) */
function middlewareRunsOn(host: string, pathname: string, matchers: CompiledMatcher[] = fullMatchers()): boolean {
  return getMiddlewareRouteMatcher(matchers as never)(pathname, { headers: { host } } as never, {});
}

const LAYER2_ONLY_PATHS = [
  "/shop", "/shop/abc", "/stock/hero", "/stock/hero/", `/w/${TOKEN}`, `/w/s/${TOKEN}`, "/w/x", "/api/webhooks/x", "/api/webhooks/tiktok",
  "/dashboard", "/login", "/tools", "/tools/", "/favicon.ico",
];
const ALLOWED_ON_TOOLS = [
  "/ring-size", "/ring-size/", "/gem-quiz", "/gem-quiz/", "/ring-builder", "/ring-builder/", "/api/gem-quiz/submit", "/api/ring-size/event",
  "/api/ring-builder/quote", "/_next/static/chunks/main.js", "/_next/image", "/3j-logo.png", "/gem-quiz/og.png", "/ring-size/og.png", "/ring-size/3j-mark.png",
];

describe("M1: matcher has-host — middleware รันทุก path บน tools. (รวม path ที่ exempt บน app.)", () => {
  it("matcher มี 2 ตัว: string ฝั่ง app. (ไม่เปลี่ยน) + object has-host ที่ literal ตรง TOOLS_HOST_REGEX", async () => {
    const m = mwConfig.matcher as unknown as Array<string | { source: string; has?: Array<{ type: string; value: string }> }>;
    expect(m).toHaveLength(2);
    expect(typeof m[0]).toBe("string");
    const obj = m[1] as { source: string; has: Array<{ type: string; value: string }> };
    expect(obj.source).toBe("/:path*");
    expect(obj.has).toEqual([{ type: "host", value: ((await import("../../next.config.mjs")) as unknown as { TOOLS_HOST_REGEX: string }).TOOLS_HOST_REGEX }]);
  });

  it.each([...LAYER2_ONLY_PATHS, ...ALLOWED_ON_TOOLS])("tools.: middleware รันที่ %s", (p) => {
    for (const h of [T, "TOOLS.3JTHAILAND.COM", "tools.3jthailand.com.", `${T}:443`]) expect(middlewareRunsOn(h, p), `${h} ${p}`).toBe(true);
  });

  it("app./preview/localhost/host ปลอม: ตัดสินเหมือน matcher เดิม (string ตัวแรก) ทุก path — exempt ยังไม่ผ่าน middleware", () => {
    const appOnly = fullMatchers().slice(0, 1);
    for (const h of [APP_HOST, "oms-3j.vercel.app", "localhost:3000", "evil-tools.3jthailand.com", "tools.3jthailand.com.evil.com", "xtools.3jthailand.com", ""]) {
      for (const p of [...LAYER2_ONLY_PATHS, ...ALLOWED_ON_TOOLS, "/", "/oem", "/RING-SIZE"]) {
        expect(middlewareRunsOn(h, p), `${h} ${p}`).toBe(middlewareRunsOn(h, p, appOnly));
      }
      for (const p of ["/shop", "/stock/hero", `/w/${TOKEN}`, "/api/webhooks/x", "/ring-size", "/tools"]) expect(middlewareRunsOn(h, p), `${h} ${p}`).toBe(false);
    }
  });
});

describe("M1: allowlist ชั้น (2) ตรงกับชั้น (1) (กัน drift 2 รายการ)", () => {
  it("TOOLS_PASSTHROUGH_ALTERNATIVES == TOOLS_ALLOWLIST_ITEMS ของ next.config.mjs ไม่รวม '$' (= hub)", async () => {
    const mod = (await import("../../next.config.mjs")) as unknown as { TOOLS_ALLOWLIST_ITEMS: string[] };
    expect([...TOOLS_PASSTHROUGH_ALTERNATIVES]).toEqual(mod.TOOLS_ALLOWLIST_ITEMS.filter((x) => x !== "$"));
  });
  it("isToolsPassthroughPath: ตรง allowlist · look-alike/ตัวพิมพ์ใหญ่/traversal ไม่ผ่าน", () => {
    for (const p of ALLOWED_ON_TOOLS) expect(isToolsPassthroughPath(p), p).toBe(true);
    for (const p of [
      "/", "/shop", "/w/x", "/api/webhooks/x", "/ring-size/x", "/ring-sizes", "/RING-SIZE", "/Gem-Quiz", "/gem-quiz/deep/x.png", "/_nextx/static/a.js", "/_next/staticx",
      "/ring-size/../dashboard", "/ring-size/..%2fdashboard", "//dashboard", "/api/ring-size", "/api/ring-size/event/x", "/x/y.png", "/tools",
    ]) expect(isToolsPassthroughPath(p), p).toBe(false);
  });
});

describe("M1: ชั้น (2) ทำงานเองโดยไม่พึ่ง redirects() — เรียก middleware() ตรงๆ", () => {
  beforeEach(() => {
    process.env.AUTH_GATE = "on";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  });
  afterEach(() => {
    delete process.env.AUTH_GATE;
  });
  const call = (p: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
    middleware(new NextRequest(`http://localhost:3000${p}`, { method: init.method ?? "GET", headers: { host: T, ...(init.headers ?? {}) } }));

  it.each(["/shop", "/shop/abc", "/stock/hero", `/w/${TOKEN}`, `/w/s/${TOKEN}`, "/w/x", "/api/webhooks/x", "/api/webhooks/tiktok", "/tools", "/tools/x", "/api/ring-size", "/ring-size/x", "/RING-SIZE", "/_nextx/static/a.js"])(
    "%s บน tools. → 307 absolute TOOLS_ORIGIN/ จากชั้น (2) · ไม่มี set-cookie",
    async (p) => {
      const res = await call(p);
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toBe(`${TOOLS_ORIGIN}/`);
      expect(res.headers.get("set-cookie")).toBeNull();
    },
  );
  it.each(ALLOWED_ON_TOOLS)("N4: %s บน tools. → ปล่อยผ่าน (next) ไม่ redirect ไม่ rewrite ไม่ 503 ไม่ set-cookie", async (p) => {
    const res = await call(p);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("set-cookie")).toBeNull();
  });
  it.each(["/ring-size", "/gem-quiz", "/ring-builder", "/api/gem-quiz/submit", "/api/ring-size/event"])("T8: %s + Next-Action บน tools. → 307 '/' จากชั้น (2)", async (p) => {
    const res = await call(p, { method: "POST", headers: { "next-action": "004083b42856f862733af2932e6508a77377c0a638" } });
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(`${TOOLS_ORIGIN}/`);
  });
  it("T8: POST '/' + Next-Action → 405 (แม้เป็น GET ที่มี header next-action ก็ไม่ปล่อยถึง hub)", async () => {
    expect((await call("/", { method: "POST", headers: { "next-action": "x" } })).status).toBe(405);
    expect((await call("/", { headers: { "next-action": "x" } })).status).toBe(405);
  });
  it("'/' GET ปกติยัง rewrite เป็น hub", async () => {
    expect((await call("/")).headers.get("x-middleware-rewrite")).toContain("/tools");
  });
});
