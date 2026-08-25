"use client";

// BillingDialog — QuoteDetailClient's "กรอกข้อมูลลูกค้าสำหรับออกเอกสาร" action.
// Calls the EXISTING setQuoteBilling (0075's oem_quote_set_billing RPC) —
// no new server action written for this, per design brief. The RPC itself
// hard-gates status IN ('quoted','won') server-side (0075 §7); this dialog
// is only ever opened from QuoteDetailClient when that's already true, but
// the server error (22023, Thai message) still surfaces via toast if that
// ever drifts (e.g. status changes in another tab while this one is open).
//
// Mandatory vs optional (Tech Lead decision, 2026-08 UAT fix, revised
// 2026-08 again — owner overruled "phone mandatory"):
//   MANDATORY — legalName, address (line1/subdistrict/district/province/
//   postalCode), AND phone-OR-contactChannel (at least one of the two, not
//   both). A quote without a customer address can't be turned into a PO by
//   the customer's own procurement, so this app should not let it print
//   half-empty. Some OEM customers only ever talk over LINE and have no
//   phone number to give — hard-requiring phone specifically blocked real
//   customers, so the gate is "some way to reach them", not "phone
//   specifically". See lib/oem/display.ts's hasAnyContact — same helper
//   used by the shop's own seller-profile contact rule (phone-or-line)
//   so the two pairs can't independently drift.
//   OPTIONAL — taxId (a private individual has none — but leaving it blank
//   means no tax invoice can be issued to this customer later, warned
//   inline), address line 2.
// Per-field validation fires on blur (not one lump error on submit) and the
// save button stays disabled until every mandatory field is valid. The
// SAME rule is enforced again in setQuoteBilling (lib/actions/oem.ts) —
// this dialog is UX only, never the only gate (see that function's comment).
//
// NOTE ON NAMING: this is CUSTOMER billing info (analytics.oem_customer) —
// distinct from "ข้อมูลร้านเรา (หัวกระดาษ)" (SellerProfile, edited at
// /oem/rates), which is our own shop's info printed as the document header.
// The two used to share the word "ออกบิล" and that caused a real UAT
// blocker (owner filled this dialog, print still refused — because the
// print gate checks the OTHER one). Do not reintroduce the collision.
//
// จังหวัด (2026-08): dropdown ผูกกับ analytics.dim_geo (77 จังหวัดจริง,
// getOemProvinces) แทนช่องพิมพ์เอง — กันปัญหาเขียนย่อ ("กทม") ไม่ตรงชื่อ
// ตามทะเบียนราษฎร์ ("กรุงเทพมหานคร") บนเอกสาร. เก็บทั้งชื่อเต็ม (province,
// พิมพ์บนเอกสาร) และ province_code (ผูกไว้เผื่อเชื่อมข้อมูลส่วนอื่นทีหลัง) —
// เขต/แขวง/ตำบล ยังเป็นช่องพิมพ์เหมือนเดิมตามที่เจ้าของบอกว่า "ถ้าไม่ได้เอา
// เหมือนเดิมก็ได้" (dim_address ที่มีอยู่ครอบคลุมแค่ ~4% ของรหัสไปรษณีย์จริง
// ในไทย เอามาทำ cascade เต็มรูปแบบไม่ได้ในรอบนี้ — ดูรายงานส่งท้ายงาน).
// provinces ว่างเปล่า (เช่น โหลดไม่สำเร็จ) → fallback เป็นช่องพิมพ์เอง แทนที่
// จะปิดกั้นการกรอกที่อยู่ทั้งหมด.

import { useState, useTransition } from "react";
import { setQuoteBilling } from "@/lib/actions/oem";
import type { OemProvinceOption, OemQuoteRow } from "@/lib/oem/types";
import { hasAnyContact, isValidThaiTaxId } from "@/lib/oem/display";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

function FieldLabel({
  htmlFor,
  children,
  optional,
  required,
}: {
  htmlFor: string;
  children: React.ReactNode;
  optional?: boolean;
  required?: boolean;
}) {
  return (
    <label htmlFor={htmlFor} className="mt-3 block text-sm font-medium text-zinc-700">
      {children}
      {required && (
        <span className="ml-0.5 text-red-600" aria-hidden="true">
          *
        </span>
      )}
      {optional && <span className="ml-1 font-normal text-zinc-400">(ไม่บังคับ)</span>}
    </label>
  );
}

const inputCls = "mt-1 min-h-11 w-full rounded-md border border-zinc-300 px-2.5 text-base";
const inputErrorCls = "mt-1 min-h-11 w-full rounded-md border border-red-400 px-2.5 text-base";

/** trims + reports "required" for the 5 plain-mandatory fields (legalName +
 * the 4 address parts before postalCode); null = valid. phone/contactChannel
 * are a pair, not individually required — see contactErr below. */
function requiredError(value: string, label: string): string | null {
  return value.trim() ? null : `กรุณากรอก${label}`;
}

function postalCodeError(value: string): string | null {
  const v = value.trim();
  if (!v) return "กรุณากรอกรหัสไปรษณีย์";
  if (!/^\d{5}$/.test(v)) return `ต้องเป็นตัวเลข 5 หลัก (กรอกแล้ว ${v.length} หลัก)`;
  return null;
}

export function BillingDialog({
  quote,
  provinces,
  onClose,
  onSaved,
}: {
  quote: OemQuoteRow;
  provinces: OemProvinceOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
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
  const [provinceCode, setProvinceCode] = useState(quote.billAddress?.provinceCode ?? "");
  const [postalCode, setPostalCode] = useState(quote.billAddress?.postalCode ?? "");
  const [pending, startTransition] = useTransition();
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  function blur(field: string) {
    return () => setTouched((t) => ({ ...t, [field]: true }));
  }
  function showError(field: string, message: string | null): string | null {
    return touched[field] ? message : null;
  }

  const legalNameErr = requiredError(legalName, "ชื่อเต็ม/ชื่อนิติบุคคล");
  const line1Err = requiredError(line1, "ที่อยู่ บรรทัด 1");
  const subdistrictErr = requiredError(subdistrict, "ตำบล/แขวง");
  const districtErr = requiredError(district, "อำเภอ/เขต");
  const provinceErr = requiredError(province, "จังหวัด");
  // ค่าที่ dropdown ควรแสดง: provinceCode ที่เก็บไว้ก่อน ถ้าไม่มี (เช่น
  // แถวเก่าก่อนมี provinceCode) ลองจับคู่จากชื่อจังหวัดที่เคยกรอกไว้แทน
  const matchedProvinceCode = provinceCode || provinces.find((p) => p.nameTh === province)?.code || "";
  const postalCodeErr = postalCodeError(postalCode);
  // Pair rule, not two independent required fields — see file header. Error
  // only fires when BOTH are empty; touching either field surfaces it.
  const contactOk = hasAnyContact(phone, contactChannel);
  const contactErr = contactOk ? null : "กรุณากรอกเบอร์โทร หรือช่องทางติดต่ออื่น (เช่น LINE ID) อย่างน้อย 1 อย่าง";
  const taxIdValid = isValidThaiTaxId(taxId);

  const canSubmit =
    !legalNameErr &&
    !line1Err &&
    !subdistrictErr &&
    !districtErr &&
    !provinceErr &&
    !postalCodeErr &&
    contactOk &&
    taxIdValid;

  function confirm() {
    // Mark everything touched so a stray Enter/click on a disabled-looking
    // button still surfaces exactly what's missing, not silence.
    setTouched({
      legalName: true,
      line1: true,
      subdistrict: true,
      district: true,
      province: true,
      postalCode: true,
      contact: true,
    });
    if (!canSubmit) return;
    startTransition(async () => {
      const result = await setQuoteBilling({
        quoteId: quote.id,
        legalName: legalName.trim(),
        taxId: taxId.trim() || null,
        phone: phone.trim() || null,
        contactChannel: contactChannel.trim() || null,
        address: {
          line1: line1.trim() || null,
          line2: line2.trim() || null,
          subdistrict: subdistrict.trim() || null,
          district: district.trim() || null,
          province: province.trim() || null,
          provinceCode: provinceCode.trim() || null,
          postalCode: postalCode.trim() || null,
        },
      });
      if (!result.ok) {
        toast.push(result.error, "error");
        return;
      }
      toast.push("บันทึกข้อมูลลูกค้าแล้ว");
      onSaved();
    });
  }

  return (
    <Modal open onClose={onClose} title={`ข้อมูลลูกค้าสำหรับออกเอกสาร — ${quote.quoteNo}`}>
      <p className="text-xs text-zinc-500">
        ใช้พิมพ์บนใบเสนอราคา/ใบกำกับภาษีที่ส่งให้ลูกค้ารายนี้ — กรอกให้ตรงกับเอกสารจดทะเบียนของลูกค้า ช่องมี{" "}
        <span className="text-red-600">*</span> คือกรอกให้ครบถึงจะบันทึกได้
      </p>

      <FieldLabel htmlFor="oem-bill-legal-name" required>
        ชื่อเต็ม / ชื่อนิติบุคคลที่ใช้ออกบิล
      </FieldLabel>
      <input
        id="oem-bill-legal-name"
        type="text"
        value={legalName}
        onChange={(e) => setLegalName(e.target.value)}
        onBlur={blur("legalName")}
        className={showError("legalName", legalNameErr) ? inputErrorCls : inputCls}
        placeholder="เช่น บริษัท ... จำกัด หรือ ชื่อ-นามสกุล"
        aria-required="true"
        aria-invalid={!!showError("legalName", legalNameErr)}
        aria-describedby={showError("legalName", legalNameErr) ? "oem-bill-legal-name-error" : undefined}
      />
      {showError("legalName", legalNameErr) && (
        <p id="oem-bill-legal-name-error" className="mt-1 text-xs text-red-600">
          {legalNameErr}
        </p>
      )}

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
        className={`${!taxIdValid ? inputErrorCls : inputCls} tabular-nums`}
        placeholder="เว้นว่างได้ถ้าเป็นลูกค้าบุคคลธรรมดา"
        aria-invalid={!taxIdValid}
        aria-describedby={!taxIdValid ? "oem-bill-tax-id-error" : "oem-bill-tax-id-warning"}
      />
      {!taxIdValid ? (
        <p id="oem-bill-tax-id-error" className="mt-1 text-xs text-red-600">
          ต้องเป็นตัวเลข 13 หลักพอดี (กรอกแล้ว {taxId.length} หลัก) หรือลบทิ้งให้ว่างถ้าไม่มี
        </p>
      ) : (
        !taxId.trim() && (
          <p id="oem-bill-tax-id-warning" className="mt-1 text-xs text-amber-600">
            ถ้าไม่กรอก จะออกใบกำกับภาษีให้ลูกค้ารายนี้ทีหลังไม่ได้
          </p>
        )
      )}

      <p className="mt-3 block text-sm font-medium text-zinc-700">
        ช่องทางติดต่อ (ต้องมีอย่างน้อย 1 อย่าง)
        <span className="ml-0.5 text-red-600" aria-hidden="true">
          *
        </span>
      </p>

      <FieldLabel htmlFor="oem-bill-phone">เบอร์โทร</FieldLabel>
      <input
        id="oem-bill-phone"
        type="tel"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        onBlur={blur("contact")}
        className={showError("contact", contactErr) ? inputErrorCls : inputCls}
        aria-invalid={!!showError("contact", contactErr)}
        aria-describedby={showError("contact", contactErr) ? "oem-bill-contact-error" : undefined}
      />

      <FieldLabel htmlFor="oem-bill-contact-channel">ช่องทางติดต่ออื่น (เช่น LINE ID)</FieldLabel>
      <input
        id="oem-bill-contact-channel"
        type="text"
        value={contactChannel}
        onChange={(e) => setContactChannel(e.target.value)}
        onBlur={blur("contact")}
        className={showError("contact", contactErr) ? inputErrorCls : inputCls}
        aria-invalid={!!showError("contact", contactErr)}
        aria-describedby={showError("contact", contactErr) ? "oem-bill-contact-error" : undefined}
      />
      {showError("contact", contactErr) && (
        <p id="oem-bill-contact-error" className="mt-1 text-xs text-red-600">
          {contactErr}
        </p>
      )}

      <p className="mt-4 text-sm font-medium text-zinc-700">ที่อยู่</p>
      <FieldLabel htmlFor="oem-bill-line1" required>
        บรรทัด 1 (บ้านเลขที่ / หมู่ / ซอย / ถนน)
      </FieldLabel>
      <input
        id="oem-bill-line1"
        type="text"
        value={line1}
        onChange={(e) => setLine1(e.target.value)}
        onBlur={blur("line1")}
        className={showError("line1", line1Err) ? inputErrorCls : inputCls}
        aria-required="true"
        aria-invalid={!!showError("line1", line1Err)}
        aria-describedby={showError("line1", line1Err) ? "oem-bill-line1-error" : undefined}
      />
      {showError("line1", line1Err) && (
        <p id="oem-bill-line1-error" className="mt-1 text-xs text-red-600">
          {line1Err}
        </p>
      )}

      <FieldLabel htmlFor="oem-bill-line2" optional>
        บรรทัด 2 (อาคาร / ชั้น — ถ้ามี)
      </FieldLabel>
      <input id="oem-bill-line2" type="text" value={line2} onChange={(e) => setLine2(e.target.value)} className={inputCls} />

      <div className="mt-3 grid grid-cols-2 gap-x-3">
        <div>
          <FieldLabel htmlFor="oem-bill-subdistrict" required>
            ตำบล/แขวง
          </FieldLabel>
          <input
            id="oem-bill-subdistrict"
            type="text"
            value={subdistrict}
            onChange={(e) => setSubdistrict(e.target.value)}
            onBlur={blur("subdistrict")}
            className={showError("subdistrict", subdistrictErr) ? inputErrorCls : inputCls}
            aria-required="true"
            aria-invalid={!!showError("subdistrict", subdistrictErr)}
            aria-describedby={showError("subdistrict", subdistrictErr) ? "oem-bill-subdistrict-error" : undefined}
          />
          {showError("subdistrict", subdistrictErr) && (
            <p id="oem-bill-subdistrict-error" className="mt-1 text-xs text-red-600">
              {subdistrictErr}
            </p>
          )}
        </div>
        <div>
          <FieldLabel htmlFor="oem-bill-district" required>
            อำเภอ/เขต
          </FieldLabel>
          <input
            id="oem-bill-district"
            type="text"
            value={district}
            onChange={(e) => setDistrict(e.target.value)}
            onBlur={blur("district")}
            className={showError("district", districtErr) ? inputErrorCls : inputCls}
            aria-required="true"
            aria-invalid={!!showError("district", districtErr)}
            aria-describedby={showError("district", districtErr) ? "oem-bill-district-error" : undefined}
          />
          {showError("district", districtErr) && (
            <p id="oem-bill-district-error" className="mt-1 text-xs text-red-600">
              {districtErr}
            </p>
          )}
        </div>
        <div>
          <FieldLabel htmlFor="oem-bill-province" required>
            จังหวัด
          </FieldLabel>
          {provinces.length > 0 ? (
            <select
              id="oem-bill-province"
              value={matchedProvinceCode}
              onChange={(e) => {
                const opt = provinces.find((p) => p.code === e.target.value);
                setProvince(opt?.nameTh ?? "");
                setProvinceCode(opt?.code ?? "");
                setTouched((t) => ({ ...t, province: true }));
              }}
              onBlur={blur("province")}
              className={showError("province", provinceErr) ? inputErrorCls : inputCls}
              aria-required="true"
              aria-invalid={!!showError("province", provinceErr)}
              aria-describedby={showError("province", provinceErr) ? "oem-bill-province-error" : undefined}
            >
              <option value="">— เลือกจังหวัด —</option>
              {provinces.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.nameTh}
                </option>
              ))}
            </select>
          ) : (
            // Fallback เมื่อโหลดรายชื่อจังหวัดไม่สำเร็จ — ยังกรอกที่อยู่ต่อได้
            // ไม่ต้องบล็อกทั้งฟอร์ม
            <input
              id="oem-bill-province"
              type="text"
              value={province}
              onChange={(e) => {
                setProvince(e.target.value);
                setProvinceCode("");
              }}
              onBlur={blur("province")}
              className={showError("province", provinceErr) ? inputErrorCls : inputCls}
              aria-required="true"
              aria-invalid={!!showError("province", provinceErr)}
              aria-describedby={showError("province", provinceErr) ? "oem-bill-province-error" : undefined}
            />
          )}
          {provinces.length > 0 && province.trim() && !matchedProvinceCode && (
            <p className="mt-1 text-xs text-amber-600">ค่าเดิมในระบบ: {province} — กรุณาเลือกจากรายการใหม่อีกครั้ง</p>
          )}
          {showError("province", provinceErr) && (
            <p id="oem-bill-province-error" className="mt-1 text-xs text-red-600">
              {provinceErr}
            </p>
          )}
        </div>
        <div>
          <FieldLabel htmlFor="oem-bill-postal-code" required>
            รหัสไปรษณีย์
          </FieldLabel>
          <input
            id="oem-bill-postal-code"
            type="text"
            inputMode="numeric"
            maxLength={5}
            value={postalCode}
            onChange={(e) => setPostalCode(e.target.value.replace(/[^0-9]/g, ""))}
            onBlur={blur("postalCode")}
            className={`${showError("postalCode", postalCodeErr) ? inputErrorCls : inputCls} tabular-nums`}
            aria-required="true"
            aria-invalid={!!showError("postalCode", postalCodeErr)}
            aria-describedby={showError("postalCode", postalCodeErr) ? "oem-bill-postal-code-error" : undefined}
          />
          {showError("postalCode", postalCodeErr) && (
            <p id="oem-bill-postal-code-error" className="mt-1 text-xs text-red-600">
              {postalCodeErr}
            </p>
          )}
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
