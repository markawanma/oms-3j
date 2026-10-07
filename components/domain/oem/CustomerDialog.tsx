"use client";

// CustomerDialog — QuoteDetailClient's "แก้ไข" ที่กล่อง "ลูกค้า" (0164). แก้ชื่อลูกค้า + ช่องทางติดต่อบนใบ
// (oem_quote.customer_name / customer_contact — ตัวที่หน้าพิมพ์ใช้เป็น fallback เมื่อไม่มีข้อมูลออกบิล) ผ่าน
// setQuoteCustomer → oem_quote_set_customer. ต่างจาก BillingDialog: อันนั้นคือข้อมูลนิติบุคคลสำหรับเอกสารภาษี
// (analytics.oem_customer) อันนี้คือป้ายชื่อบนใบเสนอราคาเฉยๆ — ช่องว่าง = ล้างค่า
//
// "ดึงจากข้อมูลออกบิล": โชว์เมื่อกล่องยังว่างทั้งคู่ แต่ใบมีข้อมูลออกบิลแล้ว — เติมชื่อนิติบุคคล + เบอร์/ช่องทางลงฟอร์ม
// เท่านั้น ผู้ใช้ต้องกดบันทึกเอง (ไม่เขียนเงียบๆ) · ปุ่มนี้ไม่เรียก server

import { useState, useTransition } from "react";
import { setQuoteCustomer } from "@/lib/actions/oem";
import type { OemQuoteRow } from "@/lib/oem/types";
import { OEM_CUSTOMER_TEXT_MAX, contactFromBilling, customerTextIssue } from "@/lib/oem/display";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

const inputCls = "mt-1 min-h-11 w-full rounded-md border border-zinc-300 px-2.5 text-base";

export function CustomerDialog({ quote, onClose, onSaved }: { quote: OemQuoteRow; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(quote.customerName ?? "");
  const [contact, setContact] = useState(quote.customerContact ?? "");
  const [pending, startTransition] = useTransition();

  const nameErr = customerTextIssue(name, "ชื่อลูกค้า");
  const contactErr = customerTextIssue(contact, "ช่องทางติดต่อ");
  const boxEmpty = !quote.customerName?.trim() && !quote.customerContact?.trim();
  const billingContact = contactFromBilling(quote.billPhone, quote.billContactChannel);
  const canPullFromBilling = boxEmpty && !!quote.billLegalName?.trim();
  const unchanged = name.trim() === (quote.customerName ?? "").trim() && contact.trim() === (quote.customerContact ?? "").trim();

  function pullFromBilling() {
    setName(quote.billLegalName?.trim() ?? "");
    setContact(billingContact);
  }

  function save() {
    if (nameErr || contactErr) return;
    startTransition(async () => {
      const result = await setQuoteCustomer({ quoteId: quote.id, customerName: name, customerContact: contact });
      if (!result.ok) {
        toast.push(result.error, "error");
        return;
      }
      toast.push("บันทึกข้อมูลลูกค้าแล้ว");
      onSaved();
    });
  }

  return (
    <Modal open onClose={onClose} title={"ข้อมูลลูกค้า — " + quote.quoteNo}>
      {canPullFromBilling && (
        <div className="rounded-md border border-sky-200 bg-sky-50 p-2.5 text-xs text-sky-900">
          <p>ใบนี้ยังไม่มีชื่อลูกค้า แต่มีข้อมูลออกบิลแล้ว ({quote.billLegalName})</p>
          <Button type="button" variant="secondary" size="sm" className="mt-1.5" onClick={pullFromBilling}>
            ดึงจากข้อมูลออกบิล
          </Button>
          <p className="mt-1 text-sky-700">เติมลงฟอร์มให้ — ตรวจแล้วกดบันทึกเอง</p>
        </div>
      )}

      <label htmlFor="oem-cust-name" className="mt-3 block text-sm font-medium text-zinc-700">
        ชื่อลูกค้า <span className="font-normal text-zinc-400">(เว้นว่าง = ล้างค่า)</span>
      </label>
      <input
        id="oem-cust-name"
        type="text"
        value={name}
        maxLength={OEM_CUSTOMER_TEXT_MAX}
        onChange={(e) => setName(e.target.value)}
        className={inputCls}
        placeholder="เช่น ร้าน ABC"
      />
      {nameErr && (
        <p role="alert" className="mt-1 text-xs font-semibold text-red-600">
          {nameErr}
        </p>
      )}

      <label htmlFor="oem-cust-contact" className="mt-3 block text-sm font-medium text-zinc-700">
        ช่องทางติดต่อ <span className="font-normal text-zinc-400">(เว้นว่าง = ล้างค่า)</span>
      </label>
      <input
        id="oem-cust-contact"
        type="text"
        value={contact}
        maxLength={OEM_CUSTOMER_TEXT_MAX}
        onChange={(e) => setContact(e.target.value)}
        className={inputCls}
        placeholder="เบอร์โทร / LINE"
      />
      {contactErr && (
        <p role="alert" className="mt-1 text-xs font-semibold text-red-600">
          {contactErr}
        </p>
      )}

      <p className="mt-3 text-xs text-zinc-500">
        ชื่อนี้ใช้พิมพ์บนใบเสนอราคาเมื่อยังไม่มีข้อมูลออกบิล — ไม่ใช่ข้อมูลนิติบุคคลสำหรับเอกสารภาษี (อันนั้นแก้ที่ &quot;ข้อมูลลูกค้าสำหรับออกเอกสาร&quot;)
      </p>

      <div className="mt-4 flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onClose}>
          ยกเลิก
        </Button>
        <Button variant="primary" className="flex-1" loading={pending} disabled={!!nameErr || !!contactErr || unchanged} onClick={save}>
          บันทึก
        </Button>
      </div>
    </Modal>
  );
}
