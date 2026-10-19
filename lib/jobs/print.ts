// lib/jobs/print.ts — ข้อมูลที่ "ใบงาน A5" รับได้ (PrintableJob) — ด่านชนิดข้อมูล (type boundary) เหมือน PrintableQuote ของ OEM
// 🔴 ประกอบทีละ field ห้าม spread: ใบงานติดถุงงานที่ช่าง/คนนอกเห็น → ห้ามมี ราคา · ต้นทุน · margin · ชื่อลูกค้า · เลขใบเสนอราคา/PO · เหตุผลเริ่มก่อนมัดจำ · ยอดมัดจำ
// OEM แสดงแค่ "งานลูกค้า" · field ใหม่ใน JobDetail/BoardRow ในอนาคตจึงไม่หลุดมากับใบพิมพ์โดยอัตโนมัติ
// หน้าพิมพ์รับเฉพาะ PrintableJob — ห้ามส่ง JobDetailData/BoardRow เข้า component พิมพ์ (props ของ client component ส่งไปถึงเบราว์เซอร์ทั้งก้อน)

import { METAL_LABEL, SOURCE_LABEL } from "@/lib/jobs/types";
import type { JobDetail, StageRow } from "@/lib/jobs/types";
import type { LotPart } from "@/lib/jobs/lots";

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

// ---------------------------------------------------------------------------
// 0181: ใบย่อย (ถุงของส่วนที่แยก) — QR = อีกใบของใบแม่เดิม (ข1) · ประกอบทีละ field ห้าม spread
// 🔴 ไม่มี: ราคา · ต้นทุน · ชื่อลูกค้า · เลขอ้างอิง · ชื่อผู้เปิดใบ/ผู้ถือ · น้ำหนัก/แผนโลหะ (ทองห้าม · ต้นเหตุ N1 — ใบย่อยไม่พิมพ์น้ำหนักประมาณรอบนี้) · ตัวเลข reject
// ---------------------------------------------------------------------------

export interface PrintableSublot {
  /** ใบแม่ (ใช้ออก QR) */
  jobId: string;
  lotJobId: string;
  /** "JB-0020 · ส่วนที่ 2" */
  lotLabel: string;
  lotSeq: number;
  designLabel: string;
  sku: string | null;
  metalLabel: string;
  /** จำนวนชิ้นของส่วนนี้ */
  qty: number;
  /** ขั้นที่ผ่านมาแล้ว บรรทัดเดียว (ฌ3) เช่น "หล่อ › ขัด" — ว่าง = ยังไม่ผ่านขั้นไหน */
  passedLine: string;
  /** ขั้นที่ส่วนนี้อยู่/รอรับ (ไม่มีชื่อคน) */
  stageName: string | null;
  sourceLabel: string;
  dueDate: string | null;
  /** วันที่พิมพ์ (วันไทย YYYY-MM-DD) */
  printedOn: string;
}

/** ส่วนที่ไม่ใช่ส่วนย่อยที่ยังเปิด (ใบแม่/ปิดแล้ว/ยกเลิก) = null — ใบย่อยพิมพ์ได้เฉพาะส่วนย่อยที่ยังมีงานอยู่ */
export function toPrintableSublot(job: JobDetail, part: LotPart | undefined, printedOn: string): PrintableSublot | null {
  if (!part || part.lotSeq < 1 || part.status === "done" || part.status === "cancelled") return null;
  return {
    jobId: job.id,
    lotJobId: part.jobId,
    lotLabel: `${job.jobNo} · ส่วนที่ ${part.lotSeq}`,
    lotSeq: part.lotSeq,
    designLabel: job.designLabel,
    sku: job.sku,
    metalLabel: METAL_LABEL[job.metal] ?? job.metal,
    qty: part.qtyLive ?? part.qtyPlanned,
    passedLine: part.passedStages.join(" › "),
    stageName: part.stageName,
    sourceLabel: job.sourceKind === "oem" ? "งานลูกค้า" : (SOURCE_LABEL[job.sourceKind] ?? "ผลิตเข้าสต็อก"),
    dueDate: job.dueDate,
    printedOn,
  };
}
