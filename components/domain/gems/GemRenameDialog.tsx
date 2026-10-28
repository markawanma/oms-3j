"use client";

// GemRenameDialog — เปลี่ยนชื่อชนิด/รูปทรง (1 ช่อง) ผ่านกฎชื่อเดียวกับตอนสร้าง · UX §7.4
// ชื่อใหม่ที่ซ้ำกับของที่มีหลัง normalize = ปฏิเสธ (name_exists) · ที่ "คล้าย" = ถามก่อน (ใช้ "รวมชื่อ" แทน หรือยืนยันว่าเป็นคนละตัว) — กันเปลี่ยนชื่อไปซ้ำของที่มี
// ใบที่เปิดแล้วยังแสดงชื่อเดิมตอนสั่ง (snapshot) — เปลี่ยนชื่อไม่ย้อนไปแก้ใบเก่า

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useOfficeRun } from "@/components/domain/jobs/useOfficeRun";
import { GEM_FIELD, GemErrorLine } from "@/components/domain/gems/ui";
import { renameGem } from "@/lib/actions/gems";
import { cleanGemName } from "@/lib/jobs/shop-gems";
import type { GemCatalogName, GemSimilarHit } from "@/lib/jobs/gems";

export function GemRenameDialog({ kind, target, onClose }: { kind: "type" | "shape"; target: GemCatalogName; onClose: () => void }) {
  const noun = kind === "type" ? "ชนิดพลอย" : "รูปทรง";
  const { run, busy, error, setError } = useOfficeRun();
  const [name, setName] = useState(target.name);
  const [touched, setTouched] = useState(false);
  const [similar, setSimilar] = useState<GemSimilarHit | null>(null);

  const c = cleanGemName(name);
  const issue = !c.ok ? c.message : c.value === target.name ? "ชื่อยังเหมือนเดิม" : null;

  async function submit(force = false) {
    setTouched(true);
    if (busy || issue || !c.ok) return;
    setError(null);
    setSimilar(null);
    const r = await run(() => renameGem({ kind, id: target.id, name: c.value, force }), { success: `เปลี่ยนชื่อเป็น “${c.value}” แล้ว` });
    if (r.ok) {
      onClose();
      return;
    }
    if (!r.ok && r.gem?.similar && r.gem.similar.length > 0) setSimilar(r.gem.similar[0]);
  }

  return (
    <Modal open onClose={onClose} title={`เปลี่ยนชื่อ${noun}`}>
      <form noValidate className="space-y-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <div className="space-y-1">
          <label htmlFor="gr-name" className="block text-sm font-medium text-zinc-800">
            ชื่อใหม่ (เดิม: {target.name})
          </label>
          <input id="gr-name" value={name} maxLength={80} disabled={busy} onChange={(e) => { setName(e.target.value); setSimilar(null); }} aria-invalid={touched && issue ? true : undefined} aria-describedby={touched && issue ? "gr-err" : "gr-hint"} className={GEM_FIELD} />
          {touched && issue ? (
            <p id="gr-err" className="text-xs font-medium text-red-700">
              ⚠ {issue}
            </p>
          ) : (
            <p id="gr-hint" className="text-xs text-zinc-700">
              ใบงานที่เปิดแล้วยังแสดงชื่อเดิมตอนสั่ง — เปลี่ยนชื่อไม่ย้อนไปแก้ใบเก่า
            </p>
          )}
        </div>
        {similar && (
          <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-sm text-amber-950" data-testid="gem-rename-similar">
            <p className="font-medium">ชื่อนี้คล้ายกับ {similar.matches.map((m) => `“${m.name}”`).join(", ")} ที่มีอยู่แล้ว</p>
            <p>ถ้าเป็นตัวเดียวกัน ให้ปิดกล่องนี้แล้วใช้ “รวมชื่อ…” แทน (จะไม่เกิดชื่อซ้ำ) · ถ้าเป็นคนละตัวจริง กดยืนยันด้านล่าง</p>
            <Button type="button" variant="secondary" size="sm" className="mt-2 min-h-11" onClick={() => void submit(true)} loading={busy}>
              ยืนยัน — เป็นคนละตัว เปลี่ยนชื่อเลย
            </Button>
          </div>
        )}
        <GemErrorLine message={similar ? null : error} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            ยกเลิก
          </Button>
          <Button type="submit" loading={busy} aria-disabled={issue ? true : undefined} className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50">
            บันทึกชื่อ
          </Button>
        </div>
      </form>
    </Modal>
  );
}
