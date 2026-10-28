// lib/jobs/print-title.ts — ชื่อไฟล์ PDF ของใบงาน A5 / ใบย่อย (pure) · รูปแบบ + กติกาอยู่ที่ lib/print/filename.ts
// วันที่ = "วันที่เปิดใบงาน" (created_at ตามเวลาไทย) ไม่ใช่วันกดพิมพ์ → พิมพ์ซ้ำได้ชื่อเดิม
// ใช้เฉพาะ เลขใบ + ชื่อแบบ/SKU ที่ใบพิมพ์แสดงอยู่แล้ว — 🔴 ไม่มีราคา/ต้นทุน/ชื่อลูกค้า/น้ำหนัก (รับ field ตรงตัว ไม่รับ JobDetail ทั้งก้อน)

import { bkkYYMMDD, printFileTitle, sanitizeFileTitlePart } from "@/lib/print/filename";

export interface JobTitleSource {
  jobNo: string;
  createdAt: string | null;
  designLabel: string;
  sku: string | null;
}

/** ใบแม่: `261021_JB-0034_ต่างหู` · ชื่อ = designLabel ถ้าว่างใช้ SKU ถ้าว่างทั้งคู่ตัดส่วนนี้ · lotSeq ≥ 1 = ใบย่อย `261021_JB-0034-ส่วน2_ต่างหู` (วันเปิดใบแม่) */
export function jobPrintTitle(job: JobTitleSource, lotSeq?: number | null): string {
  // "ว่าง" = ว่างหลังทำความสะอาด (ล่องหน/ต้องห้ามล้วนนับเป็นว่าง) → ถอยไปใช้ SKU
  const label = sanitizeFileTitlePart(job.designLabel) || sanitizeFileTitlePart(job.sku);
  const isLot = typeof lotSeq === "number" && Number.isInteger(lotSeq) && lotSeq >= 1;
  return printFileTitle({
    date: bkkYYMMDD(job.createdAt),
    docNo: isLot ? `${job.jobNo}-ส่วน${lotSeq}` : job.jobNo,
    name: label,
  });
}

/** โปสเตอร์ QR ร้าน: `261023_QR-ร้าน` · วันที่ = วันที่ออก QR (เวลาไทย) — อ่านไม่ได้ใช้ "ตอนนี้" (เพิ่งออกเมื่อกี้) */
export function shopQrPrintTitle(issuedAt: string | null | undefined, now: Date = new Date()): string {
  return printFileTitle({ date: bkkYYMMDD(issuedAt) || bkkYYMMDD(now), docNo: "QR-ร้าน" });
}
