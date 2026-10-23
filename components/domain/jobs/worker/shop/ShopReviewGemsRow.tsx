"use client";

// ShopReviewGemsRow — แถว "พลอย" ในหน้าทวน W-6/7 (UX §4.1) · วางหลังแถว "จำนวนผลิต"
//  มีพลอย: "{n} รายการ · รวม {m} เม็ด" + ทุกแถว (≤ 8 แถวแล้วพับ "ดูทั้งหมด") · ไม่มีพลอย: "ไม่มี" · มีชื่อใหม่: บอกว่าชื่อจะเข้ารายการพลอยของร้านเมื่อเปิดงาน
//  ตัวเลขรวม = จำนวนเต็ม × จำนวนเต็ม (DB คำนวณซ้ำและชนะ) · 🔴 ไม่มีเงิน/ราคา

import { useState } from "react";
import { SHOP_GEM_TH, gemLineText, gemReviewOf } from "@/lib/jobs/shop-gem-flow";
import { plannedQtyOf } from "@/lib/jobs/shop-open";
import type { ShopForm } from "@/lib/jobs/shop-open";

const SHOW_FIRST = 8;
const ROW = "flex items-start gap-3";
const DT = "w-24 shrink-0 pt-0.5 text-base font-semibold text-zinc-700";
const DD = "min-w-0 flex-1 text-lg font-semibold break-words text-zinc-900";

export function ShopReviewGemsRow({ form, onEdit, disabled }: { form: ShopForm; onEdit: () => void; disabled?: boolean }) {
  const [all, setAll] = useState(false);
  const v = gemReviewOf(form.gems, plannedQtyOf(form).qty);
  const shown = all ? v.lines : v.lines.slice(0, SHOW_FIRST);
  return (
    <div className={ROW} data-testid="shop-review-gems">
      <p className={DT}>{SHOP_GEM_TH.title}</p>
      <div className="min-w-0 flex-1 space-y-1">
        {v.state === "none" && <p className={DD}>{SHOP_GEM_TH.reviewNone}</p>}
        {v.state === "unset" && <p className="text-lg font-semibold text-amber-900">ยังไม่ได้เลือก</p>}
        {v.state === "has" && (
          <>
            <p className={DD}>
              {v.count.toLocaleString("en-US")} รายการ{v.total !== null ? ` · รวม ${v.total.toLocaleString("en-US")} เม็ด` : ""}
            </p>
            <ul className="space-y-1">
              {shown.map((l) => (
                <li key={l.key} className="flex items-start justify-between gap-2 text-base text-zinc-800">
                  <span className="min-w-0 break-words [overflow-wrap:anywhere]">{l.label}</span>
                  <span className="shrink-0 tabular-nums">{gemLineText(l)}</span>
                </li>
              ))}
            </ul>
            {v.lines.length > SHOW_FIRST && (
              <button type="button" onClick={() => setAll((x) => !x)} aria-expanded={all} className="min-h-11 rounded-lg px-1 text-base font-semibold text-primary-800 underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-300">
                {all ? "ย่อรายการ" : `ดูทั้งหมด (${v.lines.length})`}
              </button>
            )}
            {v.hasNewNames && <p className="text-base text-zinc-700">{SHOP_GEM_TH.reviewNewNames}</p>}
          </>
        )}
      </div>
      <button type="button" onClick={onEdit} disabled={disabled} aria-label="แก้พลอย" className="min-h-11 shrink-0 rounded-lg px-3 text-lg font-semibold text-primary-800 underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-300 disabled:opacity-40">
        {SHOP_GEM_TH.edit}
      </button>
    </div>
  );
}
