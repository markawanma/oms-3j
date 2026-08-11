import { ClipboardList } from "lucide-react";
import type { CrmCustomerOrderRow } from "@/lib/actions/crm";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatThaiDateOnly, formatTHBCompact } from "@/lib/tiktok/format";

const PROFIT_STATUS_LABEL_TH: Record<string, string> = {
  missing: "ไม่มีข้อมูล",
  estimated: "ประมาณการ 20%",
  actual: "ต้นทุนจริง",
};

export function CustomerOrderHistory({ orders }: { orders: CrmCustomerOrderRow[] }) {
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
              <th scope="col" className="py-2">
                จังหวัด
              </th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className="border-b border-slate-100 last:border-0">
                <td className="py-2 pr-3 font-medium text-slate-800">{o.sourceOrderNo}</td>
                <td className="py-2 pr-3 whitespace-nowrap text-slate-600">{formatThaiDateOnly(o.orderDate)}</td>
                <td className="py-2 pr-3 text-slate-600">{o.channelName}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-slate-800">{formatTHBCompact(o.revenue)}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-slate-500">
                  {o.profit === null ? "—" : formatTHBCompact(o.profit)}
                  <span className="ml-1 text-[0.62rem] text-slate-400">
                    ({PROFIT_STATUS_LABEL_TH[o.profitStatus] ?? o.profitStatus})
                  </span>
                </td>
                <td className="py-2 text-slate-500">{o.provinceCode}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
