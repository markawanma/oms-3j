// QA (R2-D2 · 21 ต.ค. 69) — W1 UI: "รูปร่างจริงของ RPC" เข้าชั้น TS
// ที่มา: payload ด้านล่างคัดจากการยิง RPC จริงบน DB (ร้านสังเคราะห์ในทรานแซกชันที่ ROLLBACK — 0187 apply แล้ว) ไม่ใช่รูปที่เดาเอง
//   เหตุผล: เทสต์เดิมของ job-worker-intake.test.ts ใช้ mock ที่ทีมเขียนเอง — ไฟล์นี้พิสูจน์ว่าของจริงที่ DB ส่งผ่าน allowlist/ตัวแปลง/ข้อความ error ได้ครบ
// ต้องถูก: ผลสำเร็จ (SKU เดียว / replay / job_exists) map ได้ · error ทุก code ที่ DB ส่งจริงเป็นข้อความไทยสะอาด + พาไปช่องที่ถูก
// ต้องไม่พัง: ตัวเลขจาก numeric ของ Postgres (0.9250 · 10.000) ไม่ทำให้ prefill เพี้ยน
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const TOKEN = "Ab3-_xYz0123456789AbCdEfGhIjKlMnOpQrStUvWxY";
const SESSION = "Zz9-_xYz0123456789AbCdEfGhIjKlMnOpQrStUvWxY";
const JOBTOK = "cIU9WS-DUZGrTC9v3LaEWrV7-BeHiX46Y4ZtBJa5YBU"; // รูปจริง 43 ตัวจาก job_worker_open
const PID = "22222222-2222-4222-8222-222222222222";
const IDEM = "ik0123456789abcdef0123456789abcdef";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const rpcMock = vi.fn();
const cookieStore = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (cookieStore.has(n) ? { value: cookieStore.get(n) } : undefined), set: vi.fn() }),
  headers: async () => ({ get: (n: string) => ({ "x-forwarded-for": "203.0.113.9", "user-agent": "qa" })[n.toLowerCase()] ?? null }),
}));
vi.mock("@/lib/supabase/server", () => ({ getServiceClient: () => ({ schema: () => ({ rpc: rpcMock }) }) }));
vi.mock("@/lib/images/signing", () => ({
  signImagePaths: async (_s: unknown, paths: string[]) => new Map(paths.map((p) => [p, `https://signed.example/${p}`])),
  signJobPhotoPaths: async () => new Map<string, string>(),
}));

import { intakeLogin, intakeOpen } from "@/lib/actions/job-worker";
import { loadIntakeHub, searchIntakeProducts } from "@/lib/jobs/worker-server";
import { shopErrorView } from "@/lib/jobs/shop-open";

let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  cookieStore.clear();
  cookieStore.set("w_session", SESSION);
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

// ---- payload จริง (คัดจาก NOTICE ของ replay) ----
const REAL_HUB_IDENTIFY = { ok: true, state: "identify", workers: [{ id: PID, display_name: "ผู้จัดการ QA" }], session_expired: false };
const REAL_HUB_READY = { ok: true, state: "ready", worker: { id: PID, display_name: "ผู้จัดการ QA" }, open_allowed: true, profile_ready: true, gold_profile_ready: true };
const REAL_SEARCH = {
  ok: true,
  items: [
    { id: PID, sku: "ZZQA-FIXA", name: "แหวนทดสอบ QA A", image_path: null, prefill: { metal: "silver", purity: 0.925, weight_g: null, metal_known: false } },
    { id: "33333333-3333-4333-8333-333333333333", sku: "ZZQA-SPOT", name: "spot QA", image_path: null, prefill: { metal: "silver", purity: 0.925, weight_g: 10.0, metal_known: true } },
    { id: "44444444-4444-4444-8444-444444444444", sku: "ZZQA-W35", name: "เงินมีน้ำหนัก 3.5 QA", image_path: "ab/cd.jpg", prefill: { metal: "silver", purity: 0.925, weight_g: 3.5, metal_known: false } },
  ],
};
const REAL_OPEN_OK = { ok: true, sku: "ZZQA-FIXA", metal: "silver", token: JOBTOK, job_no: "JB-0001", status: "open", already: false, due_date: null, order_no: "PO-0001", qty_order: 30, qty_planned: 30, sku_pending: false, is_new_design: false, design_label: "แหวนทดสอบ QA A" };
const REAL_OPEN_REPLAY = { ok: true, sku: "ZZQA-FIXA", metal: "silver", job_no: "JB-0001", status: "open", already: true, due_date: null, order_no: "PO-0001", qty_order: 30, qty_planned: 30, sku_pending: false, is_new_design: false, design_label: "แหวนทดสอบ QA A" };
const REAL_OPEN_NEWGOLD = { ok: true, sku: null, metal: "gold", token: JOBTOK, job_no: "JB-0004", status: "open", already: false, due_date: "2026-10-24", order_no: "PO-0004", qty_order: 30, qty_planned: 35, sku_pending: true, is_new_design: true, design_label: "แหวนทอง QA" };

describe("real shapes — hub / ค้นสินค้า", () => {
  it("hub identify/ready จริง → map ครบ (ไม่มี profile_ready ตอน identify = false ทั้งคู่)", async () => {
    rpcMock.mockResolvedValue({ data: REAL_HUB_IDENTIFY, error: null });
    expect(await loadIntakeHub(TOKEN)).toMatchObject({ ok: true, data: { state: "identify", workers: [{ id: PID, displayName: "ผู้จัดการ QA" }], profileReady: false, goldProfileReady: false, sessionExpired: false } });
    rpcMock.mockResolvedValue({ data: REAL_HUB_READY, error: null });
    expect(await loadIntakeHub(TOKEN)).toMatchObject({ ok: true, data: { state: "ready", openAllowed: true, profileReady: true, goldProfileReady: true } });
  });

  it("ค้นสินค้าจริง: numeric ของ Postgres (0.925 · 10 · 3.5) · metal_known เฉพาะ spot/spec · รูปเซ็น URL ฝั่ง server · key ใน prefill ถูก allowlist", async () => {
    rpcMock.mockResolvedValue({ data: REAL_SEARCH, error: null });
    const r = await searchIntakeProducts(TOKEN, "ZZQA");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.map((p) => [p.sku, p.prefill.metalKnown, p.prefill.purity, p.prefill.weightG])).toEqual([
      ["ZZQA-FIXA", false, 0.925, null],
      ["ZZQA-SPOT", true, 0.925, 10],
      ["ZZQA-W35", false, 0.925, 3.5],
    ]);
    expect(r.data[2].imageUrl).toBe("https://signed.example/ab/cd.jpg");
    expect(r.data[0].imageUrl).toBeNull();
    expect(Object.keys(r.data[0]).sort()).toEqual(["id", "imageUrl", "name", "prefill", "sku"]);
  });

  it("ทอง/ทองเหลืองที่ DB ส่ง weight_g มา (ไม่ควรส่ง) → TS ตัดทิ้ง ไม่ถึง client (N1)", async () => {
    rpcMock.mockResolvedValue({ data: { ok: true, items: [{ id: PID, sku: "G1", name: "แหวนทอง", image_path: null, prefill: { metal: "gold", purity: 0.965, weight_g: 5.5, metal_known: true } }] }, error: null });
    const r = await searchIntakeProducts(TOKEN, "G");
    expect(r.ok && r.data[0].prefill.weightG).toBeNull();
    expect(JSON.stringify(r)).not.toContain("5.5");
  });
});

describe("real shapes — เปิดใบ", () => {
  const sku = (): Parameters<typeof intakeOpen>[1] => ({ idemKey: IDEM, productId: PID, qty: "30", isNewDesign: false });

  it("เปิดสำเร็จ (SKU เดียว) → result ครบ + token รูปจริง 43 ตัวผ่านด่าน · ส่งเฉพาะ arg ที่ RPC รู้จัก", async () => {
    rpcMock.mockResolvedValue({ data: REAL_OPEN_OK, error: null });
    const r = await intakeOpen(TOKEN, sku());
    expect(r).toMatchObject({ ok: true, result: { already: false, status: "open", jobNo: "JB-0001", token: JOBTOK, sku: "ZZQA-FIXA", skuPending: false, metal: "silver", qtyOrder: 30, qtyPlanned: 30, isNewDesign: false, dueDate: null } });
    const p = rpcMock.mock.calls[0][1] as Record<string, unknown>;
    expect(rpcMock.mock.calls[0][0]).toBe("job_worker_open");
    expect(Object.keys(p).sort()).toEqual(["p_idem_key", "p_ip_hash", "p_is_new_design", "p_product_id", "p_qty_order", "p_session_hash", "p_token_hash", "p_user_agent"].sort());
    expect(p.p_token_hash).toBe(sha(TOKEN));
  });

  it("replay จริง (ไม่มี key token) → already=true · token=null · ไม่ใช่ error", async () => {
    rpcMock.mockResolvedValue({ data: REAL_OPEN_REPLAY, error: null });
    const r = await intakeOpen(TOKEN, sku());
    expect(r).toMatchObject({ ok: true, result: { already: true, token: null, jobNo: "JB-0001", status: "open" } });
  });

  it("สินค้าใหม่ทอง เผื่อ 35 + กำหนด + แบบใหม่ → result.qtyPlanned/dueDate/skuPending จริง · ไม่มีเลขน้ำหนักทองในผลที่ส่งให้ UI", async () => {
    rpcMock.mockResolvedValue({ data: REAL_OPEN_NEWGOLD, error: null });
    const r = await intakeOpen(TOKEN, { idemKey: IDEM, label: "แหวนทอง QA", metal: "gold", purityPct: "96.50", weight: "3.2", qty: "30", buffer: "5", dueDate: "2026-10-24", isNewDesign: true });
    expect(r).toMatchObject({ ok: true, result: { metal: "gold", qtyOrder: 30, qtyPlanned: 35, dueDate: "2026-10-24", skuPending: true, sku: null, isNewDesign: true } });
    const p = rpcMock.mock.calls[0][1] as Record<string, unknown>;
    expect(p).toMatchObject({ p_pending_label: "แหวนทอง QA", p_metal: "gold", p_purity: 0.965, p_weight_g: 3.2, p_qty_order: 30, p_qty_planned: 35, p_due_date: "2026-10-24", p_is_new_design: true });
    expect(JSON.stringify(r)).not.toContain("3.2");
  });

  it("job_exists จริง (มี job_no ติดมา) → ข้อความมีเลขใบ JB-0001 · code ให้ UI พาไปเลือกสินค้า", async () => {
    rpcMock.mockResolvedValue({ data: { ok: false, code: "job_exists", job_no: "JB-0001", message: "SKU นี้มีใบงานเปิดอยู่แล้ว — ถ้าต้องการเพิ่มจำนวน แจ้งออฟฟิศ หรือเลือกสินค้าอื่น" }, error: null });
    const r = await intakeOpen(TOKEN, sku());
    expect(r).toMatchObject({ ok: false, code: "job_exists", error: expect.stringContaining("JB-0001") });
    if (r.ok) return;
    expect(shopErrorView(r)).toMatchObject({ action: "pick", field: "product", message: expect.stringContaining("JB-0001") });
  });
});

// ข้อความ error จริงของ job_worker_open (คัดจาก job_fail ใน 0187) → ต้องเป็นข้อความไทยสะอาด + ไปช่องที่ถูก + ไม่ติดคำว่าเงิน/รหัสดิบ
const REAL_FAILS: { code: string; message: string; field?: string; action: string }[] = [
  { code: "qty_invalid", message: "จำนวนต้องอยู่ระหว่าง 1 ถึง 100,000 ชิ้น", field: "qty", action: "back" },
  { code: "gold_purity_required", message: "ทองต้องใส่เนื้อทอง (ขั้นต่ำ 37.50%)", field: "purity", action: "back" },
  { code: "purity_invalid", message: "เนื้อโลหะต้องอยู่ระหว่าง 37.50% ถึง 100%", field: "purity", action: "back" },
  { code: "weight_invalid", message: "น้ำหนักไม่ถูกต้อง (ตัวเลขมากกว่า 0 ทศนิยมไม่เกิน 3 ตำแหน่ง)", field: "weight", action: "back" },
  { code: "due_invalid", message: "กำหนดเสร็จต้องไม่ย้อนหลังและไม่เกิน 2 ปีข้างหน้า", field: "due", action: "back" },
  { code: "name_invalid", message: "ชื่อแบบไม่ถูกต้อง — ห้ามเว้นว่าง ห้ามขึ้นบรรทัดใหม่/อักขระล่องหน/เครื่องหมาย < > และยาวไม่เกิน 200 ตัวอักษร", field: "label", action: "back" },
  { code: "note_invalid", message: "หมายเหตุไม่ถูกต้อง — ห้ามขึ้นบรรทัดใหม่/อักขระล่องหน และยาวไม่เกิน 500 ตัวอักษร", field: "note", action: "back" },
  { code: "metal_required", message: "สินค้าใหม่ต้องเลือกวัสดุ", field: "metal", action: "back" },
  { code: "metal_invalid", message: "เลือกวัสดุเป็นเงิน ทอง หรือทองเหลือง", field: "metal", action: "back" },
  { code: "sku_invalid", message: "เลือกสินค้านี้ไม่ได้ — เลือกสินค้าอื่น หรือแจ้งออฟฟิศ", field: "product", action: "back" },
  { code: "sku_or_label", message: "ต้องเลือกสินค้า หรือพิมพ์ชื่อแบบอย่างใดอย่างหนึ่ง", field: "label", action: "back" },
  { code: "no_gold_profile", message: "เปิดงานทองไม่ได้ตอนนี้ — ยังไม่มีแบบการบันทึกสำหรับงานทอง แจ้งออฟฟิศให้ตั้งก่อน", field: "metal", action: "back" },
  { code: "no_default_profile", message: "เปิดงานไม่ได้ตอนนี้ — ร้านยังไม่ได้ตั้งแบบการบันทึกงาน แจ้งออฟฟิศให้ตั้งก่อน", action: "retry" },
  { code: "not_ready", message: "เปิดงานไม่ได้ตอนนี้ — ร้านยังตั้งขั้นตอนการผลิตไม่ครบ แจ้งออฟฟิศ", action: "retry" },
  { code: "not_allowed", message: "บัญชีนี้ไม่มีสิทธิ์เปิดงานใหม่ — แจ้งออฟฟิศ", action: "final" },
  { code: "idem_invalid", message: "ข้อมูลไม่ครบ — โหลดหน้าใหม่แล้วลองอีกครั้ง", action: "retry" },
  { code: "idem_conflict", message: "คำขอนี้ซ้ำกับของคนอื่น — โหลดหน้าใหม่แล้วลองอีกครั้ง", action: "retry" },
  { code: "invalid_token", message: "QR ร้านนี้ใช้ไม่ได้แล้ว", action: "final" },
];

describe("real shapes — ข้อความ error ทุก code ที่ DB ส่งจริง (B.8)", () => {
  for (const f of REAL_FAILS) {
    it(`${f.code}: ผ่าน openIntakeJob → shopErrorView สะอาด · action=${f.action}${f.field ? ` · ช่อง=${f.field}` : ""}`, async () => {
      rpcMock.mockResolvedValue({ data: { ok: false, code: f.code, message: f.message }, error: null });
      const r = await intakeOpen(TOKEN, { idemKey: IDEM, productId: PID, qty: "5", isNewDesign: false });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      const v = shopErrorView(r);
      expect(v.action).toBe(f.action);
      if (f.field) expect(v.field).toBe(f.field);
      // ไม่มีรหัสดิบ (snake_case) · ไม่มีคำเกี่ยวกับเงิน · ไม่ว่าง
      expect(v.message).not.toMatch(/[A-Za-z]+_[A-Za-z_]+/);
      expect(v.message).not.toMatch(/บาท|฿|THB|ราคา|ต้นทุน|price|cost|margin/i);
      expect(v.message.trim().length).toBeGreaterThan(5);
      // ไม่ log ความลับ
      expect(JSON.stringify(errSpy.mock.calls)).not.toContain(TOKEN);
    });
  }

  it("rate_limited จริง (ไม่มี retry_after) → กดซ้ำได้ · มี retry_after → นับถอยหลัง", async () => {
    rpcMock.mockResolvedValue({ data: { ok: false, code: "rate_limited", message: "ส่งถี่เกินไป — รอสักครู่แล้วลองใหม่" }, error: null });
    const r = await intakeOpen(TOKEN, { idemKey: IDEM, productId: PID, qty: "5", isNewDesign: false });
    expect(r.ok === false && shopErrorView(r).action).toBe("retry");
    rpcMock.mockResolvedValue({ data: { ok: false, code: "rate_limited", message: "x", retry_after_seconds: 42.2 }, error: null });
    const r2 = await intakeOpen(TOKEN, { idemKey: IDEM, productId: PID, qty: "5", isNewDesign: false });
    expect(r2.ok === false && shopErrorView(r2)).toMatchObject({ action: "wait", waitSeconds: 43 });
  });
});

describe("real shapes — PIN ทาง QR ร้าน (คัดจากบันไดจริง)", () => {
  const WID = "11111111-1111-4111-8111-111111111111";
  it("PIN ผิดครั้งที่ 7 ของวัน (token_budget_left=0) → ข้อความเหลือ 0 ครั้ง (ทั้งร้านใช้ร่วมกัน) · ไม่ตั้ง cookie", async () => {
    rpcMock.mockResolvedValue({ data: { ok: false, code: "bad_credentials", message: "ชื่อหรือ PIN ไม่ถูกต้อง", attempts_left: 4, token_budget_left: 0, attempts_until_office: 14 }, error: null });
    const r = await intakeLogin(TOKEN, WID, "0001");
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("ได้อีก 0 ครั้ง") });
    if (!r.ok) expect(r.error).toContain("ทั้งร้านใช้ร่วมกัน");
  });
  it("ครั้งที่ 8 จริง (token_budget_exhausted) → 'ขอ QR ร้านใหม่จากออฟฟิศ' ไม่ใช่ 'แจ้งออฟฟิศ' ของ DB", async () => {
    rpcMock.mockResolvedValue({ data: { ok: false, code: "token_budget_exhausted", message: "ใส่ PIN ผิดครบกำหนดของวันนี้แล้ว — แจ้งออฟฟิศ" }, error: null });
    expect(await intakeLogin(TOKEN, WID, "0001")).toMatchObject({ ok: false, code: "token_budget_exhausted", error: "วันนี้ใส่ PIN ผิดครบกำหนดแล้ว — ขอ QR ร้านใหม่จากออฟฟิศ" });
  });
  it("locked จริง (retry_after_seconds 900) → 'ลองใหม่ใน 15 นาที' (ไม่ใช่ข้อความ 'ลองใหม่ภายหลัง' ของ DB)", async () => {
    rpcMock.mockResolvedValue({ data: { ok: false, code: "locked", message: "ใส่ PIN ผิดหลายครั้ง ถูกล็อกชั่วคราว — ลองใหม่ภายหลัง หรือให้ออฟฟิศรีเซ็ต PIN", locked_until: "2026-10-21T11:17:54.111349+00:00", retry_after_seconds: 900 }, error: null });
    expect(await intakeLogin(TOKEN, WID, "0002")).toMatchObject({ ok: false, code: "locked", retryAfterSeconds: 900, error: "ใส่ PIN ผิดหลายครั้ง — ลองใหม่ใน 15 นาที" });
  });
});
