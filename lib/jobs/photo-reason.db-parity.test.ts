// QA W2-UI — photoReasonIssue (pre-check ฝั่งฟอร์มลบรูปจากหน้างาน) ต้องตัดสินเหมือน DB (analytics.job_photo_remove · 0189)
// ค่าฝั่ง DB ด้านล่างได้จากการยิง RPC จริงใน tx rollback (QA 21 ต.ค. 69 · qa-ui-0189.sql · UI12) — hex = UTF-8 ของเหตุผลที่ส่ง · db: "OK" = ลบได้ · อย่างอื่น = ถูกปฏิเสธ
// 🔴 จุดประสงค์: JS ห้าม "หลวมกว่า DB" (ผู้ใช้กดลบแล้วโดน server ตีกลับ) — เข้มกว่า DB ได้ แต่ต้องรู้ตัว (ระบุไว้ใน strictOnly)

import { describe, expect, it } from "vitest";
import { photoReasonIssue } from "@/lib/jobs/photo-reason";

const fromHex = (h: string): string | null => (h === "NULL" ? null : Buffer.from(h, "hex").toString("utf8"));

// [index จากชุดทดสอบ SQL, hex ของเหตุผล, ผลของ DB]
const DB: ReadonlyArray<[number, string, string]> = [
  [0, "NULL", "reason_required"],
  [1, "", "reason_required"],
  [2, "20", "reason_required"],
  [3, "2020", "reason_required"],
  [4, "e0b881", "reason_required"], // "ก" ตัวเดียว
  [5, "20e0b88120", "reason_required"], // " ก "
  [6, "6162", "OK"], // "ab"
  [7, "612062", "OK"], // "a b"
  [8, "2e2e", "reason_required"], // ".."
  [9, "2d2d", "reason_required"], // "--"
  [10, "f09f918df09f918d", "reason_required"], // "👍👍"
  [11, "e0b881e0b988", "OK"], // "ก่" (พยัญชนะ + วรรณยุกต์)
  [12, "e0b988e0b988", "reason_required"], // วรรณยุกต์ล้วน
  [13, "3132", "OK"], // "12"
  [14, "312e", "OK"], // "1."
  [15, "e0b984e0b8a1e0b988e0b88ae0b8b1e0b894", "OK"], // "ไม่ชัด"
  [16, "e0b8a0e0b8b2e0b89ee0b984e0b8a1e0b988e0b88ae0b8b1e0b894", "OK"], // "ภาพไม่ชัด"
  [17, "e0b881e2808b", "22023:invisible"], // "ก" + ZWSP
  [18, "e2808be2808b", "22023:invisible"], // ZWSP×2
  [19, "e2a080e2a080", "reason_required"], // U+2800×2 (braille blank)
  [20, "e0b881efb88f", "OK"], // "ก" + VS16 (U+FE0F)
  [21, "61c28562", "22023:invisible"], // "a" NEL "b"
  // #22 "ab<LF>cd" (DB ปฏิเสธ 22023 — ขึ้นบรรทัดใหม่) แยกไปเทสต์ด้านล่าง: photoReasonIssue ยอมขึ้นบรรทัดใหม่เอง แต่กล่องลบแปลงเป็นช่องว่างก่อนทุกครั้ง (oneLine)
  [23, "e0b88120", "reason_required"], // "ก "
  [24, "e0b881c2a0", "reason_required"], // "ก" + NBSP
  [25, "e38080e38080", "reason_required"], // ช่องว่าง ideographic ×2
];

// JS เข้มกว่า DB โดยตั้งใจ/โดยผลของ INVISIBLE_RE — ผู้ใช้ถูกกันที่ฟอร์ม (ไม่ใช่ช่องโหว่ · เป็นแค่ความต่าง)
const STRICTER_THAN_DB = new Set<number>([20]);

describe("photoReasonIssue เทียบ DB job_photo_remove (ผลจริงที่ยิงบน RPC)", () => {
  for (const [idx, hex, db] of DB) {
    const raw = fromHex(hex);
    const dbOk = db === "OK";
    it(`#${idx} ${JSON.stringify(raw)} → DB ${db}`, () => {
      const js = photoReasonIssue(raw);
      if (dbOk && STRICTER_THAN_DB.has(idx)) {
        // บันทึกความต่างไว้ตรงๆ: DB ยอม แต่ฟอร์มกัน
        expect(js).not.toBeNull();
        return;
      }
      if (!dbOk) {
        // JS ห้ามหลวมกว่า DB: DB ปฏิเสธ → ฟอร์มต้องไม่ปล่อย
        expect(js, `JS หลวมกว่า DB ที่เหตุผล #${idx}`).not.toBeNull();
      } else {
        // DB ยอม → ฟอร์มต้องยอมด้วย (ไม่งั้นผู้ใช้ลบไม่ได้ทั้งที่เหตุผลใช้ได้)
        expect(js, `JS เข้มกว่า DB ที่เหตุผล #${idx} (ยังไม่อยู่ใน STRICTER_THAN_DB)`).toBeNull();
      }
    });
  }

  it("#22 ขึ้นบรรทัดใหม่: photoReasonIssue ยอม (DB ปฏิเสธ) → กันด้วย oneLine ของ JobPhotoDeleteDialog ที่แปลง LF เป็นช่องว่างทั้งตอนพิมพ์และตอนส่ง", () => {
    const oneLine = (x: string): string => x.replace(/\s*[\r\n]+\s*/g, " "); // สำเนาจาก JobPhotoDeleteDialog.tsx — ต้องตรงกัน
    const raw = fromHex("61620a6364") as string;
    expect(photoReasonIssue(raw)).toBeNull(); // ความจริงที่ต้องรู้: ตัวตรวจเองไม่กันขึ้นบรรทัดใหม่
    expect(oneLine(raw)).toBe("ab cd");
    expect(photoReasonIssue(oneLine(raw))).toBeNull();
    expect(oneLine(raw)).not.toMatch(/[\r\n]/);
  });

  it("เหตุผลยาวพอดีขอบ 300 / เกิน 300 (นับตัวอักษรแบบ code point)", () => {
    expect(photoReasonIssue("ก".repeat(300))).toBeNull();
    expect(photoReasonIssue("ก".repeat(301))).not.toBeNull();
    // emoji 2 code unit ต่อ 1 ตัว: 300 ตัว + ตัวอักษร = เกิน
    expect(photoReasonIssue("😀".repeat(300) + "ก")).not.toBeNull();
  });

  it("ไม่ใช่ string → ใช้ไม่ได้ (ไม่ throw)", () => {
    for (const bad of [undefined, null, 5, {}, []]) expect(() => photoReasonIssue(bad)).not.toThrow();
    expect(photoReasonIssue(undefined)).not.toBeNull();
    expect(photoReasonIssue(5)).not.toBeNull();
  });
});
