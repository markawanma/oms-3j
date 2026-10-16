"use client";

// PaymentLinesSection — /oem/rates: "ช่องทางชำระเงิน (พิมพ์บนใบแจ้งหนี้)" (0179)
//
// การ์ดแยกจาก SellerProfileSection โดยตั้งใจ — SellerProfileSection ส่ง payload ก้อนเดียวผ่าน saveOemSetting (ห้ามเพิ่ม field)
// ส่วนนี้บันทึกผ่าน setSellerPaymentLines (RPC ของตัวเอง) · ค่าจริงเจ้าของกรอกเอง — ไม่มีค่าตัวอย่างในโค้ด
//
// 3 สถานะของ `paymentLines` ต้องไม่ปนกัน:
//   null  = โหลดไม่ได้ → ล็อก textarea + ปุ่ม แถบแดง (ห้ามพูดว่า "ยังไม่ได้ตั้ง" — จะชวนให้เจ้าของกรอกทับของเดิมที่ยังอยู่)
//   []    = อ่านได้แต่ยังไม่ได้ตั้ง → แถบเหลือง
//   [...] = ตั้งแล้ว → แถบเขียว

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { setSellerPaymentLines } from "@/lib/actions/oem";
import { PAYMENT_LINES_MAX, PAYMENT_LINE_MAX_CHARS, linesToText, parsePaymentLinesText } from "@/lib/oem/paymentLinesForm";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

export function PaymentLinesSection({ paymentLines }: { paymentLines: string[] | null }) {
  const router = useRouter();
  const toast = useToast();
  const locked = paymentLines === null;
  const [text, setText] = useState(linesToText(paymentLines ?? []));
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const form = parsePaymentLinesText(text);
  const savedCount = paymentLines?.length ?? 0;
  const willClear = !locked && savedCount > 0 && form.count === 0;
  const error = form.error ?? serverError;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (locked || form.error) return;
    setServerError(null);
    startTransition(async () => {
      const result = await setSellerPaymentLines({ lines: form.lines });
      if (!result.ok) {
        setServerError(result.error);
        toast.push(result.error, "error");
        return;
      }
      toast.push(form.count === 0 ? "ล้างช่องทางชำระเงินแล้ว — ออกใบแจ้งหนี้ไม่ได้จนกว่าจะตั้งใหม่" : "บันทึกช่องทางชำระเงินแล้ว");
      router.refresh();
    });
  }

  return (
    <form
      id="oem-payment-lines"
      aria-labelledby="oem-payment-lines-title"
      onSubmit={handleSubmit}
      className="scroll-mt-4 rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm"
    >
      <h2 id="oem-payment-lines-title" className="text-sm font-bold text-zinc-800">
        ช่องทางชำระเงิน (พิมพ์บนใบแจ้งหนี้)
      </h2>
      <p className="mt-0.5 text-xs text-zinc-500">
        พิมพ์บนใบแจ้งหนี้ทุกใบ ณ วันที่ออก — เปลี่ยนทีหลังไม่กระทบใบที่ออกไปแล้ว
      </p>

      {locked ? (
        <div role="alert" className="mt-3 flex items-start gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <p>โหลดช่องทางชำระไม่สำเร็จ — ลองรีเฟรชหน้านี้ก่อน (ช่องด้านล่างถูกล็อกไว้ เพื่อไม่ให้กรอกทับค่าเดิมที่อาจยังอยู่)</p>
        </div>
      ) : savedCount === 0 ? (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <p>ยังไม่ได้ตั้งช่องทางชำระเงิน — ออกใบแจ้งหนี้ไม่ได้จนกว่าจะตั้ง</p>
        </div>
      ) : (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-green-300 bg-green-50 px-3 py-2 text-xs text-green-800">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <p>ตั้งแล้ว {savedCount} ช่องทาง — ออกใบแจ้งหนี้ได้</p>
        </div>
      )}

      <label htmlFor="oem-payment-lines-input" className="sr-only">
        ช่องทางชำระเงิน บรรทัดละ 1 ช่องทาง
      </label>
      <textarea
        id="oem-payment-lines-input"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setServerError(null);
        }}
        rows={4}
        disabled={locked || pending}
        aria-invalid={error !== null}
        aria-describedby={`oem-payment-lines-help${error ? " oem-payment-lines-error" : ""}`}
        className="mt-3 w-full rounded-md border border-zinc-300 px-2.5 py-2 text-sm text-zinc-900 disabled:bg-zinc-100 disabled:text-zinc-500"
        placeholder="ใส่ช่องทางชำระเงินของร้าน บรรทัดละ 1 ช่องทาง"
      />
      <div className="mt-1 flex items-start justify-between gap-3 text-xs text-zinc-500">
        <p id="oem-payment-lines-help">
          (บรรทัดละ 1 ช่องทาง · ไม่เกิน {PAYMENT_LINES_MAX} บรรทัด · บรรทัดละไม่เกิน {PAYMENT_LINE_MAX_CHARS} ตัวอักษร) — ล้างทั้งหมดแล้วบันทึก = ออกใบแจ้งหนี้ไม่ได้
        </p>
        <p className={`shrink-0 tabular-nums ${form.count > PAYMENT_LINES_MAX ? "font-semibold text-red-600" : ""}`} aria-label={`ใช้แล้ว ${form.count} จาก ${PAYMENT_LINES_MAX} บรรทัด`}>
          {form.count}/{PAYMENT_LINES_MAX}
        </p>
      </div>

      {willClear && !error && (
        <p className="mt-2 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
          ช่องว่างทั้งหมด — กดบันทึกแล้วจะล้างช่องทางชำระที่ตั้งไว้ และออกใบแจ้งหนี้ใหม่ไม่ได้จนกว่าจะตั้งใหม่
        </p>
      )}
      {error && (
        <p id="oem-payment-lines-error" role="alert" className="mt-2 text-xs text-red-600">
          {error}
        </p>
      )}

      <div className="mt-3.5 flex justify-end">
        <Button type="submit" variant="primary" size="sm" className="min-h-11 w-full sm:w-auto" loading={pending} disabled={locked || form.error !== null}>
          บันทึกช่องทางชำระ
        </Button>
      </div>
    </form>
  );
}
