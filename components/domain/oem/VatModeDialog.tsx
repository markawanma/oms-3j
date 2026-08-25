"use client";

// VatModeDialog — QuoteDetailClient's "เปลี่ยนรูปแบบภาษี" action (0082).
// Calls oem_quote_set_vat_mode: switches how the printed document presents
// VAT ('included' — one line, "ราคารวม VAT แล้ว" / 'breakdown' — splits into
// pre-VAT price / VAT / net). grandTotal (what the customer owes) is
// IDENTICAL either way — this is a display-only switch, never money math —
// the copy below says so explicitly so the owner never worries a click here
// moves the price.
//
// 'breakdown' is disabled client-side when the shop hasn't ticked "จด
// ทะเบียน VAT" yet (sellerProfile.vatRegistered) — oem_quote_set_vat_mode
// rejects it server-side too (22023), this is just belt-and-braces so the
// owner sees WHY before clicking, not after a failed round trip.

import { useState, useTransition } from "react";
import Link from "next/link";
import { setQuoteVatMode } from "@/lib/actions/oem";
import type { OemQuoteRow } from "@/lib/oem/types";
import type { SellerProfile } from "@/lib/oem/sellerProfile";
import { fmtPct } from "@/lib/oem/display";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

export function VatModeDialog({
  quote,
  sellerProfile,
  onClose,
  onSaved,
}: {
  quote: OemQuoteRow;
  sellerProfile: SellerProfile;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [mode, setMode] = useState<"included" | "breakdown">(quote.vatMode);
  const [pending, startTransition] = useTransition();
  const breakdownDisabled = !sellerProfile.vatRegistered;

  function submit() {
    startTransition(async () => {
      const result = await setQuoteVatMode({ quoteId: quote.id, mode });
      if (!result.ok) {
        toast.push(result.error, "error");
        return;
      }
      toast.push("เปลี่ยนรูปแบบภาษีแล้ว");
      onSaved();
    });
  }

  return (
    <Modal open onClose={onClose} title={`รูปแบบภาษีมูลค่าเพิ่ม — ${quote.quoteNo}`}>
      <p className="rounded-md bg-zinc-50 px-2.5 py-2 text-sm text-zinc-700">
        ยอดที่ลูกค้าจ่าย <span className="font-semibold">เท่ากันทั้ง 2 แบบ</span> — ต่างกันแค่วิธีเขียนในเอกสาร ไม่กระทบราคาที่เรียกเก็บ
      </p>

      <div className="mt-3 space-y-2" role="radiogroup" aria-label="รูปแบบภาษีมูลค่าเพิ่ม">
        <label className="flex min-h-11 cursor-pointer items-start gap-2 rounded-md border border-zinc-300 p-3 has-[:checked]:border-primary-600 has-[:checked]:bg-primary-50">
          <input
            type="radio"
            name="oem-vat-mode"
            className="mt-0.5"
            checked={mode === "included"}
            onChange={() => setMode("included")}
          />
          <span>
            <span className="block text-sm font-medium text-zinc-800">รวม VAT ในราคาเดียว</span>
            <span className="block text-xs text-zinc-500">เอกสารเขียนบรรทัดเดียวว่า &quot;ราคารวมภาษีมูลค่าเพิ่มแล้ว&quot;</span>
          </span>
        </label>

        <label
          className={`flex min-h-11 items-start gap-2 rounded-md border border-zinc-300 p-3 ${
            breakdownDisabled
              ? "cursor-not-allowed opacity-50"
              : "cursor-pointer has-[:checked]:border-primary-600 has-[:checked]:bg-primary-50"
          }`}
        >
          <input
            type="radio"
            name="oem-vat-mode"
            className="mt-0.5"
            checked={mode === "breakdown"}
            disabled={breakdownDisabled}
            onChange={() => setMode("breakdown")}
          />
          <span>
            <span className="block text-sm font-medium text-zinc-800">แยกแสดงภาษี</span>
            <span className="block text-xs text-zinc-500">เอกสารแตกเป็น: ราคาก่อนภาษีมูลค่าเพิ่ม / ภาษีมูลค่าเพิ่ม {fmtPct(quote.vatRate)} / ยอดสุทธิ</span>
          </span>
        </label>
      </div>

      {breakdownDisabled && (
        <p className="mt-2 text-xs text-amber-700">
          ร้านยังไม่ได้ติ๊กสถานะ &quot;จดทะเบียน VAT&quot; — เลือกโหมดแยกแสดงไม่ได้จนกว่าจะไปติ๊กที่{" "}
          <Link href="/oem/rates" className="font-medium underline underline-offset-2">
            ตั้งค่า &gt; ข้อมูลร้านเรา
          </Link>{" "}
          ก่อน
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>
          ยกเลิก
        </Button>
        <Button type="button" variant="primary" className="flex-1" loading={pending} onClick={submit}>
          บันทึก
        </Button>
      </div>
    </Modal>
  );
}
