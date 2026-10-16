// สี/ไอคอนของสถานะใบแจ้งหนี้ — ใช้ร่วม InvoiceSection (ในใบเสนอราคา) กับ InvoicesPageClient (/oem/invoices) ให้หน้าตาตรงกัน
// (สถานะตัดสินที่ lib/oem/invoiceDisplay.ts · ที่นี่มีแค่การแสดงผล)
import { AlertTriangle, Ban, CheckCircle2, Clock } from "lucide-react";
import type { BadgeTone } from "@/components/ui/Badge";
import type { InvoiceDisplayStatus } from "@/lib/oem/invoiceDisplay";

export const INVOICE_STATUS_TONE: Record<InvoiceDisplayStatus, BadgeTone> = {
  void: "slate",
  paid: "green",
  stale: "orange",
  overdue: "red",
  pending: "blue",
};

export const INVOICE_STATUS_ICON: Record<InvoiceDisplayStatus, typeof Ban> = {
  void: Ban,
  paid: CheckCircle2,
  stale: AlertTriangle,
  overdue: Clock,
  pending: Clock,
};
