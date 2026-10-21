// ตรรกะ pure ของรูปจากหน้างาน (W2): error → ข้อความ/ลองใหม่ช่วยไหม/ล็อก · คิว (หลักก่อน) · สรุปสำหรับ QR gate · ด่านก่อนออกจากจอ · invariant รูปหลัก · error ย่อรูป (จับด้วยชื่อ class)
import { describe, expect, it } from "vitest";
import { MAX_SHOPFLOOR_PHOTOS } from "@/lib/images/constants";
import { JOB_PHOTO_FILE_CODE } from "@/lib/jobs/photos";
import {
  SHOP_HEIC_MESSAGE, SHOP_PHOTO_MAX, SHOP_PHOTO_TH, describeShopResizeError, leaveGuard, normalizePrimary, photoActionErrorMessage, photoErrorView, photosSummary, positions, reissueErrorView, uploadOrder,
} from "@/lib/jobs/shop-photos";
import type { ShopPhotoItem } from "@/lib/jobs/shop-photos";

const it_ = (o: Partial<ShopPhotoItem> = {}): ShopPhotoItem => ({
  key: "k", phase: "ready", isPrimary: false, serverPrimary: false, saved: false, serverId: null, smUrl: null, mdUrl: null, message: null, retryable: true, needsPin: false, maybeSent: false, ...o,
});

describe("เพดาน", () => {
  it("SHOP_PHOTO_MAX อ้างค่าเดียวกับ MAX_SHOPFLOOR_PHOTOS (3) — ไม่มีเลขซ้ำ", () => {
    expect(SHOP_PHOTO_MAX).toBe(MAX_SHOPFLOOR_PHOTOS);
    expect(SHOP_PHOTO_MAX).toBe(3);
    expect(SHOP_PHOTO_TH.subtitle).toContain("3 รูป");
    expect(SHOP_PHOTO_TH.cutNotice(5, 2)).toBe("เลือกมา 5 รูป ใส่ได้อีก 2 รูป — ตัด 3 รูปท้ายออก");
  });
});

describe("photoErrorView — ตัดสินจาก code ไม่ใช่ข้อความ", () => {
  it("session_required → ใส่ PIN ใหม่ + ลองใหม่ได้ (needsPin)", () => {
    expect(photoErrorView({ code: "session_required", error: "x" })).toEqual({ message: "หมดเวลาแล้ว — ใส่ PIN ใหม่", retryable: true, needsPin: true });
  });
  it("rate_limited → รอสักครู่ ลองใหม่ได้", () => {
    expect(photoErrorView({ code: "rate_limited" })).toEqual({ message: "ส่งถี่เกินไป — รอสักครู่แล้วกด \"ลองใหม่\"", retryable: true });
  });
  it("job_locked → ล็อกทั้งใบ ลองใหม่ไม่ช่วย", () => {
    const v = photoErrorView({ code: "job_locked" });
    expect(v.lock).toBe("locked");
    expect(v.retryable).toBe(false);
    expect(v.message).toBe("ไม่ได้ส่ง — ช่างรับงานแล้ว");
  });
  it("job_cancelled / job_closed → ใบปิดหรือยกเลิก · job_not_open → คำกลาง 'ใบนี้แก้ไม่ได้ตอนนี้' (ไม่ใช่ปิด/ยกเลิก — ห้ามบอกผิดเหตุ)", () => {
    for (const code of ["job_cancelled", "job_closed"]) {
      const v = photoErrorView({ code });
      expect(v.lock, code).toBe("closed");
      expect(v.message, code).toBe("ใบนี้ปิดหรือยกเลิกแล้ว — ส่งรูปไม่ได้");
    }
    const n = photoErrorView({ code: "job_not_open", error: "ใบนี้ไม่อยู่ในสถานะที่แนบรูปได้ — แจ้งออฟฟิศ" });
    expect(n).toEqual({ message: "ใบนี้แก้ไม่ได้ตอนนี้ — แจ้งออฟฟิศ", retryable: false, lock: "not_open" });
    expect(n.message).not.toMatch(/ปิด|ยกเลิก/);
    expect(photoActionErrorMessage({ code: "job_not_open" }, "x")).toBe("ใบนี้แก้ไม่ได้ตอนนี้ — แจ้งออฟฟิศ");
  });
  it("not_allowed / order_not_found → ไม่ใช่ผู้เปิด (ข้อความเดียวกัน ไม่บอกว่าใบมีจริงไหม)", () => {
    for (const code of ["not_allowed", "order_not_found"]) {
      const v = photoErrorView({ code });
      expect(v.lock, code).toBe("not_owner");
      expect(v.message, code).toBe("แก้รูปได้เฉพาะคนที่เปิดใบนี้");
    }
  });
  it("ครบเพดานรูป → ลองใหม่ไม่ช่วย (ไม่ล็อกทั้งใบ) · เพดานหน้างาน = 3 · เพดานรวม reference = 5 (ข้อความตัวเลขตรงของจริง — ไม่ใช้ข้อความ 3 รูปกับเพดาน 5)", () => {
    expect(photoErrorView({ code: "photo_cap_shopfloor" })).toEqual({ message: "ใบนี้มีรูปจากหน้างานครบ 3 รูปแล้ว", retryable: false });
    expect(photoErrorView({ code: "photo_cap_ref" })).toEqual({ message: "ใบนี้มีรูปครบ 5 รูปแล้ว — แจ้งออฟฟิศ", retryable: false });
    expect(photoErrorView({ code: "photo_cap_total" })).toEqual({ message: "ใบนี้มีรูปครบกำหนดแล้ว — แจ้งออฟฟิศ", retryable: false });
  });
  it("โควตา M1 (พื้นที่รูปหน้างานของร้านเต็ม / ช่างแนบครบต่อ 24 ชม.) → ข้อความตรงกับ server · ลองใหม่ไม่ช่วย · quota=true (หยุดคิวทั้งชุด) · ไม่มีตัวเลขโควตาบนจอ", () => {
    expect(photoErrorView({ code: "photo_budget_shopfloor", error: "x" })).toEqual({ message: "พื้นที่รูปจากหน้างานเต็มแล้ว — แจ้งออฟฟิศ", retryable: false, quota: true });
    expect(photoErrorView({ code: "photo_daily_cap", error: "x" })).toEqual({ message: "วันนี้แนบรูปครบกำหนดแล้ว", retryable: false, quota: true });
    expect(SHOP_PHOTO_TH.failShopBudget + SHOP_PHOTO_TH.failDailyCap).not.toMatch(/\d|MB|GB|60|80/);
    expect(photoErrorView({ code: "photo_cap_shopfloor" }).quota).toBeUndefined(); // เพดานต่อใบไม่ใช่โควตา (ลบรูปเก่าแล้วเพิ่มได้ ไม่หยุดคิว)
  });
  it("photo_key_used (clientPhotoKey ซ้ำกับรูปที่ลบแล้ว/ใบอื่น) → ลองใหม่ไม่ช่วย ข้อความไทย ไม่ล็อกใบ", () => {
    expect(photoErrorView({ code: "photo_key_used", error: "x" })).toEqual({ message: "รูปนี้ถูกใช้ไปแล้ว — เลือกรูปใหม่", retryable: false });
  });
  it("primary_locked (ออฟฟิศ/แคตตาล็อกตั้งรูปหลักไว้) → ข้อความเฉพาะของการตั้งรูปหลัก (ไม่ใช่ล็อกทั้งใบ)", () => {
    expect(photoActionErrorMessage({ code: "primary_locked", error: "รูปหลักตั้งโดยออฟฟิศแล้ว — เปลี่ยนไม่ได้ ถ้าต้องแก้ แจ้งออฟฟิศ" }, "x")).toBe("รูปหลักออฟฟิศตั้งไว้แล้ว — แจ้งออฟฟิศถ้าจะเปลี่ยน");
    expect(photoErrorView({ code: "primary_locked" }).lock).toBeUndefined();
  });
  it("ด่านไฟล์ (JPEG ปลอม/เสีย/ใหญ่/พิกเซลเกิน) → ลองใหม่ไม่ช่วย ใช้ข้อความไทยของด่าน", () => {
    for (const code of Object.values(JOB_PHOTO_FILE_CODE)) {
      const v = photoErrorView({ code, error: "ไฟล์รูปเสียหายหรือโครงสร้างไม่ถูกต้อง — เลือกรูปใหม่" });
      expect(v.retryable, code).toBe(false);
      expect(v.message, code).toContain("เลือกรูปใหม่");
    }
    expect(photoErrorView({ code: "photo_bytes_invalid", error: "ไฟล์รูปไม่ถูกต้อง (ใหญ่เกินกำหนดหรือว่างเปล่า)" }).retryable).toBe(false);
  });
  it("QR ร้านใช้ไม่ได้ → ข้อความไทย ลองใหม่ไม่ช่วย", () => {
    expect(photoErrorView({ code: "invalid_token" })).toEqual({ message: "QR ร้านนี้ใช้ไม่ได้แล้ว — ขอออฟฟิศออก QR ใหม่", retryable: false });
  });
  it("code ไม่รู้จัก: ข้อความสะอาด = ใช้ต่อ · ข้อความมีรหัส/ชื่อตาราง/เงิน = ทิ้ง ใช้ข้อความกลาง · ไม่มี code = ข้อความกลาง", () => {
    expect(photoErrorView({ code: "weird", error: "ลองอีกครั้งในอีกสักครู่" })).toEqual({ message: "ลองอีกครั้งในอีกสักครู่", retryable: true });
    expect(photoErrorView({ code: "weird", error: "job_photo_add failed in analytics" }).message).toBe("ส่งไม่สำเร็จ — ลองอีกครั้ง");
    expect(photoErrorView({ code: "weird", error: "ต้นทุน 120 บาท" }).message).toBe("ส่งไม่สำเร็จ — ลองอีกครั้ง");
    expect(photoErrorView({ error: "ข้อความที่ไม่มี code" }).message).toBe("ส่งไม่สำเร็จ — ลองอีกครั้ง");
  });
  it("ข้อความทุกตัวใน SHOP_PHOTO_TH ไม่มีคำเรื่องเงิน/น้ำหนักทอง", () => {
    const fnTexts = [SHOP_PHOTO_TH.reviewFooter(3), SHOP_PHOTO_TH.retryAll(2), SHOP_PHOTO_TH.qrPartial("1, 2"), SHOP_PHOTO_TH.cutNotice(5, 2)];
    const all = [...(Object.values(SHOP_PHOTO_TH) as unknown[]).filter((v): v is string => typeof v === "string"), ...fnTexts];
    for (const s of all) expect(s, s).not.toMatch(/บาท|฿|ราคา|ต้นทุน|margin|price|cost|กรัม/i);
  });
});

describe("photoActionErrorMessage (ลบ/ตั้งรูปหลักล้ม)", () => {
  it("ล็อก/ใบปิด/ไม่ใช่ผู้เปิด/PIN/ส่งถี่ → ข้อความเฉพาะ · อื่นๆ → ข้อความสำรองของผู้เรียก", () => {
    expect(photoActionErrorMessage({ code: "job_locked" }, "x")).toBe("ช่างรับงานแล้ว แก้รูปไม่ได้ — แจ้งออฟฟิศ");
    expect(photoActionErrorMessage({ code: "job_cancelled" }, "x")).toBe("ใบนี้ปิดหรือยกเลิกแล้ว — ส่งรูปไม่ได้");
    expect(photoActionErrorMessage({ code: "not_allowed" }, "x")).toBe("แก้รูปได้เฉพาะคนที่เปิดใบนี้");
    expect(photoActionErrorMessage({ code: "session_required" }, "x")).toBe("หมดเวลาแล้ว — ใส่ PIN ใหม่");
    expect(photoActionErrorMessage({ code: "rate_limited" }, "x")).toBe("ส่งถี่เกินไป — รอสักครู่แล้วกด \"ลองใหม่\"");
    expect(photoActionErrorMessage({ code: "error", error: "ระบบขัดข้อง" }, "สำรอง")).toBe("สำรอง");
    expect(photoActionErrorMessage({ error: "snake_case_error" }, "สำรอง")).toBe("สำรอง");
  });
});

describe("reissueErrorView — ออก QR ใหม่", () => {
  it("แต่ละ code → ข้อความไทย + ต้องใส่ PIN/จบ (ลองซ้ำไม่ช่วย)", () => {
    expect(reissueErrorView({ code: "session_required" })).toEqual({ message: "หมดเวลาแล้ว — ใส่ PIN ใหม่", needsPin: true, final: false });
    expect(reissueErrorView({ code: "token_cap" })).toEqual({ message: "ใบนี้มี QR ที่ใช้งานอยู่ครบ 5 ใบแล้ว — แจ้งออฟฟิศให้เพิกถอนก่อน", needsPin: false, final: true });
    for (const code of ["job_closed", "job_cancelled"]) expect(reissueErrorView({ code }), code).toEqual({ message: "ใบนี้ปิดหรือยกเลิกแล้ว — ออก QR ใหม่ไม่ได้", needsPin: false, final: true });
    expect(reissueErrorView({ code: "job_not_open" })).toEqual({ message: "ใบนี้แก้ไม่ได้ตอนนี้ — แจ้งออฟฟิศ", needsPin: false, final: true });
    for (const code of ["not_allowed", "order_not_found"]) expect(reissueErrorView({ code }).message, code).toBe("แก้รูปได้เฉพาะคนที่เปิดใบนี้");
    expect(reissueErrorView({ code: "token_not_issued" }).final).toBe(true);
    expect(reissueErrorView({ code: "rate_limited" })).toMatchObject({ final: false, needsPin: false });
  });
  it("code ไม่รู้จัก: ข้อความสะอาด = ใช้ต่อ · มีรหัส/ชื่อตาราง/เงิน = ข้อความกลาง · ไม่ final", () => {
    expect(reissueErrorView({ code: "weird", error: "ลองอีกครั้งในอีกสักครู่" })).toEqual({ message: "ลองอีกครั้งในอีกสักครู่", needsPin: false, final: false });
    expect(reissueErrorView({ code: "weird", error: "job_token_issue_core failed" }).message).toBe("ออก QR ใหม่ไม่สำเร็จ — ลองอีกครั้ง");
    expect(reissueErrorView({ code: "error", error: "ระบบขัดข้อง" }).message).toBe("ออก QR ใหม่ไม่สำเร็จ — ลองอีกครั้ง");
    expect(reissueErrorView({}).final).toBe(false);
  });
});

describe("uploadOrder — รูปหลักก่อน แล้วตามลำดับที่เลือก (กัน server ตั้งรูปหลักผิดรูป)", () => {
  it("เรียงเฉพาะที่ queued", () => {
    const items = [it_({ key: "a", phase: "queued" }), it_({ key: "b", phase: "queued", isPrimary: true }), it_({ key: "c", phase: "done" }), it_({ key: "d", phase: "queued" }), it_({ key: "e", phase: "error" })];
    expect(uploadOrder(items).map((i) => i.key)).toEqual(["b", "a", "d"]);
  });
});

describe("photosSummary — ตัวตัดสิน QR gate", () => {
  const s = (...p: ShopPhotoItem["phase"][]) => photosSummary(p.map((phase) => ({ phase })));
  it("none / sending / partial / locked / done", () => {
    expect(s()).toBe("none");
    expect(s("done", "uploading")).toBe("sending");
    expect(s("queued")).toBe("sending");
    expect(s("resizing")).toBe("sending");
    expect(s("done", "error")).toBe("partial");
    expect(s("done", "locked")).toBe("locked");
    expect(s("done", "done")).toBe("done");
  });
  it("ส่งอยู่ชนะล้ม (ล้มค้างขณะที่ยังส่งอยู่ = ยังไม่ปล่อย QR)", () => {
    expect(s("error", "uploading")).toBe("sending");
    expect(s("error", "locked")).toBe("partial");
  });
});

describe("leaveGuard — ด่านก่อนออกจากจอ", () => {
  it("ทุกรูปถึง server = ออกได้ทันที", () => {
    expect(leaveGuard([{ phase: "done" }, { phase: "done" }], null).needed).toBe(false);
    expect(leaveGuard([], null).needed).toBe(false);
  });
  it("มีรูปค้าง (queued/uploading/error/ready/resizing) = ต้องถาม · ส่งต่อได้เมื่อไม่ล็อก", () => {
    for (const phase of ["queued", "uploading", "error", "ready", "resizing"] as const) {
      const g = leaveGuard([{ phase }], null);
      expect(g.needed, phase).toBe(true);
      expect(g.canStillSend, phase).toBe(true);
    }
  });
  it("ล็อก: รูปที่ไม่ได้ส่ง (locked) = ต้องถาม แต่ส่งต่อไม่ได้", () => {
    const g = leaveGuard([{ phase: "done" }, { phase: "locked" }], "locked");
    expect(g).toEqual({ needed: true, unsent: 0, lockedUnsent: 1, canStillSend: false });
  });
});

describe("normalizePrimary — มีรูป ≥ 1 ⇒ รูปหลักพอดี 1", () => {
  it("ไม่มีรูปหลัก → รูปแรก · ถ้ามีรูปที่ server บอกว่าหลักก่อน → รูปนั้น", () => {
    const a = it_({ key: "a" });
    const b = it_({ key: "b", serverPrimary: true });
    expect(normalizePrimary([a, b]).filter((i) => i.isPrimary).map((i) => i.key)).toEqual(["b"]);
    expect(normalizePrimary([a, it_({ key: "c" })]).filter((i) => i.isPrimary).map((i) => i.key)).toEqual(["a"]);
  });
  it("มีหลักพอดี 1 = ไม่แตะ · หลายรูปหลัก = เหลือ 1 · ว่าง = ว่าง", () => {
    const x = [it_({ key: "a" }), it_({ key: "b", isPrimary: true })];
    expect(normalizePrimary(x).map((i) => i.isPrimary)).toEqual([false, true]);
    expect(normalizePrimary([it_({ key: "a", isPrimary: true }), it_({ key: "b", isPrimary: true })]).filter((i) => i.isPrimary)).toHaveLength(1);
    expect(normalizePrimary([])).toEqual([]);
  });
});

describe("describeShopResizeError — จับด้วยชื่อ class (ไม่ import lib/images/client)", () => {
  const err = (name: string, extra: Record<string, unknown> = {}) => Object.assign(new Error("x"), { name }, extra);
  it("HEIC = ข้อความเดียวกับจอรูปออฟฟิศ", () => {
    expect(describeShopResizeError(err("HeicNotSupportedError"))).toBe(SHOP_HEIC_MESSAGE);
    expect(SHOP_HEIC_MESSAGE).toContain("iPhone: ตั้งค่า > กล้อง > รูปแบบ > รองรับมากที่สุด");
  });
  it("ใหญ่/เสีย/ต้นฉบับใหญ่/อื่นๆ", () => {
    expect(describeShopResizeError(err("ImageTooLargeError"))).toContain("เกิน 1MB");
    expect(describeShopResizeError(err("ImageDecodeError"))).toContain("ไฟล์เสียหาย");
    expect(describeShopResizeError(err("SourceImageTooLargeError", { bytes: 40 * 1024 * 1024 }))).toContain("(40MB)");
    expect(describeShopResizeError(new Error("boom"))).toBe("ย่อรูปไม่สำเร็จ ลองเลือกรูปใหม่อีกครั้ง");
    expect(describeShopResizeError("string")).toBe("ย่อรูปไม่สำเร็จ ลองเลือกรูปใหม่อีกครั้ง");
  });
});

describe("positions", () => {
  it("ลำดับ 1-based ของรูปที่เข้าเงื่อนไข", () => {
    expect(positions([1, 2, 3], (i) => i !== 1)).toBe("1, 3");
    expect(positions([1, 2, 3], () => false)).toBe("");
  });
});
