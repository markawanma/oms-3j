"use client";

// GemMergeDialog — รวมชื่อซ้ำ A → B (UX §7.4) — ย้อนกลับไม่ได้
//  - เลือก A (เลิกใช้) / B (ใช้ต่อ) → "ผลที่จะเกิด" มาจาก preview ของ DB (อ่านอย่างเดียว · จอไม่คำนวณเอง) · preview มาก่อนปุ่มรวมเสมอ
//  - ราคาของ A "จะไม่ถูกย้าย" (มติ) · ใบที่เปิดแล้วยังแสดงชื่อเดิมตอนสั่ง (snapshot) · A ≠ B (ตัวเลือก B ไม่รวม A)
//  - loading = "กำลังตรวจผลกระทบ…" + ปุ่มรวม aria-disabled · error = "ตรวจผลกระทบไม่ได้ — ลองอีกครั้ง"
//  - ปุ่มรวมเป็น danger outline (ไม่ใช่ primary แดง) · focus เริ่มที่ "ยกเลิก"

import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useOfficeRun } from "@/components/domain/jobs/useOfficeRun";
import { GEM_FIELD, GemErrorLine, useFocusAfterOpen } from "@/components/domain/gems/ui";
import { mergeGem, previewGemMerge } from "@/lib/actions/gems";
import { GENERIC_JOB_ERROR } from "@/lib/jobs/messages";
import type { GemCatalogName, GemMergePlan } from "@/lib/jobs/gems";

type Preview = { s: "idle" } | { s: "loading" } | { s: "error"; message: string } | { s: "ready"; plan: GemMergePlan };

const n = (x: number) => x.toLocaleString("en-US");

export function GemMergeDialog({ kind, names, initialFrom, initialInto, onClose }: { kind: "type" | "shape"; names: GemCatalogName[]; initialFrom: string | null; initialInto: string | null; onClose: () => void }) {
  const noun = kind === "type" ? "ชนิดพลอย" : "รูปทรง";
  const { run, busy, error, setError } = useOfficeRun();
  const [from, setFrom] = useState(initialFrom ?? "");
  const [into, setInto] = useState(initialInto ?? "");
  const [preview, setPreview] = useState<Preview>({ s: "idle" });
  const [nonce, setNonce] = useState(0);
  const cancel = useRef<HTMLButtonElement>(null);
  useFocusAfterOpen(cancel);

  const live = names.filter((x) => x.mergedInto === null);
  const aList = live;
  const bList = live.filter((x) => x.isActive && x.id !== from);
  const a = live.find((x) => x.id === from) ?? null;
  const b = live.find((x) => x.id === into) ?? null;

  useEffect(() => {
    if (!from || !into || from === into) {
      setPreview({ s: "idle" });
      return;
    }
    let cancelled = false;
    setPreview({ s: "loading" });
    (async () => {
      try {
        const r = await previewGemMerge({ kind, fromId: from, intoId: into });
        if (cancelled) return;
        setPreview(r.ok ? { s: "ready", plan: r.data } : { s: "error", message: r.error });
      } catch {
        if (!cancelled) setPreview({ s: "error", message: GENERIC_JOB_ERROR });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kind, from, into, nonce]);

  const plan = preview.s === "ready" ? preview.plan : null;
  const blocked = plan && plan.templateQtyOverflow > 0 ? "รวมแล้วแม่แบบ SKU บางตัวมีจำนวนต่อชิ้นเกิน 1,000 — แก้แม่แบบเหล่านั้นก่อนรวม" : null;
  const reason = !a || !b ? `เลือกทั้งสองชื่อก่อน` : preview.s === "loading" ? "กำลังตรวจผลกระทบ…" : preview.s === "error" ? "ตรวจผลกระทบไม่ได้ — ลองอีกครั้ง" : blocked;

  async function submit() {
    if (busy || reason || !a || !b) return;
    setError(null);
    const r = await run(() => mergeGem({ kind, fromId: a.id, intoId: b.id }), { success: `รวม “${a.name}” เข้ากับ “${b.name}” แล้ว` });
    if (r.ok) onClose();
  }

  return (
    <Modal open onClose={onClose} title={`รวมชื่อซ้ำ — ${noun}`}>
      <form noValidate className="space-y-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <div className="space-y-1">
          <label htmlFor="gm-from" className="block text-sm font-medium text-zinc-800">
            ชื่อที่จะเลิกใช้ (A)
          </label>
          <select
            id="gm-from"
            value={from}
            disabled={busy}
            onChange={(e) => {
              setFrom(e.target.value);
              if (e.target.value === into) setInto("");
            }}
            className={GEM_FIELD}
          >
            <option value="">เลือกชื่อ…</option>
            {aList.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
          {a && (
            <p className="text-xs text-zinc-800">
              ใช้ใน {n(a.usedJobsOpen)} ใบงาน · {n(a.usedTemplates)} แม่แบบ SKU
            </p>
          )}
        </div>
        <div className="space-y-1">
          <label htmlFor="gm-into" className="block text-sm font-medium text-zinc-800">
            เปลี่ยนไปใช้ชื่อ (B)
          </label>
          <select id="gm-into" value={into} disabled={busy} onChange={(e) => setInto(e.target.value)} className={GEM_FIELD}>
            <option value="">เลือกชื่อ…</option>
            {bList.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
          {b && (
            <p className="text-xs text-zinc-800">
              ใช้ใน {n(b.usedJobsOpen)} ใบงาน · {n(b.usedTemplates)} แม่แบบ SKU
            </p>
          )}
        </div>

        <section aria-labelledby="gm-effect" className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
          <h3 id="gm-effect" className="text-sm font-semibold text-zinc-900">
            ผลที่จะเกิด
          </h3>
          {preview.s === "idle" && <p className="mt-1 text-sm text-zinc-800">เลือกชื่อ A และ B เพื่อดูผลกระทบก่อนรวม</p>}
          {preview.s === "loading" && (
            <p role="status" className="mt-1 text-sm text-zinc-800">
              กำลังตรวจผลกระทบ…
            </p>
          )}
          {preview.s === "error" && (
            <div role="alert" className="mt-1 text-sm text-red-800">
              <p className="font-medium">ตรวจผลกระทบไม่ได้ — ลองอีกครั้ง</p>
              <p className="break-words">{preview.message}</p>
              <button type="button" onClick={() => setNonce((x) => x + 1)} className="min-h-11 font-semibold underline">
                ลองอีกครั้ง
              </button>
            </div>
          )}
          {plan && a && b && (
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-zinc-900" data-testid="gem-merge-effects">
              <li>
                รายการพลอย {n(plan.itemsMoved)} ขนาด{plan.templateLinesRepointed + plan.templateLinesSummed > 0 ? ` และแม่แบบ SKU ${n(plan.templateLinesRepointed + plan.templateLinesSummed)} รายการ` : ""} ย้ายไปอยู่ภายใต้ “{b.name}”
              </li>
              {plan.itemsCollapsed > 0 && (
                <li>
                  ขนาดที่ซ้ำกัน ({n(plan.itemsCollapsed)}) รวมเป็นรายการเดียว — ใช้ราคาของ “{b.name}” · ราคาของ “{a.name}” {n(plan.pricesNotMoved)} ราคา <strong>จะไม่ถูกย้าย</strong>
                </li>
              )}
              {plan.itemsCollapsed === 0 && plan.pricesNotMoved > 0 && (
                <li>
                  ราคาของ “{a.name}” {n(plan.pricesNotMoved)} ราคา <strong>จะไม่ถูกย้าย</strong>
                </li>
              )}
              <li>
                ใบงานที่เปิดแล้ว ({n(plan.jobsUsingTotal)} ใบ) ยังแสดงชื่อเดิมตอนสั่ง (“{a.name}”) ไม่เปลี่ยน
                {plan.jobsOpenUsing > 0 ? ` · ที่ยังเปิดอยู่ ${n(plan.jobsOpenUsing)} ใบ` : ""}
              </li>
              <li>ย้อนกลับไม่ได้ · บันทึกประวัติว่าใครรวมเมื่อไร</li>
            </ul>
          )}
          {plan && plan.collapsedMissingPriceOnTarget > 0 && b && a && (
            <p role="status" className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm font-medium text-amber-950" data-testid="gem-merge-price-warn">
              “{b.name}” ยังไม่มีราคา ส่วนของ “{a.name}” มีราคา — ตั้งราคาให้ “{b.name}” หลังรวม ({n(plan.collapsedMissingPriceOnTarget)} ขนาด)
            </p>
          )}
          {plan && plan.templateProducts.length > 0 && <p className="mt-2 text-xs text-zinc-800">กระทบแม่แบบของ {n(plan.templateProducts.length)} SKU</p>}
          {blocked && (
            <p role="alert" className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-sm font-medium text-red-800">
              {blocked}
            </p>
          )}
        </section>

        <GemErrorLine message={error} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button ref={cancel} type="button" variant="secondary" onClick={onClose} disabled={busy}>
            ยกเลิก
          </Button>
          <Button
            type="submit"
            variant="secondary"
            loading={busy}
            aria-disabled={reason ? true : undefined}
            aria-describedby={reason ? "gm-why" : undefined}
            className="border-red-400 text-red-700 hover:bg-red-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
          >
            รวมชื่อ
          </Button>
        </div>
        {reason && (
          <p id="gm-why" className="text-xs text-zinc-800">
            {reason}
          </p>
        )}
      </form>
    </Modal>
  );
}
