"use client";

// แท็บ "แบบแหวน" — AdminDesigns · กรองตามจำนวนเม็ด · ตารางจัดกลุ่มตามจำนวนเม็ด · ฟอร์มแก้ไขใน DesignDialog
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Layers } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import type { AdminCatalog, AdminDesign } from "@/lib/ring-builder/admin-types";
import { fmtThb, HIDDEN_REASON_LABEL } from "@/lib/ring-builder/admin-ui";
import { DesignDialog } from "./DesignDialog";

type Dlg = { id: string | "new" } | null;

export function DesignsTab({ catalog, onChanged }: { catalog: AdminCatalog; onChanged: () => Promise<void> }) {
  const [count, setCount] = useState<number | "all">("all");
  const [dlg, setDlg] = useState<Dlg>(null);

  const counts = useMemo(() => {
    const m = new Map<number, number>();
    for (const d of catalog.designs) m.set(d.stoneCount, (m.get(d.stoneCount) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [catalog.designs]);

  const groups = useMemo(() => {
    const shown = catalog.designs.filter((d) => count === "all" || d.stoneCount === count);
    return counts
      .filter(([c]) => count === "all" || c === count)
      .map(([c]) => ({ count: c, rows: shown.filter((d) => d.stoneCount === c).sort((a, b) => a.sort - b.sort || a.designNo - b.designNo) }));
  }, [catalog.designs, counts, count]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-zinc-900">แบบแหวน</h2>
          <p className="mt-0.5 text-sm text-zinc-700">แต่ละแบบกำหนดจำนวนเม็ด ทรง และขนาดพลอยตายตัว · ลูกค้าเลือกจำนวนเม็ดก่อน แล้วเห็นเฉพาะแบบของจำนวนนั้น</p>
        </div>
        <Button type="button" onClick={() => setDlg({ id: "new" })}>＋ เพิ่มแบบ</Button>
      </div>

      {catalog.designs.length === 0 ? (
        <EmptyState icon={Layers} title="ยังไม่มีแบบแหวน" description="ลูกค้ายังออกแบบแหวนไม่ได้จนกว่าจะมีแบบที่เปิดขาย · กด “เพิ่มแบบ” เพื่อสร้างเป็นร่าง ตั้งราคาตัวเรือน แล้วเปิดขาย" action={<Button type="button" onClick={() => setDlg({ id: "new" })}>＋ เพิ่มแบบ</Button>} />
      ) : (
        <section aria-label="รายการแบบ" className="rounded-lg border border-zinc-200 bg-white">
          <div role="group" aria-label="กรองจำนวนเม็ด" className="flex flex-wrap gap-2 border-b border-zinc-200 p-3">
            <Chip on={count === "all"} onClick={() => setCount("all")}>ทั้งหมด {catalog.designs.length}</Chip>
            {counts.map(([c, n]) => (
              <Chip key={c} on={count === c} onClick={() => setCount(c)}>
                {c} เม็ด · {n}
              </Chip>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs font-semibold text-zinc-600">
                  <th className="px-3 py-2.5">แบบ</th>
                  <th className="px-3 py-2.5">พลอย (ทรง · ขนาด)</th>
                  <th className="px-3 py-2.5">ไซซ์ที่ทำ</th>
                  <th className="px-3 py-2.5">ตัวเรือน</th>
                  <th className="px-3 py-2.5">ภาพ</th>
                  <th className="px-3 py-2.5">พลอยสีที่ขายได้</th>
                  <th className="px-3 py-2.5">สถานะ</th>
                  <th className="px-3 py-2.5"><span className="sr-only">จัดการ</span></th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <GroupRows key={g.count} count={g.count} rows={g.rows} onEdit={(id) => setDlg({ id })} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {dlg && <DesignDialog catalog={catalog} designId={dlg.id} defaultCount={typeof count === "number" ? count : null} onChanged={onChanged} onClose={() => setDlg(null)} onSwitch={(id) => setDlg({ id })} />}
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={`min-h-11 rounded-full border px-3.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 ${on ? "border-primary-600 bg-primary-50 text-primary-800" : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"}`}>
      {children}
    </button>
  );
}

function GroupRows({ count, rows, onEdit }: { count: number; rows: AdminDesign[]; onEdit: (id: string) => void }) {
  return (
    <>
      <tr className="bg-zinc-50">
        <td colSpan={8} className="px-3 py-1.5 text-xs font-bold text-zinc-700">{count} เม็ด</td>
      </tr>
      {rows.map((d) => (
        <tr key={d.id} className="border-b border-zinc-100 align-middle">
          <td className="px-3 py-3">
            <strong>{d.name}</strong> {d.locked && <Badge tone="indigo">ล็อก · เคยเปิดขาย</Badge>}
          </td>
          <td className="px-3 py-3">{d.shapeName} {d.stoneLabel} มม.</td>
          <td className="px-3 py-3">{d.sizeMin}–{d.sizeMax}</td>
          <td className="px-3 py-3">{d.bodyPriceThb === null ? <Badge tone="amber">ยังไม่ตั้งราคา</Badge> : fmtThb(d.bodyPriceThb)}</td>
          <td className="px-3 py-3">
            {d.cardImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={d.cardImageUrl} alt={`รูปการ์ด ${d.stoneCount} เม็ด ${d.name}`} className="h-10 w-10 rounded border border-zinc-200 object-cover" />
            ) : (
              <span className="text-zinc-600">แผนภาพ 2D</span>
            )}
          </td>
          <td className="px-3 py-3">{d.sellableStones === 0 ? <Badge tone="amber">0 ชนิด</Badge> : `${d.sellableStones} ชนิด`}</td>
          <td className="px-3 py-3">
            {d.visible ? <Badge tone="green">เปิดขาย</Badge> : <Badge tone={d.hiddenReason === "closed" || d.hiddenReason === "draft" ? "slate" : "amber"}>{d.hiddenReason ? HIDDEN_REASON_LABEL[d.hiddenReason] : "ไม่แสดง"}</Badge>}
          </td>
          <td className="px-3 py-3">
            <Button type="button" variant="secondary" size="sm" onClick={() => onEdit(d.id)} aria-label={`แก้ไข ${d.stoneCount} เม็ด ${d.name}`}>
              แก้ไข
            </Button>
          </td>
        </tr>
      ))}
    </>
  );
}
