"use client";

// ShopQtyStep — W-3 "เท่าไร · เสร็จเมื่อไร" (UX B.5 · ภาษาภาพ Open3)
// บล็อก "ทำจาก" เป็นบล็อกแรก (มี SKU) · สินค้าใหม่ = แถวสรุปเล็ก + แก้ (กลับ W-2b) · จำนวน (stepper 56px) · เผื่อของเสีย ค่าเริ่มปิด · กำหนดเสร็จ ค่าเริ่มยังไม่กำหนด · แบบใหม่ ค่าเริ่มไม่ติ๊ก
// 🔴 ไม่มีตัวเลขเงิน/ช่องราคาในหน้านี้ · จำนวนชิ้นล้วน

import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { BigButton, QtyStepper } from "@/components/domain/jobs/worker/WorkerParts";
import { StickyAction, focusField } from "@/components/domain/jobs/worker/WorkerPanels";
import { ShopMetalBlock, ShopMetalRow } from "@/components/domain/jobs/worker/shop/ShopMetalSummary";
import type { ShopProfileReady } from "@/components/domain/jobs/worker/shop/ShopMetalSummary";
import { ShopFieldError } from "@/components/domain/jobs/worker/shop/ShopMetalFields";
import { addDays, thaiDate } from "@/lib/jobs/dates";
import { bufferIssue, dueIssue, profileBlockMessage, purityIssue, qtyIssue } from "@/lib/jobs/shop-open";
import type { ShopDue, ShopForm } from "@/lib/jobs/shop-open";
import { parseQtyText } from "@/lib/jobs/input";

const CHIP = "min-h-[52px] rounded-xl border-2 px-4 text-lg font-semibold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-300";

export function ShopQtyStep({
  form,
  setForm,
  ready,
  today,
  onNext,
  onEditMetal,
  onNeedPurity,
}: {
  form: ShopForm;
  setForm: Dispatch<SetStateAction<ShopForm>>;
  ready: ShopProfileReady;
  /** วันนี้ตามเวลาไทย YYYY-MM-DD */
  today: string;
  onNext: () => void;
  /** มี SKU = เปิดแผ่นแก้ · สินค้าใหม่ = กลับ W-2b */
  onEditMetal: () => void;
  /** เนื้อทองว่าง (SKU ทอง) — เปิดแผ่นแก้อัตโนมัติ ไม่ปล่อยให้ไปรอ error จากเซิร์ฟเวอร์ */
  onNeedPurity: () => void;
}) {
  const [showErr, setShowErr] = useState(false);
  const qErr = qtyIssue(form.qtyText);
  const bErr = qErr ? null : bufferIssue(form);
  const dErr = dueIssue(form.due, today);
  const needsPurity = purityIssue(form.metal, form.purityText) !== null && form.purityText.trim() === "";
  const block = profileBlockMessage(form.metal, ready);

  const qtyNow = (() => {
    const q = parseQtyText(form.qtyText);
    return q.ok ? q.value : null;
  })();

  function next() {
    setShowErr(true);
    if (needsPurity) {
      onNeedPurity();
      return;
    }
    if (qErr) return focusField("shop-qty");
    if (bErr) return focusField("shop-buffer");
    if (dErr) return focusField("shop-due-date");
    if (block) return;
    onNext();
  }

  const pickDue = (due: ShopDue) => setForm((f) => ({ ...f, due }));
  const d3 = addDays(today, 3);
  const d7 = addDays(today, 7);
  const on = form.due.kind;

  return (
    <>
      <div className="mt-4 space-y-4">
        {form.mode === "sku" ? (
          <ShopMetalBlock form={form} onEdit={onEditMetal} needsPurity={needsPurity} />
        ) : (
          <div className="rounded-2xl border-2 border-zinc-300 p-3">
            <ShopMetalRow form={form} onEdit={onEditMetal} />
          </div>
        )}

        {block && (
          <p role="alert" className="rounded-xl border-2 border-red-300 bg-red-50 p-3 text-lg font-semibold text-red-800">
            {block}
          </p>
        )}

        <section aria-label="จำนวน" className="space-y-3 rounded-2xl border-2 border-zinc-300 bg-white p-4">
          <QtyStepper id="shop-qty" label="ต้องการเข้าสต็อก (ชิ้น)" value={form.qtyText} onChange={(v) => setForm((f) => ({ ...f, qtyText: v }))} max={100000} error={showErr ? qErr : null} />
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p id="shop-buffer-label" className="text-lg font-semibold text-zinc-900">
                เผื่อของเสีย
              </p>
              <p className="text-base text-zinc-700">{form.bufferOn ? "เปิดอยู่ · ใส่จำนวนที่เผื่อ" : "ไม่บังคับ · ปิดอยู่ = ผลิตเท่าที่สั่ง"}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={form.bufferOn}
              aria-labelledby="shop-buffer-label"
              onClick={() => setForm((f) => ({ ...f, bufferOn: !f.bufferOn }))}
              className={`relative h-9 w-16 shrink-0 rounded-full border-2 transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-300 ${form.bufferOn ? "border-zinc-900 bg-zinc-900" : "border-zinc-400 bg-zinc-200"}`}
            >
              <span aria-hidden="true" className={`absolute top-0.5 h-7 w-7 rounded-full bg-white shadow transition-all ${form.bufferOn ? "left-8" : "left-0.5"}`} />
            </button>
          </div>
          {form.bufferOn && (
            <QtyStepper
              id="shop-buffer"
              label="เผื่อเพิ่มกี่ชิ้น"
              value={form.bufferText}
              onChange={(v) => setForm((f) => ({ ...f, bufferText: v }))}
              min={0}
              max={100000}
              error={showErr ? bErr : null}
              hint={qtyNow !== null && form.bufferText.trim() !== "" && !bufferIssue(form) ? `เริ่มผลิต ${(qtyNow + Number(form.bufferText)).toLocaleString("en-US")} ชิ้น` : null}
            />
          )}
        </section>

        <section aria-label="กำหนดเสร็จ" className="space-y-2 rounded-2xl border-2 border-zinc-300 bg-white p-4">
          <p id="shop-due-label" className="text-lg font-bold text-zinc-900">
            กำหนดเสร็จ
          </p>
          <div role="radiogroup" aria-labelledby="shop-due-label" className="flex flex-wrap gap-2">
            {(
              [
                { key: "days3", label: `3 วัน · ${thaiDate(d3, false)}`, checked: on === "days" && form.due.kind === "days" && form.due.days === 3, set: () => pickDue({ kind: "days", days: 3 }) },
                { key: "days7", label: `7 วัน · ${thaiDate(d7, false)}`, checked: on === "days" && form.due.kind === "days" && form.due.days === 7, set: () => pickDue({ kind: "days", days: 7 }) },
                { key: "date", label: "เลือกวัน", checked: on === "date", set: () => pickDue({ kind: "date", date: form.due.kind === "date" ? form.due.date : "" }) },
                { key: "none", label: "ยังไม่กำหนด", checked: on === "none", set: () => pickDue({ kind: "none" }) },
              ] as const
            ).map((c) => (
              <button key={c.key} type="button" role="radio" aria-checked={c.checked} onClick={c.set} className={`${CHIP} ${c.checked ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-900"}`}>
                {c.label}
              </button>
            ))}
          </div>
          {form.due.kind === "date" && (
            <div className="space-y-1">
              <label htmlFor="shop-due-date" className="block text-base font-semibold text-zinc-900">
                วันที่กำหนดเสร็จ
              </label>
              <input
                id="shop-due-date"
                type="date"
                min={today}
                value={form.due.date}
                onChange={(e) => pickDue({ kind: "date", date: e.target.value })}
                aria-invalid={showErr && dErr ? true : undefined}
                className="min-h-14 w-full rounded-xl border-2 border-zinc-400 bg-white px-4 text-xl text-zinc-900 focus:border-primary-600 focus:outline-none focus:ring-4 focus:ring-primary-200"
              />
              {showErr && dErr && <ShopFieldError>{dErr}</ShopFieldError>}
            </div>
          )}
        </section>

        <label className="flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border-2 border-zinc-300 bg-white p-4">
          <input type="checkbox" checked={form.isNewDesign} onChange={(e) => setForm((f) => ({ ...f, isNewDesign: e.target.checked }))} className="h-7 w-7 shrink-0 accent-primary-600" />
          <span>
            <span className="block text-lg font-semibold text-zinc-900">แบบใหม่ (ออกแบบครั้งแรก)</span>
            <span className="block text-base text-zinc-700">ออฟฟิศแก้ทีหลังได้</span>
          </span>
        </label>
      </div>

      <StickyAction>
        <BigButton type="button" aria-disabled={block ? true : undefined} onClick={next}>
          {block ? "เปิดงานวัสดุนี้ไม่ได้ตอนนี้" : needsPurity ? "ใส่เนื้อก่อน" : "ถัดไป"}
        </BigButton>
      </StickyAction>
    </>
  );
}
