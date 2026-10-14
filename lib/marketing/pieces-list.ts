// lib/marketing/pieces-list.ts — ตรรกะ pure ของหน้า "ชิ้นงานทั้งหมด" (/marketing/pieces · แผน §2.6 ข)
// D15: v_content_piece ช้าต่อแถว (~4ms) → ต้องกรองสถานะ/ช่วงวันเสมอ + แบ่งหน้า 50 · ไม่ใช้ count แบบเต็ม (ดึง 51 แถวเพื่อรู้ว่ามีหน้าถัดไป)

import { addDays } from "@/lib/marketing/calendar-view";
import { CHANNELS, pieceStatusLabel } from "@/lib/marketing/piece-labels";
import { isUuid } from "@/lib/marketing/piece-input";

export const PAGE_SIZE = 50;
export const POSTED_WINDOW_DAYS = 60;
export const MAX_PAGE = 200;
export const MAX_Q_LENGTH = 80;

/** สถานะดิบ (piece_status) ที่ถือว่า "ยังไม่ปิด" */
export const OPEN_STATUSES = ["idea", "planned", "drafting", "in_review", "approved", "produced"] as const;

export const STATUS_KEYS = ["open", "idea", "planned", "drafting", "in_review", "approved", "produced", "posted", "cancelled"] as const;
export type StatusKey = (typeof STATUS_KEYS)[number];

export const STATUS_CHIP_LABEL: Record<StatusKey, string> = {
  open: "ยังไม่ปิด",
  idea: pieceStatusLabel("idea"),
  planned: pieceStatusLabel("planned"),
  drafting: pieceStatusLabel("drafting"),
  in_review: pieceStatusLabel("in_review"),
  approved: pieceStatusLabel("approved"),
  produced: pieceStatusLabel("produced"),
  posted: `โพสต์แล้ว (${POSTED_WINDOW_DAYS} วันล่าสุด)`,
  cancelled: "ยกเลิก",
};

export interface PiecesQuery {
  status: StatusKey;
  /** status=open เท่านั้น: รวมชิ้นที่โพสต์แล้วใน 60 วันล่าสุดด้วย */
  withPosted: boolean;
  campaign: string;
  channel: string;
  q: string;
  page: number;
}

type Sp = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? "") : (v ?? ""));

export function parsePiecesQuery(sp: Sp): PiecesQuery {
  const statusRaw = first(sp.status);
  const status = (STATUS_KEYS as readonly string[]).includes(statusRaw) ? (statusRaw as StatusKey) : "open";
  const campaignRaw = first(sp.campaign);
  const channelRaw = first(sp.channel);
  const pageRaw = Number.parseInt(first(sp.page), 10);
  return {
    status,
    withPosted: status === "open" && first(sp.posted) === "1",
    campaign: isUuid(campaignRaw) ? campaignRaw : "",
    channel: (CHANNELS as readonly string[]).includes(channelRaw) ? channelRaw : "",
    q: cleanSearch(first(sp.q)),
    page: Number.isInteger(pageRaw) && pageRaw >= 1 ? Math.min(pageRaw, MAX_PAGE) : 1,
  };
}

/** ตัดช่องว่างซ้ำ/อักขระควบคุม + จำกัดความยาว (ค้นชื่อ) */
export function cleanSearch(raw: string): string {
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_Q_LENGTH);
}

/** pattern ของ ILIKE (PostgREST ใช้ * แทน %) — ตัดอักขระพิเศษของ LIKE/PostgREST ให้เป็นตัวอักษรธรรมดา */
export function ilikePattern(q: string): string {
  const safe = q.replace(/[\\%_*]/g, " ").replace(/\s+/g, " ").trim();
  return `*${safe}*`;
}

export function postedSince(todayTh: string): string {
  return addDays(todayTh, -POSTED_WINDOW_DAYS);
}

/** ลิงก์หน้า list (ไม่ใส่ค่าเริ่มต้น/ค่าว่าง) — เปลี่ยนตัวกรองแล้วกลับหน้า 1 เสมอ ยกเว้นระบุ page */
export function piecesHref(q: PiecesQuery, over: Partial<PiecesQuery> = {}): string {
  const m = { ...q, page: 1, ...over };
  const p = new URLSearchParams();
  if (m.status !== "open") p.set("status", m.status);
  if (m.status === "open" && m.withPosted) p.set("posted", "1");
  if (m.campaign) p.set("campaign", m.campaign);
  if (m.channel) p.set("channel", m.channel);
  if (m.q) p.set("q", m.q);
  if (m.page > 1) p.set("page", String(m.page));
  const qs = p.toString();
  return qs ? `/marketing/pieces?${qs}` : "/marketing/pieces";
}

export function hasActiveFilter(q: PiecesQuery): boolean {
  return q.status !== "open" || q.withPosted || !!q.campaign || !!q.channel || !!q.q;
}

/** เรียงใกล้ก่อนสำหรับชิ้นที่ยังไม่ปิด · ใหม่สุดก่อนสำหรับโพสต์แล้ว/ยกเลิก/รวมโพสต์ */
export function sortAscending(q: PiecesQuery): boolean {
  return q.status !== "posted" && q.status !== "cancelled" && !q.withPosted;
}
