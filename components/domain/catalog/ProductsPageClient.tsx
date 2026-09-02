"use client";

// ProductsPageClient — SKU catalog table + add/edit/import/delete (docs/3j-
// jewelry/analytics/phase-c1-sku-cost-margin.md §3.1). Owner/admin only (page
// gates before rendering). Reads are server-fetched; this component owns modal
// + filter state and re-fetches via router.refresh() on any mutation.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Gem, ImageOff, Pencil, PlusCircle, Trash2, Upload } from "lucide-react";
import type { ProductRow, SkuOrderAlert } from "@/lib/catalog/types";
import { COST_TYPE_LABEL_TH } from "@/lib/catalog/types";
import { deleteProduct } from "@/lib/actions/catalog";
import { publicImageUrl } from "@/lib/catalog/image-constants";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { EmptyState } from "@/components/ui/EmptyState";
import { useToast } from "@/components/ui/Toast";
import { ProductForm } from "./ProductForm";
import { ProductImport } from "./ProductImport";

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
  alerts,
}: {
  products: ProductRow[];
  silverSpot: number | null;
  alerts: SkuOrderAlert[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ProductRow | undefined>(undefined);
  const [importOpen, setImportOpen] = useState(false);
  const [deleting, setDeleting] = useState<ProductRow | undefined>(undefined);
  const [onlyActive, setOnlyActive] = useState(false);
  const [deletePending, startDelete] = useTransition();
  // Whether ProductImageSection (inside the ProductForm modal below) has an
  // in-flight resize/upload/reorder/delete right now — guards the modal
  // against ESC/backdrop/Cancel dropping unfinished work (design brief §
  // "กัน modal ปิดกลางคันขณะอัปโหลด").
  const [imagesBusy, setImagesBusy] = useState(false);

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
    setImagesBusy(false);
  }
  /** Guard used both by <Modal confirmBeforeClose> (ESC/backdrop/X) and by
   * ProductForm's own Cancel/"save while an upload is running" paths (see
   * the productModalOnDone wrapper below) — one place decides whether it's
   * safe to close right now. */
  function confirmCloseWhileImagesBusy(): boolean {
    if (!imagesBusy) return true;
    return window.confirm("กำลังอัปโหลดรูปอยู่ — ปิดตอนนี้รูปที่ยังอัปโหลดไม่เสร็จจะถูกยกเลิก ต้องการปิดหรือไม่?");
  }
  function productModalOnDone() {
    if (!confirmCloseWhileImagesBusy()) return;
    close();
  }

  function confirmDelete() {
    if (!deleting) return;
    const sku = deleting.sku;
    startDelete(async () => {
      const result = await deleteProduct(sku);
      if (!result.ok) {
        toast.push(result.error, "error");
        setDeleting(undefined);
        return;
      }
      toast.push(`ลบ ${sku} แล้ว`);
      setDeleting(undefined);
      router.refresh();
    });
  }

  const visible = onlyActive ? products.filter((p) => p.isActive) : products;
  const hiddenCount = products.length - visible.length;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-zinc-900">สินค้า / ต้นทุน (SKU)</h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            กรอกต้นทุน + ราคาตั้งของแต่ละ SKU ระบบใช้คำนวณมาร์จิ้นแนะนำและกำไร/ROAS
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4" aria-hidden="true" />
            นำเข้าจากไฟล์
          </Button>
          <Button type="button" variant="primary" size="sm" onClick={openCreate}>
            <PlusCircle className="h-4 w-4" aria-hidden="true" />
            เพิ่ม SKU
          </Button>
        </div>
      </div>

      {/* dormant alert: a SKU ordered while inactive / not in master */}
      {alerts.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-amber-800">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            พบ {alerts.length} SKU ที่มีออเดอร์แต่ปิดอยู่/ไม่มีในระบบ — อาจลืมเปิดใช้งาน
          </div>
          <ul className="mt-1.5 space-y-0.5 text-xs text-amber-700">
            {alerts.slice(0, 5).map((a) => (
              <li key={`${a.reason}-${a.sku}`}>
                <span className="font-mono">{a.sku}</span> ·{" "}
                {a.reason === "unknown" ? "ไม่มีในระบบ (SKU ใหม่?)" : "ปิดการใช้งานอยู่"} · ขายไป {a.qtySold} ชิ้น
              </li>
            ))}
            {alerts.length > 5 && <li>…และอีก {alerts.length - 5} รายการ</li>}
          </ul>
        </div>
      )}

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
          <div className="mb-2 flex items-center justify-between">
            <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-600">
              <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} />
              แสดงเฉพาะที่เปิดใช้งาน
              {onlyActive && hiddenCount > 0 && <span className="text-zinc-400">(ซ่อน {hiddenCount})</span>}
            </label>
            <span className="text-xs text-zinc-400">{visible.length} รายการ</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-xs font-semibold text-zinc-500">
                  <th scope="col" className="py-2 pr-3">
                    <span className="sr-only">รูป</span>
                  </th>
                  <th scope="col" className="py-2 pr-3">SKU</th>
                  <th scope="col" className="py-2 pr-3">ชื่อ / หมวด</th>
                  <th scope="col" className="py-2 pr-3">โหมด</th>
                  <th scope="col" className="py-2 pr-3 text-right">ต้นทุน</th>
                  <th scope="col" className="py-2 pr-3 text-right">ราคาตั้ง</th>
                  <th scope="col" className="py-2 pr-3 text-right">margin</th>
                  <th scope="col" className="py-2 text-right">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => {
                  // SM variant (480px cap) on purpose — this is a 40×40 box,
                  // and md across 303 rows would download full-size pictures
                  // to paint thumbnails. Falls back to md only if a row
                  // somehow lacks the sm path, so the cell never goes blank.
                  const thumbUrl = publicImageUrl(p.primaryImageSmPath ?? p.primaryImagePath);
                  return (
                  <tr key={p.productId} className={`border-b border-zinc-100 last:border-0 ${p.isActive ? "" : "opacity-55"}`}>
                    <td className="py-2 pr-3">
                      <button
                        type="button"
                        onClick={() => openEdit(p)}
                        aria-label={`แก้ไข ${p.sku} (คลิกรูป)`}
                        className="block h-10 w-10 shrink-0 overflow-hidden rounded-md bg-zinc-100"
                      >
                        {thumbUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element -- remote Supabase Storage image; next/image would burn the Vercel image-optimizer quota across up to 303 rows
                          <img
                            src={thumbUrl}
                            alt=""
                            width={40}
                            height={40}
                            loading="lazy"
                            className="h-10 w-10 object-cover"
                          />
                        ) : (
                          <span className="flex h-10 w-10 items-center justify-center text-zinc-300">
                            <ImageOff className="h-4 w-4" aria-hidden="true" />
                          </span>
                        )}
                      </button>
                    </td>
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
                      <div className="inline-flex gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(p)}
                          aria-label={`แก้ไข ${p.sku}`}
                          className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
                        >
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleting(p)}
                          aria-label={`ลบ ${p.sku}`}
                          className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-md text-zinc-400 hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={close}
        title={editing ? `แก้ไข ${editing.sku}` : "เพิ่ม SKU ใหม่"}
        confirmBeforeClose={confirmCloseWhileImagesBusy}
      >
        <ProductForm
          initial={editing}
          silverSpot={silverSpot}
          onDone={productModalOnDone}
          onCreated={(created) => setEditing(created)}
          onImagesBusyChange={setImagesBusy}
        />
      </Modal>

      <Modal open={importOpen} onClose={() => setImportOpen(false)} title="นำเข้าสินค้าจากไฟล์ CSV">
        <ProductImport onDone={() => setImportOpen(false)} />
      </Modal>

      <Modal open={Boolean(deleting)} onClose={() => setDeleting(undefined)} title="ลบสินค้า">
        <div className="flex flex-col gap-3">
          <p className="text-sm text-zinc-700">
            ต้องการลบ <span className="font-mono font-semibold">{deleting?.sku}</span> ({deleting?.name}) ออกจากระบบใช่ไหม?
          </p>
          <p className="rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-500">
            ถ้า SKU นี้เคยมีออเดอร์/สต็อกผูกอยู่ ระบบจะไม่ลบ และแนะนำให้ “ปิดการใช้งาน” แทน (กันประวัติกำไรหาย)
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setDeleting(undefined)} disabled={deletePending}>
              ยกเลิก
            </Button>
            <Button type="button" variant="danger" onClick={confirmDelete} loading={deletePending}>
              ลบ
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
