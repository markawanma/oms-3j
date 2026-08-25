"use client";

// MetalPriceSection — /oem/rates: ราคาโลหะ 3 ชนิด (บาท/กรัม), แยกจาก
// oem_cost_rate (ไม่มี effective-dated scope เดียวกัน — append-only ตามวัน,
// oem_price_calc อ่านค่าล่าสุด ณ as_of_date). เซฟทีละช่องตอน blur เหมือน RateCell.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { saveMetalPrice } from "@/lib/actions/oem";
import type { OemMetalPriceMap, OemProductionMetal } from "@/lib/oem/types";
import { OEM_METAL_LABEL_TH } from "@/lib/oem/types";
import { formatThaiDateOnly } from "@/lib/tiktok/format";
import { useToast } from "@/components/ui/Toast";

// silver999 (เงินแท่ง) deliberately excluded — its price comes from
// silver_price_daily (fixed sell price per size), not a per-gram spot rate
// an admin types in here. See OemProductionMetal's comment in lib/oem/types.ts.
const METALS: OemProductionMetal[] = ["silver", "gold", "brass"];

function MetalPriceCell({ metal, current }: { metal: OemProductionMetal; current: OemMetalPriceMap[OemProductionMetal] }) {
  const toast = useToast();
  const router = useRouter();
  const [value, setValue] = useState(current ? String(current.priceThbPerGram) : "");
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    setValue(current ? String(current.priceThbPerGram) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.priceThbPerGram, current?.asOfDate]);

  async function commit() {
    const trimmed = value.trim();
    if (trimmed === "") return;
    const raw = Number(trimmed);
    if (!Number.isFinite(raw) || raw <= 0) {
      toast.push("ราคาต้องมากกว่า 0", "error");
      setValue(current ? String(current.priceThbPerGram) : "");
      return;
    }
    if (current && Math.abs(raw - current.priceThbPerGram) < 1e-9) return;

    setSaving(true);
    const result = await saveMetalPrice({ metal, priceThbPerGram: raw });
    setSaving(false);
    if (!result.ok) {
      toast.push(result.error, "error");
      setValue(current ? String(current.priceThbPerGram) : "");
      return;
    }
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 1500);
    router.refresh();
  }

  return (
    <div className="rounded-md border border-zinc-200 p-3">
      <p className="text-xs font-semibold text-zinc-600">{OEM_METAL_LABEL_TH[metal]}</p>
      <div className="mt-1.5 flex items-center gap-1.5">
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step="0.0001"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
          }}
          placeholder="ยังไม่ตั้งราคา"
          className="min-h-11 w-full rounded-md border border-zinc-300 px-2.5 text-sm text-zinc-900 tabular-nums placeholder:text-zinc-400"
        />
        <span className="shrink-0 text-xs text-zinc-500">บาท/กรัม</span>
        {saving && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-zinc-400" aria-hidden="true" />}
        {!saving && justSaved && <Check className="h-3.5 w-3.5 shrink-0 text-green-600" aria-hidden="true" />}
      </div>
      {current && <p className="mt-1 text-[0.68rem] text-zinc-400">ณ {formatThaiDateOnly(current.asOfDate)}</p>}
    </div>
  );
}

export function MetalPriceSection({ prices }: { prices: OemMetalPriceMap }) {
  return (
    <section id="oem-metal-price" className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
      <h2 className="text-sm font-bold text-zinc-800">ราคาโลหะ (บาท/กรัม)</h2>
      <p className="mt-0.5 text-xs text-zinc-500">
        ใช้คำนวณต้นทุนเนื้อโลหะต่อชิ้น — บันทึกใหม่ทุกวันที่ราคาขยับ (เก็บประวัติไว้ ไม่ทับของเดิม)
      </p>
      <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        {METALS.map((m) => (
          <MetalPriceCell key={m} metal={m} current={prices[m]} />
        ))}
      </div>
    </section>
  );
}
