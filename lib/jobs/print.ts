// lib/jobs/print.ts — ข้อมูลที่ "ใบงาน A5" รับได้ (PrintableJob) — ด่านชนิดข้อมูล (type boundary) เหมือน PrintableQuote ของ OEM
// 🔴 ประกอบทีละ field ห้าม spread: ใบงานติดถุงงานที่ช่าง/คนนอกเห็น → ห้ามมี ราคา · ต้นทุน · margin · ชื่อลูกค้า · เลขใบเสนอราคา/PO · เหตุผลเริ่มก่อนมัดจำ · ยอดมัดจำ
// OEM แสดงแค่ "งานลูกค้า" · field ใหม่ใน JobDetail/BoardRow ในอนาคตจึงไม่หลุดมากับใบพิมพ์โดยอัตโนมัติ
// หน้าพิมพ์รับเฉพาะ PrintableJob — ห้ามส่ง JobDetailData/BoardRow เข้า component พิมพ์ (props ของ client component ส่งไปถึงเบราว์เซอร์ทั้งก้อน)

import { METAL_LABEL, SOURCE_LABEL } from "@/lib/jobs/types";
import type { JobDetail, StageRow } from "@/lib/jobs/types";

export interface PrintableJobStage {
  seq: number;
  name: string;
  weighRequired: boolean;
  /** 0176: ขั้นนี้ถามชิ้นเสีย / น้ำหนักเศษ (ใบเดิมไม่มีแบบ: ใบพิมพ์ไม่ใช้ค่านี้ — พิมพ์ทุกคอลัมน์เหมือนเดิม) */
  scrapQtyAsk: boolean;
  scrapWeightAsk: boolean;
}

export interface PrintableJob {
  jobId: string;
  jobNo: string;
  designLabel: string;
  sku: string | null;
  metalLabel: string;
  /** 0175: จำนวนที่สั่ง / จำนวนเริ่มผลิต (รวมเผื่อเสีย) / น้ำหนักเป้าหมายต่อชิ้น / โลหะที่ต้องเตรียม — ไม่มี ledger/ดุลเบิกจริงบนกระดาษ */
  qtyOrder: number;
  qtyPlanned: number;
  targetPieceG: number | null;
  metalPlanG: number | null;
  dueDate: string | null;
  /** "งานลูกค้า" (OEM) หรือ "ผลิตเข้าสต็อก" — ไม่มีชื่อลูกค้า */
  sourceLabel: string;
  weightStartG: number | null;
  /** 0176: ชื่อแบบการบันทึก (null = ใบเดิม ไม่พิมพ์บรรทัดแบบ) — 🔴 ไม่มีป้าย/คำเตือนทอง/แผนทองบนกระดาษ */
  profileName: string | null;
  stages: PrintableJobStage[];
}

/** ขั้นที่ยังต้องผ่าน (ไม่นับที่ข้ามแล้ว) — ใบงานพิมพ์เฉพาะแถวที่ช่างต้องเซ็น */
export function toPrintableJob(job: JobDetail, stages: readonly StageRow[]): PrintableJob {
  // 🔴 ทอง: น้ำหนักทอง = มูลค่า — ใบงานติดถุงงานที่ช่าง/คนนอกเห็น ห้ามมีแผนโลหะ/น้ำหนักเป้าหมาย/น้ำหนักตั้งต้น (security M1 · ช่างทองต้องชั่งแบบไม่รู้คำตอบ)
  // ตัดที่ type boundary นี้ ไม่ใช่ที่ component — field ที่ไม่ถูกประกอบจะไม่ถึงเบราว์เซอร์
  const isGold = job.metal === "gold";
  return {
    jobId: job.id,
    jobNo: job.jobNo,
    designLabel: job.designLabel,
    sku: job.sku,
    metalLabel: METAL_LABEL[job.metal] ?? job.metal,
    qtyOrder: job.qtyOrder,
    qtyPlanned: job.qtyPlanned,
    targetPieceG: isGold ? null : job.targetPieceG,
    metalPlanG: isGold ? null : job.metalPlanG,
    dueDate: job.dueDate,
    sourceLabel: job.sourceKind === "oem" ? "งานลูกค้า" : (SOURCE_LABEL[job.sourceKind] ?? "ผลิตเข้าสต็อก"),
    weightStartG: isGold ? null : job.weightStartG,
    profileName: job.profileName,
    stages: stages.filter((s) => s.status !== "skipped").map((s) => ({ seq: s.seq, name: s.name, weighRequired: s.weighRequired, scrapQtyAsk: s.scrapQtyAsk, scrapWeightAsk: s.scrapWeightAsk })),
  };
}

/** แถวใบส่งงานรายวัน (handoff) — เลขงาน · แบบ · จำนวน · นน. (ไม่มีราคา/ลูกค้า) */
export interface HandoffRow {
  jobNo: string;
  designLabel: string;
  qty: number;
  weightG: number | null;
}
