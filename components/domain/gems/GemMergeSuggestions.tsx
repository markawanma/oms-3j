"use client";

// GemMergeSuggestions — "ข้อเสนอรวมชื่อ (ระบบเดา — ตรวจก่อนรวม)" — คู่ชื่อที่คล้ายกัน (ฟังก์ชันเดียวกับตัวดักหน้างาน) · UX §7.4
// ตาข่ายหลักของชื่อซ้ำ: ตัวดักจับได้ครึ่งเดียว (ไทย↔อังกฤษ/คำพ้องจับไม่ได้ — ยอมรับ) จึงต้องหาคู่ซ้ำให้ออฟฟิศง่าย · ซ่อนเมื่อไม่มีคู่

import { useMemo } from "react";
import { gemNameSimilar } from "@/lib/jobs/shop-gems";
import type { GemCatalogName } from "@/lib/jobs/gems";

export interface MergePair {
  a: GemCatalogName;
  b: GemCatalogName;
}

/** คู่ที่คล้ายกัน (O(n²) บนชื่อที่ใช้งานอยู่ — ชื่อหลักร้อยไม่หนัก) · เรียงตามที่ใช้น้อยก่อน; a = ตัวที่ใช้น้อยกว่า (ตัวที่ควรเลิกใช้) */
export function mergePairs(names: readonly GemCatalogName[], limit = 20): MergePair[] {
  const out: MergePair[] = [];
  const use = (n: GemCatalogName) => n.usedJobsOpen + n.usedTemplates + n.itemCount;
  for (let i = 0; i < names.length && out.length < limit; i++) {
    for (let j = i + 1; j < names.length && out.length < limit; j++) {
      if (!gemNameSimilar(names[i].name, names[j].name)) continue;
      const [a, b] = use(names[i]) <= use(names[j]) ? [names[i], names[j]] : [names[j], names[i]];
      out.push({ a, b });
    }
  }
  return out;
}

export function GemMergeSuggestions({ kind, names, onMerge }: { kind: "type" | "shape"; names: GemCatalogName[]; onMerge: (from: GemCatalogName, into: GemCatalogName) => void }) {
  const pairs = useMemo(() => mergePairs(names), [names]);
  if (pairs.length === 0) return null;
  return (
    <details open className="rounded-lg border border-amber-300 bg-amber-50 p-3" data-testid="gem-merge-suggestions">
      <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-amber-950">
        ข้อเสนอรวมชื่อ ({pairs.length}) — ระบบเดา ตรวจก่อนรวม
      </summary>
      <ul className="space-y-1">
        {pairs.map(({ a, b }) => (
          <li key={`${a.id}-${b.id}`} className="flex flex-wrap items-center gap-2 text-sm text-amber-950">
            <span className="break-words">
              “{a.name}” ↔ “{b.name}”
            </span>
            <span className="text-xs text-zinc-800">
              ใช้ {a.usedJobsOpen} / {b.usedJobsOpen} ใบงาน
            </span>
            <button
              type="button"
              onClick={() => onMerge(a, b)}
              aria-label={`รวมชื่อ ${a.name} เข้ากับ ${b.name} (${kind === "type" ? "ชนิด" : "รูปทรง"})`}
              className="ml-auto min-h-11 rounded-md border border-amber-400 bg-white px-3 font-medium hover:bg-amber-100"
            >
              รวมชื่อ…
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
