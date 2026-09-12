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

import { Inbox } from "lucide-react";
import { getDeletedOrders } from "@/lib/actions/import-missing-orders";
import { RestoreOrderButton } from "@/components/domain/crm/RestoreOrderButton";
import { Badge } from "@/components/ui/Badge";
import { ErrorBanner } from "@/components/ui/ErrorState";
import { formatBangkokTime } from "@/lib/format";
import { formatTHB } from "@/lib/format";
import { formatCount, formatThaiDateOnly } from "@/lib/tiktok/format";

export async function DeletedOrdersHistory() {
  let rows;
  try {
    const res = await getDeletedOrders();
    if (!res.ok) {
      return <ErrorBanner message={res.error} />;
    }
    rows = res.data;
  } catch (err) {
    console.error("DeletedOrdersHistory: getDeletedOrders threw", err);
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
              <td className="px-3 py-2">{!r.restoredAt && <RestoreOrderButton row={r} />}</td>
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
