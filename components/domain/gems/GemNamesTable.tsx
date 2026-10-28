"use client";

// GemNamesTable — แท็บ "ชนิด" และ "รูปทรง": เปลี่ยนชื่อ · รวมชื่อ… · ปิด/เปิดใช้งาน · ลบ (เฉพาะที่ไม่ถูกใช้เลย) — UX §7.4 §7.5
// ข้อเสนอรวมชื่อ (GemMergeSuggestions) ใช้ฟังก์ชันความคล้ายเดียวกับตัวดักหน้างาน → ออฟฟิศไม่ต้องไล่หาคู่ซ้ำเอง
// 🔴 ไม่มีราคาในแท็บนี้

import { useMemo, useState } from "react";
import { Tag } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { GemConfirm } from "@/components/domain/gems/GemConfirm";
import { GemMergeSuggestions } from "@/components/domain/gems/GemMergeSuggestions";
import { useOfficeRun } from "@/components/domain/jobs/useOfficeRun";
import { removeGem, setGemActive } from "@/lib/actions/gems";
import { bkkDateOf, daysBetween, thaiDate } from "@/lib/jobs/dates";
import type { GemCatalogName } from "@/lib/jobs/gems";

export function GemNamesTable({
  kind,
  names,
  todayBkk,
  onRename,
  onMerge,
}: {
  kind: "type" | "shape";
  names: GemCatalogName[];
  todayBkk: string;
  onRename: (n: GemCatalogName) => void;
  onMerge: (from: GemCatalogName | null, into: GemCatalogName | null) => void;
}) {
  const [showInactive, setShowInactive] = useState(false);
  const [del, setDel] = useState<GemCatalogName | null>(null);
  const { run, busy, error, setError } = useOfficeRun();
  const noun = kind === "type" ? "ชนิด" : "รูปทรง";

  const rows = useMemo(
    () => names.filter((n) => (showInactive ? true : n.isActive && n.mergedInto === null)).sort((a, b) => a.name.localeCompare(b.name, "th")),
    [names, showInactive],
  );
  const liveNames = useMemo(() => names.filter((n) => n.isActive && n.mergedInto === null), [names]);

  if (names.length === 0) {
    return (
      <EmptyState
        icon={Tag}
        title={`ยังไม่มี${noun}`}
        description={kind === "type" ? "ชนิดพลอยจะเข้ามาเองเมื่อมีคนพิมพ์ชื่อใหม่ในใบงาน — ระบบไม่ seed ชนิดให้" : "รูปทรงมาตรฐานจะขึ้นเมื่อมีการใช้งานครั้งแรก"}
      />
    );
  }

  async function toggle(n: GemCatalogName) {
    await run(() => setGemActive({ kind, id: n.id, active: !n.isActive }), { success: n.isActive ? `ปิดใช้งาน “${n.name}” แล้ว` : `เปิดใช้งาน “${n.name}” แล้ว` });
  }
  async function remove() {
    if (!del) return;
    const n = del;
    const r = await run(() => removeGem({ kind, id: n.id }), { success: `ลบ “${n.name}” แล้ว` });
    if (r.ok) setDel(null);
  }

  return (
    <div className="space-y-3">
      <GemMergeSuggestions kind={kind} names={liveNames} onMerge={onMerge} />

      <label className="flex min-h-11 items-center gap-2 text-sm text-zinc-900">
        <input type="checkbox" className="h-5 w-5 accent-primary-600" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
        แสดงที่ปิดใช้งาน
      </label>
      {error && !del && (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-2.5 text-sm font-medium text-red-800 break-words">
          {error}
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
        <table className="w-full min-w-[720px] text-left text-sm" data-testid={`gem-names-${kind}`}>
          <caption className="sr-only">รายการ{noun}พลอย</caption>
          <thead>
            <tr className="border-b border-zinc-200 text-xs font-semibold text-zinc-700">
              <th scope="col" className="px-3 py-2">ชื่อ</th>
              {kind === "shape" && <th scope="col" className="px-3 py-2">ขนาดกี่ค่า</th>}
              <th scope="col" className="px-3 py-2">ขนาดที่มี</th>
              <th scope="col" className="px-3 py-2">ใช้ในใบงาน</th>
              <th scope="col" className="px-3 py-2">เพิ่มเมื่อ</th>
              <th scope="col" className="px-3 py-2 text-right">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((n) => {
              const merged = n.mergedInto !== null;
              const inactive = !n.isActive || merged;
              const recent = n.via === "shopfloor" && (() => {
                const d = bkkDateOf(n.createdAt);
                return d !== null && daysBetween(d, todayBkk) <= 7 && daysBetween(d, todayBkk) >= 0;
              })();
              const unused = n.itemCount === 0 && n.usedJobsOpen === 0 && n.usedTemplates === 0;
              return (
                <tr key={n.id} className={`border-b border-zinc-100 last:border-0 ${inactive ? "opacity-60" : ""}`}>
                  <th scope="row" className="px-3 py-2 font-medium text-zinc-900 break-words">
                    {n.name}
                    {recent && <span className="ml-1 rounded-sm bg-sky-100 px-1.5 py-0.5 text-xs font-medium text-sky-950">จากหน้างาน</span>}
                    {merged && <span className="ml-1 text-xs font-normal text-zinc-700">(รวมเข้ากับ {n.mergedIntoName ?? "ชื่ออื่น"})</span>}
                    {!n.isActive && !merged && <span className="ml-1 text-xs font-normal text-zinc-700">(ปิดใช้งาน)</span>}
                  </th>
                  {kind === "shape" && <td className="px-3 py-2 text-zinc-900">{n.hasLength ? "2 ค่า (กว้าง×ยาว)" : "1 ค่า"}</td>}
                  <td className="px-3 py-2 tabular-nums text-zinc-900">{n.itemCount}</td>
                  <td className="px-3 py-2 tabular-nums text-zinc-900">
                    {n.usedJobsOpen}
                    {n.usedTemplates > 0 ? ` · ${n.usedTemplates} แม่แบบ` : ""}
                  </td>
                  <td className="px-3 py-2 text-zinc-900">{n.via === "seed" ? "—" : thaiDate(bkkDateOf(n.createdAt))}</td>
                  <td className="px-3 py-2 text-right">
                    {!merged && (
                      <div className="inline-flex flex-wrap justify-end gap-1">
                        <Button type="button" variant="secondary" size="sm" className="min-h-11" onClick={() => onRename(n)} aria-label={`เปลี่ยนชื่อ ${n.name}`}>
                          เปลี่ยนชื่อ
                        </Button>
                        <Button type="button" variant="secondary" size="sm" className="min-h-11" onClick={() => onMerge(n, null)} disabled={!n.isActive} aria-label={`รวมชื่อ ${n.name} เข้ากับชื่ออื่น`}>
                          รวมชื่อ…
                        </Button>
                        <Button type="button" variant="ghost" size="sm" className="min-h-11" onClick={() => void toggle(n)} disabled={busy} aria-label={`${n.isActive ? "ปิดใช้งาน" : "เปิดใช้งาน"} ${n.name}`}>
                          {n.isActive ? "ปิดใช้งาน" : "เปิดใช้งาน"}
                        </Button>
                        {unused && (
                          <Button type="button" variant="ghost" size="sm" className="min-h-11 text-red-700 hover:bg-red-50" onClick={() => { setError(null); setDel(n); }} aria-label={`ลบ ${n.name}`}>
                            ลบ
                          </Button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-zinc-700">ลบได้เฉพาะ{noun}ที่ไม่ถูกใช้เลย — ที่ถูกใช้แล้วให้ปิดใช้งาน (ซ่อนจากรายการหน้างาน ใบเก่ายังอ่านได้) หรือรวมชื่อ</p>

      {del && (
        <GemConfirm
          title={`ลบ${noun}`}
          message={`ลบ${noun} “${del.name}” ใช่ไหม? ลบแล้วกู้คืนไม่ได้`}
          confirmLabel="ลบ"
          busy={busy}
          error={error}
          onConfirm={() => void remove()}
          onCancel={() => setDel(null)}
        />
      )}
    </div>
  );
}
