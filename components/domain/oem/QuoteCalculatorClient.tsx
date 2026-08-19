"use client";

// QuoteCalculatorClient — /oem/quote (T5). Left: job form. Right: live price
// preview (debounced calcPrice call, 300ms) + save actions. This file owns
// form state and orchestration only — every displayed number comes from
// analytics.oem_price_calc via calcPrice()/saveQuote(); no arithmetic here.

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { calcPrice, saveQuote } from "@/lib/actions/oem";
import type { OemMetal, OemPriceCalcInput, OemPriceCalcResult, OemSettingData } from "@/lib/oem/types";
import { OEM_METAL_LABEL_TH } from "@/lib/oem/types";
import { OEM_GEM_TIER_OPTIONS, OEM_ITEM_KIND_OPTIONS, OEM_PLATING_OPTIONS, OEM_POLISH_TIER_OPTIONS, roundTo } from "@/lib/oem/display";
import { useToast } from "@/components/ui/Toast";
import { QuoteResultPanel } from "./QuoteResultPanel";

const DEFAULT_PURITY: Record<OemMetal, string> = { silver: "0.925", gold: "", brass: "1" };

interface JobForm {
  metal: OemMetal;
  purity: string;
  itemKind: string;
  weightG: string;
  qty: string;
  polishTier: string;
  hasGems: boolean;
  gemTier: string;
  gemCount: string;
  hasPlating: boolean;
  platingType: string;
  isNewDesign: boolean;
  marginPct: string;
}

function buildInput(job: JobForm): OemPriceCalcInput | null {
  if (!job.itemKind || !job.polishTier) return null;
  const qty = Number(job.qty);
  const weightG = Number(job.weightG);
  if (!Number.isFinite(qty) || qty <= 0) return null;
  if (!Number.isFinite(weightG) || weightG <= 0) return null;
  if (job.metal === "gold" && !job.purity.trim()) return null;

  let purity: number | null = null;
  if (job.purity.trim()) {
    purity = Number(job.purity);
    if (!Number.isFinite(purity) || purity <= 0 || purity > 1) return null;
  }

  let marginPct: number | null = null;
  if (job.marginPct.trim()) {
    marginPct = Number(job.marginPct) / 100;
    if (!Number.isFinite(marginPct) || marginPct < 0 || marginPct >= 1) return null;
  }

  if (job.hasGems && (!job.gemTier || !job.gemCount || Number(job.gemCount) <= 0)) return null;
  if (job.hasPlating && !job.platingType) return null;

  return {
    metal: job.metal,
    itemKind: job.itemKind,
    polishTier: job.polishTier,
    qty,
    weightG,
    isNewDesign: job.isNewDesign,
    purity,
    platingType: job.hasPlating ? job.platingType : null,
    gemTier: job.hasGems ? job.gemTier : null,
    gemCount: job.hasGems ? Number(job.gemCount) : 0,
    marginPct,
  };
}

const inputCls = "min-h-11 w-full rounded-md border border-zinc-300 px-2.5 text-sm text-zinc-900";
const labelCls = "flex flex-col gap-1 text-xs font-semibold text-zinc-600";

export function QuoteCalculatorClient({ setting }: { setting: OemSettingData }) {
  const router = useRouter();
  const toast = useToast();

  const [customerName, setCustomerName] = useState("");
  const [customerContact, setCustomerContact] = useState("");
  const [job, setJob] = useState<JobForm>({
    metal: "silver",
    purity: DEFAULT_PURITY.silver,
    itemKind: "",
    weightG: "",
    qty: "",
    polishTier: "",
    hasGems: false,
    gemTier: "",
    gemCount: "",
    hasPlating: false,
    platingType: "",
    isNewDesign: true,
    marginPct: String(roundTo(setting.marginTargetPct * 100, 2)),
  });

  const [calc, setCalc] = useState<OemPriceCalcResult | null>(null);
  const [calcLoading, setCalcLoading] = useState(false);
  const [calcError, setCalcError] = useState<string | null>(null);
  const [approvalNote, setApprovalNote] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [quoteId, setQuoteId] = useState<string | null>(null);
  const [savingDraft, startDraft] = useTransition();
  const [savingQuote, startQuote] = useTransition();

  const input = useMemo(() => buildInput(job), [job]);

  function updateJob<K extends keyof JobForm>(key: K, value: JobForm[K]) {
    setJob((prev) => {
      const next = { ...prev, [key]: value };
      if (key === "metal") next.purity = DEFAULT_PURITY[value as OemMetal];
      return next;
    });
    setQuoteId(null); // editing the job starts a fresh (unsaved) quote
  }

  // Debounced live preview — 300ms, cancels the previous timer on every change.
  useEffect(() => {
    if (!input) {
      setCalc(null);
      setCalcError(null);
      setCalcLoading(false);
      return;
    }
    setCalcLoading(true);
    const timer = setTimeout(async () => {
      const result = await calcPrice(input);
      setCalcLoading(false);
      if (!result.ok) {
        setCalcError(result.error);
        setCalc(null);
        return;
      }
      setCalcError(null);
      setCalc(result.data);
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(input)]);

  function handleSaveDraft() {
    if (!input) return;
    setSaveError(null);
    startDraft(async () => {
      const result = await saveQuote({
        input,
        quoteId,
        status: "draft",
        customerName: customerName.trim() || null,
        customerContact: customerContact.trim() || null,
      });
      if (!result.ok) {
        setSaveError(result.error);
        toast.push(result.error, "error");
        return;
      }
      setQuoteId(result.data.quoteId);
      toast.push("บันทึกร่างแล้ว");
      router.refresh();
    });
  }

  function handleIssueQuote() {
    if (!input) return;
    setSaveError(null);
    startQuote(async () => {
      const result = await saveQuote({
        input,
        quoteId,
        status: "quoted",
        approvalNote: approvalNote.trim() || null,
        customerName: customerName.trim() || null,
        customerContact: customerContact.trim() || null,
      });
      if (!result.ok) {
        setSaveError(result.error);
        toast.push(result.error, "error");
        return;
      }
      toast.push("ออกใบเสนอราคาแล้ว");
      router.push(`/oem/quotes/${result.data.quoteId}`);
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-zinc-900">คิดราคางาน OEM</h1>
        <p className="mt-0.5 text-sm text-zinc-500">ราคาคำนวณสดจากต้นทุนที่กรอกไว้ที่หน้า &quot;ต้นทุน&quot;</p>
      </div>

      <div className="grid gap-4 md:grid-cols-[1fr_380px] md:items-start">
        {/* left: form */}
        <div className="space-y-4">
          <section className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
            <h2 className="text-sm font-bold text-zinc-800">ลูกค้า</h2>
            <div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <label className={labelCls}>
                ชื่อลูกค้า
                <input type="text" value={customerName} onChange={(e) => setCustomerName(e.target.value)} className={inputCls} placeholder="เช่น ร้าน ABC" />
              </label>
              <label className={labelCls}>
                ช่องทางติดต่อ
                <input type="text" value={customerContact} onChange={(e) => setCustomerContact(e.target.value)} className={inputCls} placeholder="เบอร์โทร / LINE" />
              </label>
            </div>
          </section>

          <section className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
            <h2 className="text-sm font-bold text-zinc-800">รายละเอียดงาน</h2>
            <div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <label className={labelCls}>
                วัสดุ
                <select value={job.metal} onChange={(e) => updateJob("metal", e.target.value as OemMetal)} className={inputCls}>
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
                  onChange={(e) => updateJob("purity", e.target.value)}
                  className={inputCls}
                  placeholder={job.metal === "gold" ? "เช่น 0.9167 (23K)" : DEFAULT_PURITY[job.metal]}
                />
              </label>
              <label className={labelCls}>
                ประเภทชิ้นงาน
                <select value={job.itemKind} onChange={(e) => updateJob("itemKind", e.target.value)} className={inputCls}>
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
                <select value={job.polishTier} onChange={(e) => updateJob("polishTier", e.target.value)} className={inputCls}>
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
                <input type="number" inputMode="decimal" min={0} step="0.01" value={job.weightG} onChange={(e) => updateJob("weightG", e.target.value)} className={inputCls} />
              </label>
              <label className={labelCls}>
                จำนวน (ชิ้น)
                <input type="number" inputMode="numeric" min={1} step="1" value={job.qty} onChange={(e) => updateJob("qty", e.target.value)} className={inputCls} />
              </label>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <input
                id="oem-new-design"
                type="checkbox"
                checked={job.isNewDesign}
                onChange={(e) => updateJob("isNewDesign", e.target.checked)}
                className="h-5 w-5 rounded border-zinc-300"
              />
              <label htmlFor="oem-new-design" className="text-sm text-zinc-700">
                แบบใหม่ (มี NRE: CAD/ปริ้น 3D/ก้อนยาง) — ปิดถ้าใช้แบบเดิมของร้าน
              </label>
            </div>
          </section>

          <section className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
            <div className="flex items-center gap-2">
              <input
                id="oem-has-gems"
                type="checkbox"
                checked={job.hasGems}
                onChange={(e) => updateJob("hasGems", e.target.checked)}
                className="h-5 w-5 rounded border-zinc-300"
              />
              <label htmlFor="oem-has-gems" className="text-sm font-bold text-zinc-800">
                มีฝังพลอย
              </label>
            </div>
            {job.hasGems && (
              <div className="mt-2.5 grid grid-cols-2 gap-2.5">
                <label className={labelCls}>
                  ขนาดเม็ด
                  <select value={job.gemTier} onChange={(e) => updateJob("gemTier", e.target.value)} className={inputCls}>
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
                  <input type="number" inputMode="numeric" min={1} step="1" value={job.gemCount} onChange={(e) => updateJob("gemCount", e.target.value)} className={inputCls} />
                </label>
              </div>
            )}
          </section>

          <section className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
            <div className="flex items-center gap-2">
              <input
                id="oem-has-plating"
                type="checkbox"
                checked={job.hasPlating}
                onChange={(e) => updateJob("hasPlating", e.target.checked)}
                className="h-5 w-5 rounded border-zinc-300"
              />
              <label htmlFor="oem-has-plating" className="text-sm font-bold text-zinc-800">
                มีชุบผิว
              </label>
            </div>
            {job.hasPlating && (
              <label className={`${labelCls} mt-2.5 max-w-xs`}>
                ชุบอะไร
                <select value={job.platingType} onChange={(e) => updateJob("platingType", e.target.value)} className={inputCls}>
                  <option value="">— เลือก —</option>
                  {OEM_PLATING_OPTIONS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </section>

          <section className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
            <h2 className="text-sm font-bold text-zinc-800">margin ที่จะคิด</h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              ค่าเริ่มต้นมาจากเป้าหมายที่ตั้งไว้ ({roundTo(setting.marginTargetPct * 100, 1)}%) — ปรับลดเพื่อเจรจาราคาได้ แต่ต่ำกว่า floor ต้องระบุเหตุผล
            </p>
            <label className={`${labelCls} mt-2.5 max-w-[10rem]`}>
              margin (%)
              <input type="number" inputMode="decimal" min={0} max={99.99} step="0.5" value={job.marginPct} onChange={(e) => updateJob("marginPct", e.target.value)} className={inputCls} />
            </label>
          </section>
        </div>

        {/* right: result (desktop sticky, mobile stacked below) */}
        <div className="md:sticky md:top-[7.5rem]">
          <QuoteResultPanel
            calc={calc}
            calcLoading={calcLoading}
            calcError={calcError}
            metal={job.metal}
            approvalNote={approvalNote}
            onApprovalNoteChange={setApprovalNote}
            onSaveDraft={handleSaveDraft}
            onIssueQuote={handleIssueQuote}
            savingDraft={savingDraft}
            savingQuote={savingQuote}
            canBuildInput={input != null}
            saveError={saveError}
          />
        </div>
      </div>
    </div>
  );
}
