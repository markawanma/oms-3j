"use client";

// QuoteJobItemCard — one collapsible line item inside the OEM quote composer
// (/oem/quote, T5v2). Owns only its own JobForm fields; every price/margin
// number shown comes from the calc the parent (QuoteCalculatorClient) already
// fetched via calcPrice() — no arithmetic here.

import { ChevronDown, ChevronUp, Loader2, Trash2 } from "lucide-react";
import type { OemMetal, OemPriceCalcResult } from "@/lib/oem/types";
import { OEM_METAL_LABEL_TH } from "@/lib/oem/types";
import type { JobForm } from "@/lib/oem/quoteForm";
import { OEM_DEFAULT_PURITY } from "@/lib/oem/quoteForm";
import { OEM_GEM_TIER_OPTIONS, OEM_ITEM_KIND_OPTIONS, OEM_PLATING_OPTIONS, OEM_POLISH_TIER_OPTIONS } from "@/lib/oem/display";
import { formatTHB } from "@/lib/format";
import { OemCalcBreakdown } from "./OemCalcBreakdown";

const inputCls = "min-h-11 w-full rounded-md border border-zinc-300 px-2.5 text-sm text-zinc-900";
const labelCls = "flex flex-col gap-1 text-xs font-semibold text-zinc-600";

export function QuoteJobItemCard({
  index,
  job,
  collapsed,
  canRemove,
  calc,
  calcLoading,
  calcError,
  onChange,
  onRemove,
  onToggleCollapse,
}: {
  index: number;
  job: JobForm;
  collapsed: boolean;
  canRemove: boolean;
  calc: OemPriceCalcResult | null;
  calcLoading: boolean;
  calcError: string | null;
  onChange: <K extends keyof JobForm>(key: K, value: JobForm[K]) => void;
  onRemove: () => void;
  onToggleCollapse: () => void;
}) {
  const summaryLabel = [job.itemKind || "ยังไม่ระบุประเภท", job.qty ? `${job.qty} ชิ้น` : null].filter(Boolean).join(" · ");
  const priceLabel = calcLoading
    ? "กำลังคำนวณ..."
    : calcError
    ? "คำนวณไม่ได้"
    : calc?.isComplete && calc.breakdown.quoteTotal != null
    ? formatTHB(calc.breakdown.quoteTotal)
    : "—";

  return (
    <div className="rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 p-3">
        <button type="button" onClick={onToggleCollapse} className="flex flex-1 items-center gap-2 text-left" aria-expanded={!collapsed}>
          {collapsed ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden="true" />
          ) : (
            <ChevronUp className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden="true" />
          )}
          <span className="text-sm font-bold text-zinc-800">รายการที่ {index + 1}</span>
          <span className="truncate text-xs text-zinc-500">{summaryLabel}</span>
        </button>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-zinc-700">{priceLabel}</span>
        {calcLoading && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-zinc-400" aria-hidden="true" />}
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`ลบรายการที่ ${index + 1}`}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-zinc-400 hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>

      {!collapsed && (
        <div className="space-y-3 border-t border-zinc-100 p-3.5">
          {calcError && (
            <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
              {calcError}
            </p>
          )}
          {calc && !calc.isComplete && (
            <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-700">
              ยังคิดราคาไม่ได้ — ขาดต้นทุน {calc.missing.length} รายการ
            </p>
          )}

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <label className={labelCls}>
              วัสดุ
              <select
                value={job.metal}
                onChange={(e) => {
                  const metal = e.target.value as OemMetal;
                  onChange("metal", metal);
                  onChange("purity", OEM_DEFAULT_PURITY[metal]);
                }}
                className={inputCls}
              >
                {(Object.keys(OEM_METAL_LABEL_TH) as OemMetal[]).map((m) => (
                  <option key={m} value={m}>
                    {OEM_METAL_LABEL_TH[m]}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelCls}>
              ความบริสุทธิ์ {job.metal === "gold" && <span className="text-red-600">*บังคับกรอก</span>}
              <input
                type="number"
                inputMode="decimal"
                min={0}
                max={1}
                step="0.0001"
                value={job.purity}
                onChange={(e) => onChange("purity", e.target.value)}
                className={inputCls}
                placeholder={job.metal === "gold" ? "เช่น 0.9167 (23K)" : OEM_DEFAULT_PURITY[job.metal]}
              />
            </label>
            <label className={labelCls}>
              ประเภทชิ้นงาน
              <select value={job.itemKind} onChange={(e) => onChange("itemKind", e.target.value)} className={inputCls}>
                <option value="">— เลือก —</option>
                {OEM_ITEM_KIND_OPTIONS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelCls}>
              ระดับความยากขัด
              <select value={job.polishTier} onChange={(e) => onChange("polishTier", e.target.value)} className={inputCls}>
                <option value="">— เลือก —</option>
                {OEM_POLISH_TIER_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelCls}>
              น้ำหนัก/ชิ้น (กรัม)
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={job.weightG}
                onChange={(e) => onChange("weightG", e.target.value)}
                className={inputCls}
              />
            </label>
            <label className={labelCls}>
              จำนวน (ชิ้น)
              <input type="number" inputMode="numeric" min={1} step="1" value={job.qty} onChange={(e) => onChange("qty", e.target.value)} className={inputCls} />
            </label>
          </div>

          <div className="flex items-center gap-2">
            <input
              id={`oem-new-design-${index}`}
              type="checkbox"
              checked={job.isNewDesign}
              onChange={(e) => onChange("isNewDesign", e.target.checked)}
              className="h-5 w-5 rounded border-zinc-300"
            />
            <label htmlFor={`oem-new-design-${index}`} className="text-sm text-zinc-700">
              แบบใหม่ (มี NRE: CAD/ปริ้น 3D/ก้อนยาง) — ปิดถ้าใช้แบบเดิมของร้าน
            </label>
          </div>

          <div className="border-t border-zinc-100 pt-3">
            <div className="flex items-center gap-2">
              <input
                id={`oem-has-gems-${index}`}
                type="checkbox"
                checked={job.hasGems}
                onChange={(e) => onChange("hasGems", e.target.checked)}
                className="h-5 w-5 rounded border-zinc-300"
              />
              <label htmlFor={`oem-has-gems-${index}`} className="text-sm font-bold text-zinc-800">
                มีฝังพลอย
              </label>
            </div>
            {job.hasGems && (
              <div className="mt-2.5 grid grid-cols-2 gap-2.5">
                <label className={labelCls}>
                  ขนาดเม็ด
                  <select value={job.gemTier} onChange={(e) => onChange("gemTier", e.target.value)} className={inputCls}>
                    <option value="">— เลือก —</option>
                    {OEM_GEM_TIER_OPTIONS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={labelCls}>
                  จำนวนเม็ด/ชิ้น
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step="1"
                    value={job.gemCount}
                    onChange={(e) => onChange("gemCount", e.target.value)}
                    className={inputCls}
                  />
                </label>
              </div>
            )}
          </div>

          <div className="border-t border-zinc-100 pt-3">
            <div className="flex items-center gap-2">
              <input
                id={`oem-has-plating-${index}`}
                type="checkbox"
                checked={job.hasPlating}
                onChange={(e) => onChange("hasPlating", e.target.checked)}
                className="h-5 w-5 rounded border-zinc-300"
              />
              <label htmlFor={`oem-has-plating-${index}`} className="text-sm font-bold text-zinc-800">
                มีชุบผิว
              </label>
            </div>
            {job.hasPlating && (
              <label className={`${labelCls} mt-2.5 max-w-xs`}>
                ชุบอะไร
                <select value={job.platingType} onChange={(e) => onChange("platingType", e.target.value)} className={inputCls}>
                  <option value="">— เลือก —</option>
                  {OEM_PLATING_OPTIONS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <div className="border-t border-zinc-100 pt-3">
            <label className={`${labelCls} max-w-[10rem]`}>
              margin (%)
              <input
                type="number"
                inputMode="decimal"
                min={0}
                max={99.99}
                step="0.5"
                value={job.marginPct}
                onChange={(e) => onChange("marginPct", e.target.value)}
                className={inputCls}
              />
            </label>
          </div>

          {/* รายละเอียดต้นทุน/ค่าแรง/floor ของรายการนี้ — ตัวเดียวกับที่หน้า
              ใบเสนอราคาที่บันทึกแล้วใช้ ตอนคิดราคาคือจังหวะที่ต้องเห็นมันที่สุด
              จึงโชว์เต็ม ไม่ใช่ย่อเหลือบรรทัดเดียว (สรุปบรรทัดเดียวอยู่ที่หัว
              การ์ดตอนพับแล้ว) approvalNoteSlot ไม่ส่ง เพราะ v2 ย้ายช่องเหตุผล
              ไปอยู่ระดับทั้งใบที่ QuoteResultPanel */}
          {calc && !calcLoading && (
            <div className="border-t border-zinc-100 pt-3">
              <OemCalcBreakdown calc={calc} metal={job.metal} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
