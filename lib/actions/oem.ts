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
  OemBatchLine,
  OemFloors,
  OemLaborStep,
  OemMetalPriceMap,
  OemMissingRateEntry,
  OemPriceBreakdown,
  OemPriceCalcInput,
  OemPriceCalcResult,
  OemQuoteRow,
  OemQuoteStatus,
  OemRateStatusRow,
  OemReadiness,
  OemSettingData,
  SaveMetalPriceInput,
  SaveQuoteInput,
  SetQuoteStatusInput,
  UpsertOemRateInput,
  UpsertOemSettingInput,
} from "@/lib/oem/types";

const SCHEMA = "analytics";
// T4-T6 routes (all `dynamic = "force-dynamic"`, so this is belt-and-braces
// alongside router.refresh() on the client side, not the only cache-buster).
const OEM_PATHS = ["/oem/rates", "/oem/quote", "/oem/quotes"] as const;
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
      effectiveLossPct: metal.effective_loss_pct == null ? null : Number(metal.effective_loss_pct),
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
        "margin_target_pct, margin_discount_cap_pct, margin_floor_pct, margin_hard_floor_pct, nre_max_share_pct, min_job_value_thb, quote_valid_days_silver, quote_valid_days_gold, quote_valid_days_brass, formula_version"
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

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

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
    });
    if (error) throw error;

    revalidateOemPaths();
    return { ok: true, data: undefined };
  } catch (err) {
    console.error("saveOemSetting failed", err);
    return { ok: false, error: "บันทึกการตั้งค่ามาร์จิ้น/floor ไม่สำเร็จ — ตรวจว่า hard floor ≤ floor ≤ เพดานส่วนลด ≤ เป้าหมาย" };
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
// Price calculator — read-only preview, does NOT revalidate anything (no
// write happened). This is the live "กรอกแล้วเห็นราคาทันที" calculator; a
// quote is only persisted via saveQuote below.
// ============================================================================

export async function calcPrice(input: OemPriceCalcInput): Promise<ActionResult<OemPriceCalcResult>> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  if (!input?.metal || !input.itemKind?.trim() || !input.polishTier?.trim()) {
    return { ok: false, error: "กรุณาเลือกวัสดุ / ประเภทงาน / ระดับความยากขัด" };
  }
  if (!Number.isFinite(input.qty) || input.qty <= 0) return { ok: false, error: "จำนวนชิ้นต้องมากกว่า 0" };
  if (!Number.isFinite(input.weightG) || input.weightG <= 0) return { ok: false, error: "น้ำหนักต่อชิ้นต้องมากกว่า 0" };

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
    input: r.input as OemPriceCalcInput,
    calc: fromCalcResult(r.calc as Record<string, unknown>),
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
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

const QUOTE_COLUMNS =
  "id, quote_no, customer_name, customer_contact, input, calc, cost_piece, price_per_piece, nre_cost, nre_price, pieces_subtotal, quote_total, margin_actual_pct, margin_charged_pct, q_run, flask_count, plating_batch_count, status, approval_note, approved_by, quote_valid_until, lost_reason, lost_to, is_expired, days_left, created_at, updated_at";

export async function saveQuote(input: SaveQuoteInput): Promise<ActionResult<{ quoteId: string }>> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  if (!input?.input) return { ok: false, error: "ไม่พบข้อมูลงานที่จะคำนวณราคา" };

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { data, error } = await supabase.schema(SCHEMA).rpc("oem_quote_save", {
      p_shop_id: shopId,
      p_input: toCalcInputPayload(input.input),
      p_quote_id: input.quoteId || null,
      p_status: input.status || "draft",
      p_approval_note: input.approvalNote?.trim() || null,
      p_customer_name: input.customerName?.trim() || null,
      p_customer_contact: input.customerContact?.trim() || null,
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

export async function getQuotes(status?: OemQuoteStatus): Promise<ActionResult<OemQuoteRow[]>> {
  const gateErr = requireOwnerAdmin();
  if (gateErr) return gateErr;

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    let query = supabase.schema(SCHEMA).from("v_oem_quote").select(QUOTE_COLUMNS).eq("shop_id", shopId);
    if (status) query = query.eq("status", status);
    const { data, error } = await query.order("created_at", { ascending: false });
    if (error) throw error;

    return { ok: true, data: ((data ?? []) as Record<string, unknown>[]).map(mapQuoteRow) };
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

    return { ok: true, data: mapQuoteRow(data as Record<string, unknown>) };
  } catch (err) {
    console.error("getQuote failed", err);
    return { ok: false, error: "โหลดใบเสนอราคาไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}
