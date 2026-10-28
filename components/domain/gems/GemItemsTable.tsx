"use client";

// GemItemsTable — แท็บ "รายการพลอย" ของ /oem/gems (UX §7.2) — 🔴 หน้านี้เท่านั้นที่แสดงราคา (owner/admin · หน้า guard ที่ page.tsx)
//  - ราคา = THB ต่อเม็ด · ยังไม่มีราคา = chip amber + ⚠ "ยังไม่มีราคา" (ไม่ใช่ 0 ไม่ใช่ "—" · design R6) · ไม่คำนวณเงินใน client (แสดงค่าที่ DB ส่งมาเท่านั้น)
//  - tile กรอง (aria-pressed) · ค้นหา · กรองชนิด/รูปทรง · แสดงที่ปิดใช้งาน · ตารางเลื่อนแนวนอน min-w (pattern /production)
//  - ป้าย "จากหน้างาน" เมื่อสร้างภายใน 7 วัน (ไม่มีสถานะ "รอยืนยัน" ที่ต้องกดอนุมัติ — มติ)

import { useMemo, useState } from "react";
import { AlertTriangle, Diamond } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { bkkDateOf, daysBetween, thaiDate } from "@/lib/jobs/dates";
import { normalizeGemName } from "@/lib/jobs/shop-gems";
import type { GemCatalogItem } from "@/lib/jobs/gems";
import { GEM_FIELD } from "@/components/domain/gems/ui";

export const fmtGemPrice = (n: number): string => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });

type TileKey = "all" | "noPrice" | "recent";

/** เพิ่มจากหน้างานภายใน 7 วัน (นับตามวันไทย) */
export function isRecentFromShop(it: Pick<GemCatalogItem, "via" | "createdAt">, todayBkk: string): boolean {
  if (it.via !== "shopfloor") return false;
  const d = bkkDateOf(it.createdAt);
  if (!d) return false;
  const n = daysBetween(d, todayBkk);
  return n >= 0 && n <= 7;
}

const live = (i: GemCatalogItem) => i.isActive && i.mergedInto === null;

export function GemItemsTable({
  items,
  todayBkk,
  onSetPrice,
  onDetail,
  onAdd,
}: {
  items: GemCatalogItem[];
  todayBkk: string;
  onSetPrice: (i: GemCatalogItem) => void;
  onDetail: (i: GemCatalogItem) => void;
  onAdd: () => void;
}) {
  const [tile, setTile] = useState<TileKey>("all");
  const [q, setQ] = useState("");
  const [typeId, setTypeId] = useState("");
  const [shapeId, setShapeId] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  const liveItems = useMemo(() => items.filter(live), [items]);
  const counts = {
    all: liveItems.length,
    noPrice: liveItems.filter((i) => !i.hasPrice).length,
    recent: liveItems.filter((i) => isRecentFromShop(i, todayBkk)).length,
  };

  const types = useMemo(() => [...new Map(items.map((i) => [i.typeId, i.typeName])).entries()].sort((a, b) => a[1].localeCompare(b[1], "th")), [items]);
  const shapes = useMemo(() => [...new Map(items.map((i) => [i.shapeId, i.shapeName])).entries()].sort((a, b) => a[1].localeCompare(b[1], "th")), [items]);

  const nq = normalizeGemName(q);
  const rows = useMemo(() => {
    const out = items
      .filter((i) => (showInactive ? true : live(i)))
      .filter((i) => (tile === "noPrice" ? !i.hasPrice : tile === "recent" ? isRecentFromShop(i, todayBkk) : true))
      .filter((i) => (typeId ? i.typeId === typeId : true))
      .filter((i) => (shapeId ? i.shapeId === shapeId : true))
      .filter((i) => (nq === "" ? true : normalizeGemName(i.label).includes(nq)));
    return out.sort((a, b) => a.typeName.localeCompare(b.typeName, "th") || a.shapeName.localeCompare(b.shapeName, "th") || a.sizeA - b.sizeA || (a.sizeB ?? -1) - (b.sizeB ?? -1));
  }, [items, showInactive, tile, typeId, shapeId, nq, todayBkk]);

  const filtered = tile !== "all" || q.trim() !== "" || typeId !== "" || shapeId !== "";
  const clear = () => {
    setTile("all");
    setQ("");
    setTypeId("");
    setShapeId("");
  };

  if (items.length === 0) {
    return (
      <EmptyState
        icon={Diamond}
        title="ยังไม่มีรายการพลอย"
        description="รายการจะเข้ามาเองเมื่อหน้างานหรือออฟฟิศใส่พลอยในใบงาน — หรือเพิ่มเองด้วย “＋ เพิ่มรายการ”"
        action={
          <Button type="button" variant="secondary" size="sm" onClick={onAdd}>
            ＋ เพิ่มรายการ
          </Button>
        }
      />
    );
  }

  const TILES: { key: TileKey; label: string; n: number; warn?: boolean }[] = [
    { key: "all", label: "ทั้งหมด", n: counts.all },
    { key: "noPrice", label: "ยังไม่มีราคา", n: counts.noPrice, warn: true },
    { key: "recent", label: "เพิ่มจากหน้างาน 7 วัน", n: counts.recent },
  ];

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-3" role="group" aria-label="กรองด่วน">
        {TILES.map((t) => (
          <button
            key={t.key}
            type="button"
            aria-pressed={tile === t.key}
            onClick={() => setTile(t.key)}
            className={`min-h-11 rounded-lg border p-3 text-left ${tile === t.key ? "border-primary-600 bg-primary-50" : "border-zinc-200 bg-white hover:bg-zinc-50"}`}
          >
            <span className="block text-sm text-zinc-800">
              {t.warn && t.n > 0 && <AlertTriangle className="mr-1 inline h-3.5 w-3.5 text-amber-700" aria-hidden="true" />}
              {t.label}
            </span>
            <span className="block text-2xl font-bold text-zinc-900 tabular-nums">{t.n}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-40 flex-1">
          <label htmlFor="gem-q" className="block text-sm font-medium text-zinc-800">
            ค้นหาชื่อ
          </label>
          <input id="gem-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="เช่น โกเมน 4×6" className={GEM_FIELD} />
        </div>
        <div>
          <label htmlFor="gem-ft" className="block text-sm font-medium text-zinc-800">
            ชนิด
          </label>
          <select id="gem-ft" value={typeId} onChange={(e) => setTypeId(e.target.value)} className={GEM_FIELD}>
            <option value="">ทั้งหมด</option>
            {types.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="gem-fs" className="block text-sm font-medium text-zinc-800">
            รูปทรง
          </label>
          <select id="gem-fs" value={shapeId} onChange={(e) => setShapeId(e.target.value)} className={GEM_FIELD}>
            <option value="">ทั้งหมด</option>
            {shapes.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <label className="flex min-h-11 items-center gap-2 text-sm text-zinc-900">
          <input type="checkbox" className="h-5 w-5 accent-primary-600" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          แสดงที่ปิดใช้งาน
        </label>
      </div>

      {rows.length === 0 ? (
        <div role="status" className="rounded-lg border border-dashed border-zinc-300 bg-white p-6 text-center text-sm text-zinc-800">
          <p>ไม่พบรายการที่ตรงกับตัวกรอง</p>
          {filtered && (
            <Button type="button" variant="secondary" size="sm" onClick={clear} className="mt-2">
              ล้างตัวกรอง
            </Button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
          <table className="w-full min-w-[760px] text-left text-sm" data-testid="gem-items-table">
            <caption className="sr-only">รายการพลอยในแคตตาล็อก พร้อมราคาต่อเม็ด (บาท)</caption>
            <thead>
              <tr className="border-b border-zinc-200 text-xs font-semibold text-zinc-700">
                <th scope="col" className="px-3 py-2">ชนิด</th>
                <th scope="col" className="px-3 py-2">รูปทรง</th>
                <th scope="col" className="px-3 py-2">ขนาด มม.</th>
                <th scope="col" className="px-3 py-2 text-right">ราคา/เม็ด (บาท)</th>
                <th scope="col" className="px-3 py-2">มีผลตั้งแต่</th>
                <th scope="col" className="px-3 py-2">ใช้ใน</th>
                <th scope="col" className="px-3 py-2 text-right">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((i, idx) => {
                const first = idx === 0 || rows[idx - 1].typeId !== i.typeId;
                const inactive = !i.isActive || i.mergedInto !== null;
                return (
                  <tr key={i.gemItemId} className={`border-b border-zinc-100 last:border-0 ${inactive ? "opacity-60" : ""}`} aria-label={i.label}>
                    <th scope="row" className="px-3 py-2 align-top font-medium text-zinc-900">
                      {first ? i.typeName : <span className="sr-only">{i.typeName}</span>}
                      {isRecentFromShop(i, todayBkk) && <span className="ml-1 rounded-sm bg-sky-100 px-1.5 py-0.5 text-xs font-medium text-sky-950">จากหน้างาน</span>}
                      {inactive && <span className="ml-1 text-xs font-normal text-zinc-700">({i.mergedInto !== null ? "ถูกรวมแล้ว" : "ปิดใช้งาน"})</span>}
                    </th>
                    <td className="px-3 py-2 text-zinc-900">{i.shapeName}</td>
                    <td className="px-3 py-2 tabular-nums text-zinc-900">{i.sizeLabel}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-zinc-900">
                      {i.hasPrice && i.price !== null ? (
                        fmtGemPrice(i.price)
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-sm bg-amber-100 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-amber-950">
                          <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                          ยังไม่มีราคา
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-zinc-900">{i.hasPrice ? thaiDate(i.priceEffectiveFrom) : "—"}</td>
                    <td className="px-3 py-2 text-zinc-900">
                      {i.usedJobsOpen} ใบงาน{i.usedTemplates > 0 ? ` · ${i.usedTemplates} แม่แบบ` : ""}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex gap-1">
                        <Button type="button" variant="secondary" size="sm" className="min-h-11" onClick={() => onSetPrice(i)} disabled={inactive} aria-label={`ตั้งราคา ${i.label}`}>
                          ตั้งราคา
                        </Button>
                        <Button type="button" variant="ghost" size="sm" className="min-h-11" onClick={() => onDetail(i)} aria-label={`รายละเอียด ${i.label}`}>
                          รายละเอียด
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-zinc-700" aria-live="polite">
        แสดง {rows.length} จาก {items.length} รายการ
      </p>
    </div>
  );
}
