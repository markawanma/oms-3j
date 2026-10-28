"use client";

// ShopMetalSummary — บล็อก "ทำจาก" (W-3) · แถวสรุป (W-6/7) · แผ่นแก้เต็มจอ (ShopMetalSheet) — UX B.5/B.6
// ค่าที่ขับต้นทุนทองคือเนื้อ+น้ำหนักที่ผู้จัดการกรอก (P8) จึงโชว์เด่นเสมอ · ทองใช้กรอบเหลือง (R6: จุดสุดท้ายที่คนเห็นโลหะก่อนเขียน DB)
// 🔴 ไม่มีตัวเลขเงิน/ราคา · น้ำหนักที่โชว์ = ที่ผู้จัดการพิมพ์เองบนจอนี้ก่อนเปิดใบ เท่านั้น (หลังเปิดไม่โชว์ซ้ำ — N1)

import { useEffect, useRef, useState } from "react";
import { BigButton } from "@/components/domain/jobs/worker/WorkerParts";
import { focusField } from "@/components/domain/jobs/worker/WorkerPanels";
import { ShopMetalFields } from "@/components/domain/jobs/worker/shop/ShopMetalFields";
import { ShopMetalTag } from "@/components/domain/jobs/worker/shop/ShopMetalTag";
import { changeMetal, metalIssues, profileBlockMessage, purityLabel, skuMetalNote, skuNoteOf, specEdited, weightLabel } from "@/lib/jobs/shop-open";
import type { ShopForm, ShopMetal } from "@/lib/jobs/shop-open";

export interface ShopProfileReady {
  profileReady: boolean;
  goldProfileReady: boolean;
}

const skuMetalOf = (form: ShopForm): ShopMetal | null => (form.mode === "sku" && form.product ? form.product.prefill.metal : null);

/** บล็อก "ทำจาก" บน W-3 (มี SKU) — MetalTag ใหญ่ + เนื้อ 20px bold + น้ำหนัก + ที่มา/ป้าย "แก้แล้ว" + ปุ่ม แก้ ≥ 44px */
export function ShopMetalBlock({ form, onEdit, needsPurity }: { form: ShopForm; onEdit: () => void; needsPurity: boolean }) {
  const note = skuNoteOf(form);
  const edited = specEdited(form);
  const gold = form.metal === "gold";
  return (
    <section aria-label="ทำจาก" className={`space-y-2 rounded-2xl p-4 ${gold ? "border-2 border-yellow-600 bg-yellow-50" : "border-2 border-zinc-300 bg-white"}`}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-zinc-900">ทำจาก</h2>
        <button type="button" onClick={onEdit} className="min-h-11 rounded-lg border-2 border-zinc-400 bg-white px-4 text-lg font-semibold text-zinc-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-300">
          แก้
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <ShopMetalTag metal={form.metal} size="lg" />
        <span className={`text-xl font-bold tabular-nums ${needsPurity ? "text-amber-900" : "text-zinc-900"}`}>{purityLabel(form.metal, form.purityText)}</span>
      </div>
      <p className="text-lg text-zinc-800">{weightLabel(form.weightText)}</p>
      {needsPurity ? (
        <p role="status" className="inline-block rounded-md bg-amber-100 px-2 py-0.5 text-base font-semibold text-amber-950">
          ⚠ ต้องใส่เนื้อ
        </p>
      ) : (
        <p className="text-base text-zinc-700">{edited ? <span className="rounded-md bg-amber-100 px-2 py-0.5 font-semibold text-amber-950">แก้แล้ว</span> : "ค่าจากสินค้าในระบบ"}</p>
      )}
      {note === "warn" && (
        <p role="note" className="rounded-xl border-2 border-amber-400 bg-amber-50 p-2.5 text-base text-amber-950">
          ⚠ ต่างจากสินค้าในระบบ — ออฟฟิศจะเห็นคำเตือนนี้ ตรวจให้ตรงของจริง
        </p>
      )}
      {note === "neutral" && <p className="text-base text-zinc-700">ⓘ สินค้านี้ยังไม่ระบุโลหะในระบบ — ตรวจให้ตรงของจริง</p>}
    </section>
  );
}

/** แถวสรุป "ทำจาก" (W-6/7 และสินค้าใหม่บน W-3) — ทอง = กรอบหนาเหลืองทอง */
export function ShopMetalRow({ form, onEdit, disabled, compact }: { form: ShopForm; onEdit: () => void; disabled?: boolean; compact?: boolean }) {
  const gold = form.metal === "gold";
  const note = skuNoteOf(form);
  return (
    <div className={`space-y-1.5 ${gold ? "rounded-xl border-4 border-yellow-600 bg-yellow-50 p-3" : ""}`}>
      <div className="flex items-center gap-3">
        <span className="w-24 shrink-0 text-base font-semibold text-zinc-700">ทำจาก</span>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1">
          <ShopMetalTag metal={form.metal} size={compact ? "sm" : "md"} />
          <span className="text-lg font-bold tabular-nums text-zinc-900">{purityLabel(form.metal, form.purityText)}</span>
          {!compact && <span className="text-lg text-zinc-800">· {weightLabel(form.weightText)}</span>}
        </div>
        <button type="button" onClick={onEdit} disabled={disabled} aria-label="แก้วัสดุ" className="min-h-11 shrink-0 rounded-lg px-3 text-lg font-semibold text-primary-800 underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-300 disabled:opacity-40">
          แก้
        </button>
      </div>
      {compact && <p className="pl-[6.75rem] text-base text-zinc-700">{weightLabel(form.weightText)}</p>}
      {note === "warn" && <p role="note" className="text-base font-semibold text-amber-900">⚠ ต่างจากสินค้าในระบบ</p>}
    </div>
  );
}

/** แผ่นแก้เต็มจอ — ใช้ค่านี้ / ยกเลิก (ยกเลิก = ไม่เปลี่ยนอะไร) · focus เข้าหัวแผ่น · Esc ปิด */
export function ShopMetalSheet({
  form,
  ready,
  initialFocusPurity,
  onApply,
  onCancel,
}: {
  form: ShopForm;
  ready: ShopProfileReady;
  /** เปิดอัตโนมัติเพราะเนื้อทองว่าง — แสดง error + โฟกัสช่องเนื้อ */
  initialFocusPurity?: boolean;
  onApply: (next: Pick<ShopForm, "metal" | "purityText" | "weightText">) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState({ metal: form.metal, purityText: form.purityText, weightText: form.weightText });
  const [notes, setNotes] = useState<string[]>([]);
  const [force, setForce] = useState(initialFocusPurity === true);
  const headRef = useRef<HTMLHeadingElement>(null);
  const shell = { ...form, ...draft };
  const issues = metalIssues(draft);
  const block = profileBlockMessage(draft.metal, ready);
  const skuMeta = form.mode === "sku" && form.product ? { metal: form.product.prefill.metal, known: form.product.prefill.metalKnown } : null;

  useEffect(() => {
    if (initialFocusPurity) focusField("shop-sheet-purity");
    else headRef.current?.focus();
  }, [initialFocusPurity]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  function apply() {
    if (issues.purity || issues.weight) {
      setForce(true);
      focusField(issues.purity ? "shop-sheet-purity" : "shop-sheet-weight");
      return;
    }
    if (block) return;
    onApply(draft);
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="shop-sheet-h" className="fixed inset-0 z-30 overflow-y-auto bg-white">
      <div className="mx-auto w-full max-w-md space-y-4 px-4 pt-5 pb-28">
        <h1 id="shop-sheet-h" ref={headRef} tabIndex={-1} className="text-2xl font-bold text-zinc-900 focus:outline-none">
          แก้วัสดุ
        </h1>
        <ShopMetalFields
          idBase="shop-sheet"
          metal={draft.metal}
          purityText={draft.purityText}
          weightText={draft.weightText}
          onMetalChange={(m) => {
            const r = changeMetal(shell, m);
            setDraft({ metal: r.form.metal, purityText: r.form.purityText, weightText: r.form.weightText });
            setNotes(r.notes);
            setForce(false);
          }}
          onPurityChange={(v) => setDraft((d) => ({ ...d, purityText: v }))}
          onWeightChange={(v) => setDraft((d) => ({ ...d, weightText: v }))}
          issues={issues}
          forceShow={force}
          notes={notes}
          skuNote={skuMetalNote({ selected: draft.metal, sku: skuMeta })}
          skuMetal={skuMeta?.metal ?? null}
          profileBlock={block}
        />
      </div>
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200 bg-white/95 px-4 pt-2 pb-3 backdrop-blur">
        <div className="mx-auto flex w-full max-w-md gap-3">
          <BigButton type="button" tone="secondary" onClick={onCancel}>
            ยกเลิก
          </BigButton>
          <BigButton type="button" aria-disabled={block ? true : undefined} onClick={apply}>
            ใช้ค่านี้
          </BigButton>
        </div>
      </div>
    </div>
  );
}
