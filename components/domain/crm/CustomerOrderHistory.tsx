import { ClipboardList } from "lucide-react";
import type { CrmCustomerOrderRow } from "@/lib/actions/crm";
import type { CrmChannelOption, CrmProvinceOption } from "@/lib/crm/order-override";
import { EmptyState } from "@/components/ui/EmptyState";
import { OrderOverrideForm } from "@/components/domain/crm/OrderOverrideForm";
import { formatThaiDateOnly, formatTHBCompact } from "@/lib/tiktok/format";

const PROFIT_STATUS_LABEL_TH: Record<string, string> = {
  missing: "ไม่มีข้อมูล",
  estimated: "ประมาณการ 20%",
  actual: "ต้นทุนจริง",
};

/**
 * `canEdit`/`channels`/`provinces` are only needed to render the
 * per-row edit affordance (OrderOverrideForm) — page.tsx only fetches
 * getCrmEditOptions() when the caller is owner/admin, so `channels`/
 * `provinces` default to [] for staff (who never see the button anyway,
 * `canEdit` gates it inside OrderOverrideForm too as defense in depth).
 */
export function CustomerOrderHistory({
  orders,
  customerId,
  canEdit = false,
  channels = [],
  provinces = [],
}: {
  orders: CrmCustomerOrderRow[];
  customerId: string;
  canEdit?: boolean;
  channels?: CrmChannelOption[];
  provinces?: CrmProvinceOption[];
}) {
  if (orders.length === 0) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="ยังไม่มีประวัติออเดอร์"
        description="ลูกค้ารายนี้ยังไม่มีออเดอร์ในระบบ (อาจเป็นแถวชื่อที่ยังไม่ผูกกับออเดอร์จริง)"
      />
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3.5 shadow-sm">
      <h3 className="text-sm font-bold text-slate-800">ประวัติออเดอร์ ({orders.length})</h3>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
              <th scope="col" className="py-2 pr-3">
                เลขออเดอร์
              </th>
              <th scope="col" className="py-2 pr-3">
                วันที่
              </th>
              <th scope="col" className="py-2 pr-3">
                ช่องทาง
              </th>
              <th scope="col" className="py-2 pr-3 text-right">
                ยอดขาย
              </th>
              <th scope="col" className="py-2 pr-3 text-right">
                กำไร
              </th>
              <th scope="col" className="py-2 pr-3">
                จังหวัด
              </th>
              {canEdit && (
                <th scope="col" className="py-2 text-right">
                  <span className="sr-only">แก้ไข</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className="border-b border-slate-100 last:border-0">
                <td className="py-2 pr-3 font-medium text-slate-800">
                  {o.sourceOrderNo}
                  {o.isEdited && (
                    <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[0.62rem] font-semibold text-amber-700">
                      แก้ไขแล้ว
                    </span>
                  )}
                </td>
                <td className="py-2 pr-3 whitespace-nowrap text-slate-600">{formatThaiDateOnly(o.orderDate)}</td>
                <td className="py-2 pr-3 text-slate-600">{o.channelName}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-slate-800">{formatTHBCompact(o.revenue)}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-slate-500">
                  {o.profit === null ? "—" : formatTHBCompact(o.profit)}
                  <span className="ml-1 text-[0.62rem] text-slate-400">
                    ({PROFIT_STATUS_LABEL_TH[o.profitStatus] ?? o.profitStatus})
                  </span>
                </td>
                <td className="py-2 pr-3 text-slate-500">{o.provinceCode}</td>
                {canEdit && (
                  <td className="py-2">
                    <OrderOverrideForm
                      order={o}
                      customerId={customerId}
                      channels={channels}
                      provinces={provinces}
                      canEdit={canEdit}
                    />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
