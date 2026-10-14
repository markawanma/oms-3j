// lib/marketing/signal-types.ts — สัญญาณ (content_signal) ฝั่งหน้าจอ: แถว + label + mapper (pure)
// ตัวเลขตัดสิน (mass_label / mass_ratio / is_unripe / save_rate) มาจาก v_content_signal ตรงๆ — ห้ามคำนวณซ้ำฝั่งจอ
// hook_text/hook_type ใน view = snapshot ตอนจับ (ห้ามนำไปแสดงเป็น "hook ของเรา") — ที่นี่เรียก "ประโยคเปิดตอนจับ"

export const SIGNAL_COLUMNS = [
  "id",
  "kind",
  "source",
  "seen_on",
  "url",
  "summary",
  "hook_text",
  "hook_type",
  "platform",
  "account",
  "account_followers",
  "views",
  "likes",
  "comments",
  "saves",
  "shares",
  "metrics_approx",
  "posted_on",
  "customer_group",
  "why_it_works",
  "status",
  "status_reason",
  "review_on",
  "picked_step_id",
  "mass_ratio",
  "mass_label",
  "is_unripe",
  "save_rate",
  "created_at",
].join(", ");

export const SIGNAL_STATUSES = ["new", "picked", "rejected", "deferred"] as const;
export type SignalStatus = (typeof SIGNAL_STATUSES)[number];

export const SIGNAL_STATUS_LABEL: Record<SignalStatus, string> = {
  new: "ใหม่",
  picked: "หยิบเป็นไอเดียแล้ว",
  rejected: "ไม่ใช้",
  deferred: "เก็บไว้ก่อน",
};

export const SIGNAL_SOURCE_LABEL: Record<string, string> = {
  owner: "คุณเห็นเอง",
  host: "คนไลฟ์เห็น",
  craftsman: "ช่างเห็น",
  ai_radar: "AI เรดาร์",
  ai_web: "AI ค้นเว็บ",
  system: "ระบบ",
};

/** ป้าย mass ตามที่ DB ตัดสิน — unknown = วัดไม่ได้ (แสดงวิวดิบ ไม่เดา) */
export const MASS_LABEL_TH: Record<string, string> = {
  mass: "คนดูมากกว่าผู้ติดตามมาก",
  normal: "คนดูพอๆ กับผู้ติดตาม",
  low: "คนดูน้อยกว่าผู้ติดตาม",
  unknown: "วัด mass ไม่ได้",
};

export interface SignalRow {
  id: string;
  kind: string;
  source: string;
  seenOn: string | null;
  url: string | null;
  summary: string;
  hookText: string | null;
  hookType: string | null;
  platform: string | null;
  account: string | null;
  followers: number | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  saves: number | null;
  shares: number | null;
  metricsApprox: boolean;
  postedOn: string | null;
  customerGroup: string | null;
  whyItWorks: string | null;
  status: string;
  statusReason: string | null;
  reviewOn: string | null;
  pickedStepId: string | null;
  massRatio: number | null;
  massLabel: string | null;
  isUnripe: boolean | null;
  saveRate: number | null;
  createdAt: string | null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const date = (v: unknown): string | null => str(v)?.slice(0, 10) ?? null;
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** แถว view ดิบ → SignalRow · ไม่มี id/kind = null (ข้ามแถว ไม่เดา) */
export function mapSignalRow(r: Record<string, unknown>): SignalRow | null {
  const id = str(r.id);
  const kind = str(r.kind);
  if (!id || !kind) return null;
  return {
    id,
    kind,
    source: str(r.source) ?? "owner",
    seenOn: date(r.seen_on),
    url: str(r.url),
    summary: typeof r.summary === "string" ? r.summary : "",
    hookText: str(r.hook_text),
    hookType: str(r.hook_type),
    platform: str(r.platform),
    account: str(r.account),
    followers: num(r.account_followers),
    views: num(r.views),
    likes: num(r.likes),
    comments: num(r.comments),
    saves: num(r.saves),
    shares: num(r.shares),
    metricsApprox: r.metrics_approx === true,
    postedOn: date(r.posted_on),
    customerGroup: str(r.customer_group),
    whyItWorks: str(r.why_it_works),
    status: str(r.status) ?? "new",
    statusReason: str(r.status_reason),
    reviewOn: date(r.review_on),
    pickedStepId: str(r.picked_step_id),
    massRatio: num(r.mass_ratio),
    massLabel: str(r.mass_label),
    isUnripe: typeof r.is_unripe === "boolean" ? r.is_unripe : null,
    saveRate: num(r.save_rate),
    createdAt: str(r.created_at),
  };
}

/** ตัวเลขดิบพร้อมหลักพัน — null = ไม่เห็น (แสดง "—" ไม่ใช่ 0) */
export function fmtMetric(n: number | null): string {
  return n === null ? "—" : n.toLocaleString("th-TH");
}
