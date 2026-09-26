"use server";

// lib/actions/calendar.ts — M2 of the Content Calendar phase (docs/3j-jewelry/
// marketing/phase-content-calendar-design.md §3 write RPCs, §4 read path, §8
// build order). Backed by supabase/migrations/0057_content_calendar.sql,
// APPLIED to the live DB — every RPC/view/column name below is real, not a
// draft.
//
// New file (not appended to lib/actions/marketing.ts, already 800+ lines per
// the design note) but same pattern throughout: getServiceClient() (service
// role — bypasses RLS) + requireOwnerAdmin() as the only real write gate
// today (see marketing.ts's SHOP SCOPING NOTE / crm.ts's B2a header for the
// full explanation of that gap) + ActionResult<T> + Thai error strings +
// console.error on every catch.

import { revalidatePath } from "next/cache";
import { getServiceClient } from "@/lib/supabase/server";
import { getDevShopId } from "@/lib/dev/context";
import { getEffectiveRole } from "@/lib/auth/role";
import type { ActionResult } from "@/lib/types";
import type { CampaignBoardStep } from "@/lib/marketing/campaign-types";
import { CAMPAIGN_BOARD_SELECT, mapCampaignBoardRow } from "@/lib/marketing/campaign-board-mapper";
import { isValidClipBrief, type ClipBrief } from "@/lib/marketing/clip-brief";
import { mapCalendarRpcError } from "@/lib/marketing/calendar-errors";

const SCHEMA = "analytics";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function isValidDateStr(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime());
}

// 24-hour "HH:MM" only — matches the <input type="time"> the forms use and
// what campaign_create_task/campaign_reschedule_step's `time` params accept
// unquestioned (no seconds, no AM/PM).
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
function isValidTimeStr(s: string): boolean {
  return TIME_RE.test(s);
}

// Not exported from marketing.ts (module-private there) — same gate, copied
// rather than imported so this file has no dependency on that one.
async function requireOwnerAdmin(): Promise<ActionResult<never> | null> {
  if ((await getEffectiveRole()) === "staff") {
    return { ok: false, error: "เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ใช้งานส่วนการตลาดได้" };
  }
  return null;
}

// ============================================================================
// Read — analytics.v_campaign_board (design §4)
// ============================================================================

export interface CampaignTemplateRow {
  code: string;
  nameTh: string;
  ruleCode: string | null;
  anchorSemantics: "event_date" | "start_date";
}

/** Agenda/date-strip/month-overlay all read this — whole month in one call,
 * grouped per-day client-side (design §4: "ไม่ต้องมี view นับวัน"). */
export async function getCalendarTasks(from: string, to: string): Promise<ActionResult<CampaignBoardStep[]>> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;

  if (!isValidDateStr(from) || !isValidDateStr(to)) {
    return { ok: false, error: "รูปแบบวันที่ไม่ถูกต้อง" };
  }

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data, error } = await supabase
      .schema(SCHEMA)
      .from("v_campaign_board")
      .select(CAMPAIGN_BOARD_SELECT)
      .eq("shop_id", shopId)
      .gte("resolved_start", from)
      .lte("resolved_start", to)
      .order("resolved_start", { ascending: true });
    if (error) throw error;

    const rows: CampaignBoardStep[] = ((data ?? []) as Record<string, unknown>[]).map(mapCampaignBoardRow);
    return { ok: true, data: rows };
  } catch (err) {
    console.error("getCalendarTasks failed", err);
    return { ok: false, error: "โหลดปฏิทินไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

/** `/marketing/calendar/[stepId]` — full detail in one row (artifacts incl.
 * content_body + clip_brief + provenance, gates). Not found -> data: null,
 * the page 404s on that. */
export async function getCalendarTask(stepId: string): Promise<ActionResult<CampaignBoardStep | null>> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;

  if (!stepId) return { ok: false, error: "ไม่พบรหัสงาน" };

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data, error } = await supabase
      .schema(SCHEMA)
      .from("v_campaign_board")
      .select(CAMPAIGN_BOARD_SELECT)
      .eq("shop_id", shopId)
      .eq("step_id", stepId)
      .maybeSingle();
    if (error) throw error;

    return { ok: true, data: data ? mapCampaignBoardRow(data as Record<string, unknown>) : null };
  } catch (err) {
    console.error("getCalendarTask failed", err);
    return { ok: false, error: "โหลดรายละเอียดงานไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

/** Ad Copilot (RecoList) maps rule_code -> template to know which reco gets
 * the "เลือกวันเริ่ม" dialog vs. plain "รับทราบ" (design §4/§6). Global
 * reference data — no shop_id filter. */
export async function getCampaignTemplates(): Promise<ActionResult<CampaignTemplateRow[]>> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;

  try {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .schema(SCHEMA)
      .from("campaign_template")
      .select("code, name_th, rule_code, anchor_semantics")
      .eq("is_active", true);
    if (error) throw error;

    const rows: CampaignTemplateRow[] = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      code: String(r.code),
      nameTh: String(r.name_th),
      ruleCode: (r.rule_code as string) ?? null,
      anchorSemantics: r.anchor_semantics as CampaignTemplateRow["anchorSemantics"],
    }));
    return { ok: true, data: rows };
  } catch (err) {
    console.error("getCampaignTemplates failed", err);
    return { ok: false, error: "โหลดรายการแผนสำเร็จรูปไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

// ============================================================================
// Write — thin wrappers around RPCs R1-R8 (design §3). Every one revalidates
// /marketing/calendar; R1's create-from-template also revalidates
// /marketing/copilot (the Ad Copilot board it was approved from).
// ============================================================================

export interface CreateTaskFromRecoInput {
  templateCode: string;
  anchorDate: string;
  recoKey?: string;
  nameOverride?: string;
}

/** R1 — approve a reco (or manually pick a template) into a full plan.
 * Idempotent server-side on (shop_id, source_reco_key): the DB returns the
 * existing campaign id rather than duplicating a five-step plan, so this is
 * safe to retry from the client. */
export async function createTaskFromReco(input: CreateTaskFromRecoInput): Promise<ActionResult<string>> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;

  const templateCode = input.templateCode?.trim();
  if (!templateCode) return { ok: false, error: "กรุณาเลือกแผนสำเร็จรูป" };
  if (!isValidDateStr(input.anchorDate)) {
    return { ok: false, error: "รูปแบบวันที่ไม่ถูกต้อง" };
  }

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data, error } = await supabase.schema(SCHEMA).rpc("campaign_create_from_template", {
      p_shop_id: shopId,
      p_template_code: templateCode,
      p_anchor_date: input.anchorDate,
      p_reco_key: input.recoKey?.trim() || null,
      p_name_override: input.nameOverride?.trim() || null,
    });
    if (error) throw error;

    revalidatePath("/marketing/calendar");
    revalidatePath("/marketing/copilot");
    return { ok: true, data: data as string };
  } catch (err) {
    console.error("createTaskFromReco failed", err);
    return { ok: false, error: mapCalendarRpcError(err, "สร้างแผนจากแม่แบบไม่สำเร็จ ลองใหม่อีกครั้ง") };
  }
}

export interface CreateManualTaskInput {
  title: string;
  date: string;
  artifactType?: string;
  campaignId?: string;
  stepKind?: string;
  /** "HH:MM" 24-hour, or omitted/empty/null for no time ("ทั้งวัน") — optional
   * everywhere, never required (design: TikTok live start time moves day to
   * day, owner types it in when they know it). */
  startTime?: string | null;
}

/** R2 — "เพิ่มแผนเอง". Returns the new step_id. */
export async function createManualTask(input: CreateManualTaskInput): Promise<ActionResult<string>> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;

  const title = input.title?.trim();
  if (!title) return { ok: false, error: "กรุณากรอกชื่องาน" };
  if (!isValidDateStr(input.date)) {
    return { ok: false, error: "รูปแบบวันที่ไม่ถูกต้อง" };
  }
  const startTimeTrimmed = input.startTime?.trim() || "";
  if (startTimeTrimmed && !isValidTimeStr(startTimeTrimmed)) {
    return { ok: false, error: "รูปแบบเวลาไม่ถูกต้อง (ต้องเป็น HH:MM แบบ 24 ชั่วโมง)" };
  }

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data, error } = await supabase.schema(SCHEMA).rpc("campaign_create_task", {
      p_shop_id: shopId,
      p_title: title,
      p_date: input.date,
      p_artifact_type: input.artifactType?.trim() || null,
      p_campaign_id: input.campaignId || null,
      p_step_kind: input.stepKind?.trim() || null,
      p_start_time: startTimeTrimmed || null,
    });
    if (error) throw error;

    revalidatePath("/marketing/calendar");
    return { ok: true, data: data as string };
  } catch (err) {
    console.error("createManualTask failed", err);
    return { ok: false, error: mapCalendarRpcError(err, "เพิ่มงานไม่สำเร็จ ลองใหม่อีกครั้ง") };
  }
}

export interface RescheduleTaskOpts {
  /** "HH:MM" 24-hour to set/change the time, or omitted/undefined to leave
   * the existing start_time untouched. Ignored when clearTime is true. */
  startTime?: string | null;
  /** true = remove the existing start_time (goes back to "ทั้งวัน"). Takes
   * priority over startTime if both are somehow set. */
  clearTime?: boolean;
}

/** R3 — move one step (or the whole content_task if it's a single-step
 * standalone task). `opts` is optional so every existing 2-arg call site
 * keeps compiling unchanged; omitting it leaves start_time exactly as it
 * was (p_new_time null + p_clear_time false is the RPC's "don't touch
 * time" case). */
export async function rescheduleTask(
  stepId: string,
  newDate: string,
  opts?: RescheduleTaskOpts
): Promise<ActionResult> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;

  if (!stepId) return { ok: false, error: "ไม่พบรหัสงาน" };
  if (!isValidDateStr(newDate)) {
    return { ok: false, error: "รูปแบบวันที่ไม่ถูกต้อง" };
  }
  const clearTime = opts?.clearTime ?? false;
  const startTimeTrimmed = clearTime ? "" : opts?.startTime?.trim() || "";
  if (startTimeTrimmed && !isValidTimeStr(startTimeTrimmed)) {
    return { ok: false, error: "รูปแบบเวลาไม่ถูกต้อง (ต้องเป็น HH:MM แบบ 24 ชั่วโมง)" };
  }

  try {
    const supabase = getServiceClient();
    const { error } = await supabase.schema(SCHEMA).rpc("campaign_reschedule_step", {
      p_step_id: stepId,
      p_new_date: newDate,
      p_new_time: startTimeTrimmed || null,
      p_clear_time: clearTime,
    });
    if (error) throw error;

    revalidatePath("/marketing/calendar");
    return { ok: true, data: undefined };
  } catch (err) {
    console.error("rescheduleTask failed", err);
    return { ok: false, error: mapCalendarRpcError(err, "เลื่อนวันไม่สำเร็จ ลองใหม่อีกครั้ง") };
  }
}

export interface SetArtifactContentInput {
  contentBody?: string | null;
  clipBrief?: ClipBrief | null;
}

/** R4 — human edits. Either field left undefined/null leaves that column
 * untouched server-side (design: "ส่ง null = ไม่แตะคอลัมน์นั้น"). */
export async function setArtifactContent(
  artifactId: string,
  input: SetArtifactContentInput
): Promise<ActionResult> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;

  if (!artifactId) return { ok: false, error: "ไม่พบรายการ content" };
  if (input.clipBrief != null && !isValidClipBrief(input.clipBrief)) {
    return { ok: false, error: "รูปแบบ clip brief ไม่ถูกต้อง" };
  }

  try {
    const supabase = getServiceClient();
    const { error } = await supabase.schema(SCHEMA).rpc("campaign_set_artifact_content", {
      p_artifact_id: artifactId,
      p_content_body: input.contentBody ?? null,
      p_clip_brief: input.clipBrief ?? null,
    });
    if (error) throw error;

    revalidatePath("/marketing/calendar");
    return { ok: true, data: undefined };
  } catch (err) {
    console.error("setArtifactContent failed", err);
    return { ok: false, error: mapCalendarRpcError(err, "บันทึกเนื้อหาไม่สำเร็จ ลองใหม่อีกครั้ง") };
  }
}

/** R6 — tick one shot without overwriting the whole clip_brief blob (safe
 * against two quick taps racing each other). */
export async function toggleClipShot(artifactId: string, shotId: string, done: boolean): Promise<ActionResult> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;

  if (!artifactId) return { ok: false, error: "ไม่พบรายการ content" };
  if (!shotId) return { ok: false, error: "ไม่พบช็อตที่จะติ๊ก" };

  try {
    const supabase = getServiceClient();
    const { error } = await supabase.schema(SCHEMA).rpc("campaign_toggle_clip_shot", {
      p_artifact_id: artifactId,
      p_shot_id: shotId,
      p_done: done,
    });
    if (error) throw error;

    revalidatePath("/marketing/calendar");
    return { ok: true, data: undefined };
  } catch (err) {
    console.error("toggleClipShot failed", err);
    return { ok: false, error: mapCalendarRpcError(err, "ติ๊กช็อตไม่สำเร็จ ลองใหม่อีกครั้ง") };
  }
}

/** R9 — analytics.campaign_step_set_content_type (0150, security GO
 * 25 ก.ย. 69). Closes the gap 0145 left open: the column existed on
 * campaign_step since then, but nothing could write it.
 *
 * 🔴 UNLIKE every other write in this file, `contentTypeCode` has NO
 * "leave untouched" meaning — the RPC's own p_content_type_code has no
 * default and null means "clear the tag" (0150's header comment explains
 * why: content_post_upsert's null-preserving pattern would make the tag
 * impossible to ever clear again once set). That means the CALLER must
 * always pass an intentional value:
 *   - owner picked a type in the dropdown -> pass that code
 *   - owner tapped "ล้างประเภท" (with its own confirm step in the UI) ->
 *     pass null on purpose
 *   - dropdown still on its placeholder / nothing selected -> DO NOT CALL
 *     this action at all (there is no safe "no-op" value to send — sending
 *     null here would silently wipe an existing tag)
 * StepContentTypeSelector.tsx is the only caller today and follows this
 * exactly; do not add a generic "save whole form" helper that could call
 * this with an untouched-field default of null. */
export async function setStepContentType(stepId: string, contentTypeCode: string | null): Promise<ActionResult> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;

  if (!stepId) return { ok: false, error: "ไม่พบรหัสงาน" };

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();
    const { error } = await supabase.schema(SCHEMA).rpc("campaign_step_set_content_type", {
      p_shop_id: shopId,
      p_step_id: stepId,
      p_content_type_code: contentTypeCode,
    });
    if (error) throw error;

    revalidatePath("/marketing/calendar");
    return { ok: true, data: undefined };
  } catch (err) {
    console.error("setStepContentType failed", err);
    return { ok: false, error: mapCalendarRpcError(err, "ตั้งประเภทเนื้อหาไม่สำเร็จ ลองใหม่อีกครั้ง") };
  }
}

/** R8 — delete a mistyped task. Guarded server-side to manual-trigger
 * campaigns only; template-plan steps raise 22023, mapped to a Thai message
 * by lib/marketing/calendar-errors.ts. */
export async function deleteTask(stepId: string): Promise<ActionResult> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;

  if (!stepId) return { ok: false, error: "ไม่พบรหัสงาน" };

  try {
    const supabase = getServiceClient();
    const { error } = await supabase.schema(SCHEMA).rpc("campaign_delete_step", {
      p_step_id: stepId,
    });
    if (error) throw error;

    revalidatePath("/marketing/calendar");
    return { ok: true, data: undefined };
  } catch (err) {
    console.error("deleteTask failed", err);
    return { ok: false, error: mapCalendarRpcError(err, "ลบงานไม่สำเร็จ ลองใหม่อีกครั้ง") };
  }
}
