// action หลังบ้าน Ring Builder — ปฏิเสธ non-owner ทุกตัว · actor/shop ใส่ที่ server · แปลงขนาดด้วย parser · ผลตรวจรหัส 8 สถานะ
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const role = vi.fn();
const sessionUser = vi.fn();
const requireSession = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ getServiceClient: () => ({ schema: () => ({ rpc }), storage: { from: () => ({ upload: vi.fn(), remove: vi.fn().mockResolvedValue({}) }) } }) }));
vi.mock("@/lib/dev/context", () => ({ getDevShopId: () => "00000000-0000-0000-0000-000000000001" }));
vi.mock("@/lib/auth/role", () => ({ getEffectiveRole: () => role() }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: () => sessionUser(), requireSessionIfGateOn: () => requireSession() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { revalidatePath } from "next/cache";
import * as actions from "./ring-builder";
import { issueCode } from "@/lib/ring-builder/code-sign";
import { buildCodeCheckResult } from "@/lib/ring-builder/admin-server";

const UUID = "11111111-2222-3333-4444-555555555555";
const ACTOR = "99999999-8888-7777-6666-555555555555";
const SECRET = "actions-test-secret-0123456789-abcdefgh";
const saved = process.env.RING_BUILDER_CODE_SECRET;

beforeEach(() => {
  rpc.mockReset();
  role.mockReset().mockResolvedValue("owner");
  sessionUser.mockReset().mockResolvedValue({ id: ACTOR });
  requireSession.mockReset().mockResolvedValue(undefined);
  vi.mocked(revalidatePath).mockClear();
  process.env.RING_BUILDER_CODE_SECRET = SECRET;
});
afterEach(() => {
  if (saved === undefined) delete process.env.RING_BUILDER_CODE_SECRET;
  else process.env.RING_BUILDER_CODE_SECRET = saved;
});

const fd = () => {
  const f = new FormData();
  f.set("designId", UUID);
  return f;
};

const CALLS: [string, () => Promise<unknown>][] = [
  ["getRingBuilderAdmin", () => actions.getRingBuilderAdmin()],
  ["saveRingShape", () => actions.saveRingShape({ name: "กลม", renderKind: "round" })],
  ["saveRingStone", () => actions.saveRingStone({ name: "โกเมน", shortName: "โกเมน", colorHex: "#7A1F2B" })],
  ["saveRingOffer", () => actions.saveRingOffer({ stoneId: UUID, shapeId: UUID, size: "2x2" })],
  ["setRingOfferPrice", () => actions.setRingOfferPrice({ offerId: UUID, priceThb: 80 })],
  ["saveRingDesign", () => actions.saveRingDesign({ name: "แบบ ก", stoneCount: 5, shapeId: UUID, size: "2", stoneAxis: null, sizeMin: 45, sizeMax: 68 })],
  ["setRingDesignPrice", () => actions.setRingDesignPrice({ designId: UUID, priceThb: 480 })],
  ["publishRingDesign", () => actions.publishRingDesign(UUID)],
  ["duplicateRingDesign", () => actions.duplicateRingDesign(UUID)],
  ["setRingActive", () => actions.setRingActive({ kind: "stone", id: UUID, active: false })],
  ["uploadRingCardImage", () => actions.uploadRingCardImage(fd())],
  ["clearRingCardImage", () => actions.clearRingCardImage(UUID)],
  ["checkRingCode", () => actions.checkRingCode("3JR-AAAAA")],
];

describe("ปฏิเสธผู้ที่ไม่ใช่ owner/admin ทุก action (ไม่แตะ DB)", () => {
  it("ครบทุก export ที่เป็น action", () => {
    expect(Object.keys(actions).sort()).toEqual(CALLS.map(([n]) => n).sort());
  });
  it.each(CALLS)("%s — staff / undefined / role แปลก ⇒ ถูกปฏิเสธ", async (_n, call) => {
    for (const r of ["staff", undefined, "superuser", "OWNER", null]) {
      role.mockResolvedValue(r);
      const res = (await call()) as { ok: boolean; error?: string };
      expect(res.ok).toBe(false);
      expect(res.error).toContain("เฉพาะเจ้าของร้าน/แอดมิน");
    }
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each(CALLS)("%s — owner/admin แต่ไม่มี session ⇒ ต้องเข้าสู่ระบบ (ไม่แตะ DB)", async (_n, call) => {
    requireSession.mockRejectedValue(new Error("no session"));
    const res = (await call()) as { ok: boolean; error?: string };
    expect(res).toEqual({ ok: false, error: "ต้องเข้าสู่ระบบก่อน" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("admin ผ่านด่านเช่นกัน", async () => {
    role.mockResolvedValue("admin");
    rpc.mockResolvedValue({ data: { already: false }, error: null });
    expect((await actions.publishRingDesign(UUID)).ok).toBe(true);
  });
  it("owner แต่อ่าน session user ไม่ได้ ⇒ ไม่เรียก RPC (ไม่มี actor)", async () => {
    sessionUser.mockResolvedValue(null);
    const res = await actions.publishRingDesign(UUID);
    expect(res.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("input ผิด ⇒ ปฏิเสธก่อนถึง DB", () => {
  it.each([
    ["uuid ผิด", () => actions.publishRingDesign("not-a-uuid")],
    ["ราคา 0", () => actions.setRingOfferPrice({ offerId: UUID, priceThb: 0 })],
    ["ราคาทศนิยม", () => actions.setRingOfferPrice({ offerId: UUID, priceThb: 80.5 })],
    ["ราคา NaN", () => actions.setRingDesignPrice({ designId: UUID, priceThb: NaN })],
    ["ราคาเกินเพดาน", () => actions.setRingDesignPrice({ designId: UUID, priceThb: 1_000_001 })],
    ["kind แปลก", () => actions.setRingActive({ kind: "x" as never, id: UUID, active: true })],
    ["active ไม่ใช่ boolean", () => actions.setRingActive({ kind: "stone", id: UUID, active: "yes" as never })],
    ["จำนวนเม็ด 2", () => actions.saveRingDesign({ name: "a", stoneCount: 2, shapeId: UUID, size: "2", stoneAxis: null, sizeMin: 45, sizeMax: 68 })],
    ["axis แปลก", () => actions.saveRingDesign({ name: "a", stoneCount: 5, shapeId: UUID, size: "2", stoneAxis: "diag" as never, sizeMin: 45, sizeMax: 68 })],
    ["ขนาด 2,5", () => actions.saveRingOffer({ stoneId: UUID, shapeId: UUID, size: "2,5" })],
    ["ขนาด 2.555", () => actions.saveRingOffer({ stoneId: UUID, shapeId: UUID, size: "2.555" })],
    ["ขนาด NaN", () => actions.saveRingOffer({ stoneId: UUID, shapeId: UUID, size: "NaN" })],
    ["ขนาด 25", () => actions.saveRingDesign({ name: "a", stoneCount: 5, shapeId: UUID, size: "25", stoneAxis: null, sizeMin: 45, sizeMax: 68 })],
    ["ขนาดว่าง", () => actions.saveRingOffer({ stoneId: UUID, shapeId: UUID, size: "" })],
    ["renderKind แปลก", () => actions.saveRingShape({ name: "สามเหลี่ยม", renderKind: "tri" as never })],
    ["ชื่อยาวเกิน", () => actions.saveRingStone({ name: "ก".repeat(300), shortName: "ก", colorHex: "#000000" })],
    ["ข้อความตรวจรหัสใหญ่เกิน", () => actions.checkRingCode("x".repeat(4001))],
    ["ไม่ใช่ FormData", () => actions.uploadRingCardImage({} as never)],
    ["ไม่มีไฟล์", () => actions.uploadRingCardImage(fd())],
  ])("%s", async (_n, call) => {
    const res = await call();
    expect(res.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("พารามิเตอร์ที่ส่งถึง RPC", () => {
  it("shop/actor ใส่ที่ server — ค่า p_actor/p_shop_id ที่ client แอบส่งมาถูกทับ", async () => {
    rpc.mockResolvedValue({ data: { already: true }, error: null });
    await actions.publishRingDesign(UUID);
    expect(rpc).toHaveBeenCalledWith("rb_design_publish", { p_design_id: UUID, p_shop_id: "00000000-0000-0000-0000-000000000001", p_actor: ACTOR });
    rpc.mockClear();
    rpc.mockResolvedValue({ data: { id: UUID, stone_no: 3, created: true }, error: null });
    await actions.saveRingStone({ name: "โกเมน", shortName: "โกเมน", colorHex: "#7A1F2B", p_actor: "evil", p_shop_id: "evil" } as never);
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args.p_actor).toBe(ACTOR);
    expect(args.p_shop_id).toBe("00000000-0000-0000-0000-000000000001");
  });
  it("ขนาดพลอย: 3×4 / 4x3 / 4 × 3 ⇒ major 400 minor 300 (canonical) · 2 ⇒ 200×200", async () => {
    rpc.mockResolvedValue({ data: { id: UUID, created: true, reactivated: false }, error: null });
    for (const s of ["3×4", "4x3", "4 × 3"]) {
      rpc.mockClear();
      await actions.saveRingOffer({ stoneId: UUID, shapeId: UUID, size: s });
      expect(rpc.mock.calls[0][1]).toMatchObject({ p_major_mm100: 400, p_minor_mm100: 300 });
    }
    rpc.mockClear();
    await actions.saveRingOffer({ stoneId: UUID, shapeId: UUID, size: "2" });
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_major_mm100: 200, p_minor_mm100: 200 });
  });
  it("saveRingDesign: ตั้งราคาตัวเรือนต่อเมื่อส่งมา · ราคาล้ม = บอกว่าบันทึกแบบแล้วแต่ราคาไม่สำเร็จ", async () => {
    rpc.mockResolvedValueOnce({ data: { id: UUID, design_no: 7, created: true }, error: null }).mockResolvedValueOnce({ data: null, error: { code: "22023", hint: "price_invalid" } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await actions.saveRingDesign({ name: "แบบ ก", stoneCount: 5, shapeId: UUID, size: "2", stoneAxis: null, sizeMin: 45, sizeMax: 68, bodyPriceThb: 480 });
    spy.mockRestore();
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toContain("บันทึกแบบแล้ว");
    expect(!res.ok && res.code).toBe("price_invalid");
    expect(rpc).toHaveBeenCalledTimes(2);
  });
  it("revalidatePath('/ring-builder') หลังแก้ราคา/เปิดปิด/เปิดขาย", async () => {
    rpc.mockResolvedValue({ data: { unchanged: false, changed: true, affected_designs: 2, already: false }, error: null });
    await actions.setRingOfferPrice({ offerId: UUID, priceThb: 80 });
    await actions.setRingDesignPrice({ designId: UUID, priceThb: 480 });
    await actions.setRingActive({ kind: "shape", id: UUID, active: false });
    await actions.publishRingDesign(UUID);
    expect(vi.mocked(revalidatePath).mock.calls.filter((c) => c[0] === "/ring-builder")).toHaveLength(4);
  });
  it("setRingActive คืน affectedDesigns", async () => {
    rpc.mockResolvedValue({ data: { changed: true, affected_designs: 3 }, error: null });
    expect(await actions.setRingActive({ kind: "shape", id: UUID, active: false })).toEqual({ ok: true, data: { changed: true, affectedDesigns: 3 } });
  });
});

describe("error ของ DB", () => {
  it("hint ที่รู้จัก → ข้อความไทย + code · hint แปลก/ข้อความดิบ → ข้อความกลางไม่ echo · log เฉพาะ code", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValue({ data: null, error: { code: "55000", hint: "design_locked", message: "host=db.example password=hunter2" } });
    const r1 = await actions.publishRingDesign(UUID);
    expect(r1).toMatchObject({ ok: false, code: "design_locked" });
    expect(!r1.ok && r1.error).toContain("เปิดขายแล้ว");
    rpc.mockResolvedValue({ data: null, error: { code: "XX000", hint: "Bad Hint!", message: "host=db.example password=hunter2" } });
    const r2 = await actions.publishRingDesign(UUID);
    expect(r2).toEqual({ ok: false, error: "ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง" });
    expect(JSON.stringify(spy.mock.calls)).not.toMatch(/hunter2|db\.example/);
    spy.mockRestore();
  });
});

describe("checkRingCode — 8 สถานะ (ระบบตรวจไม่ได้ ≠ รหัสผิด)", () => {
  const f = { designNo: 7, size: 54 as number | null, positions: [3, 0, 5], totalThb: 720, pricedAtSec: 24_000_000 };
  const code = () => {
    const r = issueCode(f);
    if (!r.ok) throw new Error();
    return r.code;
  };
  const dbCheck = (over: Record<string, unknown> = {}) => ({
    ok: true, found: true, size_status: "ok", signed_total_match: true, closed_stones: [],
    design: { no: 7, name: "แบบ ก", stone_count: 3, shape_kind: "round", shape_name: "กลม", major_mm100: 200, minor_mm100: 200, size_min: 45, size_max: 68, is_active: true, shape_active: true, status_changed_at: "2026-11-01T05:00:00Z" },
    creation: { at: "2026-11-09T07:32:00Z", complete: true, body: 480, total: 720, lines: [{ pos: 1, stone_no: 3, name: "โกเมน", price: 80 }, { pos: 2, stone_no: 0, name: null, price: 0 }, { pos: 3, stone_no: 5, name: "ซิทริน", price: 160 }] },
    current: { at: "2026-11-10T01:00:00Z", complete: true, body: 480, total: 720, lines: [{ pos: 1, stone_no: 3, name: "โกเมน", price: 80, stone_active: true, offer_active: true }, { pos: 2, stone_no: 0, name: null, price: 0, stone_active: true, offer_active: true }, { pos: 3, stone_no: 5, name: "ซิทริน", price: 160, stone_active: true, offer_active: true }] },
    ...over,
  });
  const run = async (text: string) => {
    const r = await actions.checkRingCode(text);
    if (!r.ok) throw new Error(r.error);
    return r.data;
  };

  it("empty / not_found / bad_format / not_issued — ไม่เรียก DB", async () => {
    expect((await run("")).status).toBe("empty");
    expect((await run("สวัสดี ไม่มีรหัส")).status).toBe("not_found");
    expect((await run("รหัส 3JR-AAAAA-AAAAA")).status).toBe("bad_format");
    const c = code();
    const forged = c.slice(0, 12) + (c[12] === "A" ? "B" : "A") + c.slice(13);
    const s = (await run(forged)).status;
    expect(["bad_format", "not_issued"]).toContain(s); // แก้ 1 ตัว = ตก check char · ไม่ใช่ unavailable
    expect(s).not.toBe("unavailable");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("ok: ราคา/พลอยไม่เปลี่ยน · ส่ง priced_at/signed_total จากรหัส (ไม่ใช่จาก client)", async () => {
    rpc.mockResolvedValue({ data: dbCheck(), error: null });
    const r = await run(`ขอสั่งทำ\nรหัสสั่งทำ: ${code().toLowerCase()}\nขอบคุณ`);
    expect(r.status).toBe("ok");
    expect(r.view).toMatchObject({ designNo: 7, size: 54, creationTotalThb: 720, currentTotalThb: 720, diffTotalThb: 0, designActive: true });
    expect(r.view?.rows.map((x) => x.label)).toEqual(["ตัวเรือน", "โกเมน", "CZ ขาว", "ซิทริน"]);
    expect(r.view?.rows[2]).toMatchObject({ included: true, creationThb: null });
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(rpc.mock.calls[0][0]).toBe("rb_code_check");
    expect(args).toMatchObject({ p_design_no: 7, p_size: 54, p_positions: [3, 0, 5], p_signed_total: 720, p_priced_at: "2026-11-09T05:20:00Z".length ? expect.any(String) : "" });
  });
  it("changed: ราคาเปลี่ยน (+฿20) · พลอยถูกปิด", async () => {
    const changed = dbCheck();
    (changed.current as Record<string, unknown>).total = 740;
    ((changed.current as { lines: Record<string, unknown>[] }).lines[0]).price = 100;
    rpc.mockResolvedValue({ data: changed, error: null });
    const r = await run(code());
    expect(r.status).toBe("changed");
    expect(r.view?.diffTotalThb).toBe(20);
    expect(r.view?.rows[1]).toMatchObject({ creationThb: 80, currentThb: 100, diffThb: 20 });
    expect(r.view?.priceNoticeText).toContain("฿740");
    rpc.mockResolvedValue({ data: dbCheck({ closed_stones: [{ stone_no: 5, name: "ซิทริน" }] }), error: null });
    const r2 = await run(code());
    expect(r2.status).toBe("changed");
    expect(r2.view?.closedStones).toEqual([{ stoneNo: 5, name: "ซิทริน" }]);
    expect(r2.view?.lines[2].closedNow).toBe(true);
  });
  it("design_closed: แบบปิดแล้ว · แสดงรายละเอียดตามตอนสร้าง + วันที่ปิด", async () => {
    const closed = dbCheck();
    (closed.design as Record<string, unknown>).is_active = false;
    rpc.mockResolvedValue({ data: closed, error: null });
    const r = await run(code());
    expect(r.status).toBe("design_closed");
    expect(r.view?.designClosedLabel).toBe("1 พ.ย. 2569");
    expect(r.view?.creationTotalThb).toBe(720);
  });
  it("M1: ทรงปิดแล้ว (แบบเองยังเปิด) ⇒ design_closed · วันที่ปิดตามทรง · closedBy=shape · ไม่ใช่ ok", async () => {
    const shapeClosed = dbCheck();
    Object.assign(shapeClosed.design as Record<string, unknown>, { shape_active: false, shape_status_changed_at: "2026-11-05T05:00:00Z" });
    rpc.mockResolvedValue({ data: shapeClosed, error: null });
    const r = await run(code());
    expect(r.status).toBe("design_closed");
    expect(r.view).toMatchObject({ designActive: true, shapeActive: false, closedBy: "shape", closedLabel: "5 พ.ย. 2569", designClosedLabel: null });
  });
  it("M1: ปิดทั้งแบบและทรง ⇒ แสดงวันที่ของแบบ (closedBy=design) · แบบปิดอย่างเดียวคง field เดิม", async () => {
    const both = dbCheck();
    Object.assign(both.design as Record<string, unknown>, { is_active: false, shape_active: false, shape_status_changed_at: "2026-11-05T05:00:00Z" });
    rpc.mockResolvedValue({ data: both, error: null });
    const r = await run(code());
    expect(r.view).toMatchObject({ closedBy: "design", closedLabel: "1 พ.ย. 2569", designClosedLabel: "1 พ.ย. 2569" });
  });
  it("M1: ไม่มี shape_active ในผลจาก DB ⇒ ตรวจไม่ได้ (ไม่เดาว่าเปิด)", async () => {
    const noShape = dbCheck();
    delete (noShape.design as Record<string, unknown>).shape_active;
    rpc.mockResolvedValue({ data: noShape, error: null });
    expect((await run(code())).status).toBe("unavailable");
  });
  it("L1: ไซซ์นอกช่วงของแบบ ⇒ changed (ไม่ใช่ ok)", async () => {
    rpc.mockResolvedValue({ data: dbCheck({ size_status: "out_of_range" }), error: null });
    const r = await run(code());
    expect(r.status).toBe("changed");
    expect(r.view?.sizeStatus).toBe("out_of_range");
  });
  it("L2: stone_locked แปลเป็นข้อความไทยพร้อม code", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValue({ data: null, error: { code: "55000", hint: "stone_locked" } });
    const res = await actions.saveRingStone({ id: UUID, name: "ชื่อใหม่", shortName: "ใหม่", colorHex: "#000000" });
    spy.mockRestore();
    expect(res).toEqual({ ok: false, error: "พลอยนี้เคยมีราคาขายแล้ว — แก้ชื่อ/สีไม่ได้ (เพิ่มพลอยใหม่แทน)", code: "stone_locked" });
  });
  it("unavailable: DB ล้ม · โครงผิด · found=false · secret หาย — ไม่ปนกับรหัสผิด", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const c = code();
    rpc.mockResolvedValue({ data: null, error: { code: "57014" } });
    expect((await run(c)).status).toBe("unavailable");
    rpc.mockResolvedValue({ data: { ok: true, found: false }, error: null });
    expect((await run(c)).status).toBe("unavailable");
    rpc.mockResolvedValue({ data: { ok: true, found: true }, error: null });
    expect((await run(c)).status).toBe("unavailable");
    rpc.mockResolvedValue({ data: "x", error: null });
    expect((await run(c)).status).toBe("unavailable");
    rpc.mockClear();
    delete process.env.RING_BUILDER_CODE_SECRET;
    const r = await run(c);
    expect(r).toEqual({ status: "unavailable", view: null });
    expect(rpc).not.toHaveBeenCalled();
    spy.mockRestore();
  });
  it("ไซซ์ null ⇒ size_status admin_check · ข้อความสรุปมี 'รอแอดมินช่วยเช็ก'", () => {
    const res = buildCodeCheckResult(dbCheck({ size_status: "admin_check" }), "3JR-X", 720, null, Date.parse("2026-11-10T01:00:00Z"));
    expect(res.view?.sizeStatus).toBe("admin_check");
    expect(res.view?.summaryText).toContain("ไซซ์: รอแอดมินช่วยเช็ก");
    expect(res.view?.ageDays).toBe(0);
  });
  it("signed_total ไม่ตรงประวัติ ⇒ changed + historyMatchesSignedTotal=false", () => {
    const res = buildCodeCheckResult(dbCheck({ signed_total_match: false }), "3JR-X", 721, 54, Date.now());
    expect(res.status).toBe("changed");
    expect(res.view?.historyMatchesSignedTotal).toBe(false);
  });
});
