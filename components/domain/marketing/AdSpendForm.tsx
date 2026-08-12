"use client";

// AdSpendForm — /marketing/ad-spend entry form (docs/3j-jewelry/analytics/
// phase-b3-design.md §1.2 option ค): ช่วงวันที่ (default สัปดาห์ล่าสุด) +
// channel + ยอดเงิน + optional impressions/clicks พับเก็บ. Local form state
// only (not URL-driven like CrmDateRangeFilter) — this is a write form, not
// a filter/navigation control, so it stays a plain controlled component and
// calls upsertAdSpend() directly on submit.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { upsertAdSpend } from "@/lib/actions/marketing";
import type { CrmChannelOption } from "@/lib/crm/order-override";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { effectiveDateBangkok } from "@/lib/tiktok/format";

/** Monday of the ISO week containing `dateStr` ("YYYY-MM-DD" in, "YYYY-MM-DD" out). */
function mondayOfWeekISO(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function bangkokTodayISO(): string {
  return effectiveDateBangkok(new Date().toISOString());
}

export function AdSpendForm({ channels }: { channels: CrmChannelOption[] }) {
  const router = useRouter();
  const toast = useToast();
  const today = bangkokTodayISO();

  const [dateFrom, setDateFrom] = useState(() => mondayOfWeekISO(today));
  const [dateTo, setDateTo] = useState(today);
  const [channelId, setChannelId] = useState(channels[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [impressions, setImpressions] = useState("");
  const [clicks, setClicks] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const noChannels = channels.length === 0;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!channelId) {
      setError("กรุณาเลือกช่องทาง");
      return;
    }
    if (dateFrom > dateTo) {
      setError("วันที่เริ่มต้องมาก่อนวันที่สิ้นสุด");
      return;
    }
    const amountNum = Number(amount);
    if (!amount || !Number.isFinite(amountNum) || amountNum < 0) {
      setError("กรุณากรอกยอดเงินให้ถูกต้อง (ตั้งแต่ 0 ขึ้นไป)");
      return;
    }

    const impressionsNum = impressions.trim() ? Number(impressions) : null;
    const clicksNum = clicks.trim() ? Number(clicks) : null;
    if (impressionsNum !== null && (!Number.isFinite(impressionsNum) || impressionsNum < 0)) {
      setError("จำนวนการเข้าถึง (impressions) ต้องเป็นจำนวนตั้งแต่ 0 ขึ้นไป");
      return;
    }
    if (clicksNum !== null && (!Number.isFinite(clicksNum) || clicksNum < 0)) {
      setError("จำนวนคลิกต้องเป็นจำนวนตั้งแต่ 0 ขึ้นไป");
      return;
    }

    startTransition(async () => {
      const result = await upsertAdSpend({
        channelId,
        dateFrom,
        dateTo,
        amount: amountNum,
        impressions: impressionsNum,
        clicks: clicksNum,
      });
      if (!result.ok) {
        setError(result.error);
        toast.push(result.error, "error");
        return;
      }
      toast.push(`บันทึกค่าแอด ${result.data.daysWritten} วัน เฉลี่ยวันละ ฿${result.data.amountPerDay.toLocaleString("en-US")}`);
      // Keep the range + channel selected (owner often enters the same week
      // for a second channel right after) — only clear the amount fields.
      setAmount("");
      setImpressions("");
      setClicks("");
      setShowAdvanced(false);
      router.refresh();
    });
  }

  if (noChannels) {
    return (
      <p className="rounded-lg border border-dashed border-zinc-300 bg-white px-4 py-6 text-center text-sm text-zinc-500">
        ยังไม่มีช่องทางในระบบ — ติดต่อผู้ดูแลเพื่อตั้งค่าช่องทางก่อน
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
      <h2 className="text-sm font-bold text-zinc-800">กรอกค่าแอด</h2>

      <div className="grid grid-cols-2 gap-2.5">
        <label className="flex flex-col gap-1 text-xs font-semibold text-zinc-600">
          ตั้งแต่
          <input
            type="date"
            value={dateFrom}
            max={today}
            onChange={(e) => e.target.value && setDateFrom(e.target.value)}
            className="min-h-11 rounded-md border border-zinc-300 px-2.5 text-sm text-zinc-900"
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-zinc-600">
          ถึง
          <input
            type="date"
            value={dateTo}
            max={today}
            onChange={(e) => e.target.value && setDateTo(e.target.value)}
            className="min-h-11 rounded-md border border-zinc-300 px-2.5 text-sm text-zinc-900"
            required
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-xs font-semibold text-zinc-600">
        ช่องทาง
        <select
          value={channelId}
          onChange={(e) => setChannelId(e.target.value)}
          className="min-h-11 rounded-md border border-zinc-300 px-2.5 text-sm text-zinc-900"
          required
        >
          {channels.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs font-semibold text-zinc-600">
        ยอดเงิน (บาท) — รวมทั้งช่วงที่เลือก
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

      <details
        open={showAdvanced}
        onToggle={(e) => setShowAdvanced((e.target as HTMLDetailsElement).open)}
        className="rounded-md border border-zinc-200 px-2.5 py-1.5"
      >
        <summary className="flex min-h-9 cursor-pointer list-none items-center gap-1.5 text-xs font-semibold text-zinc-600">
          <ChevronDown
            className={`h-3.5 w-3.5 shrink-0 transition-transform ${showAdvanced ? "" : "-rotate-90"}`}
            aria-hidden="true"
          />
          ข้อมูลเพิ่มเติม (ไม่บังคับ)
        </summary>
        <div className="grid grid-cols-2 gap-2.5 pt-2.5 pb-1">
          <label className="flex flex-col gap-1 text-xs font-semibold text-zinc-600">
            Impressions
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={impressions}
              onChange={(e) => setImpressions(e.target.value)}
              className="min-h-11 rounded-md border border-zinc-300 px-2.5 text-sm text-zinc-900"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-zinc-600">
            คลิก
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={clicks}
              onChange={(e) => setClicks(e.target.value)}
              className="min-h-11 rounded-md border border-zinc-300 px-2.5 text-sm text-zinc-900"
            />
          </label>
        </div>
      </details>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <Button type="submit" variant="primary" loading={pending} className="self-end">
        บันทึกค่าแอด
      </Button>
    </form>
  );
}
