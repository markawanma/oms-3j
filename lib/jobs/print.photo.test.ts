// ใบพิมพ์ A5 + รูปหลัก (0182 · design §3.3): PrintableJob/PrintableSublot มี field รูป "เดียว" primaryPhotoUrl · ผ่านด่านรูปร่าง signed URL · ไม่ส่งรายการรูป/caption/ที่มา/ผู้อัปโหลดขึ้นกระดาษ
// ใบไม่มีรูป = ผลเดิมเป๊ะ (นอกจาก key ใหม่ = null)
import { describe, expect, it } from "vitest";
import { toPrintableJob, toPrintableSublot } from "./print";
import { findForbiddenKeys } from "./worker-view";
import type { JobDetail, StageRow } from "./types";
import type { LotPart } from "./lots";

const URL_OK = "https://abc.supabase.co/storage/v1/object/sign/job-photos/a7c850ee-6776-4c3e-ba72-ba9e8caba2b7/11111111-1111-4111-8111-111111111111/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa_md.jpg?token=tok";

// ฟิลด์ที่ toPrintableJob/toPrintableSublot อ่านจริง + ของลับที่ต้องไม่หลุด (ดูเทสต์ boundary เดิมใน print.test.ts)
const job = (o: Record<string, unknown> = {}) =>
  ({
    id: "11111111-1111-4111-8111-111111111111", jobNo: "JB-0007", sourceKind: "oem", designLabel: "แหวนลาย A", sku: "RG-001", metal: "silver", qtyPlanned: 12, qtyOrder: 12, weightStartG: 120.5,
    dueDate: "2026-10-30", startGateNote: "ลูกค้าประจำ ไม่ต้องรอมัดจำ", note: "หมายเหตุภายใน: ลูกค้า บริษัท ลับ จำกัด สั่ง", oemQuoteItemId: "i-secret", targetPieceG: null, metalPlanG: null, profileName: null, ...o,
  }) as unknown as JobDetail;
const stages = [] as StageRow[];
const part = { jobId: "22222222-2222-4222-8222-222222222222", lotSeq: 2, status: "in_progress", qtyPlanned: 40, qtyLive: 40, passedStages: ["หล่อ"], stageName: "ขัด" } as unknown as LotPart;

describe("PrintableJob.primaryPhotoUrl", () => {
  it("ไม่ส่งรูป = null (ค่าเริ่ม) — ใบไม่มีรูป = markup เดิม · ส่ง null ชัดเจน = null", () => {
    expect(toPrintableJob(job(), stages).primaryPhotoUrl).toBeNull();
    expect(toPrintableJob(job(), stages, null).primaryPhotoUrl).toBeNull();
  });

  it("signed URL ของ job-photos ผ่าน · ใบเดิมเทียบกับใบมีรูป: ต่างกันที่ key เดียว (primaryPhotoUrl)", () => {
    const without = toPrintableJob(job(), stages);
    const withPhoto = toPrintableJob(job(), stages, URL_OK);
    expect(withPhoto.primaryPhotoUrl).toBe(URL_OK);
    expect({ ...withPhoto, primaryPhotoUrl: null }).toEqual(without);
  });

  it("🔴 ค่าที่ไม่ใช่ signed URL ของ job-photos ถูกทิ้งเป็น null (path ดิบ · http · bucket แคตตาล็อก · URL ภายนอก · javascript: · data:)", () => {
    for (const bad of ["aaa/bbb/ccc_md.jpg", "http://abc.supabase.co/storage/v1/object/sign/job-photos/x?token=t", "https://abc.supabase.co/storage/v1/object/sign/product-images/x?token=t",
      "https://evil.example/photo.jpg", "javascript:alert(1)", "data:image/jpeg;base64,AAAA", "", "   "]) {
      expect(toPrintableJob(job(), stages, bad).primaryPhotoUrl, bad).toBeNull();
    }
  });

  it("field รูปเดียวเท่านั้นขึ้นใบพิมพ์: ไม่มีรายการรูป/caption/ที่มา/ผู้อัปโหลด/จำนวนรูป · ไม่มี key ต้องห้ามเดิม · ของลับของใบไม่หลุด", () => {
    const p = toPrintableJob(job(), stages, URL_OK);
    const photoKeys = Object.keys(p).filter((k) => /photo|image|caption|upload|source|path/i.test(k));
    expect(photoKeys.sort()).toEqual(["primaryPhotoUrl", "sourceLabel"]); // sourceLabel = "งานลูกค้า" (เดิม) ไม่ใช่ที่มาของรูป
    expect(findForbiddenKeys(p)).toEqual([]);
    const json = JSON.stringify(p);
    expect(json).not.toContain("ลูกค้าประจำ");
    expect(json).not.toContain("i-secret");
    expect(json).not.toContain("บริษัท ลับ");
  });

  it("ใบทอง: รูปยังขึ้นได้ (รูปไม่ใช่น้ำหนัก/แผนโลหะ) แต่น้ำหนัก/แผนโลหะยังถูกซ่อนตามเดิม", () => {
    const p = toPrintableJob(job({ metal: "gold", targetPieceG: 3, metalPlanG: 40, weightStartG: 99 }), stages, URL_OK);
    expect(p.primaryPhotoUrl).toBe(URL_OK);
    expect(p.targetPieceG).toBeNull();
    expect(p.metalPlanG).toBeNull();
    expect(p.weightStartG).toBeNull();
  });
});

describe("PrintableSublot.primaryPhotoUrl — ใบย่อยใช้รูปหลักของใบแม่", () => {
  it("ค่าเริ่ม null · ส่ง signed URL ผ่าน · URL แปลกถูกทิ้ง · ส่วนที่พิมพ์ไม่ได้ (ใบแม่/ปิด) ยังเป็น null ทั้งก้อน", () => {
    expect(toPrintableSublot(job(), part, "2026-10-19")?.primaryPhotoUrl).toBeNull();
    expect(toPrintableSublot(job(), part, "2026-10-19", URL_OK)?.primaryPhotoUrl).toBe(URL_OK);
    expect(toPrintableSublot(job(), part, "2026-10-19", "https://evil.example/x.jpg")?.primaryPhotoUrl).toBeNull();
    expect(toPrintableSublot(job(), { ...part, lotSeq: 0 } as LotPart, "2026-10-19", URL_OK)).toBeNull();
    expect(toPrintableSublot(job(), { ...part, status: "done" } as LotPart, "2026-10-19", URL_OK)).toBeNull();
  });
});
