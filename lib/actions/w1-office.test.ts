// 0187 W1 ฝั่งออฟฟิศ: ทะเบียนช่าง (สิทธิ์ผู้จัดการ) · QR ร้าน · รับทราบใบ · ผูก SKU · แก้ชื่อแบบ
// ครอบ: สิทธิ์ (staff ปฏิเสธก่อนแตะ DB) · actor จาก session ฝั่ง server · ตรวจ input ก่อนถึง DB · ค่าดิบของ QR ร้านไม่รั่ว · map ผลแบบ allowlist
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SHOP = "a7c850ee-6776-4c3e-ba72-ba9e8caba2b7";
const USER = "99999999-9999-4999-8999-999999999999";
const PO = "11111111-1111-4111-8111-111111111111";
const ITEM = "22222222-2222-4222-8222-222222222222";
const PROD = "33333333-3333-4333-8333-333333333333";
const WORKER = "44444444-4444-4444-8444-444444444444";
const RAW = "Ab3-_xYz0123456789AbCdEfGhIjKlMnOpQrStUvWxY";

const roleMock = vi.fn();
const sessionUserMock = vi.fn();
const requireSessionMock = vi.fn();
const rpcMock = vi.fn();
let listRows: unknown[] = [];

function builder(table: string) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "neq", "in", "is", "not", "order", "range", "limit"]) b[m] = () => b;
  const res = () => ({ data: table === "v_production_order" ? listRows : [], error: null, count: listRows.length });
  b.maybeSingle = () => Promise.resolve({ data: listRows[0] ?? null, error: null });
  b.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(res()).then(ok, bad);
  return b;
}

vi.mock("@/lib/auth/role", () => ({ getEffectiveRole: () => roleMock() }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: () => sessionUserMock(), requireSessionIfGateOn: () => requireSessionMock() }));
vi.mock("@/lib/dev/context", () => ({ getDevShopId: () => SHOP }));
vi.mock("@/lib/supabase/server", () => ({ getServiceClient: () => ({ schema: () => ({ rpc: rpcMock, from: (t: string) => builder(t) }), from: (t: string) => builder(t) }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => ({ get: () => null }) }));

import { getShopIntakeStatus, issueShopIntakeToken, revokeShopIntakeToken, saveWorker } from "./job-workers";
import { acknowledgeProductionOrder, bindProductionItemProduct, getProductionOrders, setProductionItemLabel } from "./production";
import { mapWorkerRow, WORKER_COLUMNS } from "@/lib/jobs/types";

let errSpy: ReturnType<typeof vi.spyOn>;
const ENV0 = { APP_ORIGIN: process.env.APP_ORIGIN, VERCEL_ENV: process.env.VERCEL_ENV };
beforeEach(() => {
  vi.clearAllMocks();
  // QR ร้านออกได้เฉพาะ production + APP_ORIGIN (security H1) — เคส preview/ไม่ตั้ง env อยู่ใน shop-qr-issue.test.ts
  process.env.APP_ORIGIN = "https://app.example.test";
  process.env.VERCEL_ENV = "production";
  listRows = [];
  roleMock.mockResolvedValue("owner");
  sessionUserMock.mockResolvedValue({ id: USER, email: "o@example.test" });
  requireSessionMock.mockResolvedValue(undefined);
  rpcMock.mockResolvedValue({ data: { ok: true }, error: null });
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  errSpy.mockRestore();
  for (const [k, v] of Object.entries(ENV0)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const lastRpc = () => rpcMock.mock.calls.at(-1) as [string, Record<string, unknown>];

describe("สิทธิ์ — staff ปฏิเสธก่อนแตะ DB ทุก action ใหม่", () => {
  const all: [string, () => Promise<unknown>][] = [
    ["saveWorker(flags)", () => saveWorker({ displayName: "ก", stageCodes: ["qc"], canOpenJob: true })],
    ["getShopIntakeStatus", () => getShopIntakeStatus()],
    ["issueShopIntakeToken", () => issueShopIntakeToken()],
    ["revokeShopIntakeToken", () => revokeShopIntakeToken()],
    ["acknowledgeProductionOrder", () => acknowledgeProductionOrder({ productionOrderId: PO })],
    ["bindProductionItemProduct", () => bindProductionItemProduct({ productionOrderId: PO, itemId: ITEM, productId: PROD })],
    ["setProductionItemLabel", () => setProductionItemLabel({ productionOrderId: PO, itemId: ITEM, label: "แหวน" })],
  ];
  it.each(all)("%s", async (_n, run) => {
    roleMock.mockResolvedValue("staff");
    const r = (await run()) as { ok: boolean };
    expect(r.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("saveWorker — สิทธิ์ผู้จัดการ/ผู้ดูแลงานนอก", () => {
  it("ส่ง flag เฉพาะที่เป็น boolean จริง · ไม่ส่ง = ไม่มี key (DB ไม่แตะค่าเดิม)", async () => {
    rpcMock.mockResolvedValue({ data: { id: WORKER, pin: null }, error: null });
    await saveWorker({ id: WORKER, displayName: "ช่าง", stageCodes: ["qc"] });
    expect(lastRpc()[0]).toBe("worker_upsert");
    expect("p_can_open_job" in lastRpc()[1]).toBe(false);
    expect("p_can_external" in lastRpc()[1]).toBe(false);
    await saveWorker({ id: WORKER, displayName: "ช่าง", stageCodes: ["qc"], canOpenJob: true });
    expect(lastRpc()[1]).toMatchObject({ p_can_open_job: true });
    expect("p_can_external" in lastRpc()[1]).toBe(false);
    await saveWorker({ id: WORKER, displayName: "ช่าง", stageCodes: ["qc"], canOpenJob: false, canExternal: true });
    expect(lastRpc()[1]).toMatchObject({ p_can_open_job: false, p_can_external: true });
  });

  it("flag ไม่ใช่ boolean → ปฏิเสธ ไม่ถึง DB · actor/shop มาจาก server ทับค่าที่ client ส่ง", async () => {
    for (const bad of ["true", 1, null, {}]) {
      const r = await saveWorker({ displayName: "ช่าง", stageCodes: ["qc"], canOpenJob: bad as unknown as boolean });
      expect(r.ok, String(bad)).toBe(false);
    }
    expect(rpcMock).not.toHaveBeenCalled();
    rpcMock.mockResolvedValue({ data: { id: WORKER, pin: null }, error: null });
    await saveWorker({ displayName: "ช่าง", stageCodes: ["qc"], canOpenJob: true, ...({ p_shop_id: "evil", p_actor: "evil" } as object) });
    expect(lastRpc()[1]).toMatchObject({ p_shop_id: SHOP, p_actor: USER });
  });

  it("stages_required ยังบังคับ: ผู้จัดการต้องมีขั้นที่ทำ ≥ 1 (ไม่ถึง DB ถ้าว่าง)", async () => {
    const r = await saveWorker({ displayName: "ผู้จัดการ", stageCodes: [], canOpenJob: true });
    expect(r.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("WORKER_COLUMNS มี can_open_job/can_external · mapWorkerRow: true เฉพาะค่า true จริง", () => {
    expect(WORKER_COLUMNS).toContain("can_open_job");
    expect(WORKER_COLUMNS).toContain("can_external");
    expect(mapWorkerRow({ id: WORKER, display_name: "ก", stage_codes: ["qc"], is_active: true, can_open_job: true, can_external: false })).toMatchObject({ canOpenJob: true, canExternal: false });
    expect(mapWorkerRow({ id: WORKER, display_name: "ก", stage_codes: ["qc"], can_open_job: "true", can_external: 1 })).toMatchObject({ canOpenJob: false, canExternal: false });
    expect(mapWorkerRow({ id: WORKER, display_name: "ก", stage_codes: [] })).toMatchObject({ canOpenJob: false, canExternal: false });
  });
});

describe("QR ร้าน (ออฟฟิศ)", () => {
  it("ออก: ส่ง shop + actor จาก server · คืน SVG (ไม่คืนค่าดิบของ token) เมื่อรูปถูก · ไม่ log ค่าดิบ", async () => {
    rpcMock.mockResolvedValue({ data: { token: RAW, issued_at: "2026-10-20T03:00:00Z", revoked_previous: 1 }, error: null });
    const r = await issueShopIntakeToken();
    expect(lastRpc()).toEqual(["shop_intake_token_issue", { p_shop_id: SHOP, p_actor: USER }]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Object.keys(r.data).sort()).toEqual(["issuedAt", "revokedPrevious", "svg", "warning"]);
      expect(r.data).toMatchObject({ issuedAt: "2026-10-20T03:00:00Z", revokedPrevious: 1, warning: null });
      expect(r.data.svg.startsWith("<svg")).toBe(true);
    }
    expect(JSON.stringify(r)).not.toContain(RAW);
    expect(JSON.stringify(errSpy.mock.calls)).not.toContain(RAW);
  });

  it("ผลจาก DB รูปผิด (token สั้น/ไม่มีเวลา) → ข้อความกลาง ไม่ส่งต่อ", async () => {
    for (const bad of [{ token: "short", issued_at: "x" }, { token: RAW }, { issued_at: "x" }, {}]) {
      rpcMock.mockResolvedValue({ data: bad, error: null });
      const r = await issueShopIntakeToken();
      expect(r.ok, JSON.stringify(bad)).toBe(false);
      expect(JSON.stringify(r)).not.toContain(RAW);
    }
  });

  it("สถานะ: เรียกแบบไม่มี p_actor (RPC อ่านอย่างเดียว) · ไม่มี token ในผล · เพิกถอน: shop+actor", async () => {
    rpcMock.mockResolvedValue({ data: { active: true, issued_at: "2026-10-20T03:00:00Z", revoked_at: null }, error: null });
    const s = await getShopIntakeStatus();
    expect(lastRpc()).toEqual(["shop_intake_token_status", { p_shop_id: SHOP }]);
    expect(s).toEqual({ ok: true, data: { active: true, issuedAt: "2026-10-20T03:00:00Z", revokedAt: null } });
    rpcMock.mockResolvedValue({ data: { revoked: 1 }, error: null });
    expect(await revokeShopIntakeToken()).toEqual({ ok: true, data: { revoked: 1 } });
    expect(lastRpc()).toEqual(["shop_intake_token_revoke", { p_shop_id: SHOP, p_actor: USER }]);
  });

  it("สถานะ (0188): เพิกถอนแล้ว = active=false + issuedAt/revokedAt ของใบล่าสุด · ไม่เคยออก = null ทั้งคู่ · DB เก่าที่ไม่มี revoked_at/ค่าผิดชนิด = null (ไม่พัง · ไม่ส่งต่อค่าแปลก)", async () => {
    rpcMock.mockResolvedValue({ data: { active: false, issued_at: "2026-10-20T03:00:00Z", revoked_at: "2026-10-21T04:00:00Z" }, error: null });
    expect(await getShopIntakeStatus()).toEqual({ ok: true, data: { active: false, issuedAt: "2026-10-20T03:00:00Z", revokedAt: "2026-10-21T04:00:00Z" } });
    rpcMock.mockResolvedValue({ data: { active: false, issued_at: null, revoked_at: null }, error: null });
    expect(await getShopIntakeStatus()).toEqual({ ok: true, data: { active: false, issuedAt: null, revokedAt: null } });
    rpcMock.mockResolvedValue({ data: { active: false, issued_at: "2026-10-20T03:00:00Z" }, error: null });
    expect(await getShopIntakeStatus()).toEqual({ ok: true, data: { active: false, issuedAt: "2026-10-20T03:00:00Z", revokedAt: null } });
    rpcMock.mockResolvedValue({ data: { active: false, issued_at: 5, revoked_at: { x: 1 } }, error: null });
    expect(await getShopIntakeStatus()).toEqual({ ok: true, data: { active: false, issuedAt: null, revokedAt: null } });
  });

  it("ไม่มี session user → ไม่เรียก DB (actor_required ฝั่ง server)", async () => {
    sessionUserMock.mockResolvedValue(null);
    expect((await issueShopIntakeToken()).ok).toBe(false);
    expect((await revokeShopIntakeToken()).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("acknowledgeProductionOrder", () => {
  it("id ผิดรูป/ไม่มี actor → ไม่ถึง DB", async () => {
    for (const id of ["", "x", "../../etc", null, undefined]) expect((await acknowledgeProductionOrder({ productionOrderId: id as unknown as string })).ok).toBe(false);
    sessionUserMock.mockResolvedValue(null);
    expect((await acknowledgeProductionOrder({ productionOrderId: PO })).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("ส่ง shop/actor จาก server (ทับของ client) · map ผล", async () => {
    rpcMock.mockResolvedValue({ data: { production_order_id: PO, po_no: "PO-0034", acknowledged_at: "2026-10-20T03:00:00Z", jobs_logged: 1 }, error: null });
    const r = await acknowledgeProductionOrder({ productionOrderId: PO, ...({ p_actor: "evil" } as object) });
    expect(lastRpc()).toEqual(["production_order_acknowledge", { p_shop_id: SHOP, p_id: PO, p_actor: USER }]);
    expect(r).toEqual({ ok: true, data: { productionOrderId: PO, poNo: "PO-0034", acknowledgedAt: "2026-10-20T03:00:00Z", jobsLogged: 1 } });
  });

  it("DB ปฏิเสธ (รับทราบซ้ำ/ใบออฟฟิศ/ใบไม่เปิดแล้ว) → map จาก hint เป็นไทยล้วน · error อื่น → ข้อความกลาง ไม่รั่วรหัส", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "22023", message: "ใบผลิต PO-0034 รับทราบไปแล้ว", hint: "already_acknowledged" } });
    expect(await acknowledgeProductionOrder({ productionOrderId: PO })).toEqual({ ok: false, error: "ใบนี้รับทราบไปแล้ว — โหลดหน้าใหม่" });
    // ข้อ 6: ใบถูกยกเลิก — ข้อความ DB มีคำอังกฤษของ status ("cancelled") ต้องไม่ถึงจอ
    rpcMock.mockResolvedValue({ data: null, error: { code: "22023", message: "ใบผลิต PO-0034 สถานะ cancelled แล้ว รับทราบไม่ได้", hint: "order_not_open" } });
    const c = await acknowledgeProductionOrder({ productionOrderId: PO });
    expect(c).toEqual({ ok: false, error: "ใบนี้ไม่ได้เปิดอยู่แล้ว — โหลดหน้าใหม่" });
    expect(JSON.stringify(c)).not.toMatch(/cancelled/);
    // hint ไม่รู้จัก + ข้อความมีคำอังกฤษ → ด่านซ้ำใช้ข้อความกลาง
    rpcMock.mockResolvedValue({ data: null, error: { code: "22023", message: "ใบผลิต PO-0034 สถานะ done แล้ว", hint: "something_new" } });
    expect(await acknowledgeProductionOrder({ productionOrderId: PO })).toEqual({ ok: false, error: "รับทราบไม่สำเร็จ — ลองอีกครั้ง" });
    rpcMock.mockResolvedValue({ data: null, error: { code: "XX000", message: "relation analytics.production_order boom" } });
    const r = await acknowledgeProductionOrder({ productionOrderId: PO });
    expect(r).toEqual({ ok: false, error: "รับทราบใบผลิตไม่สำเร็จ ลองใหม่อีกครั้ง" });
  });
});

describe("ข้อ 3 — bind/label: order_not_open ไทยล้วน (ไม่ให้ 'สถานะ cancelled' หลุดถึงจอ)", () => {
  const NOT_OPEN_BIND = { code: "22023", message: "ใบผลิต PO-0034 สถานะ cancelled แล้ว ผูก SKU ไม่ได้", hint: "order_not_open" };
  const NOT_OPEN_LABEL = { code: "22023", message: "ใบผลิต PO-0034 สถานะ done แล้ว แก้ชื่อแบบไม่ได้", hint: "order_not_open" };
  it("bind: order_not_open → 'ใบนี้ไม่ได้เปิดอยู่แล้ว — โหลดหน้าใหม่'", async () => {
    rpcMock.mockResolvedValue({ data: null, error: NOT_OPEN_BIND });
    const r = await bindProductionItemProduct({ productionOrderId: PO, itemId: ITEM, productId: PROD });
    expect(r).toEqual({ ok: false, error: "ใบนี้ไม่ได้เปิดอยู่แล้ว — โหลดหน้าใหม่" });
    expect(JSON.stringify(r)).not.toMatch(/cancelled|done/);
  });
  it("label: order_not_open → ข้อความเดียวกัน", async () => {
    rpcMock.mockResolvedValue({ data: null, error: NOT_OPEN_LABEL });
    const r = await setProductionItemLabel({ productionOrderId: PO, itemId: ITEM, label: "แหวน" });
    expect(r).toEqual({ ok: false, error: "ใบนี้ไม่ได้เปิดอยู่แล้ว — โหลดหน้าใหม่" });
    expect(JSON.stringify(r)).not.toMatch(/cancelled|done/);
  });
  it("hint อื่น (sku_duplicate/label_duplicate) ยังได้ข้อความ DB เดิม (มีรหัส SKU อังกฤษได้ ไม่ถูกตัดทิ้ง)", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "22023", message: "SKU ZZQA-FIXA อยู่ในใบผลิตนี้แล้ว (รายการอื่น)", hint: "sku_duplicate" } });
    expect(await bindProductionItemProduct({ productionOrderId: PO, itemId: ITEM, productId: PROD })).toEqual({ ok: false, error: "SKU ZZQA-FIXA อยู่ในใบผลิตนี้แล้ว (รายการอื่น)" });
    rpcMock.mockResolvedValue({ data: null, error: { code: "22023", message: "มีรายการชื่อ \"แหวน\" ในใบนี้อยู่แล้ว", hint: "label_duplicate" } });
    expect((await setProductionItemLabel({ productionOrderId: PO, itemId: ITEM, label: "แหวน" })).ok).toBe(false);
  });
});

describe("bindProductionItemProduct", () => {
  const RES = { ok: true, item_id: ITEM, product_id: PROD, sku: "RING-1", name: "แหวน", pending_product_label_before: "แหวนไม่มีรหัส", jobs_updated: 1, item_metal: "gold", sku_metal: "silver", sku_metal_known: true, metal_mismatch: true, weight_filled: false };

  it("uuid ผิดรูป/ไม่มี actor → ไม่ถึง DB", async () => {
    expect((await bindProductionItemProduct({ productionOrderId: PO, itemId: "x", productId: PROD })).ok).toBe(false);
    expect((await bindProductionItemProduct({ productionOrderId: PO, itemId: ITEM, productId: "RING-1" })).ok).toBe(false);
    sessionUserMock.mockResolvedValue(null);
    expect((await bindProductionItemProduct({ productionOrderId: PO, itemId: ITEM, productId: PROD })).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("ส่ง shop/actor จาก server · map ผล (เตือนโลหะ + ชื่อเดิมไว้บรรทัดรอง)", async () => {
    rpcMock.mockResolvedValue({ data: RES, error: null });
    const r = await bindProductionItemProduct({ productionOrderId: PO, itemId: ITEM, productId: PROD });
    expect(lastRpc()).toEqual(["production_order_item_bind_product", { p_shop_id: SHOP, p_item_id: ITEM, p_product_id: PROD, p_actor: USER }]);
    expect(r).toEqual({ ok: true, data: { itemId: ITEM, productId: PROD, sku: "RING-1", name: "แหวน", pendingLabelBefore: "แหวนไม่มีรหัส", jobsUpdated: 1, itemMetal: "gold", skuMetal: "silver", skuMetalKnown: true, metalMismatch: true, weightFilled: false } });
  });

  it("ผลรูปแปลก → ข้อความกลาง · ข้อความ DB (SKU ซ้ำ/ผูกแล้ว) ผ่าน", async () => {
    rpcMock.mockResolvedValue({ data: { ok: true }, error: null });
    expect((await bindProductionItemProduct({ productionOrderId: PO, itemId: ITEM, productId: PROD })).ok).toBe(false);
    rpcMock.mockResolvedValue({ data: null, error: { code: "22023", message: "SKU RING-1 อยู่ในใบผลิตนี้แล้ว (รายการอื่น)", hint: "sku_duplicate" } });
    expect(await bindProductionItemProduct({ productionOrderId: PO, itemId: ITEM, productId: PROD })).toEqual({ ok: false, error: "SKU RING-1 อยู่ในใบผลิตนี้แล้ว (รายการอื่น)" });
  });
});

describe("setProductionItemLabel", () => {
  it("ชื่อว่าง/ชนิดผิด/id ผิด → ไม่ถึง DB · ส่งชื่อดิบให้ DB ตรวจ (ด่านชื่อเดียวกับตอนเพิ่มรายการ) · map ผล", async () => {
    expect((await setProductionItemLabel({ productionOrderId: PO, itemId: ITEM, label: "   " })).ok).toBe(false);
    expect((await setProductionItemLabel({ productionOrderId: PO, itemId: "x", label: "แหวน" })).ok).toBe(false);
    expect((await setProductionItemLabel({ productionOrderId: PO, itemId: ITEM, label: 5 as unknown as string })).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
    rpcMock.mockResolvedValue({ data: { ok: true, item_id: ITEM, pending_product_label: "แหวน ชื่อใหม่" }, error: null });
    const r = await setProductionItemLabel({ productionOrderId: PO, itemId: ITEM, label: "  แหวน   ชื่อใหม่ " });
    expect(lastRpc()).toEqual(["production_order_item_label_set", { p_shop_id: SHOP, p_item_id: ITEM, p_label: "  แหวน   ชื่อใหม่ ", p_actor: USER }]);
    expect(r).toEqual({ ok: true, data: { label: "แหวน ชื่อใหม่" } });
  });
});

describe("log redaction (S3) — error จาก DB/fetch ที่มี URL ต้องไม่ถึง log", () => {
  const URL_ERR = { code: "XX000", message: "fetch failed https://udqmamplbymxnknkjnkz.supabase.co/rest/v1/rpc/production_order_acknowledge?id=eq.SECRET-ID retry" };
  const cases: [string, () => Promise<unknown>][] = [
    ["acknowledgeProductionOrder", () => acknowledgeProductionOrder({ productionOrderId: PO })],
    ["bindProductionItemProduct", () => bindProductionItemProduct({ productionOrderId: PO, itemId: ITEM, productId: PROD })],
    ["setProductionItemLabel", () => setProductionItemLabel({ productionOrderId: PO, itemId: ITEM, label: "แหวน" })],
  ];
  it.each(cases)("%s: log เฉพาะ {code, message} ที่ลบ URL แล้ว · ผลที่คืนผู้ใช้เป็นข้อความกลาง", async (name, run) => {
    rpcMock.mockResolvedValue({ data: null, error: URL_ERR });
    const r = (await run()) as { ok: boolean; error?: string };
    expect(r.ok).toBe(false);
    expect(errSpy.mock.calls).toHaveLength(1);
    const [label, payload] = errSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(label).toBe(`${name} failed`);
    expect(Object.keys(payload).sort()).toEqual(["code", "message"]);
    expect(payload.code).toBe("XX000");
    expect(String(payload.message)).toContain("<url>");
    const logged = JSON.stringify(errSpy.mock.calls);
    for (const leak of ["https://", "udqmamplbymxnknkjnkz", "SECRET-ID", "supabase.co"]) expect(logged, leak).not.toContain(leak);
    expect(JSON.stringify(r)).not.toMatch(/https?:|supabase|SECRET/);
  });
});

describe("getProductionOrders — ที่มาของใบ (0187)", () => {
  it("map opened_via/ผู้เปิด/รับทราบ · ค่าว่าง/แปลก = office (ใบเดิมทุกใบ)", async () => {
    const base = { note: null, spot_override_thb_per_gram: null, done_at: null, cancelled_at: null, cancel_reason: null, created_at: "2026-10-20T01:00:00Z", updated_at: "2026-10-20T01:00:00Z", item_count: 1, qty_planned_total: 3, qty_done_total: 0, status: "open" };
    listRows = [
      { ...base, id: "a", po_no: "PO-1", opened_via: "shopfloor", opened_by_worker_name: "หัวหน้าช่าง", acknowledged_at: null },
      { ...base, id: "b", po_no: "PO-2", opened_via: "office", opened_by_worker_name: null, acknowledged_at: null },
      { ...base, id: "c", po_no: "PO-3", opened_via: null, opened_by_worker_name: null, acknowledged_at: null },
      { ...base, id: "d", po_no: "PO-4", opened_via: "weird", opened_by_worker_name: null, acknowledged_at: "2026-10-20T02:00:00Z" },
    ];
    const r = await getProductionOrders();
    expect(r.ok && r.data.rows.map((x) => [x.id, x.openedVia, x.openedByWorkerName, x.acknowledgedAt])).toEqual([
      ["a", "shopfloor", "หัวหน้าช่าง", null], ["b", "office", null, null], ["c", "office", null, null], ["d", "office", null, "2026-10-20T02:00:00Z"],
    ]);
  });
});
