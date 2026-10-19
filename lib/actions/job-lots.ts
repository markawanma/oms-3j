"use server";

// lib/actions/job-lots.ts — ส่วนย่อยของใบงาน (L1 · 0181): ออฟฟิศแยก/ยกเลิกส่วน · ชี้แจง/ยกเลิกส่วนต่าง · รายการ QR ของใบ
// guard() บรรทัดแรก · p_actor/p_shop_id ใส่ฝั่ง server หลัง spread (callOffice) · ตรวจชนิด/ช่วง input ก่อนถึง DB · DB ยังเป็นด่านจริง
// ไม่มีตัวเลขเงิน/ต้นทุนในผลลัพธ์ · token ดิบไม่ผ่านไฟล์นี้ (ออก QR ใบย่อยผ่าน issueJobQr ใน job-office-write.ts)

import { revalidatePath } from "next/cache";
import { isUuid, parseCount, parseLabel, parseScrapReason, parseSeq, parseText, parseWeight } from "@/lib/jobs/input";
import { callOffice, fail, guard } from "@/lib/jobs/office-server";
import type { JobResult } from "@/lib/jobs/office-server";

type Raw = Record<string, unknown>;
const done = (jobId: string) => {
  revalidatePath("/jobs");
  revalidatePath(`/jobs/${jobId}`);
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) ? v : null);
const str = (v: unknown, max = 80): string | null => (typeof v === "string" && v !== "" ? v.slice(0, max) : null);
const pieces = (raw: unknown, label: string): { ok: true; value: number } | { ok: false; error: string } => {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  if (!Number.isSafeInteger(n) || n < 1 || n > 100000) return { ok: false, error: `${label}ต้องเป็นจำนวนเต็ม 1–100,000` };
  return { ok: true, value: n };
};

export interface SplitLotInput {
  /** ใบที่ถือขั้นนั้นอยู่ (ใบแม่หรือส่วนย่อย) */
  jobId: string;
  expectedSeq: number;
  qty: number | string;
  qtyScrap?: number;
  scrapReason?: string | null;
  /** จำนวนที่ถืออยู่ตามที่เห็นบนจอ — บังคับ (L4: กดซ้ำ → DB ตอบ stage_changed · ไม่ส่ง = ไม่เรียก DB) */
  qtyHold: number | string;
  /** H2 (มติ 19 ต.ค. ทองชั่งตอนแบ่ง): น้ำหนักส่วนที่แยกออก (กรัม) — บังคับเมื่อทอง + ขั้นตั้งชั่ง (DB ตอบ weight_move_required) · เงิน/ขั้นไม่ชั่ง = ห้ามส่ง */
  weightMoveG?: number | string | null;
}
export interface SplitLotResult {
  lotJobId: string;
  lotSeq: number;
  label: string;
  qty: number;
  parentRemaining: number;
}

/** ออฟฟิศแยกส่วนแทน (ส่งต่อ n จาก N) — ไม่ชั่งน้ำหนัก (มติ ค1) · ผู้ถือเดิมเหลือ ≥ 1 ชิ้น */
export async function splitJobLot(i: SplitLotInput): Promise<JobResult<SplitLotResult>> {
  const g = await guard();
  if (g) return g;
  if (typeof i !== "object" || i === null || !isUuid(i.jobId)) return fail("ไม่พบใบงาน");
  const seq = parseSeq(i.expectedSeq);
  if (!seq.ok) return fail(seq.error);
  const qty = pieces(i.qty, "จำนวนที่แยก");
  if (!qty.ok) return fail(qty.error);
  const scrap = parseCount(i.qtyScrap ?? 0, "จำนวนของเสีย", 100000);
  if (!scrap.ok) return fail(scrap.error);
  const reason = parseScrapReason(i.scrapReason ?? null, scrap.value);
  if (!reason.ok) return fail(reason.error);
  const h = pieces(i.qtyHold, "จำนวนที่ถืออยู่");
  if (!h.ok) return fail("โหลดหน้าใหม่แล้วลองอีกครั้ง (ไม่ทราบจำนวนที่ถืออยู่)");
  let weightMove: number | null = null;
  if (i.weightMoveG != null && i.weightMoveG !== "") {
    const wm = parseWeight(i.weightMoveG, "น้ำหนักส่วนที่แยกออก");
    if (!wm.ok) return fail(wm.error);
    if (wm.value === null || wm.value <= 0) return fail("น้ำหนักส่วนที่แยกออกต้องมากกว่า 0");
    weightMove = wm.value;
  }
  const r = await callOffice<Raw>("job_lot_split", {
    p_job_id: i.jobId, p_expected_seq: seq.value, p_qty: qty.value, p_qty_scrap: scrap.value, p_scrap_reason: reason.value,
    p_qty_hold: h.value,
    ...(weightMove !== null ? { p_weight_move_g: weightMove } : {}),
  });
  if (!r.ok) return r;
  const lotJobId = typeof r.data.lot_job_id === "string" && isUuid(r.data.lot_job_id) ? r.data.lot_job_id : null;
  const lotSeq = num(r.data.lot_seq);
  const q = num(r.data.qty);
  const remaining = num(r.data.parent_remaining);
  if (!lotJobId || lotSeq === null || q === null || remaining === null) return fail("ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง");
  done(i.jobId);
  return { ok: true, data: { lotJobId, lotSeq, label: str(r.data.label) ?? "", qty: q, parentRemaining: remaining } };
}

export interface CancelLotInput {
  lotJobId: string;
  reason: string;
  /** return_to_parent = คืนชิ้นให้ผู้ถือเดิม (ขั้นแม่ต้องยัง received) · scrap = ชิ้นที่ค้างนับเป็นของเสีย (ต้องมีเหตุผลของเสีย) */
  disposition: "return_to_parent" | "scrap";
  scrapReason?: string | null;
  /** M-C: ทอง + ส่วนมีขั้นชั่ง + scrap = บังคับ (DB ตอบ scrap_weight_required) · อย่างอื่นห้ามส่ง (DB ตอบ weight_unexpected) · > 0 ทศนิยมไม่เกิน 3 ตำแหน่ง */
  scrapWeightG?: number | string | null;
  /** L-new-1: คำอธิบายเป็นข้อความ — บังคับเมื่อทองที่เศษชั่งน้อยกว่าน้ำหนักล่าสุดของส่วนเกิน 0.05 g (DB ตอบ gold_note_required) · มี note = ส่งเป็นเหตุผลของเสียแทนรหัส · ใช้กับ scrap เท่านั้น */
  scrapNote?: string | null;
}

export async function cancelJobLot(i: CancelLotInput): Promise<JobResult<{ disposition: string; liveQty: number | null }>> {
  const g = await guard();
  if (g) return g;
  if (typeof i !== "object" || i === null || !isUuid(i.lotJobId)) return fail("ไม่พบส่วนย่อย");
  if (i.disposition !== "return_to_parent" && i.disposition !== "scrap") return fail("เลือกที่ไปของชิ้น: คืนให้ผู้ถือเดิม หรือนับเป็นของเสีย");
  const why = parseText(i.reason, "เหตุผลที่ยกเลิกส่วน", 200, true);
  if (!why.ok) return fail(why.error);
  let scrapReason: string | null = null;
  if (i.disposition === "scrap") {
    const sr = parseScrapReason(i.scrapReason ?? null, 1);
    if (!sr.ok) return fail(sr.error);
    scrapReason = sr.value;
    if (i.scrapNote != null && i.scrapNote !== "") {
      const note = parseLabel(i.scrapNote, "คำอธิบาย", 200, true);
      if (!note.ok) return fail(note.error);
      if (note.value !== null) scrapReason = note.value;
    }
  } else if (i.scrapNote != null && i.scrapNote !== "") {
    return fail("คำอธิบายใช้เฉพาะตอนยกเลิกเป็นของเสีย");
  }
  let scrapWeight: number | null = null;
  if (i.scrapWeightG != null && i.scrapWeightG !== "") {
    if (i.disposition !== "scrap") return fail("น้ำหนักของเสียใช้เฉพาะตอนยกเลิกเป็นของเสีย");
    const sw = parseWeight(i.scrapWeightG, "น้ำหนักของเสีย");
    if (!sw.ok) return fail(sw.error);
    if (sw.value === null || sw.value <= 0) return fail("น้ำหนักของเสียต้องมากกว่า 0");
    scrapWeight = sw.value;
  }
  const r = await callOffice<Raw>("job_lot_cancel", {
    p_lot_job_id: i.lotJobId, p_reason: why.value, p_disposition: i.disposition, p_scrap_reason: scrapReason,
    ...(scrapWeight !== null ? { p_scrap_weight_g: scrapWeight } : {}),
  });
  if (!r.ok) return r;
  revalidatePath("/jobs");
  return { ok: true, data: { disposition: str(r.data.disposition, 20) ?? i.disposition, liveQty: num(r.data.live_qty) } };
}

export interface ResolveDiscrepancyOfficeInput {
  discrepancyId: string;
  kind: "scrap" | "lost";
  /** รหัสเหตุผลของเสีย (porosity/broken/wrong_design/missing/other) */
  reason: string;
  /** M-B: คำอธิบายเป็นข้อความ — บังคับเมื่อทองที่น้ำหนักหายเกินสัดส่วนชิ้นที่ขาด (excess < −0.05 g · DB ตอบ note_required) · มี note = ส่งเป็นเหตุผลแทนรหัส */
  note?: string | null;
}

/** ออฟฟิศชี้แจงส่วนต่างแทนผู้ส่ง (เสียหาย/หาย + เหตุผล) — ครั้งเดียว แก้ไม่ได้ (ผิด → void) */
export async function resolveDiscrepancyOffice(i: ResolveDiscrepancyOfficeInput): Promise<JobResult<{ qty: number | null }>> {
  const g = await guard();
  if (g) return g;
  if (typeof i !== "object" || i === null || !isUuid(i.discrepancyId)) return fail("ไม่พบส่วนต่างนี้");
  if (i.kind !== "scrap" && i.kind !== "lost") return fail("เลือกว่าเสียหายหรือหาย");
  const reason = parseScrapReason(i.reason, 1);
  if (!reason.ok || reason.value === null) return fail("เลือกเหตุผล");
  let sentReason: string = reason.value;
  if (i.note != null && i.note !== "") {
    const note = parseLabel(i.note, "คำอธิบาย", 200, true);
    if (!note.ok) return fail(note.error);
    if (note.value !== null) sentReason = note.value;
  }
  const r = await callOffice<Raw>("job_discrepancy_resolve", { p_discrepancy_id: i.discrepancyId, p_kind: i.kind, p_reason: sentReason });
  if (!r.ok) return r;
  revalidatePath("/jobs");
  return { ok: true, data: { qty: num(r.data.qty) } };
}

/** ออฟฟิศ void ส่วนต่าง (ของไม่ได้หายจริง/บันทึกผิด) — ต้องย้อนขั้นผู้รับเป็นยังไม่รับก่อน (DB ตอบ stage_not_pending) แล้วผู้รับรับใหม่เต็มจำนวน */
export async function voidDiscrepancy(discrepancyId: string, reason: string): Promise<JobResult<{ qty: number | null }>> {
  const g = await guard();
  if (g) return g;
  if (!isUuid(discrepancyId)) return fail("ไม่พบส่วนต่างนี้");
  const why = parseText(reason, "เหตุผลที่ยกเลิกส่วนต่าง", 200, true);
  if (!why.ok) return fail(why.error);
  const r = await callOffice<Raw>("job_discrepancy_void", { p_discrepancy_id: discrepancyId, p_reason: why.value });
  if (!r.ok) return r;
  revalidatePath("/jobs");
  return { ok: true, data: { qty: num(r.data.qty) } };
}

export interface JobQrRow {
  printNo: number;
  purpose: "traveler" | "sublot" | "delivery_note";
  lotJobId: string | null;
  /** "JB-0020 · ส่วนที่ 2" — เฉพาะ QR ที่ชี้ส่วน */
  label: string | null;
  issuedAt: string | null;
  active: boolean;
  revokedAt: string | null;
  revokeReason: string | null;
}

/** รายการ QR ของใบแม่ (ไม่มี token/hash) — ใช้หน้า "QR ที่ใช้งานอยู่ + เพิกถอนรายใบ" · ครบ 5 ใบ UI ต้องให้เลือกเพิกถอนเอง (ห้ามเพิกถอนเงียบ) */
export async function listJobQr(jobId: string): Promise<JobResult<JobQrRow[]>> {
  const g = await guard();
  if (g) return g;
  if (!isUuid(jobId)) return fail("ไม่พบใบงาน");
  const r = await callOffice<unknown>("job_token_list", { p_job_id: jobId });
  if (!r.ok) return r;
  if (!Array.isArray(r.data)) return fail("ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง");
  const rows: JobQrRow[] = [];
  for (const e of r.data as unknown[]) {
    if (typeof e !== "object" || e === null) continue;
    const o = e as Raw;
    const printNo = num(o.print_no);
    const purpose = o.purpose === "traveler" || o.purpose === "sublot" || o.purpose === "delivery_note" ? o.purpose : null;
    if (printNo === null || purpose === null) continue;
    rows.push({
      printNo,
      purpose,
      lotJobId: typeof o.lot_job_id === "string" && isUuid(o.lot_job_id) ? o.lot_job_id : null,
      label: str(o.label),
      issuedAt: str(o.issued_at, 40),
      active: o.active === true,
      revokedAt: str(o.revoked_at, 40),
      revokeReason: str(o.revoke_reason, 200),
    });
  }
  return { ok: true, data: rows };
}
