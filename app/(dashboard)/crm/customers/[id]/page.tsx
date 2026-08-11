import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getCrmCustomerDetail } from "@/lib/actions/crm";
import { ErrorState } from "@/components/ui/ErrorState";
import { SegmentBadge } from "@/components/domain/crm/SegmentBadge";
import { StatCard } from "@/components/domain/crm/StatCard";
import { CustomerOrderHistory } from "@/components/domain/crm/CustomerOrderHistory";
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

  return (
    <div className="space-y-4">
      <Link href="/crm/customers" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        กลับไปรายชื่อลูกค้า
      </Link>

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h1 className="text-lg font-bold text-slate-900">{c.displayName ?? "(ไม่มีชื่อ)"}</h1>
            <p className="mt-1 text-xs text-slate-500">
              ลูกค้าตั้งแต่ {formatThaiDateOnly(c.firstOrderAt)} · ช่องทางแรกที่เจอ {channelLabel ?? "ไม่ทราบ"} · ผูก{" "}
              {c.identitiesCount} identity
            </p>
          </div>
          <SegmentBadge segment={c.segment} />
        </div>
        {c.recencyDays !== null && (
          <p className="mt-2 text-xs text-slate-400">ซื้อล่าสุดเมื่อ {c.recencyDays} วันก่อน ({formatThaiDateOnly(c.lastOrderAt)})</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4" role="group" aria-label="ตัวชี้วัดลูกค้า">
        <StatCard label="จำนวนออเดอร์" value={String(c.orderCount)} />
        <StatCard label="รายได้สะสม (LTV)" value={formatTHBCompact(c.revenueSum)} hero />
        <StatCard label="AOV" value={c.aov !== null ? formatTHBCompact(c.aov) : "—"} />
        <StatCard
          label="กำไรสะสม"
          value={formatTHBCompact(c.profitSumEstimated)}
          sub="ประมาณการ 20% — ยังไม่มีต้นทุนจริง"
        />
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-3.5 shadow-sm">
        <h3 className="text-sm font-bold text-slate-800">ข้อมูลส่วนบุคคล (PII)</h3>
        {c.pii ? (
          <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-slate-400">ชื่อเต็ม</dt>
              <dd className="text-slate-800">{c.pii.fullName ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">เบอร์โทร</dt>
              <dd className="text-slate-800">{c.pii.phoneE164 ?? "—"}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs text-slate-400">ที่อยู่</dt>
              <dd className="text-slate-800">{c.pii.address ? JSON.stringify(c.pii.address) : "—"}</dd>
            </div>
          </dl>
        ) : (
          <p className="mt-2 text-sm text-slate-400">— (เห็นเฉพาะเจ้าของร้าน/แอดมิน)</p>
        )}
      </div>

      {c.identities.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-3.5 shadow-sm">
          <h3 className="text-sm font-bold text-slate-800">Identity ที่ผูกไว้</h3>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {c.identities.map((i, idx) => (
              <li
                key={`${i.identityType}-${idx}`}
                className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700"
                title={`confidence: ${i.confidence}`}
              >
                {IDENTITY_TYPE_LABEL_TH[i.identityType] ?? i.identityType}: {i.identityValueNorm}
              </li>
            ))}
          </ul>
        </div>
      )}

      <CustomerOrderHistory orders={c.orders} />
    </div>
  );
}
