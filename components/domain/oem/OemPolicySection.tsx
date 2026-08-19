"use client";

// OemPolicySection — /oem/rates: margin tiers (target/discount cap/floor/hard
// floor), NRE max share, มูลค่างานขั้นต่ำ, อายุใบเสนอราคา 3 วัสดุ. Saved as one
// atomic submit (unlike RateCell/MetalPriceCell's per-field autosave) because
// the four margin numbers are only meaningful together (DB enforces
// hard_floor <= floor <= discount_cap <= target — see 0061 §3 comment).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveOemSetting } from "@/lib/actions/oem";
import type { OemSettingData } from "@/lib/oem/types";
import { roundTo } from "@/lib/oem/display";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

const inputCls = "min-h-11 rounded-md border border-zinc-300 px-2.5 text-sm text-zinc-900 tabular-nums";
const labelCls = "flex flex-col gap-1 text-xs font-semibold text-zinc-600";

export function OemPolicySection({ setting }: { setting: OemSettingData }) {
  const router = useRouter();
  const toast = useToast();
  const [target, setTarget] = useState(String(roundTo(setting.marginTargetPct * 100, 2)));
  const [cap, setCap] = useState(String(roundTo(setting.marginDiscountCapPct * 100, 2)));
  const [floor, setFloor] = useState(String(roundTo(setting.marginFloorPct * 100, 2)));
  const [hardFloor, setHardFloor] = useState(String(roundTo(setting.marginHardFloorPct * 100, 2)));
  const [nreShare, setNreShare] = useState(String(roundTo(setting.nreMaxSharePct * 100, 2)));
  const [minJob, setMinJob] = useState(String(setting.minJobValueThb));
  const [validSilver, setValidSilver] = useState(String(setting.quoteValidDaysSilver));
  const [validGold, setValidGold] = useState(String(setting.quoteValidDaysGold));
  const [validBrass, setValidBrass] = useState(String(setting.quoteValidDaysBrass));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const t = Number(target) / 100;
    const c = Number(cap) / 100;
    const f = Number(floor) / 100;
    const h = Number(hardFloor) / 100;
    const n = Number(nreShare) / 100;
    for (const [label, v] of [
      ["margin เป้าหมาย", t],
      ["เพดานส่วนลด", c],
      ["floor margin", f],
      ["hard floor", h],
      ["NRE max share", n],
    ] as const) {
      if (!Number.isFinite(v) || v < 0 || v >= 1) return setError(`${label} ต้องอยู่ระหว่าง 0–100% (ไม่รวมขอบ)`);
    }
    if (!(h <= f && f <= c && c <= t)) return setError("ต้องเรียง: hard floor ≤ floor ≤ เพดานส่วนลด ≤ เป้าหมาย");

    const mj = Number(minJob);
    const vs = Number(validSilver);
    const vg = Number(validGold);
    const vb = Number(validBrass);
    if (!Number.isFinite(mj) || mj <= 0) return setError("มูลค่างานขั้นต่ำต้องมากกว่า 0");
    if (!Number.isFinite(vs) || vs <= 0) return setError("อายุใบเสนอราคา (เงิน) ต้องมากกว่า 0 วัน");
    if (!Number.isFinite(vg) || vg <= 0) return setError("อายุใบเสนอราคา (ทอง) ต้องมากกว่า 0 วัน");
    if (!Number.isFinite(vb) || vb <= 0) return setError("อายุใบเสนอราคา (ทองเหลือง) ต้องมากกว่า 0 วัน");

    startTransition(async () => {
      const result = await saveOemSetting({
        marginTargetPct: t,
        marginDiscountCapPct: c,
        marginFloorPct: f,
        marginHardFloorPct: h,
        nreMaxSharePct: n,
        minJobValueThb: mj,
        quoteValidDaysSilver: vs,
        quoteValidDaysGold: vg,
        quoteValidDaysBrass: vb,
      });
      if (!result.ok) {
        setError(result.error);
        toast.push(result.error, "error");
        return;
      }
      toast.push("บันทึกนโยบายแล้ว");
      router.refresh();
    });
  }

  return (
    <form id="oem-policy" onSubmit={handleSubmit} className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
      <h2 className="text-sm font-bold text-zinc-800">นโยบายมาร์จิ้น &amp; floor</h2>
      <p className="mt-0.5 text-xs text-zinc-500">
        4 ระดับต้องเรียงจากน้อยไปมาก: hard floor ≤ floor ≤ เพดานส่วนลด ≤ เป้าหมาย
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <label className={labelCls}>
          เป้าหมาย (%)
          <input type="number" inputMode="decimal" min={0} max={99.99} step="0.1" value={target} onChange={(e) => setTarget(e.target.value)} className={inputCls} required />
        </label>
        <label className={labelCls}>
          เพดานส่วนลด (%)
          <input type="number" inputMode="decimal" min={0} max={99.99} step="0.1" value={cap} onChange={(e) => setCap(e.target.value)} className={inputCls} required />
        </label>
        <label className={labelCls}>
          floor (%)
          <input type="number" inputMode="decimal" min={0} max={99.99} step="0.1" value={floor} onChange={(e) => setFloor(e.target.value)} className={inputCls} required />
        </label>
        <label className={labelCls}>
          hard floor (%)
          <input type="number" inputMode="decimal" min={0} max={99.99} step="0.1" value={hardFloor} onChange={(e) => setHardFloor(e.target.value)} className={inputCls} required />
        </label>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        <label className={labelCls}>
          NRE ไม่เกินกี่ % ของมูลค่างาน
          <input type="number" inputMode="decimal" min={0} max={99.99} step="1" value={nreShare} onChange={(e) => setNreShare(e.target.value)} className={inputCls} required />
        </label>
        <label className={labelCls}>
          มูลค่างานขั้นต่ำ (บาท)
          <input type="number" inputMode="decimal" min={0} step="100" value={minJob} onChange={(e) => setMinJob(e.target.value)} className={inputCls} required />
        </label>
      </div>

      <p className="mt-4 text-xs font-semibold text-zinc-600">อายุใบเสนอราคา (วัน)</p>
      <div className="mt-1.5 grid grid-cols-3 gap-2.5">
        <label className={labelCls}>
          เงิน 925
          <input type="number" inputMode="numeric" min={1} step="1" value={validSilver} onChange={(e) => setValidSilver(e.target.value)} className={inputCls} required />
        </label>
        <label className={labelCls}>
          ทอง
          <input type="number" inputMode="numeric" min={1} step="1" value={validGold} onChange={(e) => setValidGold(e.target.value)} className={inputCls} required />
        </label>
        <label className={labelCls}>
          ทองเหลือง
          <input type="number" inputMode="numeric" min={1} step="1" value={validBrass} onChange={(e) => setValidBrass(e.target.value)} className={inputCls} required />
        </label>
      </div>

      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

      <div className="mt-3.5 flex justify-end">
        <Button type="submit" variant="primary" size="sm" loading={pending}>
          บันทึกนโยบาย
        </Button>
      </div>
    </form>
  );
}
