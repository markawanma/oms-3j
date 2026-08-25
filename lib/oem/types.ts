// lib/oem/types.ts — types shared by the OEM pricing-floor write layer
// (lib/actions/oem.ts) and its client UI. Kept OUT of the "use server" file
// (which may only export async functions), same split as lib/catalog/types.ts.
//
// Column/shape mirrors, 1:1, of:
//   supabase/migrations/0061_oem_cost_rate.sql  (oem_rate_def, oem_cost_rate,
//     oem_setting, oem_metal_price, v_oem_rate_status, v_oem_readiness)
//   supabase/migrations/0062_oem_quote_calc.sql (oem_price_calc's jsonb
//     return, oem_quote, v_oem_quote)
//
// IMPORTANT: there is no pricing formula anywhere in this file or in
// lib/actions/oem.ts. The only implementation of §2.2's 6-line formula is
// analytics.oem_price_calc (0062) — everything here is shape only.

export type OemMetal = "silver" | "gold" | "brass" | "silver999";

/** The 3 metals oem_metal_price (per-gram spot pricing) applies to —
 * silver999 (เงินแท่ง) is explicitly EXCLUDED: bar prices come from
 * analytics.silver_price_daily (a fixed sell price per size, not a per-gram
 * rate an admin enters), so OemMetalPriceMap below must not gain a 4th key
 * just because OemMetal did. See docs/3j-jewelry/analytics/design-oem-bar-quote.md D1. */
export type OemProductionMetal = Exclude<OemMetal, "silver999">;

/** เงินแท่ง 99.99% ขนาดที่ขายจริง — 0.5/1/3/5/10 บาท ใช้คอลัมน์
 * bar_0_5_baht…bar_10_baht ของ silver_price_daily; 1_kg ใช้ kilo_sell_vat
 * (ทั้งใบ VAT-inclusive ตามมติ) ไม่ใช่ kilo_sell — ห้าม "ปรับปรุง" ไปใช้ตัวนั้น. */
export type OemBarSize = "0_5_baht" | "1_baht" | "3_baht" | "5_baht" | "10_baht" | "1_kg";

export const OEM_BAR_SIZE_LABEL_TH: Record<OemBarSize, string> = {
  "0_5_baht": "0.5 บาท",
  "1_baht": "1 บาท",
  "3_baht": "3 บาท",
  "5_baht": "5 บาท",
  "10_baht": "10 บาท",
  "1_kg": "1 กิโลกรัม",
};

export type OemInputUnit =
  | "pieces_per_day"
  | "pieces_per_hour"
  | "minutes_per_piece"
  | "thb_per_day"
  | "thb_per_batch"
  | "thb_per_piece"
  | "thb_per_unit"
  | "pieces_per_batch"
  | "uses_per_mold"
  | "pct"
  | "count"
  | "hours_per_day"
  | "seeds_per_hour"
  | "thb_per_gram";

export type OemScopeKind = "none" | "material" | "tier" | "dept" | "plating" | "item_kind";
export type OemCostBucket = "nre" | "batch" | "piece" | "seed" | "rate" | "policy";
export type OemPriority = "P0" | "P1" | "P2";
export type OemAppliesWhen = "always" | "if_plating" | "if_setting" | "if_new_design" | "if_gold";

// ============================================================================
// Rate status / readiness (v_oem_rate_status, v_oem_readiness)
// ============================================================================

/** One (rate_key, scope) row — a rate_def item crossed with every scope value
 * it's expected to have (oem_rate_scope_option), LEFT JOINed against the
 * shop's latest answer. is_missing=true means the intake form still needs
 * this cell filled in. */
export interface OemRateStatusRow {
  rateKey: string;
  scope: string;
  groupCode: string;
  seq: number;
  labelTh: string;
  questionTh: string;
  inputUnit: OemInputUnit;
  scopeKind: OemScopeKind;
  costBucket: OemCostBucket | null;
  priority: OemPriority;
  appliesWhen: OemAppliesWhen;
  dependsOn: string[] | null;
  value: number | null;
  effectiveFrom: string | null;
  note: string | null;
  isMissing: boolean;
}

/** v_oem_readiness — the single number the intake checklist page leads with:
 * can this shop price ANY OEM job yet (baseline P0/applies_when=always
 * items only — job-specific P0s like plating are checked per-quote by
 * getMissingRates instead). */
export interface OemReadiness {
  p0Total: number;
  p0Filled: number;
  p0Missing: number;
  canQuote: boolean;
}

export interface UpsertOemRateInput {
  rateKey: string;
  value: number;
  /** '-' (or omitted) for scope_kind='none' rates; a real scope value
   * (e.g. 'silver', 'ขัด', 'แหวน') otherwise — see oem_rate_scope_option. */
  scope?: string | null;
  effectiveFrom?: string | null;
  note?: string | null;
}

export interface DeleteOemRateInput {
  rateKey: string;
  scope: string;
  effectiveFrom: string;
}

// ============================================================================
// Shop settings (oem_setting)
// ============================================================================

export interface OemSettingData {
  /** all *_pct fields are fractions 0..1 (e.g. 0.30 = 30%). */
  marginTargetPct: number;
  marginDiscountCapPct: number;
  marginFloorPct: number;
  marginHardFloorPct: number;
  nreMaxSharePct: number;
  minJobValueThb: number;
  quoteValidDaysSilver: number;
  quoteValidDaysGold: number;
  quoteValidDaysBrass: number;
  /** 0078: margin แฝงอยู่ในราคาเว็บของเงินแท่งอยู่แล้ว (ไม่กระทบราคาที่ลูกค้าเห็น) —
   * ใช้อนุมานต้นทุนย้อนกลับ (cost = price × (1 − barMarginPct)) เพื่อให้รายการ
   * เงินแท่งไหลเข้าด่านส่วนลด/margin ขั้นต่ำแบบเดียวกับงานผลิต ไม่ใช่ตัวตั้งราคา —
   * ดู D2 ใน design-oem-bar-quote.md. */
  barMarginPct: number;
  formulaVersion: number;
}

export interface UpsertOemSettingInput {
  marginTargetPct?: number | null;
  marginDiscountCapPct?: number | null;
  marginFloorPct?: number | null;
  marginHardFloorPct?: number | null;
  nreMaxSharePct?: number | null;
  minJobValueThb?: number | null;
  quoteValidDaysSilver?: number | null;
  quoteValidDaysGold?: number | null;
  quoteValidDaysBrass?: number | null;
  barMarginPct?: number | null;
}

// ============================================================================
// SKU picker (analytics.v_dim_product, read-only) — lets a quote item label
// itself with an existing product for traceability. NEVER returns
// unit_cost/effective_unit_cost/list_price/margin_pct — those are retail
// cost/margin figures, unrelated to (and more sensitive than) OEM job
// pricing, which analytics.oem_price_calc computes independently. As of
// 2026-08, silver_weight_g is null on all 301 SKUs and silver_purity is a
// flat 0.925 across the board, so this deliberately does NOT try to prefill
// weight/purity from a selected SKU — see QuoteJobItemCard's picker copy,
// which says so out loud rather than let the user assume it did.
// ============================================================================

export interface OemProductOption {
  productId: string;
  sku: string;
  name: string;
  category: string | null;
}

// ============================================================================
// Metal price (oem_metal_price)
// ============================================================================

export interface SaveMetalPriceInput {
  metal: OemMetal;
  priceThbPerGram: number;
  asOfDate?: string | null;
  source?: "manual" | "feed" | "sheet";
}

/** Latest known price per metal (analytics.oem_metal_price, one row per
 * metal — the shop's current answer, not history). null = never set.
 * OemProductionMetal (not OemMetal) — silver999 is never a key here. */
export type OemMetalPriceMap = Record<OemProductionMetal, { priceThbPerGram: number; asOfDate: string; source: string } | null>;

// ============================================================================
// Price calc (oem_price_calc jsonb contract — mirrors the shape documented in
// 0062's header comment, 1:1). This is a PREVIEW shape only; the formula that
// produces it lives exclusively in analytics.oem_price_calc.
// ============================================================================

export interface OemPriceCalcInput {
  metal: OemMetal;
  /** matches oem_rate_scope_option for flask_capacity_pieces, e.g. 'แหวน'.
   * Required for silver/gold/brass; unused/absent for metal='silver999'
   * (bar mode has no item_kind — see D3 in design-oem-bar-quote.md). */
  itemKind?: string;
  /** 'เรียบ' | 'ปานกลาง' | 'ละเอียด'. Unused for silver999. */
  polishTier?: string;
  /** pieces (production metals) or bars (silver999) — same field, different unit label in the UI. */
  qty: number;
  /** net metal weight per piece, grams. Unused for silver999 — a bar's
   * weight is implied by barSize (not linear across sizes), never entered. */
  weightG?: number;
  /** default true server-side if omitted (assume NRE applies unless told otherwise). Unused for silver999. */
  isNewDesign?: boolean;
  /** required for gold (no safe default across K); silver/brass default. Unused for silver999. */
  purity?: number | null;
  /** 'ทอง' | 'โรเดียม' | 'พิงค์โกลด์'; omit/null = no plating. Unused for silver999. */
  platingType?: string | null;
  /** 'เล็ก' | 'กลาง' | 'ใหญ่'; omit/null = no gems. Unused for silver999. */
  gemTier?: string | null;
  /** gems per piece; default 0. Unused for silver999. */
  gemCount?: number | null;
  /** default current_date — pins metal price + rate lookups (reprint uses the saved quote's value).
   * 0078: for silver999 this is CLIENT-SIDE DISPLAY ONLY (what price the user saw when they
   * built the quote) — the server always looks up TODAY (Asia/Bangkok), never this value,
   * so a client can't pin an old bar price. See D3. */
  asOfDate?: string | null;
  /** margin to CHARGE, fraction [0,1) — 0063: omit to use oem_setting.margin_target_pct.
   * This is the number floors.margin judges (not the blended margin_actual_pct).
   * Not applicable to silver999 — margin there is inferred from oem_setting.bar_margin_pct
   * server-side and never accepted from the client (D2 §3 — accepting it would let a
   * caller fake a margin to dodge the discount/floor gates). */
  marginPct?: number | null;
  /** 0078 (silver999 only): 0.5/1/3/5/10 บาท / 1 กก. — required when metal='silver999'. */
  barSize?: OemBarSize | null;
  /** 0078 (silver999 only): ค่ายิงเลเซอร์รูปภาพ บาท/ชิ้น, optional, >= 0. */
  engraveImageThb?: number | null;
  /** 0078 (silver999 only): ค่ายิงเลเซอร์ตัวอักษร บาท/ชิ้น, optional, >= 0. */
  engraveTextThb?: number | null;
}

export interface OemMissingRateEntry {
  rateKey: string;
  scope: string;
  questionTh: string;
  priority: OemPriority;
}

export interface OemLaborStep {
  key: string;
  minutes: number | null;
  thb: number;
}

export interface OemBatchLine {
  key: "flask" | "plating";
  capacity: number | null;
  count: number | null;
  cost: number | null;
}

/** 0078: breakdown.bar — present (non-null) only when metal='silver999'.
 * The snapshot of what was actually charged for the bar itself, deliberately
 * WITHOUT kilo_buy/buy_per_baht (buy-back price) anywhere — see D3's
 * "ห้ามเด็ดขาด" note. marginPctEmbedded is report-only (never gates anything —
 * see floors.margin.value staying null for bar items). */
export interface OemBarBreakdown {
  size: OemBarSize;
  /** silver_price_daily column this size read from (e.g. 'bar_1_baht', 'kilo_sell_vat') — debug/audit only. */
  priceColumn: string;
  /** the bar's own sell price for this size, EXCLUDING engrave — same number checkable on the shop's own website. */
  barPricePerPiece: number | null;
  engraveImageThb: number | null;
  engraveTextThb: number | null;
  /** oem_setting.bar_margin_pct at calc time — report-only (see D2/D3, never gates a floor). */
  marginPctEmbedded: number | null;
  /** "today" (Asia/Bangkok) the server looked up — null when no row was found for today. */
  asOfDate: string | null;
  /** e.g. "13:02" — which scrape slot (09/13/20) this row came from, when known. */
  sheetTime: string | null;
  capturedAt: string | null;
  source: string | null;
}

export interface OemPriceBreakdown {
  qRun: number;
  rejectPctTotal: number;
  metal: {
    perPiece: number;
    grossLossPct: number | null;
    /** 0066: metal lost as polishing dust — recovery ~0, charged in full
     * (§1.5, โลหะที่หายตอนขัด). Not netted by recovery_rate_pct — see 0066
     * header. null = polish_loss_pct not filled in yet. */
    polishLossPct: number | null;
    /** 0066: what basis effective_loss_pct/metal_loss_multiplier were computed
     * on — currently always 'effective' when present; kept for audit. */
    lossBasis: string | null;
    /** 0066: THIS is the loss rate actually used in the formula (L_eff =
     * grossLossPct * (1 - recovery) + polishLossPct). Was already returned by
     * 0062 but nothing read it — see OemCalcBreakdown for why it must be shown. */
    effectiveLossPct: number | null;
    /** 0066: 1 + effectiveLossPct — the multiplier actually applied to the raw
     * metal value. */
    metalLossMultiplier: number | null;
    priceUsed: number | null;
    priceSource: string | null;
  };
  labor: { perPiece: number; steps: OemLaborStep[] };
  batch: { perPiece: number; lines: OemBatchLine[] };
  nre: { cad: number | null; print3d: number | null; mold: number | null; cost: number; price: number };
  /** 0078: non-null only when metal='silver999'. null for every production item. */
  bar?: OemBarBreakdown | null;
  costPiece: number;
  pricePerPiece: number;
  /** null when is_complete=false — do not trust/display a partial total. */
  quoteTotal: number | null;
  /** BLENDED margin over the whole job (incl. pass-through metal) — reported
   * only, never gated. Null when is_complete=false. For gold this is much
   * lower than marginPctUsed by design (§2.3) — see floors.margin.blended,
   * same number, kept here too since 0062 always returned it at this path. */
  marginActualPct: number | null;
  /** 0063: the margin rate actually applied while pricing (input marginPct,
   * else oem_setting.margin_target_pct). Same value as floors.margin.value. */
  marginPctUsed: number;
}

export type OemMarginState = "ok" | "discount_zone" | "needs_approval_note" | "hard_floor_breach" | null;

export interface OemFloors {
  qty: { pass: boolean | null; moq: number | null; actual: number };
  jobValue: { pass: boolean | null; min: number };
  metalWeight: { pass: boolean | null; applies: boolean };
  /** 0063: `value` (margin CHARGED) is what state/pass is judged on — this is
   * the decision variable. `blended` is the whole-job margin incl. pass-
   * through metal, display-only (gold's blended is ~0.3% by design, not a
   * bug — see 0063 header). `target` is oem_setting.margin_target_pct, for
   * showing "vs. your usual target" context. */
  margin: { state: OemMarginState; value: number | null; blended: number | null; target: number | null };
  /** 0078: present only when metal='silver999' — "is today's bar price on file at
   * all" (server always looks up TODAY, Asia/Bangkok, `=` only, no yesterday
   * fallback). pass=false is what blocks quoted status for a bar item (see the
   * missing[] entry with rate_key='silver_bar_price' for the reason to show). */
  priceFresh?: { pass: boolean; asOfDate: string | null; todayBkk: string };
}

export interface OemPriceCalcResult {
  isComplete: boolean;
  missing: OemMissingRateEntry[];
  breakdown: OemPriceBreakdown;
  floors: OemFloors;
  warnings: string[];
  formulaVersion: number;
}

// ============================================================================
// Quotes (oem_quote / v_oem_quote) — v2 (0075): multi-item quotes, discount
// gated on margin_after_discount_pct, renegotiation, B2B billing. input/calc
// on the HEADER are now null for every quote saved through oem_quote_save v2
// (the per-item calc lives on oem_quote_item/v_oem_quote_item instead); they
// stay non-null only on the two rows that predate this migration and were
// backfilled a single item each — see 0075's header comment.
// ============================================================================

export type OemQuoteStatus = "draft" | "quoted" | "won" | "lost" | "expired" | "rejected" | "superseded";

/** One line of p_items for oem_quote_save (0075, 9-arg). `input` is the exact
 * oem_price_calc payload (unchanged, same as pre-v2 SaveQuoteInput.input).
 * product_id/sku_snapshot/product_name_snapshot come from the SKU picker in
 * QuoteJobItemCard (getOemProducts()) — all three are optional; a job with
 * no matching SKU (new design) simply omits them, same as before. */
export interface OemQuoteItemInput {
  input: OemPriceCalcInput;
  productId?: string | null;
  skuSnapshot?: string | null;
  productNameSnapshot?: string | null;
}

export interface SaveQuoteInput {
  items: OemQuoteItemInput[];
  quoteId?: string | null;
  status?: "draft" | "quoted";
  /** required when the calc's margin (any item) OR margin_after_discount_pct
   * is below marginFloorPct — a free-text reason, not a permission check
   * (this app has one write-tier today; see 0062 header comment). */
  approvalNote?: string | null;
  /** 0064: oem_quote_save's p_customer_name/p_customer_contact — added by the
   * frontend phase to close a gap (columns existed, no write path). */
  customerName?: string | null;
  customerContact?: string | null;
  /** 0075: flat THB discount off quote_total, gated against
   * margin_after_discount_pct server-side. Defaults to 0 when omitted. */
  discountThb?: number | null;
  discountReason?: string | null;
}

export interface SetQuoteStatusInput {
  quoteId: string;
  status: OemQuoteStatus;
  lostReason?: string | null;
  lostTo?: string | null;
}

/** oem_quote_renegotiate (0075) — issues a NEW quote row (new quote_no) with
 * a different discount, copying the original's items verbatim (no
 * recompute — the customer was quoted at the rates live on the original
 * date). The old row becomes 'superseded'. Only valid on a 'quoted', not-yet-
 * expired quote. */
export interface RenegotiateQuoteInput {
  quoteId: string;
  newDiscountThb: number;
  reason?: string | null;
}

export interface OemCustomerAddress {
  line1?: string | null;
  line2?: string | null;
  subdistrict?: string | null;
  district?: string | null;
  province?: string | null;
  postalCode?: string | null;
}

/** oem_quote_set_billing (0075) — upserts the ONE analytics.oem_customer row
 * this quote is billed to. Only valid on a 'quoted' or 'won' quote. Not wired
 * to any UI yet this phase (see QuoteDetailClient) — plumbing for the tax
 * invoice phase. */
export interface SetQuoteBillingInput {
  quoteId: string;
  legalName: string;
  taxId?: string | null;
  phone?: string | null;
  contactChannel?: string | null;
  address?: OemCustomerAddress | null;
}

export interface OemQuoteRow {
  id: string;
  quoteNo: string;
  customerName: string | null;
  customerContact: string | null;
  /** null for every v2-saved quote (multi-item) — see per-item calc in
   * OemQuoteItemRow via getQuoteItems/v_oem_quote_item instead. Non-null only
   * on the two pre-0075 rows that were never re-saved. */
  input: OemPriceCalcInput | null;
  calc: OemPriceCalcResult | null;
  costPiece: number | null;
  pricePerPiece: number | null;
  nreCost: number | null;
  nrePrice: number | null;
  piecesSubtotal: number | null;
  quoteTotal: number | null;
  /** blended margin over the whole job (display-only, see OemPriceBreakdown). */
  marginActualPct: number | null;
  /** 0063: margin rate actually charged — the MIN across items for a v2 quote
   * (what the single-item hard-floor gate judged). */
  marginChargedPct: number | null;
  qRun: number | null;
  flaskCount: number | null;
  platingBatchCount: number | null;
  status: OemQuoteStatus;
  approvalNote: string | null;
  approvedBy: string | null;
  quoteValidUntil: string | null;
  lostReason: string | null;
  lostTo: string | null;
  /** UTC current_date comparison — kept for backward compat, but every UI in
   * this app should read isExpiredTh/daysLeftTh instead (0078 D5). */
  isExpired: boolean;
  daysLeft: number | null;
  /** 0078: same computation, compared against Asia/Bangkok "today" instead
   * of UTC current_date — matters for the 00:00–07:00 ICT window every
   * morning, and specifically for metal='silver999' items whose
   * quote_valid_days=0 makes that window the whole difference between
   * "expired" and "not". Prefer these two over isExpired/daysLeft everywhere. */
  isExpiredTh: boolean;
  daysLeftTh: number | null;
  createdAt: string;
  updatedAt: string;
  // ---- 0075 additions ----
  /** Flat THB discount off quoteTotal. */
  discountThb: number;
  discountReason: string | null;
  /** quoteTotal - discountThb — what the customer actually owes. */
  grandTotal: number | null;
  /** Aggregate margin across all items AFTER discountThb, gold pass-through
   * excluded — the number the discount hard-floor gate actually judges (NOT
   * marginActualPct/marginChargedPct). */
  marginAfterDiscountPct: number | null;
  /** Set only when this quote was produced by oem_quote_renegotiate. */
  parentQuoteId: string | null;
  parentQuoteNo: string | null;
  rootQuoteId: string | null;
  customerId: string | null;
  /** Display-only — no VAT arithmetic anywhere in this app yet. */
  vatMode: "add_7" | "included" | "none";
  itemCount: number;
  // ---- 0077 additions (v_oem_quote LEFT JOIN analytics.oem_customer) ----
  // Populated only after setQuoteBilling has been called on this quote at
  // least once (customer_id set). null on every quote that hasn't been
  // billed yet — NOT an error, just "not filled in".
  billLegalName: string | null;
  billTaxId: string | null;
  billPhone: string | null;
  billContactChannel: string | null;
  /** Parsed defensively from oem_customer.address (jsonb, never shape-
   * validated by the RPC that writes it — see lib/oem/display.ts's
   * parseBillAddress). null if never set OR if the stored jsonb doesn't
   * look like an OemCustomerAddress at all. */
  billAddress: OemCustomerAddress | null;
}

/** analytics.oem_quote_item / v_oem_quote_item (0075) — one priced line per
 * quote. `input`/`calc` are the EXACT oem_price_calc payload/result for this
 * line (same contract oem_quote.input/calc used pre-v2), so a saved quote
 * reprints at the rates that were live when quoted. */
export interface OemQuoteItemRow {
  id: string;
  shopId: string;
  quoteId: string;
  quoteNo: string;
  seq: number;
  productId: string | null;
  skuSnapshot: string | null;
  productNameSnapshot: string | null;
  input: OemPriceCalcInput;
  calc: OemPriceCalcResult;
  qty: number;
  costPiece: number | null;
  pricePerPiece: number | null;
  /** qty * pricePerPiece for this line only — excludes NRE (rolls up onto
   * the quote header instead, summed across items). */
  itemTotal: number | null;
  qRun: number | null;
  flaskCount: number | null;
  platingBatchCount: number | null;
  marginChargedPct: number | null;
  createdAt: string;
  updatedAt: string;
}

export const OEM_METAL_LABEL_TH: Record<OemMetal, string> = {
  silver: "เงิน 925",
  gold: "ทอง",
  brass: "ทองเหลือง",
  silver999: "เงินแท่ง 99.99%",
};

export const OEM_QUOTE_STATUS_LABEL_TH: Record<OemQuoteStatus, string> = {
  draft: "ร่าง",
  quoted: "เสนอราคาแล้ว",
  won: "ปิดงาน",
  lost: "แพ้งาน",
  expired: "หมดอายุ",
  rejected: "ปฏิเสธ",
  superseded: "ถูกแทนที่",
};
