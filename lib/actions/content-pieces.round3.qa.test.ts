// QA (R2-D2) รอบ 3 — ข้อ 2: แก้เนื้อหา/ติ๊กช็อตหลังอีกแท็บเปลี่ยนสถานะ → ข้อความไทยของ describeRpcError (ไม่ใช่ข้อความ "อยู่ใน workflow ใหม่" ของ mapCalendarRpcError)
// ใช้ข้อความ raise จริงของ trigger ใน 0159 (บรรทัด ~771 และ ~779) — สร้างชิ้นที่ "อนุมัติแล้ว" ทดสอบกับ DB จริงไม่ได้ (ย้อน/ลบไม่ได้)
import { beforeEach, describe, expect, it, vi } from "vitest";

const SHOP = "a7c850ee-6776-4c3e-ba72-ba9e8caba2b7";
const STEP = "11111111-1111-4111-8111-111111111111";
const ART = "55555555-5555-4555-8555-555555555555";
const rpcMock = vi.fn();
const tableResults: Record<string, { data: unknown; error: unknown }> = {};

function builder(table: string) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "neq", "not", "in", "limit", "is"]) b[m] = () => b;
  b.maybeSingle = () => Promise.resolve(tableResults[table] ?? { data: null, error: null });
  return b;
}
vi.mock("@/lib/auth/role", () => ({ getEffectiveRole: async () => "owner" }));
vi.mock("@/lib/dev/context", () => ({ getDevShopId: () => SHOP }));
vi.mock("@/lib/supabase/server", () => ({ getServiceClient: () => ({ schema: () => ({ rpc: rpcMock, from: (t: string) => builder(t) }) }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/marketing/tiktok-link", () => ({ canonicalizeTikTokLink: async (u: string) => ({ ok: true, url: u }), parseCanonicalTikTokPostUrl: () => ({}) }));
vi.mock("@/lib/actions/content", () => ({ getContentTypes: async () => ({ ok: true, data: [] }) }));

import { savePieceBody, toggleShot } from "./content-pieces";

beforeEach(() => {
  vi.clearAllMocks();
  tableResults.v_content_piece = { data: { artifact_id: ART }, error: null };
});

const APPROVED_MSG = "อนุมัติแล้ว ห้ามแก้เนื้อหา — ส่งกลับ (in_review) ก่อน";
const STATUS_MSG = "ชิ้นงานนี้อยู่ใน workflow ใหม่ — เปลี่ยนสถานะผ่านหน้าชิ้นงาน (content_piece_advance) ไม่ใช่ผ่านเอกสาร";

describe("savePieceBody หลังอีกแท็บอนุมัติ (ข้อความ trigger จริง)", () => {
  it("ข้อความเป็นไทยที่บอกให้ส่งกลับก่อน ไม่ใช่ 'อยู่ใน workflow ใหม่' และไม่รั่ว enum/ชื่อฟังก์ชัน", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "55000", message: APPROVED_MSG } });
    const r = await savePieceBody(STEP, ART, "แก้");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("อนุมัติแล้วแก้เนื้อหาไม่ได้ — ส่งกลับก่อน");
    expect(r.error).not.toMatch(/workflow|in_review|content_piece/);
  });

  // BUG-QA-3 (Low-Med): ข้อความนี้ไม่ตั้ง stale:true → PieceEditCard ไม่เรียก router.refresh() (ดู `if (res.stale) router.refresh()` ใน saveBody)
  // → หน้ายังโชว์โหมดแก้ของชิ้นที่อนุมัติไปแล้วในอีกแท็บ จนกว่าผู้ใช้จะโหลดเอง · ผลคือกดบันทึกซ้ำได้ข้อความเดิมวนๆ
  it.fails("BUG-QA-3: อนุมัติแล้วแก้ไม่ได้ ต้องตั้ง stale เพื่อให้หน้ารีเฟรช", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "55000", message: APPROVED_MSG } });
    const r = await savePieceBody(STEP, ART, "แก้");
    expect(r.ok === false && r.stale === true).toBe(true);
  });

  it("artifact ไม่ใช่ของชิ้นนี้ (แถวเปลี่ยน) → stale:true + ข้อความไทย", async () => {
    tableResults.v_content_piece = { data: { artifact_id: "99999999-9999-4999-8999-999999999999" }, error: null };
    const r = await savePieceBody(STEP, ART, "แก้");
    expect(r).toEqual({ ok: false, error: "เนื้อหานี้ไม่ใช่ของชิ้นงานนี้ — รีเฟรชหน้าแล้วลองใหม่", stale: true });
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("toggleShot / savePieceBody ได้ข้อความ trigger เปลี่ยนสถานะ", () => {
  it("ไม่รั่วชื่อฟังก์ชัน และเป็นไทย", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "55000", message: STATUS_MSG } });
    for (const r of [await toggleShot(STEP, ART, "s1", true), await savePieceBody(STEP, ART, "x")]) {
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error).not.toMatch(/content_piece|_/);
        expect(r.error).toMatch(/[฀-๿]/);
      }
    }
  });
  it("RPC เดิมของบอร์ดถูกเรียกด้วยพารามิเตอร์ของมันเท่านั้น (ไม่มี p_shop_id/p_actor_role ที่ signature ไม่มี)", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    await savePieceBody(STEP, ART, "ก");
    await toggleShot(STEP, ART, "s1", true);
    expect(rpcMock.mock.calls[0]).toEqual(["campaign_set_artifact_content", { p_artifact_id: ART, p_content_body: "ก", p_clip_brief: null }]);
    expect(rpcMock.mock.calls[1]).toEqual(["campaign_toggle_clip_shot", { p_artifact_id: ART, p_shot_id: "s1", p_done: true }]);
  });
});
