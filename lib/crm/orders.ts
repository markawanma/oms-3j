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
