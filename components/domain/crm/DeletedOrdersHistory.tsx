// DeletedOrdersHistory — /crm/import (design §6), plain Server Component (no
// "use client"): fetches its own data via getDeletedOrders() directly
// (same "server action called straight from a Server Component" pattern
// page.tsx already uses for getImportBatches), and NEVER throws — every
// failure path returns inline error/empty JSX instead of propagating, which
// is what makes "render DeletedOrdersHistory fail-soft" (task brief step 5)
// possible without any Suspense/error-boundary plumbing: page.tsx can just
// render <DeletedOrdersHistory /> unconditionally.
//
// The one interactive bit (the "กู้คืน" button + its confirm modal) lives in
// RestoreOrderButton.tsx ("use client") — see that file's header for why
// this had to be a separate file rather than inline here.

import { Info, Inbox } from "lucide-react";
import { getDeletedOrders, getMissingOrdersWriteStatus } from "@/lib/actions/import-missing-orders";
import { RestoreOrderButton } from "@/components/domain/crm/RestoreOrderButton";
import { Badge } from "@/components/ui/Badge";
import { ErrorBanner } from "@/components/ui/ErrorState";
import { formatBangkokTime } from "@/lib/format";
import { formatTHB } from "@/lib/format";
import { formatCount, formatThaiDateOnly } from "@/lib/tiktok/format";

export async function DeletedOrdersHistory() {
  let rows;
  // M-2 (security review 14 ก.ย. 69, post-0117): fail-CLOSED default if the
  // status fetch itself fails/errors — a DB read failure must never be
  // displayed as "enabled" (a broken status check looking identical to a
  // normal open gate is worse than an honest "we don't know, so disabled").
  // The real gate is still enforced server-side inside restoreDeletedOrders
  // regardless either way (RestoreOrderButton's isMissingOrdersWriteDisabledError
  // fallback still catches a real attempt) — this default only decides
  // whether the button starts disabled proactively or discovers it
  // reactively; trade-off accepted: a DB hiccup shows a greyed-out button
  // until refresh, not a live one.
  let writeEnabled = false;
  try {
    const [ordersRes, statusRes] = await Promise.all([getDeletedOrders(), getMissingOrdersWriteStatus()]);
    if (!ordersRes.ok) {
      return <ErrorBanner message={ordersRes.error} />;
    }
    rows = ordersRes.data;
    if (statusRes.ok) writeEnabled = statusRes.data.enabled;
    else console.error("DeletedOrdersHistory: getMissingOrdersWriteStatus failed", statusRes.error);
  } catch (err) {
    console.error("DeletedOrdersHistory: getDeletedOrders/getMissingOrdersWriteStatus threw", err);
    return <ErrorBanner message="โหลดประวัติออเดอร์ที่ลบไม่สำเร็จ ลองรีเฟรชหน้าอีกครั้ง" />;
  }

  if (rows.length === 0) {
    return (
      <p className="flex items-center gap-1.5 rounded-lg border border-dashed border-zinc-300 bg-white px-4 py-6 text-sm text-zinc-500">
        <Inbox className="h-4 w-4 shrink-0" aria-hidden="true" />
        ยังไม่มีออเดอร์ที่ถูกลบ
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
      {!writeEnabled && (
        <p className="flex items-center gap-1.5 border-b border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800">
          <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          ยังไม่เปิดใช้การลบ/กู้คืนบนระบบนี้
        </p>
      )}
      <table className="w-full min-w-[860px] text-left text-xs">
        <thead>
          <tr className="border-b border-zinc-200 bg-zinc-50 text-zinc-500">
            <th className="px-3 py-2">เลขออเดอร์</th>
            <th className="px-3 py-2">วันที่</th>
            <th className="px-3 py-2">ช่องทาง</th>
            <th className="px-3 py-2 text-right">ยอด</th>
            <th className="px-3 py-2">ลบเมื่อ</th>
            <th className="px-3 py-2">จากไฟล์</th>
            <th className="px-3 py-2">เหตุผล</th>
            <th className="px-3 py-2">สถานะ</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-zinc-100 last:border-0 align-top">
              <td className="px-3 py-2 font-medium text-zinc-700">{r.sourceOrderNo}</td>
              <td className="px-3 py-2 whitespace-nowrap text-zinc-600">{formatThaiDateOnly(r.orderDate)}</td>
              <td className="px-3 py-2 text-zinc-600">{r.channelName ?? "-"}</td>
              <td className="px-3 py-2 text-right tabular-nums text-zinc-700">{formatTHB(r.revenueThb)}</td>
              <td className="px-3 py-2 whitespace-nowrap text-zinc-500">{formatBangkokTime(r.deletedAt)}</td>
              <td className="px-3 py-2 text-zinc-600">
                <p className="max-w-[160px] truncate" title={r.detectedByFileName ?? undefined}>
                  {r.detectedByFileName ?? "-"}
                </p>
              </td>
              <td className="px-3 py-2 text-zinc-600">
                <p className="max-w-[180px] truncate" title={r.reason}>
                  {r.reason}
                </p>
              </td>
              <td className="px-3 py-2">
                {r.restoredAt ? <Badge tone="green">กู้คืนแล้ว</Badge> : <Badge tone="red">ลบแล้ว</Badge>}
              </td>
              <td className="px-3 py-2">{!r.restoredAt && <RestoreOrderButton row={r} writeEnabled={writeEnabled} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length >= 50 && (
        <p className="border-t border-zinc-100 px-3 py-2 text-[0.68rem] text-zinc-400">
          แสดง {formatCount(rows.length)} รายการล่าสุด
        </p>
      )}
    </div>
  );
}
