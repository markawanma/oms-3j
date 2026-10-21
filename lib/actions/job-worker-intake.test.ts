// lib/actions/job-worker.ts (0187 W1) — ผู้จัดการเปิดใบจากมือถือ (QR ร้าน /w/s/<token> + PIN · สาธารณะ ไม่ login)
// ครอบ: hash ที่ส่ง DB · ไม่มี shop id ในพารามิเตอร์ · input ผิดไม่ถึง RPC · cookie · ผลลัพธ์ allowlist (ไม่มีเงิน/ต้นทุน/น้ำหนักทอง) · ไม่ log ความลับ
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const TOKEN = "Ab3-_xYz0123456789AbCdEfGhIjKlMnOpQrStUvWxY";
const SESSION = "Zz9-_xYz0123456789AbCdEfGhIjKlMnOpQrStUvWxY";
const JOBTOK = "Qq7-_xYz0123456789AbCdEfGhIjKlMnOpQrStUvWxY";
const WID = "11111111-1111-4111-8111-111111111111";
const PID = "22222222-2222-4222-8222-222222222222";
const IDEM = "ik0123456789abcdef0123456789abcdef";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const rpcMock = vi.fn();
const cookieStore = new Map<string, string>();
const cookieSet = vi.fn((name: string, value: string, opts: unknown) => {
  cookieStore.set(name, value);
  return opts;
});
let hdrs: Record<string, string> = {};

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (cookieStore.has(n) ? { value: cookieStore.get(n) } : undefined), set: cookieSet }),
  headers: async () => ({ get: (n: string) => hdrs[n.toLowerCase()] ?? null }),
}));
vi.mock("@/lib/supabase/server", () => ({ getServiceClient: () => ({ schema: () => ({ rpc: rpcMock }) }) }));
vi.mock("@/lib/images/signing", () => ({
  signImagePaths: async (_s: unknown, paths: string[]) => new Map(paths.map((p) => [p, `https://signed.example/${p}`])),
  signJobPhotoPaths: async () => new Map<string, string>(),
}));

import { intakeLogin, intakeOpen, intakeSearch } from "./job-worker";
import type { IntakeOpenActionInput } from "./job-worker";
import { loadIntakeHub } from "@/lib/jobs/worker-server";

let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  cookieStore.clear();
  hdrs = { "x-forwarded-for": "203.0.113.9, 10.0.0.1", "user-agent": "Mozilla/5.0 test" };
  rpcMock.mockResolvedValue({ data: { ok: true }, error: null });
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

const params = (i = 0) => rpcMock.mock.calls[i][1] as Record<string, unknown>;
const fnOf = (i = 0) => rpcMock.mock.calls[i][0] as string;
const allLogged = () => JSON.stringify(errSpy.mock.calls);

const HUB_IDENTIFY = { ok: true, state: "identify", workers: [{ id: WID, display_name: "หัวหน้าช่าง" }], profile_ready: true, gold_profile_ready: false, session_expired: false };
const HUB_READY = { ok: true, state: "ready", worker: { id: WID, display_name: "หัวหน้าช่าง" }, open_allowed: true, profile_ready: true, gold_profile_ready: true };

describe("loadIntakeHub", () => {
  it("token รูปแบบผิด → ไม่ถึง DB · ข้อความ QR ร้านใช้ไม่ได้", async () => {
    for (const t of ["", "abc", "../oem", "x".repeat(80), null, undefined, 5]) {
      const r = await loadIntakeHub(t);
      expect(r).toMatchObject({ ok: false, code: "invalid_token", error: expect.stringContaining("QR ร้านนี้ใช้ไม่ได้แล้ว") });
    }
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("ส่ง sha256 ของ token/session/ip · ไม่มี shop id/ค่าดิบ ในพารามิเตอร์", async () => {
    cookieStore.set("w_session", SESSION);
    rpcMock.mockResolvedValue({ data: HUB_READY, error: null });
    const r = await loadIntakeHub(TOKEN);
    expect(fnOf()).toBe("shop_intake_resolve");
    expect(params()).toEqual({ p_token_hash: sha(TOKEN), p_session_hash: sha(SESSION), p_ip_hash: sha("203.0.113.9") });
    const json = JSON.stringify(params());
    for (const raw of [TOKEN, SESSION, "203.0.113.9"]) expect(json).not.toContain(raw);
    expect(Object.keys(params()).some((k) => /shop/i.test(k))).toBe(false);
    expect(r).toMatchObject({ ok: true, data: { state: "ready", openAllowed: true, profileReady: true, goldProfileReady: true, worker: { id: WID, displayName: "หัวหน้าช่าง" } } });
  });

  it("identify: รายชื่อ id+ชื่อเท่านั้น (กรอง id ผิดรูป/ชื่อว่าง) · ไม่มี session = p_session_hash null", async () => {
    rpcMock.mockResolvedValue({ data: { ...HUB_IDENTIFY, workers: [...HUB_IDENTIFY.workers, { id: "x", display_name: "ผี" }, { id: WID, display_name: "" }, { id: WID, display_name: "ช่าง", pin_hash: "x" }] }, error: null });
    const r = await loadIntakeHub(TOKEN);
    expect(params().p_session_hash).toBeNull();
    expect(r.ok && r.data.workers).toEqual([{ id: WID, displayName: "หัวหน้าช่าง" }, { id: WID, displayName: "ช่าง" }]);
    expect(JSON.stringify(r)).not.toContain("pin_hash");
    expect(r.ok && r.data.openAllowed).toBe(false);
  });

  it("DB ปฏิเสธ (QR ถูกเพิกถอน) → invalid_token + ข้อความในบริบทร้าน · เกินอัตรา → ข้อความรอ", async () => {
    rpcMock.mockResolvedValue({ data: { ok: false, code: "invalid_token", message: "x" }, error: null });
    expect(await loadIntakeHub(TOKEN)).toMatchObject({ ok: false, code: "invalid_token", error: "QR ร้านนี้ใช้ไม่ได้แล้ว — ขอ QR ใหม่จากออฟฟิศ" });
    rpcMock.mockResolvedValue({ data: { ok: false, code: "rate_limited", message: "x" }, error: null });
    expect(await loadIntakeHub(TOKEN)).toMatchObject({ ok: false, code: "rate_limited" });
  });

  it("ผลดิบมี key ต้องห้าม (เงิน/ต้นทุน) หรือรูปร่างแปลก → ไม่ส่งต่อ · error ระบบ → ข้อความกลาง ไม่ log พารามิเตอร์", async () => {
    rpcMock.mockResolvedValue({ data: { ...HUB_READY, unit_cost: 12 }, error: null });
    expect(await loadIntakeHub(TOKEN)).toMatchObject({ ok: false, error: expect.not.stringContaining("12") });
    rpcMock.mockResolvedValue({ data: { ok: true, state: "weird" }, error: null });
    expect((await loadIntakeHub(TOKEN)).ok).toBe(false);
    rpcMock.mockResolvedValue({ data: { ok: true, state: "ready", worker: null }, error: null });
    expect((await loadIntakeHub(TOKEN)).ok).toBe(false);
    cookieStore.set("w_session", SESSION);
    rpcMock.mockResolvedValue({ data: null, error: { message: `boom ${TOKEN} ${SESSION}`, code: "XX000" } });
    expect((await loadIntakeHub(TOKEN)).ok).toBe(false);
    expect(allLogged()).not.toContain(TOKEN);
    expect(allLogged()).not.toContain(SESSION);
  });
});

describe("intakeLogin", () => {
  it("worker id/PIN ผิดรูป หรือ token ผิดรูป → ไม่ถึง DB", async () => {
    for (const [w, p] of [["x", "4831"], [WID, "123"], [WID, "12345"], [WID, "abcd"], [WID, " 123"], [WID, ""]] as const) {
      expect((await intakeLogin(TOKEN, w, p)).ok, `${w} ${p}`).toBe(false);
    }
    expect((await intakeLogin("bad", WID, "4831")).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("PIN ถูก: เรียก worker_pin_verify_intake ด้วย hash · ตั้ง cookie เดียวกับ QR ใบงาน (httpOnly · path=/w · lax) · ค่า session ไม่อยู่ในผลลัพธ์", async () => {
    rpcMock.mockResolvedValue({ data: { ok: true, session_token: SESSION, expires_at: new Date(Date.now() + 12 * 3600 * 1000).toISOString(), worker: { id: WID, display_name: "x" } }, error: null });
    const r = await intakeLogin(TOKEN, WID, "0000");
    expect(r).toEqual({ ok: true });
    expect(fnOf()).toBe("worker_pin_verify_intake");
    expect(params()).toMatchObject({ p_token_hash: sha(TOKEN), p_worker_id: WID, p_pin: "0000", p_ip_hash: sha("203.0.113.9") });
    expect(JSON.stringify(params())).not.toContain(TOKEN);
    expect(Object.keys(params()).some((k) => /shop/i.test(k))).toBe(false);
    expect(cookieSet).toHaveBeenCalledTimes(1);
    const [name, value, opts] = cookieSet.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(name).toBe("w_session");
    expect(value).toBe(SESSION);
    expect(opts).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/w" });
    expect(JSON.stringify(r)).not.toContain(SESSION);
  });

  it("ผิด/ล็อก: ข้อความเดิมของ workerFailMessage (เหลืออีก n ครั้ง · รอ n นาที · ล็อกจนออฟฟิศปลด) · ไม่มีข้อความงบ/วัน (QR ร้านไม่มีงบนี้) · ไม่ตั้ง cookie", async () => {
    rpcMock.mockResolvedValue({ data: { ok: false, code: "bad_credentials", message: "x", attempts_left: 2, attempts_until_office: 12 }, error: null });
    expect(await intakeLogin(TOKEN, WID, "0001")).toMatchObject({ ok: false, error: expect.stringContaining("เหลืออีก 2 ครั้งก่อนถูกล็อกชั่วคราว") });
    rpcMock.mockResolvedValue({ data: { ok: false, code: "locked", message: "x", retry_after_seconds: 900 }, error: null });
    expect(await intakeLogin(TOKEN, WID, "0001")).toMatchObject({ code: "locked", retryAfterSeconds: 900, error: "ใส่ PIN ผิดหลายครั้ง — ลองใหม่ใน 15 นาที" });
    rpcMock.mockResolvedValue({ data: { ok: false, code: "locked_office", message: "x" }, error: null });
    expect(await intakeLogin(TOKEN, WID, "0001")).toMatchObject({ code: "locked_office", error: "ล็อกแล้ว ให้ออฟฟิศปลดล็อก" });
    rpcMock.mockResolvedValue({ data: { ok: false, code: "bad_credentials", message: "x", attempts_left: 4, attempts_until_office: 14 }, error: null });
    const r = await intakeLogin(TOKEN, WID, "0001");
    expect(r.ok === false && r.error).toBe("ชื่อหรือ PIN ไม่ถูกต้อง");
    expect(cookieSet).not.toHaveBeenCalled();
  });

  it("ผลจาก DB ไม่มี session_token รูปถูก → ไม่ตั้ง cookie · ข้อความกลาง", async () => {
    rpcMock.mockResolvedValue({ data: { ok: true, session_token: "bad value" }, error: null });
    expect((await intakeLogin(TOKEN, WID, "4831")).ok).toBe(false);
    expect(cookieSet).not.toHaveBeenCalled();
  });
});

describe("intakeSearch", () => {
  it("ว่าง → ผลว่าง ไม่ถึง DB · อักขระควบคุม/< >/ล่องหน/ยาวเกิน 60 → ไม่ถึง DB", async () => {
    expect(await intakeSearch(TOKEN, "  ")).toEqual({ ok: true, items: [] });
    for (const q of ["a\nb", "a\tb", "<b>", "a‮b", "a​b", "x".repeat(61), "a\u0000b"]) expect((await intakeSearch(TOKEN, q)).ok, JSON.stringify(q)).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("ไม่มี session (cookie) → session_required ไม่ถึง DB", async () => {
    expect(await intakeSearch(TOKEN, "แหวน")).toMatchObject({ ok: false, code: "session_required", error: "หมดเวลาแล้ว — ใส่ PIN ใหม่" });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("ส่ง hash + คำค้น (ตัดช่องว่างหัวท้าย) · ไม่มี shop id", async () => {
    cookieStore.set("w_session", SESSION);
    rpcMock.mockResolvedValue({ data: { ok: true, items: [] }, error: null });
    await intakeSearch(TOKEN, "  แหวน  ");
    expect(fnOf()).toBe("job_product_search");
    expect(params()).toEqual({ p_token_hash: sha(TOKEN), p_session_hash: sha(SESSION), p_q: "แหวน", p_ip_hash: sha("203.0.113.9") });
  });

  it("allowlist: คืนเฉพาะ id/sku/ชื่อ/รูป(เซ็นแล้ว)/prefill · น้ำหนักทอง/ทองเหลืองไม่ถึง client แม้ DB ส่งมา · path รูปแปลกไม่ถูกเซ็น · แถวผิดรูปถูกทิ้ง", async () => {
    cookieStore.set("w_session", SESSION);
    const item = (over: Record<string, unknown>) => ({ id: PID, sku: "RING-1", name: "แหวน", image_path: "shop/prod/a_sm.webp", prefill: { metal: "silver", purity: 0.925, weight_g: 3.5, metal_known: false }, ...over });
    rpcMock.mockResolvedValue({
      data: {
        ok: true,
        items: [
          item({}),
          item({ sku: "G-1", prefill: { metal: "gold", purity: 0.75, weight_g: 5.5, metal_known: true }, internal_hint: "zzz" }),
          item({ sku: "B-1", image_path: "../../etc/passwd", prefill: { metal: "brass", purity: 1, weight_g: 2, metal_known: false } }),
          item({ sku: "BAD-METAL", prefill: { metal: "platinum", purity: 1, weight_g: 1, metal_known: true } }),
          item({ id: "nope" }),
          item({ sku: "" }),
        ],
      },
      error: null,
    });
    const r = await intakeSearch(TOKEN, "แหวน");
    expect(r.ok && r.items.map((x) => x.sku)).toEqual(["RING-1", "G-1", "B-1"]);
    if (!r.ok) throw new Error("unreachable");
    expect(r.items[0]).toEqual({ id: PID, sku: "RING-1", name: "แหวน", imageUrl: "https://signed.example/shop/prod/a_sm.webp", prefill: { metal: "silver", purity: 0.925, weightG: 3.5, metalKnown: false } });
    expect(r.items[1].prefill).toEqual({ metal: "gold", purity: 0.75, weightG: null, metalKnown: true });
    expect(r.items[2].imageUrl).toBeNull();
    expect(r.items[2].prefill.weightG).toBeNull();
    expect(JSON.stringify(r)).not.toMatch(/extra_cost|99|5\.5|passwd/);
  });

  it("ผลดิบมี key ต้องห้าม → ไม่ส่งต่อ", async () => {
    cookieStore.set("w_session", SESSION);
    rpcMock.mockResolvedValue({ data: { ok: true, items: [{ id: PID, sku: "A", name: "x", list_price: 100, prefill: { metal: "silver" } }] }, error: null });
    expect((await intakeSearch(TOKEN, "x")).ok).toBe(false);
  });
});

const GOOD: IntakeOpenActionInput = { idemKey: IDEM, productId: PID, qty: 3 };
const GOOD_NEW: IntakeOpenActionInput = { idemKey: IDEM, label: "แหวนลายใบไม้", metal: "silver", qty: "30" };
const OPEN_OK = { ok: true, already: false, order_no: "PO-0034", job_no: "JB-0031", token: JOBTOK, design_label: "แหวนลายใบไม้", sku: null, sku_pending: true, metal: "silver", qty_order: 30, qty_planned: 30, is_new_design: false, due_date: null };

describe("ขอบเขตช่องทางสาธารณะ (static)", () => {
  it("โค้ดฝั่งช่างไม่ส่ง p_shop_id/p_actor ให้ RPC ใดเลย (ร้านมาจาก token ร้านที่ DB ตรวจ)", async () => {
    const { readFileSync } = await import("node:fs");
    for (const f of ["lib/jobs/worker-server.ts", "lib/actions/job-worker.ts"]) {
      const code = readFileSync(f, "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(code, f).not.toMatch(/p_shop_id|p_actor|shop_id/);
    }
  });
  it("ผลสำเร็จของเปิดใบไม่ spread ผลดิบ (allowlist ทีละ field) — ไม่มี ...r ใน openIntakeJob/searchIntakeProducts/loadIntakeHub", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("lib/jobs/worker-server.ts", "utf8");
    const intake = src.slice(src.indexOf("0187 W1"));
    expect(intake).not.toMatch(/\.\.\.\s*r\b(?!\w)/);
  });
});

describe("intakeOpen — input ผิดไม่ถึง DB (ด่านก่อน RPC · ระบุช่อง)", () => {
  const cases: [string, IntakeOpenActionInput, string][] = [
    ["idem key สั้น", { ...GOOD, idemKey: "short" }, "key"],
    ["idem key มีช่องว่าง", { ...GOOD, idemKey: "has space in key 0123456789abc" }, "key"],
    ["idem key ยาว 65", { ...GOOD, idemKey: "k".repeat(65) }, "key"],
    ["มีทั้ง SKU และชื่อ", { ...GOOD, label: "แหวน", metal: "silver" }, "product"],
    ["ไม่มีทั้ง SKU และชื่อ", { idemKey: IDEM, qty: 1 }, "label"],
    ["SKU ไม่ใช่ uuid", { ...GOOD, productId: "RING-1" }, "product"],
    ["ชื่อมี < >", { ...GOOD_NEW, label: "<b>แหวน</b>" }, "label"],
    ["ชื่อมีอักขระล่องหน", { ...GOOD_NEW, label: "แหวน​ลาย" }, "label"],
    ["ชื่อมี bidi", { ...GOOD_NEW, label: "แหวน‮ลาย" }, "label"],
    ["ชื่อมีขึ้นบรรทัดใหม่", { ...GOOD_NEW, label: "แหวน\nลาย" }, "label"],
    ["ชื่อยาว 201", { ...GOOD_NEW, label: "ก".repeat(201) }, "label"],
    ["สินค้าใหม่ไม่เลือกโลหะ", { idemKey: IDEM, label: "แหวน", qty: 1 }, "metal"],
    ["โลหะนอกชุด", { ...GOOD_NEW, metal: "platinum" }, "metal"],
    ["ทองไม่มีเนื้อ", { ...GOOD_NEW, metal: "gold" }, "purity"],
    ["ทองเนื้อว่างเปล่า", { ...GOOD_NEW, metal: "gold", purityPct: "  " }, "purity"],
    ["เนื้อพิมพ์เป็นสัดส่วน 0.75", { ...GOOD_NEW, metal: "gold", purityPct: "0.75" }, "purity"],
    ["เนื้อ 1 (ตกหลัก 100)", { ...GOOD_NEW, metal: "gold", purityPct: "1" }, "purity"],
    ["เนื้อต่ำกว่า 37.50", { ...GOOD_NEW, metal: "gold", purityPct: "37" }, "purity"],
    ["เนื้อเกิน 100", { ...GOOD_NEW, metal: "gold", purityPct: "100.01" }, "purity"],
    ["เนื้อทศนิยมเกิน 2 ตำแหน่ง", { ...GOOD_NEW, purityPct: "92.555" }, "purity"],
    ["เนื้อไม่ใช่ตัวเลข/มี %", { ...GOOD_NEW, purityPct: "92%" }, "purity"],
    ["เนื้อเลขยกกำลัง", { ...GOOD_NEW, purityPct: "9e1" }, "purity"],
    ["ทองเหลืองเนื้อไม่ใช่ 100", { ...GOOD_NEW, metal: "brass", purityPct: "90" }, "purity"],
    ["น้ำหนัก 0", { ...GOOD_NEW, weight: "0" }, "weight"],
    ["น้ำหนักติดลบ", { ...GOOD_NEW, weight: "-1" }, "weight"],
    ["น้ำหนักเกิน 10,000", { ...GOOD_NEW, weight: "10000.001" }, "weight"],
    ["น้ำหนักทศนิยมเกิน 3 ตำแหน่ง", { ...GOOD_NEW, weight: "1.2345" }, "weight"],
    ["น้ำหนักไม่ใช่ตัวเลข", { ...GOOD_NEW, weight: "abc" }, "weight"],
    ["น้ำหนักเลขยกกำลัง", { ...GOOD_NEW, weight: "1e3" }, "weight"],
    ["จำนวน 0", { ...GOOD_NEW, qty: 0 }, "qty"],
    ["จำนวนทศนิยม", { ...GOOD_NEW, qty: "1.5" }, "qty"],
    ["จำนวนมีจุลภาค", { ...GOOD_NEW, qty: "1,5" }, "qty"],
    ["จำนวนเกิน 100,000", { ...GOOD_NEW, qty: 100001 }, "qty"],
    ["จำนวนว่าง", { ...GOOD_NEW, qty: "" }, "qty"],
    ["เผื่อติดลบ", { ...GOOD_NEW, buffer: "-1" }, "buffer"],
    ["เผื่อไม่ใช่ตัวเลข", { ...GOOD_NEW, buffer: "abc" }, "buffer"],
    ["เผื่อทำให้รวมเกิน 100,000", { ...GOOD_NEW, qty: 5, buffer: 100000 }, "buffer"],
    ["กำหนดเสร็จรูปแบบผิด", { ...GOOD_NEW, dueDate: "12/11/2026" }, "due"],
    ["กำหนดเสร็จวันที่ไม่มีจริง", { ...GOOD_NEW, dueDate: "2026-02-30" }, "due"],
    ["หมายเหตุมีอักขระล่องหน", { ...GOOD_NEW, note: "รีบ​" }, "note"],
    ["หมายเหตุมี control", { ...GOOD_NEW, note: "รีบ\u0007" }, "note"],
    ["หมายเหตุขึ้นบรรทัดใหม่", { ...GOOD_NEW, note: "รีบ\nมาก" }, "note"],
    ["หมายเหตุยาว 501", { ...GOOD_NEW, note: "ก".repeat(501) }, "note"],
  ];
  it.each(cases)("%s", async (_name, input, field) => {
    const r = await intakeOpen(TOKEN, input);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.field).toBe(field);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("token ร้านผิดรูป / ไม่มี session → ไม่ถึง DB", async () => {
    expect(await intakeOpen("bad", GOOD)).toMatchObject({ ok: false, code: "invalid_token" });
    expect(await intakeOpen(TOKEN, GOOD)).toMatchObject({ ok: false, code: "session_required" });
    expect(await intakeOpen(TOKEN, null as unknown as IntakeOpenActionInput)).toMatchObject({ ok: false });
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("intakeOpen — ส่ง DB เฉพาะที่ระบุ + แปลงหน่วยที่ขอบเดียว", () => {
  beforeEach(() => {
    cookieStore.set("w_session", SESSION);
    rpcMock.mockResolvedValue({ data: OPEN_OK, error: null });
  });

  it("มี SKU ค่าเริ่มทั้งหมด: ส่ง hash + key + SKU + จำนวน + แบบใหม่=false เท่านั้น (ไม่มี metal/purity/weight/planned/due/note) · ไม่มี shop id/ราคา/ต้นทุน/stage/profile", async () => {
    const r = await intakeOpen(TOKEN, GOOD);
    expect(fnOf()).toBe("job_worker_open");
    expect(params()).toEqual({ p_token_hash: sha(TOKEN), p_session_hash: sha(SESSION), p_idem_key: IDEM, p_qty_order: 3, p_is_new_design: false, p_user_agent: "Mozilla/5.0 test", p_ip_hash: sha("203.0.113.9"), p_product_id: PID });
    expect(Object.keys(params()).some((k) => /shop|price|cost|stage|profile|actor/i.test(k))).toBe(false);
    expect(JSON.stringify(params())).not.toContain(TOKEN);
    expect(r.ok).toBe(true);
  });

  it("ไม่มี SKU ทอง 75% น้ำหนัก 5.5 เผื่อ 3 กำหนด+แบบใหม่+หมายเหตุ: เนื้อ % → สัดส่วน 0.75 · planned = qty+buffer · เว้นช่องว่างหัวท้าย", async () => {
    await intakeOpen(TOKEN, { idemKey: IDEM, label: "  แหวนทอง   ใหม่ ", metal: "gold", purityPct: "75", weight: "5.5", qty: 10, buffer: "3", dueDate: "2026-11-30", isNewDesign: true, note: "  ด่วน " });
    expect(params()).toMatchObject({ p_pending_label: "แหวนทอง ใหม่", p_metal: "gold", p_purity: 0.75, p_weight_g: 5.5, p_qty_order: 10, p_qty_planned: 13, p_due_date: "2026-11-30", p_is_new_design: true, p_note: "ด่วน" });
    expect(params().p_product_id).toBeUndefined();
  });

  it("เงินไม่ใส่เนื้อ = ไม่ส่ง p_purity (DB ใช้ 92.50) · ใส่ 99.90 = 0.999 · เผื่อ 0 = ไม่ส่ง planned · ทองเหลืองว่าง/100 ผ่านโดยไม่ส่งเนื้อ", async () => {
    await intakeOpen(TOKEN, { ...GOOD_NEW, buffer: 0 });
    expect(params().p_purity).toBeUndefined();
    expect(params().p_qty_planned).toBeUndefined();
    await intakeOpen(TOKEN, { ...GOOD_NEW, purityPct: "99.90" });
    expect(params(1).p_purity).toBe(0.999);
    await intakeOpen(TOKEN, { ...GOOD_NEW, metal: "brass", purityPct: "100" });
    await intakeOpen(TOKEN, { ...GOOD_NEW, metal: "brass" });
    expect(params(2).p_purity).toBeUndefined();
    expect(params(3).p_purity).toBeUndefined();
    expect(params(3).p_metal).toBe("brass");
  });

  it("ผลสำเร็จ: map แบบ allowlist (token ครั้งเดียว · jobNo · ชื่อ · sku_pending) — ไม่มี order_no/ราคาหลุดไปหน้าจอ", async () => {
    const r = await intakeOpen(TOKEN, GOOD_NEW);
    expect(r).toEqual({ ok: true, result: { already: false, jobNo: "JB-0031", token: JOBTOK, designLabel: "แหวนลายใบไม้", sku: null, skuPending: true, metal: "silver", qtyOrder: 30, qtyPlanned: 30, isNewDesign: false, dueDate: null } });
    expect(JSON.stringify(r)).not.toContain("PO-0034");
  });

  it("กดซ้ำ (already) → ไม่มี token · เลขใบเดิม", async () => {
    rpcMock.mockResolvedValue({ data: { ok: true, already: true, order_no: "PO-0034", job_no: "JB-0031", design_label: "แหวน", metal: "silver", qty_order: 30 }, error: null });
    const r = await intakeOpen(TOKEN, GOOD_NEW);
    expect(r).toMatchObject({ ok: true, result: { already: true, token: null, jobNo: "JB-0031" } });
  });

  it("ผลดิบผิดรูป (job_no/token/โลหะ) หรือมี key ต้องห้าม → ข้อความกลาง ไม่ส่งต่อ", async () => {
    for (const bad of [{ ...OPEN_OK, job_no: "JB-x" }, { ...OPEN_OK, token: "short" }, { ...OPEN_OK, metal: "platinum" }, { ...OPEN_OK, unit_cost: 5 }, { ...OPEN_OK, target_piece_g: 5.5 }]) {
      rpcMock.mockResolvedValue({ data: bad, error: null });
      const r = await intakeOpen(TOKEN, GOOD_NEW);
      expect(r.ok, JSON.stringify(bad)).toBe(false);
      expect(JSON.stringify(r)).not.toMatch(/5\.5|unit_cost/);
    }
  });

  it("error ของ DB → ข้อความไทยตามตาราง · job_exists ใส่เลขใบ · เกินอัตรา → retryAfterSeconds จำกัด 3600", async () => {
    const fail = (code: string, extra: Record<string, unknown> = {}) => rpcMock.mockResolvedValueOnce({ data: { ok: false, code, message: "x", ...extra }, error: null });
    fail("job_exists", { job_no: "JB-0012" });
    expect(await intakeOpen(TOKEN, GOOD)).toMatchObject({ ok: false, code: "job_exists", error: expect.stringContaining("JB-0012") });
    fail("job_exists", { job_no: "'; drop table x; --" });
    const r2 = await intakeOpen(TOKEN, GOOD);
    expect(!r2.ok && r2.error).toBe("SKU นี้มีใบงานเปิดอยู่แล้ว — ถ้าต้องการเพิ่มจำนวน แจ้งออฟฟิศ หรือเลือกสินค้าอื่น");
    fail("no_gold_profile");
    expect(await intakeOpen(TOKEN, GOOD_NEW)).toMatchObject({ ok: false, code: "no_gold_profile", error: expect.stringContaining("แบบการบันทึกสำหรับงานทอง") });
    fail("no_default_profile");
    expect(await intakeOpen(TOKEN, GOOD_NEW)).toMatchObject({ ok: false, code: "no_default_profile" });
    fail("not_allowed");
    expect(await intakeOpen(TOKEN, GOOD)).toMatchObject({ ok: false, code: "not_allowed", error: "บัญชีนี้ไม่มีสิทธิ์เปิดงานใหม่ — แจ้งออฟฟิศ" });
    fail("idem_conflict");
    expect(await intakeOpen(TOKEN, GOOD)).toMatchObject({ ok: false, code: "idem_conflict" });
    fail("session_required");
    expect(await intakeOpen(TOKEN, GOOD)).toMatchObject({ ok: false, code: "session_required", error: "หมดเวลาแล้ว — ใส่ PIN ใหม่" });
    fail("invalid_token");
    expect(await intakeOpen(TOKEN, GOOD)).toMatchObject({ ok: false, code: "invalid_token", error: expect.stringContaining("QR ร้านนี้ใช้ไม่ได้แล้ว") });
    fail("rate_limited", { retry_after_seconds: 99999 });
    expect(await intakeOpen(TOKEN, GOOD)).toMatchObject({ ok: false, code: "rate_limited", retryAfterSeconds: 3600 });
    fail("unknown_new_code", { message: "ERROR: relation analytics.production_order violates foreign key" });
    const r3 = await intakeOpen(TOKEN, GOOD);
    expect(!r3.ok && r3.error).toBe("ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง");
  });

  it("error ระบบ (PostgREST) → ข้อความกลาง · ไม่ log token/session/idem/พารามิเตอร์", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: `fail ${TOKEN} ${SESSION} ${IDEM} ${JOBTOK}`, code: "XX000", hint: null } });
    const r = await intakeOpen(TOKEN, GOOD_NEW);
    expect(r).toMatchObject({ ok: false, error: "ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง" });
    const logged = allLogged();
    for (const secret of [TOKEN, SESSION, IDEM, JOBTOK, "203.0.113.9"]) expect(logged).not.toContain(secret);
  });
});
