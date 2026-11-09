// route test — ด่านทุกชั้นของ POST /api/ring-builder/quote (mock ที่ชั้น Supabase เท่านั้น — ตรรกะ route/quote-server/code-sign จริงทั้งหมด)
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QUOTE_CONFLICT_KEYS, QUOTE_DESIGN_KEYS, QUOTE_FAILURE_KEYS, QUOTE_GROUP_KEYS, QUOTE_LINE_KEYS, QUOTE_OK_KEYS, QUOTE_REJECTED_KEYS } from "@/lib/ring-builder/types";
import { decodeCode } from "@/lib/ring-builder/code";
import { verifyCode } from "@/lib/ring-builder/code-sign";

const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ getServiceClient: () => ({ schema: () => ({ rpc }) }) }));
vi.mock("@/lib/dev/context", () => ({ getDevShopId: () => "00000000-0000-0000-0000-000000000001" }));

import { POST } from "./route";

const SECRET = "route-test-secret-0123456789-abcdefghijk";
const saved = process.env.RING_BUILDER_CODE_SECRET;
const OK_BODY = { v: 1, design: 7, size: 54, positions: [3, 0, 5], expectedTotal: 720 };

function req(body: unknown, init: { headers?: Record<string, string>; raw?: string | Uint8Array } = {}): NextRequest {
  const raw = init.raw ?? (typeof body === "string" ? body : JSON.stringify(body));
  return new NextRequest("http://localhost/api/ring-builder/quote", {
    method: "POST",
    headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json", ...(init.headers ?? {}) },
    body: raw as BodyInit,
  });
}
const keys = (o: unknown) => Object.keys(o as object).sort();

const dbOk = (total = 720) => ({
  data: {
    ok: true, total, body: 480, size: 54, priced_at: "2026-11-09T20:12:37Z",
    design: { name: "แบบ ก", shape_kind: "round", shape_name: "กลม", major_mm100: 200, minor_mm100: 200 },
    lines: [
      { pos: 1, stone_no: 3, name: "โกเมน", price: 80 },
      { pos: 2, stone_no: 0, name: null, price: 0 },
      { pos: 3, stone_no: 5, name: "ซิทริน", price: 160 },
    ],
  },
  error: null,
});

beforeEach(() => {
  rpc.mockReset();
  process.env.RING_BUILDER_CODE_SECRET = SECRET;
});
afterEach(() => {
  if (saved === undefined) delete process.env.RING_BUILDER_CODE_SECRET;
  else process.env.RING_BUILDER_CODE_SECRET = saved;
});

describe("ด่านก่อนแตะ DB — ไม่เรียก RPC เลย", () => {
  it("403: ข้าม origin / ไม่มี origin และไม่มี sec-fetch-site / host ไม่ตรง", async () => {
    const r1 = await POST(req(OK_BODY, { headers: { origin: "https://evil.example" } }));
    expect(r1.status).toBe(403);
    expect(await r1.json()).toEqual({ ok: false, reason: "forbidden" });
    const r2 = await POST(new NextRequest("http://localhost/api/ring-builder/quote", { method: "POST", headers: { host: "localhost" }, body: JSON.stringify(OK_BODY) }));
    expect(r2.status).toBe(403);
    const r3 = await POST(req(OK_BODY, { headers: { origin: "not a url" } }));
    expect(r3.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("ไม่มี Origin แต่ Sec-Fetch-Site: same-origin ผ่านด่านนี้", async () => {
    rpc.mockResolvedValue(dbOk());
    const r = await POST(new NextRequest("http://localhost/api/ring-builder/quote", { method: "POST", headers: { host: "localhost", "sec-fetch-site": "same-origin" }, body: JSON.stringify(OK_BODY) }));
    expect(r.status).toBe(200);
  });
  it("413: body > 512 B (content-length / stream) — ตัดก่อน parse", async () => {
    const big = JSON.stringify({ ...OK_BODY, pad: "x".repeat(600) });
    const r = await POST(req(big, { headers: { "content-length": String(big.length) } }));
    expect(r.status).toBe(413);
    expect(await r.json()).toEqual({ ok: false, reason: "too_large" });
    const r2 = await POST(req(big, { headers: { "content-length": "10" } })); // header โกหก
    expect(r2.status).toBe(413);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("body พอดี 512 B ไม่โดน 413 (ถูกปฏิเสธที่ schema แทน)", async () => {
    const pad = "x".repeat(512 - JSON.stringify({ ...OK_BODY, p: "" }).length);
    const raw = JSON.stringify({ ...OK_BODY, p: pad });
    expect(raw.length).toBe(512);
    expect((await POST(req(raw))).status).toBe(400);
  });
  it("400 bad_body: ไม่ใช่ JSON / UTF-8 เสีย / ว่าง", async () => {
    expect((await POST(req("{not json"))).status).toBe(400);
    expect((await POST(req("", { raw: "" }))).status).toBe(400);
    const r = await POST(req("", { raw: new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]) }));
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ ok: false, reason: "bad_body" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([
    ["ไม่ใช่ object", [1, 2]], ["null", null], ["v ผิด", { ...OK_BODY, v: 2 }], ["key เกิน shop_id", { ...OK_BODY, shop_id: "x" }], ["key เกิน pricedAt", { ...OK_BODY, pricedAt: "2026-01-01" }],
    ["ราคารายตำแหน่ง", { ...OK_BODY, prices: [1] }], ["ขาด key", { v: 1, design: 7, size: 54, positions: [0, 0, 0] }],
    ["design 0", { ...OK_BODY, design: 0 }], ["design 4096", { ...OK_BODY, design: 4096 }], ["design ทศนิยม", { ...OK_BODY, design: 1.5 }], ["design string", { ...OK_BODY, design: "7" }],
    ["size 44", { ...OK_BODY, size: 44 }], ["size 69", { ...OK_BODY, size: 69 }], ["size 45.5", { ...OK_BODY, size: 45.5 }], ["size string", { ...OK_BODY, size: "54" }], ["size undefined", { v: 1, design: 7, positions: [0, 0, 0], expectedTotal: 1 }],
    ["positions 2 ตัว", { ...OK_BODY, positions: [0, 0] }], ["positions 8 ตัว", { ...OK_BODY, positions: [0, 0, 0, 0, 0, 0, 0, 0] }], ["positions 1024", { ...OK_BODY, positions: [0, 1024, 0] }],
    ["positions ติดลบ", { ...OK_BODY, positions: [0, -1, 0] }], ["positions null", { ...OK_BODY, positions: [0, null, 0] }], ["positions ไม่ใช่ array", { ...OK_BODY, positions: "0,0,0" }],
    ["expectedTotal ติดลบ", { ...OK_BODY, expectedTotal: -1 }], ["expectedTotal NaN→null", { ...OK_BODY, expectedTotal: null }], ["expectedTotal ทศนิยม", { ...OK_BODY, expectedTotal: 1.5 }],
  ])("400 invalid: %s", async (_n, body) => {
    const r = await POST(req(body));
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ ok: false, reason: "invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("503: ไม่มี secret (หรือสั้นเกิน) — ไม่แตะ DB", async () => {
    delete process.env.RING_BUILDER_CODE_SECRET;
    const r = await POST(req(OK_BODY));
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ ok: false, reason: "unavailable" });
    process.env.RING_BUILDER_CODE_SECRET = "short";
    expect((await POST(req(OK_BODY))).status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("เส้นทาง DB", () => {
  it("200: ราคาตรง expectedTotal → รหัสที่ verify ได้ · key ของ response = allowlist เป๊ะ · no-store · ฝั่ง server ประกอบ lineText/groups/pricedAtLabel", async () => {
    rpc.mockResolvedValue(dbOk());
    const r = await POST(req(OK_BODY));
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const j = await r.json();
    expect(keys(j)).toEqual([...QUOTE_OK_KEYS]);
    expect(keys(j.design)).toEqual([...QUOTE_DESIGN_KEYS]);
    expect(keys(j.lines[0])).toEqual([...QUOTE_LINE_KEYS]);
    expect(keys(j.groups[0])).toEqual([...QUOTE_GROUP_KEYS]);
    expect(j.total).toBe(720);
    expect(j.lines[1]).toEqual({ pos: 2, stoneNo: 0, name: "CZ ขาว", priceThb: 0 });
    expect(j.groups.map((g: { name: string; count: number; subtotalThb: number }) => [g.name, g.count, g.subtotalThb])).toEqual([["โกเมน", 1, 80], ["CZ ขาว", 1, 0], ["ซิทริน", 1, 160]]);
    expect(j.pricedAtLabel).toBe("10 พ.ย. 2569"); // 20:12Z = 03:12 ไทยวันถัดไป
    expect(j.qrText).toBe(j.code);
    expect(j.qrText).not.toMatch(/https?:/);
    expect(j.lineText).toContain(j.code);
    expect(j.lineText).toContain("แบบ: แถว 3 เม็ด แบบ ก (พลอยกลม 2×2 มม.)");
    expect(j.lineText).toContain("ไซซ์: เบอร์ 54");
    expect(j.lineText).toContain("1 โกเมน · 2 CZ ขาว · 3 ซิทริน");
    expect(j.lineText).toContain("ราคารวม ฿720 (ณ 10 พ.ย. 2569)");
    expect(j.lineText).not.toMatch(/เพชร/);
    // รหัสตรวจผ่าน HMAC และผูกกับ total/positions/size จาก DB (ไม่ใช่จาก client)
    const v = verifyCode(j.code);
    expect(v.status).toBe("valid");
    const d = decodeCode(j.code);
    expect(d.ok && d.fields).toMatchObject({ designNo: 7, size: 54, positions: [3, 0, 5], totalThb: 720 });
    // RPC ได้รับ shop จาก env เท่านั้น
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("rb_quote", { p_shop_id: "00000000-0000-0000-0000-000000000001", p_design_no: 7, p_size: 54, p_positions: [3, 0, 5], p_at: null });
  });
  it("size null → ไซซ์ 'รอแอดมินช่วยเช็ก' ในข้อความและรหัสเป็น sentinel", async () => {
    rpc.mockResolvedValue(dbOk());
    const j = await (await POST(req({ ...OK_BODY, size: null }))).json();
    expect(j.lineText).toContain("ไซซ์: รอแอดมินช่วยเช็ก");
    const d = decodeCode(j.code);
    expect(d.ok && d.fields.size).toBeNull();
  });
  it("409 price_changed: ราคาไม่ตรง expectedTotal → ราคาใหม่ ไม่มีรหัส/ข้อความ", async () => {
    rpc.mockResolvedValue(dbOk(800));
    const r = await POST(req(OK_BODY));
    expect(r.status).toBe(409);
    const j = await r.json();
    expect(keys(j)).toEqual([...QUOTE_CONFLICT_KEYS]);
    expect(j).toMatchObject({ ok: false, reason: "price_changed", total: 800, body: 480 });
    expect(j.code).toBeUndefined();
    expect(j.lineText).toBeUndefined();
  });
  it.each(["design_unavailable", "size_out_of_range", "count_mismatch", "total_too_large", "invalid"])("400 reason %s (ไม่มี stoneNos)", async (code) => {
    rpc.mockResolvedValue({ data: { ok: false, code }, error: null });
    const r = await POST(req(OK_BODY));
    expect(r.status).toBe(400);
    const j = await r.json();
    expect(j).toEqual({ ok: false, reason: code });
    expect(keys(j).every((k) => (QUOTE_REJECTED_KEYS as readonly string[]).includes(k))).toBe(true);
  });
  it("400 stone_unavailable พร้อม stoneNos[] (เฉพาะตัวเลขที่ถูกต้อง)", async () => {
    rpc.mockResolvedValue({ data: { ok: false, code: "stone_unavailable", stone_nos: [3, 5, "x", -1, 1.5, 5000] }, error: null });
    const j = await (await POST(req(OK_BODY))).json();
    expect(j).toEqual({ ok: false, reason: "stone_unavailable", stoneNos: [3, 5] });
  });
  it("500: RPC error (log เฉพาะ code ไม่ echo) · โครงผลลัพธ์ผิด · code แปลก", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValue({ data: null, error: { code: "57014", message: "secret host db.example:5432", details: "password=hunter2" } });
    const r = await POST(req(OK_BODY));
    expect(r.status).toBe(500);
    const text = JSON.stringify(await r.json());
    expect(text).toBe(JSON.stringify({ ok: false, reason: "server" }));
    expect(JSON.stringify(spy.mock.calls)).not.toMatch(/hunter2|db\.example|secret host/);
    expect(JSON.stringify(spy.mock.calls)).toContain("57014");
    rpc.mockResolvedValue({ data: { ok: true, total: "720" }, error: null });
    expect((await POST(req(OK_BODY))).status).toBe(500);
    rpc.mockResolvedValue({ data: { ok: false, code: "weird" }, error: null });
    expect((await POST(req(OK_BODY))).status).toBe(500);
    rpc.mockResolvedValue({ data: "text", error: null });
    expect((await POST(req(OK_BODY))).status).toBe(500);
    rpc.mockRejectedValue(new Error("boom host=secret"));
    const r5 = await POST(req(OK_BODY));
    expect(r5.status).toBe(500);
    expect(JSON.stringify(spy.mock.calls)).not.toContain("host=secret");
    spy.mockRestore();
  });
  it("จำนวนบรรทัดที่ DB คืนไม่เท่า positions ⇒ 500 (ไม่ออกรหัสจากข้อมูลที่ไม่ตรงกัน)", async () => {
    const ok = dbOk();
    ok.data.lines.pop();
    rpc.mockResolvedValue(ok);
    expect((await POST(req(OK_BODY))).status).toBe(500);
  });
  it("failure response ทุกแบบมี key = ok, reason เท่านั้น", async () => {
    delete process.env.RING_BUILDER_CODE_SECRET;
    expect(keys(await (await POST(req(OK_BODY))).json())).toEqual([...QUOTE_FAILURE_KEYS]);
  });
});

describe("method อื่น", () => {
  it("route export เฉพาะ POST", async () => {
    const mod = await import("./route");
    expect(Object.keys(mod).sort()).toEqual(["POST"]);
  });
});
