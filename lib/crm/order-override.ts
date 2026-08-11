// lib/crm/order-override.ts — const/type shared by the order-override write
// layer (lib/actions/crm.ts) and its client UI (OrderOverrideForm,
// CustomerOrderHistory). Kept OUT of lib/actions/crm.ts for the same reason
// lib/crm/segments.ts is: that file is "use server" and may only export async
// functions (invalid-use-server-value build error otherwise).

/**
 * Mirrors the RPC whitelist in supabase/migrations/0021_crm_b2a_write.sql
 * crm_set_order_override (`v_whitelist`) exactly — any other key raises
 * server-side. Every field is optional: callers (crmSetOrderOverride) send
 * only the keys the user actually changed, never the whole object.
 */
export interface OrderOverrideInput {
  channel_id?: string;
  /** analytics.dim_geo.province_code, e.g. "TH-10". */
  province_code?: string;
  revenue?: number;
  discount?: number;
  /** "YYYY-MM-DD" (date, not timestamp). */
  order_date?: string;
  bank?: string;
  tags?: string[];
}

export interface CrmChannelOption {
  id: string;
  code: string;
  name: string;
}

export interface CrmProvinceOption {
  code: string;
  nameTh: string;
}
