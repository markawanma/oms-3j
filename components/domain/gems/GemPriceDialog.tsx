"use client";

// GemPriceDialog — ตั้งราคาพลอยต่อเม็ด (บาท) · มีวันที่มีผล · UX §7.2 — 🔴 ราคาพลอย = ต้นทุน: เปิดได้เฉพาะจากหน้า /oem/gems (owner/admin)
//  - ราคาใหม่ (ทศนิยม ≤ 4, 0 < x ≤ 1,000,000) · มีผลตั้งแต่ (ค่าเริ่ม = วันนี้ไทย · 2020 ถึงไม่เกิน 1 ปีข้างหน้า)
//  - แก้ราคาย้อนหลัง (วันก่อนวันนี้) หรือทับวันเดิม = บังคับหมายเหตุ (DB: note_required · audit append-only) — จอบอกก่อนกด ไม่รอ DB ตีกลับ
//  - ไม่คำนวณเงินใน client · ค่าที่กรอกไม่หายเมื่อ DB ปฏิเสธ · ปุ่มบันทึก aria-disabled + เหตุผล (ไม่ disabled เงียบ)

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useOfficeRun } from "@/components/domain/jobs/useOfficeRun";
import { GEM_FIELD, GemErrorLine } from "@/components/domain/gems/ui";
import { fmtGemPrice } from "@/components/domain/gems/GemItemsTable";
import { setGemPrice } from "@/lib/actions/gems";
import { addDays, thaiDate } from "@/lib/jobs/dates";
import { gemReasonIssue } from "@/lib/jobs/gem-reason";
import type { GemCatalogItem } from "@/lib/jobs/gems";

const PRICE_MSG = "ราคาต้องเป็นตัวเลขมากกว่า 0 และไม่เกิน 1,000,000 บาท (ทศนิยมไม่เกิน 4 ตำแหน่ง)";
export const PRICE_COMMA_MSG = "ใส่ราคาเป็นตัวเลขไม่มีจุลภาค เช่น 1000 หรือ 12.50";
const DATE_MSG = "วันที่มีผลต้องอยู่ระหว่างปี 2020 ถึงไม่เกิน 1 ปีข้างหน้า";

/** 🔴 ห้ามจุลภาคทุกตำแหน่ง ("1,000" ที่ตั้งใจหนึ่งพัน ต้องไม่กลายเป็น 1 บาทเงียบๆ) — ขนาดพลอย (มม.) เท่านั้นที่รับ "," เป็นจุด */
export function priceIssue(text: string): string | null {
  const t = text.trim();
  if (t.includes(",")) return PRICE_COMMA_MSG;
  if (!/^\d{1,7}(?:\.\d{1,4})?$/.test(t)) return PRICE_MSG;
  const n = Number(t);
  return n > 0 && n <= 1_000_000 ? null : PRICE_MSG;
}

export function dateIssue(d: string, todayBkk: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d))) return DATE_MSG;
  return d >= "2020-01-01" && d <= addDays(todayBkk, 365) ? null : DATE_MSG;
}

export function GemPriceDialog({ item, todayBkk, onClose }: { item: GemCatalogItem; todayBkk: string; onClose: () => void }) {
  const { run, busy, error, code, setError } = useOfficeRun();
  const [price, setPrice] = useState("");
  const [date, setDate] = useState(todayBkk);
  const [supplier, setSupplier] = useState("");
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState(false);

  const pIssue = priceIssue(price);
  const dIssue = dateIssue(date, todayBkk);
  const backdated = dIssue === null && date < todayBkk;
  const overwrite = dIssue === null && item.hasPrice && item.priceEffectiveFrom === date;
  const noteRequired = backdated || overwrite || code === "note_required";
  const noteOk = !noteRequired || gemReasonIssue(note) === null;
  const reason = pIssue ? "ใส่ราคาใหม่ให้ถูกต้องก่อน" : dIssue ? "แก้วันที่มีผลก่อน" : !noteOk ? "ใส่หมายเหตุเหตุผลที่แก้ก่อน" : null;

  async function submit() {
    setTouched(true);
    if (busy || reason) return;
    setError(null);
    const r = await run(
      () => setGemPrice({ itemId: item.gemItemId, price: price.trim(), effectiveFrom: date, supplier: supplier.trim() || null, note: note.trim() || null }),
      { success: `ตั้งราคา ${item.label} แล้ว` },
    );
    if (r.ok) onClose();
  }

  return (
    <Modal open onClose={onClose} title={`ตั้งราคา — ${item.label}`}>
      <form noValidate className="space-y-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <p className="text-sm text-zinc-900" data-testid="gem-price-current">
          {item.hasPrice && item.price !== null ? `ราคาปัจจุบัน ${fmtGemPrice(item.price)} บาท/เม็ด · ตั้งแต่ ${thaiDate(item.priceEffectiveFrom)}` : "ยังไม่เคยตั้งราคา"}
        </p>
        <div className="space-y-1">
          <label htmlFor="gp-price" className="block text-sm font-medium text-zinc-800">
            ราคาใหม่ (บาทต่อเม็ด) *
          </label>
          <div className="flex items-center gap-2">
            <input id="gp-price" inputMode="decimal" autoComplete="off" value={price} onChange={(e) => setPrice(e.target.value)} disabled={busy} aria-invalid={(touched || price.includes(",")) && pIssue ? true : undefined} aria-describedby={(touched || price.includes(",")) && pIssue ? "gp-price-err" : undefined} className={`${GEM_FIELD} tabular-nums`} />
            <span className="shrink-0 text-sm text-zinc-800">บาท</span>
          </div>
          {/* จุลภาคเตือนทันทีที่พิมพ์ (ไม่รอกดบันทึก) · ราคาที่ผ่านแล้วโชว์ค่าที่ระบบอ่านได้ก่อนบันทึก — เห็น "= ฿1,000.00" ก่อนกด ไม่ใช่ 1 บาทเงียบๆ (แค่จัดรูปที่พิมพ์ ไม่คำนวณเงิน) */}
          {(touched || price.includes(",")) && pIssue && (
            <p id="gp-price-err" className="text-xs font-medium text-red-700">
              ⚠ {pIssue}
            </p>
          )}
          {!pIssue && (
            <p className="text-sm font-semibold text-zinc-900 tabular-nums" data-testid="gem-price-parsed" aria-live="polite">
              = ฿{fmtGemPrice(Number(price.trim()))} ต่อเม็ด
            </p>
          )}
        </div>
        <div className="space-y-1">
          <label htmlFor="gp-date" className="block text-sm font-medium text-zinc-800">
            มีผลตั้งแต่ *
          </label>
          <input id="gp-date" type="date" value={date} min="2020-01-01" max={addDays(todayBkk, 365)} onChange={(e) => setDate(e.target.value)} disabled={busy} aria-invalid={touched && dIssue ? true : undefined} className={GEM_FIELD} />
          {touched && dIssue && <p className="text-xs font-medium text-red-700">⚠ {dIssue}</p>}
        </div>
        <div className="space-y-1">
          <label htmlFor="gp-sup" className="block text-sm font-medium text-zinc-800">
            ผู้ขาย · ไม่บังคับ
          </label>
          <input id="gp-sup" value={supplier} maxLength={120} onChange={(e) => setSupplier(e.target.value)} disabled={busy} className={GEM_FIELD} />
        </div>
        <div className="space-y-1">
          <label htmlFor="gp-note" className="block text-sm font-medium text-zinc-800">
            หมายเหตุ {noteRequired ? <span className="text-red-700">* จำเป็น</span> : <span className="font-normal text-zinc-700">· ไม่บังคับ</span>}
          </label>
          <input id="gp-note" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} disabled={busy} aria-describedby="gp-note-hint" className={GEM_FIELD} />
          <p id="gp-note-hint" className="text-xs text-zinc-700">
            {noteRequired
              ? overwrite
                ? "แก้ราคาทับวันเดิม ต้องระบุเหตุผล — บันทึกไว้ในประวัติแก้ราคา"
                : backdated
                  ? "ตั้งราคาย้อนหลัง ต้องระบุเหตุผล — บันทึกไว้ในประวัติแก้ราคา"
                  : "ระบบขอเหตุผลของการแก้ราคานี้ — บันทึกไว้ในประวัติแก้ราคา"
              : "ราคาวันเดียวกันที่ตั้งซ้ำ = แก้ราคาเดิม (ต้องมีหมายเหตุ)"}
          </p>
        </div>
        <GemErrorLine message={error} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            ยกเลิก
          </Button>
          <Button type="submit" loading={busy} aria-disabled={reason ? true : undefined} aria-describedby={reason ? "gp-why" : undefined} className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50">
            บันทึกราคา
          </Button>
        </div>
        {reason && touched && (
          <p id="gp-why" role="status" className="text-xs text-zinc-800">
            {reason}
          </p>
        )}
      </form>
    </Modal>
  );
}
