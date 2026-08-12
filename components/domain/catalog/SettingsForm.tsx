"use client";

// SettingsForm — /settings pricing & margin (docs/3j-jewelry/analytics/phase-
// c1-sku-cost-margin.md §3.2): silver spot price, blended margin (with a
// suggestion computed from active SKUs), and the ROAS target (ad-share-of-
// gross-profit). Shows the resulting break-even / target ROAS live so the
// owner sees the effect of the numbers they type before saving.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { upsertShopSetting } from "@/lib/actions/catalog";
import type { BlendedMarginSuggestion, ShopSettingData } from "@/lib/catalog/types";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

function roundTo(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

export function SettingsForm({
  setting,
  suggestion,
}: {
  setting: ShopSettingData;
  suggestion: BlendedMarginSuggestion;
}) {
  const router = useRouter();
  const toast = useToast();

  const [spot, setSpot] = useState(setting.silverSpotThbPerGram != null ? String(setting.silverSpotThbPerGram) : "");
  // margin/adShare edited as whole-number percents for a friendlier UX.
  const [marginPct, setMarginPct] = useState(String(roundTo(setting.blendedMarginPct * 100, 2)));
  const [adSharePct, setAdSharePct] = useState(String(roundTo(setting.targetAdGpShare * 100, 2)));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const derived = useMemo(() => {
    const m = Number(marginPct) / 100;
    const s = Number(adSharePct) / 100;
    const validM = Number.isFinite(m) && m > 0 && m < 1;
    const validS = Number.isFinite(s) && s > 0 && s <= 1;
    return {
      breakEven: validM ? roundTo(1 / m, 2) : null,
      target: validM && validS ? roundTo(1 / (m * s), 2) : null,
    };
  }, [marginPct, adSharePct]);

  const suggestionPct = suggestion.suggestedMarginPct != null ? roundTo(suggestion.suggestedMarginPct * 100, 1) : null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const m = Number(marginPct) / 100;
    const s = Number(adSharePct) / 100;
    if (!Number.isFinite(m) || m <= 0 || m >= 1) return setError("มาร์จิ้นเฉลี่ยต้องอยู่ระหว่าง 0–100% (ไม่รวมขอบ)");
    if (!Number.isFinite(s) || s <= 0 || s > 1) return setError("สัดส่วนแอด/กำไรต้องอยู่ระหว่าง 0–100%");
    const spotNum = spot.trim() ? Number(spot) : null;
    if (spotNum != null && (!Number.isFinite(spotNum) || spotNum < 0)) {
      return setError("ราคาเงินสปอตต้องเป็นค่าตั้งแต่ 0 ขึ้นไป");
    }

    startTransition(async () => {
      const result = await upsertShopSetting({
        silverSpotThbPerGram: spotNum,
        blendedMarginPct: m,
        targetAdGpShare: s,
      });
      if (!result.ok) {
        setError(result.error);
        toast.push(result.error, "error");
        return;
      }
      toast.push("บันทึกการตั้งค่าแล้ว");
      router.refresh();
    });
  }

  const inputCls = "min-h-11 rounded-md border border-zinc-300 px-2.5 text-sm text-zinc-900";
  const labelCls = "flex flex-col gap-1 text-xs font-semibold text-zinc-600";

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* silver spot */}
      <section className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
        <h2 className="text-sm font-bold text-zinc-800">ราคาเงินสปอต</h2>
        <p className="mt-0.5 text-xs text-zinc-500">
          ใช้คำนวณต้นทุน SKU แบบอิงราคาเงิน (เงินแท่ง) = น้ำหนัก × ราคานี้ × ความบริสุทธิ์ + ค่ากำเหน็จ
        </p>
        <label className={`${labelCls} mt-3 max-w-[16rem]`}>
          ราคาเงิน (บาท/กรัม)
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.0001"
            value={spot}
            onChange={(e) => setSpot(e.target.value)}
            placeholder="เช่น 28.50"
            className={inputCls}
          />
        </label>
        {setting.silverSpotUpdatedAt && (
          <p className="mt-1.5 text-xs text-zinc-400">
            อัปเดตล่าสุด {new Date(setting.silverSpotUpdatedAt).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })}
          </p>
        )}
      </section>

      {/* blended margin */}
      <section className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
        <h2 className="text-sm font-bold text-zinc-800">มาร์จิ้นเฉลี่ย (blended margin)</h2>
        <p className="mt-0.5 text-xs text-zinc-500">
          ใช้ประมาณกำไรต่อออเดอร์และ ROAS (ทุกออเดอร์ยังไม่ผูก SKU จึงใช้ค่าเฉลี่ยรวมทั้งร้านไปก่อน)
        </p>
        <label className={`${labelCls} mt-3 max-w-[16rem]`}>
          มาร์จิ้นเฉลี่ย (%)
          <input
            type="number"
            inputMode="decimal"
            min={0}
            max={100}
            step="0.1"
            value={marginPct}
            onChange={(e) => setMarginPct(e.target.value)}
            className={inputCls}
            required
          />
        </label>
        {suggestionPct != null ? (
          <button
            type="button"
            onClick={() => setMarginPct(String(suggestionPct))}
            className="mt-2 text-xs font-medium text-primary-700 hover:underline"
          >
            แนะนำจากสินค้า {suggestion.productsWithMargin} รายการ: {suggestionPct}% (กดเพื่อใช้)
          </button>
        ) : (
          <p className="mt-2 text-xs text-zinc-400">
            (ยังไม่มีสินค้าที่กรอกต้นทุน+ราคาตั้งครบ จึงยังไม่มีค่าแนะนำ — เพิ่มที่หน้า “สินค้า / ต้นทุน”)
          </p>
        )}
      </section>

      {/* ROAS target */}
      <section className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
        <h2 className="text-sm font-bold text-zinc-800">เป้า ROAS</h2>
        <p className="mt-0.5 text-xs text-zinc-500">
          คุมไม่ให้ค่าแอดเกินสัดส่วนของกำไรขั้นต้น — เป้า ROAS = 1 ÷ (มาร์จิ้น × สัดส่วนแอด/กำไร)
        </p>
        <label className={`${labelCls} mt-3 max-w-[16rem]`}>
          สัดส่วนค่าแอดต่อกำไรขั้นต้นสูงสุด (%)
          <input
            type="number"
            inputMode="decimal"
            min={0}
            max={100}
            step="1"
            value={adSharePct}
            onChange={(e) => setAdSharePct(e.target.value)}
            className={inputCls}
            required
          />
        </label>
        <div className="mt-3 grid grid-cols-2 gap-2.5">
          <div className="rounded-md bg-zinc-50 px-3 py-2">
            <div className="text-xs text-zinc-500">จุดคุ้มทุน (break-even)</div>
            <div className="text-lg font-bold tabular-nums text-zinc-800">{derived.breakEven ?? "—"}</div>
          </div>
          <div className="rounded-md bg-primary-50 px-3 py-2">
            <div className="text-xs text-primary-700">เป้า ROAS ที่ควรทำ</div>
            <div className="text-lg font-bold tabular-nums text-primary-700">{derived.target ?? "—"}</div>
          </div>
        </div>
        <p className="mt-2 text-xs text-zinc-400">
          หมายถึง ทุกค่าแอด 1 บาท ควรได้ยอดขายกลับมาอย่างน้อย {derived.target ?? "—"} บาท ถึงจะคุ้มตามเป้า
        </p>
      </section>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="flex justify-end">
        <Button type="submit" variant="primary" loading={pending}>
          บันทึกการตั้งค่า
        </Button>
      </div>
    </form>
  );
}
