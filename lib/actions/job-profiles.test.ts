// lib/actions/job-profiles.ts (0176) — สิทธิ์ · actor/shop ฝั่ง server · ตรวจ input ก่อนถึง DB · ชื่อ arg ถูก · ส่ง profile ตอนสร้างใบ
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SHOP = "a7c850ee-6776-4c3e-ba72-ba9e8caba2b7";
const USER = "99999999-9999-4999-8999-999999999999";
const JOB = "11111111-1111-4111-8111-111111111111";
const PID = "44444444-4444-4444-8444-444444444444";
const ITEM = "22222222-2222-4222-8222-222222222222";

const roleMock = vi.fn();
const rpcMock = vi.fn();
vi.mock("@/lib/auth/role", () => ({ getEffectiveRole: () => roleMock() }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => ({ id: USER, email: "o@example.test" }), requireSessionIfGateOn: async () => undefined }));
vi.mock("@/lib/dev/context", () => ({ getDevShopId: () => SHOP }));
vi.mock("@/lib/supabase/server", () => ({ getServiceClient: () => ({ schema: () => ({ rpc: rpcMock, from: () => ({}) }) }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { changeJobProfile, listProfiles, saveProfile, setDefaultProfile, setProfileActive } from "./job-profiles";
import { createJob, suggestJob } from "./job-office";

const lastRpc = () => rpcMock.mock.calls.at(-1) as [string, Record<string, unknown>];
const profileRow = { id: PID, name: "แบบ 1", note: null, require_final_weight: false, is_active: true, seq: 10, is_default: false, is_default_gold: false, stages: [], jobs_open: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  roleMock.mockResolvedValue("owner");
  rpcMock.mockResolvedValue({ data: profileRow, error: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("สิทธิ์ — ทุก action ปฏิเสธก่อนแตะ DB", () => {
  it.each(["staff", undefined, "viewer"])("role %s", async (role) => {
    roleMock.mockResolvedValue(role);
    for (const r of [await listProfiles(), await saveProfile({ name: "x", requireFinalWeight: false, stages: [] }), await setProfileActive(PID, false), await setDefaultProfile(PID, "general"), await changeJobProfile(JOB, PID)]) {
      expect(r.ok).toBe(false);
    }
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("listProfiles", () => {
  it("เรียก job_record_profile_list ด้วย shop จาก server (ไม่มี p_actor) · map ผล", async () => {
    rpcMock.mockResolvedValue({ data: { profiles: [profileRow], default_profile_id: PID, default_gold_profile_id: null, stage_defs: [{ code: "cast", name_th: "หล่อ", seq_default: 1, metal_present: true, is_active: true }] }, error: null });
    const r = await listProfiles();
    expect(lastRpc()[0]).toBe("job_record_profile_list");
    expect(lastRpc()[1]).toEqual({ p_shop_id: SHOP });
    expect(r.ok && r.data.defaultProfileId).toBe(PID);
    expect(r.ok && r.data.stageDefs[0]).toMatchObject({ code: "cast", metalPresent: true });
  });
  it("DB ล้ม = ข้อความไทย ไม่ throw", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "XX000", message: "boom select * from analytics.x" } });
    const r = await listProfiles();
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/[฀-๿]/) });
    expect(!r.ok && r.error).not.toMatch(/analytics|select/i);
  });
});

describe("saveProfile", () => {
  const ok = { name: " แบบ ทดสอบ ", requireFinalWeight: true, stages: [{ stageCode: "cast", weigh: true, scrapQty: true, scrapWeight: false }, { stageCode: "qc", weigh: false, scrapQty: false, scrapWeight: false }] };
  it("สร้างใหม่: ส่งเฉพาะขั้นที่ติ๊กอย่างน้อย 1 ช่อง · ชื่อ trim · actor/shop จาก server · ไม่ส่ง p_id/p_note ถ้าว่าง", async () => {
    const r = await saveProfile(ok);
    expect(r.ok).toBe(true);
    expect(lastRpc()[0]).toBe("job_record_profile_upsert");
    expect(lastRpc()[1]).toEqual({ p_name: "แบบ ทดสอบ", p_stages: [{ stage_code: "cast", weigh: true, scrap_qty: true, scrap_weight: false }], p_require_final_weight: true, p_shop_id: SHOP, p_actor: USER });
  });
  it("แก้: ส่ง p_id + p_note เป็นสตริง ('' = ล้างคำอธิบาย) · ไม่ติ๊กเลยได้ (แบบไม่ชั่ง = p_stages ว่าง)", async () => {
    await saveProfile({ id: PID, name: "ไม่ชั่ง", requireFinalWeight: false, stages: [] });
    expect(lastRpc()[1]).toMatchObject({ p_id: PID, p_note: "", p_stages: [], p_require_final_weight: false });
    await saveProfile({ id: PID, name: "ไม่ชั่ง", note: "  อธิบาย  ", requireFinalWeight: false, stages: [] });
    expect(lastRpc()[1]).toMatchObject({ p_note: "อธิบาย" });
  });
  it("client ทับ p_actor/p_shop_id ไม่ได้", async () => {
    await saveProfile({ ...ok, ...({ p_actor: "x", p_shop_id: "y" } as object) });
    expect(lastRpc()[1]).toMatchObject({ p_shop_id: SHOP, p_actor: USER });
  });
  it.each([
    ["ชื่อว่าง", { name: "   " }],
    ["ชื่อยาวเกิน 60", { name: "ก".repeat(61) }],
    ["ชื่อมี <", { name: "แบบ<b>" }],
    ["id ไม่ใช่ uuid", { id: "nope" }],
    ["requireFinalWeight ไม่ใช่ boolean", { requireFinalWeight: "true" }],
    ["flag เป็นข้อความ", { stages: [{ stageCode: "cast", weigh: "true", scrapQty: false, scrapWeight: false }] }],
    ["flag เป็น 1", { stages: [{ stageCode: "cast", weigh: 1, scrapQty: false, scrapWeight: false }] }],
    ["รหัสขั้นผิดรูปแบบ", { stages: [{ stageCode: "Cast;drop", weigh: true, scrapQty: false, scrapWeight: false }] }],
    ["ขั้นซ้ำ", { stages: [{ stageCode: "cast", weigh: true, scrapQty: false, scrapWeight: false }, { stageCode: "cast", weigh: false, scrapQty: true, scrapWeight: false }] }],
    ["stages ไม่ใช่ array", { stages: "cast" }],
    ["คำอธิบายยาวเกิน 200", { note: "ก".repeat(201) }],
  ])("ปฏิเสธก่อนถึง DB: %s", async (_n, bad) => {
    const r = await saveProfile({ ...ok, ...bad } as never);
    expect(r.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
  it("name_dup จาก DB = ข้อความไทยของ DB (มีแบบชื่อ ... อยู่แล้ว)", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "22023", hint: "name_dup", message: 'มีแบบชื่อ "แบบ 1" อยู่แล้ว' } });
    const r = await saveProfile(ok);
    expect(r).toEqual({ ok: false, error: 'มีแบบชื่อ "แบบ 1" อยู่แล้ว', code: "name_dup" });
  });
});

describe("setProfileActive / setDefaultProfile / changeJobProfile", () => {
  it("setProfileActive: ส่ง p_id + p_is_active เท่านั้น (ไม่แตะชื่อ/ขั้น)", async () => {
    await setProfileActive(PID, false);
    expect(lastRpc()[1]).toEqual({ p_id: PID, p_is_active: false, p_shop_id: SHOP, p_actor: USER });
    expect((await setProfileActive("nope", true)).ok).toBe(false);
    expect((await setProfileActive(PID, "no" as never)).ok).toBe(false);
  });
  it("ปิดแบบที่เป็นค่าเริ่ม: DB ปฏิเสธ → ข้อความไทยของ DB", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "22023", hint: "default_cannot_close", message: "ปิดแบบที่เป็นค่าเริ่มไม่ได้ — ตั้งแบบอื่นเป็นค่าเริ่มก่อน" } });
    expect(await setProfileActive(PID, false)).toEqual({ ok: false, error: "ปิดแบบที่เป็นค่าเริ่มไม่ได้ — ตั้งแบบอื่นเป็นค่าเริ่มก่อน", code: "default_cannot_close" });
  });
  it("setDefaultProfile: general/gold ส่ง scope ถูก · gold + null = ล้าง · general + null ปฏิเสธก่อนถึง DB · scope แปลกปฏิเสธ", async () => {
    rpcMock.mockResolvedValue({ data: { ok: true, default_profile_id: PID, default_gold_profile_id: null }, error: null });
    const r = await setDefaultProfile(PID, "general");
    expect(lastRpc()).toEqual(["job_record_profile_set_default", { p_id: PID, p_scope: "general", p_shop_id: SHOP, p_actor: USER }]);
    expect(r.ok && r.data).toEqual({ defaultProfileId: PID, defaultGoldProfileId: null });
    await setDefaultProfile(null, "gold");
    expect(lastRpc()[1]).toMatchObject({ p_id: null, p_scope: "gold" });
    rpcMock.mockClear();
    expect((await setDefaultProfile(null, "general")).ok).toBe(false);
    expect((await setDefaultProfile(PID, "all" as never)).ok).toBe(false);
    expect((await setDefaultProfile("nope", "gold")).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
  it("changeJobProfile: ส่ง job_profile_set · started จาก DB = ข้อความไทย", async () => {
    rpcMock.mockResolvedValue({ data: { ok: true, job_no: "JB-1", profile_id: PID, profile_name: "แบบ 1" }, error: null });
    const r = await changeJobProfile(JOB, PID);
    expect(lastRpc()).toEqual(["job_profile_set", { p_job_id: JOB, p_profile_id: PID, p_shop_id: SHOP, p_actor: USER }]);
    expect(r.ok && r.data).toEqual({ profileId: PID, profileName: "แบบ 1" });
    expect((await changeJobProfile("nope", PID)).ok).toBe(false);
    expect((await changeJobProfile(JOB, "nope")).ok).toBe(false);
    rpcMock.mockResolvedValue({ data: null, error: { code: "22023", hint: "started", message: "เปลี่ยนแบบการบันทึกได้เฉพาะก่อนช่างรับงานขั้นแรก" } });
    expect(await changeJobProfile(JOB, PID)).toEqual({ ok: false, error: "เปลี่ยนแบบการบันทึกได้เฉพาะก่อนช่างรับงานขั้นแรก", code: "started" });
  });
  it("code (hint) ผ่านมาเฉพาะรูปร่างปลอดภัย: hint แปลก/ข้อความดิบ = ไม่มี code · DB ล้มไม่มี hint = ไม่มี code", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "22023", hint: "ข้อความไทย <x>; drop", message: "ปิดแบบไม่ได้" } });
    expect(await setProfileActive(PID, false)).not.toHaveProperty("code");
    rpcMock.mockResolvedValue({ data: null, error: { code: "XX000", message: "boom" } });
    expect(await setProfileActive(PID, false)).toEqual({ ok: false, error: expect.any(String) });
    expect(await setProfileActive(PID, false)).not.toHaveProperty("code");
  });
});

describe("createJob / suggestJob (0176)", () => {
  const base = { kind: "oem" as const, itemId: ITEM, stageCodes: ["cast", "qc", "pack"], designLabel: "แหวน" };
  it("createJob ไม่ส่ง profileId = ไม่ใส่ p_profile_id (DB ใช้ค่าเริ่มตามโลหะ) · ส่งแล้วใส่ · ไม่ใช่ uuid ปฏิเสธก่อนถึง DB", async () => {
    rpcMock.mockResolvedValue({ data: { job_id: JOB, job_no: "JB-9" }, error: null });
    await createJob(base);
    expect(lastRpc()[1]).not.toHaveProperty("p_profile_id");
    await createJob({ ...base, profileId: PID });
    expect(lastRpc()[1]).toMatchObject({ p_profile_id: PID });
    rpcMock.mockClear();
    expect((await createJob({ ...base, profileId: "nope" })).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
  it("suggestJob: map profiles + metal_present · default ที่ไม่อยู่ในรายการ active = null (ไม่เดา)", async () => {
    const d = { metal: "gold", qty: 5, design_label: "ก", deposit_missing: false, existing_job: null, stages: [{ code: "cast", name_th: "หล่อ", default_selected: true, metal_present: true }, { code: "qc", name_th: "QC", default_selected: true }], profiles: [profileRow], default_profile_id: PID };
    rpcMock.mockResolvedValue({ data: d, error: null });
    const r = await suggestJob("oem", ITEM);
    expect(r.ok && r.data.stages.map((s) => s.metalPresent)).toEqual([true, false]);
    expect(r.ok && r.data.profiles.map((p) => p.id)).toEqual([PID]);
    expect(r.ok && r.data.defaultProfileId).toBe(PID);
    rpcMock.mockResolvedValue({ data: { ...d, default_profile_id: "55555555-5555-4555-8555-555555555555" }, error: null });
    const r2 = await suggestJob("oem", ITEM);
    expect(r2.ok && r2.data.defaultProfileId).toBeNull();
    rpcMock.mockResolvedValue({ data: { ...d, profiles: undefined, default_profile_id: null }, error: null });
    const r3 = await suggestJob("oem", ITEM);
    expect(r3.ok && r3.data.profiles).toEqual([]);
  });
});
