"use server";

// lib/actions/job-office.ts — อ่าน + สร้างใบงาน (ฝั่งออฟฟิศ owner/admin) · ระบบใบงาน J1
// ทุก action: guard() บรรทัดแรก · query .eq("shop_id") เองทุกตัว (service client ข้าม RLS) · มี .limit() เสมอ · actor จาก session ฝั่ง server
// 🔴 แหล่งข้อมูลไม่มีราคา/ต้นทุน/ชื่อลูกค้า (v_job_board ฯลฯ ออกแบบไว้แล้ว) — source_ref (เลขใบเสนอราคา/PO) แสดงเฉพาะหน้าออฟฟิศ
// หน้าช่าง (/w/) ห้าม import ไฟล์นี้ — มีเทสต์ module graph (lib/jobs/worker-boundary.test.ts)
// ไฟล์ "use server": export ได้เฉพาะ async function

import { revalidatePath } from "next/cache";
import { effectiveDateBangkok } from "@/lib/tiktok/format";
import { BOARD_COLUMNS, EVENT_COLUMNS, JOB_COLUMNS, STAGE_COLUMNS, WORKER_COLUMNS, mapBoardRow, mapEventRow, mapJobDetail, mapLossRow, mapStageDef, mapStageRow, mapWorkerRow } from "@/lib/jobs/types";
import { visibleBoardStages } from "@/lib/jobs/board";
import { mapRecordProfile } from "@/lib/jobs/profile";
import type { RecordProfile } from "@/lib/jobs/profile";
import type { BoardRow, EventRow, JobDetail, StageDef, StageLoss, StageRow, WorkerRow } from "@/lib/jobs/types";
import { isUuid, parseCount, parseDate, parseLabel, parseStageCodes, parseText, parseWeight, TARGET_PIECE_MAX_G } from "@/lib/jobs/input";
import { callOffice, db, fail, guard, shopId } from "@/lib/jobs/office-server";
import type { JobResult } from "@/lib/jobs/office-server";
import { findLotRoot, loadBoardLots, loadJobLots } from "@/lib/jobs/lots-server";
import { loadBoardIntake } from "@/lib/jobs/intake-server";
import type { JobLotsData } from "@/lib/jobs/lots";
import { HISTORY_COLUMNS, HISTORY_LIMIT, HISTORY_TREE_COLUMNS, applyTreeTotals, mapHistoryRow } from "@/lib/jobs/history";
import type { HistoryRow } from "@/lib/jobs/history";
import { logJobFailure } from "@/lib/jobs/log";
import { GENERIC_JOB_ERROR } from "@/lib/jobs/messages";
import type { JobPhotoRow } from "@/lib/jobs/photos";
import { copyCatalogPhotoToJob, loadJobPhotos } from "@/lib/jobs/photos-server";
import { loadJobGemsSummary } from "@/lib/jobs/gems-server";
import { toWireGemLines } from "@/lib/jobs/gems";
import type { JobGemsSummary } from "@/lib/jobs/gems";

const BOARD_LIMIT = 400;
const EVENT_LIMIT = 150;
const rows = (d: unknown): Record<string, unknown>[] => (Array.isArray(d) ? (d as Record<string, unknown>[]) : []);

// ============================================================================
// อ่าน
// ============================================================================

export interface BoardData {
  todayTh: string;
  rows: BoardRow[];
  stages: StageDef[];
  truncated: boolean;
  workers: Pick<WorkerRow, "id" | "displayName">[];
  /** W1: อ่านสถานะ "จากหน้างาน/รอรับทราบ" ไม่สำเร็จ — tile "รอรับทราบ" ต้องขึ้น "—" ไม่ใช่ 0 (ไม่มี key = อ่านได้/ไม่ต้องอ่าน) */
  intakeFailed?: boolean;
}

/** บอร์ด: ใบงานที่ยังไม่ปิด (open/in_progress/on_hold) + ทะเบียนขั้น (คอลัมน์) + ช่าง (ตัวกรอง) */
export async function getJobBoard(): Promise<JobResult<BoardData>> {
  const g = await guard();
  if (g) return g;
  try {
    const shop = shopId();
    const [board, defs, workers] = await Promise.all([
      // 0181: การ์ดต่อใบแม่ — ส่วนย่อย (parent_job_id ไม่ว่าง) ไม่ขึ้นบอร์ด (ยอดของส่วนรวมอยู่ในบรรทัดของใบแม่)
      db().from("v_job_board").select(BOARD_COLUMNS).eq("shop_id", shop).in("status", ["open", "in_progress", "on_hold"]).is("parent_job_id", null).order("is_overdue", { ascending: false }).order("due_date", { ascending: true, nullsFirst: false }).order("seq", { ascending: true }).limit(BOARD_LIMIT),
      db().from("job_stage_def").select("code, name_th, seq_default, is_active").eq("shop_id", shop).order("seq_default", { ascending: true }).limit(50),
      db().from("worker").select("id, display_name").eq("shop_id", shop).eq("is_active", true).order("display_name", { ascending: true }).limit(50),
    ]);
    if (board.error) throw board.error;
    if (defs.error) throw defs.error;
    if (workers.error) throw workers.error;
    let mapped = rows(board.data).map(mapBoardRow).filter((r): r is BoardRow => r !== null);
    // 0181: ใบที่แยกส่วนแล้ว/มีส่วนต่างรอชี้แจง → บรรทัด "เสร็จ x/N · …" จาก v_job_tree_summary (อ่านไม่ได้ = บอร์ดแสดงแบบเดิม ไม่พังทั้งหน้า)
    const split = mapped.filter((r) => (r.partsCount ?? 0) > 1 || (r.qtyPendingExplanation ?? 0) > 0).map((r) => r.id);
    if (split.length > 0) {
      const lots = await loadBoardLots(split);
      mapped = mapped.map((r) => {
        const l = lots.get(r.id);
        return l ? { ...r, lotsLine: l.line, lotsSumOk: l.sumOk } : r;
      });
    }
    // W1 (0187): ใบงานที่ใบผลิตต้นทางเปิดจากหน้างาน → ป้าย "จากหน้างาน/รอรับทราบ" (อ่านไม่ได้ = บอร์ดแสดงแบบเดิม ไม่พังทั้งหน้า)
    const poRefs = mapped.filter((r) => r.sourceKind === "production" && r.sourceRef).map((r) => r.sourceRef as string);
    let intakeFailed = false;
    if (poRefs.length > 0) {
      const intake = await loadBoardIntake(poRefs);
      intakeFailed = intake.failed;
      if (intake.map.size > 0) mapped = mapped.map((r) => (r.sourceKind === "production" && r.sourceRef && intake.map.has(r.sourceRef) ? { ...r, intake: intake.map.get(r.sourceRef) } : r));
    }
    return {
      ok: true,
      data: {
        todayTh: effectiveDateBangkok(new Date().toISOString()),
        rows: mapped,
        // 0184: ทะเบียนทุกแถว (รวมเลิกใช้) → visibleBoardStages เก็บขั้นเลิกใช้เฉพาะที่ยังมีใบอยู่ (ใบเก่าที่ค้างขั้น polish ต้องไม่ตกคอลัมน์ "ยังไม่เริ่ม")
        stages: visibleBoardStages(rows(defs.data).map(mapStageDef).filter((s): s is StageDef => s !== null), mapped),
        truncated: rows(board.data).length >= BOARD_LIMIT,
        ...(intakeFailed ? { intakeFailed: true } : {}),
        workers: rows(workers.data).flatMap((w) => (typeof w.id === "string" && typeof w.display_name === "string" ? [{ id: w.id, displayName: w.display_name }] : [])),
      },
    };
  } catch (err) {
    logJobFailure("getJobBoard", err);
    return fail("โหลดบอร์ดใบงานไม่สำเร็จ ลองใหม่อีกครั้ง");
  }
}

export interface HistoryData {
  todayTh: string;
  rows: HistoryRow[];
  truncated: boolean;
}

/** รหัสใบแม่ต่อ 1 คำขอสรุปต้นไม้ — IN list ยาวเกินจะทะลุเพดาน URL ของ PostgREST */
const HISTORY_TREE_CHUNK = 100;

/**
 * ประวัติงาน: ใบแม่ที่ปิดแล้ว/ยกเลิก (ล่าสุดก่อน · ไม่เกิน 500) — whitelist คอลัมน์ ไม่มีราคา/ลูกค้า/source_ref
 * ใบแม่ที่แบ่งส่วน/ได้รับเพิ่ม: ดี/เสีย = ของทั้งต้นไม้ (v_job_tree_summary) · อ่านสรุปไม่ได้ = ล้มทั้งคำขอ (ไม่โชว์ยอดครึ่งเดียวเงียบๆ)
 */
export async function getJobHistory(): Promise<JobResult<HistoryData>> {
  const g = await guard();
  if (g) return g;
  try {
    const shop = shopId();
    const res = await db().from("job").select(HISTORY_COLUMNS).eq("shop_id", shop).in("status", ["done", "cancelled"]).is("parent_job_id", null).order("updated_at", { ascending: false }).limit(HISTORY_LIMIT);
    if (res.error) throw res.error;
    const raw = rows(res.data);
    const mapped = raw.map(mapHistoryRow).filter((r): r is HistoryRow => r !== null);
    const doneIds = mapped.filter((r) => r.status === "done").map((r) => r.id);
    const tree = new Map<string, Record<string, unknown>>();
    const chunks: string[][] = [];
    for (let i = 0; i < doneIds.length; i += HISTORY_TREE_CHUNK) chunks.push(doneIds.slice(i, i + HISTORY_TREE_CHUNK));
    const parts = await Promise.all(chunks.map((ids) => db().from("v_job_tree_summary").select(HISTORY_TREE_COLUMNS).eq("shop_id", shop).in("root_job_id", ids).limit(ids.length)));
    for (const p of parts) {
      if (p.error) throw p.error;
      for (const t of rows(p.data)) if (typeof t.root_job_id === "string") tree.set(t.root_job_id, t);
    }
    return {
      ok: true,
      data: {
        todayTh: effectiveDateBangkok(new Date().toISOString()),
        rows: mapped.map((r) => applyTreeTotals(r, tree.get(r.id))),
        truncated: raw.length >= HISTORY_LIMIT,
      },
    };
  } catch (err) {
    logJobFailure("getJobHistory", err);
    return fail("โหลดประวัติงานไม่สำเร็จ ลองใหม่อีกครั้ง");
  }
}

export interface JobDetailData {
  job: JobDetail;
  /** แถวบอร์ด — ธง ค้าง/เลยกำหนด/ยังไม่มีมัดจำ/ไม่ตรงใบเสนอราคา/เลขอ้างอิง (เฉพาะหน้าออฟฟิศ) */
  board: BoardRow | null;
  stages: StageRow[];
  loss: Record<string, StageLoss>;
  events: EventRow[];
  eventsTruncated: boolean;
  activeTokens: number;
  workers: Pick<WorkerRow, "id" | "displayName" | "stageCodes">[];
  /** ลิงก์ไปใบเสนอราคา/ใบผลิตต้นทาง (id เท่านั้น) */
  source: { kind: "oem" | "production"; id: string } | null;
  todayTh: string;
  /** 0181: ต้นไม้ส่วนย่อยของใบแม่ (ส่วน · ยอดรวม · ส่วนต่าง) — null/ไม่มี = อ่านไม่ได้ → หน้าใบงานแบบเดิม · ใบเดี่ยวที่ไม่เคยแยกมี parts 1 แถว (แผงส่วนย่อยไม่แสดง) */
  lots?: JobLotsData | null;
  /** 0181: ถ้าใบนี้เป็นส่วนย่อย = id ใบแม่ (หน้า /jobs/[id] redirect ไปใบแม่) · ไม่ใช่ส่วนย่อย = null/ไม่มี */
  partOf?: string | null;
  /**
   * 0182: รูปอ้างอิง active ของใบ (รูปหลักก่อน · signed URL 15 นาที — ไม่มี path/ที่มา/ผู้อัปโหลด) · [] = ใบไม่มีรูป (การ์ดว่าง) ·
   * undefined = อ่านรูปไม่ได้ (ไม่ใช่ "ไม่มีรูป" — UI แสดงสถานะผิดพลาด + ปุ่มโหลดใหม่ แต่หน้าใบงานทั้งหน้ายังเปิดได้)
   */
  photos?: JobPhotoRow[];
  /**
   * 0190 G1a: พลอยของใบแม่ (ฉลาก snapshot · จำนวน · ตำแหน่ง · state) — ไม่มีราคา/เผื่อแตก ·
   * null = อ่านไม่ได้ (ไม่ใช่ "ไม่มีพลอย" — จอแสดงสถานะผิดพลาด หน้าใบงานยังเปิดได้) · ไม่มี key = ส่วนย่อย (พลอยอยู่ที่ใบแม่)
   */
  gems?: JobGemsSummary | null;
}

export async function getJobDetail(jobId: string): Promise<JobResult<JobDetailData | null>> {
  const g = await guard();
  if (g) return g;
  if (!isUuid(jobId)) return { ok: true, data: null };
  try {
    const shop = shopId();
    const jobRes = await db().from("job").select(JOB_COLUMNS).eq("shop_id", shop).eq("id", jobId).maybeSingle();
    if (jobRes.error) throw jobRes.error;
    const job = jobRes.data ? mapJobDetail(jobRes.data as unknown as Record<string, unknown>) : null;
    if (!job) return { ok: true, data: null };

    const [stRes, evRes, boardRes, lossRes, tokRes, wkRes, defRes] = await Promise.all([
      db().from("job_stage").select(STAGE_COLUMNS).eq("shop_id", shop).eq("job_id", jobId).order("seq", { ascending: true }).limit(50),
      db().from("job_event").select(EVENT_COLUMNS).eq("shop_id", shop).eq("job_id", jobId).order("recorded_at", { ascending: false }).limit(EVENT_LIMIT),
      db().from("v_job_board").select(BOARD_COLUMNS).eq("shop_id", shop).eq("id", jobId).maybeSingle(),
      db().from("v_job_stage_loss").select("job_stage_id, loss_g, loss_pct, warn, not_weighed, handoff_gap_g, handoff_gap_partial_g").eq("shop_id", shop).eq("job_id", jobId).limit(50),
      db().from("job_token").select("id", { count: "exact", head: true }).eq("shop_id", shop).eq("job_id", jobId).is("revoked_at", null),
      db().from("worker").select(WORKER_COLUMNS).eq("shop_id", shop).order("display_name", { ascending: true }).limit(60),
      db().from("job_stage_def").select("code, name_th, metal_present").eq("shop_id", shop).limit(50),
    ]);
    for (const r of [stRes, evRes, boardRes, lossRes, tokRes, wkRes, defRes]) if (r.error) throw r.error;

    const names: Record<string, string> = {};
    const metalPresent: Record<string, boolean> = {};
    for (const d of rows(defRes.data)) {
      if (typeof d.code !== "string") continue;
      names[d.code] = typeof d.name_th === "string" ? d.name_th : d.code;
      metalPresent[d.code] = d.metal_present === true;
    }
    const allWorkers = rows(wkRes.data).map((x) => mapWorkerRow(x)).filter((w): w is WorkerRow => w !== null);
    const workerNames = Object.fromEntries(allWorkers.map((w) => [w.id, w.displayName]));
    const stages = rows(stRes.data).map((r) => mapStageRow(r, names, workerNames, metalPresent)).filter((s): s is StageRow => s !== null);
    const stageCodeById = Object.fromEntries(stages.map((s) => [s.id, s.code]));
    const events = rows(evRes.data).map((r) => mapEventRow(r, stageCodeById, workerNames)).filter((e): e is EventRow => e !== null);
    const loss: Record<string, StageLoss> = {};
    for (const l of rows(lossRes.data).map(mapLossRow)) if (l) loss[l.stageId] = l.loss;

    let source: JobDetailData["source"] = null;
    if (job.sourceKind === "oem" && job.oemQuoteItemId) {
      const q = await db().from("oem_quote_item").select("quote_id").eq("shop_id", shop).eq("id", job.oemQuoteItemId).maybeSingle();
      const id = (q.data as { quote_id?: unknown } | null)?.quote_id;
      if (typeof id === "string") source = { kind: "oem", id };
    } else if (job.sourceKind === "production" && job.productionOrderItemId) {
      const p = await db().from("production_order_item").select("production_order_id").eq("shop_id", shop).eq("id", job.productionOrderItemId).maybeSingle();
      const id = (p.data as { production_order_id?: unknown } | null)?.production_order_id;
      if (typeof id === "string") source = { kind: "production", id };
    }

    const lots = await loadJobLots(jobId, names);
    // 0181: ใบนี้เป็น "ส่วนย่อย" (ไม่ใช่ใบแม่) → บอกใบแม่ให้หน้าเด้งไปที่ใบแม่ (anchor ที่ส่วนนั้น) — ถามเฉพาะเมื่อไม่มีต้นไม้ของใบนี้
    const partOf = lots === null ? await findLotRoot(jobId) : null;
    // 0182: รูปอ้างอิง (เฉพาะใบแม่ — ส่วนย่อยใช้รูปแม่) · อ่าน/เซ็นไม่ได้ไม่ล้มทั้งหน้า
    let photos: JobPhotoRow[] | undefined = [];
    if (!partOf) {
      try {
        photos = await loadJobPhotos(jobId);
      } catch (err) {
        logJobFailure("getJobDetail.photos", err);
        photos = undefined;
      }
    }

    // 0190: พลอยของใบแม่ (ส่วนย่อยไม่มี) · อ่านไม่ได้ไม่ล้มทั้งหน้า
    let gems: JobGemsSummary | null | undefined;
    if (!partOf) {
      try {
        gems = await loadJobGemsSummary(job.id, job.qtyPlanned, stages.map((s) => ({ code: s.code, status: s.status })));
      } catch (err) {
        logJobFailure("getJobDetail.gems", err);
        gems = null;
      }
    }

    return {
      ok: true,
      data: {
        job,
        lots,
        partOf,
        photos,
        ...(gems === undefined ? {} : { gems }),
        board: boardRes.data ? mapBoardRow(boardRes.data as unknown as Record<string, unknown>) : null,
        stages,
        loss,
        events,
        eventsTruncated: rows(evRes.data).length >= EVENT_LIMIT,
        activeTokens: tokRes.count ?? 0,
        workers: allWorkers.filter((w) => w.isActive).map((w) => ({ id: w.id, displayName: w.displayName, stageCodes: w.stageCodes })),
        source,
        todayTh: effectiveDateBangkok(new Date().toISOString()),
      },
    };
  } catch (err) {
    logJobFailure("getJobDetail", err);
    return fail("โหลดใบงานไม่สำเร็จ ลองใหม่อีกครั้ง");
  }
}

export interface SourceJob {
  itemId: string;
  jobId: string;
  jobNo: string;
  status: string;
}

/** ใบงานที่ผูกกับรายการต้นทาง (ที่ยังไม่ยกเลิก) — ให้ปุ่ม "สร้างใบงาน" บนหน้าใบเสนอราคา/ใบผลิตรู้ว่ารายการไหนมีใบงานแล้ว */
export async function getJobsForSourceItems(kind: string, itemIds: string[]): Promise<JobResult<SourceJob[]>> {
  const g = await guard();
  if (g) return g;
  if ((kind !== "oem" && kind !== "production") || !Array.isArray(itemIds) || itemIds.length > 100 || !itemIds.every(isUuid)) return fail("ข้อมูลไม่ถูกต้อง");
  if (itemIds.length === 0) return { ok: true, data: [] };
  try {
    const col = kind === "oem" ? "oem_quote_item_id" : "production_order_item_id";
    // 0181: ใบแม่เท่านั้น — ส่วนย่อยคัดลอก source จากแม่ (ชี้รายการเดียวกัน) ถ้าไม่กรองจะหยิบส่วนย่อยมาเป็น "ใบงานของรายการ" + limit(100) ตัดใบแม่ทิ้ง
    const { data, error } = await db().from("job").select(`id, job_no, status, ${col}`).eq("shop_id", shopId()).is("parent_job_id", null).neq("status", "cancelled").in(col, itemIds).limit(100);
    if (error) throw error;
    const out: SourceJob[] = [];
    for (const r of rows(data)) {
      const itemId = r[col];
      if (typeof r.id === "string" && typeof r.job_no === "string" && typeof itemId === "string") out.push({ itemId, jobId: r.id, jobNo: r.job_no, status: typeof r.status === "string" ? r.status : "open" });
    }
    return { ok: true, data: out };
  } catch (err) {
    logJobFailure("getJobsForSourceItems", err);
    return fail(GENERIC_JOB_ERROR);
  }
}

// ============================================================================
// สร้างใบงาน (dialog: ข้อเสนอขั้นตอนจาก job_stage_suggest → ติ๊ก → สร้าง)
// ============================================================================

export interface SuggestStage {
  code: string;
  nameTh: string;
  defaultSelected: boolean;
  /** 0176: โลหะอยู่ในมือที่ขั้นนี้ (ชั่งได้) */
  metalPresent: boolean;
}
export interface JobSuggestion {
  metal: string;
  qty: number;
  designLabel: string;
  depositMissing: boolean;
  existingJob: { id: string; jobNo: string } | null;
  stages: SuggestStage[];
  /** 0175: น้ำหนักเป้าหมายต่อชิ้นจากต้นทาง (ใบเสนอราคา/สินค้า) + ที่มา · null = ไม่มีข้อมูล (ไม่เดา) */
  targetPieceG: number | null;
  targetPieceGSource: "quote" | "product" | "input" | null;
  /** 0176: แบบการบันทึกที่ใช้งานอยู่ + ค่าเริ่มที่ server resolve ตามโลหะแล้ว (null = ร้านไม่มีค่าเริ่ม → ฟอร์มต้องบล็อก ไม่เดา) */
  profiles: RecordProfile[];
  defaultProfileId: string | null;
}

export async function suggestJob(kind: string, itemId: string): Promise<JobResult<JobSuggestion>> {
  const g = await guard();
  if (g) return g;
  if ((kind !== "oem" && kind !== "production") || !isUuid(itemId)) return fail("ข้อมูลไม่ถูกต้อง");
  const r = await callOffice<Record<string, unknown>>("job_stage_suggest", { p_source_kind: kind, p_item_id: itemId }, { noActor: true });
  if (!r.ok) return r;
  const d = r.data;
  const ex = d.existing_job as { id?: unknown; job_no?: unknown } | null;
  const stages: SuggestStage[] = (Array.isArray(d.stages) ? d.stages : []).flatMap((s: unknown) => {
    const o = s as Record<string, unknown>;
    return typeof o.code === "string" && typeof o.name_th === "string" ? [{ code: o.code, nameTh: o.name_th, defaultSelected: o.default_selected === true, metalPresent: o.metal_present === true }] : [];
  });
  const profiles = (Array.isArray(d.profiles) ? d.profiles : []).map(mapRecordProfile).filter((p): p is RecordProfile => p !== null);
  return {
    ok: true,
    data: {
      metal: typeof d.metal === "string" ? d.metal : "silver",
      qty: typeof d.qty === "number" ? d.qty : 0,
      designLabel: typeof d.design_label === "string" ? d.design_label : "",
      depositMissing: d.deposit_missing === true,
      existingJob: ex && typeof ex.id === "string" && typeof ex.job_no === "string" ? { id: ex.id, jobNo: ex.job_no } : null,
      stages,
      targetPieceG: typeof d.target_piece_g === "number" ? d.target_piece_g : null,
      targetPieceGSource: d.target_piece_g_source === "quote" || d.target_piece_g_source === "product" || d.target_piece_g_source === "input" ? d.target_piece_g_source : null,
      profiles,
      // ค่าเริ่มต้องเป็นแบบที่ active อยู่ในรายการจริง — ไม่งั้นถือว่าไม่มี (ไม่เดา)
      defaultProfileId: typeof d.default_profile_id === "string" && profiles.some((p) => p.id === d.default_profile_id) ? d.default_profile_id : null,
    },
  };
}

// 0175: ค่าแนะนำจำนวนเผื่อ + แผนโลหะ — ทุกตัวเลขมาจาก DB (job_plan_suggest) ฟอร์มแค่แสดง
export interface JobPlanSuggestion {
  qtyOrder: number;
  qtyPlannedSuggest: number | null;
  bufferQty: number | null;
  qtyPlannedEff: number;
  underPlanned: boolean;
  rejectBasis: { castPct: number | null; polishPct: number | null; platePct: number | null; hasPlating: boolean };
  targetPieceG: number | null;
  targetPieceGSource: "quote" | "product" | "input" | null;
  /** null = DB ไม่ตอบ (ไม่เดาเป็นเงิน) — หน้าจอใช้ metal จาก suggestJob/ใบงาน ไม่ใช้ตัวนี้ */
  metal: string | null;
  metalPlanG: number | null;
  /** basis ที่ DB คำนวณ (target_piece_g · qty_planned · sprue_loss_pct · formula · computed_g · override_g · missing[]) */
  metalPlanBasis: Record<string, unknown> | null;
  missing: string[];
}

const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export interface PlanSuggestInput {
  qtyPlanned?: number | null;
  targetPieceG?: string | number | null;
  stageCodes?: string[] | null;
}

export async function getJobPlanSuggest(kind: string, itemId: string, input: PlanSuggestInput = {}): Promise<JobResult<JobPlanSuggestion>> {
  const g = await guard();
  if (g) return g;
  if ((kind !== "oem" && kind !== "production") || !isUuid(itemId)) return fail("ข้อมูลไม่ถูกต้อง");
  const args: Record<string, unknown> = { p_source_kind: kind, p_item_id: itemId };
  if (input.qtyPlanned !== null && input.qtyPlanned !== undefined) {
    const q = parseCount(input.qtyPlanned, "จำนวนเริ่มผลิต");
    if (!q.ok) return fail(q.error);
    if (q.value < 1) return fail("จำนวนเริ่มผลิตต้องไม่น้อยกว่า 1");
    args.p_qty_planned = q.value;
  }
  if (input.targetPieceG !== null && input.targetPieceG !== undefined) {
    const t = parseWeight(input.targetPieceG, "น้ำหนักเป้าหมายต่อชิ้น", { max: TARGET_PIECE_MAX_G });
    if (!t.ok) return fail(t.error);
    if (t.value !== null) args.p_target_piece_g = t.value;
  }
  if (input.stageCodes !== null && input.stageCodes !== undefined) {
    const codes = parseStageCodes(input.stageCodes, true);
    if (!codes.ok) return fail(codes.error);
    args.p_stage_codes = codes.value;
  }
  const r = await callOffice<Record<string, unknown>>("job_plan_suggest", args, { noActor: true });
  if (!r.ok) return r;
  const d = r.data;
  const rb = (d.reject_basis ?? {}) as Record<string, unknown>;
  const src = d.target_piece_g_source;
  const basis = d.metal_plan_basis;
  return {
    ok: true,
    data: {
      qtyOrder: numOrNull(d.qty_order) ?? 0,
      qtyPlannedSuggest: numOrNull(d.qty_planned_suggest),
      bufferQty: numOrNull(d.buffer_qty),
      qtyPlannedEff: numOrNull(d.qty_planned_eff) ?? 0,
      underPlanned: d.under_planned === true,
      rejectBasis: { castPct: numOrNull(rb.cast_pct), polishPct: numOrNull(rb.polish_pct), platePct: numOrNull(rb.plate_pct), hasPlating: rb.has_plating === true },
      targetPieceG: numOrNull(d.target_piece_g),
      targetPieceGSource: src === "quote" || src === "product" || src === "input" ? src : null,
      metal: typeof d.metal === "string" ? d.metal : null,
      metalPlanG: numOrNull(d.metal_plan_g),
      metalPlanBasis: basis !== null && typeof basis === "object" && !Array.isArray(basis) ? (basis as Record<string, unknown>) : null,
      missing: Array.isArray(d.missing) ? d.missing.filter((m): m is string => typeof m === "string") : [],
    },
  };
}

export interface CreateJobInput {
  kind: "oem" | "production";
  itemId: string;
  stageCodes: string[];
  dueDate?: string | null;
  startGateNote?: string | null;
  designLabel?: string | null;
  note?: string | null;
  /** 0175 (ไม่ส่ง = ค่าเริ่มของ DB: qty_planned = จำนวนสั่ง · น้ำหนัก/แผนจากต้นทาง) */
  qtyPlanned?: number | null;
  targetPieceG?: string | number | null;
  metalPlanOverrideG?: string | number | null;
  metalPlanReason?: string | null;
  /** 0176: แบบการบันทึกที่เลือก (ไม่ส่ง = DB ใช้ค่าเริ่มตามโลหะ) */
  profileId?: string | null;
  /**
   * 0190 G1a: พลอยต่อชิ้น — ไม่ส่ง (undefined) = คัดลอกแม่แบบ SKU เมื่อใบมีขั้นฝังพลอย · [] = ระบุว่าไม่มีพลอย · แถว = พลอยที่ระบุ (ชื่อใหม่เข้าแคตตาล็อกในทรานแซกชันเดียวกับใบ · ผิดแถวไหน = ไม่เปิดใบเลย)
   * ผ่าน allowlist เข้มก่อนถึง DB (key แปลก เช่น price = ปฏิเสธ)
   */
  gemLines?: unknown;
  /** ยืนยันเพิ่มชื่อใหม่ที่ "คล้าย" ชื่อที่มี (ข้ามตัวดัก — ชื่อที่ซ้ำเป๊ะยังถูกใช้ตัวเดิมเสมอ) */
  gemForce?: boolean;
}

export async function createJob(input: CreateJobInput): Promise<JobResult<{ jobId: string; jobNo: string; planMissing: string[] }>> {
  const g = await guard();
  if (g) return g;
  if (typeof input !== "object" || input === null || (input.kind !== "oem" && input.kind !== "production") || !isUuid(input.itemId)) return fail("ข้อมูลไม่ถูกต้อง");
  const codes = parseStageCodes(input.stageCodes, false);
  if (!codes.ok) return fail(codes.error);
  let due: string | null = null;
  if (input.dueDate) {
    const d = parseDate(input.dueDate, "กำหนดส่ง");
    if (!d.ok) return fail(d.error);
    due = d.value;
  }
  const label = parseLabel(input.designLabel, "ชื่อเรียกใบงาน", 200, false);
  if (!label.ok) return fail(label.error);
  const note = parseText(input.note, "หมายเหตุ", 500, false);
  if (!note.ok) return fail(note.error);
  const gate = parseText(input.startGateNote, "เหตุผลที่เริ่มผลิตก่อนมัดจำ", 500, false);
  if (!gate.ok) return fail(gate.error);
  // M1: arg ใหม่ใส่เฉพาะเมื่อมีค่า (ไม่ส่ง = default ของ DB)
  const planArgs: Record<string, unknown> = {};
  if (input.qtyPlanned !== null && input.qtyPlanned !== undefined) {
    const q = parseCount(input.qtyPlanned, "จำนวนเริ่มผลิต");
    if (!q.ok) return fail(q.error);
    if (q.value < 1) return fail("จำนวนเริ่มผลิตต้องไม่น้อยกว่า 1");
    planArgs.p_qty_planned = q.value;
  }
  if (input.targetPieceG !== null && input.targetPieceG !== undefined) {
    const t = parseWeight(input.targetPieceG, "น้ำหนักเป้าหมายต่อชิ้น", { max: TARGET_PIECE_MAX_G });
    if (!t.ok) return fail(t.error);
    if (t.value !== null) planArgs.p_target_piece_g = t.value;
  }
  if (input.metalPlanOverrideG !== null && input.metalPlanOverrideG !== undefined) {
    const o = parseWeight(input.metalPlanOverrideG, "โลหะที่กำหนดเอง");
    if (!o.ok) return fail(o.error);
    if (o.value !== null) planArgs.p_metal_plan_override_g = o.value;
  }
  // กำหนดโลหะเอง (override) ต้องมีเหตุผลเสมอ — เหมือน setJobPlan (ไม่รอให้ DB ตีกลับ)
  const planWhy = parseText(input.metalPlanReason, "เหตุผลที่กำหนดน้ำหนักโลหะเอง", 200, planArgs.p_metal_plan_override_g !== undefined);
  if (!planWhy.ok) return fail(planWhy.error);
  if (planWhy.value !== null) planArgs.p_metal_plan_reason = planWhy.value;

  if (input.profileId !== null && input.profileId !== undefined) {
    if (!isUuid(input.profileId)) return fail("แบบที่เลือกถูกปิดใช้หรือแก้ไปแล้ว — เลือกใหม่");
    planArgs.p_profile_id = input.profileId;
  }

  // 0190: พลอย — ใส่ arg เฉพาะเมื่อมีค่า (ไม่ส่ง = DB คัดลอกแม่แบบถ้ามีขั้นฝัง)
  if (input.gemLines !== undefined) {
    const w = toWireGemLines(input.gemLines);
    if (!w.ok) return { ok: false, error: w.error, code: w.code, gem: { code: w.code, ...(w.row !== null ? { row: w.row } : {}), ...(w.field !== null && /^[a-z][a-z_]{0,30}$/.test(w.field) ? { field: w.field } : {}) } };
    planArgs.p_gem_lines = w.value;
  }
  if (input.gemForce === true) planArgs.p_gem_force = true;

  const r =
    input.kind === "oem"
      ? await callOffice<Record<string, unknown>>("job_create_from_quote_item", { p_quote_item_id: input.itemId, p_stage_codes: codes.value, p_due_date: due, p_start_gate_note: gate.value, p_design_label: label.value, p_note: note.value, ...planArgs })
      : await callOffice<Record<string, unknown>>("job_create_from_production_item", { p_production_order_item_id: input.itemId, p_stage_codes: codes.value, p_due_date: due, p_design_label: label.value, p_note: note.value, ...planArgs });
  if (!r.ok) return r;
  const id = r.data.job_id ?? r.data.id;
  const no = r.data.job_no;
  if (typeof id !== "string" || !isUuid(id) || typeof no !== "string") return fail(GENERIC_JOB_ERROR);
  // 0182: รูปหลักของ SKU (ถ้ามี) = รูปหลักของใบอัตโนมัติ (copy เข้า bucket ใบงาน) — ไม่บล็อกการสร้างใบ: ไม่มี SKU/ไม่มีรูป/ล้มกลางทาง = ใบเกิดปกติ (ปุ่ม "ดึงรูปจากแคตตาล็อก" ทำซ้ำได้)
  try {
    await copyCatalogPhotoToJob(id);
  } catch (err) {
    logJobFailure("createJob.photo", err);
  }
  revalidatePath("/jobs");
  revalidatePath(input.kind === "oem" ? "/oem/quotes" : "/production");
  // plan_missing[] (0175): แผนโลหะที่ DB คำนวณให้ไม่ได้ (เช่น ไม่มีอัตราก้านต้น) — ฟอร์มใช้ต่อท้าย toast
  const planMissing = Array.isArray(r.data.plan_missing) ? r.data.plan_missing.filter((m): m is string => typeof m === "string") : [];
  return { ok: true, data: { jobId: id, jobNo: no, planMissing } };
}
