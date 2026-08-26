"use client";

// SkuPrefixPageClient — /catalog/sku-prefix table + "+ เพิ่ม prefix" (Phase
// 1a, docs/3j-jewelry/oem/design-email-sku-phase1.md). Read is server-fetched
// by the page; this component owns dialog state and re-fetches via
// router.refresh() after a save (same pattern as ProductsPageClient).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Hash, Pencil, PlusCircle, Trash2 } from "lucide-react";
import type { SkuPrefixRow } from "@/lib/catalog/sku-prefix";
import { SKU_WORK_TYPE_LABEL_TH } from "@/lib/catalog/sku-prefix";
import { deleteSkuPrefix } from "@/lib/actions/catalog-sku";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { SkuPrefixDialog } from "./SkuPrefixDialog";

export function SkuPrefixPageClient({ prefixes }: { prefixes: SkuPrefixRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SkuPrefixRow | null>(null);
  const [deleting, setDeleting] = useState<SkuPrefixRow | null>(null);
  const [deletePending, startDelete] = useTransition();

  function openCreate() {
    setEditing(null);
    setOpen(true);
  }
  function openEdit(row: SkuPrefixRow) {
    setEditing(row);
    setOpen(true);
  }
  function closeDialog() {
    setOpen(false);
    setEditing(null);
  }

  function saved() {
    router.refresh();
  }

  function confirmDelete() {
    if (!deleting) return;
    const prefix = deleting.prefix;
    const id = deleting.id;
    startDelete(async () => {
      const result = await deleteSkuPrefix({ id });
      if (!result.ok) {
        toast.push(result.error, "error");
        setDeleting(null);
        return;
      }
      toast.push(`ลบ prefix ${prefix} แล้ว`);
      setDeleting(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-zinc-900">ตั้งค่า Prefix SKU</h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            ตั้ง prefix ของแต่ละประเภทงาน ใช้ตอนสร้าง SKU ใหม่จากหน้าคิดราคางาน OEM
          </p>
        </div>
        <Button type="button" onClick={openCreate}>
          <PlusCircle className="h-4 w-4" aria-hidden="true" />
          เพิ่ม prefix
        </Button>
      </div>

      {prefixes.length === 0 ? (
        <EmptyState
          icon={Hash}
          title="ยังไม่มี prefix"
          description="เพิ่มก่อนถึงจะสร้าง SKU ใหม่ได้"
          action={
            <Button type="button" onClick={openCreate}>
              <PlusCircle className="h-4 w-4" aria-hidden="true" />
              เพิ่ม prefix
            </Button>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-zinc-200 text-sm">
            <thead className="bg-zinc-50">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-semibold text-zinc-600">
                  ประเภทงาน
                </th>
                <th scope="col" className="px-3 py-2 text-left font-semibold text-zinc-600">
                  ลักษณะงาน
                </th>
                <th scope="col" className="px-3 py-2 text-left font-semibold text-zinc-600">
                  prefix
                </th>
                <th scope="col" className="px-3 py-2 text-left font-semibold text-zinc-600">
                  จำนวนหลัก
                </th>
                <th scope="col" className="px-3 py-2 text-left font-semibold text-zinc-600">
                  เลขสูงสุดใน catalog
                </th>
                <th scope="col" className="px-3 py-2 text-right font-semibold text-zinc-600">
                  จัดการ
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {prefixes.map((p) => (
                <tr key={p.id}>
                  <td className="px-3 py-2 text-zinc-800">{p.kindLabel}</td>
                  <td className="px-3 py-2 text-zinc-800">{SKU_WORK_TYPE_LABEL_TH[p.workType]}</td>
                  <td className="px-3 py-2 font-mono font-semibold text-zinc-900">{p.prefix}</td>
                  <td className="px-3 py-2 tabular-nums text-zinc-600">{p.padWidth === 0 ? "ไม่เติม" : p.padWidth}</td>
                  <td className="px-3 py-2 tabular-nums text-zinc-600">{p.lastNo ?? "—"}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="inline-flex gap-1">
                      <button
                        type="button"
                        onClick={() => openEdit(p)}
                        aria-label={`แก้ไข prefix ${p.prefix}`}
                        className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleting(p)}
                        aria-label={`ลบ prefix ${p.prefix}`}
                        className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-md text-zinc-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <SkuPrefixDialog open={open} onClose={closeDialog} existing={prefixes} onSaved={saved} editing={editing} />

      <Modal open={Boolean(deleting)} onClose={() => setDeleting(null)} title="ลบ prefix">
        <div className="flex flex-col gap-3">
          <p className="text-sm text-zinc-700">
            ต้องการลบ prefix <span className="font-mono font-semibold">{deleting?.prefix}</span> (
            {deleting?.kindLabel} · {deleting ? SKU_WORK_TYPE_LABEL_TH[deleting.workType] : ""}) ใช่ไหม?
          </p>
          <p className="rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-500">
            ลบได้เฉพาะ prefix ที่ยังไม่เคยออก SKU — ถ้ามี SKU ใช้ prefix นี้แล้วระบบจะไม่ลบ
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setDeleting(null)} disabled={deletePending}>
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
