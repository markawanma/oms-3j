// lib/labels/types.ts — shared contract between the label-upload backend
// (lib/actions/labels.ts, lib/labels/*) and the UI (Luke/frontend-dev).
//
// ⚠️ This is the seam the frontend builds against — do NOT rename fields or
// change shapes here without checking with Tech Lead first (per brief).
//
// Plain module — no "use server" here (only lib/actions/labels.ts has that
// directive; a "use server" file may only export async functions, and these
// are types/consts, see lesson in supabase/migrations comment history /
// 0ae940d "แก้ build ล้ม — export const ในไฟล์ use server").

export type LabelParseSummary = {
  fileId: string;
  fileName: string;
  pageCount: number;
  applied: number; // เติมจังหวัดสำเร็จ
  skippedHasProvince: number; // ออเดอร์มีจังหวัดตรงกันอยู่แล้ว
  conflictCount: number; // ใบบอกจังหวัดอื่นที่ไม่ตรงของเดิม
  needsReview: number; // จับคู่ไม่ชี้ขาด รอคนเลือก
  orderNotFound: number; // tracking ไม่เจอออเดอร์
  undetectedFormat: number; // ไม่รู้ว่าใบเจ้าไหน
  parseFailedPages: number; // หน้าอ่านไม่ออก (เช่นไม่มี text layer)
  reviewRows: LabelReviewRow[];
};

export type LabelReviewRow = {
  pageId: string;
  pageNo: number;
  trackingNo: string | null;
  zipcode: string | null;
  status: "needs_review" | "conflict" | "order_not_found" | "undetected" | "parse_failed";
  candidates: { code: string; nameTh: string }[];
  /** Set only when status === 'undetected' AND we recognize this specific
   * page shape as a known non-label page (e.g. TikTok's trailing
   * packing-slip-only page — see lib/labels/formats/tiktok.ts
   * looksLikePackingSlipOnly()) — lets the UI say "this page just isn't a
   * label, nothing to do" instead of "unrecognized format, needs a fix."
   * undefined = no known reason (genuinely unrecognized page). */
  reason?: "packing_slip_only";
};

export type CreateLabelUploadResult = {
  fileId: string;
  uploadUrl: string | null; // null = ไฟล์นี้เคยอัปแล้ว (dedupe) ข้ามไป parse ได้เลย
  alreadyExists: boolean;
};

// รายการไฟล์ในประวัติ (getLabelFiles) — รูปทรงตรงกับ LabelFileRow ฝั่ง action
// (pageCount เป็น null ได้ก่อน parse เสร็จ)
export type LabelFileListItem = {
  id: string;
  fileName: string;
  pageCount: number | null;
  status: "uploaded" | "parsed" | "parse_failed" | "purged";
  uploadedAt: string;
  // ปุ่ม "อ่านใหม่" (task brief 4 ก.ย. 69) — บอกว่ากดแล้วคุ้มไหม ไม่ใช่แค่ทำได้ไหม
  // null = คำนวณไม่ได้ (ส่วนนี้ล้มเหลวแบบ best-effort) → UI ต้องไม่แสดงบรรทัดคำใบ้เลย
  // ไม่ใช่เดาว่าเป็น 0 — ดูคอมเมนต์ getLabelFiles() ใน lib/actions/labels.ts
  orderNotFoundCount: number | null; // จำนวนหน้า match_status = 'order_not_found' ของไฟล์นี้
  rematchableCount: number | null; // ในนั้น กี่หน้าที่ tracking_no เจอใน fact_order แล้วตอนนี้ (คุ้มกดอ่านใหม่)
};

// ============================================================================
// Phase A — คิวกดได้ + แก้/ย้อนจังหวัด + เก็บการสอน (design scratchpad
// design-label-teach-loop-yoda-11sep.md §5 A, owner decisions 11 ก.ย. 69,
// migration 0116_label_review_resolve.sql)
// ============================================================================

// Owner 11 ก.ย. 69, decision #1: "ตั้งกลับเป็น TH-XX ได้ แต่เหตุผลต้องเป็น
// ตัวเลือกให้กด" — fixed code set, enforced as a real CHECK constraint on
// analytics.stg_label_page.applied_reason AND inside every RPC that accepts
// a reason (see 0116 §1/§5) — this array/options list is the TS mirror of
// that same fixed set. If it ever needs to change, the CHECK constraints in
// 0116 must change in the same migration (3 independent enforcement points
// — flagged as a duplication-risk in the backend handoff).
export const LABEL_REASON_CODES = [
  "no_data_yet",
  "unreadable",
  "wrong_label",
  "customer_moved",
  "other",
] as const;

export type LabelReasonCode = (typeof LABEL_REASON_CODES)[number];

export const LABEL_REASON_OPTIONS: { code: LabelReasonCode; label: string }[] = [
  { code: "no_data_yet", label: "ยังไม่มีข้อมูล/รอใบปะหน้า" },
  { code: "unreadable", label: "ใบอ่านไม่ชัด" },
  { code: "wrong_label", label: "ใบปะหน้าผิดออเดอร์" },
  { code: "customer_moved", label: "ลูกค้าแจ้งย้ายที่อยู่" },
  { code: "other", label: "อื่นๆ" },
];

/** Full set of analytics.stg_label_page.match_status values, including the
 * two terminal "a human acted on this" states added by 0116. LabelReviewRow
 * above stays scoped to the review-QUEUE subset (matched/manual_applied are
 * never shown there) — this broader type is for pages read outside that
 * queue context (e.g. getLabelPageViewUrl/getLabelPageSnippet callers that
 * already have a specific page id and need to know its full possible state). */
export type LabelPageStatus =
  | "matched"
  | "needs_review"
  | "conflict"
  | "order_not_found"
  | "undetected"
  | "parse_failed"
  | "manual_applied"
  | "ignored";

// getPendingLabelReviews() — คิวรอตรวจ "ทั้งร้าน" อ่านจาก DB ตรง (ไม่ใช่ state
// ของรอบอัปโหลดล่าสุดเหมือน LabelParseSummary.reviewRows) ต้องมีชื่อไฟล์ติดมา
// ด้วยเพราะคิวนี้รวมได้หลายไฟล์พร้อมกัน — ไม่งั้นไม่รู้ว่าหน้าไหนมาจากไฟล์ไหน
// (design brief บั๊ก 2, 29 ส.ค. 69).
//
// orderSources (owner 11 ก.ย., decision #3 "ทุกแถวต้องบอกที่มาให้เจ้าของเปิด
// อ่านเองได้"): ฝั่งออเดอร์ของหน้านี้ (ถ้า trackingNo จับคู่ fact_order ได้แล้ว)
// — ว่างเปล่าถ้ายังไม่มี fact_order ให้จับคู่ (เช่น order_not_found หรือหน้าไม่มี
// trackingNo เลย).
export type PendingLabelReviewRow = LabelReviewRow & {
  fileId: string;
  fileName: string;
  orderSources: OrderSourceRef[];
};

// ฝั่งออเดอร์ของ "ที่มา" — ใช้ทั้งใน PendingLabelReviewRow.orderSources และ
// findOrdersByTracking() (owner 11 ก.ย., decision #3: "ฝั่งออเดอร์ =
// stg_import_batch.file_name + stg_order_import.source_row_no ของแถวล่าสุดที่
// fact_order_id ชี้มา"). importFileName/sourceRowNo เป็น null เมื่อออเดอร์นี้ไม่มี
// แถว stg_order_import ผูกอยู่เลย (เช่น มาจากที่อื่นที่ไม่ใช่ Excel import ปกติ).
// frontend-dev request (12 ก.ย. 69, ProvinceFixPanel UI on
// feature/label-review-resolve-ui): orderDate/channelName/hasRevertableHistory
// are populated by findOrdersByTracking() ONLY — getPendingLabelReviews()
// has its own separate order-lookup (a different query shape, keyed by
// tracking_no across many review-queue rows at once) and does not populate
// them, so they're optional here rather than widening that other call
// site's work for fields its current UI doesn't ask for. A consumer of
// PendingLabelReviewRow.orderSources must treat these as always absent.
export type OrderSourceRef = {
  factOrderId: string;
  sourceOrderNo: string;
  trackingNo: string | null;
  provinceCode: string;
  provinceSource: "import" | "label" | "manual";
  importFileName: string | null;
  sourceRowNo: number | null;
  /** "YYYY-MM-DD" — findOrdersByTracking() only, see note above. */
  orderDate?: string;
  /** analytics.dim_channel.name — findOrdersByTracking() only. null if the
   * order's channel_id doesn't resolve to a channel row (shouldn't happen,
   * fact_order.channel_id is NOT NULL + FK'd, but defensive). */
  channelName?: string | null;
  /** true iff clicking "ย้อนกลับ" (revertOrderProvince) would actually
   * succeed right now — findOrdersByTracking() only, undefined elsewhere
   * (treat as false). Mace M1 fix (13 ก.ย. 69, security), REVISED after
   * code-review (C-3PO, 13 ก.ย. 69 — an earlier version of this flag used
   * mere existence of a province_set/province_revert row, which mismatched
   * the RPC and left 3 false-positive cases): mirrors
   * analytics.label_revert_order_province's own predicate EXACTLY (0116,
   * ~line 598-626 + ~line 478-542) — (1) a crm_audit_log row with
   * action='province_set' exists for this order (most recent one, by
   * created_at) AND (2) that row's `after->>'province_code'` still equals
   * this order's CURRENT provinceCode (i.e. nothing changed the province
   * again since). Both conditions computed server-side in
   * lib/actions/labels.ts's attachOrderSources() — only the boolean result
   * crosses into this type, never the raw crm_audit_log.before/after jsonb
   * (that must never reach the client — internal change-log payload, not a
   * value the UI needs to render). The RPC remains the real gate regardless
   * (race condition between this read and the click is still possible) —
   * this flag is a UI-only prediction of what the RPC will decide, not a
   * substitute for its own check. */
  hasRevertableHistory?: boolean;
};

// getLabelPageViewUrl() — owner 11 ก.ย., decision #2(ก): signed URL 60 วิ +
// #page=N ให้เปิดดูใบจริงหน้านั้นตรงๆ (ไม่ใช่ทั้งไฟล์).
export type LabelPageViewUrlResult = {
  url: string;
};

// getLabelPageSnippet() — owner 11 ก.ย., decision #2(ข): re-extract สด ±80
// ตัวอักษรรอบ zipcode, mask เลขติดกัน >=9 หลัก, ไม่เก็บไม่ log ที่ไหนเลย
// (ผลลัพธ์นี้ส่งตรงไปจอแล้วทิ้ง — ไม่มี action ไหนอื่นเขียนค่านี้ลง DB).
export type LabelPageSnippetResult = {
  /** null = อ่านข้อความหน้านี้ไม่ได้เลย (ไม่มี text layer) หรือหา zipcode/ตัวเลข
   * 5 หลักใดๆ ในข้อความไม่เจอเลย — ไม่ใช่ error, แค่ไม่มีอะไรให้โชว์ */
  snippet: string | null;
  /** true เมื่อ snippet ถูกตัดรอบ zipcode ที่บันทึกไว้จริง (stg_label_page.zipcode)
   * — false เมื่อใช้ fallback (เจอเลข 5 หลักอื่นในข้อความแทน หรือไม่เจอเลย) */
  zipcodeFound: boolean;
};

// resolveLabelPage() ผลลัพธ์
export type ResolveLabelPageResult = {
  /** จำนวน fact_order ที่ถูกเขียนจังหวัดจริง (tracking เดียวอาจตรงได้หลายใบ —
   * design §5, set-based เหมือน label_apply_matched) */
  appliedOrders: number;
};
