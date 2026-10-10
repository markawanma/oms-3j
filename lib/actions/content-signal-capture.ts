"use server";

// lib/actions/content-signal-capture.ts — "แปะลิงก์ที่เจอ" → content_signal_capture (reference_clip)
// 🔴 ไม่มีการเรียกเครือข่ายไปยังลิงก์ที่แปะ (ไม่ oEmbed/fetch/resolve) — แค่ล้าง tracking param + parse สตริง · ซ้ำตัดสินที่ DB (23505 + id เดิมใน detail)
// ช่องบังคับ: ลิงก์ + ประโยคเปิดของคลิป (hook) · สรุป 1 บรรทัดค่าเริ่มต้น = hook · ตัวเลขย่อ (16K/1.2M) parse ฝั่งนี้ → จำนวนเต็ม + ธงประมาณ
// ไฟล์ "use server": export ได้เฉพาะ async function · requireOwnerAdmin บรรทัดแรก · actor_role/shop_id ใส่ใน callRpcDetailed

import { revalidatePath } from "next/cache";
import { effectiveDateBangkok } from "@/lib/tiktok/format";
import { isCalendarDate } from "@/lib/marketing/calendar-view";
import { cleanText, isRecord } from "@/lib/marketing/piece-input";
import { CUSTOMER_GROUPS, HOOK_TYPES } from "@/lib/marketing/piece-labels";
import { callRpcDetailed, isUuid, requireOwnerAdmin } from "@/lib/marketing/piece-server";
import { cleanSignalUrl, describeLink, parseMetric } from "@/lib/marketing/signal-input";

export interface CaptureSignalInput {
  url: string;
  hookText: string;
  hookType?: string;
  /** ว่าง = ใช้ hook */
  summary?: string;
  source?: string;
  account?: string;
  followers?: string;
  views?: string;
  likes?: string;
  comments?: string;
  saves?: string;
  shares?: string;
  /** ติ๊กเอง — ถ้ามีตัวย่อ (K/M/หมื่น) ระบบตั้งให้อัตโนมัติ */
  approx?: boolean;
  postedOn?: string;
  customerGroup?: string;
  whyItWorks?: string;
}

export type CaptureField = "url" | "hook" | "summary" | "followers" | "views" | "likes" | "comments" | "saves" | "shares" | "postedOn" | "account" | "form";

export type CaptureSignalResult =
  | { ok: true; data: { id: string } }
  | { ok: false; error: string; field?: CaptureField; duplicateId?: string | null };

const SOURCES = ["owner", "host", "craftsman"];
const fail = (error: string, field?: CaptureField): CaptureSignalResult => ({ ok: false, error, field });

export async function captureSignal(input: CaptureSignalInput): Promise<CaptureSignalResult> {
  const gateErr = await requireOwnerAdmin();
  if (gateErr && !gateErr.ok) return fail(gateErr.error, "form");
  if (!isRecord(input)) return fail("ข้อมูลที่ส่งมาไม่ถูกต้อง", "form");

  const link = cleanSignalUrl(String(input.url ?? ""));
  if (!link.ok) return fail(link.error, "url");
  const hint = describeLink(link.url);

  const hook = cleanText(input.hookText);
  if (hook.length < 1) return fail("พิมพ์ประโยคเปิดของคลิป (ที่เห็นหรือได้ยินในไม่กี่วินาทีแรก)", "hook");
  if (hook.length > 500) return fail("ประโยคเปิดยาวเกิน 500 ตัวอักษร", "hook");
  const summary = cleanText(input.summary) || hook;
  if (summary.length > 300) return fail("สรุปต้องไม่เกิน 300 ตัวอักษร — ย่อให้เหลือ 1 บรรทัด", "summary");

  let hookType: string | null = null;
  if (input.hookType) {
    if (typeof input.hookType !== "string" || !(HOOK_TYPES as readonly string[]).includes(input.hookType)) return fail("เลือกประเภท hook จากรายการ", "hook");
    hookType = input.hookType;
  }
  const source = input.source ?? "owner";
  if (!SOURCES.includes(source)) return fail("เลือกว่าใครเป็นคนเห็น", "form");
  let group: string | null = null;
  if (input.customerGroup) {
    if (typeof input.customerGroup !== "string" || !(CUSTOMER_GROUPS as readonly string[]).includes(input.customerGroup)) return fail("เลือกกลุ่มลูกค้าจากรายการ", "form");
    group = input.customerGroup;
  }

  const metricKeys = ["followers", "views", "likes", "comments", "saves", "shares"] as const;
  const metrics: Record<string, number | null> = {};
  let anyAbbr = false;
  let anyValue = false;
  for (const k of metricKeys) {
    const m = parseMetric(String(input[k] ?? ""));
    if (!m.ok) return fail(m.error, k);
    metrics[k] = m.value;
    anyAbbr ||= m.abbreviated;
    anyValue ||= m.value !== null;
  }
  const approx = anyValue && (input.approx === true || anyAbbr);
  if (input.approx === true && !anyValue) return fail("ติ๊กว่าตัวเลขเป็นค่าประมาณ แต่ยังไม่ได้ใส่ตัวเลขสักช่อง", "views");

  const today = effectiveDateBangkok(new Date().toISOString());
  let postedOn: string | null = null;
  if (input.postedOn) {
    if (typeof input.postedOn !== "string" || !isCalendarDate(input.postedOn)) return fail("วันที่โพสต์คลิปไม่ถูกต้อง", "postedOn");
    if (input.postedOn > today) return fail("วันที่โพสต์คลิปอยู่ในอนาคตไม่ได้", "postedOn");
    postedOn = input.postedOn;
  }
  const account = cleanText(input.account) || hint.account;
  if (account && account.length > 100) return fail("ชื่อบัญชียาวเกินไป", "account");
  const why = cleanText(input.whyItWorks);
  if (why.length > 500) return fail("เหตุผลที่คิดว่าได้ผลยาวเกิน 500 ตัวอักษร", "form");

  const res = await callRpcDetailed<string>(
    "content_signal_capture",
    {
      p_kind: "reference_clip",
      p_summary: summary,
      p_source: source,
      p_seen_on: today,
      p_url: link.url,
      p_hook_text: hook,
      p_hook_type: hookType,
      p_platform: hint.platform,
      p_account: account || null,
      p_account_followers: metrics.followers,
      p_views: metrics.views,
      p_likes: metrics.likes,
      p_comments: metrics.comments,
      p_saves: metrics.saves,
      p_shares: metrics.shares,
      p_metrics_approx: approx,
      p_metrics_seen_on: anyValue ? today : null,
      p_posted_on: postedOn,
      p_customer_group: group,
      p_why_it_works: why || null,
    },
    "แปะลิงก์ไม่สำเร็จ ลองใหม่อีกครั้ง",
    { duplicate: "ลิงก์นี้เคยแปะแล้ว" }
  );
  if (!res.ok) {
    const dup = res.code === "23505";
    return {
      ok: false,
      error: res.error,
      field: dup ? "url" : undefined,
      duplicateId: dup && res.detail && isUuid(res.detail) ? res.detail : null,
    };
  }
  if (typeof res.data !== "string" || !isUuid(res.data)) return fail("แปะลิงก์ไม่สำเร็จ ลองใหม่อีกครั้ง", "form");
  revalidatePath("/marketing/research");
  return { ok: true, data: { id: res.data } };
}
