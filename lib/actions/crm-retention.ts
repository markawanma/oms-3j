"use server";

// lib/actions/crm-retention.ts — CRM retention read layer
// (supabase/migrations/0120_crm_retention.sql): recency ladder + repeat-
// purchase cohort. A NEW read action, sibling to lib/actions/crm.ts /
// lib/actions/marketing.ts — same service-client + getDevShopId() +
// ActionResult<T> pattern (see crm.ts's SHOP SCOPING NOTE for why
// getServiceClient() bypasses RLS and every call below is manually scoped
// via the RPC's p_shop_id argument).
//
// Money gating: p_include_money = false for staff — same reasoning as
// marketing.ts's requireOwnerAdmin() PII gate, but staff still gets the full
// retention SHAPE (bucket/cohort counts), just no THB figures, per the Tech
// Lead brief. canPullList mirrors that same role check so the frontend can
// gate a future "pull audience list" action without re-deriving role
// client-side.
//
// 17 ก.ย. 69 — role source changed while this branch sat unmerged: the brief
// said getDevRole(), but A2-lite shipped getEffectiveRole() (lib/auth/role.ts)
// and DEV_ROLE now has zero authority whenever AUTH_GATE=on. Keeping
// getDevRole() here would have hidden every THB figure from the logged-in
// owner on production (the exact bug lib/auth/role.ts's header describes) and
// handed money to anyone if DEV_ROLE were ever set. It is await-ed, so the
// role must be resolved BEFORE the two RPCs are issued.
//
// ไฟล์นี้ไม่แตะ lib/actions/crm.ts และ dashboard component ใดๆ เลย —
// เดิมเพราะงานคู่ขนานตอน 14 ก.ย. ตอนนี้งานนั้นจบแล้ว แต่ขอบเขตนี้ยังถือต่อ
// เพราะ retention เป็น read layer แยก ไม่มีเหตุต้องแก้ของกลาง

import { getServiceClient } from "@/lib/supabase/server";
import { getDevShopId } from "@/lib/dev/context";
import { getEffectiveRole } from "@/lib/auth/role";
import { RECENCY_BUCKETS } from "@/lib/crm/retention";
import type { ActionResult } from "@/lib/types";
import type {
  CrmRetentionData,
  RecencyBucket,
  RecencyLadder,
  RecencyLadderCell,
  RepeatBaselineWindowStat,
  RepeatCohort,
  RepeatCohortBaseline,
  RepeatCohortWeek,
  RepeatWindowStat,
} from "@/lib/crm/retention";
import type { ProductAffinity } from "@/lib/marketing/types";

const SCHEMA = "analytics";

// ---- raw RPC payload shapes (jsonb, from supabase/migrations/0120) --------

interface LadderCellRaw {
  bucket: RecencyBucket;
  reachable: boolean;
  affinity: ProductAffinity;
  customers: number;
  revenue: number | null;
}

interface LadderRaw {
  as_of: string;
  max_order_date: string | null;
  customers_total: number;
  cells: LadderCellRaw[];
}

interface WindowStatRaw {
  n: number;
  rate: number | null;
  mature: boolean;
}

interface BaselineWindowStatRaw {
  n: number;
  rate: number | null;
}

interface CohortWeekRaw {
  week_start: string;
  channel_code: string;
  new_n: number;
  w7: WindowStatRaw;
  w14: WindowStatRaw;
  w30: WindowStatRaw;
}

interface CohortBaselineRaw {
  channel_code: string;
  new_n: number;
  w7: BaselineWindowStatRaw;
  w14: BaselineWindowStatRaw;
  w30: BaselineWindowStatRaw;
}

interface CohortRaw {
  as_of: string | null;
  excluded_orders_no_customer: number;
  weeks: CohortWeekRaw[];
  baseline: CohortBaselineRaw[];
}

function mapLadder(raw: LadderRaw): RecencyLadder {
  // filter ก่อน map (code-review N1): SQL คืน bucket = null ได้ถ้า
  // rfm.recency_days เป็น null — วันนี้เกิดยาก (base กรอง order_count > 0) แต่
  // ถ้าเกิด UI จะไป lookup RECENCY_BUCKET_LABEL_TH[null] ได้ undefined แล้ว
  // **แถวหายเงียบ** โดยไม่มีใครรู้ว่าข้อมูลขาด — พังแบบเดียวกับที่
  // lib/crm/segments.ts บันทึกไว้เอง (dashboard เคย render raw key เพราะ
  // label map ขาด) ตัดทิ้งที่นี่ถูกกว่าไปตามหาทีหลัง
  const cells: RecencyLadderCell[] = (raw.cells ?? [])
    .filter((c) => RECENCY_BUCKETS.includes(c.bucket))
    .map((c) => ({
      bucket: c.bucket,
      reachable: Boolean(c.reachable),
      affinity: c.affinity ?? "unknown",
      customers: Number(c.customers) || 0,
      revenue: c.revenue === null || c.revenue === undefined ? null : Number(c.revenue),
    }));
  return {
    asOf: raw.as_of,
    maxOrderDate: raw.max_order_date,
    customersTotal: Number(raw.customers_total) || 0,
    cells,
  };
}

function mapWindowStat(raw: WindowStatRaw | undefined | null): RepeatWindowStat {
  return {
    n: Number(raw?.n) || 0,
    rate: raw?.rate === null || raw?.rate === undefined ? null : Number(raw.rate),
    mature: Boolean(raw?.mature),
  };
}

function mapBaselineWindowStat(raw: BaselineWindowStatRaw | undefined | null): RepeatBaselineWindowStat {
  return {
    n: Number(raw?.n) || 0,
    rate: raw?.rate === null || raw?.rate === undefined ? null : Number(raw.rate),
  };
}

function mapCohort(raw: CohortRaw): RepeatCohort {
  const weeks: RepeatCohortWeek[] = (raw.weeks ?? []).map((w) => ({
    weekStart: w.week_start,
    channelCode: w.channel_code,
    newN: Number(w.new_n) || 0,
    w7: mapWindowStat(w.w7),
    w14: mapWindowStat(w.w14),
    w30: mapWindowStat(w.w30),
  }));
  const baseline: RepeatCohortBaseline[] = (raw.baseline ?? []).map((b) => ({
    channelCode: b.channel_code,
    newN: Number(b.new_n) || 0,
    w7: mapBaselineWindowStat(b.w7),
    w14: mapBaselineWindowStat(b.w14),
    w30: mapBaselineWindowStat(b.w30),
  }));
  return {
    asOf: raw.as_of,
    excludedOrdersNoCustomer: Number(raw.excluded_orders_no_customer) || 0,
    weeks,
    baseline,
  };
}

export async function getCrmRetention(): Promise<ActionResult<CrmRetentionData>> {
  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();
    // แยกสองด่านออกจากกันตั้งแต่ต้น (security review M2): วันนี้ค่าเท่ากัน
    // แต่คนละเหตุผล — "เห็นตัวเลขเงิน" กับ "ดึงรายชื่อลูกค้า (PII) ออกไป"
    // มัดไว้ใน boolean ตัวเดียวแล้ววันที่เจ้าของบอกว่า "แอดมินดูเงินได้ แต่
    // ห้ามดึงเบอร์" จะแก้ไม่ได้โดยไม่พังอีกฝั่ง
    // ⚠️ canPullList เดินทางไปฝั่ง client = ผู้ใช้แก้ค่าเองได้ ⇒ ใช้ซ่อนปุ่ม
    // เท่านั้น **ห้ามเป็นด่าน** — action "ดึงรายชื่อ" ที่จะมาทีหลังต้องเช็ค
    // role ในตัวมันเองซ้ำเสมอ
    const role = await getEffectiveRole();
    const includeMoney = role !== "staff";
    const canPullList = role !== "staff";

    // p_weeks left at the RPC's own default (26) — no UI control for it yet
    // (frontend-dev's page can pass one through later if the owner wants a
    // shorter/longer cohort window; the RPC itself enforces 1-104 either way).
    const [ladderRes, cohortRes] = await Promise.all([
      supabase.schema(SCHEMA).rpc("crm_recency_ladder", {
        p_shop_id: shopId,
        p_include_money: includeMoney,
      }),
      supabase.schema(SCHEMA).rpc("crm_repeat_cohort", {
        p_shop_id: shopId,
      }),
    ]);
    if (ladderRes.error) throw ladderRes.error;
    if (cohortRes.error) throw cohortRes.error;

    const ladder = mapLadder(ladderRes.data as LadderRaw);
    const cohort = mapCohort(cohortRes.data as CohortRaw);

    return {
      ok: true,
      data: { ladder, cohort, canPullList },
    };
  } catch (err) {
    console.error("getCrmRetention failed", err);
    return { ok: false, error: "โหลดข้อมูล retention ไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
}
