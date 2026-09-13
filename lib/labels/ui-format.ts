// lib/labels/ui-format.ts — small display-only helpers shared by the label
// review UI (LabelReviewQueueRow / ProvinceFixPanel — brief 11 ก.ย. 69,
// "คิวใบปะหน้ากดได้ + แก้/ย้อนจังหวัด"). Pure formatting only, no DB access —
// plain module (no "use server", same reasoning as lib/labels/types.ts
// header: a "use server" file may only export async functions).

import type { CrmProvinceOption } from "@/lib/crm/order-override";
import type { OrderSourceRef } from "@/lib/labels/types";
// Relative import (not "@/...") on purpose — this is a VALUE import (not
// `import type`), and vitest.config.ts has no "@/" runtime alias configured
// (only tsconfig.json's `paths`, which Next's bundler honors but plain
// Vitest does not) — every other value import reachable from a vitest test
// in this repo already uses relative paths for the same reason (e.g.
// lib/labels/match.ts). A "@/..." VALUE import here would build fine under
// `next build` but fail this file's own vitest suite with "Failed to load
// url @/lib/tiktok/format".
import { formatThaiDateOnly } from "../tiktok/format";

// QA-2 fix (13 ก.ย. 69, R2-D2): the comment above USED to claim this mirrors
// supabase/migrations/0116_label_review_resolve.sql's p_taught_snippet check
// "EXACTLY" via a >=3-consecutive-ASCII-digit block — that was never true
// after the M3 security fix (12 ก.ย. 69) hardened the DB side to a full
// deny-list. See lib/labels/ui-format.test.ts's "parity with the actual DB
// deny-list" describe block for the proof this now closes.
//
// Real DB rule (0116 label_text_rule.pattern CHECK, ~line 328-333, and
// label_resolve_page's pre-check, ~line 707-712 — kept in sync manually
// between those two, same duplication-risk note as the reason-code CHECKs):
// length 1-25, reject ANY digit of ANY script (ASCII, Thai ๐-๙, full-width
// ０-９, plus whatever [:digit:] catches on top — locale-dependent so the
// DB doesn't rely on it alone) AND reject ANY [:punct:] (ASCII punctuation
// in this DB's locale).
//
// TAUGHT_SNIPPET_DENY_RE below is a client-side SUPERSET of that, not a
// byte-exact port (JS regex has no [:punct:]/[:digit:] POSIX classes tied to
// a Postgres locale to copy 1:1) — brief's rule: "client ปฏิเสธมากกว่า DB
// ปลอดภัยกว่า แต่ห้ามหลวมกว่า":
//   - \p{Nd} (Unicode "decimal digit") is a strict superset of the DB's four
//     digit checks combined — it already contains ASCII 0-9, Thai ๐-๙, and
//     full-width０-９, so one Unicode property class covers all of them plus
//     any other script's decimal digits, matching the DB's own "any other
//     script's digits the locale recognizes" catch-all.
//   - \p{P} (Unicode punctuation) ALONE is not enough — several ASCII
//     POSIX-punct characters ($ + < = > ^ ` | ~) are Unicode Symbol (S), not
//     Punctuation (P). \p{P} + \p{S} together is a strict superset of ASCII
//     [:punct:], so nothing the DB denies can slip past this.
// Net effect: this may reject a small set of symbols (e.g. ฿, ™) that the
// DB's ASCII-only [:punct:] would technically allow — acceptable per brief,
// never the other direction.
export const TAUGHT_SNIPPET_MAX_LENGTH = 25;
export const TAUGHT_SNIPPET_DENY_RE = /[\p{Nd}\p{P}\p{S}]/u;

export const UNKNOWN_PROVINCE_CODE = "TH-XX";

export function isRealProvinceCode(code: string | null | undefined): boolean {
  return !!code && code !== UNKNOWN_PROVINCE_CODE;
}

export function provinceNameByCode(provinces: CrmProvinceOption[], code: string | null | undefined): string {
  if (!code) return "—";
  if (code === UNKNOWN_PROVINCE_CODE) return "ไม่ทราบจังหวัด";
  return provinces.find((p) => p.code === code)?.nameTh ?? code;
}

/** null = ผ่าน, string = ข้อความ error ที่ควรกันไม่ให้กดส่ง (ตรงกับด่านฝั่ง DB) */
export function validateTaughtSnippet(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null; // ว่างได้เสมอ — ไม่บังคับ
  if (trimmed.length > TAUGHT_SNIPPET_MAX_LENGTH) {
    return `ข้อความสอนยาวเกิน ${TAUGHT_SNIPPET_MAX_LENGTH} ตัวอักษร`;
  }
  if (TAUGHT_SNIPPET_DENY_RE.test(trimmed)) {
    return "ห้ามมีตัวเลขหรือเครื่องหมาย ใส่แค่คำ เช่น ลาดกระบัง";
  }
  return null;
}

/** "วันที่ · ช่องทาง" หนึ่งบรรทัด — Mace L7 (owner requirement, 13 ก.ย. 69):
 * ProvinceFixPanel ต้องโชว์ค่านี้ต่อผลค้นหา backend ส่ง orderDate/channelName
 * มาแล้ว (findOrdersByTracking-only, ดู OrderSourceRef field comments ใน
 * lib/labels/types.ts) — รวมกัน + จัดรูปแบบวันที่ไทยที่นี่แทนที่จะซ้ำ logic
 * ใน component เอง. formatThaiDateOnly มาจาก lib/tiktok/format.ts (ใช้ซ้ำ
 * ของเดิม ไม่ทำ Intl.DateTimeFormat อีกชุด). ใช้ Pick แทน OrderSourceRef
 * เต็มตัวเพื่อให้ helper นี้เรียกได้จากที่อื่นที่มีแค่สองฟิลด์นี้ด้วย. */
export function orderDateChannelLine(o: Pick<OrderSourceRef, "orderDate" | "channelName">): string {
  const dateLabel = o.orderDate ? formatThaiDateOnly(o.orderDate) : null;
  const channelLabel = o.channelName ?? null;
  if (dateLabel && channelLabel) return `${dateLabel} · ${channelLabel}`;
  if (dateLabel) return dateLabel;
  if (channelLabel) return channelLabel;
  return "—";
}

export const PROVINCE_SOURCE_LABEL: Record<OrderSourceRef["provinceSource"], string> = {
  import: "จากไฟล์นำเข้า",
  label: "จากใบปะหน้า",
  manual: "แก้มือ",
};

/** หนึ่งบรรทัด "ที่มา" ของออเดอร์ — decision #3 (11 ก.ย.): "ทุกแถวต้องบอกที่มา
 * ให้เจ้าของเปิดอ่านเองได้" — เลขออเดอร์ + จังหวัดปัจจุบัน + ที่มาของจังหวัดนั้น +
 * ไฟล์/แถวที่นำเข้ามา (ถ้ามี). */
export function orderSourceLine(o: OrderSourceRef, provinces: CrmProvinceOption[]): string {
  const province = provinceNameByCode(provinces, o.provinceCode);
  const importedFrom = o.importFileName
    ? `นำเข้าจาก ${o.importFileName}${o.sourceRowNo != null ? ` แถว ${o.sourceRowNo}` : ""}`
    : "ไม่มีข้อมูลไฟล์นำเข้า";
  return `ออเดอร์ ${o.sourceOrderNo} — จังหวัดปัจจุบัน: ${province} (${PROVINCE_SOURCE_LABEL[o.provinceSource]}) · ${importedFrom}`;
}
