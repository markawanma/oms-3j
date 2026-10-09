"use server";

// lib/actions/content-pieces.ts — หน้าชิ้นงาน (F) + sheet "โพสต์แล้ว" (H)
// (content-ui-build-plan.md §2.4, §2.5, §4 P1a ข้อ 4/5, ภาคผนวก A)
//
// ไฟล์ "use server": export ได้เฉพาะ async function (type/const อยู่ lib/marketing/*)
//
// กติกาที่นี่ (QA ตรวจจาก diff):
//  - requireOwnerAdmin() เป็นบรรทัดแรกของทุก action (F2)
//  - ไม่รับ shopId / actorRole จาก client — callRpc() ใส่ shop + 'owner' ให้เอง (piece-server.ts)
//  - allowlist ปลายทางสถานะ/คีย์แผน/ชนิดด่านก่อนเรียก RPC (piece-input.ts) · DB ยังเป็นผู้ตัดสินจริงทุกเรื่อง
//  - ทุก view/ตาราง: .eq("shop_id", …) เอง · live_host เลือก id, public_label, is_active เท่านั้น (F3)
//  - ข้อความ error = humanizeRpcError (ไทย ไม่รั่วชื่อฟังก์ชัน/enum)

import { revalidatePath } from "next/cache";
import { getServiceClient } from "@/lib/supabase/server";
import { canonicalizeTikTokLink, parseCanonicalTikTokPostUrl } from "@/lib/marketing/tiktok-link";
import { deriveExternalId } from "@/lib/marketing/content-types";
import { getContentTypes } from "@/lib/actions/content";
import { setArtifactContent, toggleClipShot } from "@/lib/actions/calendar";
import {
  PIECE_FULL_COLUMNS,
  mapConfirmItem,
  mapPieceEvent,
  mapPieceRow,
} from "@/lib/marketing/piece-types";
import type { ContentTypeOption, HostOption, PieceDetailData, SignalOrigin } from "@/lib/marketing/piece-types";
import {
  buildGatePayload,
  checkConfirmAnswer,
  checkHookInput,
  checkReason,
  cleanText,
  isAdvanceTarget,
  isGateKind,
  isRecord,
  isGateStatus,
  normalizeReviewSeconds,
  reasonAlwaysRequired,
  sanitizePlanSet,
} from "@/lib/marketing/piece-input";
import type { GateInput, HookInput } from "@/lib/marketing/piece-input";
import { HOOK_TYPES } from "@/lib/marketing/piece-labels";
import { checkPostUrlHost, platformsForKind, postedAtFromLocalInput } from "@/lib/marketing/post-link";
import type { PostPlatform } from "@/lib/marketing/post-link";
import { callRpc, isUuid, logRpcFailure, requireOwnerAdmin, SCHEMA, shopId } from "@/lib/marketing/piece-server";
import type { PieceResult } from "@/lib/marketing/piece-server";

const EVENT_LIMIT = 200;
const MAX_RAW_POST_URL_LEN = 2048;

function refreshPaths(stepId?: string): void {
  revalidatePath("/marketing");
  if (stepId) revalidatePath(`/marketing/pieces/${stepId}`);
}

// ============================================================================
// อ่าน — หน้ารายละเอียดชิ้นงาน
// ============================================================================

export type PieceDetailResult =
  | { kind: "found"; detail: PieceDetailData }
  /** step มีอยู่แต่อยู่นอก workflow ใหม่ (piece_status null) → ไปหน้าเดิม /marketing/calendar/[stepId] */
  | { kind: "legacy" }
  | { kind: "missing" };

/** แถวเดียวจาก v_content_piece + timeline + รายการ [ต้องยืนยัน] + สัญญาณต้นทาง + โฮสต์ (public_label) + ชนิดเนื้อหา */
export async function getPieceDetail(stepId: string): Promise<PieceResult<PieceDetailResult>> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;
  if (!isUuid(stepId)) return { ok: true, data: { kind: "missing" } };

  try {
    const shop = shopId();
    const supabase = getServiceClient();
    const db = () => supabase.schema(SCHEMA);

    const pieceRes = await db().from("v_content_piece").select(PIECE_FULL_COLUMNS).eq("shop_id", shop).eq("step_id", stepId).maybeSingle();
    if (pieceRes.error) throw pieceRes.error;
    if (!pieceRes.data) {
      const legacy = await db().from("campaign_step").select("id").eq("shop_id", shop).eq("id", stepId).maybeSingle();
      if (legacy.error) throw legacy.error;
      return { ok: true, data: { kind: legacy.data ? "legacy" : "missing" } };
    }
    const piece = mapPieceRow(pieceRes.data as unknown as Record<string, unknown>);

    const [eventsRes, itemsRes, hostsRes, signalRes, typesRes, statsRes] = await Promise.all([
      db()
        .from("content_piece_event")
        .select("id, seq, event_kind, from_status, to_status, reason, actor_role, review_seconds, payload, created_at")
        .eq("shop_id", shop)
        .eq("step_id", stepId)
        .order("seq", { ascending: false })
        .limit(EVENT_LIMIT),
      db()
        .from("content_confirm_item")
        .select("id, key, question, answer, resolved_at")
        .eq("shop_id", shop)
        .eq("step_id", stepId)
        .is("removed_at", null)
        .order("created_at", { ascending: true })
        .limit(100),
      // 🔴 F3: เลือกเฉพาะ id, public_label, is_active — display_name (ชื่อจริงโฮสต์) ห้ามเข้า payload ไป client
      db().from("live_host").select("id, public_label, is_active").eq("shop_id", shop).eq("is_active", true).order("public_label", { ascending: true }).limit(20),
      piece.sourceSignalId
        ? db().from("v_content_signal").select("id, kind, summary, seen_on").eq("shop_id", shop).eq("id", piece.sourceSignalId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      getContentTypes().catch(() => ({ ok: false as const, error: "" })),
      // สถิติประเภท hook: ข้อความจาก DB ตรงๆ (ตัวหาร n/4 มาจาก view ไม่เขียนตายตัว) · ล้มเหลว = ไม่แสดงสถิติ ไม่ล้มทั้งหน้า
      db().from("v_content_hook_type_rollup").select("hook_type, verdict_detail").eq("shop_id", shop).limit(20),
    ]);
    if (eventsRes.error) throw eventsRes.error;
    if (itemsRes.error) throw itemsRes.error;
    if (hostsRes.error) throw hostsRes.error;
    if (signalRes.error) throw signalRes.error;

    const hosts: HostOption[] = ((hostsRes.data ?? []) as Record<string, unknown>[])
      .filter((h) => typeof h.id === "string" && typeof h.public_label === "string")
      .map((h) => ({ id: h.id as string, publicLabel: h.public_label as string }));

    let sourceSignal: SignalOrigin | null = null;
    const sg = signalRes.data as Record<string, unknown> | null;
    if (sg) {
      sourceSignal = {
        kind: typeof sg.kind === "string" ? sg.kind : "",
        summary: typeof sg.summary === "string" ? sg.summary : "",
        seenOn: typeof sg.seen_on === "string" ? sg.seen_on.slice(0, 10) : null,
      };
    }

    const hookStats: Record<string, string> = {};
    if (!statsRes.error) {
      for (const r of (statsRes.data ?? []) as Record<string, unknown>[]) {
        if (typeof r.hook_type === "string" && typeof r.verdict_detail === "string") hookStats[r.hook_type] = r.verdict_detail;
      }
    }

    const contentTypes: ContentTypeOption[] = typesRes.ok
      ? typesRes.data.map((c) => ({ code: c.code, labelTh: c.labelTh, colorHex: c.colorHex }))
      : [];

    return {
      ok: true,
      data: {
        kind: "found",
        detail: {
          piece,
          events: ((eventsRes.data ?? []) as Record<string, unknown>[]).map(mapPieceEvent),
          confirmItems: ((itemsRes.data ?? []) as Record<string, unknown>[]).map(mapConfirmItem),
          sourceSignal,
          hookStats,
          hosts,
          contentTypes,
        },
      },
    };
  } catch (err) {
    logRpcFailure("getPieceDetail", err);
    return { ok: false, error: "โหลดชิ้นงานไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

// ============================================================================
// เขียน — เปลี่ยนสถานะ
// ============================================================================

export interface AdvanceOptions {
  reason?: string;
  /** วินาทีที่เปิดอ่านก่อนอนุมัติ (วัดฝั่ง client ตั้งแต่เปิดหน้า) — ใช้เฉพาะ to = approved · ไม่บล็อกถ้าสั้น */
  reviewSeconds?: number;
}

/** content_piece_advance — ทุกการเปลี่ยนสถานะ + hold/resume/cancel/restore (ไม่มี CAS: stale tab ตกที่ข้อความ "เปลี่ยนสถานะไปแล้ว") */
export async function advancePiece(stepId: string, to: string, opts: AdvanceOptions = {}): Promise<PieceResult<{ to: string }>> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;
  if (opts !== undefined && !isRecord(opts)) return { ok: false, error: "ข้อมูลที่ส่งมาไม่ถูกต้อง" };
  if (!isUuid(stepId)) return { ok: false, error: "ไม่พบชิ้นงาน" };
  if (!isAdvanceTarget(to)) return { ok: false, error: "เปลี่ยนสถานะแบบนี้ไม่ได้" };

  const reason = checkReason(opts.reason, reasonAlwaysRequired(to));
  if (!reason.ok) return { ok: false, error: reason.error };

  const res = await callRpc<Record<string, unknown>>(
    "content_piece_advance",
    {
      p_step_id: stepId,
      p_to: to,
      p_reason: reason.value,
      p_review_seconds: to === "approved" ? normalizeReviewSeconds(opts.reviewSeconds) : null,
    },
    "เปลี่ยนสถานะไม่สำเร็จ ลองใหม่อีกครั้ง"
  );
  if (!res.ok) return res;
  refreshPaths(stepId);
  return { ok: true, data: { to } };
}

/** LINE / สตอรี่ — "บันทึกว่าส่งแล้ว" ไม่มีลิงก์ ไม่มีการวัดผลรายชิ้น (brief 0.5) */
export async function postPieceNoUrl(stepId: string): Promise<PieceResult<{ to: string }>> {
  return advancePiece(stepId, "posted");
}

// ============================================================================
// เขียน — ด่านตรวจ / [ต้องยืนยัน]
// ============================================================================

export type RecordGateInput = Omit<GateInput, "gateKind" | "status"> & { gateKind: string; status: string };

/**
 * content_gate_record — เขียนทับ detail ทั้งก้อน: fact_check ส่ง {sources, flagged} ครบชุด · brand_rule ส่ง {rules_hit} ครบชุด ·
 * risk_owner: คำถามเดิมอ่านจาก DB ที่นี่ (ไม่รับจาก client) แล้วส่งกลับพร้อมคำตอบ
 */
export async function recordGate(stepId: string, input: RecordGateInput): Promise<PieceResult<{ gatesPassed: boolean }>> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;
  if (!isUuid(stepId)) return { ok: false, error: "ไม่พบชิ้นงาน" };
  if (!isRecord(input)) return { ok: false, error: "ข้อมูลผลตรวจไม่ถูกต้อง" };
  if (!isGateKind(input.gateKind) || !isGateStatus(input.status)) return { ok: false, error: "เลือกด่านให้ถูกต้อง" };

  let existingQuestion: string | null = null;
  if (input.gateKind === "risk_owner") {
    try {
      const { data, error } = await getServiceClient()
        .schema(SCHEMA)
        .from("step_gate")
        .select("detail")
        .eq("shop_id", shopId())
        .eq("step_id", stepId)
        .eq("gate_kind", "risk_owner")
        .maybeSingle();
      if (error) throw error;
      const detail = (data as { detail?: unknown } | null)?.detail;
      const q = detail && typeof detail === "object" ? (detail as Record<string, unknown>).question : null;
      existingQuestion = typeof q === "string" && q.trim() ? q : null;
    } catch (err) {
      logRpcFailure("recordGate.readQuestion", err);
      return { ok: false, error: "บันทึกผลตรวจไม่สำเร็จ ลองใหม่อีกครั้ง" };
    }
  }

  const payload = buildGatePayload({ ...input, gateKind: input.gateKind, status: input.status }, existingQuestion);
  if (!payload.ok) return { ok: false, error: payload.error };

  const res = await callRpc<Record<string, unknown>>(
    "content_gate_record",
    {
      p_step_id: stepId,
      p_gate_kind: input.gateKind,
      p_status: input.status,
      p_detail: payload.value.detail,
      p_note: payload.value.note,
    },
    "บันทึกผลตรวจไม่สำเร็จ ลองใหม่อีกครั้ง"
  );
  if (!res.ok) return res;
  refreshPaths(stepId);
  return { ok: true, data: { gatesPassed: res.data?.gates_passed === true } };
}

/** content_confirm_resolve — ตอบ [ต้องยืนยัน] 1 ข้อ → แทน marker ในข้อความจริง (UI ห้ามแต่งคำตอบแทน) */
export async function resolveConfirm(stepId: string, itemId: string, answer: string): Promise<PieceResult<{ remaining: number }>> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;
  if (!isUuid(itemId)) return { ok: false, error: "ไม่พบข้อที่จะตอบ" };
  const a = checkConfirmAnswer(answer);
  if (!a.ok) return { ok: false, error: a.error };

  const res = await callRpc<Record<string, unknown>>(
    "content_confirm_resolve",
    { p_item_id: itemId, p_answer: a.value },
    "บันทึกคำตอบไม่สำเร็จ ลองใหม่อีกครั้ง"
  );
  if (!res.ok) return res;
  refreshPaths(isUuid(stepId) ? stepId : undefined);
  const remaining = typeof res.data?.remaining_pending === "number" ? res.data.remaining_pending : 0;
  return { ok: true, data: { remaining } };
}

// ============================================================================
// เขียน — แผน / hook / เนื้อหา / ช็อต
// ============================================================================

/** content_piece_set_plan — ผู้เรียกต้องส่งเฉพาะ key ที่เปลี่ยน (ล้างค่า = null ชัดๆ · 0 เป็นค่าจริง) */
export async function setPlan(stepId: string, set: Record<string, unknown>): Promise<PieceResult<undefined>> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;
  if (!isUuid(stepId)) return { ok: false, error: "ไม่พบชิ้นงาน" };
  const clean = sanitizePlanSet(set); // รับ null/array/ชนิดอื่นได้ → "ไม่มีค่าที่เปลี่ยน"
  if (!clean.ok) return { ok: false, error: clean.error };

  const res = await callRpc("content_piece_set_plan", { p_step_id: stepId, p_set: clean.value }, "บันทึกแผนไม่สำเร็จ ลองใหม่อีกครั้ง");
  if (!res.ok) return res;
  refreshPaths(stepId);
  return { ok: true, data: undefined };
}

/** content_hook_upsert — แก้ได้เฉพาะ drafting/in_review (DB บังคับ) · แก้แล้วผลตรวจ 3 ด่านถูกล้างโดย DB */
export async function upsertHook(stepId: string, hook: HookInput): Promise<PieceResult<undefined>> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;
  if (!isUuid(stepId)) return { ok: false, error: "ไม่พบชิ้นงาน" };
  const h = checkHookInput(hook);
  if (!h.ok) return { ok: false, error: h.error };

  const res = await callRpc(
    "content_hook_upsert",
    {
      p_step_id: stepId,
      p_label: h.value.label,
      p_text: h.value.text,
      p_hook_type: h.value.hookType,
      p_source_signal_id: null,
      p_id: h.value.id ?? null,
    },
    "บันทึก hook ไม่สำเร็จ ลองใหม่อีกครั้ง"
  );
  if (!res.ok) return res;
  refreshPaths(stepId);
  return { ok: true, data: undefined };
}

/**
 * security L4: artifact ที่ client ส่งมาต้องเป็นของ step นี้ในร้านนี้ (อ่านจาก v_content_piece) — RPC เดิมรับแค่ artifact id
 * ไม่ตรง = ปฏิเสธ (แถวอาจเปลี่ยนไป/ส่งมาผิด) · อ่านล้มเหลว = ปฏิเสธ (fail-closed)
 */
async function verifyArtifactOwned(stepId: string, artifactId: string, label: string): Promise<PieceResult<undefined>> {
  try {
    const { data, error } = await getServiceClient()
      .schema(SCHEMA)
      .from("v_content_piece")
      .select("artifact_id")
      .eq("shop_id", shopId())
      .eq("step_id", stepId)
      .maybeSingle();
    if (error) throw error;
    const owned = (data as { artifact_id?: string | null } | null)?.artifact_id;
    if (!owned || owned !== artifactId) return { ok: false, error: "เนื้อหานี้ไม่ใช่ของชิ้นงานนี้ — รีเฟรชหน้าแล้วลองใหม่", stale: true };
    return { ok: true, data: undefined };
  } catch (err) {
    logRpcFailure(label + ".verifyArtifact", err);
    return { ok: false, error: "ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

/** แก้ข้อความหลัก (content_body) ของเอกสาร — ผ่าน campaign_set_artifact_content เดิม · DB ล็อกหลังอนุมัติและล้างด่านให้เอง */
export async function savePieceBody(stepId: string, artifactId: string, contentBody: string): Promise<PieceResult<undefined>> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;
  if (!isUuid(stepId) || !isUuid(artifactId)) return { ok: false, error: "ไม่พบเนื้อหาที่จะแก้" };
  if (typeof contentBody !== "string" || contentBody.length > 20_000) return { ok: false, error: "เนื้อหายาวเกินไป" };

  const owned = await verifyArtifactOwned(stepId, artifactId, "savePieceBody");
  if (!owned.ok) return owned;

  const r = await setArtifactContent(artifactId, { contentBody });
  if (!r.ok) return { ok: false, error: r.error };
  refreshPaths(stepId);
  return { ok: true, data: undefined };
}

/** ติ๊กช็อต "ถ่ายแล้ว" — ทำได้ทุกสถานะ (แม้ล็อกเนื้อหาแล้ว) ผ่าน RPC เดิม */
export async function toggleShot(stepId: string, artifactId: string, shotId: string, done: boolean): Promise<PieceResult<undefined>> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;
  if (!isUuid(artifactId) || typeof shotId !== "string" || !shotId || shotId.length > 80) {
    return { ok: false, error: "ไม่พบช็อตที่จะติ๊ก" };
  }
  if (!isUuid(stepId)) return { ok: false, error: "ไม่พบชิ้นงาน" };
  const owned = await verifyArtifactOwned(stepId, artifactId, "toggleShot");
  if (!owned.ok) return owned;
  const r = await toggleClipShot(artifactId, shotId, done === true);
  if (!r.ok) return { ok: false, error: r.error };
  refreshPaths(isUuid(stepId) ? stepId : undefined);
  return { ok: true, data: undefined };
}

// ============================================================================
// เขียน — โพสต์แล้ว / ปลดโพสต์ / เลื่อน
// ============================================================================

export type PostHookChoice =
  | { kind: "skip" }
  | { kind: "existing"; hookId: string }
  | { kind: "other"; text: string; hookType: string };

export interface PostPieceInput {
  platform: string;
  url: string;
  /** "YYYY-MM-DDTHH:mm" เวลาไทย (จาก <input type="datetime-local">) */
  postedAtLocal: string;
  hook: PostHookChoice;
}

/**
 * content_piece_post — วางลิงก์ + เลือก hook + ขยับ posted ในคำสั่งเดียว
 * ฝั่ง server: ตรวจช่องทางต้องเข้าคู่ชนิดชิ้น (อ่านจาก DB ไม่เชื่อ client) · host ของลิงก์ต้องตรงช่องทาง ·
 * ลิงก์ TikTok → canonicalizeTikTokLink เสมอ (dedup key = ลิงก์มาตรฐาน) · ไม่ fetch ปลายทางนอกจากที่ canonicalize ทำเอง (ตามลิงก์สั้นของ TikTok)
 */
export async function postPiece(stepId: string, input: PostPieceInput): Promise<PieceResult<{ postId: string; additional: boolean }>> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;
  if (!isUuid(stepId)) return { ok: false, error: "ไม่พบชิ้นงาน" };
  if (!isRecord(input) || !isRecord(input.hook)) return { ok: false, error: "ข้อมูลโพสต์ไม่ถูกต้อง" };

  const platform = input.platform;
  if (platform !== "tiktok" && platform !== "facebook" && platform !== "instagram") {
    return { ok: false, error: "เลือกช่องทางที่โพสต์" };
  }
  const rawUrl = typeof input.url === "string" ? input.url.trim() : "";
  if (rawUrl.length > MAX_RAW_POST_URL_LEN) return { ok: false, error: "ลิงก์ยาวผิดปกติ — คัดลอกลิงก์จากหน้าโพสต์มาวางใหม่" };

  // ชนิดชิ้นงานจริงจาก DB (ไม่เชื่อ client) — ช่องทางที่เลือกต้องเป็นของชนิดนี้
  let pieceKind: string | null = null;
  try {
    const { data, error } = await getServiceClient()
      .schema(SCHEMA)
      .from("campaign_step")
      .select("piece_kind")
      .eq("shop_id", shopId())
      .eq("id", stepId)
      .maybeSingle();
    if (error) throw error;
    pieceKind = (data as { piece_kind?: string | null } | null)?.piece_kind ?? null;
  } catch (err) {
    logRpcFailure("postPiece.readKind", err);
    return { ok: false, error: "บันทึกโพสต์ไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
  if (!platformsForKind(pieceKind).includes(platform as PostPlatform)) {
    return { ok: false, error: "ชิ้นชนิดนี้โพสต์บนช่องทางที่เลือกไม่ได้" };
  }

  const hostCheck = checkPostUrlHost(platform as PostPlatform, rawUrl);
  if (!hostCheck.ok) return { ok: false, error: hostCheck.error };

  let canonicalUrl = hostCheck.url;
  if (platform === "tiktok") {
    const c = await canonicalizeTikTokLink(hostCheck.url);
    if (!c.ok) return { ok: false, error: c.error };
    canonicalUrl = c.url;
    if (!parseCanonicalTikTokPostUrl(canonicalUrl)) {
      return { ok: false, error: "ลิงก์นี้ไม่ใช่ลิงก์คลิป/โพสต์ของ TikTok — คัดลอกลิงก์จากหน้าคลิปมาวาง" };
    }
  }

  const postedAt = postedAtFromLocalInput(input.postedAtLocal);
  if (!postedAt.ok) return { ok: false, error: postedAt.error };

  let hookId: string | null = null;
  let otherText: string | null = null;
  let otherType: string | null = null;
  const hook = input.hook;
  if (hook.kind === "existing") {
    if (!isUuid(hook.hookId)) return { ok: false, error: "เลือก hook ไม่ถูกต้อง" };
    hookId = hook.hookId;
  } else if (hook.kind === "other") {
    const t = cleanText(hook.text);
    if (!t) return { ok: false, error: "พิมพ์ข้อความ hook ที่ใช้จริง" };
    if (t.length > 500) return { ok: false, error: "ข้อความ hook ยาวเกิน 500 ตัวอักษร" };
    if (!(HOOK_TYPES as readonly string[]).includes(hook.hookType)) return { ok: false, error: "เลือกประเภทของ hook ที่พิมพ์เอง" };
    otherText = t;
    otherType = hook.hookType;
  } else if (hook.kind !== "skip") {
    return { ok: false, error: "เลือก hook ไม่ถูกต้อง" };
  }

  const res = await callRpc<Record<string, unknown>>(
    "content_piece_post",
    {
      p_step_id: stepId,
      p_platform: platform,
      p_external_id: deriveExternalId(canonicalUrl),
      p_post_url: canonicalUrl,
      p_posted_at: postedAt.iso,
      p_hook_id: hookId,
      p_hook_other_text: otherText,
      p_hook_other_type: otherType,
      p_caption: null,
    },
    "บันทึกโพสต์ไม่สำเร็จ ลองใหม่อีกครั้ง",
    { duplicate: "ลิงก์นี้เคยถูกบันทึกแล้ว" }
  );
  if (!res.ok) return res;
  refreshPaths(stepId);
  revalidatePath("/marketing/content/entry");
  return { ok: true, data: { postId: String(res.data?.post_id ?? ""), additional: res.data?.additional === true } };
}

/** content_post_unlink_step — ปลดโพสต์ (ชนิดมีลิงก์) · เหตุผลบังคับ · โพสต์ใบสุดท้ายถูกปลด → ชิ้นกลับ "ผลิตแล้ว" */
export async function unlinkPost(stepId: string, postId: string, reason: string): Promise<PieceResult<undefined>> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;
  if (!isUuid(postId)) return { ok: false, error: "ไม่พบโพสต์" };
  const r = checkReason(reason, true);
  if (!r.ok) return { ok: false, error: r.error };

  const res = await callRpc("content_post_unlink_step", { p_post_id: postId, p_reason: r.value }, "ปลดโพสต์ไม่สำเร็จ ลองใหม่อีกครั้ง");
  if (!res.ok) return res;
  refreshPaths(isUuid(stepId) ? stepId : undefined);
  revalidatePath("/marketing/content/entry");
  return { ok: true, data: undefined };
}

/** content_piece_defer — เลื่อนวัน (เหตุผลบังคับ 3–500) */
export async function deferPiece(stepId: string, newDate: string, reason: string, newTime?: string | null): Promise<PieceResult<undefined>> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;
  if (!isUuid(stepId)) return { ok: false, error: "ไม่พบชิ้นงาน" };
  const date = sanitizePlanSet({ date: newDate });
  if (!date.ok) return { ok: false, error: "เลือกวันใหม่ให้ถูกต้อง" };
  const r = checkReason(reason, true);
  if (!r.ok) return { ok: false, error: r.error };
  let time: string | null = null;
  if (newTime) {
    const t = sanitizePlanSet({ start_time: newTime });
    if (!t.ok) return { ok: false, error: "เวลาต้องเป็นรูปแบบ ชม:นาที" };
    time = newTime;
  }

  const res = await callRpc(
    "content_piece_defer",
    { p_step_id: stepId, p_new_date: newDate, p_reason: r.value, p_new_time: time },
    "เลื่อนวันไม่สำเร็จ ลองใหม่อีกครั้ง"
  );
  if (!res.ok) return res;
  refreshPaths(stepId);
  return { ok: true, data: undefined };
}

/**
 * step นี้อยู่ใน workflow ใหม่ไหม (มีแถวใน v_content_piece) — ใช้ตัดสิน redirect จากหน้าเดิม /marketing/calendar/[stepId]
 * ล้มเหลว/ไม่ใช่ uuid = false (ปล่อยให้หน้าเดิมทำงานตามปกติ ไม่ redirect ผิด)
 */
export async function isWorkflowPiece(stepId: string): Promise<boolean> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr || !isUuid(stepId)) return false;
  try {
    const { data, error } = await getServiceClient()
      .schema(SCHEMA)
      .from("v_content_piece")
      .select("step_id")
      .eq("shop_id", shopId())
      .eq("step_id", stepId)
      .maybeSingle();
    if (error) throw error;
    return data !== null;
  } catch (err) {
    logRpcFailure("isWorkflowPiece", err);
    return false;
  }
}
