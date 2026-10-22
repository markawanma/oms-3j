"use client";

// WorkerGemsCard — การ์ด "พลอยที่ต้องใช้" บนหน้าช่าง /w/<token> (สาธารณะ · มือถือ 360px) — UX §8.1
//  ขั้นฝังพลอย (ช่างที่ถืออยู่/กำลังจะรับ) = กางเต็ม: ชื่อ 18 หนา · "รวม" ตัวเลขใหญ่ 28 หนา ชิดขวา (ช่างนับพลอยออกจากกล่องตามยอดรวม) · /ชิ้นเป็นตัวรอง · ตำแหน่งเป็นบรรทัดล่าง
//  ขั้นอื่น = พับเป็นปุ่มบรรทัดเดียว 56px (aria-expanded) — ไม่ต้องอ่านทั้งรายการ แต่เปิดดูได้
//  ยังไม่ระบุพลอย (มีขั้นฝังแต่ไม่มีรายการ) = กล่อง amber เตือน "ถามออฟฟิศก่อนฝัง" เฉพาะขั้นฝัง (ขั้นอื่นไม่แสดง) — ไม่บล็อกการรับงาน (มติเจ้าของ 22 ต.ค.)
//  ใบไม่มีขั้นฝังและไม่มีพลอย / อ่านพลอยไม่ได้ (specified แต่แถวผิดรูปหมด) = ไม่ render อะไรเลย · ไม่บล็อกขั้นอื่น
// 🔴 รับเฉพาะ WorkerGem {label, qtyPerPiece, qtyTotal, position} — ไม่มีเงิน/เผื่อแตก/ผู้ขาย/รหัสรายการ · ชั้นแสดงผลล้วน ไม่เรียก action ใดๆ (worker-boundary)
// ตัวเลขรวมมาจาก DB (qtyTotal = ต่อชิ้น × จำนวนเริ่มผลิต) — การ์ดนี้บวกยอดรวมทั้งใบ (จำนวนเต็ม) เท่านั้น ไม่คูณเอง

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { WorkerGem } from "@/lib/jobs/worker-view";

const fmt = (n: number) => n.toLocaleString("en-US");

/** aria-label ต่อแถวให้ screen reader อ่านครบ เช่น "โกเมน, ไข่, 4 คูณ 6 มิลลิเมตร — 2 เม็ดต่อชิ้น รวม 70 เม็ด · บ่าซ้าย-ขวา" */
export function gemAriaLabel(g: WorkerGem): string {
  const name = g.label.replace(/\s*·\s*/g, ", ").replace(/×/g, " คูณ ").replace(/\s*มม\.$/, " มิลลิเมตร");
  return `${name} — ${g.qtyPerPiece} เม็ดต่อชิ้น รวม ${fmt(g.qtyTotal)} เม็ด${g.position ? ` · ${g.position}` : ""}`;
}

export function WorkerGemsCard({ state, gems, onGemStage }: { state: "specified" | "unspecified"; gems: WorkerGem[]; onGemStage: boolean }) {
  const [open, setOpen] = useState(false);

  if (state === "unspecified") {
    // เตือน "ถามออฟฟิศก่อนฝัง" เฉพาะช่างที่กำลังจะ/ถืออยู่ขั้นฝัง — ช่างขั้นอื่น (หล่อ/ขัด) ไม่เกี่ยวกับพลอย ไม่ต้องเห็นกล่องเหลือง
    if (!onGemStage) return null;
    return (
      <p role="status" data-testid="worker-gems-unspecified" className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3 text-lg font-semibold text-amber-950">
        ⚠ ใบนี้ยังไม่ระบุพลอย — ถามออฟฟิศก่อนฝัง
      </p>
    );
  }
  if (gems.length === 0) return null;

  const total = gems.reduce((s, g) => s + g.qtyTotal, 0);
  const list = (
    <ul className="divide-y divide-zinc-200" data-testid="worker-gems-list">
      {gems.map((g, i) => (
        <li key={`${g.label}-${i}`} aria-label={gemAriaLabel(g)} className="flex items-start justify-between gap-3 py-2">
          <div className="min-w-0">
            <p className="text-lg font-bold break-words [overflow-wrap:anywhere] text-zinc-900">{g.label}</p>
            <p className="text-base text-zinc-800 break-words [overflow-wrap:anywhere]">
              {fmt(g.qtyPerPiece)} เม็ด/ชิ้น{g.position ? ` · ${g.position}` : ""}
            </p>
          </div>
          <p className="shrink-0 text-right">
            <span className="block text-[28px] leading-none font-extrabold text-zinc-900 tabular-nums whitespace-nowrap">{fmt(g.qtyTotal)}</span>
            <span className="block text-base text-zinc-800">เม็ด</span>
          </p>
        </li>
      ))}
    </ul>
  );

  if (onGemStage) {
    return (
      <section aria-labelledby="worker-gems-h" data-testid="worker-gems-card" className="rounded-xl border-2 border-zinc-900 bg-white p-3">
        <h2 id="worker-gems-h" className="text-lg font-bold text-zinc-900">
          พลอยที่ต้องใช้ · {gems.length} รายการ
        </h2>
        {list}
        <p className="mt-1 border-t-2 border-zinc-900 pt-2 text-lg font-bold text-zinc-900 tabular-nums" data-testid="worker-gems-total">
          รวมพลอยทั้งใบ {fmt(total)} เม็ด
        </p>
      </section>
    );
  }

  return (
    <section aria-label="พลอยที่ต้องใช้" data-testid="worker-gems-card" className="rounded-xl border border-zinc-300 bg-white">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="worker-gems-folded"
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-14 w-full items-center justify-between gap-2 rounded-xl px-3 text-left text-lg font-semibold text-zinc-900"
      >
        <span className="tabular-nums">
          พลอย {gems.length} รายการ · รวม {fmt(total)} เม็ด
        </span>
        <ChevronDown className={`h-5 w-5 shrink-0 ${open ? "rotate-180" : ""} motion-safe:transition-transform`} aria-hidden="true" />
      </button>
      <div id="worker-gems-folded" hidden={!open} className="px-3 pb-2">
        {open && list}
      </div>
    </section>
  );
}
