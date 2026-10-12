"use server";

// lib/actions/job-office.ts — อ่าน + สร้างใบงาน (ฝั่งออฟฟิศ owner/admin) · ระบบใบงาน J1
// ทุก action: guard() บรรทัดแรก · query .eq("shop_id") เองทุกตัว (service client ข้าม RLS) · มี .limit() เสมอ · actor จาก session ฝั่ง server
// 🔴 แหล่งข้อมูลไม่มีราคา/ต้นทุน/ชื่อลูกค้า (v_job_board ฯลฯ ออกแบบไว้แล้ว) — source_ref (เลขใบเสนอราคา/PO) แสดงเฉพาะหน้าออฟฟิศ
// หน้าช่าง (/w/) ห้าม import ไฟล์นี้ — มีเทสต์ module graph (lib/jobs/worker-boundary.test.ts)
// ไฟล์ "use server": export ได้เฉพาะ async function

import { revalidatePath } from "next/cache";
import { effectiveDateBangkok } from "@/lib/tiktok/format";
import { BOARD_COLUMNS, EVENT_COLUMNS, JOB_COLUMNS, STAGE_COLUMNS, WORKER_COLUMNS, mapBoardRow, mapEventRow, mapJobDetail, mapLossRow, mapStageDef, mapStageRow, mapWorkerRow } from "@/lib/jobs/types";
import type { BoardRow, EventRow, JobDetail, StageDef, StageLoss, StageRow, WorkerRow } from "@/lib/jobs/types";
import { isUuid, parseDate, parseStageCodes, parseText } from "@/lib/jobs/input";
import { callOffice, db, fail, guard, shopId } from "@/lib/jobs/office-server";
import type { JobResult } from "@/lib/jobs/office-server";
import { logJobFailure } from "@/lib/jobs/log";
import { GENERIC_JOB_ERROR } from "@/lib/jobs/messages";

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
}

/** บอร์ด: ใบงานที่ยังไม่ปิด (open/in_progress/on_hold) + ทะเบียนขั้น (คอลัมน์) + ช่าง (ตัวกรอง) */
export async function getJobBoard(): Promise<JobResult<BoardData>> {
  const g = await guard();
  if (g) return g;
  try {
    const shop = shopId();
    const [board, defs, workers] = await Promise.all([
      db().from("v_job_board").select(BOARD_COLUMNS).eq("shop_id", shop).in("status", ["open", "in_progress", "on_hold"]).order("is_overdue", { ascending: false }).order("due_date", { ascending: true, nullsFirst: false }).order("seq", { ascending: true }).limit(BOARD_LIMIT),
      db().from("job_stage_def").select("code, name_th, seq_default").eq("shop_id", shop).eq("is_active", true).order("seq_default", { ascending: true }).limit(50),
      db().from("worker").select("id, display_name").eq("shop_id", shop).eq("is_active", true).order("display_name", { ascending: true }).limit(50),
    ]);
    if (board.error) throw board.error;
    if (defs.error) throw defs.error;
    if (workers.error) throw workers.error;
    const mapped = rows(board.data).map(mapBoardRow).filter((r): r is BoardRow => r !== null);
    return {
      ok: true,
      data: {
        todayTh: effectiveDateBangkok(new Date().toISOString()),
        rows: mapped,
        stages: rows(defs.data).map(mapStageDef).filter((s): s is StageDef => s !== null),
        truncated: rows(board.data).length >= BOARD_LIMIT,
        workers: rows(workers.data).flatMap((w) => (typeof w.id === "string" && typeof w.display_name === "string" ? [{ id: w.id, displayName: w.display_name }] : [])),
      },
    };
  } catch (err) {
    logJobFailure("getJobBoard", err);
    return fail("โหลดบอร์ดใบงานไม่สำเร็จ ลองใหม่อีกครั้ง");
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
      db().from("v_job_stage_loss").select("job_stage_id, loss_g, loss_pct, warn, not_weighed, handoff_gap_g").eq("shop_id", shop).eq("job_id", jobId).limit(50),
      db().from("job_token").select("id", { count: "exact", head: true }).eq("shop_id", shop).eq("job_id", jobId).is("revoked_at", null),
      db().from("worker").select(WORKER_COLUMNS).eq("shop_id", shop).order("display_name", { ascending: true }).limit(60),
      db().from("job_stage_def").select("code, name_th").eq("shop_id", shop).limit(50),
    ]);
    for (const r of [stRes, evRes, boardRes, lossRes, tokRes, wkRes, defRes]) if (r.error) throw r.error;

    const names: Record<string, string> = {};
    for (const d of rows(defRes.data)) if (typeof d.code === "string") names[d.code] = typeof d.name_th === "string" ? d.name_th : d.code;
    const allWorkers = rows(wkRes.data).map(mapWorkerRow).filter((w): w is WorkerRow => w !== null);
    const workerNames = Object.fromEntries(allWorkers.map((w) => [w.id, w.displayName]));
    const stages = rows(stRes.data).map((r) => mapStageRow(r, names, workerNames)).filter((s): s is StageRow => s !== null);
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

    return {
      ok: true,
      data: {
        job,
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
    const { data, error } = await db().from("job").select(`id, job_no, status, ${col}`).eq("shop_id", shopId()).neq("status", "cancelled").in(col, itemIds).limit(100);
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
}
export interface JobSuggestion {
  metal: string;
  qty: number;
  designLabel: string;
  depositMissing: boolean;
  existingJob: { id: string; jobNo: string } | null;
  stages: SuggestStage[];
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
    return typeof o.code === "string" && typeof o.name_th === "string" ? [{ code: o.code, nameTh: o.name_th, defaultSelected: o.default_selected === true }] : [];
  });
  return {
    ok: true,
    data: {
      metal: typeof d.metal === "string" ? d.metal : "silver",
      qty: typeof d.qty === "number" ? d.qty : 0,
      designLabel: typeof d.design_label === "string" ? d.design_label : "",
      depositMissing: d.deposit_missing === true,
      existingJob: ex && typeof ex.id === "string" && typeof ex.job_no === "string" ? { id: ex.id, jobNo: ex.job_no } : null,
      stages,
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
}

export async function createJob(input: CreateJobInput): Promise<JobResult<{ jobId: string; jobNo: string }>> {
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
  const label = parseText(input.designLabel, "ชื่อแบบ", 200, false);
  if (!label.ok) return fail(label.error);
  const note = parseText(input.note, "หมายเหตุ", 500, false);
  if (!note.ok) return fail(note.error);
  const gate = parseText(input.startGateNote, "เหตุผลที่เริ่มผลิตก่อนมัดจำ", 500, false);
  if (!gate.ok) return fail(gate.error);

  const r =
    input.kind === "oem"
      ? await callOffice<Record<string, unknown>>("job_create_from_quote_item", { p_quote_item_id: input.itemId, p_stage_codes: codes.value, p_due_date: due, p_start_gate_note: gate.value, p_design_label: label.value, p_note: note.value })
      : await callOffice<Record<string, unknown>>("job_create_from_production_item", { p_production_order_item_id: input.itemId, p_stage_codes: codes.value, p_due_date: due, p_design_label: label.value, p_note: note.value });
  if (!r.ok) return r;
  const id = r.data.job_id ?? r.data.id;
  const no = r.data.job_no;
  if (typeof id !== "string" || !isUuid(id) || typeof no !== "string") return fail(GENERIC_JOB_ERROR);
  revalidatePath("/jobs");
  revalidatePath(input.kind === "oem" ? "/oem/quotes" : "/production");
  return { ok: true, data: { jobId: id, jobNo: no } };
}
