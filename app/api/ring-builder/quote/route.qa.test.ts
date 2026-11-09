// QA (R2-D2) เพิ่ม 10 พ.ย. 69 — เคสโจมตี/ขอบเขตที่ route.test.ts ยังไม่ครอบ: 408 (หยดช้า) · Origin ปลอมแบบ look-alike · key อันตราย (__proto__) ·
// ขอบเขต expectedTotal · ยิงพร้อมกัน · DB ตอบผิดโครง/ผิดลำดับ · ข้อความลูกค้าไม่มีค่าภายนอก/เพชร
// mock ที่ชั้น Supabase เท่านั้น — route/quote-server/code-sign จริงทั้งหมด (เหมือน route.test.ts)
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeCode } from "@/lib/ring-builder/code";
import { verifyCode } from "@/lib/ring-builder/code-sign";

const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ getServiceClient: () => ({ schema: () => ({ rpc }) }) }));
vi.mock("@/lib/dev/context", () => ({ getDevShopId: () => "00000000-0000-0000-0000-000000000001" }));

import { POST } from "./route";

const SECRET = "route-qa-secret-0123456789-abcdefghijklmn";
const saved = process.env.RING_BUILDER_CODE_SECRET;
const URL_ = "http://localhost/api/ring-builder/quote";
const OK_BODY = { v: 1, design: 7, size: 54, positions: [3, 0, 5], expectedTotal: 720 };

function req(raw: string | Uint8Array, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(URL_, {
    method: "POST",
    headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json", ...headers },
    body: raw as BodyInit,
  });
}
const json = (o: unknown) => JSON.stringify(o);

const dbOk = (over: Record<string, unknown> = {}) => ({
  data: {
    ok: true, total: 720, body: 480, size: 54, priced_at: "2026-11-09T20:12:37Z",
    design: { name: "แบบ ก", shape_kind: "round", shape_name: "กลม", major_mm100: 200, minor_mm100: 200 },
    lines: [
      { pos: 1, stone_no: 3, name: "โกเมน", price: 80 },
      { pos: 2, stone_no: 0, name: null, price: 0 },
      { pos: 3, stone_no: 5, name: "ซิทริน", price: 160 },
    ],
    ...over,
  },
  error: null,
});

beforeEach(() => {
  rpc.mockReset();
  process.env.RING_BUILDER_CODE_SECRET = SECRET;
});
afterEach(() => {
  vi.useRealTimers();
  if (saved === undefined) delete process.env.RING_BUILDER_CODE_SECRET;
  else process.env.RING_BUILDER_CODE_SECRET = saved;
});

describe("408: body หยดช้า (slow-drip) ไม่ค้าง connection และไม่แตะ DB", () => {
  it("stream ที่ส่งไปครึ่งเดียวแล้วค้าง → 408 timeout หลัง 5 วินาที", async () => {
    vi.useFakeTimers();
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('{"v":1,'));
        // ไม่ close — ค้างตลอด
      },
    });
    const r0 = new NextRequest(URL_, {
      method: "POST",
      headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json" },
      body: stream,
      duplex: "half",
    } as unknown as ConstructorParameters<typeof NextRequest>[1]);
    const p = POST(r0);
    await vi.advanceTimersByTimeAsync(5001);
    const r = await p;
    expect(r.status).toBe(408);
    expect(await r.json()).toEqual({ ok: false, reason: "timeout" });
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("Origin ปลอม/look-alike ต้อง 403 (ไม่เรียก RPC)", () => {
  it.each([
    ["host ต่อท้าย (suffix)", "http://localhost.evil.com"],
    ["host นำหน้า (prefix)", "http://evil-localhost"],
    ["userinfo หลอก", "http://localhost@evil.com"],
    ["พอร์ตต่าง", "http://localhost:3001"],
    ["Origin: null (sandbox iframe)", "null"],
    ["scheme แปลก", "chrome-extension://abcdef"],
    ["ว่างเปล่า + ไม่มี sec-fetch-site", ""],
  ])("%s", async (_n, origin) => {
    const r = await POST(req(json(OK_BODY), { origin }));
    expect(r.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("Sec-Fetch-Site: cross-site / same-site / none ไม่มี Origin → 403", async () => {
    for (const sfs of ["cross-site", "same-site", "none", ""]) {
      const r = await POST(
        new NextRequest(URL_, { method: "POST", headers: { host: "localhost", "sec-fetch-site": sfs }, body: json(OK_BODY) }),
      );
      expect(r.status, `sec-fetch-site=${sfs}`).toBe(403);
    }
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("schema: key/ค่าอันตราย + ขอบเขต (400 invalid · ไม่เรียก RPC)", () => {
  it('JSON ที่มี own key "__proto__" → invalid (ไม่ใช่ prototype pollution · ไม่ผ่านเพราะ key เกิน)', async () => {
    const raw = '{"v":1,"design":7,"size":54,"positions":[3,0,5],"expectedTotal":720,"__proto__":{"admin":true}}';
    const r = await POST(req(raw));
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ ok: false, reason: "invalid" });
    expect(({} as Record<string, unknown>).admin).toBeUndefined();
    expect(rpc).not.toHaveBeenCalled();
  });
  it('แทน key ด้วย "__proto__" แทน "design" → invalid', async () => {
    const raw = '{"v":1,"__proto__":7,"size":54,"positions":[3,0,5],"expectedTotal":720}';
    expect((await POST(req(raw))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("key ซ้ำใน JSON (design สองค่า) — ค่าหลังชนะที่ JSON.parse · ต้องไม่ทำให้ schema ผ่านด้วยค่านอกช่วง", async () => {
    const raw = '{"v":1,"design":7,"design":99999,"size":54,"positions":[3,0,5],"expectedTotal":720}';
    expect((await POST(req(raw))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([
    ["expectedTotal เกินเพดาน 100,000,001", { ...OK_BODY, expectedTotal: 100_000_001 }],
    ["expectedTotal MAX_SAFE_INTEGER", { ...OK_BODY, expectedTotal: Number.MAX_SAFE_INTEGER }],
    ["positions 1e21", { ...OK_BODY, positions: [0, 1e21, 0] }],
    ["size 1e3", { ...OK_BODY, size: 1e3 }],
    ["size 0", { ...OK_BODY, size: 0 }],
    ["size -0 → ต่ำกว่า 45", { ...OK_BODY, size: -0 }],
    ["size boolean", { ...OK_BODY, size: true }],
    ["design boolean", { ...OK_BODY, design: true }],
    ["v เป็นสตริง '1'", { ...OK_BODY, v: "1" }],
    ["positions object แทน array", { ...OK_BODY, positions: { 0: 1, 1: 2, 2: 3, length: 3 } }],
    ["positions ซ้อน array", { ...OK_BODY, positions: [[0], [0], [0]] }],
    ["positions เป็นสตริงตัวเลข", { ...OK_BODY, positions: ["1", "2", "3"] }],
    ["emoji/ไทยเป็นค่า", { ...OK_BODY, design: "๗🙂" }],
  ])("%s", async (_n, body) => {
    const r = await POST(req(json(body)));
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ ok: false, reason: "invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("JSON ที่ไม่ใช่ object: array/number/string/true/null → invalid (ไม่ throw 500)", async () => {
    for (const raw of ["[]", "7", '"x"', "true", "null", "[[]]"]) {
      const r = await POST(req(raw));
      expect(r.status, raw).toBe(400);
    }
    expect(rpc).not.toHaveBeenCalled();
  });
  it("ขอบเขตที่ต้องผ่าน: size 45 / 68 / null · positions 3 / 7 ตัว · expectedTotal 0 / 100,000,000 · design 1 / 4095 · stone 1023", async () => {
    rpc.mockResolvedValue(dbOk());
    const okBodies = [
      { ...OK_BODY, size: 45 }, { ...OK_BODY, size: 68 }, { ...OK_BODY, size: null },
      { ...OK_BODY, expectedTotal: 0 }, { ...OK_BODY, expectedTotal: 100_000_000 },
      { ...OK_BODY, design: 1 }, { ...OK_BODY, design: 4095 }, { ...OK_BODY, positions: [1023, 1023, 1023] },
      { ...OK_BODY, positions: [0, 0, 0, 0, 0, 0, 0] },
    ];
    for (const b of okBodies) {
      const r = await POST(req(json(b)));
      // schema ผ่าน = ไปถึง RPC (mock ตอบแถวเดิม → ผลลัพธ์อาจเป็น 400/409/500 ตามความไม่ตรงของ mock แต่ "ต้องไม่ใช่ 400 invalid")
      const j = (await r.json()) as { reason?: string };
      expect(j.reason, JSON.stringify(b)).not.toBe("invalid");
    }
    expect(rpc).toHaveBeenCalledTimes(okBodies.length);
  });
  it("BOM นำหน้า JSON ไม่ทำให้พัง (ไม่ 500) และไม่ทำให้ schema หลวม", async () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(json({ ...OK_BODY, shop_id: "x" }))]);
    const r = await POST(req(bom));
    expect([400]).toContain(r.status);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("DB ตอบผิดโครง/ผิดความคาดหวัง → fail closed (ไม่ออกรหัสจากข้อมูลครึ่งๆ กลางๆ)", () => {
  const post = () => POST(req(json(OK_BODY)));
  it.each([
    ["total ติดลบ", dbOk({ total: -1 })],
    ["total ทศนิยม", dbOk({ total: 720.5 })],
    ["total เกิน 18 บิต", dbOk({ total: 262144 })],
    ["body = 0", dbOk({ body: 0 })],
    ["priced_at ไม่ใช่วันที่", dbOk({ priced_at: "not-a-date" })],
    ["priced_at เป็นตัวเลข", dbOk({ priced_at: 12345 })],
    ["design ขาด", dbOk({ design: null })],
    ["lines ไม่ใช่ array", dbOk({ lines: "x" })],
    ["พลอยสีราคา 0", dbOk({ lines: [{ pos: 1, stone_no: 3, name: "โกเมน", price: 0 }, { pos: 2, stone_no: 0, name: null, price: 0 }, { pos: 3, stone_no: 5, name: "ซิทริน", price: 160 }] })],
    ["พลอยสีไม่มีชื่อ", dbOk({ lines: [{ pos: 1, stone_no: 3, name: null, price: 80 }, { pos: 2, stone_no: 0, name: null, price: 0 }, { pos: 3, stone_no: 5, name: "ซิทริน", price: 160 }] })],
    ["ราคา string", dbOk({ lines: [{ pos: 1, stone_no: 3, name: "โกเมน", price: "80" }, { pos: 2, stone_no: 0, name: null, price: 0 }, { pos: 3, stone_no: 5, name: "ซิทริน", price: 160 }] })],
  ])("%s → 500 server ไม่มีรหัส/ราคาหลุด", async (_n, db) => {
    rpc.mockResolvedValue(db);
    const r = await post();
    expect(r.status).toBe(500);
    const j = await r.json();
    expect(j).toEqual({ ok: false, reason: "server" });
  });
  it("RPC คืน data=null / error object แปลก → 500 (ไม่ throw ทะลุ)", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect((await post()).status).toBe(500);
    rpc.mockResolvedValue({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout", details: "SECRET-DETAIL" } });
    const r = await post();
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toMatch(/SECRET-DETAIL|statement timeout/);
    rpc.mockRejectedValue(new Error("network down SECRET-NET"));
    const r3 = await post();
    expect(r3.status).toBe(500);
    expect(JSON.stringify(await r3.json())).not.toMatch(/SECRET-NET/);
  });
  it("DB คืน ok=false ที่ code ไม่อยู่ในรายการ → 500 (ไม่สะท้อน code แปลกให้ลูกค้า)", async () => {
    rpc.mockResolvedValue({ data: { ok: false, code: "cost_missing_for_stone_9", stone_nos: [9] }, error: null });
    const r = await post();
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toMatch(/cost_missing/);
  });
  it("stone_unavailable: stone_nos ที่ไม่ใช่เลขถูกกรองออก (ไม่สะท้อน string/ลบ/0/เกินช่วง)", async () => {
    rpc.mockResolvedValue({ data: { ok: false, code: "stone_unavailable", stone_nos: [3, "x", -1, 0, 1024, 5.5, 7] }, error: null });
    const r = await post();
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ ok: false, reason: "stone_unavailable", stoneNos: [3, 7] });
  });
  // S10 (แก้แล้ว): parseQuoteOk เทียบ pos/stone_no กับ positions ที่ขอ + total = body + Σ price — ไม่ตรง = 500 ไม่ออกรหัส
  it("DB ตอบ 'บรรทัดที่ stone_no ไม่ตรงกับที่ขอ' (ผิดลำดับ/ผิดเม็ด) → ต้องไม่ออกรหัสเงียบๆ", async () => {
    // client ขอ [3,0,5] แต่ DB (จำลองบั๊ก) ตอบ [5,0,3] ราคารวมเท่าเดิม 720 — รหัสที่เซ็นต้องไม่เป็น 5,0,3 โดยไม่มีใครรู้
    rpc.mockResolvedValue(
      dbOk({
        lines: [
          { pos: 1, stone_no: 5, name: "ซิทริน", price: 160 },
          { pos: 2, stone_no: 0, name: null, price: 0 },
          { pos: 3, stone_no: 3, name: "โกเมน", price: 80 },
        ],
      }),
    );
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await post();
    spy.mockRestore();
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ ok: false, reason: "server" });
  });
  it("S10: DB ตอบยอดรวมไม่เท่า body + Σ ราคาบรรทัด → 500 ไม่ออกรหัส", async () => {
    rpc.mockResolvedValue(dbOk({ total: 721 }));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await post();
    spy.mockRestore();
    expect(r.status).toBe(500);
  });
});

describe("พร้อมกัน (race) — ไม่มี state ร่วมระหว่าง request", () => {
  it("ยิง 25 request พร้อมกัน input เดียวกัน → ทุกตัว 200 · รหัสเหมือนกันทุกตัว · verify ผ่าน", async () => {
    rpc.mockImplementation(async () => dbOk());
    const rs = await Promise.all(Array.from({ length: 25 }, () => POST(req(json(OK_BODY)))));
    const bodies = await Promise.all(rs.map((r) => r.json() as Promise<{ code: string }>));
    expect(rs.every((r) => r.status === 200)).toBe(true);
    expect(new Set(bodies.map((b) => b.code)).size).toBe(1);
    expect(verifyCode(bodies[0].code).status).toBe("valid");
    expect(rpc).toHaveBeenCalledTimes(25);
  });
  it("ยิงพร้อมกันคนละ input + ราคาเปลี่ยนกลางทาง → 200 และ 409 ไม่ปนกัน (ราคา/รหัสไม่ข้ามคำขอ)", async () => {
    let n = 0;
    rpc.mockImplementation(async () => (n++ % 2 === 0 ? dbOk() : dbOk({ total: 740, lines: [{ pos: 1, stone_no: 3, name: "โกเมน", price: 80 }, { pos: 2, stone_no: 0, name: null, price: 0 }, { pos: 3, stone_no: 5, name: "ซิทริน", price: 180 }] })));
    const rs = await Promise.all(Array.from({ length: 10 }, () => POST(req(json(OK_BODY)))));
    for (const r of rs) {
      const j = (await r.json()) as { ok: boolean; reason?: string; total?: number; code?: string };
      if (r.status === 200) {
        expect(j.ok).toBe(true);
        expect(decodeCode(j.code!).ok).toBe(true);
      } else {
        expect(r.status).toBe(409);
        expect(j.reason).toBe("price_changed");
        expect(j.total).toBe(740);
        expect(j.code).toBeUndefined(); // 409 ห้ามมีรหัส
      }
    }
  });
});

describe("ข้อความลูกค้า (lineText) — ค่าภายนอก/คำต้องห้าม", () => {
  it("ไม่มี LINE ID / URL / เบอร์ / อีเมล / 'เพชร' · มีเฉพาะรหัสและตัวเลขที่ DB ตอบ", async () => {
    rpc.mockResolvedValue(dbOk());
    const r = await POST(req(json(OK_BODY)));
    expect(r.status).toBe(200);
    const j = (await r.json()) as { lineText: string; qrText: string; code: string };
    for (const t of [j.lineText, j.qrText]) {
      expect(t).not.toMatch(/@\w|lin\.ee|https?:\/\/|www\.|\.com|\b0[689]\d{7,8}\b|เพชร/i);
    }
    expect(j.qrText).toBe(j.code);
    expect(j.lineText).toContain("฿720");
  });
  it("ชื่อแบบ/พลอยที่เจ้าของตั้งเองถูกส่งต่อตรงๆ (ไม่ถูกแปลง) · แต่ response ไม่มี key ต้นทุน/margin/รับซื้อ", async () => {
    rpc.mockResolvedValue(dbOk());
    const r = await POST(req(json(OK_BODY)));
    const txt = JSON.stringify(await r.json());
    expect(txt).not.toMatch(/cost|margin|buy_?back|รับซื้อ|ต้นทุน|กำไร|shop_id|actor|secret/i);
  });
});
