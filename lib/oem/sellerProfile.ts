// sellerProfile — ข้อมูล "ฝั่งเรา" ที่ต้องพิมพ์บนหัวใบเสนอราคาที่ส่งลูกค้า
//
// ทำไมเป็นไฟล์ ไม่ใช่ตารางใน DB: ข้อมูลชุดนี้เป็นของนิติบุคคลเดียว เปลี่ยนปีละ
// ครั้งก็ยังไม่มี ไม่คุ้มที่จะทำหน้าจอแก้ + migration + RLS มาดูแล ถ้าวันหนึ่ง
// ร้านมีหลายนิติบุคคล/หลายสาขาที่ออกบิลแยกกัน ค่อยย้ายเข้า DB แล้วผูกกับ shop_id
//
// ⚠️ ค่าที่เป็น null คือยังไม่ได้รับข้อมูลจากเจ้าของร้าน — หน้าใบเสนอราคาจะ
// ขึ้นแถบเตือนสีแดงและกันไม่ให้สั่งพิมพ์ จนกว่าจะกรอกครบ เพื่อไม่ให้เอกสารที่
// ยังไม่มีเลขผู้เสียภาษี/ที่อยู่หลุดไปถึงลูกค้า

export interface SellerProfile {
  /** ชื่อตามทะเบียนที่ใช้ออกบิล เช่น "บริษัท ... จำกัด" หรือชื่อร้านตามทะเบียนพาณิชย์ */
  legalName: string | null;
  /** ชื่อที่ลูกค้ารู้จัก ใช้เป็นหัวกระดาษถ้าต่างจากชื่อจดทะเบียน */
  displayName: string;
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

export const SELLER_PROFILE: SellerProfile = {
  legalName: null, // TODO(owner): ชื่อตามทะเบียน
  displayName: "3J Jewelry",
  branchLabel: null, // TODO(owner): "สำนักงานใหญ่" หรือ "สาขาที่ 00001"
  addressLines: [], // TODO(owner): ที่อยู่จดทะเบียน + รหัสไปรษณีย์
  taxId: null, // TODO(owner): เลขผู้เสียภาษี 13 หลัก
  vatRegistered: false, // TODO(owner): จด VAT แล้วหรือยัง
  phone: null, // TODO(owner)
  line: null, // TODO(owner)
  email: null,
  website: "www.3jthailand.com",
  terms: [], // TODO(owner): มัดจำกี่ % · ผลิตกี่วันหลังยืนยันแบบ · บัญชีรับเงิน
};

/** รายการข้อมูลที่ยังขาด — หน้าใบเสนอราคาใช้ตัดสินว่าให้สั่งพิมพ์ได้หรือยัง
 *  คืน [] = ครบ พิมพ์ได้ */
export function missingSellerFields(p: SellerProfile = SELLER_PROFILE): string[] {
  const missing: string[] = [];
  if (!p.legalName?.trim()) missing.push("ชื่อที่ใช้ออกบิล");
  if (p.addressLines.filter((l) => l.trim()).length === 0) missing.push("ที่อยู่จดทะเบียน");
  if (!p.taxId?.trim()) missing.push("เลขประจำตัวผู้เสียภาษี");
  if (!p.phone?.trim() && !p.line?.trim()) missing.push("ช่องทางติดต่อกลับ");
  return missing;
}
