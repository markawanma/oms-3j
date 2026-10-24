"use client";

// useGemCost — ต้นทุนประมาณของหน้า "พลอยที่ต้องสั่งซื้อ" (owner/admin · ux-gems-to-buy.md §4.7)
// 🔴 ไฟล์เดียวของหน้านี้ที่เรียก getGemPurchaseCost — เรียก "เฉพาะเมื่อ enabled" (สวิตช์เปิด) · หน้า server ไม่ prefetch → ตอนสวิตช์ปิด HTML/RSC ไม่มีเลขราคา
// 🔴 ไม่คิดเลขเงินใน client: เลขต่อแถวและยอดรวมคือค่าที่ DB ส่ง (ปัดสตางค์แล้ว) แสดงตรงๆ · ที่นับเองมีแค่ "จำนวนแถวที่ยังไม่มีราคา" (นับจำนวน ไม่ใช่เงิน)
// ราคา null = "ยังไม่มีราคา" (ไม่ใช่ 0) · โหลดซ้ำเมื่อข้อมูลหน้าเปลี่ยน (dataStamp) — ระหว่างโหลดไม่แสดงเลขเก่า

import { useCallback, useEffect, useState } from "react";
import { getGemPurchaseCost } from "@/lib/actions/gems";
import type { GemPurchaseCostGroup } from "@/lib/jobs/gem-purchase";

export type GemCostState =
  | { status: "off" }
  | { status: "loading" }
  | { status: "error" }
  | {
      status: "ready";
      byItem: ReadonlyMap<string, GemPurchaseCostGroup>;
      /** totals.costRemainingThb ของ DB (ผลรวมกลุ่มที่ราคาครบ — ไม่นับกลุ่ม null) */
      totalRemainingThb: number;
      /** จำนวนกลุ่มที่ส่วน "ยังไม่สั่ง" ยังไม่มีราคา (นับจำนวน) */
      missingRemainingCount: number;
    };

export const OFF: GemCostState = { status: "off" };
const LOADING: GemCostState = { status: "loading" };

/** จัดรูปเลขบาทที่ DB ส่งมา (แสดงผลเท่านั้น — ไม่คำนวณ) */
export const formatThb = (n: number): string => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function useGemCost(enabled: boolean, dataStamp: string): { state: GemCostState; retry: () => void } {
  const [internal, setInternal] = useState<GemCostState>(LOADING);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    // ปิดสวิตช์ = ทิ้งเลขเก่าทันที (เปิดใหม่ต้องไม่โผล่เลขของรอบก่อนระหว่างรอ) · LOADING เป็นค่าคงที่ตัวเดียว ไม่ re-render ถ้าเป็นอยู่แล้ว
    if (!enabled) {
      setInternal(LOADING);
      return;
    }
    let cancelled = false;
    setInternal(LOADING);
    (async () => {
      try {
        const res = await getGemPurchaseCost();
        if (cancelled) return;
        if (!res.ok) {
          setInternal({ status: "error" });
          return;
        }
        const byItem = new Map(res.data.groups.map((g) => [g.canonicalItemId, g] as const));
        setInternal({
          status: "ready",
          byItem,
          totalRemainingThb: res.data.totals.costRemainingThb,
          missingRemainingCount: res.data.groups.filter((g) => g.missingPriceRemaining).length,
        });
      } catch {
        if (!cancelled) setInternal({ status: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, dataStamp, nonce]);

  const retry = useCallback(() => setNonce((n) => n + 1), []);
  return { state: enabled ? internal : OFF, retry };
}
