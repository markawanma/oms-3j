"use client";

// GemCatalogClient — หน้า /oem/gems (UX §7): 3 แท็บ role="tablist" เก็บใน ?tab= (ลิงก์/รีเฟรชคงที่)
//  รายการพลอย (หลัก — ราคา) · ชนิด · รูปทรง (+ ข้อเสนอรวมชื่อ)
// 🔴 หน้านี้เท่านั้นที่แสดงราคาพลอย — owner/admin (page.tsx guard `getEffectiveRole() === 'staff'` + DB ตรวจ actor ซ้ำ)
// state: loading = loading.tsx · empty (ไม่มีรายการ/กรองไม่เจอ) · error = ErrorState ที่ page + ข้อความใน Modal · success = ตาราง + tile

import { useState } from "react";
import type { KeyboardEvent } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { GemAddItemDialog } from "@/components/domain/gems/GemAddItemDialog";
import { GemItemDetailDialog } from "@/components/domain/gems/GemItemDetailDialog";
import { GemItemsTable } from "@/components/domain/gems/GemItemsTable";
import { GemMergeDialog } from "@/components/domain/gems/GemMergeDialog";
import { GemNamesTable } from "@/components/domain/gems/GemNamesTable";
import { GemPriceDialog } from "@/components/domain/gems/GemPriceDialog";
import { GemRenameDialog } from "@/components/domain/gems/GemRenameDialog";
import { GEM_TABS } from "@/lib/jobs/gem-tabs";
import type { GemTab } from "@/lib/jobs/gem-tabs";
import type { GemCatalog, GemCatalogItem, GemCatalogName } from "@/lib/jobs/gems";

type Dlg =
  | { t: "price"; item: GemCatalogItem }
  | { t: "detail"; item: GemCatalogItem }
  | { t: "add" }
  | { t: "rename"; kind: "type" | "shape"; target: GemCatalogName }
  | { t: "merge"; kind: "type" | "shape"; from: string | null; into: string | null }
  | null;

export function GemCatalogClient({ catalog, todayBkk, initialTab }: { catalog: GemCatalog; todayBkk: string; initialTab: GemTab }) {
  const [tab, setTab] = useState<GemTab>(initialTab);
  const [dlg, setDlg] = useState<Dlg>(null);

  function select(t: GemTab) {
    setTab(t);
    // เก็บใน ?tab= โดยไม่ navigate (ลิงก์/รีเฟรชคงที่) — รายการพลอยเป็นค่าเริ่ม ไม่ต้องใส่
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (t === "items") url.searchParams.delete("tab");
      else url.searchParams.set("tab", t);
      window.history.replaceState(window.history.state, "", url);
    }
  }
  function onTabKey(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const last = GEM_TABS.length - 1;
    const next = e.key === "ArrowRight" ? (i === last ? 0 : i + 1) : e.key === "ArrowLeft" ? (i === 0 ? last : i - 1) : e.key === "Home" ? 0 : e.key === "End" ? last : null;
    if (next === null) return;
    e.preventDefault();
    select(GEM_TABS[next].key);
    document.getElementById(`gem-tab-${GEM_TABS[next].key}`)?.focus();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-zinc-900">แคตตาล็อกพลอย</h1>
          <p className="mt-0.5 text-sm text-zinc-700">ชนิด รูปทรง ขนาด และราคาต่อเม็ด (บาท) — รายการส่วนใหญ่เข้ามาเองเมื่อหน้างานหรือออฟฟิศใส่พลอยในใบงาน</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* ลิงก์ข้ามกับหน้า "พลอยที่ต้องสั่ง" (ux-gems-to-buy.md §1) — คนนึกถึง "พลอย" แล้วมาเมนูนี้ก็เจอ */}
          <Link href="/jobs/gems-to-buy" className="inline-flex min-h-11 items-center rounded-md px-3 text-sm font-semibold text-primary-700 underline-offset-2 hover:bg-zinc-100 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600">
            พลอยที่ต้องสั่ง →
          </Link>
          <Button type="button" variant="secondary" onClick={() => setDlg({ t: "add" })}>
            ＋ เพิ่มรายการ
          </Button>
        </div>
      </div>

      <div role="tablist" aria-label="หมวดแคตตาล็อกพลอย" className="flex gap-1 border-b border-zinc-200">
        {GEM_TABS.map((t, i) => (
          <button
            key={t.key}
            id={`gem-tab-${t.key}`}
            role="tab"
            type="button"
            aria-selected={tab === t.key}
            aria-controls={`gem-panel-${t.key}`}
            tabIndex={tab === t.key ? 0 : -1}
            onClick={() => select(t.key)}
            onKeyDown={(e) => onTabKey(e, i)}
            className={`min-h-11 rounded-t-md px-4 text-sm font-semibold ${tab === t.key ? "border-b-2 border-primary-600 bg-primary-50 text-primary-700" : "text-zinc-700 hover:bg-zinc-100"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`gem-panel-${tab}`} aria-labelledby={`gem-tab-${tab}`}>
        {tab === "items" && <GemItemsTable items={catalog.items} todayBkk={todayBkk} onSetPrice={(item) => setDlg({ t: "price", item })} onDetail={(item) => setDlg({ t: "detail", item })} onAdd={() => setDlg({ t: "add" })} />}
        {tab === "types" && (
          <GemNamesTable kind="type" names={catalog.types} todayBkk={todayBkk} onRename={(target) => setDlg({ t: "rename", kind: "type", target })} onMerge={(from, into) => setDlg({ t: "merge", kind: "type", from: from?.id ?? null, into: into?.id ?? null })} />
        )}
        {tab === "shapes" && (
          <GemNamesTable kind="shape" names={catalog.shapes} todayBkk={todayBkk} onRename={(target) => setDlg({ t: "rename", kind: "shape", target })} onMerge={(from, into) => setDlg({ t: "merge", kind: "shape", from: from?.id ?? null, into: into?.id ?? null })} />
        )}
      </div>

      {dlg?.t === "price" && <GemPriceDialog item={dlg.item} todayBkk={todayBkk} onClose={() => setDlg(null)} />}
      {dlg?.t === "detail" && <GemItemDetailDialog item={dlg.item} onClose={() => setDlg(null)} />}
      {dlg?.t === "add" && <GemAddItemDialog onClose={() => setDlg(null)} />}
      {dlg?.t === "rename" && <GemRenameDialog kind={dlg.kind} target={dlg.target} onClose={() => setDlg(null)} />}
      {dlg?.t === "merge" && <GemMergeDialog kind={dlg.kind} names={dlg.kind === "type" ? catalog.types : catalog.shapes} initialFrom={dlg.from} initialInto={dlg.into} onClose={() => setDlg(null)} />}
    </div>
  );
}
