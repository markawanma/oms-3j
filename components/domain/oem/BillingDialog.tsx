"use client";

// BillingDialog — QuoteDetailClient's "กรอก/แก้ไขข้อมูลออกบิล" action.
// Calls the EXISTING setQuoteBilling (0075's oem_quote_set_billing RPC) —
// no new server action written for this, per design brief. The RPC itself
// hard-gates status IN ('quoted','won') server-side (0075 §7); this dialog
// is only ever opened from QuoteDetailClient when that's already true, but
// the server error (22023, Thai message) still surfaces via toast if that
// ever drifts (e.g. status changes in another tab while this one is open).

import { useState, useTransition } from "react";
import { setQuoteBilling } from "@/lib/actions/oem";
import type { OemQuoteRow } from "@/lib/oem/types";
import { isValidThaiTaxId } from "@/lib/oem/display";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

function FieldLabel({ htmlFor, children, optional }: { htmlFor: string; children: React.ReactNode; optional?: boolean }) {
  return (
    <label htmlFor={htmlFor} className="mt-3 block text-sm font-medium text-zinc-700">
      {children}
      {optional && <span className="ml-1 font-normal text-zinc-400">(ไม่บังคับ)</span>}
    </label>
  );
}

const inputCls = "mt-1 min-h-11 w-full rounded-md border border-zinc-300 px-2.5 text-base";

export function BillingDialog({ quote, onClose, onSaved }: { quote: OemQuoteRow; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [legalName, setLegalName] = useState(quote.billLegalName ?? quote.customerName ?? "");
  const [taxId, setTaxId] = useState(quote.billTaxId ?? "");
  const [phone, setPhone] = useState(quote.billPhone ?? "");
  const [contactChannel, setContactChannel] = useState(quote.billContactChannel ?? "");
  const [line1, setLine1] = useState(quote.billAddress?.line1 ?? "");
  const [line2, setLine2] = useState(quote.billAddress?.line2 ?? "");
  const [subdistrict, setSubdistrict] = useState(quote.billAddress?.subdistrict ?? "");
  const [district, setDistrict] = useState(quote.billAddress?.district ?? "");
  const [province, setProvince] = useState(quote.billAddress?.province ?? "");
  const [postalCode, setPostalCode] = useState(quote.billAddress?.postalCode ?? "");
  const [pending, startTransition] = useTransition();

  const legalNameValid = legalName.trim().length > 0;
  // Client-side check only decides whether the button is enabled — the
  // real gate (server) is the same rule, checked again in setQuoteBilling.
  const taxIdValid = isValidThaiTaxId(taxId);
  const canSubmit = legalNameValid && taxIdValid;

  function confirm() {
    if (!canSubmit) return;
    const hasAddress = [line1, line2, subdistrict, district, province, postalCode].some((v) => v.trim());
    startTransition(async () => {
      const result = await setQuoteBilling({
        quoteId: quote.id,
        legalName: legalName.trim(),
        taxId: taxId.trim() || null,
        phone: phone.trim() || null,
        contactChannel: contactChannel.trim() || null,
        address: hasAddress
          ? {
              line1: line1.trim() || null,
              line2: line2.trim() || null,
              subdistrict: subdistrict.trim() || null,
              district: district.trim() || null,
              province: province.trim() || null,
              postalCode: postalCode.trim() || null,
            }
          : null,
      });
      if (!result.ok) {
        toast.push(result.error, "error");
        return;
      }
      toast.push("บันทึกข้อมูลออกบิลแล้ว");
      onSaved();
    });
  }

  return (
    <Modal open onClose={onClose} title={`ข้อมูลออกบิล — ${quote.quoteNo}`}>
      <p className="text-xs text-zinc-500">ใช้พิมพ์บนหัวใบเสนอราคา/ใบกำกับภาษีที่ส่งให้ลูกค้า — กรอกให้ตรงกับเอกสารจดทะเบียนของลูกค้า</p>

      <FieldLabel htmlFor="oem-bill-legal-name">ชื่อเต็ม / ชื่อนิติบุคคลที่ใช้ออกบิล</FieldLabel>
      <input
        id="oem-bill-legal-name"
        type="text"
        value={legalName}
        onChange={(e) => setLegalName(e.target.value)}
        className={inputCls}
        placeholder="เช่น บริษัท ... จำกัด หรือ ชื่อ-นามสกุล"
      />

      <FieldLabel htmlFor="oem-bill-tax-id" optional>
        เลขประจำตัวผู้เสียภาษี (13 หลัก)
      </FieldLabel>
      <input
        id="oem-bill-tax-id"
        type="text"
        inputMode="numeric"
        maxLength={13}
        value={taxId}
        onChange={(e) => setTaxId(e.target.value.replace(/[^0-9]/g, ""))}
        className={`${inputCls} tabular-nums`}
        placeholder="เว้นว่างได้ถ้าเป็นลูกค้าบุคคลธรรมดา"
        aria-invalid={!taxIdValid}
        aria-describedby={!taxIdValid ? "oem-bill-tax-id-error" : undefined}
      />
      {!taxIdValid && (
        <p id="oem-bill-tax-id-error" className="mt-1 text-xs text-red-600">
          ต้องเป็นตัวเลข 13 หลักพอดี (กรอกแล้ว {taxId.length} หลัก) หรือลบทิ้งให้ว่างถ้าไม่มี
        </p>
      )}

      <FieldLabel htmlFor="oem-bill-phone" optional>
        เบอร์โทร
      </FieldLabel>
      <input id="oem-bill-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} />

      <FieldLabel htmlFor="oem-bill-contact-channel" optional>
        ช่องทางติดต่ออื่น (เช่น LINE ID)
      </FieldLabel>
      <input
        id="oem-bill-contact-channel"
        type="text"
        value={contactChannel}
        onChange={(e) => setContactChannel(e.target.value)}
        className={inputCls}
      />

      <p className="mt-4 text-sm font-medium text-zinc-700">ที่อยู่ (ไม่บังคับ)</p>
      <FieldLabel htmlFor="oem-bill-line1" optional>
        บรรทัด 1 (บ้านเลขที่ / หมู่ / ซอย / ถนน)
      </FieldLabel>
      <input id="oem-bill-line1" type="text" value={line1} onChange={(e) => setLine1(e.target.value)} className={inputCls} />

      <FieldLabel htmlFor="oem-bill-line2" optional>
        บรรทัด 2 (อาคาร / ชั้น — ถ้ามี)
      </FieldLabel>
      <input id="oem-bill-line2" type="text" value={line2} onChange={(e) => setLine2(e.target.value)} className={inputCls} />

      <div className="mt-3 grid grid-cols-2 gap-x-3">
        <div>
          <FieldLabel htmlFor="oem-bill-subdistrict" optional>
            ตำบล/แขวง
          </FieldLabel>
          <input
            id="oem-bill-subdistrict"
            type="text"
            value={subdistrict}
            onChange={(e) => setSubdistrict(e.target.value)}
            className={inputCls}
          />
        </div>
        <div>
          <FieldLabel htmlFor="oem-bill-district" optional>
            อำเภอ/เขต
          </FieldLabel>
          <input id="oem-bill-district" type="text" value={district} onChange={(e) => setDistrict(e.target.value)} className={inputCls} />
        </div>
        <div>
          <FieldLabel htmlFor="oem-bill-province" optional>
            จังหวัด
          </FieldLabel>
          <input id="oem-bill-province" type="text" value={province} onChange={(e) => setProvince(e.target.value)} className={inputCls} />
        </div>
        <div>
          <FieldLabel htmlFor="oem-bill-postal-code" optional>
            รหัสไปรษณีย์
          </FieldLabel>
          <input
            id="oem-bill-postal-code"
            type="text"
            inputMode="numeric"
            maxLength={5}
            value={postalCode}
            onChange={(e) => setPostalCode(e.target.value.replace(/[^0-9]/g, ""))}
            className={`${inputCls} tabular-nums`}
          />
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>
          ยกเลิก
        </Button>
        <Button type="button" variant="primary" className="flex-1" loading={pending} disabled={!canSubmit} onClick={confirm}>
          บันทึก
        </Button>
      </div>
    </Modal>
  );
}
