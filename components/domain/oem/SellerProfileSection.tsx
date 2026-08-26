"use client";

// SellerProfileSection — /oem/rates: "ข้อมูลร้านเรา (หัวกระดาษ)". 0079 moved
// this off a hardcoded file (lib/oem/sellerProfile.ts) into
// analytics.oem_setting.seller_* so the owner can fill it in here — no more
// "รอ dev แก้โค้ด" for something this basic. Distinct from BillingDialog's
// "ข้อมูลลูกค้าสำหรับออกเอกสาร" (a per-quote customer's info) — see that
// file's header for the naming collision this used to cause.
//
// Same atomic-submit pattern as OemPolicySection (one button, whole section
// saved together) — saveOemSetting sends everything through ONE
// oem_setting_upsert RPC call (0079), never two writes.
//
// missingSellerFields() below drives BOTH this section's own "ยังขาด..."
// banner AND the print page's block gate (lib/oem/sellerProfile.ts) — same
// function, same rule, so they can never disagree about what's required.
//
// 0080: fields can now be CLEARED (delete the text, save -> field goes back
// to empty), not just overwritten — the RPC gained a 3-state
// null(unchanged)/''(clear)/value(overwrite) contract for the 8 text
// scalars (see UpsertOemSettingInput's comment). This form's inputs are
// always-controlled strings initialized from `profile` once at mount, so an
// empty current value alone can't tell "always been empty" apart from "the
// owner just deleted it" — sellerFieldForSave below resolves that by
// comparing against what was actually loaded (profile.X), not just the
// current string.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { saveOemSetting } from "@/lib/actions/oem";
import type { SellerProfile } from "@/lib/oem/sellerProfile";
import { missingSellerFields } from "@/lib/oem/sellerProfile";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

const inputCls = "min-h-11 w-full rounded-md border border-zinc-300 px-2.5 text-sm text-zinc-900";
const labelCls = "flex flex-col gap-1 text-xs font-semibold text-zinc-600";
const textareaCls = "w-full rounded-md border border-zinc-300 px-2.5 py-2 text-sm text-zinc-900";

function linesToText(lines: string[]): string {
  return lines.join("\n");
}
function textToLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/** 0080: resolve one text field to the RPC's 3-state contract by comparing
 * the CURRENT input value against what was actually loaded (`original`,
 * from the `profile` prop) — current value alone can't distinguish "always
 * empty, never touched" from "was set, owner just deleted it":
 *   current has text  -> send it (write, whether changed or not)
 *   current empty AND original had text -> send '' (an intentional clear)
 *   current empty AND original was already empty -> send null (no-op) */
function sellerFieldForSave(current: string, original: string | null): string | null {
  const trimmed = current.trim();
  if (trimmed !== "") return trimmed;
  return original?.trim() ? "" : null;
}

export function SellerProfileSection({ profile, loadError }: { profile: SellerProfile; loadError?: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const [legalName, setLegalName] = useState(profile.legalName ?? "");
  const [branchLabel, setBranchLabel] = useState(profile.branchLabel ?? "");
  const [addressText, setAddressText] = useState(linesToText(profile.addressLines));
  const [taxId, setTaxId] = useState(profile.taxId ?? "");
  const [vatRegistered, setVatRegistered] = useState(profile.vatRegistered);
  const [phone, setPhone] = useState(profile.phone ?? "");
  const [line, setLine] = useState(profile.line ?? "");
  const [email, setEmail] = useState(profile.email ?? "");
  const [website, setWebsite] = useState(profile.website ?? "");
  const [termsText, setTermsText] = useState(linesToText(profile.terms));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const missing = missingSellerFields(profile);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmedTaxId = taxId.trim();
    if (trimmedTaxId && !/^\d{13}$/.test(trimmedTaxId)) {
      return setError(`เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลข 13 หลักพอดี (กรอกแล้ว ${trimmedTaxId.length} หลัก) หรือลบทิ้งให้ว่างถ้ายังไม่มี`);
    }

    startTransition(async () => {
      const result = await saveOemSetting({
        sellerLegalName: sellerFieldForSave(legalName, profile.legalName),
        sellerBranchLabel: sellerFieldForSave(branchLabel, profile.branchLabel),
        sellerAddressLines: textToLines(addressText),
        sellerTaxId: sellerFieldForSave(trimmedTaxId, profile.taxId),
        sellerVatRegistered: vatRegistered,
        sellerPhone: sellerFieldForSave(phone, profile.phone),
        sellerLine: sellerFieldForSave(line, profile.line),
        sellerEmail: sellerFieldForSave(email, profile.email),
        sellerWebsite: sellerFieldForSave(website, profile.website),
        sellerTerms: textToLines(termsText),
      });
      if (!result.ok) {
        setError(result.error);
        toast.push(result.error, "error");
        return;
      }
      toast.push("บันทึกข้อมูลร้านแล้ว");
      router.refresh();
    });
  }

  return (
    <form id="oem-seller-profile" onSubmit={handleSubmit} className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
      <h2 className="text-sm font-bold text-zinc-800">ข้อมูลร้านเรา (หัวกระดาษ)</h2>
      <p className="mt-0.5 text-xs text-zinc-500">
        ข้อมูลชุดนี้พิมพ์เป็นหัวกระดาษของทุกใบเสนอราคาที่ส่งลูกค้า — คนละส่วนกับ &quot;ข้อมูลลูกค้าสำหรับออกเอกสาร&quot; ที่กรอกแยกในแต่ละใบ
      </p>
      <p className="mt-0.5 text-xs text-zinc-500">
        ลบข้อความในช่องไหนจนว่างแล้วกด &quot;บันทึกข้อมูลร้าน&quot; = ลบข้อมูลช่องนั้นออกจากระบบจริง (ไม่ใช่แค่ซ่อนไว้) — เว้นช่อง VAT/มาร์จิ้น/floor ที่ล้างไม่ได้
      </p>

      {loadError ? (
        // โหลดข้อมูลไม่สำเร็จ (เช่น เพิ่งลง migration ใหม่ ยังไม่ refresh
        // schema cache) — ต่างจาก "ยังไม่ได้กรอก" ห้ามฟอร์มด้านล่างแสดงว่า
        // "ขาดทุกช่อง" ทั้งที่จริงแค่โหลดไม่ขึ้น เดี๋ยวเจ้าของกรอกซ้ำของเดิม
        // ทับจนข้อมูลหาย
        <div className="mt-3 flex items-start gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <p>โหลดข้อมูลร้านไม่สำเร็จ: {loadError} — ฟอร์มด้านล่างอาจว่างเปล่าทั้งที่เคยกรอกไว้แล้ว ลองรีเฟรชหน้านี้ก่อนบันทึกทับ</p>
        </div>
      ) : missing.length > 0 ? (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <p>ยังพิมพ์ใบเสนอราคาจริงไม่ได้ — ขาด: {missing.join(", ")}</p>
        </div>
      ) : (
        <div className="mt-3 flex items-center gap-2 rounded-md border border-green-300 bg-green-50 px-3 py-2 text-xs text-green-800">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <p>ข้อมูลร้านครบแล้ว — พิมพ์ใบเสนอราคาได้</p>
        </div>
      )}

      <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <label className={labelCls}>
          ชื่อจดทะเบียน / ชื่อที่ใช้ออกบิล
          <input type="text" value={legalName} onChange={(e) => setLegalName(e.target.value)} className={inputCls} placeholder="เช่น บริษัท ... จำกัด" />
        </label>
        <label className={labelCls}>
          สำนักงานใหญ่ / สาขา (ไม่บังคับ)
          <input
            type="text"
            value={branchLabel}
            onChange={(e) => setBranchLabel(e.target.value)}
            className={inputCls}
            placeholder='เช่น "สำนักงานใหญ่" หรือ "สาขาที่ 00001"'
          />
        </label>
      </div>

      <label className={`${labelCls} mt-2.5`}>
        ที่อยู่จดทะเบียน (บรรทัดละ 1 ที่ — ปิดท้ายด้วยรหัสไปรษณีย์)
        <textarea
          value={addressText}
          onChange={(e) => setAddressText(e.target.value)}
          rows={3}
          className={textareaCls}
          placeholder={"เลขที่ ... หมู่ ... ถนน ...\nตำบล/แขวง ... อำเภอ/เขต ... จังหวัด ... รหัสไปรษณีย์ ....."}
        />
      </label>

      <div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <label className={labelCls}>
          เลขประจำตัวผู้เสียภาษี 13 หลัก (ไม่บังคับ)
          <input
            type="text"
            inputMode="numeric"
            maxLength={13}
            value={taxId}
            onChange={(e) => setTaxId(e.target.value.replace(/[^0-9]/g, ""))}
            className={`${inputCls} tabular-nums`}
          />
        </label>
        <div className="flex flex-col justify-end gap-1">
          <label className="flex min-h-11 items-center gap-2 text-sm text-zinc-800">
            <input
              type="checkbox"
              checked={vatRegistered}
              onChange={(e) => setVatRegistered(e.target.checked)}
              className="h-4 w-4 rounded border-zinc-300"
            />
            จดทะเบียนภาษีมูลค่าเพิ่ม (VAT) แล้ว
          </label>
          <p className="text-[0.68rem] text-zinc-500">
            {vatRegistered
              ? 'ติ๊กแล้ว — เอกสารจะพิมพ์ "ราคารวมภาษีมูลค่าเพิ่มแล้ว"'
              : "ยังไม่ติ๊ก — ระบบจะไม่พิมพ์คำว่า VAT ลงเอกสารเลย เพราะเขียนทั้งที่ยังไม่จดทะเบียนผิดกฎหมาย ติ๊กเมื่อจดทะเบียนแล้วเท่านั้น"}
          </p>
        </div>
      </div>

      <div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <label className={labelCls}>
          เบอร์โทร
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} />
        </label>
        <label className={labelCls}>
          LINE (ไม่บังคับ)
          <input type="text" value={line} onChange={(e) => setLine(e.target.value)} className={inputCls} />
        </label>
        <label className={labelCls}>
          อีเมล (ไม่บังคับ)
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
        </label>
        <label className={labelCls}>
          เว็บไซต์ (ไม่บังคับ)
          <input type="text" value={website} onChange={(e) => setWebsite(e.target.value)} className={inputCls} />
        </label>
      </div>

      <label className={`${labelCls} mt-2.5`}>
        เงื่อนไขมาตรฐาน (บรรทัดละ 1 ข้อ — ไม่บังคับ)
        <textarea
          value={termsText}
          onChange={(e) => setTermsText(e.target.value)}
          rows={3}
          className={textareaCls}
          placeholder={"มัดจำ 50% ก่อนเริ่มผลิต ส่วนที่เหลือชำระก่อนส่งมอบ\nระยะเวลาผลิต 15-20 วันทำการหลังยืนยันแบบ\nโอนเข้าบัญชี ..."}
        />
      </label>

      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

      <div className="mt-3.5 flex justify-end">
        <Button type="submit" variant="primary" size="sm" loading={pending}>
          บันทึกข้อมูลร้าน
        </Button>
      </div>
    </form>
  );
}
