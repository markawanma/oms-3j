// sellerProfile — ข้อมูล "ฝั่งเรา" ที่ต้องพิมพ์บนหัวใบเสนอราคาที่ส่งลูกค้า
//
// 0079: ย้ายจากค่าคงที่ในไฟล์นี้ (ที่เจ้าของกรอกเองไม่ได้ ต้องรอ dev แก้โค้ด
// ทุกครั้ง — ปัญหาจริงที่เจอตอน UAT) ไปเก็บใน analytics.oem_setting.seller_*
// แทน (คอลัมน์ใหม่บนแถวการตั้งค่าที่มีอยู่แล้ว 1 แถวต่อร้าน) เจ้าของกรอกเองได้
// จากหน้า /oem/rates ส่วน "ข้อมูลร้านเรา (หัวกระดาษ)" — ดู
// lib/actions/oem.ts's getSellerProfile/saveOemSetting สำหรับฝั่งอ่าน/เขียน
//
// ไฟล์นี้เหลือแค่ shape (SellerProfile) + missingSellerFields() — ทั้งหน้า
// พิมพ์ (PrintQuoteClient) และหน้ากรอก (SellerProfileSection) ใช้ type เดียวกัน
// ตัวฟังก์ชัน missingSellerFields ต้อง "รับ profile ที่โหลดมา" เสมอ (ไม่มี
// default เป็นค่าคงที่อีกต่อไป) — เรียกไม่ถูกจะ error ตอน build ให้เห็นทันที
// แทนที่จะเงียบแล้วพิมพ์ค่าเก่าที่ค้างอยู่
//
// ช่องทางติดต่อ (phone-OR-line, ไม่ใช่บังคับทั้งคู่) ใช้ hasAnyContact จาก
// lib/oem/display.ts — ฟังก์ชันเดียวกับที่ BillingDialog/setQuoteBilling ใช้
// กับข้อมูล "ลูกค้า" (phone-OR-contactChannel) กันสองกฎนี้ดริฟต์กัน แม้จะเป็น
// คนละคู่ช่อง (ร้านเรา: phone/line — ลูกค้า: phone/contactChannel).

import { hasAnyContact } from "./display";

export interface SellerProfile {
  /** ชื่อตามทะเบียนที่ใช้ออกบิล เช่น "บริษัท ... จำกัด" หรือชื่อร้านตามทะเบียนพาณิชย์ */
  legalName: string | null;
  /** สำนักงานใหญ่ / สาขาที่ ... — พิมพ์ใต้ที่อยู่ตามแบบใบกำกับภาษีไทย */
  branchLabel: string | null;
  /** ที่อยู่จดทะเบียน แยกเป็นบรรทัด ปิดท้ายด้วยรหัสไปรษณีย์ */
  addressLines: string[];
  /** เลขประจำตัวผู้เสียภาษี 13 หลัก */
  taxId: string | null;
  /** จด VAT หรือยัง — ตัดสินว่าเอกสารเขียนคำว่า VAT ได้ไหม
   *  false = ห้ามพิมพ์ "ราคารวม VAT แล้ว" เด็ดขาด ผิดกฎหมาย */
  vatRegistered: boolean;
  phone: string | null;
  line: string | null;
  email: string | null;
  website: string | null;
  /** เงื่อนไขมาตรฐานที่พิมพ์ท้ายทุกใบ — บรรทัดละข้อ */
  terms: string[];
}

/** ค่าว่างเปล่าล้วน — ใช้เป็น fallback เมื่อโหลด getSellerProfile ไม่สำเร็จ
 * (เช่น schema cache ของ PostgREST ยังไม่เห็น analytics.v_oem_seller หลัง
 * migration ใหม่) เพื่อไม่ให้หน้า /oem/rates หรือหน้าพิมพ์ทั้งหน้าล่มเป็น
 * ErrorState เต็มจอจากปัญหาโครงสร้างพื้นฐานชั่วคราว — หน้าที่เรียกต้องเช็ค
 * ActionResult.ok เองก่อนแล้วส่ง error message แยกไปแสดงเป็นแบนเนอร์แทน
 * ไม่ใช่แปลว่า "เจ้าของยังไม่กรอก" ต้องแยกสองเคสนี้ให้ชัดในหน้าที่ใช้งาน. */
export const EMPTY_SELLER_PROFILE: SellerProfile = {
  legalName: null,
  branchLabel: null,
  addressLines: [],
  taxId: null,
  vatRegistered: false,
  phone: null,
  line: null,
  email: null,
  website: null,
  terms: [],
};

/** รายการข้อมูลที่ยังขาด — หน้าใบเสนอราคาใช้ตัดสินว่าให้สั่งพิมพ์ได้หรือยัง
 *  คืน [] = ครบ พิมพ์ได้. ต้องส่ง profile ที่โหลดจาก DB มาเสมอ (ดู
 *  getSellerProfile ใน lib/actions/oem.ts) — ไม่มีค่าคงที่ให้ fallback อีกแล้ว. */
export function missingSellerFields(p: SellerProfile): string[] {
  const missing: string[] = [];
  if (!p.legalName?.trim()) missing.push("ชื่อที่ใช้ออกบิล");
  if (p.addressLines.filter((l) => l.trim()).length === 0) missing.push("ที่อยู่จดทะเบียน");
  if (!p.taxId?.trim()) missing.push("เลขประจำตัวผู้เสียภาษี");
  if (!hasAnyContact(p.phone, p.line)) missing.push("ช่องทางติดต่อกลับ");
  return missing;
}

/** "โหมดดูตัวอย่าง" (PrintQuoteClient, เมื่อพิมพ์จริงยังไม่ได้) — เติมเฉพาะ
 * ช่องที่ยังขาดจริง (ตาม missingSellerFields) ด้วยข้อความที่อ่านออกชัดเจนว่า
 * เป็นของปลอม (ไม่ใช่ชื่อบริษัท/เลขที่ดูสมจริง) ส่วนช่องที่เจ้าของกรอกไว้แล้ว
 * ใช้ค่าจริงตามปกติ — ให้เห็น "รูปแบบเอกสารจริงของร้านนี้" มากที่สุดเท่าที่มี
 * ข้อมูล ไม่ใช่บริษัทตัวอย่างที่ไม่เกี่ยวข้อง. รายการ/ยอดเงินไม่ถูกแตะเลย
 * (มาจาก PrintableQuote จริงเสมอ — ฟังก์ชันนี้แก้เฉพาะ SellerProfile). */
export function previewSellerProfile(real: SellerProfile): SellerProfile {
  const hasContact = !!real.phone?.trim() || !!real.line?.trim();
  const hasAddress = real.addressLines.some((l) => l.trim());
  return {
    ...real,
    legalName: real.legalName?.trim() || "(ยังไม่ได้กรอกชื่อร้าน)",
    addressLines: hasAddress ? real.addressLines : ["(ยังไม่ได้กรอกที่อยู่ร้าน)"],
    taxId: real.taxId?.trim() || "(ยังไม่ได้กรอกเลขผู้เสียภาษี)",
    phone: hasContact ? real.phone : "(ยังไม่ได้กรอกช่องทางติดต่อกลับ)",
  };
}
