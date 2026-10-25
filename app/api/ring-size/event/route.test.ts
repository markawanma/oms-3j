// app/api/ring-size/event/route.test.ts — เคส design-ring-size-analytics §9 ข้อ 1 · 2 · 3 · 5 (ฝั่ง route) · 9 · 12 · 13
// lib/ring-size/track-schema.ts ไม่ mock (pure — ให้ coverage จริงว่า route ต่อกับตัวตรวจถูก) · mock เฉพาะ I/O: service client + getDevShopId
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const rpcMock = vi.fn();
const schemaMock = vi.fn();
const shopIdMock = vi.fn();

vi.mock("@/lib/dev/context", () => ({ getDevShopId: () => shopIdMock() }));
vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({
    schema: (name: string) => {
      schemaMock(name);
      return { rpc: rpcMock };
    },
  }),
}));

const HOST = "oms-3j.vercel.app";
const ORIGIN = `https://${HOST}`;
const SHOP = "11111111-1111-1111-1111-111111111111";
const SID = "3f2b8c1e-9a4d-4e6b-8c2f-1a2b3c4d5e6f";
const MAX = 1024;

function makeRequest(opts: { body?: unknown; rawBody?: string; headers?: Record<string, string | null>; method?: string } = {}): NextRequest {
  const bodyStr = opts.rawBody ?? JSON.stringify(opts.body ?? { sid: SID, stage: 1 });
  const headers: Record<string, string> = { host: HOST, origin: ORIGIN, "content-type": "application/json" };
  for (const [k, v] of Object.entries(opts.headers ?? {})) {
    if (v === null) delete headers[k];
    else headers[k] = v;
  }
  return new NextRequest(`https://${HOST}/api/ring-size/event`, { method: opts.method ?? "POST", headers, body: bodyStr });
}

/** body JSON ที่ถูกต้องและยาวเท่า n ไบต์พอดี (เติมช่องว่างท้าย JSON) */
function bodyOfBytes(n: number): string {
  const base = JSON.stringify({ sid: SID, stage: 1 });
  return base + " ".repeat(n - Buffer.byteLength(base, "utf-8"));
}

const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

beforeEach(() => {
  rpcMock.mockReset();
  schemaMock.mockReset();
  shopIdMock.mockReset();
  errorSpy.mockClear();
  shopIdMock.mockReturnValue(SHOP);
  rpcMock.mockResolvedValue({ data: null, error: null });
});

async function post(req: NextRequest) {
  const { POST } = await import("./route");
  return POST(req);
}

describe("POST /api/ring-size/event — เคส 9: เมธอด", () => {
  it("export เฉพาะ POST (ไม่มี GET/PUT/DELETE/PATCH/HEAD/OPTIONS) — Next.js ตอบ 405 ให้อัตโนมัติ", async () => {
    const mod = (await import("./route")) as Record<string, unknown>;
    expect(typeof mod.POST).toBe("function");
    for (const m of ["GET", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"]) expect(mod[m], m).toBeUndefined();
  });
});

describe("happy path", () => {
  it("snapshot ครบ → 204 · RPC ถูกเรียก 1 ครั้งด้วย schema analytics + 3 พารามิเตอร์ (shop จาก env · sid · snapshot ที่ตรวจแล้ว) เท่านั้น", async () => {
    const snap = { stage: 7, in_app: "line", is_return: false, ref: "coin", method: "A", circ_mm: 54.1, size: 52, between: false, in_range: true, used_a: true };
    const res = await post(makeRequest({ body: { sid: SID, ...snap } }));
    expect(res.status).toBe(204);
    expect(schemaMock).toHaveBeenCalledWith("analytics");
    expect(rpcMock).toHaveBeenCalledTimes(1);
    const [name, params] = rpcMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(name).toBe("ring_size_session_upsert");
    expect(Object.keys(params).sort()).toEqual(["p_session_id", "p_shop_id", "p_snapshot"]);
    expect(params.p_shop_id).toBe(SHOP);
    expect(params.p_session_id).toBe(SID);
    expect(params.p_snapshot).toEqual(snap);
  });

  it("ขั้นต่ำ {sid, stage} ผ่าน · Content-Type อะไรก็ได้ (sendBeacon ส่ง text/plain ได้) ถ้าเป็น JSON", async () => {
    const res = await post(makeRequest({ headers: { "content-type": "text/plain;charset=UTF-8" } }));
    expect(res.status).toBe(204);
  });

  it("เคส 13: ค่าจาก header (user-agent · x-forwarded-for · cookie · referer) ไม่ไปถึง RPC และ client ส่ง shop_id ไม่ได้ (ถูกปฏิเสธ)", async () => {
    const res = await post(
      makeRequest({ headers: { "user-agent": "SECRET-UA-9f3", "x-forwarded-for": "203.0.113.77", cookie: "sid=SECRET-COOKIE", referer: "https://x.test/SECRET-REF" } })
    );
    expect(res.status).toBe(204);
    const dump = JSON.stringify(rpcMock.mock.calls);
    for (const leak of ["SECRET-UA-9f3", "203.0.113.77", "SECRET-COOKIE", "SECRET-REF"]) expect(dump).not.toContain(leak);

    rpcMock.mockClear();
    const res2 = await post(makeRequest({ body: { sid: SID, stage: 1, shop_id: "99999999-9999-9999-9999-999999999999" } }));
    expect(res2.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("ทุกสถานะตอบ Cache-Control: no-store", async () => {
    const cases: Array<[number, NextRequest]> = [
      [204, makeRequest()],
      [400, makeRequest({ rawBody: "not json" })],
      [403, makeRequest({ headers: { origin: "https://evil.example" } })],
      [413, makeRequest({ rawBody: bodyOfBytes(MAX + 1) })],
    ];
    for (const [status, req] of cases) {
      const res = await post(req);
      expect(res.status).toBe(status);
      expect(res.headers.get("cache-control"), String(status)).toBe("no-store");
    }
    rpcMock.mockResolvedValueOnce({ data: null, error: { code: "P0001" } });
    expect((await post(makeRequest())).headers.get("cache-control")).toBe("no-store");
    rpcMock.mockResolvedValueOnce({ data: null, error: { code: "XX000" } });
    expect((await post(makeRequest())).headers.get("cache-control")).toBe("no-store");
  });
});

describe("เคส 1: same-origin → 403 (ไม่เรียก RPC)", () => {
  it.each([
    ["Origin คนละโดเมน", { origin: "https://evil.example" }],
    ["Origin เป็น 'null' (sandbox iframe / file:)", { origin: "null" }],
    ["Origin ไม่ใช่ URL", { origin: "not a url" }],
    ["Origin โดเมนคล้าย (host ต่อท้าย)", { origin: `https://${HOST}.evil.example` }],
    ["Origin โดเมนคล้าย (นำหน้า)", { origin: `https://evil-${HOST}` }],
    ["ไม่มี Origin และ Sec-Fetch-Site: cross-site", { origin: null, "sec-fetch-site": "cross-site" }],
    ["ไม่มี Origin และ Sec-Fetch-Site: same-site (เข้มกว่า gem quiz โดยตั้งใจ)", { origin: null, "sec-fetch-site": "same-site" }],
    ["ไม่มี Origin และ Sec-Fetch-Site: none", { origin: null, "sec-fetch-site": "none" }],
    ["ไม่มีทั้ง Origin และ Sec-Fetch-Site", { origin: null }],
    ["Origin ว่าง + ไม่มี Sec-Fetch-Site", { origin: "" }],
    ["ไม่มี host", { host: null }],
  ])("%s", async (_l, headers) => {
    const res = await post(makeRequest({ headers: headers as Record<string, string | null> }));
    expect(res.status).toBe(403);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("Origin ตรง host ผ่าน · ไม่มี Origin แต่ Sec-Fetch-Site: same-origin ผ่าน (ต้องไม่พัง)", async () => {
    expect((await post(makeRequest())).status).toBe(204);
    expect((await post(makeRequest({ headers: { origin: null, "sec-fetch-site": "same-origin" } }))).status).toBe(204);
    expect((await post(makeRequest({ headers: { origin: "http://" + HOST } }))).status).toBe(204); // เทียบ host (preview ที่ proxy เป็น http)
  });

  it("Origin คนละโดเมน แต่ Sec-Fetch-Site: same-origin → ยังถูกปฏิเสธ (Origin ชนะ)", async () => {
    const res = await post(makeRequest({ headers: { origin: "https://evil.example", "sec-fetch-site": "same-origin" } }));
    expect(res.status).toBe(403);
  });
});

describe("เคส 2: body > 1 KB → 413 (ไม่เรียก RPC)", () => {
  it("content-length header บอกเกิน ⇒ 413", async () => {
    const res = await post(makeRequest({ headers: { "content-length": String(MAX + 1) } }));
    expect(res.status).toBe(413);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("header โกหก (บอกเล็ก) แต่ body จริงเกิน ⇒ 413", async () => {
    const res = await post(makeRequest({ rawBody: bodyOfBytes(MAX + 1), headers: { "content-length": "10" } }));
    expect(res.status).toBe(413);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("ไม่มี content-length แต่ body จริงเกิน ⇒ 413", async () => {
    const res = await post(makeRequest({ rawBody: bodyOfBytes(5000), headers: { "content-length": null } }));
    expect(res.status).toBe(413);
  });

  it("นับเป็นไบต์ ไม่ใช่ตัวอักษร: ตัวอักษรไทย ~410 ตัว = ~1230 ไบต์ ⇒ 413 (ไม่ใช่ 400)", async () => {
    const raw = JSON.stringify({ sid: SID, stage: 1, x: "ก".repeat(410) });
    expect(raw.length).toBeLessThan(MAX);
    expect(Buffer.byteLength(raw, "utf-8")).toBeGreaterThan(MAX);
    const res = await post(makeRequest({ rawBody: raw }));
    expect(res.status).toBe(413);
  });

  it("ขอบ: body ถูกต้องยาว 1024 ไบต์พอดี ⇒ ผ่าน (204) · 1025 ⇒ 413", async () => {
    expect((await post(makeRequest({ rawBody: bodyOfBytes(MAX) }))).status).toBe(204);
    expect((await post(makeRequest({ rawBody: bodyOfBytes(MAX + 1) }))).status).toBe(413);
  });
});

describe("เคส 3: body ไม่ถูกต้อง → 400 (ไม่เรียก RPC) · ตอบข้อความทั่วไปไม่บอก schema", () => {
  const bad: Array<[string, string]> = [
    ["ไม่ใช่ JSON", "not json"],
    ["body ว่าง", ""],
    ["JSON ไม่จบ", '{"sid":"'],
    ["array", "[]"],
    ["null", "null"],
    ["string", '"x"'],
    ["number", "123"],
    ["ไม่มี sid", '{"stage":1}'],
    ["sid ไม่ใช่ UUID", '{"sid":"abc","stage":1}'],
    ["stage 99", `{"sid":"${SID}","stage":99}`],
    ["stage 1.5", `{"sid":"${SID}","stage":1.5}`],
    ["stage string", `{"sid":"${SID}","stage":"1"}`],
    ["key นอก allowlist", `{"sid":"${SID}","stage":1,"ip":"1.2.3.4"}`],
    ["src (ตัดออกตามมติ 25 ต.ค. 69)", `{"sid":"${SID}","stage":1,"src":"line"}`],
    ["circ 1e9", `{"sid":"${SID}","stage":7,"circ_mm":1e9}`],
    ["circ 'NaN' string", `{"sid":"${SID}","stage":7,"circ_mm":"NaN"}`],
    ["circ 'Infinity' string", `{"sid":"${SID}","stage":7,"circ_mm":"Infinity"}`],
    ["circ 1e400 (parse เป็น Infinity)", `{"sid":"${SID}","stage":7,"circ_mm":1e400}`],
    ["size 91", `{"sid":"${SID}","stage":7,"size":91}`],
    ["in_app นอกชุด", `{"sid":"${SID}","stage":1,"in_app":"evil"}`],
    ["boolean เป็น string", `{"sid":"${SID}","stage":1,"g1":"true"}`],
    ["method ผิด", `{"sid":"${SID}","stage":1,"method":"C"}`],
    ["cta ผิด", `{"sid":"${SID}","stage":1,"cta":"x"}`],
  ];
  it.each(bad)("%s", async (_l, raw) => {
    const res = await post(makeRequest({ rawBody: raw }));
    expect(res.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
    const text = await res.text();
    expect(text).not.toMatch(/stage|allowlist|schema|sid|circ|in_app|src/i); // ไม่บอกว่าผิดที่ field ไหน
  });
});

describe("เคส 5: แมป error ของ RPC", () => {
  it("P0001 (เกินเพดาน session / circuit breaker) ⇒ 429 เงียบ ไม่มี body ไม่ log", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "P0001", message: "เกินจำนวนที่รับได้ใน 10 นาที" } });
    const res = await post(makeRequest());
    expect(res.status).toBe(429);
    expect(await res.text()).toBe("");
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("22023 (RPC ปฏิเสธเอง) ⇒ 400 ข้อความทั่วไป", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "22023", message: "snapshot มี key นอก allowlist" } });
    const res = await post(makeRequest());
    expect(res.status).toBe(400);
    expect(await res.text()).not.toMatch(/allowlist|snapshot/);
  });

  it("error อื่น ⇒ 500 ข้อความทั่วไป · log เฉพาะ code (ไม่ log error ทั้งก้อน/details/host/PII)", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: "XX000", message: "boom db.secret-host.supabase.co", details: "Caused by: ENOTFOUND secret-host.supabase.co\n at stack", hint: "h" },
    });
    const res = await post(makeRequest());
    expect(res.status).toBe(500);
    expect(await res.text()).not.toMatch(/secret-host|boom|ENOTFOUND/);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).toContain("XX000");
    for (const leak of ["secret-host", "boom", "ENOTFOUND", "stack", SID, SHOP]) expect(logged).not.toContain(leak);
  });

  it("RPC throw (เครือข่ายล่ม · ไม่มี code) ⇒ 500 · log code '(none)' ไม่ log ข้อความ", async () => {
    rpcMock.mockRejectedValue(new Error("fetch failed: getaddrinfo ENOTFOUND secret-host.supabase.co"));
    const res = await post(makeRequest());
    expect(res.status).toBe(500);
    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).toContain("(none)");
    expect(logged).not.toMatch(/secret-host|ENOTFOUND|fetch failed/);
  });

  it("getServiceClient ล้ม (ไม่มี key) ⇒ 500 ไม่พังทั้งโปรเซส", async () => {
    rpcMock.mockImplementation(() => {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
    });
    const res = await post(makeRequest());
    expect(res.status).toBe(500);
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
  });
});

describe("เคส 12: ไม่มี DEV_SHOP_ID → 500 โดยไม่ echo", () => {
  it("getDevShopId throw ⇒ 500 · ไม่เรียก RPC · ไม่ echo ชื่อ env · log ไม่มีข้อความของ error", async () => {
    shopIdMock.mockImplementation(() => {
      throw new Error("DEV_SHOP_ID is not set. This MVP has no auth yet — seed a shop");
    });
    const res = await post(makeRequest());
    expect(res.status).toBe(500);
    expect(rpcMock).not.toHaveBeenCalled();
    expect(await res.text()).not.toMatch(/DEV_SHOP_ID|seed/);
    expect(JSON.stringify(errorSpy.mock.calls)).not.toMatch(/DEV_SHOP_ID|seed/);
  });

  it("ลำดับด่าน: origin ผิดตกที่ 403 ก่อนแตะ env/RPC (ไม่ให้คนนอกวัดว่า env ตั้งไว้ไหม)", async () => {
    shopIdMock.mockImplementation(() => {
      throw new Error("x");
    });
    const res = await post(makeRequest({ headers: { origin: "https://evil.example" } }));
    expect(res.status).toBe(403);
    expect(shopIdMock).not.toHaveBeenCalled();
  });
});
