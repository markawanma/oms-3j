"use server";

// lib/actions/oem.ts — OEM pricing floor (docs/3j-jewelry/marketing/oem-pricing-floor.md),
// backed by supabase/migrations/0061_oem_cost_rate.sql + 0062_oem_quote_calc.sql.
//
// Same auth model as lib/actions/catalog.ts: getServiceClient() uses the
// service role, which BYPASSES RLS and short-circuits crm_require_owner_admin()
// inside the RPCs — so requireOwnerAdmin() below is the ONLY thing gating
// writes in this app today. Every write action calls it first.
//
// THERE IS NO PRICING FORMULA IN THIS FILE. Every number here comes back from
// analytics.oem_price_calc (called via calcPrice/saveQuote's RPCs) or is a
// straight column read. If you find yourself computing cost/price/margin
// here, stop — that arithmetic belongs in 0062's oem_price_calc, the single
// implementation the design brief requires.

import { revalidatePath } from "next/cache";
import { getServiceClient } from "@/lib/supabase/server";
import { getDevShopId, getDevRole } from "@/lib/dev/context";
import type { ActionResult } from "@/lib/types";
import type {
  DeleteOemRateInput,
  IssueReceiptInput,
  OemBarBreakdown,
  OemBarSize,
  OemBatchLine,
  OemFloors,
  OemLaborStep,
  OemMetalPriceMap,
  OemMissingRateEntry,
  OemPriceBreakdown,
  OemPriceCalcInput,
  OemPriceCalcResult,
  OemProductOption,
  OemProvinceOption,
  OemQuoteItemRow,
  OemQuoteRow,
  OemQuoteStatus,
  OemRateStatusRow,
  OemReadiness,
  OemReceiptKind,
  OemReceiptPaymentMethod,
  OemReceiptRow,
  OemReceiptSellerSnapshot,
  OemSettingData,
  RenegotiateQuoteInput,
  SaveMetalPriceInput,
  SaveQuoteInput,
  SetQuoteBillingInput,
  SetQuoteDepositInput,
  SetQuoteStatusInput,
  SetQuoteVatModeInput,
  UpsertOemRateInput,
  UpsertOemSettingInput,
  VoidReceiptInput,
} from "@/lib/oem/types";
import { hasAnyContact, isValidThaiTaxId, parseBillAddress } from "@/lib/oem/display";
import type { SellerProfile } from "@/lib/oem/sellerProfile";
import { fetchAllRows } from "@/lib/supabase/query-limits";

const SCHEMA = "analytics";
// T4-T6 routes (all `dynamic = "force-dynamic"`, so this is belt-and-braces
// alongside router.refresh() on the client side, not the only cache-buster).
const OEM_PATHS = ["/oem/rates", "/oem/quote", "/oem/quotes", "/oem/receipts"] as const;
function revalidateOemPaths(): void {
  for (const p of OEM_PATHS) revalidatePath(p);
}

// Gates BOTH reads and writes. The page components check the role too, but a
// server action is its own POST endpoint: its action id ships in the client
// bundle, so anyone who can load any page in the app can invoke it directly
// regardless of what the page rendered. Reads matter as much as writes here —
// calcPrice alone returns per-department labour rates, batch costs, NRE and
// the margin actually charged, i.e. the entire cost structure this feature
// exists to keep off competitors' desks (pricing-disclosure-policy.md §2.5).
function requireOwnerAdmin(): ActionResult<never> | null {
  if (getDevRole() === "staff") {
    return { ok: false, error: "เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ดูหรือแก้ต้นทุน/ราคางาน OEM ได้" };
  }
  return null;
}

function toNum(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ============================================================================
// p_input (jsonb) <-> OemPriceCalcInput mapping. Kept in one place so
// calcPrice/saveQuote never drift from each other or from 0062's documented
// contract.
// ============================================================================

function toCalcInputPayload(input: OemPriceCalcInput): Record<string, unknown> {
  // 0078: silver999 (เงินแท่ง) is a DELIBERATELY separate, minimal payload —
  // D3 in design-oem-bar-quote.md is explicit that item_kind/polish_tier/
  // weight_g/margin_pct/plating/gem must NOT be sent for this branch; the RPC
  // reads bar_size/qty/engrave_*_thb ONLY and returns before touching any
  // production validation. Sending the production keys anyway would be
  // harmless server-side (the RPC ignores them for this branch) but would
  // drift from the documented contract for no reason.
  if (input.metal === "silver999") {
    return {
      metal: "silver999",
      bar_size: input.barSize ?? null,
      qty: input.qty,
      engrave_image_thb: input.engraveImageThb ?? null,
      engrave_text_thb: input.engraveTextThb ?? null,
      // display-only on the way in (server ignores it and looks up TODAY,
      // Asia/Bangkok, itself) — see OemPriceCalcInput.asOfDate's comment.
      as_of_date: input.asOfDate ?? null,
    };
  }
  return {
    metal: input.metal,
    item_kind: input.itemKind,
    polish_tier: input.polishTier,
    qty: input.qty,
    weight_g: input.weightG,
    is_new_design: input.isNewDesign ?? true,
    purity: input.purity ?? null,
    plating_type: input.platingType ?? null,
    gem_tier: input.gemTier ?? null,
    gem_count: input.gemCount ?? 0,
    as_of_date: input.asOfDate ?? null,
    // 0063: margin to CHARGE — omit to fall back to oem_setting.margin_target_pct.
    margin_pct: input.marginPct ?? null,
  };
}

// ============================================================================
// 0078: analytics.oem_quote_item.input / analytics.oem_quote.input store
// EXACTLY toCalcInputPayload()'s output — i.e. snake_case (item_kind,
// weight_g, bar_size, engrave_image_thb, …), NOT the camelCase
// OemPriceCalcInput shape. Reading that raw jsonb back with a bare `as
// OemPriceCalcInput` cast (as mapQuoteRow/mapQuoteItemRow did pre-0078) silently
// produces `undefined` for every multi-word field (itemKind, weightG,
// polishTier, barSize, …) — it only APPEARED to work because `metal` and
// `purity` happen to be spelled the same in both cases. fromInputPayload is
// the inverse of toCalcInputPayload; every read of a stored .input must go
// through it from here on (fixes a pre-existing latent bug that 0078's
// barSize/engrave fields would otherwise inherit — see printableQuote.ts's
// itemKindFallback/weightG, which depended on the same broken cast).
// ============================================================================
function fromInputPayload(raw: Record<string, unknown>): OemPriceCalcInput {
  const metal = raw.metal as OemPriceCalcInput["metal"];
  if (metal === "silver999") {
    return {
      metal,
      barSize: (raw.bar_size as OemBarSize | null | undefined) ?? null,
      qty: Number(raw.qty ?? 0),
      engraveImageThb: raw.engrave_image_thb == null ? null : Number(raw.engrave_image_thb),
      engraveTextThb: raw.engrave_text_thb == null ? null : Number(raw.engrave_text_thb),
      asOfDate: (raw.as_of_date as string | null | undefined) ?? null,
    };
  }
  return {
    metal,
    itemKind: raw.item_kind == null ? undefined : String(raw.item_kind),
    polishTier: raw.polish_tier == null ? undefined : String(raw.polish_tier),
    qty: Number(raw.qty ?? 0),
    weightG: raw.weight_g == null ? undefined : Number(raw.weight_g),
    isNewDesign: raw.is_new_design == null ? true : Boolean(raw.is_new_design),
    purity: raw.purity == null ? null : Number(raw.purity),
    platingType: (raw.plating_type as string | null | undefined) ?? null,
    gemTier: (raw.gem_tier as string | null | undefined) ?? null,
    gemCount: raw.gem_count == null ? 0 : Number(raw.gem_count),
    asOfDate: (raw.as_of_date as string | null | undefined) ?? null,
    marginPct: raw.margin_pct == null ? null : Number(raw.margin_pct),
  };
}

function fromCalcResult(raw: Record<string, unknown>): OemPriceCalcResult {
  const missing = (raw?.missing as unknown[] | undefined ?? []).map((m) => {
    const r = m as Record<string, unknown>;
    return {
      rateKey: String(r.rate_key ?? ""),
      scope: String(r.scope ?? "-"),
      questionTh: String(r.question_th ?? ""),
      priority: (r.priority as OemMissingRateEntry["priority"]) ?? "P0",
    };
  });

  const b = (raw?.breakdown ?? {}) as Record<string, unknown>;
  const metal = (b.metal ?? {}) as Record<string, unknown>;
  const labor = (b.labor ?? {}) as Record<string, unknown>;
  const batch = (b.batch ?? {}) as Record<string, unknown>;
  const nre = (b.nre ?? {}) as Record<string, unknown>;
  // 0078: non-null only when metal='silver999'. NEVER add kilo_buy/
  // buy_per_baht here even if the RPC starts returning them by accident —
  // this mapper is the last line before that number could reach a UI a
  // customer sees (D3's "ห้ามเด็ดขาด" note).
  const barRaw = b.bar as Record<string, unknown> | null | undefined;
  const bar: OemBarBreakdown | null = barRaw
    ? {
        size: String(barRaw.size ?? "") as OemBarSize,
        priceColumn: String(barRaw.price_column ?? ""),
        barPricePerPiece: barRaw.bar_price_per_piece == null ? null : Number(barRaw.bar_price_per_piece),
        engraveImageThb: barRaw.engrave_image_thb == null ? null : Number(barRaw.engrave_image_thb),
        engraveTextThb: barRaw.engrave_text_thb == null ? null : Number(barRaw.engrave_text_thb),
        marginPctEmbedded: barRaw.margin_pct_embedded == null ? null : Number(barRaw.margin_pct_embedded),
        asOfDate: barRaw.as_of_date == null ? null : String(barRaw.as_of_date),
        sheetTime: barRaw.sheet_time == null ? null : String(barRaw.sheet_time),
        capturedAt: barRaw.captured_at == null ? null : String(barRaw.captured_at),
        source: barRaw.source == null ? null : String(barRaw.source),
      }
    : null;

  const laborSteps: OemLaborStep[] = ((labor.steps as unknown[] | undefined) ?? []).map((s) => {
    const r = s as Record<string, unknown>;
    return { key: String(r.key ?? ""), minutes: r.minutes == null ? null : Number(r.minutes), thb: Number(r.thb ?? 0) };
  });
  const batchLines: OemBatchLine[] = ((batch.lines as unknown[] | undefined) ?? []).map((l) => {
    const r = l as Record<string, unknown>;
    return {
      key: (r.key as OemBatchLine["key"]) ?? "flask",
      capacity: r.capacity == null ? null : Number(r.capacity),
      count: r.count == null ? null : Number(r.count),
      cost: r.cost == null ? null : Number(r.cost),
    };
  });

  const breakdown: OemPriceBreakdown = {
    qRun: Number(b.q_run ?? 0),
    rejectPctTotal: Number(b.reject_pct_total ?? 0),
    metal: {
      perPiece: Number(metal.per_piece ?? 0),
      grossLossPct: metal.gross_loss_pct == null ? null : Number(metal.gross_loss_pct),
      // 0066: straight column reads off oem_price_calc's jsonb — no arithmetic here.
      polishLossPct: metal.polish_loss_pct == null ? null : Number(metal.polish_loss_pct),
      lossBasis: metal.loss_basis == null ? null : String(metal.loss_basis),
      effectiveLossPct: metal.effective_loss_pct == null ? null : Number(metal.effective_loss_pct),
      metalLossMultiplier: metal.metal_loss_multiplier == null ? null : Number(metal.metal_loss_multiplier),
      priceUsed: metal.price_used == null ? null : Number(metal.price_used),
      priceSource: metal.price_source == null ? null : String(metal.price_source),
    },
    labor: { perPiece: Number(labor.per_piece ?? 0), steps: laborSteps },
    batch: { perPiece: Number(batch.per_piece ?? 0), lines: batchLines },
    nre: {
      cad: nre.cad == null ? null : Number(nre.cad),
      print3d: nre.print3d == null ? null : Number(nre.print3d),
      mold: nre.mold == null ? null : Number(nre.mold),
      cost: Number(nre.cost ?? 0),
      price: Number(nre.price ?? 0),
    },
    bar,
    costPiece: Number(b.cost_piece ?? 0),
    pricePerPiece: Number(b.price_per_piece ?? 0),
    quoteTotal: b.quote_total == null ? null : Number(b.quote_total),
    marginActualPct: b.margin_actual_pct == null ? null : Number(b.margin_actual_pct),
    marginPctUsed: Number(b.margin_pct_used ?? 0),
  };

  const f = (raw?.floors ?? {}) as Record<string, unknown>;
  const fQty = (f.qty ?? {}) as Record<string, unknown>;
  const fJob = (f.job_value ?? {}) as Record<string, unknown>;
  const fMetal = (f.metal_weight ?? {}) as Record<string, unknown>;
  const fMargin = (f.margin ?? {}) as Record<string, unknown>;
  // 0078: present only when metal='silver999'. Read defensively (undefined
  // on every pre-0078 saved quote — see D5's note that old quotes reprint
  // fine without it) rather than assuming the key exists.
  const fPriceFresh = f.price_fresh as Record<string, unknown> | undefined;

  const floors: OemFloors = {
    qty: { pass: fQty.pass == null ? null : Boolean(fQty.pass), moq: fQty.moq == null ? null : Number(fQty.moq), actual: Number(fQty.actual ?? 0) },
    jobValue: { pass: fJob.pass == null ? null : Boolean(fJob.pass), min: Number(fJob.min ?? 0) },
    metalWeight: { pass: fMetal.pass == null ? null : Boolean(fMetal.pass), applies: Boolean(fMetal.applies) },
    margin: {
      state: (fMargin.state as OemFloors["margin"]["state"]) ?? null,
      value: fMargin.value == null ? null : Number(fMargin.value),
      blended: fMargin.blended == null ? null : Number(fMargin.blended),
      target: fMargin.target == null ? null : Number(fMargin.target),
    },
    priceFresh: fPriceFresh
      ? {
          pass: Boolean(fPriceFresh.pass),
          asOfDate: fPriceFresh.as_of_date == null ? null : String(fPriceFresh.as_of_date),
          todayBkk: String(fPriceFresh.today_bkk ?? ""),
        }
      : undefined,
  };

  return {
    isComplete: Boolean(raw?.is_complete),
    missing,
    breakdown,
    floors,
    warnings: ((raw?.warnings as unknown[] | undefined) ?? []).map((w) => String(w)),
    formulaVersion: Number(raw?.formula_version ?? 1),
  };
}

// ============================================================================
// Rate intake — read status + write one cell
// ============================================================================

export async function getRateStatus(): Promise<
  ActionResult<{ rows: OemRateStatusRow[]; readiness: OemReadiness | null }>
> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const [statusRes, readinessRes] = await Promise.all([
      supabase
        .schema(SCHEMA)
        .from("v_oem_rate_status")
        .select(
          "rate_key, scope, group_code, seq, label_th, question_th, input_unit, scope_kind, cost_bucket, priority, applies_when, depends_on, value, effective_from, note, is_missing"
        )
        .eq("shop_id", shopId)
        .order("seq", { ascending: true }),
      supabase
        .schema(SCHEMA)
        .from("v_oem_readiness")
        .select("p0_total, p0_filled, p0_missing, can_quote")
        .eq("shop_id", shopId)
        .maybeSingle(),
    ]);
    if (statusRes.error) throw statusRes.error;
    if (readinessRes.error) throw readinessRes.error;

    const rows: OemRateStatusRow[] = (
      (statusRes.data ?? []) as {
        rate_key: string;
        scope: string;
        group_code: string;
        seq: number;
        label_th: string;
        question_th: string;
        input_unit: OemRateStatusRow["inputUnit"];
        scope_kind: OemRateStatusRow["scopeKind"];
        cost_bucket: OemRateStatusRow["costBucket"];
        priority: OemRateStatusRow["priority"];
        applies_when: OemRateStatusRow["appliesWhen"];
        depends_on: string[] | null;
        value: number | null;
        effective_from: string | null;
        note: string | null;
        is_missing: boolean;
      }[]
    ).map((r) => ({
      rateKey: r.rate_key,
      scope: r.scope,
      groupCode: r.group_code,
      seq: r.seq,
      labelTh: r.label_th,
      questionTh: r.question_th,
      inputUnit: r.input_unit,
      scopeKind: r.scope_kind,
      costBucket: r.cost_bucket,
      priority: r.priority,
      appliesWhen: r.applies_when,
      dependsOn: r.depends_on,
      value: r.value == null ? null : Number(r.value),
      effectiveFrom: r.effective_from,
      note: r.note,
      isMissing: Boolean(r.is_missing),
    }));

    const readiness: OemReadiness | null = readinessRes.data
      ? {
          p0Total: Number(readinessRes.data.p0_total) || 0,
          p0Filled: Number(readinessRes.data.p0_filled) || 0,
          p0Missing: Number(readinessRes.data.p0_missing) || 0,
          canQuote: Boolean(readinessRes.data.can_quote),
        }
      : null;

    return { ok: true, data: { rows, readiness } };
  } catch (err) {
    console.error("getRateStatus failed", err);
    return { ok: false, error: "โหลดสถานะข้อมูลต้นทุน OEM ไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

export async function saveRate(input: UpsertOemRateInput): Promise<ActionResult> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  const rateKey = input.rateKey?.trim();
  if (!rateKey) return { ok: false, error: "ไม่พบ rate_key" };
  const value = toNum(input.value);
  if (value === null || value < 0) return { ok: false, error: "ค่าที่กรอกต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป" };

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { error } = await supabase.schema(SCHEMA).rpc("oem_rate_upsert", {
      p_shop_id: shopId,
      p_rate_key: rateKey,
      p_value: value,
      p_scope: input.scope?.trim() || "-",
      p_effective_from: input.effectiveFrom || undefined,
      p_note: input.note?.trim() || null,
    });
    if (error) {
      if ((error as { code?: string }).code === "22023") return { ok: false, error: error.message };
      throw error;
    }

    revalidateOemPaths();
    return { ok: true, data: undefined };
  } catch (err) {
    console.error("saveRate failed", err);
    return { ok: false, error: "บันทึกตัวเลขต้นทุนไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

export async function deleteRate(input: DeleteOemRateInput): Promise<ActionResult> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  if (!input.rateKey?.trim() || !input.scope?.trim() || !input.effectiveFrom) {
    return { ok: false, error: "ข้อมูลที่จะลบไม่ครบ" };
  }

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { error } = await supabase.schema(SCHEMA).rpc("oem_rate_delete", {
      p_shop_id: shopId,
      p_rate_key: input.rateKey.trim(),
      p_scope: input.scope.trim(),
      p_effective_from: input.effectiveFrom,
    });
    if (error) throw error;

    revalidateOemPaths();
    return { ok: true, data: undefined };
  } catch (err) {
    console.error("deleteRate failed", err);
    return { ok: false, error: "ลบตัวเลขต้นทุนไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

// ============================================================================
// Shop settings (margin/floor/quote-validity)
// ============================================================================

export async function getOemSetting(): Promise<ActionResult<OemSettingData>> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data, error } = await supabase
      .schema(SCHEMA)
      .from("oem_setting")
      .select(
        "margin_target_pct, margin_discount_cap_pct, margin_floor_pct, margin_hard_floor_pct, nre_max_share_pct, min_job_value_thb, quote_valid_days_silver, quote_valid_days_gold, quote_valid_days_brass, bar_margin_pct, formula_version"
      )
      .eq("shop_id", shopId)
      .maybeSingle();
    if (error) throw error;

    // 0061 seeds every existing shop; default sensibly if somehow missing.
    const result: OemSettingData = {
      marginTargetPct: data ? Number(data.margin_target_pct) : 0.3,
      marginDiscountCapPct: data ? Number(data.margin_discount_cap_pct) : 0.25,
      marginFloorPct: data ? Number(data.margin_floor_pct) : 0.2,
      marginHardFloorPct: data ? Number(data.margin_hard_floor_pct) : 0.15,
      nreMaxSharePct: data ? Number(data.nre_max_share_pct) : 0.25,
      minJobValueThb: data ? Number(data.min_job_value_thb) : 8000,
      quoteValidDaysSilver: data ? Number(data.quote_valid_days_silver) : 30,
      quoteValidDaysGold: data ? Number(data.quote_valid_days_gold) : 7,
      quoteValidDaysBrass: data ? Number(data.quote_valid_days_brass) : 45,
      // 0078: bar_margin_pct is new on oem_setting (default 0.19 at the DB
      // column level too) — data?.bar_margin_pct is only ever null on a row
      // written before 0078's ALTER TABLE, which the column default already
      // backfills, so this branch is defensive-only, not an expected path.
      barMarginPct: data && data.bar_margin_pct != null ? Number(data.bar_margin_pct) : 0.19,
      formulaVersion: data ? Number(data.formula_version) : 1,
    };
    return { ok: true, data: result };
  } catch (err) {
    console.error("getOemSetting failed", err);
    return { ok: false, error: "โหลดการตั้งค่ามาร์จิ้น/floor ไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

export async function saveOemSetting(input: UpsertOemSettingInput): Promise<ActionResult> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  const target = toNum(input.marginTargetPct);
  const cap = toNum(input.marginDiscountCapPct);
  const floor = toNum(input.marginFloorPct);
  const hardFloor = toNum(input.marginHardFloorPct);
  const nreShare = toNum(input.nreMaxSharePct);
  const minJob = toNum(input.minJobValueThb);
  const validSilver = toNum(input.quoteValidDaysSilver);
  const validGold = toNum(input.quoteValidDaysGold);
  const validBrass = toNum(input.quoteValidDaysBrass);
  const barMarginPct = toNum(input.barMarginPct);

  for (const [label, v] of [
    ["margin เป้าหมาย", target],
    ["เพดานส่วนลด", cap],
    ["floor margin", floor],
    ["hard floor", hardFloor],
    ["NRE max share", nreShare],
  ] as const) {
    if (v != null && (v < 0 || v >= 1)) return { ok: false, error: `${label} ต้องอยู่ระหว่าง 0–100% (ไม่รวมขอบ)` };
  }
  if (minJob != null && minJob <= 0) return { ok: false, error: "มูลค่างานขั้นต่ำต้องมากกว่า 0" };
  if (validSilver != null && validSilver <= 0) return { ok: false, error: "อายุใบเสนอราคา (เงิน) ต้องมากกว่า 0 วัน" };
  if (validGold != null && validGold <= 0) return { ok: false, error: "อายุใบเสนอราคา (ทอง) ต้องมากกว่า 0 วัน" };
  if (validBrass != null && validBrass <= 0) return { ok: false, error: "อายุใบเสนอราคา (ทองเหลือง) ต้องมากกว่า 0 วัน" };
  // 0079: same open-interval check the DB's check(bar_margin_pct > 0 and < 1)
  // enforces — plus 0079's SECOND constraint (bar_margin_pct <=
  // margin_target_pct) is checked by the RPC itself (22023, surfaced below),
  // not duplicated here, because it depends on the row's CURRENT
  // margin_target_pct when target isn't part of this same submit (the
  // seller-profile-only save path below never sends margin fields).
  if (barMarginPct != null && (barMarginPct <= 0 || barMarginPct >= 1)) {
    return { ok: false, error: "margin แฝงเงินแท่ง ต้องอยู่ระหว่าง 0–100% (ไม่รวมขอบ)" };
  }

  // 0080: seller_* text scalars are now a genuine 3-state RPC param —
  // null = leave unchanged, '' = clear to null, anything else = overwrite
  // (analytics.oem_setting_upsert's own case/when, not coalesce anymore for
  // these 8 fields — see 0080's header). Before 0080 the RPC only had
  // coalesce(p_x, os.x), so there was NO way to clear an already-set field;
  // this file used to collapse '' -> null on the way in specifically to
  // paper over that (both "not sent" and "sent empty" meant the same thing
  // to the old RPC). That collapsing is now WRONG — it would silently turn
  // every intentional clear back into a no-op. sellerScalar below is a thin
  // pass-through (trim non-null strings, leave null/undefined as null) so
  // the caller's null/''/value choice reaches the RPC unchanged. The actual
  // decision of WHICH of the 3 to send lives in SellerProfileSection (the
  // only caller), which compares the current input against the loaded
  // profile to tell "user deleted this" apart from "field was already
  // empty, never touched" — see that file's sellerFieldForSave comment.
  const sellerScalar = (v: string | null | undefined): string | null => (v == null ? null : v.trim());
  const sellerLegalName = sellerScalar(input.sellerLegalName);
  const sellerBranchLabel = sellerScalar(input.sellerBranchLabel);
  // Array fields keep their pre-0080 "[]` genuinely clears" behaviour
  // (coalesce(v_x, os.x) in the RPC, x being a computed/normalized value —
  // see 0080 §array-normalize) — untouched here, not part of this fix.
  const sellerAddressLines = Array.isArray(input.sellerAddressLines)
    ? input.sellerAddressLines.map((l) => l.trim()).filter(Boolean)
    : null;
  const sellerTaxId = sellerScalar(input.sellerTaxId);
  const sellerPhone = sellerScalar(input.sellerPhone);
  const sellerLine = sellerScalar(input.sellerLine);
  const sellerEmail = sellerScalar(input.sellerEmail);
  const sellerWebsite = sellerScalar(input.sellerWebsite);
  const sellerTerms = Array.isArray(input.sellerTerms) ? input.sellerTerms.map((t) => t.trim()).filter(Boolean) : null;
  // Boolean checkbox — always a real true/false from the form, never a
  // "leave unchanged" signal, so this one keeps coalesce semantics
  // untouched by 0080 on purpose (see that migration's header, "ที่ไม่แตะ").
  const sellerVatRegistered = input.sellerVatRegistered ?? null;

  // Client also validates this (SellerProfileSection), but that's UX-only —
  // this is the real gate. The DB's own check + oem_setting_upsert's own
  // '22023' raise are belt-and-braces beneath this, not a substitute for it
  // (see this file's header on why the client is never trusted alone).
  if (sellerTaxId && !/^\d{13}$/.test(sellerTaxId)) {
    return { ok: false, error: "เลขประจำตัวผู้เสียภาษีร้านต้องเป็นตัวเลข 13 หลัก" };
  }

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    // 0079 resolves the prior "0078 GAP" (bar_margin_pct written via a
    // second, non-atomic table upsert): oem_setting_upsert now accepts
    // p_bar_margin_pct AND every p_seller_* param, so this is a single RPC
    // round trip — no more "half-saved but the screen says it failed".
    const { error } = await supabase.schema(SCHEMA).rpc("oem_setting_upsert", {
      p_shop_id: shopId,
      p_margin_target_pct: target,
      p_margin_discount_cap_pct: cap,
      p_margin_floor_pct: floor,
      p_margin_hard_floor_pct: hardFloor,
      p_nre_max_share_pct: nreShare,
      p_min_job_value_thb: minJob,
      p_quote_valid_days_silver: validSilver,
      p_quote_valid_days_gold: validGold,
      p_quote_valid_days_brass: validBrass,
      p_bar_margin_pct: barMarginPct,
      p_seller_legal_name: sellerLegalName,
      p_seller_branch_label: sellerBranchLabel,
      p_seller_address_lines: sellerAddressLines,
      p_seller_tax_id: sellerTaxId,
      p_seller_vat_registered: sellerVatRegistered,
      p_seller_phone: sellerPhone,
      p_seller_line: sellerLine,
      p_seller_email: sellerEmail,
      p_seller_website: sellerWebsite,
      p_seller_terms: sellerTerms,
    });
    if (error) {
      if ((error as { code?: string }).code === "22023") return { ok: false, error: error.message };
      throw error;
    }

    revalidateOemPaths();
    return { ok: true, data: undefined };
  } catch (err) {
    console.error("saveOemSetting failed", err);
    return { ok: false, error: "บันทึกการตั้งค่าไม่สำเร็จ — ตรวจว่า hard floor ≤ floor ≤ เพดานส่วนลด ≤ เป้าหมาย และ margin แฝงเงินแท่ง ≤ margin เป้าหมาย" };
  }
}

// ============================================================================
// Seller profile (0079: analytics.oem_setting.seller_* via analytics.v_oem_seller)
// — the shop's OWN info printed as the quotation header. Distinct from
// setQuoteBilling above (that's the CUSTOMER's billing info) — see
// BillingDialog's file header for the naming collision this used to cause in
// UAT. Read via getSellerProfile, written via saveOemSetting above (same RPC
// as the margin/floor policy form — never a second write path).
// ============================================================================

function toStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim());
}

export async function getSellerProfile(): Promise<ActionResult<SellerProfile>> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data, error } = await supabase
      .schema(SCHEMA)
      .from("v_oem_seller")
      .select(
        "seller_legal_name, seller_branch_label, seller_address_lines, seller_tax_id, seller_vat_registered, seller_phone, seller_line, seller_email, seller_website, seller_terms"
      )
      .eq("shop_id", shopId)
      .maybeSingle();
    if (error) throw error;

    const profile: SellerProfile = {
      legalName: data?.seller_legal_name ?? null,
      branchLabel: data?.seller_branch_label ?? null,
      addressLines: toStringArray(data?.seller_address_lines),
      taxId: data?.seller_tax_id ?? null,
      vatRegistered: Boolean(data?.seller_vat_registered),
      phone: data?.seller_phone ?? null,
      line: data?.seller_line ?? null,
      email: data?.seller_email ?? null,
      website: data?.seller_website ?? null,
      terms: toStringArray(data?.seller_terms),
    };
    return { ok: true, data: profile };
  } catch (err) {
    console.error("getSellerProfile failed", err);
    return { ok: false, error: "โหลดข้อมูลร้านเราไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

// ============================================================================
// Province dropdown (analytics.dim_geo) — global reference data (no shop_id
// column, every shop shares the same 77-province catalog; see
// lib/actions/crm.ts's getCrmEditOptions, same table/shape, kept as its own
// query here rather than a cross-module import — see OemProvinceOption's
// comment). Gated with requireOwnerAdmin() for consistency with the rest of
// this module even though province names aren't cost data, per the coordinator's
// explicit ask. is_unknown ('TH-XX' / "ไม่ทราบจังหวัด") excluded — never a
// selectable option on a real billing address.
// ============================================================================

export async function getOemProvinces(): Promise<ActionResult<OemProvinceOption[]>> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  try {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .schema(SCHEMA)
      .from("dim_geo")
      .select("province_code, province_name_th")
      .eq("is_unknown", false)
      .order("province_name_th", { ascending: true });
    if (error) throw error;

    const provinces: OemProvinceOption[] = ((data ?? []) as { province_code: string; province_name_th: string }[]).map((p) => ({
      code: p.province_code,
      nameTh: p.province_name_th,
    }));
    return { ok: true, data: provinces };
  } catch (err) {
    console.error("getOemProvinces failed", err);
    return { ok: false, error: "โหลดรายชื่อจังหวัดไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

// ============================================================================
// Metal price
// ============================================================================

export async function saveMetalPrice(input: SaveMetalPriceInput): Promise<ActionResult> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  const price = toNum(input.priceThbPerGram);
  if (price === null || price <= 0) return { ok: false, error: "ราคาโลหะต่อกรัมต้องมากกว่า 0" };
  if (!input.metal || !["silver", "gold", "brass"].includes(input.metal)) {
    return { ok: false, error: "วัสดุไม่ถูกต้อง" };
  }

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { error } = await supabase.schema(SCHEMA).rpc("oem_metal_price_set", {
      p_shop_id: shopId,
      p_metal: input.metal,
      p_price: price,
      p_as_of: input.asOfDate || undefined,
      p_source: input.source || "manual",
    });
    if (error) throw error;

    revalidateOemPaths();
    return { ok: true, data: undefined };
  } catch (err) {
    console.error("saveMetalPrice failed", err);
    return { ok: false, error: "บันทึกราคาโลหะไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

const OEM_METALS = ["silver", "gold", "brass"] as const;

/** Latest row per metal — read-only, used by /oem/rates to show "what's
 * currently on file" and by /oem/quote to warn before the calc RPC does.
 * Not a formula: straight column reads, latest as_of_date first. */
export async function getMetalPrices(): Promise<ActionResult<OemMetalPriceMap>> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data, error } = await supabase
      .schema(SCHEMA)
      .from("oem_metal_price")
      .select("metal, price_thb_per_gram, as_of_date, source")
      .eq("shop_id", shopId)
      .order("as_of_date", { ascending: false });
    if (error) throw error;

    const result: OemMetalPriceMap = { silver: null, gold: null, brass: null };
    for (const row of (data ?? []) as { metal: string; price_thb_per_gram: number; as_of_date: string; source: string }[]) {
      const metal = row.metal as (typeof OEM_METALS)[number];
      if (!OEM_METALS.includes(metal) || result[metal] !== null) continue; // keep only the latest per metal
      result[metal] = { priceThbPerGram: Number(row.price_thb_per_gram), asOfDate: row.as_of_date, source: row.source };
    }
    return { ok: true, data: result };
  } catch (err) {
    console.error("getMetalPrices failed", err);
    return { ok: false, error: "โหลดราคาโลหะไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

// ============================================================================
// SKU picker (analytics.v_dim_product) — read-only, label/traceability only.
// See lib/oem/types.ts's OemProductOption header for why unit_cost/
// list_price/margin_pct are excluded from both the query AND the mapped
// result below: this endpoint must never leak retail cost/margin to the OEM
// quote screen, even by accident via a future column-order change.
// ============================================================================

export async function getOemProducts(): Promise<ActionResult<OemProductOption[]>> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data, error } = await supabase
      .schema(SCHEMA)
      .from("v_dim_product")
      .select("product_id, sku, name, category")
      .eq("shop_id", shopId)
      .eq("is_active", true)
      .order("sku", { ascending: true });
    if (error) throw error;

    const result: OemProductOption[] = (
      (data ?? []) as { product_id: string; sku: string; name: string; category: string | null }[]
    ).map((r) => ({ productId: r.product_id, sku: r.sku, name: r.name, category: r.category }));
    return { ok: true, data: result };
  } catch (err) {
    console.error("getOemProducts failed", err);
    return { ok: false, error: "โหลดรายการ SKU ไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

// ============================================================================
// Price calculator — read-only preview, does NOT revalidate anything (no
// write happened). This is the live "กรอกแล้วเห็นราคาทันที" calculator; a
// quote is only persisted via saveQuote below.
// ============================================================================

export async function calcPrice(input: OemPriceCalcInput): Promise<ActionResult<OemPriceCalcResult>> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  if (!input?.metal) return { ok: false, error: "กรุณาเลือกวัสดุ" };

  if (input.metal === "silver999") {
    if (!input.barSize) return { ok: false, error: "กรุณาเลือกขนาดแท่ง" };
    if (!Number.isFinite(input.qty) || input.qty <= 0) return { ok: false, error: "จำนวนแท่งต้องมากกว่า 0" };
    if (input.engraveImageThb != null && (!Number.isFinite(input.engraveImageThb) || input.engraveImageThb < 0)) {
      return { ok: false, error: "ค่ายิงเลเซอร์รูปภาพต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป" };
    }
    if (input.engraveTextThb != null && (!Number.isFinite(input.engraveTextThb) || input.engraveTextThb < 0)) {
      return { ok: false, error: "ค่ายิงเลเซอร์ตัวอักษรต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป" };
    }
  } else {
    if (!input.itemKind?.trim() || !input.polishTier?.trim()) {
      return { ok: false, error: "กรุณาเลือกวัสดุ / ประเภทงาน / ระดับความยากขัด" };
    }
    if (!Number.isFinite(input.qty) || input.qty <= 0) return { ok: false, error: "จำนวนชิ้นต้องมากกว่า 0" };
    if (!Number.isFinite(input.weightG) || (input.weightG as number) <= 0) {
      return { ok: false, error: "น้ำหนักต่อชิ้นต้องมากกว่า 0" };
    }
  }

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data, error } = await supabase.schema(SCHEMA).rpc("oem_price_calc", {
      p_shop_id: shopId,
      p_input: toCalcInputPayload(input),
    });
    if (error) throw error;

    return { ok: true, data: fromCalcResult(data as Record<string, unknown>) };
  } catch (err) {
    console.error("calcPrice failed", err);
    return { ok: false, error: "คำนวณราคาไม่สำเร็จ — ตรวจข้อมูลที่กรอก แล้วลองใหม่อีกครั้ง" };
  }
}

// ============================================================================
// Quotes
// ============================================================================

function mapQuoteRow(r: Record<string, unknown>): OemQuoteRow {
  return {
    id: String(r.id),
    quoteNo: String(r.quote_no),
    customerName: (r.customer_name as string | null) ?? null,
    customerContact: (r.customer_contact as string | null) ?? null,
    // 0075: null on every v2-saved (multi-item) quote — only the two
    // pre-0075 rows still carry a header input/calc. See getQuoteItems for
    // the per-item shape every quote (old and new) has via the backfill.
    input: r.input == null ? null : fromInputPayload(r.input as Record<string, unknown>),
    calc: r.calc == null ? null : fromCalcResult(r.calc as Record<string, unknown>),
    costPiece: r.cost_piece == null ? null : Number(r.cost_piece),
    pricePerPiece: r.price_per_piece == null ? null : Number(r.price_per_piece),
    nreCost: r.nre_cost == null ? null : Number(r.nre_cost),
    nrePrice: r.nre_price == null ? null : Number(r.nre_price),
    piecesSubtotal: r.pieces_subtotal == null ? null : Number(r.pieces_subtotal),
    quoteTotal: r.quote_total == null ? null : Number(r.quote_total),
    marginActualPct: r.margin_actual_pct == null ? null : Number(r.margin_actual_pct),
    marginChargedPct: r.margin_charged_pct == null ? null : Number(r.margin_charged_pct),
    qRun: r.q_run == null ? null : Number(r.q_run),
    flaskCount: r.flask_count == null ? null : Number(r.flask_count),
    platingBatchCount: r.plating_batch_count == null ? null : Number(r.plating_batch_count),
    status: r.status as OemQuoteStatus,
    approvalNote: (r.approval_note as string | null) ?? null,
    approvedBy: (r.approved_by as string | null) ?? null,
    quoteValidUntil: (r.quote_valid_until as string | null) ?? null,
    lostReason: (r.lost_reason as string | null) ?? null,
    lostTo: (r.lost_to as string | null) ?? null,
    isExpired: Boolean(r.is_expired),
    daysLeft: r.days_left == null ? null : Number(r.days_left),
    // 0078: Asia/Bangkok-compared — prefer these two everywhere in the UI.
    isExpiredTh: Boolean(r.is_expired_th),
    daysLeftTh: r.days_left_th == null ? null : Number(r.days_left_th),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    discountThb: r.discount_thb == null ? 0 : Number(r.discount_thb),
    discountReason: (r.discount_reason as string | null) ?? null,
    grandTotal: r.grand_total == null ? null : Number(r.grand_total),
    marginAfterDiscountPct: r.margin_after_discount_pct == null ? null : Number(r.margin_after_discount_pct),
    parentQuoteId: (r.parent_quote_id as string | null) ?? null,
    parentQuoteNo: (r.parent_quote_no as string | null) ?? null,
    rootQuoteId: (r.root_quote_id as string | null) ?? null,
    customerId: (r.customer_id as string | null) ?? null,
    // 0082: constraint narrowed to 2 values ('included'/'breakdown') — the
    // ?? fallback below only ever protects against a pre-0075 null, same as
    // before, never against a legal-but-unrecognized 3rd value anymore.
    vatMode: (r.vat_mode as OemQuoteRow["vatMode"]) ?? "included",
    vatRate: r.vat_rate == null ? 0.07 : Number(r.vat_rate),
    vatBaseThb: r.vat_base_thb == null ? null : Number(r.vat_base_thb),
    vatAmountThb: r.vat_amount_thb == null ? null : Number(r.vat_amount_thb),
    // 0081: deposit_mode/deposit_input are the RAW inputs the owner typed —
    // deposit_amount_thb/deposit_pct_effective/balance_thb are computed
    // fresh by v_oem_quote every read (never re-derive them here).
    depositMode: (r.deposit_mode as OemQuoteRow["depositMode"]) ?? null,
    depositInput: r.deposit_input == null ? null : Number(r.deposit_input),
    depositAmountThb: r.deposit_amount_thb == null ? null : Number(r.deposit_amount_thb),
    depositPctEffective: r.deposit_pct_effective == null ? null : Number(r.deposit_pct_effective),
    balanceThb: r.balance_thb == null ? null : Number(r.balance_thb),
    itemCount: r.item_count == null ? 0 : Number(r.item_count),
    // 0077: appended columns, LEFT JOINed off oem_customer — all null until
    // setQuoteBilling has been called once for this quote.
    billLegalName: (r.bill_legal_name as string | null) ?? null,
    billTaxId: (r.bill_tax_id as string | null) ?? null,
    billPhone: (r.bill_phone as string | null) ?? null,
    billContactChannel: (r.bill_contact_channel as string | null) ?? null,
    // bill_address is jsonb the RPC never shape-validates (0075 §7) — parse
    // defensively, never trust it matches OemCustomerAddress.
    billAddress: parseBillAddress(r.bill_address),
    // 0086: NOT read from this row — v_oem_quote doesn't expose branch_label
    // (see OemQuoteRow.billBranchLabel's comment). attachBillBranchLabels()
    // fills this in after mapQuoteRow runs; default null here just keeps the
    // type honest for any caller that skips that step.
    billBranchLabel: null,
    // 0084: deal-level payment aggregates, computed fresh every read by
    // v_oem_quote (never re-derive these — see OemQuoteRow's own comment).
    paidThb: r.paid_thb == null ? null : Number(r.paid_thb),
    outstandingThb: r.outstanding_thb == null ? null : Number(r.outstanding_thb),
    isFullyPaid: r.is_fully_paid == null ? null : Boolean(r.is_fully_paid),
    receiptCount: r.receipt_count == null ? null : Number(r.receipt_count),
  };
}

// 0081/0082/0084: appended at the end, past bill_address — matches
// v_oem_quote's own append-only column order (42P16: view select lists can't
// be reordered without a drop/recreate, so every migration added its new
// columns last, ending with 0084's paid_thb/outstanding_thb/is_fully_paid/
// receipt_count — see that migration's comment on why those 4 must never move).
const QUOTE_COLUMNS =
  "id, quote_no, customer_name, customer_contact, input, calc, cost_piece, price_per_piece, nre_cost, nre_price, pieces_subtotal, quote_total, margin_actual_pct, margin_charged_pct, q_run, flask_count, plating_batch_count, status, approval_note, approved_by, quote_valid_until, lost_reason, lost_to, is_expired, days_left, is_expired_th, days_left_th, created_at, updated_at, discount_thb, discount_reason, grand_total, margin_after_discount_pct, parent_quote_id, parent_quote_no, root_quote_id, customer_id, vat_mode, item_count, bill_legal_name, bill_tax_id, bill_phone, bill_contact_channel, bill_address, deposit_mode, deposit_input, deposit_amount_thb, deposit_pct_effective, balance_thb, vat_rate, vat_base_thb, vat_amount_thb, paid_thb, outstanding_thb, is_fully_paid, receipt_count";

function mapQuoteItemRow(r: Record<string, unknown>): OemQuoteItemRow {
  return {
    id: String(r.id),
    shopId: String(r.shop_id),
    quoteId: String(r.quote_id),
    quoteNo: String(r.quote_no),
    seq: Number(r.seq),
    productId: (r.product_id as string | null) ?? null,
    skuSnapshot: (r.sku_snapshot as string | null) ?? null,
    productNameSnapshot: (r.product_name_snapshot as string | null) ?? null,
    input: fromInputPayload(r.input as Record<string, unknown>),
    calc: fromCalcResult(r.calc as Record<string, unknown>),
    qty: Number(r.qty),
    costPiece: r.cost_piece == null ? null : Number(r.cost_piece),
    pricePerPiece: r.price_per_piece == null ? null : Number(r.price_per_piece),
    itemTotal: r.item_total == null ? null : Number(r.item_total),
    qRun: r.q_run == null ? null : Number(r.q_run),
    flaskCount: r.flask_count == null ? null : Number(r.flask_count),
    platingBatchCount: r.plating_batch_count == null ? null : Number(r.plating_batch_count),
    marginChargedPct: r.margin_charged_pct == null ? null : Number(r.margin_charged_pct),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

const QUOTE_ITEM_COLUMNS =
  "id, shop_id, quote_id, seq, product_id, sku_snapshot, product_name_snapshot, input, calc, qty, cost_piece, price_per_piece, item_total, q_run, flask_count, plating_batch_count, margin_charged_pct, created_at, updated_at, quote_no";

export async function saveQuote(input: SaveQuoteInput): Promise<ActionResult<{ quoteId: string }>> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  if (!input?.items?.length) return { ok: false, error: "ต้องมีอย่างน้อย 1 รายการ" };
  for (const item of input.items) {
    if (!item?.input) return { ok: false, error: "มีบางรายการยังไม่มีข้อมูลงานที่จะคำนวณราคา" };
  }
  const discountThb = toNum(input.discountThb) ?? 0;
  if (discountThb < 0) return { ok: false, error: "ส่วนลดต้องไม่ติดลบ" };

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const pItems = input.items.map((item) => {
      const obj: Record<string, unknown> = { input: toCalcInputPayload(item.input) };
      if (item.productId) obj.product_id = item.productId;
      if (item.skuSnapshot?.trim()) obj.sku_snapshot = item.skuSnapshot.trim();
      if (item.productNameSnapshot?.trim()) obj.product_name_snapshot = item.productNameSnapshot.trim();
      return obj;
    });

    const { data, error } = await supabase.schema(SCHEMA).rpc("oem_quote_save", {
      p_shop_id: shopId,
      p_items: pItems,
      p_quote_id: input.quoteId || null,
      p_status: input.status || "draft",
      p_approval_note: input.approvalNote?.trim() || null,
      p_customer_name: input.customerName?.trim() || null,
      p_customer_contact: input.customerContact?.trim() || null,
      p_discount_thb: discountThb,
      p_discount_reason: input.discountReason?.trim() || null,
    });
    if (error) {
      // 22023 = our own controlled Thai validation messages (floor/margin/
      // incomplete-data gates in oem_quote_save) — safe to show verbatim.
      if ((error as { code?: string }).code === "22023") return { ok: false, error: error.message };
      throw error;
    }

    revalidateOemPaths();
    return { ok: true, data: { quoteId: String(data) } };
  } catch (err) {
    console.error("saveQuote failed", err);
    return { ok: false, error: "บันทึกใบเสนอราคาไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

export async function renegotiateQuote(input: RenegotiateQuoteInput): Promise<ActionResult<{ quoteId: string }>> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  if (!input?.quoteId) return { ok: false, error: "ไม่พบใบเสนอราคา" };
  const discount = toNum(input.newDiscountThb);
  if (discount === null || discount < 0) return { ok: false, error: "ส่วนลดใหม่ต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป" };

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data, error } = await supabase.schema(SCHEMA).rpc("oem_quote_renegotiate", {
      p_shop_id: shopId,
      p_quote_id: input.quoteId,
      p_new_discount_thb: discount,
      p_reason: input.reason?.trim() || null,
    });
    if (error) {
      if ((error as { code?: string }).code === "22023") return { ok: false, error: error.message };
      throw error;
    }

    revalidateOemPaths();
    return { ok: true, data: { quoteId: String(data) } };
  } catch (err) {
    console.error("renegotiateQuote failed", err);
    return { ok: false, error: "ต่อราคาไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

export async function setQuoteBilling(input: SetQuoteBillingInput): Promise<ActionResult<{ customerId: string }>> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  if (!input?.quoteId) return { ok: false, error: "ไม่พบใบเสนอราคา" };
  const legalName = input.legalName?.trim();
  if (!legalName) return { ok: false, error: "ต้องกรอกชื่อเต็ม/ชื่อนิติบุคคล" };
  // 2026-08 UAT fix (revised 2026-08 again — owner overruled "phone
  // mandatory"): mandatory/optional split is a Tech Lead decision, not just
  // BillingDialog's UX — legalName + full address + (phone OR
  // contactChannel) are required to print a usable quotation (procurement
  // can't open a PO without an address; some customers only talk over LINE
  // and have no phone to give, so it's "some way to reach them", not
  // "phone specifically" — see hasAnyContact in lib/oem/display.ts, the same
  // helper BillingDialog uses so client/server can't drift). BillingDialog
  // enforces the SAME rule client-side (per-field, on blur) but that is
  // UX-only; this is the real gate — never trust the client as the only
  // checkpoint (see this file's header).
  const addr = input.address;
  const missingAddr =
    !addr?.line1?.trim() || !addr?.subdistrict?.trim() || !addr?.district?.trim() || !addr?.province?.trim() || !addr?.postalCode?.trim();
  if (missingAddr) {
    return { ok: false, error: "ต้องกรอกที่อยู่ให้ครบ: บรรทัด 1, ตำบล/แขวง, อำเภอ/เขต, จังหวัด, รหัสไปรษณีย์" };
  }
  if (!/^\d{5}$/.test(addr!.postalCode!.trim())) {
    return { ok: false, error: "รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลัก" };
  }
  if (!hasAnyContact(input.phone, input.contactChannel)) {
    return { ok: false, error: "ต้องกรอกเบอร์โทร หรือช่องทางติดต่ออื่น (เช่น LINE ID) อย่างน้อย 1 อย่าง" };
  }
  // 0086: branch_label is conditionally mandatory — only when this buyer has
  // a taxId (= นิติบุคคล = full tax invoice under ป.รัษฎากร ม.86/4 needs the
  // buyer's branch too). A private individual (no taxId) can leave it blank,
  // same as taxId itself. This mirrors oem_receipt_issue's own gate (0086 §1)
  // so the error surfaces here, at billing-save time, instead of only at
  // receipt-issue time — but that RPC gate is still the real one; this is UX.
  if (input.taxId?.trim() && !input.branchLabel?.trim()) {
    return { ok: false, error: "ผู้ซื้อมีเลขผู้เสียภาษี (นิติบุคคล) ต้องกรอกสาขา (เช่น สำนักงานใหญ่) ก่อนบันทึก" };
  }
  // oem_quote_set_billing (0075) does NOT validate tax_id format itself
  // (stores whatever btrim() leaves) — this is the only gate. Client also
  // checks this before submit (BillingDialog), but that is UX-only; this is
  // the real one. taxId itself stays OPTIONAL (a private individual has none).
  if (input.taxId && !isValidThaiTaxId(input.taxId)) {
    return { ok: false, error: "เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก (หรือเว้นว่างไว้ถ้าเป็นบุคคลธรรมดา)" };
  }

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data, error } = await supabase.schema(SCHEMA).rpc("oem_quote_set_billing", {
      p_shop_id: shopId,
      p_quote_id: input.quoteId,
      p_customer: {
        legal_name: legalName,
        tax_id: input.taxId?.trim() || null,
        phone: input.phone?.trim() || null,
        contact_channel: input.contactChannel?.trim() || null,
        address: input.address ?? null,
        // 0086: new key in the same jsonb object — see SetQuoteBillingInput's comment.
        branch_label: input.branchLabel?.trim() || null,
      },
    });
    if (error) {
      if ((error as { code?: string }).code === "22023") return { ok: false, error: error.message };
      throw error;
    }

    revalidateOemPaths();
    return { ok: true, data: { customerId: String(data) } };
  } catch (err) {
    console.error("setQuoteBilling failed", err);
    return { ok: false, error: "บันทึกข้อมูลลูกค้าไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

export async function getQuoteItems(quoteId: string): Promise<ActionResult<OemQuoteItemRow[]>> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  if (!quoteId) return { ok: false, error: "ไม่พบใบเสนอราคา" };

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data, error } = await supabase
      .schema(SCHEMA)
      .from("v_oem_quote_item")
      .select(QUOTE_ITEM_COLUMNS)
      .eq("shop_id", shopId)
      .eq("quote_id", quoteId)
      .order("seq", { ascending: true });
    if (error) throw error;

    return { ok: true, data: ((data ?? []) as Record<string, unknown>[]).map(mapQuoteItemRow) };
  } catch (err) {
    console.error("getQuoteItems failed", err);
    return { ok: false, error: "โหลดรายการในใบเสนอราคาไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

export async function setQuoteStatus(input: SetQuoteStatusInput): Promise<ActionResult> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  if (!input?.quoteId) return { ok: false, error: "ไม่พบใบเสนอราคา" };

  // A TypeScript union is gone at runtime — this endpoint accepts whatever the
  // caller posts. Without this list, "draft" or "quoted" could be set here,
  // which skips oem_quote_save entirely and with it the recompute and every
  // floor gate (0065 blocks the same two states server-side; this is the
  // matching client-facing message).
  const SETTABLE = ["won", "lost", "rejected", "expired"] as const;
  if (!(SETTABLE as readonly string[]).includes(input.status)) {
    return { ok: false, error: "สถานะนี้เปลี่ยนตรงๆ ไม่ได้ — ต้องออกใบเสนอราคาใหม่ผ่านหน้าคิดราคา" };
  }
  if (input.status === "lost" && !input.lostReason?.trim()) {
    return { ok: false, error: "ปฏิเสธ/แพ้งานต้องระบุเหตุผล" };
  }

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { error } = await supabase.schema(SCHEMA).rpc("oem_quote_set_status", {
      p_shop_id: shopId,
      p_quote_id: input.quoteId,
      p_status: input.status,
      p_lost_reason: input.lostReason?.trim() || null,
      p_lost_to: input.lostTo?.trim() || null,
    });
    if (error) {
      if ((error as { code?: string }).code === "22023") return { ok: false, error: error.message };
      throw error;
    }

    revalidateOemPaths();
    return { ok: true, data: undefined };
  } catch (err) {
    console.error("setQuoteStatus failed", err);
    return { ok: false, error: "เปลี่ยนสถานะใบเสนอราคาไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

// ============================================================================
// Deposit (0081) — oem_quote_set_deposit RPC. Same gate pattern as
// setQuoteStatus above: server-side is the real enforcement (draft/quoted
// only, thb amount not exceeding grandTotal) — this layer only adds
// belt-and-braces so a bad request doesn't even leave the browser, same
// posture as every other write in this file (see the module header).
// ============================================================================

export async function setQuoteDeposit(input: SetQuoteDepositInput): Promise<ActionResult> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  if (!input?.quoteId) return { ok: false, error: "ไม่พบใบเสนอราคา" };

  // p_mode=null clears the deposit — oem_quote_set_deposit's own branch,
  // p_input is ignored server-side either way, sent as null here too so the
  // RPC call shape stays honest about what "clear" means.
  if (input.mode === null) {
    try {
      const shopId = getDevShopId();
      const supabase = getServiceClient();
      const { error } = await supabase.schema(SCHEMA).rpc("oem_quote_set_deposit", {
        p_shop_id: shopId,
        p_quote_id: input.quoteId,
        p_mode: null,
        p_input: null,
      });
      if (error) {
        if ((error as { code?: string }).code === "22023") return { ok: false, error: error.message };
        throw error;
      }
      revalidateOemPaths();
      return { ok: true, data: undefined };
    } catch (err) {
      console.error("setQuoteDeposit (clear) failed", err);
      return { ok: false, error: "ล้างมัดจำไม่สำเร็จ ลองใหม่อีกครั้ง" };
    }
  }

  if (input.mode !== "pct" && input.mode !== "thb") {
    return { ok: false, error: "โหมดมัดจำต้องเป็นเปอร์เซ็นต์หรือจำนวนเงิน" };
  }
  const value = toNum(input.input);
  if (value === null || value <= 0) return { ok: false, error: "จำนวนมัดจำต้องมากกว่า 0" };
  // 0081: pct mode is a FRACTION 0-1 here (the DepositDialog caller already
  // divided the 0-100 the user typed by 100) — this mirrors
  // oem_quote_set_deposit's own p_input <= 1 check for pct, catching a
  // caller bug (e.g. forgetting to divide) before it round-trips to Postgres.
  if (input.mode === "pct" && value > 1) {
    return { ok: false, error: "สัดส่วนมัดจำต้องไม่เกิน 100%" };
  }

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();
    const { error } = await supabase.schema(SCHEMA).rpc("oem_quote_set_deposit", {
      p_shop_id: shopId,
      p_quote_id: input.quoteId,
      p_mode: input.mode,
      p_input: value,
    });
    if (error) {
      // 22023 covers the RPC's own "แก้ได้เฉพาะ draft/quoted" gate + the
      // "มัดจำเกินยอดรวม" gate — both are controlled Thai messages, safe verbatim.
      if ((error as { code?: string }).code === "22023") return { ok: false, error: error.message };
      throw error;
    }
    revalidateOemPaths();
    return { ok: true, data: undefined };
  } catch (err) {
    console.error("setQuoteDeposit failed", err);
    return { ok: false, error: "บันทึกมัดจำไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

// ============================================================================
// VAT display mode (0082) — oem_quote_set_vat_mode RPC. 'breakdown' is
// rejected server-side (22023) when the shop hasn't ticked
// sellerVatRegistered — surfaced verbatim below, same as every other
// controlled Thai validation message in this file.
// ============================================================================

export async function setQuoteVatMode(input: SetQuoteVatModeInput): Promise<ActionResult> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  if (!input?.quoteId) return { ok: false, error: "ไม่พบใบเสนอราคา" };
  if (input.mode !== "included" && input.mode !== "breakdown") {
    return { ok: false, error: "รูปแบบภาษีไม่ถูกต้อง" };
  }

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();
    const { error } = await supabase.schema(SCHEMA).rpc("oem_quote_set_vat_mode", {
      p_shop_id: shopId,
      p_quote_id: input.quoteId,
      p_mode: input.mode,
    });
    if (error) {
      if ((error as { code?: string }).code === "22023") return { ok: false, error: error.message };
      throw error;
    }
    revalidateOemPaths();
    return { ok: true, data: undefined };
  } catch (err) {
    console.error("setQuoteVatMode failed", err);
    return { ok: false, error: "เปลี่ยนรูปแบบภาษีไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

/** 0086: v_oem_quote (0077) never got a bill_branch_label column — that
 * migration deliberately left the view alone (see its header, "ไม่แตะ
 * v_oem_quote เลย") and only added the source column on analytics.oem_customer
 * + wired it through oem_quote_set_billing/oem_receipt_issue. So this queries
 * oem_customer directly for the distinct customer_ids in the batch and merges
 * billBranchLabel onto each row after mapQuoteRow — same table, same RLS tier
 * (owner/admin select, 0075 §2) the view's own bill_* LEFT JOIN already reads
 * from, just fetched as a second round-trip instead of through the view.
 * Degrades to null (never throws) on failure so this side-fetch can never
 * break loading the quote page itself. */
async function attachBillBranchLabels(
  rows: OemQuoteRow[],
  shopId: string,
  supabase: ReturnType<typeof getServiceClient>
): Promise<OemQuoteRow[]> {
  const customerIds = Array.from(new Set(rows.map((r) => r.customerId).filter((id): id is string => !!id)));
  if (customerIds.length === 0) return rows;

  // QA round 2: chunk the id list (same reason as ID_CHUNK_SIZE in crm.ts —
  // a long `.in()` id list rides in the URL and can blow the ~16K header
  // cap). Before fetchAllRows, getQuotes was accidentally capped at 1,000
  // rows so this list could never get long; pagination removed that cap.
  const CHUNK = 200;
  const byId = new Map<string, string | null>();
  for (let i = 0; i < customerIds.length; i += CHUNK) {
    const { data, error } = await supabase
      .schema(SCHEMA)
      .from("oem_customer")
      .select("id, branch_label")
      .eq("shop_id", shopId)
      .in("id", customerIds.slice(i, i + CHUNK));
    if (error) {
      console.error("attachBillBranchLabels failed", error);
      return rows;
    }
    for (const c of (data ?? []) as { id: string; branch_label: string | null }[]) {
      byId.set(c.id, c.branch_label ?? null);
    }
  }
  return rows.map((r) => (r.customerId ? { ...r, billBranchLabel: byId.get(r.customerId) ?? null } : r));
}

export interface GetQuotesResult {
  rows: OemQuoteRow[];
  /** True count from the DB for this same filtered query (`count: "exact"`)
   * — trustworthy even when `rows.length` was capped at MAX_UNBOUNDED_ROWS.
   * See lib/supabase/query-limits.ts. */
  totalCount: number;
  truncated: boolean;
}

export async function getQuotes(status?: OemQuoteStatus): Promise<ActionResult<GetQuotesResult>> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    // fetchAllRows() pages past PostgREST's max-rows cap — see
    // lib/supabase/query-limits.ts (this is a growing document registry,
    // same risk class as the /crm/orders row cap it fixed). created_at can
    // tie (bulk operations, same millisecond), so `.order("id")` last is the
    // deterministic tiebreaker paging needs.
    const quoteResult = await fetchAllRows((pageFrom, pageTo) => {
      let q = supabase.schema(SCHEMA).from("v_oem_quote").select(QUOTE_COLUMNS, { count: "exact" }).eq("shop_id", shopId);
      if (status) q = q.eq("status", status);
      return q.order("created_at", { ascending: false }).order("id", { ascending: false }).range(pageFrom, pageTo);
    });

    const rows = (quoteResult.rows as Record<string, unknown>[]).map(mapQuoteRow);
    const withBranchLabels = await attachBillBranchLabels(rows, shopId, supabase);
    return { ok: true, data: { rows: withBranchLabels, totalCount: quoteResult.totalCount, truncated: quoteResult.truncated } };
  } catch (err) {
    console.error("getQuotes failed", err);
    return { ok: false, error: "โหลดรายการใบเสนอราคาไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

export async function getQuote(quoteId: string): Promise<ActionResult<OemQuoteRow>> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  if (!quoteId) return { ok: false, error: "ไม่พบใบเสนอราคา" };

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data, error } = await supabase
      .schema(SCHEMA)
      .from("v_oem_quote")
      .select(QUOTE_COLUMNS)
      .eq("shop_id", shopId)
      .eq("id", quoteId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { ok: false, error: "ไม่พบใบเสนอราคานี้" };

    const [row] = await attachBillBranchLabels([mapQuoteRow(data as Record<string, unknown>)], shopId, supabase);
    return { ok: true, data: row };
  } catch (err) {
    console.error("getQuote failed", err);
    return { ok: false, error: "โหลดใบเสนอราคาไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

// ============================================================================
// Receipts / tax invoices (0084: analytics.oem_receipt, oem_receipt_issue,
// oem_receipt_void, analytics.v_oem_receipt) — see lib/oem/types.ts's header
// on this section for the immutable-document model. Same posture as every
// other write in this file: server-side RPC gates are the REAL enforcement,
// this layer is belt-and-braces so a bad request never leaves the browser.
//
// M3 (0076) applies doubly hard here: oem_receipt rows carry the BUYER's
// tax_id/address (not just the shop's own), so every catch block below logs
// err.message only, never the raw error object — a Postgres error's
// detail/hint can echo query values back into the log.
// ============================================================================

function parseReceiptSellerSnapshot(raw: unknown): OemReceiptSellerSnapshot {
  const r = raw != null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const pickStr = (key: string): string | null => {
    const v = r[key];
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };
  const addressLines = Array.isArray(r.address_lines)
    ? (r.address_lines as unknown[]).filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    : null;
  return {
    legalName: pickStr("legal_name"),
    displayName: pickStr("display_name"),
    branchLabel: pickStr("branch_label"),
    addressLines,
    taxId: pickStr("tax_id"),
    phone: pickStr("phone"),
  };
}

function mapReceiptRow(r: Record<string, unknown>): OemReceiptRow {
  return {
    id: String(r.id),
    shopId: String(r.shop_id),
    quoteId: String(r.quote_id),
    receiptNo: String(r.receipt_no),
    kind: r.kind as OemReceiptRow["kind"],
    status: r.status as OemReceiptRow["status"],
    amountThb: Number(r.amount_thb),
    vatRate: Number(r.vat_rate),
    vatBaseThb: Number(r.vat_base_thb),
    vatAmountThb: Number(r.vat_amount_thb),
    receivedDate: String(r.received_date),
    issueDate: String(r.issue_date),
    paymentMethod: (r.payment_method as OemReceiptPaymentMethod | null) ?? null,
    paymentRef: (r.payment_ref as string | null) ?? null,
    description: String(r.description ?? ""),
    sellerSnapshot: parseReceiptSellerSnapshot(r.seller_snapshot),
    buyerLegalName: String(r.buyer_legal_name ?? ""),
    buyerTaxId: (r.buyer_tax_id as string | null) ?? null,
    buyerBranchLabel: (r.buyer_branch_label as string | null) ?? null,
    // buyer_address is jsonb the RPC never shape-validates (same posture as
    // OemQuoteRow.billAddress) — reuse the same defensive parser.
    buyerAddress: parseBillAddress(r.buyer_address),
    quoteNoSnapshot: String(r.quote_no_snapshot ?? ""),
    grandTotalSnapshot: Number(r.grand_total_snapshot ?? 0),
    paidBeforeThb: Number(r.paid_before_thb ?? 0),
    balanceAfterThb: Number(r.balance_after_thb ?? 0),
    voidReason: (r.void_reason as string | null) ?? null,
    voidedAt: (r.voided_at as string | null) ?? null,
    voidedBy: (r.voided_by as string | null) ?? null,
    reissuedFromReceiptId: (r.reissued_from_receipt_id as string | null) ?? null,
    createdBy: (r.created_by as string | null) ?? null,
    createdAt: String(r.created_at),
    quoteNo: String(r.quote_no ?? ""),
    isDealActive: Boolean(r.is_deal_active),
  };
}

const RECEIPT_COLUMNS =
  "id, shop_id, quote_id, receipt_no, kind, status, amount_thb, vat_rate, vat_base_thb, vat_amount_thb, received_date, issue_date, payment_method, payment_ref, description, seller_snapshot, buyer_legal_name, buyer_tax_id, buyer_branch_label, buyer_address, quote_no_snapshot, grand_total_snapshot, paid_before_thb, balance_after_thb, void_reason, voided_at, voided_by, reissued_from_receipt_id, created_by, created_at, quote_no, is_deal_active";

export async function issueReceipt(input: IssueReceiptInput): Promise<ActionResult<{ receiptId: string }>> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  if (!input?.quoteId) return { ok: false, error: "ไม่พบใบเสนอราคา" };
  const amount = toNum(input.amountThb);
  // Range check (not a bare "> 0") mirrors oem_receipt_issue's own guard —
  // 0084 copies the 0083 NaN-safety lesson (NaN > every number, incl.
  // Infinity, in Postgres) even though toNum() already excludes NaN here;
  // kept as an explicit range so this file's gate reads the same as the DB's.
  if (amount === null || !(amount > 0 && amount <= 100_000_000)) {
    return { ok: false, error: "จำนวนเงินที่รับต้องมากกว่า 0 และไม่เกิน 100,000,000 บาท" };
  }
  if (!input.receivedDate || !/^\d{4}-\d{2}-\d{2}$/.test(input.receivedDate)) {
    return { ok: false, error: "กรุณาระบุวันที่รับเงิน" };
  }
  if (!input.kind || !["deposit", "partial", "final"].includes(input.kind)) {
    return { ok: false, error: "ประเภทการรับเงินไม่ถูกต้อง" };
  }
  if (input.paymentMethod != null && !["transfer", "cash", "other"].includes(input.paymentMethod)) {
    return { ok: false, error: "ช่องทางรับเงินไม่ถูกต้อง" };
  }

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data, error } = await supabase.schema(SCHEMA).rpc("oem_receipt_issue", {
      p_shop_id: shopId,
      p_quote_id: input.quoteId,
      p_amount_thb: amount,
      p_received_date: input.receivedDate,
      p_kind: input.kind,
      p_payment_method: input.paymentMethod ?? null,
      p_payment_ref: input.paymentRef?.trim() || null,
      p_description: input.description?.trim() || null,
      p_reissued_from: input.reissuedFrom ?? null,
    });
    if (error) {
      // 22023 = controlled Thai validation messages (status/seller/buyer/
      // overpay/future-date gates in oem_receipt_issue) — safe to show verbatim.
      if ((error as { code?: string }).code === "22023") return { ok: false, error: error.message };
      throw error;
    }

    revalidateOemPaths();
    return { ok: true, data: { receiptId: String(data) } };
  } catch (err) {
    console.error("issueReceipt failed:", err instanceof Error ? err.message : String(err));
    return { ok: false, error: "บันทึกรับเงินไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

export async function voidReceipt(input: VoidReceiptInput): Promise<ActionResult> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  if (!input?.receiptId) return { ok: false, error: "ไม่พบใบเสร็จ" };
  if (!input.reason?.trim()) return { ok: false, error: "ต้องระบุเหตุผลก่อนยกเลิกใบเสร็จ/ใบกำกับภาษี" };

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { error } = await supabase.schema(SCHEMA).rpc("oem_receipt_void", {
      p_shop_id: shopId,
      p_receipt_id: input.receiptId,
      p_reason: input.reason.trim(),
    });
    if (error) {
      if ((error as { code?: string }).code === "22023") return { ok: false, error: error.message };
      throw error;
    }

    revalidateOemPaths();
    return { ok: true, data: undefined };
  } catch (err) {
    console.error("voidReceipt failed:", err instanceof Error ? err.message : String(err));
    return { ok: false, error: "ยกเลิกใบเสร็จไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every quote_id belonging to the SAME DEAL as `quoteId` (its whole
 * root_quote_id chain), read straight off analytics.oem_quote (id/
 * root_quote_id ONLY — never selects cost/margin/calc). Needed because
 * oem_receipt.quote_id is NEVER re-pointed when a deal is renegotiated
 * (0084 §5/§6 — a receipt stays attached to whichever row was active when it
 * was issued, even after that row becomes 'superseded'), so "every receipt
 * for this job" means every receipt whose quote_id is IN this chain, not
 * just quote_id = the chain's current active row. Mirrors the same
 * root_quote_id aggregation oem_receipt_issue/v_oem_quote already do
 * server-side — see those for the canonical version of this logic. */
async function resolveDealQuoteIds(
  supabase: ReturnType<typeof getServiceClient>,
  shopId: string,
  quoteId: string
): Promise<string[]> {
  if (!UUID_RE.test(quoteId)) return [];
  const { data: anchor, error: anchorErr } = await supabase
    .schema(SCHEMA)
    .from("oem_quote")
    .select("id, root_quote_id")
    .eq("shop_id", shopId)
    .eq("id", quoteId)
    .maybeSingle();
  if (anchorErr) throw anchorErr;
  if (!anchor) return [quoteId];
  const rootId = (anchor.root_quote_id as string | null) ?? (anchor.id as string);

  const { data: chain, error: chainErr } = await supabase
    .schema(SCHEMA)
    .from("oem_quote")
    .select("id")
    .eq("shop_id", shopId)
    .or(`id.eq.${rootId},root_quote_id.eq.${rootId}`);
  if (chainErr) throw chainErr;
  const ids = ((chain ?? []) as { id: string }[]).map((r) => r.id);
  return ids.length > 0 ? ids : [quoteId];
}

export interface GetReceiptsResult {
  rows: OemReceiptRow[];
  /** True count from the DB for this same filtered query (`count: "exact"`)
   * — trustworthy even when `rows.length` was capped at MAX_UNBOUNDED_ROWS.
   * See lib/supabase/query-limits.ts. Receipts are immutable tax
   * documents (oem-quote-invariants §7) — a silently truncated registry is
   * worse here than almost anywhere else in the app. */
  totalCount: number;
  truncated: boolean;
}

/** All receipts for a shop, optionally scoped to one job/deal (every
 * quote_id in that deal's renegotiation chain — see resolveDealQuoteIds).
 * Pass no quoteId for /oem/receipts' shop-wide registry. */
export async function getReceipts(quoteId?: string): Promise<ActionResult<GetReceiptsResult>> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    let dealIds: string[] | null = null;
    if (quoteId) {
      dealIds = await resolveDealQuoteIds(supabase, shopId, quoteId);
      if (dealIds.length === 0) return { ok: true, data: { rows: [], totalCount: 0, truncated: false } };
    }

    // fetchAllRows() pages past PostgREST's max-rows cap — see
    // lib/supabase/query-limits.ts (same risk class as the /crm/orders row
    // cap it fixed; this table is a legal tax-document registry).
    // created_at can tie, so `.order("id")` last is the deterministic
    // tiebreaker paging needs.
    const receiptResult = await fetchAllRows((pageFrom, pageTo) => {
      let q = supabase.schema(SCHEMA).from("v_oem_receipt").select(RECEIPT_COLUMNS, { count: "exact" }).eq("shop_id", shopId);
      if (dealIds) q = q.in("quote_id", dealIds);
      return q.order("created_at", { ascending: false }).order("id", { ascending: false }).range(pageFrom, pageTo);
    });

    const rows = (receiptResult.rows as Record<string, unknown>[]).map(mapReceiptRow);
    return { ok: true, data: { rows, totalCount: receiptResult.totalCount, truncated: receiptResult.truncated } };
  } catch (err) {
    console.error("getReceipts failed:", err instanceof Error ? err.message : String(err));
    return { ok: false, error: "โหลดรายการใบเสร็จไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}

export async function getReceipt(receiptId: string): Promise<ActionResult<OemReceiptRow>> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  if (!receiptId) return { ok: false, error: "ไม่พบใบเสร็จ" };

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data, error } = await supabase
      .schema(SCHEMA)
      .from("v_oem_receipt")
      .select(RECEIPT_COLUMNS)
      .eq("shop_id", shopId)
      .eq("id", receiptId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { ok: false, error: "ไม่พบใบเสร็จนี้" };

    return { ok: true, data: mapReceiptRow(data as Record<string, unknown>) };
  } catch (err) {
    console.error("getReceipt failed:", err instanceof Error ? err.message : String(err));
    return { ok: false, error: "โหลดใบเสร็จไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}
