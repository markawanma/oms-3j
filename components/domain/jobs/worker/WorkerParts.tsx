"use client";

// WorkerParts — ชิ้นส่วนหน้าช่าง (/w/<token>): แป้น PIN · ช่องน้ำหนัก · แถบขั้น · ตัวนับของเสีย
// มือถือเป็นหลัก · ตัวอักษร ≥ 18px · ปุ่ม ≥ 56px · ไทยล้วน · ไม่มีลิงก์/เมนูไปหน้าอื่น

import type { ButtonHTMLAttributes } from "react";
import { Check, Loader2, Minus, Plus } from "lucide-react";
import { SCRAP_REASON_LABEL, STAGE_STATUS_LABEL } from "@/lib/jobs/types";
import type { WorkerViewStage } from "@/lib/jobs/worker-view";

export const BIG_BTN = "inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-xl px-5 text-xl font-bold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-300 disabled:cursor-not-allowed disabled:opacity-50";

/** ปุ่มใหญ่ของหน้าช่าง (≥ 56px) — ไม่ใช้ components/ui/Button เพราะ min-h ของมันชนกับขนาดนี้ · tone: primary | secondary */
export function BigButton({ tone = "primary", loading, className = "", children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "primary" | "secondary"; loading?: boolean }) {
  const cls = tone === "primary" ? "bg-primary-600 text-white hover:bg-primary-700" : "border-2 border-zinc-400 bg-white text-zinc-900";
  return (
    <button {...rest} disabled={rest.disabled || loading} className={`${BIG_BTN} ${cls} ${className}`}>
      {loading && <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
export function PinPad({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
  const press = (k: string) => value.length < 4 && onChange(value + k);
  const KEY = "min-h-16 rounded-xl border border-zinc-300 bg-white text-3xl font-bold text-zinc-900 active:bg-zinc-100 disabled:opacity-50";
  return (
    <div>
      <div className="mb-4 flex justify-center gap-4" role="img" aria-label={`ใส่ PIN แล้ว ${value.length} จาก 4 หลัก`}>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={`h-5 w-5 rounded-full border-2 ${i < value.length ? "border-zinc-900 bg-zinc-900" : "border-zinc-400 bg-white"}`} />
        ))}
      </div>
      <div className="mx-auto grid max-w-xs grid-cols-3 gap-3">
        {keys.map((k) => (
          <button key={k} type="button" className={KEY} disabled={disabled} onClick={() => press(k)}>
            {k}
          </button>
        ))}
        <button type="button" className={`${KEY} text-xl`} disabled={disabled || value.length === 0} onClick={() => onChange("")}>
          ล้าง
        </button>
        <button type="button" className={KEY} disabled={disabled} onClick={() => press("0")}>
          0
        </button>
        <button type="button" className={`${KEY} text-xl`} disabled={disabled || value.length === 0} onClick={() => onChange(value.slice(0, -1))} aria-label="ลบตัวสุดท้าย">
          ⌫
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
export function WeightField({
  id,
  label,
  value,
  onChange,
  required,
  hint,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  required: boolean;
  hint?: string | null;
  error?: string | null;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-lg font-semibold text-zinc-900">
        {label} (กรัม) <span className={required ? "text-primary-700" : "text-zinc-600"}>{required ? "— ต้องใส่" : "— ถ้าชั่งได้"}</span>
      </label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        enterKeyHint="done"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9.,]/g, ""))}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined}
        className="min-h-16 w-full rounded-xl border-2 border-zinc-400 bg-white px-4 text-center text-4xl font-bold tabular-nums text-zinc-900 focus:border-primary-600 focus:outline-none focus:ring-4 focus:ring-primary-200"
        placeholder="0.000"
      />
      {hint && !error && (
        <p id={`${id}-hint`} className="text-lg text-zinc-700">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-err`} role="alert" className="text-lg font-semibold text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
export function StageStrip({ stages, currentSeq }: { stages: WorkerViewStage[]; currentSeq: number | null }) {
  return (
    <ol aria-label="ขั้นตอนของใบงาน" className="space-y-1.5">
      {stages.map((s) => {
        const done = s.status === "sent" || s.status === "skipped";
        const active = s.seq === currentSeq;
        return (
          <li
            key={s.seq}
            aria-current={active ? "step" : undefined}
            className={`flex min-h-12 items-center gap-3 rounded-lg px-3 text-lg ${active ? "bg-primary-50 font-bold text-primary-900 ring-2 ring-primary-600" : done ? "text-zinc-600" : "text-zinc-900"}`}
          >
            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 ${done ? "border-green-700 bg-green-700 text-white" : active ? "border-primary-600" : "border-zinc-400"}`} aria-hidden="true">
              {done && <Check className="h-4 w-4" />}
            </span>
            <span className="min-w-0 flex-1 break-words">{s.name}</span>
            <span className="shrink-0 text-base">{STAGE_STATUS_LABEL[s.status] ?? s.status}</span>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------
export function ScrapStepper({
  qty,
  onQty,
  reason,
  onReason,
  reasons,
  error,
}: {
  qty: number;
  onQty: (n: number) => void;
  reason: string | null;
  onReason: (r: string) => void;
  reasons: string[];
  error?: string | null;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-lg font-semibold text-zinc-900">ของเสีย (ชิ้น)</legend>
      <div className="flex items-center justify-center gap-4">
        <button type="button" aria-label="ลดของเสีย" disabled={qty <= 0} onClick={() => onQty(Math.max(0, qty - 1))} className="flex h-16 w-16 items-center justify-center rounded-xl border-2 border-zinc-400 bg-white disabled:opacity-40">
          <Minus className="h-8 w-8" aria-hidden="true" />
        </button>
        <output aria-live="polite" className="min-w-16 text-center text-5xl font-bold tabular-nums text-zinc-900">
          {qty}
        </output>
        <button type="button" aria-label="เพิ่มของเสีย" disabled={qty >= 1000} onClick={() => onQty(qty + 1)} className="flex h-16 w-16 items-center justify-center rounded-xl border-2 border-zinc-400 bg-white disabled:opacity-40">
          <Plus className="h-8 w-8" aria-hidden="true" />
        </button>
      </div>
      {qty > 0 && (
        <div className="space-y-1.5">
          <p className="text-lg font-semibold text-zinc-900">เสียเพราะอะไร</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="เหตุผลของเสีย">
            {reasons.map((r) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={reason === r}
                onClick={() => onReason(r)}
                className={`min-h-14 rounded-xl border-2 px-5 text-xl font-semibold ${reason === r ? "border-primary-600 bg-primary-50 text-primary-900" : "border-zinc-400 bg-white text-zinc-900"}`}
              >
                {SCRAP_REASON_LABEL[r] ?? r}
              </button>
            ))}
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="text-lg font-semibold text-red-700">
          {error}
        </p>
      )}
    </fieldset>
  );
}
