// lib/actions/content-shoot.test.ts — สิทธิ์ · นิยามชุดชิ้น (approved+needs_shoot+สัปดาห์) · จบรอบ: ลำดับ/ล้มรายชิ้น/ตรวจอินพุต
import { beforeEach, describe, expect, it, vi } from "vitest";

const SHOP = "a7c850ee-6776-4c3e-ba72-ba9e8caba2b7";
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const getEffectiveRoleMock = vi.fn();
const setPlanMock = vi.fn();
const advanceMock = vi.fn();

interface Op {
  table: string;
  ops: Array<[string, ...unknown[]]>;
}
const calls: Op[] = [];
let result: { data: unknown; error: unknown } = { data: [], error: null };
// ผลของการอ่านหมายเหตุเดิมจาก campaign_step (id, shoot_note)
let noteResult: { data: unknown; error: unknown } = { data: [], error: null };

function builder(table: string) {
  const call: Op = { table, ops: [] };
  calls.push(call);
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "lte", "lt", "gte", "gt", "or", "not", "order", "limit", "is", "range"]) {
    b[m] = (...a: unknown[]) => {
      call.ops.push([m, ...a]);
      return b;
    };
  }
  b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(table === "campaign_step" ? noteResult : result).then(res, rej);
  return b;
}

vi.mock("@/lib/auth/role", () => ({ getEffectiveRole: () => getEffectiveRoleMock() }));
vi.mock("@/lib/dev/context", () => ({ getDevShopId: () => SHOP }));
vi.mock("@/lib/supabase/server", () => ({ getServiceClient: () => ({ schema: () => ({ rpc: vi.fn(), from: (t: string) => builder(t) }) }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/actions/content-pieces", () => ({
  setPlan: (...a: unknown[]) => setPlanMock(...a),
  advancePiece: (...a: unknown[]) => advanceMock(...a),
}));

import { finishShootRound, getShootData } from "./content-shoot";

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  result = { data: [], error: null };
  noteResult = { data: [], error: null };
  getEffectiveRoleMock.mockResolvedValue("owner");
  setPlanMock.mockResolvedValue({ ok: true, data: undefined });
  advanceMock.mockResolvedValue({ ok: true, data: { to: "produced" } });
});

describe("สิทธิ์", () => {
  it("staff/role ไม่รู้จัก → ไม่ query ไม่เขียน", async () => {
    for (const role of ["staff", "viewer", undefined]) {
      getEffectiveRoleMock.mockResolvedValue(role);
      expect((await getShootData()).ok).toBe(false);
      expect((await finishShootRound({ stepIds: [A] })).ok).toBe(false);
    }
    expect(calls).toHaveLength(0);
    expect(setPlanMock).not.toHaveBeenCalled();
    expect(advanceMock).not.toHaveBeenCalled();
  });
});

describe("getShootData", () => {
  it("เฉพาะ approved + needs_shoot ในช่วงสัปดาห์ · shop_id · limit · ไม่มี in_review", async () => {
    const r = await getShootData("2026-10-14");
    expect(r.ok && r.data.weekFrom).toBe("2026-10-12");
    const ops = calls[0].ops;
    expect(calls[0].table).toBe("v_content_piece");
    expect(ops).toContainEqual(["eq", "shop_id", SHOP]);
    expect(ops).toContainEqual(["eq", "piece_status", "approved"]);
    expect(ops).toContainEqual(["eq", "footage_status", "needs_shoot"]);
    expect(ops).toContainEqual(["gte", "resolved_start", "2026-10-12"]);
    expect(ops).toContainEqual(["lte", "resolved_start", "2026-10-18"]);
    expect(ops.some((o) => o[0] === "limit")).toBe(true);
    expect(JSON.stringify(ops)).not.toContain("in_review");
  });

  it("query ล้ม → ข้อความไทย ไม่รั่ว error ดิบ", async () => {
    result = { data: null, error: { code: "57014", message: "timeout at analytics.secret" } };
    const r = await getShootData();
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).not.toContain("secret");
  });
});

describe("finishShootRound", () => {
  it("ลำดับต่อชิ้น: setPlan (ถ้ามี note/ลิงก์) แล้ว advance produced", async () => {
    const order: string[] = [];
    setPlanMock.mockImplementation(async (id: string) => (order.push(`plan:${id}`), { ok: true, data: undefined }));
    advanceMock.mockImplementation(async (id: string) => (order.push(`adv:${id}`), { ok: true, data: { to: "produced" } }));
    const r = await finishShootRound({ stepIds: [A, B], note: " ต่างจากบทที่มือ ", folderUrl: "https://example.test/folder" });
    expect(r.ok && r.data.results.every((x) => x.ok)).toBe(true);
    expect(order).toEqual([`plan:${A}`, `adv:${A}`, `plan:${B}`, `adv:${B}`]);
    // ไม่มีหมายเหตุเดิม → ขึ้นต้นด้วยตัวคั่น "— ถ่ายแล้ว" (ต่อท้าย ไม่ใช่แทนที่)
    expect(setPlanMock).toHaveBeenCalledWith(A, { footage_url: "https://example.test/folder", shoot_note: expect.stringMatching(/^— ถ่ายแล้ว .+: ต่างจากบทที่มือ$/) });
    expect(advanceMock).toHaveBeenCalledWith(A, "produced");
  });

  it("L1: ส่ง url ที่ผ่าน safeHttpUrl (normalize แล้ว) ลง DB ไม่ใช่สตริงดิบ", async () => {
    await finishShootRound({ stepIds: [A], folderUrl: "  HTTPS://Example.TEST/Folder?x=1  " });
    expect(setPlanMock).toHaveBeenCalledWith(A, { footage_url: "https://example.test/Folder?x=1" });
  });

  it("ไม่มี note/ลิงก์ → ไม่เรียก setPlan เลย (ไม่เขียนค่าว่างทับ)", async () => {
    await finishShootRound({ stepIds: [A], note: "   ", folderUrl: "" });
    expect(setPlanMock).not.toHaveBeenCalled();
    expect(advanceMock).toHaveBeenCalledTimes(1);
  });

  it("ชิ้นหนึ่งล้ม ไม่หยุดชิ้นอื่น · ล้มที่ setPlan = ไม่ advance ชิ้นนั้น · รายงานรายชิ้น", async () => {
    setPlanMock.mockImplementation(async (id: string) => (id === A ? { ok: false, error: "บันทึกแผนไม่สำเร็จ" } : { ok: true, data: undefined }));
    const r = await finishShootRound({ stepIds: [A, B], note: "x" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.results).toEqual([
      { stepId: A, ok: false, error: "บันทึกแผนไม่สำเร็จ" },
      { stepId: B, ok: true },
    ]);
    expect(advanceMock).toHaveBeenCalledTimes(1);
    expect(advanceMock).toHaveBeenCalledWith(B, "produced");
  });

  it("DB ปฏิเสธ advance → รายงานข้อความไทยของชิ้นนั้น", async () => {
    advanceMock.mockResolvedValue({ ok: false, error: "เปลี่ยนสถานะไปแล้ว", stale: true });
    const r = await finishShootRound({ stepIds: [A] });
    expect(r.ok && r.data.results[0]).toEqual({ stepId: A, ok: false, error: "เปลี่ยนสถานะไปแล้ว" });
  });

  it("ห้ามผ่าน: ไม่มีชิ้น · id ผิด · ซ้ำถูกรวม · เกินเพดาน · ลิงก์ไม่ใช่ http(s) · note ยาวเกิน → ไม่เขียนอะไร", async () => {
    const bad: Record<string, unknown>[] = [
      { stepIds: [] },
      { stepIds: ["x"] },
      { stepIds: Array.from({ length: 41 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`) },
      { stepIds: [A], folderUrl: "javascript:alert(1)" },
      { stepIds: [A], folderUrl: "ftp://x" },
      { stepIds: [A], note: "ก".repeat(501) },
      null as unknown as Record<string, unknown>,
      { stepIds: "nope" },
    ];
    for (const b of bad) expect((await finishShootRound(b as never)).ok, JSON.stringify(b)?.slice(0, 40)).toBe(false);
    expect(setPlanMock).not.toHaveBeenCalled();
    expect(advanceMock).not.toHaveBeenCalled();
    await finishShootRound({ stepIds: [A, A] });
    expect(advanceMock).toHaveBeenCalledTimes(1);
  });
});

describe("หมายเหตุหลังถ่าย: ต่อท้ายของเดิม ห้ามทับ (มติ Tech Lead)", () => {
  it("มีหมายเหตุเดิม → ส่ง เดิม + ตัวคั่น + ใหม่ ต่อชิ้น (ของแต่ละชิ้นไม่ปนกัน)", async () => {
    noteResult = { data: [{ id: A, shoot_note: "ถ่ายบ่ายหน้าโรงงาน" }, { id: B, shoot_note: null }], error: null };
    await finishShootRound({ stepIds: [A, B], note: "เปลี่ยนมุม" });
    const forA = setPlanMock.mock.calls.find((c) => c[0] === A)![1] as { shoot_note: string };
    const forB = setPlanMock.mock.calls.find((c) => c[0] === B)![1] as { shoot_note: string };
    expect(forA.shoot_note.startsWith("ถ่ายบ่ายหน้าโรงงาน\n— ถ่ายแล้ว")).toBe(true);
    expect(forA.shoot_note.endsWith(": เปลี่ยนมุม")).toBe(true);
    expect(forB.shoot_note.startsWith("— ถ่ายแล้ว")).toBe(true);
  });

  it("หมายเหตุใหม่ว่าง → ไม่ query/ไม่เขียน shoot_note เลย (ของเดิมอยู่ครบ)", async () => {
    noteResult = { data: [{ id: A, shoot_note: "เดิม" }], error: null };
    await finishShootRound({ stepIds: [A], note: "  ", folderUrl: "https://example.test/f" });
    expect(setPlanMock).toHaveBeenCalledWith(A, { footage_url: "https://example.test/f" });
    expect(calls.some((c) => c.table === "campaign_step")).toBe(false);
  });

  it("ของเดิมยาว → ตัดเฉพาะใหม่ + เตือนรายชิ้น · ความยาวรวม ≤ 500 · ของเดิมไม่ถูกตัด", async () => {
    const old = "ก".repeat(300);
    noteResult = { data: [{ id: A, shoot_note: old }], error: null };
    const r = await finishShootRound({ stepIds: [A], note: "ข".repeat(400) });
    const sent = (setPlanMock.mock.calls[0][1] as { shoot_note: string }).shoot_note;
    expect(sent.length).toBeLessThanOrEqual(500);
    expect(sent.startsWith(old)).toBe(true);
    expect(r.ok && r.data.results[0].warning).toMatch(/ตัดให้พอดี/);
  });

  it("ของเดิมเต็มจนต่อไม่ได้ → ไม่เขียนหมายเหตุ แต่ยังเปลี่ยนเป็นผลิตแล้ว + เตือน", async () => {
    noteResult = { data: [{ id: A, shoot_note: "ก".repeat(498) }], error: null };
    const r = await finishShootRound({ stepIds: [A], note: "ใหม่" });
    expect(setPlanMock).not.toHaveBeenCalled();
    expect(advanceMock).toHaveBeenCalledWith(A, "produced");
    expect(r.ok && r.data.results[0]).toMatchObject({ ok: true, warning: expect.stringContaining("ต่อท้ายไม่ได้") });
  });

  it("อ่านหมายเหตุเดิมไม่ได้ → ไม่เขียนแบบเดาทับและไม่เปลี่ยนสถานะชิ้นไหน · ไม่รั่ว error ดิบ", async () => {
    noteResult = { data: null, error: { code: "XX000", message: "analytics.secret" } };
    const r = await finishShootRound({ stepIds: [A], note: "ใหม่" });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).not.toContain("secret");
    expect(setPlanMock).not.toHaveBeenCalled();
    expect(advanceMock).not.toHaveBeenCalled();
  });

  it("query อ่านหมายเหตุกรอง shop_id + in ids + limit", async () => {
    await finishShootRound({ stepIds: [A], note: "ใหม่" });
    const q = calls.find((c) => c.table === "campaign_step")!.ops;
    expect(q).toContainEqual(["eq", "shop_id", SHOP]);
    expect(q).toContainEqual(["in", "id", [A]]);
    expect(q.some((o) => o[0] === "limit")).toBe(true);
  });
});
