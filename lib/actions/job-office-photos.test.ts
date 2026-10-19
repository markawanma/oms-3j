// lib/actions/job-office.ts × รูปใบงาน (0182): createJob copy รูป SKU เข้าใบโดย "ไม่บล็อก" การสร้างใบ · getJobDetail ส่ง photos (อ่านรูปไม่ได้ ≠ ไม่มีรูป · ไม่ล้มทั้งหน้า)
// ต้องไม่พัง: SKU ไม่มีรูป/ไม่ผูก SKU/copy ล้ม/copy throw → ใบเกิดปกติ · ผลของ createJob เหมือนเดิมเป๊ะ (ไม่มี field ใหม่)
import { beforeEach, describe, expect, it, vi } from "vitest";

const SHOP = "a7c850ee-6776-4c3e-ba72-ba9e8caba2b7";
const USER = "99999999-9999-4999-8999-999999999999";
const JOB = "11111111-1111-4111-8111-111111111111";
const ITEM = "22222222-2222-4222-8222-222222222222";
const PH = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const roleMock = vi.fn();
const sessionUserMock = vi.fn();
const requireSessionMock = vi.fn();
const rpcMock = vi.fn();
const copyMock = vi.fn();
const loadPhotosMock = vi.fn();

const results: Record<string, { data: unknown; error: unknown; count?: number }> = {};
function builder(table: string) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "neq", "in", "is", "order", "limit"]) b[m] = () => b;
  const res = () => results[table] ?? { data: [], error: null, count: 0 };
  b.maybeSingle = () => Promise.resolve(res());
  b.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(res()).then(ok, bad);
  return b;
}
vi.mock("@/lib/auth/role", () => ({ getEffectiveRole: () => roleMock() }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: () => sessionUserMock(), requireSessionIfGateOn: () => requireSessionMock() }));
vi.mock("@/lib/dev/context", () => ({ getDevShopId: () => SHOP }));
vi.mock("@/lib/supabase/server", () => ({ getServiceClient: () => ({ schema: () => ({ rpc: rpcMock, from: (t: string) => builder(t) }) }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/jobs/photos-server", () => ({
  copyCatalogPhotoToJob: (...a: unknown[]) => copyMock(...a),
  loadJobPhotos: (...a: unknown[]) => loadPhotosMock(...a),
}));

import { createJob, getJobDetail } from "./job-office";

let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(results)) delete results[k];
  roleMock.mockResolvedValue("owner");
  sessionUserMock.mockResolvedValue({ id: USER, email: "o@example.test" });
  requireSessionMock.mockResolvedValue(undefined);
  rpcMock.mockResolvedValue({ data: { job_id: JOB, job_no: "JB-0009" }, error: null });
  copyMock.mockResolvedValue({ ok: false, reason: "no_product", error: "x" });
  loadPhotosMock.mockResolvedValue([]);
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

const input = { kind: "oem" as const, itemId: ITEM, stageCodes: ["cast", "qc", "pack"] };

describe("createJob — copy รูป SKU ไม่บล็อกการสร้างใบ", () => {
  it("สร้างสำเร็จ → เรียก copy ด้วย id ใบที่ DB คืน (ไม่ใช่ค่าจาก client) · ผลเหมือนเดิมเป๊ะ (ไม่มี field ใหม่)", async () => {
    const r = await createJob(input);
    expect(r).toEqual({ ok: true, data: { jobId: JOB, jobNo: "JB-0009", planMissing: [] } });
    expect(copyMock).toHaveBeenCalledTimes(1);
    expect(copyMock).toHaveBeenCalledWith(JOB);
  });

  it("SKU ไม่มีรูป / ไม่ผูก SKU / copy ตอบล้ม → ใบเกิดปกติ (ok · ผลเดิม) · ไม่ log เป็น error", async () => {
    for (const res of [{ ok: false, reason: "no_catalog_image", error: "x" }, { ok: false, reason: "failed", error: "y", code: "photo_cap_ref" }, { ok: true, photoId: PH, isPrimary: true, mdPath: "a", smPath: "b" }]) {
      copyMock.mockResolvedValueOnce(res);
      expect(await createJob(input)).toEqual({ ok: true, data: { jobId: JOB, jobNo: "JB-0009", planMissing: [] } });
    }
    expect(errSpy).not.toHaveBeenCalled();
  });

  it("copy throw (ไม่ควรเกิด) → ใบยังเกิดปกติ · log เฉพาะ label+code ไม่มีข้อความ error/path", async () => {
    copyMock.mockRejectedValueOnce(Object.assign(new Error("ENOTFOUND udqmamplbymxnknkjnkz.supabase.co a7c850ee/x_md.jpg"), { code: "ETIMEDOUT" }));
    expect(await createJob(input)).toEqual({ ok: true, data: { jobId: JOB, jobNo: "JB-0009", planMissing: [] } });
    const logged = JSON.stringify(errSpy.mock.calls);
    expect(logged).toContain("createJob.photo");
    for (const leak of ["udqmamp", "ENOTFOUND", "_md.jpg", SHOP]) expect(logged, leak).not.toContain(leak);
  });

  it("สร้างใบไม่สำเร็จ (DB ปฏิเสธ) → ไม่ copy รูปเลย · input ผิดก่อนถึง DB → ไม่ copy", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { code: "22023", hint: "job_exists", message: "x" } });
    expect((await createJob(input)).ok).toBe(false);
    expect((await createJob({ ...input, kind: "evil" } as never)).ok).toBe(false);
    expect(copyMock).not.toHaveBeenCalled();
  });

  it("ไม่มีสิทธิ์ (staff) → ไม่สร้าง ไม่ copy", async () => {
    roleMock.mockResolvedValue("staff");
    expect((await createJob(input)).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
    expect(copyMock).not.toHaveBeenCalled();
  });
});

describe("getJobDetail — photos", () => {
  const jobRow = { id: JOB, job_no: "JB-0001", metal: "silver", qty_planned: 3, status: "open", design_label: "แหวน", source_kind: "production", production_order_item_id: ITEM };
  const photo = { id: PH, smUrl: "https://x/s", mdUrl: "https://x/m", isPrimary: true, sortOrder: 0, caption: null, source: "office", createdAt: null };

  it("ส่ง photos จาก loadJobPhotos (ใบแม่) · ใบไม่มีรูป = [] (การ์ดว่าง)", async () => {
    results.job = { data: jobRow, error: null };
    loadPhotosMock.mockResolvedValueOnce([photo]);
    let r = await getJobDetail(JOB);
    expect(r.ok && r.data?.photos).toEqual([photo]);
    expect(loadPhotosMock).toHaveBeenCalledWith(JOB);
    r = await getJobDetail(JOB);
    expect(r.ok && r.data?.photos).toEqual([]);
  });

  it("อ่านรูปไม่ได้ → photos = undefined (ไม่ใช่ [] — UI ต้องแสดงสถานะผิดพลาด ไม่ใช่ 'ไม่มีรูป') · หน้าใบงานทั้งหน้ายังเปิดได้ · log เฉพาะ code", async () => {
    results.job = { data: jobRow, error: null };
    loadPhotosMock.mockRejectedValueOnce(Object.assign(new Error("relation analytics.secret exploded"), { code: "XX000" }));
    const r = await getJobDetail(JOB);
    expect(r.ok && r.data?.job.jobNo).toBe("JB-0001");
    expect(r.ok && r.data?.photos).toBeUndefined();
    expect(JSON.stringify(errSpy.mock.calls)).not.toContain("secret");
  });

  it("ไม่พบใบ/id ผิดรูป → ไม่อ่านรูป", async () => {
    results.job = { data: null, error: null };
    expect(await getJobDetail(JOB)).toEqual({ ok: true, data: null });
    expect(await getJobDetail("bad")).toEqual({ ok: true, data: null });
    expect(loadPhotosMock).not.toHaveBeenCalled();
  });

  it("ไม่มีสิทธิ์ → ไม่อ่านรูป", async () => {
    roleMock.mockResolvedValue("staff");
    expect((await getJobDetail(JOB)).ok).toBe(false);
    expect(loadPhotosMock).not.toHaveBeenCalled();
  });
});
