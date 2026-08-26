"use client";

// SkuPrefixPageClient — /catalog/sku-prefix table + "+ เพิ่ม prefix" (Phase
// 1a, docs/3j-jewelry/oem/design-email-sku-phase1.md). Read is server-fetched
// by the page; this component owns dialog state and re-fetches via
// router.refresh() after a save (same pattern as ProductsPageClient).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Hash, PlusCircle } from "lucide-react";
import type { SkuPrefixRow } from "@/lib/catalog/sku-prefix";
import { SKU_WORK_TYPE_LABEL_TH } from "@/lib/catalog/sku-prefix";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkuPrefixDialog } from "./SkuPrefixDialog";

export function SkuPrefixPageClient({ prefixes }: { prefixes: SkuPrefixRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  function saved() {
    router.refresh();
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
        <Button type="button" onClick={() => setOpen(true)}>
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
            <Button type="button" onClick={() => setOpen(true)}>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <SkuPrefixDialog open={open} onClose={() => setOpen(false)} existing={prefixes} onSaved={saved} />
    </div>
  );
}
