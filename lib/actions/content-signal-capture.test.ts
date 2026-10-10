// lib/actions/content-signal-capture.test.ts — แปะลิงก์: สิทธิ์ · ไม่ออกเครือข่ายไปลิงก์ · ตัวเลขย่อ/ธงประมาณ · ซ้ำ 23505 พร้อม id เดิม · ห้ามผ่านรายข้อ
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SHOP = "a7c850ee-6776-4c3e-ba72-ba9e8caba2b7";
const DUP = "44444444-4444-4444-8444-444444444444";
const NEW_ID = "55555555-5555-4555-8555-555555555555";
const getEffectiveRoleMock = vi.fn();
const rpcMock = vi.fn();

vi.mock("@/lib/auth/role", () => ({ getEffectiveRole: () => getEffectiveRoleMock() }));
vi.mock("@/lib/dev/context", () => ({ getDevShopId: () => SHOP }));
vi.mock("@/lib/supabase/server", () => ({ getServiceClient: () => ({ schema: () => ({ rpc: rpcMock, from: vi.fn() }) }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { captureSignal } from "./content-signal-capture";

const GOOD = { url: "https://www.tiktok.com/@some.user/video/1?is_from_webapp=1", hookText: "ใส่อาบน้ำได้ไหม?" };
const params = () => rpcMock.mock.calls[0][1] as Record<string, unknown>;

let fetchSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  getEffectiveRoleMock.mockResolvedValue("owner");
  rpcMock.mockResolvedValue({ data: NEW_ID, error: null });
  fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ห้ามออกเครือข่าย"));
});
afterEach(() => fetchSpy.mockRestore());

describe("captureSignal", () => {
  it("staff/role ไม่รู้จัก → ไม่เรียก RPC", async () => {
    for (const role of ["staff", "viewer", undefined]) {
      getEffectiveRoleMock.mockResolvedValue(role);
      expect((await captureSignal(GOOD)).ok).toBe(false);
    }
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("ส่ง RPC ถูกชื่อ: reference_clip · ลิงก์ล้าง tracking · platform/account จากสตริง · สรุป = hook · shop/actor จาก server", async () => {
    const r = await captureSignal(GOOD);
    expect(r).toEqual({ ok: true, data: { id: NEW_ID } });
    expect(rpcMock.mock.calls[0][0]).toBe("content_signal_capture");
    expect(params()).toMatchObject({
      p_kind: "reference_clip",
      p_url: "https://www.tiktok.com/@some.user/video/1",
      p_platform: "tiktok",
      p_account: "@some.user",
      p_hook_text: "ใส่อาบน้ำได้ไหม?",
      p_summary: "ใส่อาบน้ำได้ไหม?",
      p_source: "owner",
      p_metrics_approx: false,
      p_shop_id: SHOP,
      p_actor_role: "owner",
    });
  });

  it("🔴 ไม่มี request ออกไปโดเมนปลายทางเลย (ลิงก์ TikTok/ลิงก์สั้น/ลิงก์อื่น)", async () => {
    for (const url of ["https://www.tiktok.com/@a/video/1", "https://vt.tiktok.com/ZS1/", "https://youtu.be/AbC", "https://example.test/x"]) {
      await captureSignal({ ...GOOD, url });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("ตัวเลขย่อ → จำนวนเต็ม + ธงประมาณอัตโนมัติ · ไม่เห็น = null (ไม่ใช่ 0)", async () => {
    await captureSignal({ ...GOOD, followers: "16K", views: "1.2M", likes: "", saves: "0" });
    expect(params()).toMatchObject({ p_account_followers: 16000, p_views: 1_200_000, p_likes: null, p_saves: 0, p_comments: null, p_metrics_approx: true });
    rpcMock.mockClear();
    await captureSignal({ ...GOOD, views: "5000" });
    expect(params()).toMatchObject({ p_views: 5000, p_metrics_approx: false });
  });

  it("ไม่มีตัวเลขสักช่อง → ธงประมาณเป็น false เสมอ (DB ปฏิเสธ approx ที่ไม่มีเลข)", async () => {
    await captureSignal(GOOD);
    expect(params().p_metrics_approx).toBe(false);
    expect(params().p_metrics_seen_on).toBeNull();
  });

  it("ซ้ำ (23505) → ข้อความ 'เคยแปะแล้ว' + id เดิมจาก detail ที่ช่องลิงก์", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "23505", message: "content_signal_capture: ลิงก์นี้ถูกบันทึกไว้แล้ว", details: DUP } });
    const r = await captureSignal(GOOD);
    expect(r).toEqual({ ok: false, error: "ลิงก์นี้เคยแปะแล้ว", field: "url", duplicateId: DUP });
  });

  it("ซ้ำแต่ detail ไม่ใช่ uuid → ไม่ส่ง id มั่ว", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "23505", message: "x", details: "<script>" } });
    const r = await captureSignal(GOOD);
    expect(!r.ok && r.duplicateId).toBeNull();
  });

  it("ห้ามผ่าน (ไม่ถึง RPC): ลิงก์ผิด · hook ว่าง/ยาว · สรุปยาว · ตัวเลขผิด · ประมาณแต่ไม่มีเลข · วันอนาคต · ค่านอก allowlist", async () => {
    const bad: [Record<string, unknown>, string][] = [
      [{ url: "javascript:alert(1)" }, "url"],
      [{ url: "" }, "url"],
      [{ hookText: "   " }, "hook"],
      [{ hookText: "ก".repeat(501) }, "hook"],
      [{ summary: "ก".repeat(301) }, "summary"],
      [{ views: "-5" }, "views"],
      [{ followers: "abc" }, "followers"],
      [{ likes: "99999999999" }, "likes"],
      [{ approx: true }, "views"],
      [{ postedOn: "2999-01-01" }, "postedOn"],
      [{ postedOn: "ไม่ใช่วัน" }, "postedOn"],
      [{ hookType: "ขยะ" }, "hook"],
      [{ source: "ai_radar" }, "form"],
      [{ customerGroup: "gold" }, "form"],
    ];
    for (const [o, field] of bad) {
      const r = await captureSignal({ ...GOOD, ...o } as never);
      expect(r.ok, JSON.stringify(o)).toBe(false);
      expect(!r.ok && r.field, JSON.stringify(o)).toBe(field);
    }
    expect((await captureSignal(null as never)).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("DB ปฏิเสธเรื่องอื่น → ข้อความไทย ไม่รั่วข้อความดิบ", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "22023", message: "content_signal_capture: summary ต้องมี 1 บรรทัด ยาว 1-300 ตัวอักษร" } });
    const r = await captureSignal(GOOD);
    expect(!r.ok && r.error).toBe("สรุปต้องมี 1–300 ตัวอักษร");
  });
});
