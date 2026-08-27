// lib/crm/orders.ts — const/type shared by the /crm/orders read layer
// (lib/actions/crm.ts getCrmOrders) and its client UI (OrdersPageClient).
// Kept OUT of lib/actions/crm.ts for the same "use server" reason as
// lib/crm/segments.ts / lib/crm/order-override.ts: a "use server" module may
// only export async functions, exporting a runtime const array from it is a
// Next.js build error (invalid-use-server-value).

export type CrmOrderSortKey = "date_desc" | "date_asc" | "revenue_desc" | "revenue_asc";

export const CRM_ORDER_SORT_OPTIONS: { value: CrmOrderSortKey; label: string }[] = [
  { value: "date_desc", label: "วันที่ล่าสุดก่อน" },
  { value: "date_asc", label: "วันที่เก่าสุดก่อน" },
  { value: "revenue_desc", label: "ยอดมากไปน้อย" },
  { value: "revenue_asc", label: "ยอดน้อยไปมาก" },
];

export function isValidCrmOrderSortKey(v: string): v is CrmOrderSortKey {
  return CRM_ORDER_SORT_OPTIONS.some((o) => o.value === v);
}

// profit_status label — shared by OrdersPageClient AND CustomerOrderHistory
// (was declared twice, identically, until QA round 1 caught it drifting).
//
// "estimated" covers TWO different DB-side reasons as of migration 0095
// (analytics.transform_pending_order_lines), and the label must be honest
// for both:
//   1. No line-item at all yet — profit is a flat 20%-of-revenue guess
//      (the original meaning, pre-0095).
//   2. Line-items DO exist with real cost, but at least one of: an unknown
//      SKU (counted as cost 0), or a tier-2' match to an inactive product
//      that tier 3 could NOT conclusively prove has no active twin
//      (v_weak_order) — see 0095 fix 1/2 header comment.
// Case 2 is NOT a 20% guess — it has a real (if unproven) cost behind it.
// A label saying "20%" on a case-2 order overstates how uncertain the
// number is and contradicts 0095's whole point ("กำไรต้องไม่โกหก"), so the
// "20%" qualifier was dropped — "ประมาณการ" alone is accurate for both.
export const PROFIT_STATUS_LABEL_TH: Record<string, string> = {
  missing: "ไม่มีข้อมูล",
  estimated: "ประมาณการ",
  actual: "ต้นทุนจริง",
};
