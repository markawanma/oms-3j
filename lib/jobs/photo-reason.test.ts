// เหตุผลลบรูปจากหน้างาน (ออฟฟิศ): whitelist ตัวอักษร/ตัวเลขจริง — ห้าม blacklist ช่องว่างเอง (บทเรียน oem_note_present)
// ต้องไม่ผ่าน: ว่าง/ช่องว่างล้วน/ขึ้นบรรทัดใหม่ล้วน/เครื่องหมายล้วน/อีโมจิล้วน/อักขระล่องหน (ZW, bidi, U+2800, VS16, tag, NEL) · ต้องไม่พัง: ไทย/ละติน/เลข/ผสมเครื่องหมาย ผ่าน
import { describe, expect, it } from "vitest";
import { JOB_PHOTO_REASON_MAX } from "@/lib/images/constants";
import { INVISIBLE_MSG } from "@/lib/jobs/input";
import { MSG_REASON_LONG, MSG_REASON_REQUIRED, SHOP_PHOTO_DELETE_REASON_CHIPS, photoReasonIssue } from "@/lib/jobs/photo-reason";

describe("photoReasonIssue — ต้องไม่ผ่าน", () => {
  it("ไม่ใช่ข้อความ / ว่าง / ช่องว่างและขึ้นบรรทัดใหม่ล้วน / เครื่องหมายล้วน / อีโมจิล้วน → 'ใส่เหตุผลก่อนลบ'", () => {
    for (const v of [undefined, null, 5, {}, "", " ", "   ", "\n", "\r\n\t", ".", "...", "-", "!!!", "👍", "👍👍", "😀", "()", "—"]) {
      expect(photoReasonIssue(v), JSON.stringify(v)).toBe(MSG_REASON_REQUIRED);
    }
  });
  it("อักขระล่องหน/bidi/tag/ควบคุม (แม้มีตัวอักษรปน) → ข้อความอักขระมองไม่เห็น", () => {
    const bad = ["​", "​ไม่ชัด", "ไม่ชัด​", "a‍b", "‮txt", "⁠", "⠀", "ㅤ", "️", "ไม่ชัด️", "﻿abc", "󠀁abc", "\u0085", "ไม่ชัด\u0085", "ab\u0000", "ab\u0007", "ab\u007F"];
    for (const v of bad) expect(photoReasonIssue(v), JSON.stringify(v)).toBe(INVISIBLE_MSG("เหตุผล"));
  });
  it("ยาวเกิน 300 ตัวอักษร (นับ code point) → ข้อความยาวเกิน", () => {
    expect(photoReasonIssue("ก".repeat(JOB_PHOTO_REASON_MAX + 1))).toBe(MSG_REASON_LONG);
    expect(photoReasonIssue("😀".repeat(JOB_PHOTO_REASON_MAX) + "ก")).toBe(MSG_REASON_LONG);
  });
});

describe("photoReasonIssue — ต้องไม่พัง", () => {
  it("ไทย/ละติน/เลข/ผสมเครื่องหมาย ผ่าน · ชิปทั้งสามผ่าน · เหตุผลที่มีอีโมจิปนตัวอักษรผ่าน (👍 ธรรมดาไม่ใช่ล่องหน)", () => {
    for (const v of ["ไม่ชัด", "blur", "5", "ไม่ใช่ชิ้นงาน — รูปหน้าจอ", "a", "ก", " ภาพไม่ชัด ", "ไม่เหมาะสม 👍", "รูปที่ 2 (ซ้ำ)", "ภาพ\nไม่ชัด", "x".repeat(JOB_PHOTO_REASON_MAX)]) {
      expect(photoReasonIssue(v), JSON.stringify(v)).toBeNull();
    }
    for (const c of SHOP_PHOTO_DELETE_REASON_CHIPS) expect(photoReasonIssue(c), c).toBeNull();
    expect(SHOP_PHOTO_DELETE_REASON_CHIPS).toEqual(["ไม่ใช่ชิ้นงาน", "ภาพไม่ชัด", "ไม่เหมาะสม"]);
  });
});
