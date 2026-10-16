// InvoicePrintBlocked — หน้าพิมพ์ของใบแจ้งหนี้ที่ "ล้าสมัย" (ยอดใบเสนอราคา/เงินที่รับเปลี่ยนหลังออกใบ)
//
// ไม่ render เอกสารเลย (ไม่มี .oem-print-doc) และหน้า server ไม่เรียก toPrintableInvoice สำหรับเคสนี้ — ใบที่ยอดไม่ตรงกับดีลแล้ว
// ห้ามถึงมือลูกค้าแม้ผ่าน Ctrl+P: จอ = การ์ดแดงบอกทางออก · กระดาษ = ข้อความ "พิมพ์ไม่ได้" เท่านั้น
// รับเฉพาะ primitive ที่ page ฟอร์แมตแล้ว (ไม่ใช่ row) — ยอด/วันที่ในการ์ดเป็นของพนักงาน (print:hidden)

import Link from "next/link";
import { AlertTriangle } from "lucide-react";

export function InvoicePrintBlocked({
  invoiceNo,
  amountText,
  issueDateText,
  quoteHref,
}: {
  invoiceNo: string;
  /** ยอดบนใบ (ฟอร์แมตแล้ว เช่น "฿5,000.00") */
  amountText: string;
  issueDateText: string;
  quoteHref: string;
}) {
  return (
    <div className="mx-auto max-w-2xl py-6">
      <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-5 print:hidden">
        <div className="flex items-start gap-2.5">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-red-800">
              พิมพ์ใบนี้ไม่ได้ — ยอดใบเสนอราคา/เงินที่รับเปลี่ยนไปหลังออกใบ {invoiceNo} (ยอดบนใบ {amountText} ออก {issueDateText})
            </p>
            <p className="mt-1 text-sm text-red-700">ยกเลิกใบนี้แล้วออกใบใหม่จากหน้าใบเสนอราคา เพื่อให้ยอดที่แจ้งลูกค้าตรงกับดีลปัจจุบัน</p>
            <Link href={quoteHref} className="mt-3 inline-flex min-h-11 items-center text-sm font-medium text-primary-700 underline underline-offset-2">
              ไปที่ใบเสนอราคา
            </Link>
          </div>
        </div>
      </div>
      {/* Ctrl+P: ต้องไม่ได้หน้าว่างหรือเอกสารครึ่งๆ — เห็นเฉพาะข้อความนี้ */}
      <div className="hidden p-16 text-center print:block">
        <p className="text-lg font-semibold text-red-700">เอกสารนี้ยังพิมพ์ไม่ได้</p>
      </div>
    </div>
  );
}
