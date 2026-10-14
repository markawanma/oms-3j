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
  stages: PrintableJobStage[];
}

/** ขั้นที่ยังต้องผ่าน (ไม่นับที่ข้ามแล้ว) — ใบงานพิมพ์เฉพาะแถวที่ช่างต้องเซ็น */
export function toPrintableJob(job: JobDetail, stages: readonly StageRow[]): PrintableJob {
  return {
    jobId: job.id,
    jobNo: job.jobNo,
    designLabel: job.designLabel,
    sku: job.sku,
    metalLabel: METAL_LABEL[job.metal] ?? job.metal,
    qtyOrder: job.qtyOrder,
    qtyPlanned: job.qtyPlanned,
    targetPieceG: job.targetPieceG,
    metalPlanG: job.metalPlanG,
    dueDate: job.dueDate,
    sourceLabel: job.sourceKind === "oem" ? "งานลูกค้า" : (SOURCE_LABEL[job.sourceKind] ?? "ผลิตเข้าสต็อก"),
    weightStartG: job.weightStartG,
    stages: stages.filter((s) => s.status !== "skipped").map((s) => ({ seq: s.seq, name: s.name, weighRequired: s.weighRequired })),
  };
}

/** แถวใบส่งงานรายวัน (handoff) — เลขงาน · แบบ · จำนวน · นน. (ไม่มีราคา/ลูกค้า) */
export interface HandoffRow {
  jobNo: string;
  designLabel: string;
  qty: number;
  weightG: number | null;
}
