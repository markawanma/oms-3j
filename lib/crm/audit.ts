// lib/crm/audit.ts — plain data shared by the audit timeline UI. Kept OUT of
// lib/actions/crm.ts for the same reason as lib/crm/segments.ts: a
// "use server" module may only export async functions, not runtime consts.

/** Thai labels for analytics.crm_audit_log.action (migration 0021 check
 * constraint). order_override_* are included for completeness even though
 * B2a's getCrmCustomerAudit() never returns them today (see its doc comment)
 * — cheap to have ready for the order-override chunk. */
export const AUDIT_ACTION_LABEL_TH: Record<string, string> = {
  customer_edit: "แก้ชื่อลูกค้า",
  pii_edit: "แก้ข้อมูลส่วนบุคคล (PII)",
  note_add: "เพิ่มโน้ต",
  note_edit: "แก้ไขโน้ต",
  note_delete: "ลบโน้ต",
  order_override_set: "แก้ไขข้อมูลออเดอร์",
  order_override_clear: "ล้างการแก้ไขออเดอร์",
};

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABEL_TH[action] ?? action;
}
