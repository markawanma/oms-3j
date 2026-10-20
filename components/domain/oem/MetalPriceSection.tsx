"use client";

// MetalPriceSection — /oem/rates: ราคาโลหะ 3 ชนิด (บาท/กรัม), แยกจาก
// oem_cost_rate (ไม่มี effective-dated scope เดียวกัน — append-only ตามวัน,
// oem_price_calc อ่านค่าล่าสุด ณ as_of_date). เซฟทีละช่องตอน blur เหมือน RateCell.

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { getSilverPriceFreshness, saveMetalPrice, saveMetalPriceInput } from "@/lib/actions/oem";
import type { OemMetalPriceMap, OemProductionMetal, SaveMetalPriceInputResult } from "@/lib/oem/types";
import { OEM_METAL_LABEL_TH } from "@/lib/oem/types";
import type { MetalPriceInputMetal } from "@/lib/oem/metal-price";
import { convertMetalPriceInput, isMetalPricePerGramInRange, metalPriceInputIssueMessage } from "@/lib/oem/metal-price";
import { formatThaiDateOnly } from "@/lib/tiktok/format";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { MetalTag } from "@/components/domain/production/MetalTag";
// S1 fix (0127 code review): silver shares the same 5–500 บาท/กรัม bound as
// shop_setting_upsert/the sheet-sync trigger — reuse the single source of
// truth in lib/catalog/types.ts instead of a second copy of the magic
// numbers (must stay in sync across 4 layers now, see 0127's header).
import { MAX_SILVER_SPOT_THB_PER_GRAM, MIN_SILVER_SPOT_THB_PER_GRAM, silverSpotValidationError } from "@/lib/catalog/types";

// silver999 (เงินแท่ง) deliberately excluded — its price comes from
// silver_price_daily (fixed sell price per size), not a per-gram spot rate
// an admin types in here. See OemProductionMetal's comment in lib/oem/types.ts.
const METALS: OemProductionMetal[] = ["silver", "gold", "brass"];

/** Client-side mirror of oem_metal_price_set's real bound (0127) — fails
 * fast with a specific message instead of round-tripping the RPC. Silver:
 * 5–500; other metals: plain > 0 (gold/brass legitimately price outside
 * that range). Shared by commit() and lockCurrentPrice() below. */
function metalValidationError(metal: OemProductionMetal, raw: number): string | null {
  if (metal === "silver") return silverSpotValidationError(raw);
  if (!Number.isFinite(raw) || raw <= 0) return "ราคาต้องมากกว่า 0";
  return null;
}

function MetalPriceCell({
  metal,
  current,
  todayBkk,
}: {
  metal: OemProductionMetal;
  current: OemMetalPriceMap[OemProductionMetal];
  /** Asia/Bangkok "today" for the warning label only — the lock gate
   * re-fetches live instead (see getSilverPriceFreshness, M2). */
  todayBkk: string;
}) {
  const toast = useToast();
  const router = useRouter();
  const [value, setValue] = useState(current ? String(current.priceThbPerGram) : "");
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [locking, setLocking] = useState(false);

  useEffect(() => {
    setValue(current ? String(current.priceThbPerGram) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.priceThbPerGram, current?.asOfDate]);

  function resetValue() {
    setValue(current ? String(current.priceThbPerGram) : "");
  }

  async function commit() {
    const trimmed = value.trim();
    if (trimmed === "") return;
    const raw = Number(trimmed);
    const err = metalValidationError(metal, raw);
    if (err) {
      toast.push(err, "error");
      resetValue();
      return;
    }
    if (current && Math.abs(raw - current.priceThbPerGram) < 1e-9) return;

    setSaving(true);
    const result = await saveMetalPrice({ metal, priceThbPerGram: raw });
    setSaving(false);
    if (!result.ok) {
      toast.push(result.error, "error");
      resetValue();
      return;
    }
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 1500);
    router.refresh();
  }

  const isSilver = metal === "silver";

  // H1: warning-label only — todayBkk is a render-time prop and can lag; the
  // live confirm gate below re-fetches instead (getSilverPriceFreshness, M2).
  const isStale = !!current && current.asOfDate !== todayBkk;

  // S1: the dedupe guard above exists to skip a redundant network call on
  // blur, not to block intentional locking — this button bypasses it on
  // purpose. Writing a fresh manual row for TODAY is the whole point (see
  // oem_metal_price_set's 0129 manual-guard).
  //
  // Reads `value` (the input's live state), not `current` (server-confirmed):
  // clicking this button always blurs the input first, so if the price was
  // just edited, commit() is already mid-save when this fires — every time,
  // not a rare race. Worst case with `value`: writing the same number twice
  // (harmless upsert), never an older number over a newer one.
  //
  // H1: a stale price (e.g. yesterday's) could otherwise become today's
  // manual price with nothing anywhere saying "yesterday". "Sheet is down,
  // carry the old price forward" stays allowed — the fix below is
  // disclosure (warning + confirm), not a block. See getSilverPriceFreshness
  // (M2) for why the confirm decision re-fetches instead of trusting props.
  async function lockCurrentPrice() {
    if (!current) return;
    const trimmed = value.trim();
    const raw = trimmed === "" ? current.priceThbPerGram : Number(trimmed);
    const err = metalValidationError(metal, raw);
    if (err) {
      toast.push(err, "error");
      return;
    }

    setLocking(true);

    const freshness = await getSilverPriceFreshness();
    if (!freshness.ok) {
      setLocking(false);
      toast.push(freshness.error, "error");
      return;
    }

    const carryingStaleForward =
      freshness.data.silverAsOf !== freshness.data.todayBkk && Math.abs(raw - current.priceThbPerGram) < 1e-9;
    if (carryingStaleForward) {
      const proceed = window.confirm(
        `ราคานี้เป็นของวันที่ ${formatThaiDateOnly(current.asOfDate)} (${current.priceThbPerGram} บาท/กรัม)\n\n` +
          `กดตกลง = ใช้เป็นราคาของวันนี้ · ชีตราคาเงินจะไม่ทับอีกทั้งวัน`
      );
      if (!proceed) {
        setLocking(false);
        return; // ยกเลิก — เงียบๆ ไม่ toast
      }
    }

    const result = await saveMetalPrice({ metal, priceThbPerGram: raw });
    setLocking(false);
    if (!result.ok) {
      toast.push(result.error, "error");
      resetValue();
      return;
    }
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 1500);
    toast.push(
      carryingStaleForward
        ? `ล็อกราคาวันที่ ${formatThaiDateOnly(current.asOfDate)} ให้เป็นราคาวันนี้แล้ว ชีตจะไม่ทับวันนี้`
        : "ล็อกแล้ว ชีตจะไม่ทับวันนี้"
    );
    router.refresh();
  }

  return (
    <div className="rounded-md border border-zinc-200 p-3">
      <p className="text-xs font-semibold text-zinc-600">{OEM_METAL_LABEL_TH[metal]}</p>
      <div className="mt-1.5 flex items-center gap-1.5">
        <input
          type="number"
          inputMode="decimal"
          min={isSilver ? MIN_SILVER_SPOT_THB_PER_GRAM : 0}
          max={isSilver ? MAX_SILVER_SPOT_THB_PER_GRAM : undefined}
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
      {/* S1 note (0127 code review): only silver has a sheet auto-sync to
          warn about (silver999 bars aside, gold/brass are always manual —
          see METALS comment above) */}
      {isSilver && (
        <>
          <p className="mt-1 text-[0.68rem] text-amber-600">
            กรอกที่นี่ = ราคาชนะทั้งวัน ชีตราคาเงินจะไม่ทับจนกว่าจะถึงวันถัดไป
            ค่านี้จะไปเป็นราคาเงินสปอตของทั้งร้าน (ต้นทุน SKU/dashboard) ด้วย
          </p>
          {current && isStale && (
            <p className="mt-1 text-[0.68rem] font-medium text-amber-700">
              ⚠️ ราคาที่แสดงเป็นของวันที่ {formatThaiDateOnly(current.asOfDate)} — ยังไม่มีราคาของวันนี้
            </p>
          )}
          {current && (
            <button
              type="button"
              onClick={lockCurrentPrice}
              disabled={locking || saving}
              className="mt-1.5 text-xs font-medium text-primary-700 hover:underline disabled:opacity-50"
            >
              {locking ? "กำลังล็อก..." : "ล็อกราคานี้ไว้วันนี้"}
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// 0186 (PM-B · UX A.8): ทอง/ทองเหลือง = กรอกด้วย "หน่วยหน้างานจริง" แล้วกดปุ่มบันทึก (ไม่บันทึกตอน blur เหมือนเงิน)
//  • ทอง: ราคาสมาคมฯ ทองคำแท่ง 96.5% ขายออก (บาทละ) → ระบบแปลงเป็นบาท/กรัม ทอง 100% (÷15.244 ÷0.965 — ค่าคงที่อยู่ lib/oem/metal-price.ts ไฟล์เดียว)
//  • ทองเหลือง: บาท/กก. → ÷1,000
//  • เหตุผลที่ไม่ blur-save: ค่าที่กรอกกับค่าที่เก็บคนละหน่วย (ผู้ใช้ต้องเห็นค่าแปลงก่อนเขียน) และผิดทีเดียวต้นทุนผิดทุกใบของวัน
// 🔴 ค่าที่แปลงในช่องนี้ = preview เท่านั้น (ฟังก์ชัน pure ตัวเดียวกับที่ server action ตรวจก่อนยิง RPC) — หลังบันทึกโชว์ "ค่าที่ server คืน" (ชนะ preview) ·
//    DB เป็นผู้ตัดสินการแปลง/ช่วง (oem-quote-invariants ข้อ 2) · วันที่ = วันนี้ (เวลาไทย) เสมอ ย้อนวันไม่ได้ (ไม่มีช่องวันที่)
// ----------------------------------------------------------------------------

const PREVIEW_DEBOUNCE_MS = 400;
const fmtPerGramText = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const fmtInput = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const INPUT_CELL: Record<
  MetalPriceInputMetal,
  { title: string; unitHint: string; placeholder: string; saveLabel: string; basisLabel: string; rangeHint: string; inputUnit: "assoc965_sell_per_baht" | "thb_per_kg"; emptyMsg: string }
> = {
  gold: {
    title: "ราคาสมาคมฯ ทองคำแท่ง 96.5% ขายออก (บาทละ)",
    unitHint: "บาท/บาททอง",
    placeholder: "เช่น 41,250.00",
    saveLabel: "บันทึกราคาทอง",
    basisLabel: "ระบบแปลงเป็น ทอง 100%",
    rangeHint: "ช่วงที่รับ 2,000–8,000 บาท/กรัม (ทอง 100%)",
    inputUnit: "assoc965_sell_per_baht",
    emptyMsg: "ยังไม่เคยตั้งราคาทอง",
  },
  brass: {
    title: "ราคาทองเหลือง (บาท/กก.)",
    unitHint: "บาท/กก.",
    placeholder: "เช่น 350.00",
    saveLabel: "บันทึกราคาทองเหลือง",
    basisLabel: "ระบบแปลงเป็น",
    rangeHint: "ช่วงที่รับ 100–1,000 บาท/กก.",
    inputUnit: "thb_per_kg",
    emptyMsg: "ยังไม่เคยตั้งราคาทองเหลือง",
  },
};

function InputPriceCell({ metal, current, todayBkk }: { metal: MetalPriceInputMetal; current: OemMetalPriceMap[OemProductionMetal]; todayBkk: string }) {
  const cfg = INPUT_CELL[metal];
  const toast = useToast();
  const router = useRouter();
  const uid = useId();
  const inputId = `${uid}-input`;
  const [value, setValue] = useState("");
  const [debounced, setDebounced] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SaveMetalPriceInputResult | null>(null);

  // preview หยุดพิมพ์แล้วค่อยอัปเดต (~400ms) — ไม่ให้ aria-live อ่านทุกตัวอักษร
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [value]);

  const label = metal === "gold" ? "ทอง" : "ทองเหลือง";
  const previewResult = debounced.trim() === "" ? null : convertMetalPriceInput(metal, debounced);
  // ตรวจสดหลังพยายามบันทึกครั้งแรก (ไม่ใช่ระหว่างพิมพ์ครั้งแรก) — ข้อความ error แสดงค่าที่แปลงแล้ว + ช่วง (UX P4)
  const liveResult = value.trim() === "" ? null : convertMetalPriceInput(metal, value);
  const fieldError =
    attempted && (liveResult === null ? metalPriceInputIssueMessage(metal, { ok: false, issue: "invalid", unit: cfg.inputUnit }) : liveResult.ok ? null : metalPriceInputIssueMessage(metal, liveResult));
  const shownError = fieldError || serverError;

  async function save() {
    if (saving) return;
    setAttempted(true);
    setServerError(null);
    setSaved(null);
    const r = value.trim() === "" ? null : convertMetalPriceInput(metal, value);
    if (r === null || !r.ok) {
      setTimeout(() => document.getElementById(inputId)?.focus(), 0);
      return;
    }
    setSaving(true);
    const result = await saveMetalPriceInput({ metal, inputValue: value });
    setSaving(false);
    if (!result.ok) {
      // ค่าที่กรอกยังอยู่ — ไม่ reset ช่อง (ต่างจาก resetValue() ของเงิน)
      setServerError(result.error);
      return;
    }
    setSaved(result.data);
    setAttempted(false);
    toast.push(
      metal === "gold"
        ? `บันทึกราคาทองของวันนี้แล้ว — ${fmtPerGramText(result.data.priceThbPerGram)} บาท/กรัม (ทอง 100%)`
        : `บันทึกราคาทองเหลืองของวันนี้แล้ว — ${fmtInput(result.data.inputValue)} บาท/กก. (${fmtPerGramText(result.data.priceThbPerGram)} บาท/กรัม)`
    );
    router.refresh();
  }

  const hasToday = !!current && current.asOfDate === todayBkk;
  const legacy = !!current && !(current.inputValue != null && current.inputUnit === cfg.inputUnit);
  const outOfRange = !!current && !isMetalPricePerGramInRange(metal, current.priceThbPerGram);

  return (
    <div className="rounded-md border border-zinc-200 p-3">
      <div className="flex items-center gap-1.5">
        <MetalTag metal={metal} />
      </div>
      <label htmlFor={inputId} className="mt-1.5 block text-xs font-semibold text-zinc-700">
        {cfg.title}
      </label>
      <div className="mt-1.5 flex items-center gap-1.5">
        <input
          id={inputId}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          disabled={saving}
          onChange={(e) => {
            setValue(e.target.value);
            setSaved(null);
            setServerError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void save();
            }
          }}
          placeholder={cfg.placeholder}
          aria-invalid={shownError ? true : undefined}
          aria-describedby={shownError ? `${uid}-err` : `${uid}-preview`}
          className={`min-h-11 w-full rounded-md border border-zinc-300 px-2.5 text-sm text-zinc-900 tabular-nums placeholder:text-zinc-500 disabled:bg-zinc-100 ${shownError ? "ring-1 ring-red-500" : ""}`}
        />
        <span className="shrink-0 text-xs font-medium text-zinc-700">{cfg.unitHint}</span>
      </div>

      <div id={`${uid}-preview`} role="status" aria-live="polite" className="mt-1.5 text-xs text-zinc-700">
        {saved ? (
          <span>
            <span aria-hidden="true">✓ </span>บันทึกแล้ว — ระบบเก็บ {fmtPerGramText(saved.priceThbPerGram)} บาท/กรัม{metal === "gold" ? " (ทอง 100%)" : ""} · กรอก {fmtInput(saved.inputValue)} {cfg.unitHint}
          </span>
        ) : previewResult && previewResult.ok ? (
          <span>
            ค่าที่ระบบจะบันทึก: {cfg.basisLabel} = <span className="font-semibold tabular-nums">{fmtPerGramText(previewResult.perGram)} บาท/กรัม</span>
            {metal === "gold" ? " (ทอง 100% · ÷ 15.244 ÷ 0.965)" : " (÷ 1,000)"}
          </span>
        ) : (
          <span className="text-zinc-600">ค่าแปลงจะขึ้นที่นี่ — {cfg.rangeHint}</span>
        )}
      </div>

      {shownError && (
        <p id={`${uid}-err`} role="alert" className="mt-1 text-xs text-red-700">
          {shownError}
        </p>
      )}

      <Button type="button" size="sm" className="mt-2" loading={saving} onClick={() => void save()}>
        {cfg.saveLabel}
      </Button>
      <p className="mt-1 text-xs text-zinc-600">บันทึกเป็นราคาของวันนี้ ({formatThaiDateOnly(todayBkk)}) — ย้อนวันไม่ได้</p>

      {current ? (
        <div className="mt-2 border-t border-zinc-100 pt-2 text-xs text-zinc-700">
          <p>
            ล่าสุด ณ {formatThaiDateOnly(current.asOfDate)}
            {legacy ? " · ค่าเดิม ก่อนใช้ช่องราคาสมาคม" : ""}
          </p>
          {legacy ? (
            <p className="tabular-nums">
              เก็บไว้ {fmtPerGramText(current.priceThbPerGram)} บาท/กรัม{metal === "gold" ? " (ทอง 100%)" : ""} — ไม่แปลงกลับเป็นราคา{metal === "gold" ? "สมาคม" : "ต่อกก."}
            </p>
          ) : (
            <p className="tabular-nums">
              กรอก {fmtInput(current.inputValue as number)} {cfg.unitHint} → เก็บ {fmtPerGramText(current.priceThbPerGram)} บาท/กรัม
            </p>
          )}
          {outOfRange && <p className="font-medium text-red-700">ค่าเดิมอยู่นอกช่วงที่รับ — กรอกใหม่</p>}
          {!hasToday && (
            <p className="mt-1 font-medium text-amber-900">⚠️ ยังไม่มีราคาของวันนี้ — ใบผลิต{label}ที่ใช้ราคา{label}ปิดไม่ได้</p>
          )}
        </div>
      ) : (
        <div className="mt-2 border-t border-zinc-100 pt-2 text-xs text-zinc-700">
          <p>{cfg.emptyMsg}</p>
          <p className="mt-1 font-medium text-amber-900">⚠️ ยังไม่มีราคาของวันนี้ — ใบผลิต{label}ที่ใช้ราคา{label}ปิดไม่ได้</p>
        </div>
      )}
    </div>
  );
}

export function MetalPriceSection({ prices, todayBkk }: { prices: OemMetalPriceMap; todayBkk: string }) {
  return (
    <section id="oem-metal-price" className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
      <h2 className="text-sm font-bold text-zinc-800">ราคาโลหะ</h2>
      <p className="mt-0.5 text-xs text-zinc-500">
        ใช้คำนวณต้นทุนเนื้อโลหะต่อชิ้น — แต่ละโลหะกรอกคนละหน่วย ดูป้ายหัวช่อง (เงิน = บาท/กรัม · ทอง = ราคาสมาคมบาทละ · ทองเหลือง = บาท/กก.) —
        บันทึกใหม่ทุกวันที่ราคาขยับ (เก็บประวัติไว้ ไม่ทับของเดิม)
      </p>
      <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        {METALS.map((m) =>
          m === "silver" ? (
            <MetalPriceCell key={m} metal={m} current={prices[m]} todayBkk={todayBkk} />
          ) : (
            <InputPriceCell key={m} metal={m} current={prices[m]} todayBkk={todayBkk} />
          )
        )}
      </div>
    </section>
  );
}
