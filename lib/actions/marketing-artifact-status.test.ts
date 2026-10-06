// lib/actions/marketing-artifact-status.test.ts  (QA R2-D2, 7 ต.ค. 69 — เทสต์ของ 0159 ฝั่ง TS)
//
// dev เพิ่มแขนง 55000 ใน setCampaignArtifactStatus (lib/actions/marketing.ts) แต่เทสต์ที่ส่งมามีแค่
// mapCalendarRpcError — ตัว server action ไม่เคยถูก import ในเทสต์ใดเลย ไฟล์นี้ปิดช่องนั้น:
//   - 55000 (trigger ปิดเส้นทางเดิมของ step ใน workflow ใหม่) → ข้อความบอกทางไปหน้าชิ้นงาน
//   - 22023 ยังเป็นข้อความ silver_bar เหมือนเดิม (ลำดับความสำคัญไม่ถูกแขนงใหม่ทับ)
//   - error อื่น/ไม่มี code → ข้อความ generic เดิม
//   - ข้อความ 55000 ต้องไม่รั่วข้อความดิบของ DB/uuid ไปถึงผู้ใช้
//   - role staff ถูกปฏิเสธก่อนถึง RPC · status นอก whitelist ไม่ถึง RPC
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getEffectiveRoleMock = vi.fn();
const rpcMock = vi.fn();
const schemaMock = vi.fn();

vi.mock("@/lib/auth/role", () => ({
  getEffectiveRole: () => getEffectiveRoleMock(),
}));
vi.mock("@/lib/dev/context", () => ({ getDevShopId: () => "shop-1" }));
vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({
    schema: (name: string) => {
      schemaMock(name);
      return { rpc: rpcMock, from: vi.fn() };
    },
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { setCampaignArtifactStatus } from "./marketing";

const ART = "3f2e0000-0000-4000-8000-000000000001";
const SILVER_BAR_MSG = "สินค้าเงินแท่งห้ามมีส่วนลด (กันเก็งกำไรราคา)";
const GENERIC_MSG = "อัปเดตสถานะไม่สำเร็จ ลองใหม่อีกครั้ง";

beforeEach(() => {
  getEffectiveRoleMock.mockReset().mockResolvedValue("owner");
  rpcMock.mockReset();
  schemaMock.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("setCampaignArtifactStatus — 0159 error mapping", () => {
  it("maps 55000 to the new-workflow message (the path guard raised by trg_step_artifact_piece_guard)", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: "55000", message: "ชิ้นงานนี้อยู่ใน workflow ใหม่ — เปลี่ยนสถานะผ่านหน้าชิ้นงาน (content_piece_advance) ไม่ใช่ผ่านเอกสาร" },
    });
    const res = await setCampaignArtifactStatus(ART, "approved");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("workflow ใหม่");
    expect(res.error).toContain("หน้าชิ้นงาน");
    expect(res.error).not.toBe(GENERIC_MSG);
    expect(res.error).not.toBe(SILVER_BAR_MSG);
  });

  it("does not leak raw DB text / function names / uuid into the 55000 message", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: "55000", message: `content_piece_advance: step ${ART} piece_status=approved` },
    });
    const res = await setCampaignArtifactStatus(ART, "done");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).not.toContain(ART);
    expect(res.error).not.toContain("content_piece_advance");
    expect(res.error).not.toContain("piece_status");
  });

  it("22023 still wins over the new branch: silver_bar message unchanged (precedence regression)", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "22023", message: "silver_bar steps cannot carry discount_pct" } });
    const res = await setCampaignArtifactStatus(ART, "approved");
    expect(res).toEqual({ ok: false, error: SILVER_BAR_MSG });
  });

  it("55000-looking TEXT without the code does not trigger the new branch (code gate decides)", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "ชิ้นงานนี้อยู่ใน workflow ใหม่" } });
    const res = await setCampaignArtifactStatus(ART, "approved");
    expect(res).toEqual({ ok: false, error: GENERIC_MSG });
  });

  it("other codes (23514 / 42501 / P0001) keep the generic message", async () => {
    for (const code of ["23514", "42501", "P0001", "40P01"]) {
      rpcMock.mockResolvedValue({ data: null, error: { code, message: "x" } });
      const res = await setCampaignArtifactStatus(ART, "todo");
      expect(res, code).toEqual({ ok: false, error: GENERIC_MSG });
    }
  });

  it("success path unchanged: ok + exact RPC name/params (no extra params leaked to the old RPC)", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    const res = await setCampaignArtifactStatus(ART, "draft");
    expect(res.ok).toBe(true);
    expect(schemaMock).toHaveBeenCalledWith("analytics");
    expect(rpcMock).toHaveBeenCalledWith("campaign_set_artifact_status", { p_artifact_id: ART, p_status: "draft" });
  });
});

describe("setCampaignArtifactStatus — gates before the RPC", () => {
  it("staff role is rejected and never reaches the RPC", async () => {
    getEffectiveRoleMock.mockResolvedValue("staff");
    const res = await setCampaignArtifactStatus(ART, "approved");
    expect(res.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("status outside the whitelist and empty id never reach the RPC", async () => {
    const bad = await setCampaignArtifactStatus(ART, "banana" as never);
    expect(bad).toEqual({ ok: false, error: "สถานะไม่ถูกต้อง" });
    const empty = await setCampaignArtifactStatus("", "approved");
    expect(empty.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("a thrown (non-object) error from the client degrades to the generic message, not a crash", async () => {
    rpcMock.mockRejectedValue("network down");
    const res = await setCampaignArtifactStatus(ART, "todo");
    expect(res).toEqual({ ok: false, error: GENERIC_MSG });
  });
});
