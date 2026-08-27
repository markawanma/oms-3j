import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getCrmCustomerAudit, getCrmCustomerDetail, getCrmCustomerNotes, getCrmEditOptions } from "@/lib/actions/crm";
import { getDevRole } from "@/lib/dev/context";
import { ErrorState } from "@/components/ui/ErrorState";
import { SegmentBadge } from "@/components/domain/crm/SegmentBadge";
import { StatCard } from "@/components/domain/crm/StatCard";
import { CustomerOrderHistory } from "@/components/domain/crm/CustomerOrderHistory";
import { CustomerNameEditor } from "@/components/domain/crm/CustomerNameEditor";
import { PiiEditForm } from "@/components/domain/crm/PiiEditForm";
import { NotesSection } from "@/components/domain/crm/NotesSection";
import { AuditTimeline } from "@/components/domain/crm/AuditTimeline";
import { formatThaiDateOnly, formatTHBCompact } from "@/lib/tiktok/format";

export const dynamic = "force-dynamic";

// analytics.dim_channel codes (supabase/migrations/0010_analytics_schema.sql
// seed) — a DIFFERENT set from lib/tiktok/format.ts's CHANNEL_LABEL_TH (OMS
// marketplace-only: shopee/tiktok/lazada). This CRM module's first-touch
// channel can be line_oa/facebook too, so it gets its own map rather than
// reusing (and silently mis-typing) the TikTok one.
const CRM_CHANNEL_LABEL_TH: Record<string, string> = {
  tiktok: "TikTok Shop",
  shopee: "Shopee",
  line_oa: "LINE OA",
  facebook: "Facebook",
};

const IDENTITY_TYPE_LABEL_TH: Record<string, string> = {
  phone: "เบอร์โทร",
  line_id: "LINE ID",
  tiktok_handle: "TikTok",
  facebook: "Facebook",
  shopee_username: "Shopee",
  email: "อีเมล",
};

// Customer 360 (design §1 B1 / §4) — read-only. PII (result.data.pii) is
// queried separately in getCrmCustomerDetail() and is `null` whenever the
// caller's dev role has no access (see lib/dev/context.ts getDevRole) — that
// case renders every PII field as "—" below, never an error, matching what
// real RLS would look like for a staff shop_member (0 rows, not a 403).
export default async function CrmCustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let result;
  try {
    result = await getCrmCustomerDetail(id);
  } catch (err) {
    return <ErrorState message={err instanceof Error ? err.message : "เกิดข้อผิดพลาดที่ไม่คาดคิด"} />;
  }

  if (!result.ok) {
    return <ErrorState message={result.error} />;
  }

  const c = result.data;
  const channelLabel = c.firstTouchChannel
    ? CRM_CHANNEL_LABEL_TH[c.firstTouchChannel] ?? c.firstTouchChannel
    : null;

  // canWrite = same owner/admin gate the write actions below re-check
  // server-side (getDevRole() !== "staff") — decided here once so every
  // section below just reads a boolean instead of importing getDevRole
  // itself. Audit is fetched conditionally: getCrmCustomerAudit() would
  // return an error for staff anyway, so skip the round-trip entirely.
  const canWrite = getDevRole() !== "staff";

  const [notesResult, auditResult, editOptionsResult] = await Promise.all([
    getCrmCustomerNotes(id),
    canWrite ? getCrmCustomerAudit(id) : Promise.resolve(null),
    // Order-edit dropdown options (channel/province) — only needed for
    // owner/admin, who alone see the edit affordance in CustomerOrderHistory.
    canWrite ? getCrmEditOptions() : Promise.resolve(null),
  ]);
  // Notes failing to load shouldn't blank out the whole customer 360 (which
  // already rendered above this point) — fall back to an empty list and let
  // NotesSection show its own empty state; same reasoning as the PII "null =
  // hidden, not an error" pattern already established on this page.
  const notes = notesResult.ok ? notesResult.data : [];
  const auditRows = auditResult && auditResult.ok ? auditResult.data : [];
  // If options fail to load, fall back to canEdit=false for the order table
  // rather than showing a broken edit form with empty dropdowns.
  const canEditOrders = canWrite && !!editOptionsResult?.ok;
  const editChannels = editOptionsResult && editOptionsResult.ok ? editOptionsResult.data.channels : [];
  const editProvinces = editOptionsResult && editOptionsResult.ok ? editOptionsResult.data.provinces : [];

  return (
    <div className="space-y-4">
      <Link href="/crm/customers" className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-600 hover:text-zinc-900">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        กลับไปรายชื่อลูกค้า
      </Link>

      <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CustomerNameEditor customerId={c.customerId} initialName={c.displayName} canEdit={canWrite} />
            <p className="mt-1 text-xs text-zinc-500">
              ลูกค้าตั้งแต่ {formatThaiDateOnly(c.firstOrderAt)} · ช่องทางแรกที่เจอ {channelLabel ?? "ไม่ทราบ"} · ผูก{" "}
              {c.identitiesCount} identity
            </p>
          </div>
          <SegmentBadge segment={c.segment} />
        </div>
        {c.recencyDays !== null && (
          <p className="mt-2 text-xs text-zinc-400">ซื้อล่าสุดเมื่อ {c.recencyDays} วันก่อน ({formatThaiDateOnly(c.lastOrderAt)})</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4" role="group" aria-label="ตัวชี้วัดลูกค้า">
        <StatCard label="จำนวนออเดอร์" value={String(c.orderCount)} />
        <StatCard label="รายได้สะสม (LTV)" value={formatTHBCompact(c.revenueSum)} hero />
        <StatCard label="AOV" value={c.aov !== null ? formatTHBCompact(c.aov) : "—"} />
        <StatCard
          label="กำไรสะสม"
          value={formatTHBCompact(c.profitSumEstimated)}
          // QA round 1: was hardcoded "ประมาณการ 20% — ยังไม่มีต้นทุนจริง",
          // which claims EVERY order behind this sum lacks real cost data —
          // false since 0095 (an order can be 'estimated' with real cost but
          // an unproven SKU match). This page doesn't fetch a per-customer
          // actual/estimated order-count split (unlike CrmOverviewData.totals
          // on /crm/overview), so it can't give the precise mixed-case note
          // that page does without a DB/view change — out of scope here.
          // Kept honest instead: no "20%" number, no "ยังไม่มีต้นทุนจริง"
          // claim, just "not yet confirmed" (true either way).
          sub="ประมาณการ — บางส่วนยังไม่ยืนยันต้นทุน"
        />
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-bold text-zinc-800">ข้อมูลส่วนบุคคล (PII)</h3>
          <PiiEditForm customerId={c.customerId} pii={c.pii} canEdit={canWrite} />
        </div>
        {c.pii ? (
          <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-zinc-400">ชื่อเต็ม</dt>
              <dd className="text-zinc-800">{c.pii.fullName ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-400">เบอร์โทร</dt>
              <dd className="text-zinc-800">{c.pii.phoneE164 ?? "—"}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs text-zinc-400">ที่อยู่</dt>
              <dd className="text-zinc-800">{c.pii.address ? JSON.stringify(c.pii.address) : "—"}</dd>
            </div>
          </dl>
        ) : (
          <p className="mt-2 text-sm text-zinc-400">— (เห็นเฉพาะเจ้าของร้าน/แอดมิน)</p>
        )}
      </div>

      {c.identities.length > 0 && (
        <div className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
          <h3 className="text-sm font-bold text-zinc-800">Identity ที่ผูกไว้</h3>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {c.identities.map((i, idx) => (
              <li
                key={`${i.identityType}-${idx}`}
                className="rounded-md bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-700"
                title={`confidence: ${i.confidence}`}
              >
                {IDENTITY_TYPE_LABEL_TH[i.identityType] ?? i.identityType}: {i.identityValueNorm}
              </li>
            ))}
          </ul>
        </div>
      )}

      <CustomerOrderHistory
        orders={c.orders}
        customerId={c.customerId}
        canEdit={canEditOrders}
        channels={editChannels}
        provinces={editProvinces}
      />

      <NotesSection customerId={c.customerId} notes={notes} canWrite={canWrite} />

      {canWrite && <AuditTimeline rows={auditRows} />}
    </div>
  );
}
