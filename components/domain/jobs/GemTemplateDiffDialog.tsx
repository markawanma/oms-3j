"use client";

// GemTemplateDiffDialog — "ตั้งเป็นแม่แบบ SKU": เปรียบเทียบแม่แบบปัจจุบัน | พลอยของใบนี้ (+ เพิ่ม − ลบ ~ แก้) แล้วยืนยัน — UX §5.2
// มีผลกับใบงานที่เปิดใหม่เท่านั้น — ใบที่เปิดแล้วไม่เปลี่ยน · SKU ไม่มีแม่แบบเดิม = "แม่แบบใหม่" · เทียบด้วยฉลาก (ไม่มีราคา)

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useOfficeRun } from "@/components/domain/jobs/useOfficeRun";
import { GemErrorLine } from "@/components/domain/gems/ui";
import { makeSkuGemTemplateFromJob } from "@/lib/actions/gems";
import { diffGemLines, gemDiffText } from "@/lib/jobs/gem-draft";
import type { GemBomLine } from "@/lib/jobs/gems";

const line = (l: GemBomLine) => `${l.label} · ${l.qtyPerPiece}/ชิ้น${l.position ? ` · ${l.position}` : ""}`;

export function GemTemplateDiffDialog({ jobId, sku, template, lines, onClose }: { jobId: string; sku: string; template: GemBomLine[]; lines: GemBomLine[]; onClose: () => void }) {
  const { run, busy, error } = useOfficeRun();
  const isNew = template.length === 0;
  // เทียบด้วยรายการจริง (canonical id) — ชื่อที่ถูกเปลี่ยน/รวมทีหลังไม่ทำให้เหมือน "ลบ+เพิ่ม"
  const toDiff = (l: GemBomLine) => ({ label: l.label, qtyPerPiece: l.qtyPerPiece, position: l.position, key: l.canonicalItemId });
  const diff = diffGemLines(template.map(toDiff), lines.map(toDiff));

  async function submit() {
    const r = await run(() => makeSkuGemTemplateFromJob(jobId), { success: `ตั้งเป็นแม่แบบพลอยของ ${sku} แล้ว` });
    if (r.ok) onClose();
  }

  return (
    <Modal open onClose={onClose} title={`ตั้งเป็นแม่แบบ SKU ${sku}`} wide>
      <div className="space-y-3">
        {isNew && (
          <p role="status" className="rounded-md border border-sky-300 bg-sky-50 p-2 text-sm font-medium text-sky-950">
            SKU นี้ยังไม่มีแม่แบบพลอย — จะตั้งเป็นแม่แบบใหม่
          </p>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          <section aria-labelledby="gt-old" className="rounded-md border border-zinc-200 p-2.5">
            <h3 id="gt-old" className="text-sm font-semibold text-zinc-900">
              แม่แบบปัจจุบัน
            </h3>
            {template.length === 0 ? (
              <p className="mt-1 text-sm text-zinc-800">— ยังไม่มี —</p>
            ) : (
              <ul className="mt-1 space-y-0.5 text-sm text-zinc-900" data-testid="gem-tpl-old">
                {template.map((l) => (
                  <li key={l.gemItemId} className="break-words">
                    {line(l)}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-labelledby="gt-new" className="rounded-md border border-zinc-200 p-2.5">
            <h3 id="gt-new" className="text-sm font-semibold text-zinc-900">
              พลอยของใบนี้
            </h3>
            <ul className="mt-1 space-y-0.5 text-sm text-zinc-900" data-testid="gem-tpl-new">
              {lines.map((l) => (
                <li key={l.gemItemId} className="break-words">
                  {line(l)}
                </li>
              ))}
            </ul>
          </section>
        </div>
        <section aria-labelledby="gt-diff">
          <h3 id="gt-diff" className="text-sm font-semibold text-zinc-900">
            สิ่งที่จะเปลี่ยนในแม่แบบ
          </h3>
          {diff.length === 0 ? (
            <p className="text-sm text-zinc-800">ไม่มีความต่าง</p>
          ) : (
            <ul className="mt-1 space-y-0.5 text-sm text-zinc-900" data-testid="gem-tpl-diff">
              {diff.map((d, i) => (
                <li key={i} className="break-words">
                  {gemDiffText(d)}
                </li>
              ))}
            </ul>
          )}
        </section>
        <p className="text-sm text-zinc-800">จะมีผลกับใบงานที่เปิดใหม่ — ใบที่เปิดแล้วไม่เปลี่ยน</p>
        <GemErrorLine message={error} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            ยกเลิก
          </Button>
          <Button type="button" loading={busy} onClick={() => void submit()}>
            ตั้งเป็นแม่แบบ
          </Button>
        </div>
      </div>
    </Modal>
  );
}
