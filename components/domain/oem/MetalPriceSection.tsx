"use client";

// MetalPriceSection — /oem/rates: ราคาโลหะ 3 ชนิด (บาท/กรัม), แยกจาก
// oem_cost_rate (ไม่มี effective-dated scope เดียวกัน — append-only ตามวัน,
// oem_price_calc อ่านค่าล่าสุด ณ as_of_date). เซฟทีละช่องตอน blur เหมือน RateCell.
//
// `todayBkk` (H1 fix, security round 2): "YYYY-MM-DD" for Asia/Bangkok
// "today", computed by the Server Component at app/(dashboard)/oem/rates/
// page.tsx and threaded down through RatesPageClient — NEVER computed here
// with `new Date()`. A browser's local clock/timezone is untrustworthy, and
// the DB gate this feature feeds (analytics.production_spot_resolve, 0131)
// decides "today" with `(now() at time zone 'Asia/Bangkok')::date` — the
// client must agree with THAT definition, not its own idea of the date.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { saveMetalPrice } from "@/lib/actions/oem";
import type { OemMetalPriceMap, OemProductionMetal } from "@/lib/oem/types";
import { OEM_METAL_LABEL_TH } from "@/lib/oem/types";
import { formatThaiDateOnly } from "@/lib/tiktok/format";
import { useToast } from "@/components/ui/Toast";
// S1 fix (0127 code review): silver shares the same 5–500 บาท/กรัม bound as
// shop_setting_upsert/the sheet-sync trigger — reuse the single source of
// truth in lib/catalog/types.ts instead of a second copy of the magic
// numbers (must stay in sync across 4 layers now, see 0127's header).
import { MAX_SILVER_SPOT_THB_PER_GRAM, MIN_SILVER_SPOT_THB_PER_GRAM, silverSpotValidationError } from "@/lib/catalog/types";

// silver999 (เงินแท่ง) deliberately excluded — its price comes from
// silver_price_daily (fixed sell price per size), not a per-gram spot rate
// an admin types in here. See OemProductionMetal's comment in lib/oem/types.ts.
const METALS: OemProductionMetal[] = ["silver", "gold", "brass"];

function MetalPriceCell({
  metal,
  current,
  todayBkk,
}: {
  metal: OemProductionMetal;
  current: OemMetalPriceMap[OemProductionMetal];
  /** "YYYY-MM-DD", Asia/Bangkok, computed SERVER-SIDE (page.tsx) — never
   * `new Date()` on the client. See MetalPriceSection's header comment. */
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

  async function commit() {
    const trimmed = value.trim();
    if (trimmed === "") return;
    const raw = Number(trimmed);
    // S1 fix: silver goes through the same 5–500 bound (and NaN-safe check)
    // as shop_setting_upsert/the RPC — other metals keep the plain >0 check
    // (gold/brass legitimately price well outside that range).
    if (metal === "silver") {
      const err = silverSpotValidationError(raw);
      if (err) {
        toast.push(err, "error");
        setValue(current ? String(current.priceThbPerGram) : "");
        return;
      }
    } else if (!Number.isFinite(raw) || raw <= 0) {
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

  const isSilver = metal === "silver";

  // H1 fix (security round 2): whether the price on file is NOT today's.
  // `todayBkk` is server-computed (see the prop comment above + page.tsx) —
  // comparing against it (not a client Date) is what makes this trustworthy.
  // Only meaningful for silver (the only metal with a same-day sheet sync to
  // warn about — see the isSilver block below), harmless to compute for all.
  const isStale = !!current && current.asOfDate !== todayBkk;

  // S1 fix (originally 0129 code review round 3, adapted here — see this
  // PR's task brief §1c for the deviation below): /settings used to tell
  // the owner "retype the same number here to lock it in", but commit()
  // above early-returns silently (line ~57) when the typed value already
  // equals `current`. That dedupe guard exists to skip a redundant network
  // call on every unrelated blur — it was never meant to block intentional
  // locking — so "retype the same number" silently did nothing. This button
  // calls saveMetalPrice bypassing that guard ON PURPOSE: creating a fresh
  // manual oem_metal_price row for TODAY is the entire point (it's what
  // makes the 0129 manual-guard inside oem_metal_price_set refuse the next
  // sheet sync for the rest of the day).
  //
  // Deviation from the original fix (explicit Tech Lead instruction, this
  // PR): the original read `current.priceThbPerGram` — the last value the
  // SERVER confirmed. That has a race: type a NEW number, then click this
  // button before onBlur's commit() round-trips — this handler could still
  // fire with the STALE `current` and overwrite the owner's fresh edit with
  // the OLD price. The only guard against that was `disabled={saving}`,
  // which depends on React having already re-rendered with saving=true
  // before the click handler runs — a render-timing assumption, not an
  // invariant.
  //
  // Reading `value` (what's actually showing in the input right now)
  // instead means the worst case becomes writing the SAME number twice in a
  // row — an upsert on the same (shop, metal, today) row, a harmless no-op —
  // never clobbering a newer number with an older one. The button says
  // "ราคานี้" (this price); `value` is the price the owner is actually
  // looking at, `current` is whatever the server said as of the last
  // render.
  //
  // H1 fix (security round 2, DB-confirmed): this button previously let a
  // stale price (e.g. yesterday's, before today's sheet sync has landed)
  // become TODAY's manual price completely silently — no wording anywhere
  // said "yesterday". That's a real gap this feature exists to close
  // (production_spot_resolve, 0131, refuses to fall back to yesterday's
  // price on its own — this button must not become a side-door around that
  // by disguising a carry-forward as a fresh entry). The "sheet is down, use
  // the old price for now" use case is legitimate and stays allowed — the
  // fix is disclosure (a visible warning + an explicit confirm), not a
  // block. Only fires the confirm when the owner is about to send the SAME
  // number that's already on file as a STALE day — typing a genuinely new
  // number is always the owner's clear intent and must not be interrupted.
  async function lockCurrentPrice() {
    if (!current) return;
    const trimmed = value.trim();
    const raw = trimmed === "" ? current.priceThbPerGram : Number(trimmed);
    // L2 fix: branch validation by metal the same way commit() does
    // (lines ~46-57) instead of always calling silverSpotValidationError
    // unconditionally. The button only renders for isSilver today, so the
    // else-branch is currently unreachable — this just keeps
    // lockCurrentPrice() correct on its own if the button is ever
    // reused/moved for gold/brass, instead of silently applying silver's
    // 5–500 bound to metals that legitimately price outside it.
    let err: string | null;
    if (metal === "silver") {
      err = silverSpotValidationError(raw);
    } else if (!Number.isFinite(raw) || raw <= 0) {
      err = "ราคาต้องมากกว่า 0";
    } else {
      err = null;
    }
    if (err) {
      toast.push(err, "error");
      return;
    }

    // carryingStaleForward: the price on file is from a DIFFERENT day AND
    // the owner isn't typing a new number — they're about to carry an old
    // price forward as today's. Confirm explicitly before doing that.
    const carryingStaleForward = isStale && Math.abs(raw - current.priceThbPerGram) < 1e-9;
    if (carryingStaleForward) {
      const proceed = window.confirm(
        `ราคานี้เป็นของวันที่ ${formatThaiDateOnly(current.asOfDate)} (฿${current.priceThbPerGram} บาท/กรัม)\n\n` +
          `กดตกลง = ใช้เป็นราคาของวันนี้ · ชีตราคาเงินจะไม่ทับอีกทั้งวัน · ค่านี้จะไปเป็นต้นทุน SKU และต้นทุนใบผลิตของทั้งร้านในวันนี้ด้วย`
      );
      if (!proceed) return; // ยกเลิก — เงียบๆ ไม่ toast
    }

    setLocking(true);
    const result = await saveMetalPrice({ metal, priceThbPerGram: raw });
    setLocking(false);
    if (!result.ok) {
      toast.push(result.error, "error");
      // L1 fix: revert like commit() does (lines ~50/55/65) — without this,
      // a rejected lock left the input showing the number the owner just
      // tried to send, indistinguishable from a successful save.
      setValue(current ? String(current.priceThbPerGram) : "");
      return;
    }
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
          {/* H1 fix: current && isStale (not the bare `isStale` boolean) so
              TS narrows `current` to non-null for the .asOfDate read below. */}
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
              className="mt-1.5 text-[0.68rem] font-medium text-primary-700 hover:underline disabled:opacity-50"
            >
              {locking ? "กำลังล็อก..." : "ล็อกราคานี้ไว้วันนี้"}
            </button>
          )}
        </>
      )}
    </div>
  );
}

export function MetalPriceSection({ prices, todayBkk }: { prices: OemMetalPriceMap; todayBkk: string }) {
  return (
    <section id="oem-metal-price" className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
      <h2 className="text-sm font-bold text-zinc-800">ราคาโลหะ (บาท/กรัม)</h2>
      <p className="mt-0.5 text-xs text-zinc-500">
        ใช้คำนวณต้นทุนเนื้อโลหะต่อชิ้น — บันทึกใหม่ทุกวันที่ราคาขยับ (เก็บประวัติไว้ ไม่ทับของเดิม)
      </p>
      <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        {METALS.map((m) => (
          <MetalPriceCell key={m} metal={m} current={prices[m]} todayBkk={todayBkk} />
        ))}
      </div>
    </section>
  );
}
