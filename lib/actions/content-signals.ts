"use server";

// lib/actions/content-signals.ts — รายการสัญญาณ /marketing/research · หยิบเป็นไอเดีย · ไม่ใช้ · เก็บไว้ก่อน
// อ่าน: v_content_signal (.eq shop_id · limit) · เขียน: content_signal_pick / content_signal_set_status ผ่าน callRpcDetailed (shop/actor ใส่ฝั่ง server)
// DB ตัดสินทุกด่าน: picked แล้วหยิบซ้ำ/ตั้ง "ไม่ใช้" = ข้อความ + id ชิ้นที่กระทบ → จอถามยืนยัน (p_force) ก่อนทำจริง
// ไฟล์ "use server": export ได้เฉพาะ async function

import { revalidatePath } from "next/cache";
import { effectiveDateBangkok } from "@/lib/tiktok/format";
import { isCalendarDate } from "@/lib/marketing/calendar-view";
import { cleanText, isRecord } from "@/lib/marketing/piece-input";
import { CUSTOMER_GROUPS, KIND_CHANNELS, PIECE_KINDS, SIGNAL_KINDS } from "@/lib/marketing/piece-labels";
import { analyticsDb, asRows } from "@/lib/marketing/piece-queries";
import { callRpcDetailed, isUuid, logRpcFailure, requireOwnerAdmin, shopId } from "@/lib/marketing/piece-server";
import type { PieceResult } from "@/lib/marketing/piece-server";
import { SIGNAL_COLUMNS, SIGNAL_STATUSES, mapSignalRow } from "@/lib/marketing/signal-types";
import type { SignalRow } from "@/lib/marketing/signal-types";

const SIGNAL_PAGE_SIZE = 30;

export interface SignalsQuery {
  kind: string;
  /** "all" = ทุกสถานะ */
  status: string;
  id: string;
  page: number;
}

export interface SignalsData {
  todayTh: string;
  query: SignalsQuery;
  rows: SignalRow[];
  hasNext: boolean;
  counts: Record<string, number> | null;
  /** ชิ้นที่หยิบมา (ชื่อ + สถานะ) ตาม picked_step_id */
  pieces: Record<string, { title: string; status: string }>;
}

type Sp = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? "") : (v ?? ""));

export async function getSignals(raw: Sp): Promise<PieceResult<SignalsData>> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr) return gateErr;

  const kindRaw = first(raw?.kind);
  const statusRaw = first(raw?.status);
  const idRaw = first(raw?.id);
  const pageRaw = Number.parseInt(first(raw?.page), 10);
  const query: SignalsQuery = {
    kind: (SIGNAL_KINDS as readonly string[]).includes(kindRaw) ? kindRaw : "",
    status: statusRaw === "all" || (SIGNAL_STATUSES as readonly string[]).includes(statusRaw) ? statusRaw : "new",
    id: isUuid(idRaw) ? idRaw : "",
    page: Number.isInteger(pageRaw) && pageRaw >= 1 ? Math.min(pageRaw, 100) : 1,
  };
  const todayTh = effectiveDateBangkok(new Date().toISOString());
  const shop = shopId();
  const db = analyticsDb();

  try {
    let q = db.from("v_content_signal").select(SIGNAL_COLUMNS).eq("shop_id", shop);
    if (query.id) q = q.eq("id", query.id);
    else {
      if (query.kind) q = q.eq("kind", query.kind);
      if (query.status !== "all") q = q.eq("status", query.status);
    }
    const offset = (query.page - 1) * SIGNAL_PAGE_SIZE;
    const { data, error } = await q
      .order("seen_on", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(offset, offset + SIGNAL_PAGE_SIZE);
    if (error) throw error;
    const all = asRows(data).map(mapSignalRow).filter((r): r is SignalRow => r !== null);
    const rows = all.slice(0, SIGNAL_PAGE_SIZE);

    const pickedIds = [...new Set(rows.map((r) => r.pickedStepId).filter((s): s is string => !!s && isUuid(s)))];
    const pieces: SignalsData["pieces"] = {};
    const [pieceRes, counts] = await Promise.all([
      pickedIds.length > 0
        ? db.from("v_content_piece").select("step_id, title, effective_piece_status").eq("shop_id", shop).in("step_id", pickedIds).limit(SIGNAL_PAGE_SIZE)
        : Promise.resolve({ data: [], error: null }),
      Promise.all(SIGNAL_STATUSES.map((s) => db.from("v_content_signal").select("id", { count: "exact", head: true }).eq("shop_id", shop).eq("status", s))).catch(() => null),
    ]);
    if (!pieceRes.error) {
      for (const p of asRows(pieceRes.data)) {
        if (typeof p.step_id === "string") pieces[p.step_id] = { title: typeof p.title === "string" ? p.title : "(ไม่มีชื่อ)", status: typeof p.effective_piece_status === "string" ? p.effective_piece_status : "" };
      }
    }
    const countMap: Record<string, number> | null =
      counts && counts.every((c) => !c.error) ? Object.fromEntries(SIGNAL_STATUSES.map((s, i) => [s, counts[i].count ?? 0])) : null;

    return { ok: true, data: { todayTh, query, rows, hasNext: all.length > SIGNAL_PAGE_SIZE, counts: countMap, pieces } };
  } catch (err) {
    logRpcFailure("getSignals", err);
    return { ok: false, error: "โหลดรายการสัญญาณไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

export interface PickInput {
  title: string;
  pieceKind: string;
  channel: string;
  customerGroup: string;
}

export type PickResult = { ok: true; data: { stepId: string } } | { ok: false; error: string; stale?: boolean; pickedStepId?: string | null };

/** หยิบสัญญาณเป็นไอเดีย → content_signal_pick (สร้างชิ้น idea + ผูกสัญญาณ) · ไอเดียไปรอที่หน้าคัดไอเดียพร้อมที่มา */
export async function pickSignal(signalId: string, input: PickInput): Promise<PickResult> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr && !gateErr.ok) return { ok: false, error: gateErr.error };
  if (!isUuid(signalId)) return { ok: false, error: "ไม่พบสัญญาณ" };
  if (!isRecord(input)) return { ok: false, error: "ข้อมูลที่ส่งมาไม่ถูกต้อง" };

  const title = cleanText(input.title);
  if (title.length < 1 || title.length > 200) return { ok: false, error: "ชื่อไอเดียต้องยาว 1–200 ตัวอักษร" };
  if (typeof input.pieceKind !== "string" || !(PIECE_KINDS as readonly string[]).includes(input.pieceKind)) return { ok: false, error: "เลือกชนิดชิ้นงาน" };
  const kind = input.pieceKind as (typeof PIECE_KINDS)[number];
  if (typeof input.channel !== "string" || !(KIND_CHANNELS[kind] as readonly string[]).includes(input.channel)) return { ok: false, error: "เลือกช่องทางที่ใช้กับชนิดนี้ได้" };
  if (typeof input.customerGroup !== "string" || !(CUSTOMER_GROUPS as readonly string[]).includes(input.customerGroup)) return { ok: false, error: "เลือกกลุ่มลูกค้า" };

  const res = await callRpcDetailed<string>(
    "content_signal_pick",
    { p_signal_id: signalId, p_title: title, p_piece_kind: input.pieceKind, p_channel: input.channel, p_customer_group: input.customerGroup },
    "หยิบเป็นไอเดียไม่สำเร็จ ลองใหม่อีกครั้ง"
  );
  if (!res.ok) return { ok: false, error: res.error, stale: res.stale, pickedStepId: res.detail && isUuid(res.detail) ? res.detail : null };
  if (typeof res.data !== "string" || !isUuid(res.data)) return { ok: false, error: "หยิบเป็นไอเดียไม่สำเร็จ ลองใหม่อีกครั้ง" };
  revalidatePath("/marketing/research");
  revalidatePath("/marketing/triage");
  revalidatePath("/marketing");
  return { ok: true, data: { stepId: res.data } };
}

export interface StatusInput {
  /** new = กลับมาใช้ (จาก ไม่ใช้/เก็บไว้ก่อน) — ตั้งจากสัญญาณที่หยิบไปแล้วไม่ได้ (DB ปฏิเสธ) */
  status: "new" | "rejected" | "deferred";
  reason?: string;
  /** YYYY-MM-DD — เก็บไว้ก่อนต้องมี (วันนี้หรืออนาคต) */
  reviewOn?: string;
  /** ยืนยันซ้ำหลังเห็นว่าสัญญาณถูกหยิบเป็นชิ้นงานแล้ว */
  force?: boolean;
}

export type StatusResult = { ok: true; data: undefined } | { ok: false; error: string; stale?: boolean; needsForce?: boolean; pickedStepId?: string | null };

export async function setSignalStatus(signalId: string, input: StatusInput): Promise<StatusResult> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr && !gateErr.ok) return { ok: false, error: gateErr.error };
  if (!isUuid(signalId)) return { ok: false, error: "ไม่พบสัญญาณ" };
  if (!isRecord(input) || (input.status !== "new" && input.status !== "rejected" && input.status !== "deferred")) return { ok: false, error: "เปลี่ยนสถานะแบบนี้ไม่ได้" };

  const reason = cleanText(input.reason);
  if (reason.length > 500) return { ok: false, error: "เหตุผลยาวเกิน 500 ตัวอักษร" };
  if (input.status === "rejected" && reason.length < 3) return { ok: false, error: "บอกเหตุผลที่ไม่ใช้อย่างน้อย 3 ตัวอักษร" };
  let reviewOn: string | null = null;
  if (input.status === "deferred") {
    if (typeof input.reviewOn !== "string" || !isCalendarDate(input.reviewOn)) return { ok: false, error: "เลือกวันที่จะกลับมาดู" };
    if (input.reviewOn < effectiveDateBangkok(new Date().toISOString())) return { ok: false, error: "วันที่กลับมาดูต้องเป็นวันนี้หรืออนาคต" };
    reviewOn = input.reviewOn;
  }

  const res = await callRpcDetailed(
    "content_signal_set_status",
    { p_id: signalId, p_status: input.status, p_reason: reason || null, p_review_on: reviewOn, p_force: input.force === true },
    "เปลี่ยนสถานะสัญญาณไม่สำเร็จ ลองใหม่อีกครั้ง"
  );
  if (!res.ok) {
    // 22023 ที่มี detail เป็น uuid = "หยิบเป็นชิ้นงานแล้ว ต้องยืนยันซ้ำ" (มีเฉพาะเคสนี้ใน set_status)
    if (res.code === "22023" && res.detail && isUuid(res.detail)) {
      return {
        ok: false,
        needsForce: true,
        pickedStepId: res.detail,
        error: "สัญญาณนี้ถูกหยิบเป็นชิ้นงานแล้ว — ตั้งสถานะใหม่จะไม่ลบหรือยกเลิกชิ้นงานที่ผูกอยู่",
      };
    }
    return { ok: false, error: res.error, stale: res.stale };
  }
  revalidatePath("/marketing/research");
  return { ok: true, data: undefined };
}

