"use client";

// PromoAttributionForm — /marketing/attribution entry form. Owner logs one
// row per order where the buyer typed the LINE-broadcast promo code in chat
// (no automatic tracking link exists for LINE broadcasts — see 0036's header
// comment). Pattern copied from AdSpendForm.tsx: local controlled state +
// useTransition + useToast, calls the server action directly on submit.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addPromoAttribution } from "@/lib/actions/marketing";
import { PROMO_ATTRIBUTION_DEFAULT_CODE } from "@/lib/marketing/types";
import type { CrmChannelOption } from "@/lib/crm/order-override";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { effectiveDateBangkok } from "@/lib/tiktok/format";

function bangkokTodayISO(): string {
  return effectiveDateBangkok(new Date().toISOString());
}

export function PromoAttributionForm({ channels }: { channels: CrmChannelOption[] }) {
  const router = useRouter();
  const toast = useToast();
  const today = bangkokTodayISO();

  const [code, setCode] = useState(PROMO_ATTRIBUTION_DEFAULT_CODE);
  const [amount, setAmount] = useState("");
  const [occurredOn, setOccurredOn] = useState(today);
  const [channelId, setChannelId] = useState("");
  const [customerRef, setCustomerRef] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmedCode = code.trim();
    if (!trimmedCode) {
      setError("กรุณากรอกโค้ด");
      return;
    }
    const amountNum = Number(amount);
    if (!amount || !Number.isFinite(amountNum) || amountNum < 0) {
      setError("กรุณากรอกยอดเงินให้ถูกต้อง (ตั้งแต่ 0 ขึ้นไป)");
      return;
    }
    if (!occurredOn) {
      setError("กรุณาเลือกวันที่");
      return;
    }

    startTransition(async () => {
      const result = await addPromoAttribution({
        code: trimmedCode,
        amount: amountNum,
        occurredOn,
        channelId: channelId || null,
        customerRef: customerRef.trim() || null,
        note: note.trim() || null,
      });
      if (!result.ok) {
        setError(result.error);
        toast.push(result.error, "error");
        return;
      }
      toast.push(`บันทึกรายการ ${trimmedCode} ฿${amountNum.toLocaleString("en-US")} แล้ว`);
      // Keep code + date + channel selected (owner logs several rows for the
      // same broadcast one after another) — only clear amount + free text.
      setAmount("");
      setCustomerRef("");
      setNote("");
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
      <h2 className="text-sm font-bold text-zinc-800">บันทึกยอดที่ลูกค้าพิมพ์โค้ด</h2>

      <div className="grid grid-cols-2 gap-2.5">
        <label className="flex flex-col gap-1 text-xs font-semibold text-zinc-600">
          โค้ด
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={PROMO_ATTRIBUTION_DEFAULT_CODE}
            className="min-h-11 rounded-md border border-zinc-300 px-2.5 text-sm text-zinc-900"
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-zinc-600">
          ยอดเงิน (บาท)
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="min-h-11 rounded-md border border-zinc-300 px-2.5 text-sm text-zinc-900"
            required
          />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <label className="flex flex-col gap-1 text-xs font-semibold text-zinc-600">
          วันที่
          <input
            type="date"
            value={occurredOn}
            max={today}
            onChange={(e) => e.target.value && setOccurredOn(e.target.value)}
            className="min-h-11 rounded-md border border-zinc-300 px-2.5 text-sm text-zinc-900"
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-zinc-600">
          ช่องทาง (ไม่บังคับ)
          <select
            value={channelId}
            onChange={(e) => setChannelId(e.target.value)}
            className="min-h-11 rounded-md border border-zinc-300 px-2.5 text-sm text-zinc-900"
          >
            <option value="">— ไม่ระบุ —</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-1 text-xs font-semibold text-zinc-600">
        อ้างอิงลูกค้า (ไม่บังคับ) — ชื่อ/LINE handle
        <input
          type="text"
          value={customerRef}
          onChange={(e) => setCustomerRef(e.target.value)}
          className="min-h-11 rounded-md border border-zinc-300 px-2.5 text-sm text-zinc-900"
        />
      </label>

      <label className="flex flex-col gap-1 text-xs font-semibold text-zinc-600">
        หมายเหตุ (ไม่บังคับ)
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="min-h-11 rounded-md border border-zinc-300 px-2.5 text-sm text-zinc-900"
        />
      </label>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <Button type="submit" variant="primary" loading={pending} className="self-end">
        บันทึกรายการ
      </Button>
    </form>
  );
}
