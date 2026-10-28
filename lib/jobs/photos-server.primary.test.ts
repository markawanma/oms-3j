// QA (W2 · 21 ต.ค. 69) — primaryPhotoMdUrl (หน้าพิมพ์ A5): รูปหลักที่มาจากหน้างาน (source = shopfloor) ต้องขึ้นใบพิมพ์ได้เหมือนรูปออฟฟิศ
// เหตุ: 0189 ทำให้ผู้จัดการแนบรูปหน้างานเป็นรูปหลักของใบได้ — query ของใบพิมพ์ห้ามมีตัวกรอง source (ไม่งั้นรูปหน้างานตกหายเงียบๆ ที่กระดาษ)
// ต้องไม่พัง: ไม่มีรูป/อ่านล้ม/เซ็นล้ม = null (พิมพ์ต่อแบบเดิม) · ไม่ throw · ไม่ log path
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toPrintableJob } from "./print";
import type { JobDetail, StageRow } from "./types";

const SHOP = "a7c850ee-6776-4c3e-ba72-ba9e8caba2b7";
const JOB = "11111111-1111-4111-8111-111111111111";
const PH = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MD = `${SHOP}/${JOB}/${PH}_md.jpg`;

interface Op { table: string; ops: Array<[string, ...unknown[]]> }
const calls: Op[] = [];
let result: { data: unknown; error: unknown } | (() => never) = { data: [], error: null };
function builder(table: string) {
  const call: Op = { table, ops: [] };
  calls.push(call);
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "in", "order", "limit"]) b[m] = (...a: unknown[]) => (call.ops.push([m, ...a]), b);
  const res = () => (typeof result === "function" ? result() : result);
  b.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
    try {
      return Promise.resolve(res()).then(ok, bad);
    } catch (e) {
      return Promise.reject(e).then(ok, bad);
    }
  };
  return b;
}
vi.mock("@/lib/jobs/office-server", () => ({
  db: () => ({ from: (t: string) => builder(t) }),
  shopId: () => SHOP,
  callOffice: vi.fn(),
  fail: vi.fn(),
}));
const signMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({ storage: { from: (bucket: string) => ({ createSignedUrls: (...a: unknown[]) => signMock(bucket, ...a) }) } }),
}));

import { primaryPhotoMdUrl } from "./photos-server";

const SIGNED = `https://abc.supabase.co/storage/v1/object/sign/job-photos/${MD}?token=t`;
let errSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  calls.length = 0;
  result = { data: [{ storage_path: MD }], error: null };
  signMock.mockReset();
  signMock.mockImplementation(async (_b: string, paths: string[]) => ({ data: paths.map((p) => ({ path: p, signedUrl: SIGNED, error: null })), error: null }));
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

const job = { id: JOB, jobNo: "JB-0007", sourceKind: "oem", designLabel: "แหวนลาย A", sku: "RG-001", metal: "silver", qtyPlanned: 12, qtyOrder: 12 } as unknown as JobDetail;

describe("primaryPhotoMdUrl — รูปหลักจากหน้างานขึ้นใบพิมพ์ A5", () => {
  it("query: ตาราง job_photo · กรอง shop+job+reference+is_primary+ไม่ถูกลบ · limit 1 · ❌ ไม่กรอง source (รูป shopfloor ต้องผ่าน)", async () => {
    const url = await primaryPhotoMdUrl(JOB);
    expect(url).toBe(SIGNED);
    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe("job_photo");
    const ops = calls[0].ops;
    expect(ops).toContainEqual(["eq", "shop_id", SHOP]);
    expect(ops).toContainEqual(["eq", "job_id", JOB]);
    expect(ops).toContainEqual(["eq", "kind", "reference"]);
    expect(ops).toContainEqual(["eq", "is_primary", true]);
    expect(ops).toContainEqual(["is", "deleted_at", null]);
    expect(ops).toContainEqual(["limit", 1]);
    expect(ops.filter((o) => o[0] === "eq" && o[1] === "source")).toEqual([]);
    expect(ops.filter((o) => typeof o[1] === "string" && /source|worker|uploaded_by/.test(o[1] as string))).toEqual([]);
  });

  it("เซ็น path ที่ DB ให้มาเท่านั้น (md) · bucket job-photos · URL ผ่านด่านรูปร่างของ toPrintableJob → ขึ้นใบพิมพ์", async () => {
    const url = await primaryPhotoMdUrl(JOB);
    expect(signMock).toHaveBeenCalledTimes(1);
    expect(signMock.mock.calls[0][0]).toBe("job-photos");
    expect(signMock.mock.calls[0][1]).toEqual([MD]);
    const printable = toPrintableJob(job, [] as StageRow[], url);
    expect(printable.primaryPhotoUrl).toBe(SIGNED);
  });

  it("ต้องไม่พัง: ไม่มีรูปหลัก → null · พิมพ์ใบแบบเดิม (primaryPhotoUrl null)", async () => {
    result = { data: [], error: null };
    const url = await primaryPhotoMdUrl(JOB);
    expect(url).toBeNull();
    expect(signMock).not.toHaveBeenCalled();
    expect(toPrintableJob(job, [] as StageRow[], url).primaryPhotoUrl).toBeNull();
  });

  it("ผลผิดรูป (data ไม่ใช่ array / storage_path ไม่ใช่ string / ว่าง) → null ไม่ throw", async () => {
    for (const data of [null, {}, "x", [null], [{}], [{ storage_path: 123 }], [{ storage_path: null }]]) {
      result = { data, error: null };
      await expect(primaryPhotoMdUrl(JOB)).resolves.toBeNull();
    }
  });

  it("อ่านล้ม (error / throw) → null · log ไม่มี path/uuid ร้าน-ใบ", async () => {
    result = { data: null, error: { code: "57014", message: `timeout ${MD}`, details: SHOP } };
    await expect(primaryPhotoMdUrl(JOB)).resolves.toBeNull();
    result = () => {
      throw Object.assign(new Error(`boom ${MD}`), { code: "XX000" });
    };
    await expect(primaryPhotoMdUrl(JOB)).resolves.toBeNull();
    const logged = JSON.stringify(errSpy.mock.calls);
    expect(logged).not.toContain(MD);
    expect(logged).not.toContain(SHOP);
    expect(logged).not.toContain(JOB);
  });

  it("เซ็น URL ล้ม → null (พิมพ์ต่อโดยไม่มีรูป ไม่ล้มทั้งหน้า) · ไม่ log path", async () => {
    signMock.mockResolvedValueOnce({ data: null, error: { message: `nope ${MD}` } });
    await expect(primaryPhotoMdUrl(JOB)).resolves.toBeNull();
    signMock.mockRejectedValueOnce(new Error(`net ${MD}`));
    await expect(primaryPhotoMdUrl(JOB)).resolves.toBeNull();
    expect(JSON.stringify(errSpy.mock.calls)).not.toContain(MD);
  });
});
