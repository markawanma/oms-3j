"use client";

// RecoList — /marketing/copilot recommendation feed (docs/3j-jewelry/analytics/
// phase-b3-design.md §4), backed by analytics.v_marketing_reco + mkt_reco_decision
// (0027 §4/§5). GENERIC over rule_code by design: this file loops every row
// the view returns and renders it from `title`/`severity`/`detail`/`is_blocked`
// alone — it never branches on which rule fired (R0 vs R1 vs a rule added
// next migration). The one exception is a nicer structured render for
// `live_targeting_brief`'s payload shape (see LiveTargetingDetail below),
// which is purely cosmetic (better formatting of known fields) and falls
// back to the generic chip renderer if the payload doesn't look as expected
// — it can never block a new rule from rendering.
//
// Approve/dismiss is a DB write now (mkt_reco_decision), unlike the TikTok
// Ad Copilot's localStorage-only version — reuses that module's
// CopilotSection (fully generic, no TikTok-specific typing) for the
// pending/approved/dismissed grouping so the module doesn't invent a new
// section-collapse component.

import { useState, useTransition } from "react";
import {
  AlertTriangle,
  Ban,
  Info,
  Sparkles,
  Target,
  TrendingUp,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { decideReco } from "@/lib/actions/marketing";
import {
  mktRuleLabel,
  mktSeverityLabel,
  mktSeverityTone,
} from "@/lib/marketing/types";
import type { MktLiveTargetingDetail, MktRecoRow } from "@/lib/marketing/types";
import { SEGMENT_LABEL_TH } from "@/lib/crm/segments";
import type { RfmSegment } from "@/lib/crm/segments";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { CopilotSection } from "@/components/domain/tiktok/CopilotSection";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatCount, formatThaiDateOnly, formatTHBCompact } from "@/lib/tiktok/format";

const SEVERITY_ICON: Record<string, LucideIcon> = {
  blocker: AlertTriangle,
  high: TrendingUp,
  medium: Target,
  info: Info,
};

// Cosmetic label/format lookup for scalar `detail` payload keys shared across
// R0-R5 (0027 §4) — presentation only, never used to decide how a card
// behaves. Unknown keys still render, just with the raw key as their label.
const DETAIL_KEY_META: Record<string, { label: string; format?: "money" | "count" }> = {
  window_days: { label: "ช่วงที่ตรวจ (วัน)", format: "count" },
  checked_at: { label: "ตรวจล่าสุด" },
  at_risk_count: { label: "ลูกค้าเสี่ยงหาย", format: "count" },
  segment: { label: "กลุ่ม" },
  province_code: { label: "รหัสจังหวัด" },
  province_name: { label: "จังหวัด" },
  orders_60d: { label: "ออเดอร์ 60 วัน", format: "count" },
  aov: { label: "AOV", format: "money" },
  median_aov: { label: "AOV ค่ากลาง", format: "money" },
  channel_code: { label: "ช่องทาง" },
  month: { label: "เดือน" },
  cac: { label: "CAC", format: "money" },
  spend: { label: "ค่าแอด", format: "money" },
  spend_months_available: { label: "เดือนที่มีค่าแอด", format: "count" },
  champion_count: { label: "ลูกค้า champion", format: "count" },
};

function isScalar(v: unknown): v is string | number | boolean {
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

function formatDetailValue(key: string, value: unknown): string {
  const meta = DETAIL_KEY_META[key];
  if (meta?.format === "money") return formatTHBCompact(Number(value));
  if (meta?.format === "count") return formatCount(Number(value));
  return String(value);
}

/** Generic fallback renderer — every rule's scalar detail fields as small
 * metric chips (mirrors CopilotCard's reasonMetrics chip style). Non-scalar
 * fields (arrays/objects, e.g. R6's payload) are skipped here — those get
 * their own renderer below instead of a useless "[object Object]" chip. */
function DetailChips({ detail }: { detail: Record<string, unknown> }) {
  const entries = Object.entries(detail).filter(([, v]) => isScalar(v));
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {entries.map(([key, value]) => (
        <span key={key} className="rounded bg-zinc-100 px-2 py-1 text-xs font-semibold text-zinc-700 tabular-nums">
          {DETAIL_KEY_META[key]?.label ?? key} <span className="text-primary-700">{formatDetailValue(key, value)}</span>
        </span>
      ))}
    </div>
  );
}

/** Structured render for `live_targeting_brief`'s payload (0027 §4 R6) —
 * cosmetic upgrade over DetailChips for this one known shape. Every field is
 * defensively optional; a payload that doesn't match (future schema change)
 * silently renders nothing extra rather than throwing. */
function LiveTargetingDetail({ detail }: { detail: Partial<MktLiveTargetingDetail> }) {
  const topProvinces = Array.isArray(detail.top_provinces) ? detail.top_provinces : [];
  const segmentMix = detail.segment_mix && typeof detail.segment_mix === "object" ? detail.segment_mix : {};
  const hourlyOrders = Array.isArray(detail.hourly_orders) ? detail.hourly_orders : [];

  if (topProvinces.length === 0 && Object.keys(segmentMix).length === 0 && hourlyOrders.length === 0) return null;

  return (
    <div className="flex flex-col gap-2.5 rounded-md bg-zinc-50 p-2.5 text-xs">
      {topProvinces.length > 0 && (
        <div>
          <p className="font-semibold text-zinc-700">จังหวัดยอดขายดี (60 วันล่าสุด)</p>
          <ul className="mt-1 flex flex-col gap-0.5 text-zinc-600">
            {topProvinces.slice(0, 5).map((p) => (
              <li key={p.province_code}>
                {p.province_name ?? p.province_code} — {formatCount(p.orders)} ออเดอร์ · {formatTHBCompact(p.revenue)} · AOV{" "}
                {formatTHBCompact(p.aov)}
              </li>
            ))}
          </ul>
        </div>
      )}
      {Object.keys(segmentMix).length > 0 && (
        <div>
          <p className="font-semibold text-zinc-700">กลุ่มลูกค้าที่ซื้อ</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {Object.entries(segmentMix)
              .sort((a, b) => b[1] - a[1])
              .map(([seg, count]) => (
                <span key={seg} className="rounded bg-white px-2 py-0.5 font-semibold text-zinc-700 tabular-nums">
                  {SEGMENT_LABEL_TH[seg as RfmSegment] ?? seg} <span className="text-primary-700">{count}</span>
                </span>
              ))}
          </div>
        </div>
      )}
      {hourlyOrders.length > 0 && (
        <div>
          <p className="font-semibold text-zinc-700">ช่วงเวลาที่ออเดอร์เยอะ</p>
          <p className="mt-1 text-zinc-600">
            {hourlyOrders
              .slice(0, 3)
              .map((h) => `${String(h.hour).padStart(2, "0")}:00 น. (${formatCount(h.orders)} ออเดอร์)`)
              .join(" · ")}
          </p>
        </div>
      )}
    </div>
  );
}

function RecoCard({
  row,
  busy,
  onDecide,
}: {
  row: MktRecoRow;
  busy: boolean;
  onDecide: (recoKey: string, status: "approved" | "dismissed") => void;
}) {
  const Icon = SEVERITY_ICON[row.severity] ?? Sparkles;
  const decided = row.status !== "pending";
  const isBlockerSeverity = row.severity === "blocker";

  return (
    <div
      className={`flex flex-col gap-2.5 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm ${
        decided || row.isBlocked ? "opacity-70" : ""
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${
            isBlockerSeverity ? "bg-amber-100" : "bg-primary-100"
          }`}
        >
          <Icon className={`h-4 w-4 ${isBlockerSeverity ? "text-amber-700" : "text-primary-700"}`} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-snug font-bold text-balance text-zinc-900">{row.title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge tone="slate">{mktRuleLabel(row.ruleCode)}</Badge>
            {!decided && !row.isBlocked && (
              <Badge tone={mktSeverityTone(row.severity)}>{mktSeverityLabel(row.severity)}</Badge>
            )}
            {decided && (
              <span className="text-xs text-zinc-400">
                {row.status === "approved" ? "อนุมัติเมื่อ " : "ปิดเมื่อ "}
                {row.decidedAt ? formatThaiDateOnly(row.decidedAt.slice(0, 10)) : "-"}
              </span>
            )}
          </div>
        </div>
      </div>

      {row.ruleCode === "live_targeting_brief" ? (
        <LiveTargetingDetail detail={row.detail as Partial<MktLiveTargetingDetail>} />
      ) : (
        <DetailChips detail={row.detail} />
      )}

      {row.isBlocked && row.blockedReason && (
        <div className="flex items-start gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-2">
          <Ban className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-400" aria-hidden="true" />
          <p className="text-xs leading-relaxed text-zinc-500">{row.blockedReason}</p>
        </div>
      )}

      {row.isBlocked ? (
        <div>
          <Badge tone="slate">ยังใช้งานไม่ได้</Badge>
        </div>
      ) : decided ? (
        <div>
          <Badge tone={row.status === "approved" ? "green" : "slate"}>
            {row.status === "approved" ? "✓ อนุมัติแล้ว" : "✕ ปิดแล้ว"}
          </Badge>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => onDecide(row.recoKey, "dismissed")}>
            ปิด
          </Button>
          <Button variant="primary" size="sm" loading={busy} onClick={() => onDecide(row.recoKey, "approved")}>
            {isBlockerSeverity ? "รับทราบ" : "อนุมัติ"}
          </Button>
        </div>
      )}
    </div>
  );
}

export function RecoList({ initialRows }: { initialRows: MktRecoRow[] }) {
  const toast = useToast();
  const [rows, setRows] = useState(initialRows);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function handleDecide(recoKey: string, status: "approved" | "dismissed") {
    setBusyKey(recoKey);
    startTransition(async () => {
      const result = await decideReco({ recoKey, status });
      setBusyKey(null);
      if (!result.ok) {
        toast.push(result.error, "error");
        return;
      }
      setRows((prev) =>
        prev.map((r) => (r.recoKey === recoKey ? { ...r, status, decidedAt: new Date().toISOString() } : r))
      );
      toast.push(status === "approved" ? "บันทึกการอนุมัติแล้ว" : "ปิดคำแนะนำนี้แล้ว");
    });
  }

  if (rows.length === 0) {
    return (
      <EmptyState icon={Sparkles} title="ยังไม่มีคำแนะนำตอนนี้" description="ระบบจะวิเคราะห์ใหม่เมื่อมีข้อมูลมากพอ" />
    );
  }

  const pending = rows.filter((r) => r.status === "pending" && !r.isBlocked);
  const blocked = rows.filter((r) => r.isBlocked);
  const approved = rows.filter((r) => r.status === "approved" && !r.isBlocked);
  const dismissed = rows.filter((r) => r.status === "dismissed" && !r.isBlocked);

  return (
    <div className="space-y-4">
      <CopilotSection title="รอพิจารณา" count={pending.length}>
        {pending.length === 0 ? (
          <p className="py-4 text-center text-sm text-zinc-400">ตัดสินใจครบทุกใบแล้ว</p>
        ) : (
          pending.map((r) => <RecoCard key={r.recoKey} row={r} busy={busyKey === r.recoKey} onDecide={handleDecide} />)
        )}
      </CopilotSection>

      {blocked.length > 0 && (
        <CopilotSection title="รอข้อมูล/เงื่อนไข" count={blocked.length} collapsible defaultOpen={false}>
          {blocked.map((r) => (
            <RecoCard key={r.recoKey} row={r} busy={false} onDecide={handleDecide} />
          ))}
        </CopilotSection>
      )}

      <CopilotSection title="อนุมัติแล้ว" count={approved.length} collapsible defaultOpen={false}>
        {approved.map((r) => (
          <RecoCard key={r.recoKey} row={r} busy={busyKey === r.recoKey} onDecide={handleDecide} />
        ))}
      </CopilotSection>

      <CopilotSection title="ปิดแล้ว" count={dismissed.length} collapsible defaultOpen={false}>
        {dismissed.map((r) => (
          <RecoCard key={r.recoKey} row={r} busy={busyKey === r.recoKey} onDecide={handleDecide} />
        ))}
      </CopilotSection>
    </div>
  );
}
