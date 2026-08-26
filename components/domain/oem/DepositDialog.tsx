"use client";

// DepositDialog — QuoteDetailClient's "ตั้ง/แก้มัดจำ" action (0081).
// Calls oem_quote_set_deposit — the RPC only ever stores "สิ่งที่ผู้ใช้กรอก"
// (deposit_mode + deposit_input); deposit_amount_thb/balance_thb are computed
// FRESH by v_oem_quote off the quote's CURRENT grand_total every read. This
// dialog therefore never shows a money preview of its own — after a
// successful save the caller (QuoteDetailClient) refreshes and the real
// amounts come back from the view, never from arithmetic done here (see
// pricing-disclosure-policy — same "no client-side money math" rule every
// other OEM write in this app follows).
//
// pct mode: DB stores a FRACTION 0-1, but this screen collects 0-100 (same
// convention as OemPolicySection's margin/floor fields and RateCell's own
// pct rows) — divided by 100 right before the server action call, never
// stored as 0.5 by a user typing "0.5".

import { useState, useTransition } from "react";
import { setQuoteDeposit } from "@/lib/actions/oem";
import type { OemDepositMode, OemQuoteRow } from "@/lib/oem/types";
import { roundTo } from "@/lib/oem/display";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

export function DepositDialog({ quote, onClose, onSaved }: { quote: OemQuoteRow; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [mode, setMode] = useState<OemDepositMode>(quote.depositMode === "thb" ? "thb" : "pct");
  const [pctInput, setPctInput] = useState(
    quote.depositMode === "pct" && quote.depositInput != null ? String(roundTo(quote.depositInput * 100, 2)) : "50"
  );
  const [thbInput, setThbInput] = useState(
    quote.depositMode === "thb" && quote.depositInput != null ? String(quote.depositInput) : ""
  );
  const [pending, startSave] = useTransition();
  const [clearing, startClear] = useTransition();

  const pctNum = Number(pctInput);
  const thbNum = Number(thbInput);
  const validPct = Number.isFinite(pctNum) && pctNum > 0 && pctNum <= 100;
  // belt-and-braces only — the real gate is oem_quote_set_deposit's own
  // "มัดจำเกินยอดรวมใบเสนอราคาไม่ได้" check (see 0081 §6).
  const validThb = Number.isFinite(thbNum) && thbNum > 0 && (quote.grandTotal == null || thbNum <= quote.grandTotal);
  const canSubmit = mode === "pct" ? validPct : validThb;

  function submit() {
    if (!canSubmit) return;
    startSave(async () => {
      const result = await setQuoteDeposit({
        quoteId: quote.id,
        mode,
        // pct: convert the 0-100 the user typed into the 0-1 fraction the
        // RPC/DB expect — the ONE place this conversion happens.
        input: mode === "pct" ? pctNum / 100 : thbNum,
      });
      if (!result.ok) {
        toast.push(result.error, "error");
        return;
      }
      toast.push("บันทึกมัดจำแล้ว");
      onSaved();
    });
  }

  function clearDeposit() {
    startClear(async () => {
      const result = await setQuoteDeposit({ quoteId: quote.id, mode: null, input: null });
      if (!result.ok) {
        toast.push(result.error, "error");
        return;
      }
      toast.push("ล้างมัดจำแล้ว");
      onSaved();
    });
  }

  return (
    <Modal open onClose={onClose} title={`ตั้งมัดจำ — ${quote.quoteNo}`}>
      <p className="text-sm text-zinc-600">
        เลือกกรอกเป็นเปอร์เซ็นต์ของยอดสุทธิ หรือกรอกเป็นจำนวนเงินบาทตรงๆ — ระบบคำนวณจำนวนมัดจำ/ยอดคงเหลือให้อัตโนมัติหลังบันทึก
      </p>

      <div className="mt-3 flex gap-2" role="radiogroup" aria-label="โหมดกรอกมัดจำ">
        <button
          type="button"
          role="radio"
          aria-checked={mode === "pct"}
          onClick={() => setMode("pct")}
          className={`min-h-11 flex-1 rounded-md border px-3 text-sm font-medium ${
            mode === "pct" ? "border-primary-600 bg-primary-50 text-primary-800" : "border-zinc-300 text-zinc-600"
          }`}
        >
          เปอร์เซ็นต์ (%)
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={mode === "thb"}
          onClick={() => setMode("thb")}
          className={`min-h-11 flex-1 rounded-md border px-3 text-sm font-medium ${
            mode === "thb" ? "border-primary-600 bg-primary-50 text-primary-800" : "border-zinc-300 text-zinc-600"
          }`}
        >
          จำนวนเงิน (บาท)
        </button>
      </div>

      {mode === "pct" ? (
        <>
          <label htmlFor="oem-deposit-pct" className="mt-3 block text-sm font-medium text-zinc-700">
            มัดจำ (% ของยอดสุทธิ)
          </label>
          <input
            id="oem-deposit-pct"
            type="number"
            inputMode="decimal"
            min={0}
            max={100}
            step="1"
            value={pctInput}
            onChange={(e) => setPctInput(e.target.value)}
            className="mt-1 min-h-11 w-full rounded-md border border-zinc-300 px-2.5 text-base tabular-nums"
            aria-invalid={!validPct}
            aria-describedby={!validPct ? "oem-deposit-pct-error" : undefined}
          />
          {!validPct && (
            <p id="oem-deposit-pct-error" className="mt-1 text-xs text-red-600">
              กรอกได้ตั้งแต่มากกว่า 0 ถึง 100
            </p>
          )}
        </>
      ) : (
        <>
          <label htmlFor="oem-deposit-thb" className="mt-3 block text-sm font-medium text-zinc-700">
            มัดจำ (บาท)
          </label>
          <input
            id="oem-deposit-thb"
            type="number"
            inputMode="decimal"
            min={0}
            step="1"
            value={thbInput}
            onChange={(e) => setThbInput(e.target.value)}
            className="mt-1 min-h-11 w-full rounded-md border border-zinc-300 px-2.5 text-base tabular-nums"
            aria-invalid={!validThb}
            aria-describedby={!validThb ? "oem-deposit-thb-error" : undefined}
          />
          {!validThb && thbInput !== "" && (
            <p id="oem-deposit-thb-error" className="mt-1 text-xs text-red-600">
              {quote.grandTotal != null && thbNum > quote.grandTotal ? "มัดจำเกินยอดรวมใบเสนอราคาไม่ได้" : "กรอกจำนวนเงินให้มากกว่า 0"}
            </p>
          )}
        </>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {quote.depositMode && (
          <Button type="button" variant="ghost" className="border border-zinc-300 text-red-700" loading={clearing} onClick={clearDeposit}>
            ล้างมัดจำ
          </Button>
        )}
        <div className="flex flex-1 gap-2">
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button type="button" variant="primary" className="flex-1" loading={pending} disabled={!canSubmit} onClick={submit}>
            บันทึก
          </Button>
        </div>
      </div>
    </Modal>
  );
}
