"use client";

// ProductsPageClient — SKU catalog table + add/edit modal (docs/3j-jewelry/
// analytics/phase-c1-sku-cost-margin.md §3.1). Owner/admin only (page gates
// before rendering this). Reads are server-fetched; this component only owns
// the modal open/target state and re-fetches via router.refresh() on save.

import { useState } from "react";
import { Gem, Pencil, PlusCircle } from "lucide-react";
import type { ProductRow } from "@/lib/catalog/types";
import { COST_TYPE_LABEL_TH } from "@/lib/catalog/types";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { EmptyState } from "@/components/ui/EmptyState";
import { ProductForm } from "./ProductForm";

function fmtBaht(n: number | null): string {
  if (n == null) return "—";
  return `฿${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function MarginCell({ margin }: { margin: number | null }) {
  if (margin == null) return <span className="text-zinc-400">—</span>;
  const pct = (margin * 100).toFixed(1);
  const tone = margin < 0.1 ? "red" : margin < 0.2 ? "amber" : "green";
  return <Badge tone={tone}>{pct}%</Badge>;
}

export function ProductsPageClient({
  products,
  silverSpot,
}: {
  products: ProductRow[];
  silverSpot: number | null;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ProductRow | undefined>(undefined);

  function openCreate() {
    setEditing(undefined);
    setModalOpen(true);
  }
  function openEdit(p: ProductRow) {
    setEditing(p);
    setModalOpen(true);
  }
  function close() {
    setModalOpen(false);
    setEditing(undefined);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-zinc-900">สินค้า / ต้นทุน (SKU)</h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            กรอกต้นทุน + ราคาตั้งของแต่ละ SKU ระบบใช้คำนวณมาร์จิ้นแนะนำและกำไร/ROAS
          </p>
        </div>
        <Button type="button" variant="primary" size="sm" onClick={openCreate} className="shrink-0">
          <PlusCircle className="h-4 w-4" aria-hidden="true" />
          เพิ่ม SKU
        </Button>
      </div>

      {silverSpot == null && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          ยังไม่ได้ตั้งราคาเงินสปอต — SKU แบบอิงราคาเงิน (เงินแท่ง) จะยังคำนวณต้นทุนไม่ได้ ตั้งที่หน้า “ราคา &amp; มาร์จิ้น”
        </p>
      )}

      {products.length === 0 ? (
        <EmptyState
          icon={Gem}
          title="ยังไม่มีสินค้าในระบบ"
          description="เพิ่ม SKU แรกพร้อมต้นทุนและราคาตั้ง เพื่อเริ่มคำนวณมาร์จิ้น"
          action={
            <Button type="button" variant="primary" size="sm" onClick={openCreate}>
              <PlusCircle className="h-4 w-4" aria-hidden="true" />
              เพิ่ม SKU
            </Button>
          }
        />
      ) : (
        <div className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-xs font-semibold text-zinc-500">
                  <th scope="col" className="py-2 pr-3">SKU</th>
                  <th scope="col" className="py-2 pr-3">ชื่อ / หมวด</th>
                  <th scope="col" className="py-2 pr-3">โหมด</th>
                  <th scope="col" className="py-2 pr-3 text-right">ต้นทุน</th>
                  <th scope="col" className="py-2 pr-3 text-right">ราคาตั้ง</th>
                  <th scope="col" className="py-2 pr-3 text-right">margin</th>
                  <th scope="col" className="py-2 text-right">แก้ไข</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.productId} className={`border-b border-zinc-100 last:border-0 ${p.isActive ? "" : "opacity-55"}`}>
                    <td className="py-2 pr-3 font-mono text-xs text-zinc-700">
                      {p.sku}
                      {!p.isActive && <span className="ml-1 text-[0.65rem] text-zinc-400">(ปิด)</span>}
                    </td>
                    <td className="py-2 pr-3">
                      <div className="font-medium text-zinc-800">{p.name}</div>
                      {p.category && <div className="text-xs text-zinc-400">{p.category}</div>}
                    </td>
                    <td className="py-2 pr-3">
                      <Badge tone={p.costType === "spot" ? "cyan" : "slate"}>{COST_TYPE_LABEL_TH[p.costType]}</Badge>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-zinc-700">{fmtBaht(p.effectiveUnitCost)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-zinc-700">{fmtBaht(p.listPrice)}</td>
                    <td className="py-2 pr-3 text-right"><MarginCell margin={p.marginPct} /></td>
                    <td className="py-2 text-right">
                      <button
                        type="button"
                        onClick={() => openEdit(p)}
                        aria-label={`แก้ไข ${p.sku}`}
                        className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal open={modalOpen} onClose={close} title={editing ? `แก้ไข ${editing.sku}` : "เพิ่ม SKU ใหม่"}>
        <ProductForm initial={editing} silverSpot={silverSpot} onDone={close} />
      </Modal>
    </div>
  );
}
