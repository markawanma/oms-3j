// lib/jobs/print.ts — ข้อมูลที่ "ใบงาน A5" รับได้ (PrintableJob) — ด่านชนิดข้อมูล (type boundary) เหมือน PrintableQuote ของ OEM
// 🔴 ประกอบทีละ field ห้าม spread: ใบงานติดถุงงานที่ช่าง/คนนอกเห็น → ห้ามมี ราคา · ต้นทุน · margin · ชื่อลูกค้า · เลขใบเสนอราคา/PO · เหตุผลเริ่มก่อนมัดจำ · ยอดมัดจำ
// OEM แสดงแค่ "งานลูกค้า" · field ใหม่ใน JobDetail/BoardRow ในอนาคตจึงไม่หลุดมากับใบพิมพ์โดยอัตโนมัติ
// หน้าพิมพ์รับเฉพาะ PrintableJob — ห้ามส่ง JobDetailData/BoardRow เข้า component พิมพ์ (props ของ client component ส่งไปถึงเบราว์เซอร์ทั้งก้อน)

import { METAL_LABEL, SOURCE_LABEL } from "@/lib/jobs/types";
import type { JobDetail, StageRow } from "@/lib/jobs/types";
import type { LotPart } from "@/lib/jobs/lots";
import { isJobPhotoSignedUrl } from "@/lib/jobs/photos";
import type { GemsState, JobGemsSummary } from "@/lib/jobs/gems";

export interface PrintableJobStage {
  seq: number;
  name: string;
  weighRequired: boolean;
  /** 0176: ขั้นนี้ถามชิ้นเสีย / น้ำหนักเศษ (ใบเดิมไม่มีแบบ: ใบพิมพ์ไม่ใช้ค่านี้ — พิมพ์ทุกคอลัมน์เหมือนเดิม) */
  scrapQtyAsk: boolean;
  scrapWeightAsk: boolean;
}

/** 0190 G1a: แถวพลอยบนใบ A5 — ประกอบทีละ field · 🔴 ไม่มีราคา/เผื่อแตก/ผู้ขาย/รหัสรายการ/ที่มา */
export interface PrintableJobGem {
  label: string;
  qtyPerPiece: number;
  qtyTotal: number;
  position: string | null;
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
  /**
   * 0182: signed URL (md · 15 นาที) ของรูปหลักของใบ — field รูป "เดียว" ของใบพิมพ์ (ไม่มี caption/ที่มา/ผู้อัปโหลด/จำนวนรูป) · null = ใบไม่มีรูป = markup เดิมเป๊ะ (ไม่มีกรอบว่าง/ข้อความ "ไม่มีรูป")
   * ผ่านด่านรูปร่าง URL (isJobPhotoSignedUrl) — ค่าอื่นที่ไม่ใช่ signed URL ของ bucket job-photos ถูกทิ้งเป็น null
   */
  primaryPhotoUrl: string | null;
  /** 0190: ตารางพลอย (ว่าง = ไม่มี — ใบที่ไม่มีขั้นฝังและไม่มีพลอยต้องพิมพ์เหมือนเดิมเป๊ะ) · gemsState: not_needed | specified | unspecified (มีขั้นฝังแต่ยังไม่ระบุ → ใบพิมพ์ขึ้นบรรทัดเตือน) */
  gems: PrintableJobGem[];
  gemsState: GemsState;
  stages: PrintableJobStage[];
}

/** ขั้นที่ยังต้องผ่าน (ไม่นับที่ข้ามแล้ว) — ใบงานพิมพ์เฉพาะแถวที่ช่างต้องเซ็น */
export function toPrintableJob(job: JobDetail, stages: readonly StageRow[], primaryPhotoUrl: string | null = null, gems: JobGemsSummary | null | undefined = undefined): PrintableJob {
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
    primaryPhotoUrl: isJobPhotoSignedUrl(primaryPhotoUrl) ? primaryPhotoUrl : null,
    // 0190: ประกอบทีละ field (ไม่ spread) · อ่านพลอยไม่ได้ (null/undefined) = ไม่มีตาราง (ใบพิมพ์เดิม — หน้าพิมพ์แจ้งเตือนฝั่งจอจาก res.data.gems === null)
    gems: (gems?.gems ?? []).map((g) => ({ label: g.label, qtyPerPiece: g.qtyPerPiece, qtyTotal: g.qtyTotal, position: g.position })),
    gemsState: gems?.state ?? "not_needed",
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
  /** 0182: รูปหลักของใบแม่ (ส่วนย่อยไม่มีรูปของตัวเอง) — field รูปเดียวเหมือน PrintableJob · null = ไม่มีรูป */
  primaryPhotoUrl: string | null;
}

/** ส่วนที่ไม่ใช่ส่วนย่อยที่ยังเปิด (ใบแม่/ปิดแล้ว/ยกเลิก) = null — ใบย่อยพิมพ์ได้เฉพาะส่วนย่อยที่ยังมีงานอยู่ */
export function toPrintableSublot(job: JobDetail, part: LotPart | undefined, printedOn: string, primaryPhotoUrl: string | null = null): PrintableSublot | null {
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
    primaryPhotoUrl: isJobPhotoSignedUrl(primaryPhotoUrl) ? primaryPhotoUrl : null,
  };
}
