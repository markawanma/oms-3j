"use client";

// GemCostCell / GemCostTotals — แสดงต้นทุนประมาณ (เฉพาะเมื่อสวิตช์เปิด) · 🔴 แสดงเลขที่ DB ส่งมาตรงๆ ไม่บวก/คูณเอง
//  - ยังไม่มีราคา = chip amber + ⚠ + ลิงก์ตั้งราคา (ไม่ใช่ 0 ไม่ใช่ "—") · ลิงก์เปิดแท็บใหม่ (หน้านี้มีสถานะ เลือก/กาง ที่ไม่อยากทิ้ง)
//  - ต้นทุนของแถว = ส่วนที่ "ยังไม่สั่ง" (cost_remaining) — ต้นทุนต่อแถวไม่ตรงกับยอดที่แสดงอยู่ (qty ไม่ตรง) = ไม่แสดงเลข (ข้อมูลสองชุดมาต่างเวลา)

import { AlertTriangle } from "lucide-react";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatThb } from "@/components/domain/jobs/gems-to-buy/useGemCost";
import type { GemCostState } from "@/components/domain/jobs/gems-to-buy/useGemCost";
import type { GtbRow } from "@/lib/jobs/gems-to-buy";

export const GEM_PRICE_SETUP_HREF = "/oem/gems";

export function MissingPriceChip() {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="inline-flex items-center gap-1 rounded-sm bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-950">
        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
        ยังไม่มีราคา
      </span>
      <a href={GEM_PRICE_SETUP_HREF} target="_blank" rel="noopener" className="text-xs font-semibold text-primary-700 underline underline-offset-2">
        ตั้งราคา ↗<span className="sr-only"> (เปิดแท็บใหม่)</span>
      </a>
    </span>
  );
}

export function GemCostCell({ cost, row }: { cost: GemCostState; row: GtbRow }) {
  if (cost.status === "off") return null;
  if (cost.status === "loading") {
    return (
      <span role="status" aria-label="กำลังคำนวณต้นทุน">
        <Skeleton className="h-5 w-20" />
      </span>
    );
  }
  if (cost.status === "error") return <span className="text-sm font-medium text-red-800">โหลดไม่ได้</span>;
  const g = cost.byItem.get(row.group.canonicalItemId);
  if (!g) return <span className="text-sm font-medium text-red-800">โหลดไม่ได้</span>;
  if (g.qtyRemaining !== row.qty) return <span className="text-sm text-zinc-700">ต้นทุนยังไม่อัปเดต — กดรีเฟรช</span>;
  if (g.costRemainingThb === null) return <MissingPriceChip />;
  return <span className="whitespace-nowrap text-sm font-semibold tabular-nums text-zinc-900">{formatThb(g.costRemainingThb)} ฿</span>;
}

/** สรุปท้ายรายการ — ยอดรวม = totals.costRemainingThb ของ DB (นับทุกรายการที่ยังไม่สั่ง ไม่ตามตัวกรอง) */
export function GemCostTotals({ cost, rowCount, filtered }: { cost: GemCostState; rowCount: number; filtered: boolean }) {
  if (cost.status !== "ready" || rowCount === 0) return null;
  const missing = cost.missingRemainingCount;
  const noneHavePrice = missing > 0 && missing >= rowCount;
  return (
    <div className="space-y-1 rounded-md border border-zinc-200 bg-white p-3 text-sm" data-testid="gem-cost-totals">
      {noneHavePrice ? (
        <p className="font-semibold text-zinc-900">ต้นทุนประมาณ: ยังไม่มีราคาสักรายการ</p>
      ) : (
        <p className="font-semibold text-zinc-900">
          {missing > 0 ? "ต้นทุนประมาณ (เฉพาะรายการที่มีราคา)" : "ต้นทุนประมาณรวม (ส่วนที่ยังไม่สั่ง)"}{" "}
          <span className="whitespace-nowrap tabular-nums">{formatThb(cost.totalRemainingThb)} ฿</span>
        </p>
      )}
      {missing > 0 && (
        <p role="status" className="flex items-center gap-1 font-medium text-amber-950">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          ไม่รวม {missing} จาก {rowCount} รายการที่ยังไม่มีราคา
        </p>
      )}
      {filtered && <p className="text-xs text-zinc-700">ยอดนี้นับทุกรายการที่ยังไม่สั่ง ไม่ตามตัวกรองที่เลือก</p>}
    </div>
  );
}
