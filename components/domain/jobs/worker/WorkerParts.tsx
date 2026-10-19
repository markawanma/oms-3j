"use client";

// WorkerParts — ชิ้นส่วนหน้าช่าง (/w/<token>): แป้น PIN · ช่องน้ำหนัก · แถบขั้น (ปัจจุบัน ±1) · ตัวนับของเสีย (+1/+5/+10) · skeleton ก่อน hydrate
// มือถือเป็นหลัก · ตัวอักษร ≥ 18px · ปุ่มหลัก ≥ 56px · ไทยล้วน · ไม่มีลิงก์/เมนูไปหน้าอื่น

import { useState, useSyncExternalStore } from "react";
import type { ButtonHTMLAttributes } from "react";
import { Check, Loader2, Minus, Plus } from "lucide-react";
import { SCRAP_REASON_LABEL, STAGE_STATUS_LABEL } from "@/lib/jobs/types";
import type { WorkerViewStage } from "@/lib/jobs/worker-view";

export const BIG_BTN = "inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-xl px-5 text-xl font-bold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-300 disabled:cursor-not-allowed disabled:opacity-50";

const noopSubscribe = () => () => {};
/** false ตอน SSR/ก่อน hydrate เสร็จ · true หลังจากนั้น — ปุ่มที่กดก่อน hydrate จะ "ไม่ติด" (ไม่มี handler) จึงโชว์ skeleton แทนจนกว่าจะพร้อม */
export function useHydrated(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

export function PanelSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="กำลังโหลด" className="animate-pulse space-y-3">
      <div className="h-8 w-2/3 rounded-lg bg-zinc-200" />
      <div className="h-16 rounded-xl bg-zinc-200" />
      <div className="h-14 rounded-xl bg-zinc-200" />
      <span className="sr-only">กำลังโหลด…</span>
    </div>
  );
}

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
  const KEY = "min-h-14 rounded-xl border border-zinc-300 bg-white text-3xl font-bold text-zinc-900 active:bg-zinc-100 disabled:opacity-50";
  return (
    <div>
      <div className="mb-3 flex justify-center gap-4" role="img" aria-label={`ใส่ PIN แล้ว ${value.length} จาก 4 หลัก`}>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={`h-5 w-5 rounded-full border-2 ${i < value.length ? "border-zinc-900 bg-zinc-900" : "border-zinc-400 bg-white"}`} />
        ))}
      </div>
      <div className="mx-auto grid max-w-xs grid-cols-3 gap-2.5">
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
  size = "lg",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  required: boolean;
  hint?: string | null;
  error?: string | null;
  /** md = ช่อง min-h-14 text-2xl (จอส่ง/รับ v2 — ไม่แย่งความสำคัญกับเลขจำนวน) · lg = เดิม (36px) */
  size?: "md" | "lg";
}) {
  return (
    <div className="space-y-1">
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
        onFocus={(e) => e.target.select()}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined}
        className={`w-full rounded-xl border-2 bg-white px-4 text-center font-bold tabular-nums text-zinc-900 focus:border-primary-600 focus:outline-none focus:ring-4 focus:ring-primary-200 ${size === "md" ? "min-h-14 text-2xl" : "min-h-16 text-4xl"} ${required && value.trim() === "" && size === "md" ? "border-amber-400" : "border-zinc-400"}`}
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
/** ขั้นตอน: โชว์เฉพาะขั้นปัจจุบัน ±1 (กางดูทั้งหมดได้) — วางล่างปุ่มหลักเพื่อให้ปุ่มอยู่จอแรก */
export function StageStrip({ stages, currentSeq }: { stages: WorkerViewStage[]; currentSeq: number | null }) {
  const [all, setAll] = useState(false);
  const idx = currentSeq === null ? -1 : stages.findIndex((s) => s.seq === currentSeq);
  const around = idx < 0 ? 0 : idx;
  const visible = all || stages.length <= 3 ? stages : stages.filter((_, i) => Math.abs(i - around) <= 1);
  return (
    <section aria-label="ขั้นตอนของใบงาน" className="space-y-1.5">
      <ol className="space-y-1">
        {visible.map((s) => {
          const done = s.status === "sent" || s.status === "skipped";
          const active = s.seq === currentSeq;
          return (
            <li
              key={s.seq}
              aria-current={active ? "step" : undefined}
              className={`flex min-h-11 items-center gap-3 rounded-lg px-3 text-lg ${active ? "bg-primary-50 font-bold text-primary-900 ring-2 ring-primary-600" : done ? "text-zinc-600" : "text-zinc-900"}`}
            >
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${done ? "border-green-700 bg-green-700 text-white" : active ? "border-primary-600" : "border-zinc-400"}`} aria-hidden="true">
                {done && <Check className="h-4 w-4" />}
              </span>
              <span className="min-w-0 flex-1 break-words">{s.name}</span>
              <span className="shrink-0 text-base">{STAGE_STATUS_LABEL[s.status] ?? s.status}</span>
            </li>
          );
        })}
      </ol>
      {stages.length > 3 && (
        <button type="button" onClick={() => setAll((v) => !v)} aria-expanded={all} className="min-h-12 w-full rounded-lg text-lg font-semibold text-primary-800 underline">
          {all ? "ย่อรายการขั้น" : `ดูขั้นทั้งหมด (${stages.length})`}
        </button>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
const QTY_BTN = "flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border-2 border-zinc-400 bg-white font-bold text-zinc-900 disabled:opacity-40";

/**
 * ตัวเพิ่ม/ลดจำนวนชิ้น (− n +) ปุ่ม 56px + พิมพ์ได้ (0181 ส่งต่อ n จาก N · รับจำนวนจริง)
 * ค่าเป็นข้อความ (พิมพ์ทีละตัวได้) — ผู้เรียกตรวจรูปแบบด้วย parseQtyText · ตัวเลขช่องกรอก ≥ 24px ตามสเปก · พิมพ์ได้เฉพาะตัวเลข (inputMode numeric)
 * min/max จำกัดปุ่ม ± เท่านั้น (ค่าที่พิมพ์เองตรวจตอนกดปุ่มหลัก) · ไม่มีตัวเลขเงิน/น้ำหนัก
 */
export function QtyStepper({
  id,
  label,
  value,
  onChange,
  min = 1,
  max,
  hint,
  error,
  disabled,
  size,
  hideLabel,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  min?: number;
  max: number;
  hint?: string | null;
  error?: string | null;
  disabled?: boolean;
  /** hero = ตัวเลขตัดสินใจตัวเดียวของจอส่ง/รับ v2 (text-5xl) */
  size?: "hero";
  /** ป้ายเห็นอยู่ที่หัวการ์ดแล้ว — ซ่อนจากสายตาแต่คงไว้ให้ screen reader/ปุ่ม ± */
  hideLabel?: boolean;
}) {
  const cur = /^\d+$/.test(value.trim()) ? Number(value.trim()) : null;
  const bump = (d: number) => onChange(String(Math.min(max, Math.max(min, (cur ?? min) + d))));
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className={hideLabel ? "sr-only" : "block text-lg font-semibold text-zinc-900"}>
        {label}
      </label>
      <div className="flex items-center gap-3">
        <button type="button" aria-label={`ลด${label}`} disabled={disabled || (cur !== null && cur <= min)} onClick={() => bump(-1)} className={QTY_BTN}>
          <Minus className="h-7 w-7" aria-hidden="true" />
        </button>
        <input
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          enterKeyHint="done"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ""))}
          onFocus={(e) => e.target.select()}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined}
          className={`min-w-0 flex-1 rounded-xl border-2 border-zinc-900 bg-white px-3 text-center font-bold tabular-nums text-zinc-900 focus:border-primary-600 focus:outline-none focus:ring-4 focus:ring-primary-200 disabled:opacity-50 ${size === "hero" ? "min-h-16 text-5xl" : "min-h-14 text-3xl"}`}
        />
        <button type="button" aria-label={`เพิ่ม${label}`} disabled={disabled || (cur !== null && cur >= max)} onClick={() => bump(1)} className={QTY_BTN}>
          <Plus className="h-7 w-7" aria-hidden="true" />
        </button>
      </div>
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
const STEP_BTN ="flex items-center justify-center rounded-xl border-2 border-zinc-400 bg-white font-bold text-zinc-900 disabled:opacity-40";

export function ScrapStepper({
  qty,
  onQty,
  reason,
  onReason,
  reasons,
  error,
  compact,
}: {
  qty: number;
  onQty: (n: number) => void;
  reason: string | null;
  onReason: (r: string) => void;
  reasons: string[];
  error?: string | null;
  /** เลขลดเป็น 30px (ใช้ในแถวของเสียที่พับได้ของจอส่ง v2 — เลข 48px เป็นของจำนวนที่ส่ง) */
  compact?: boolean;
}) {
  const bump = (d: number) => onQty(Math.min(1000, Math.max(0, qty + d)));
  return (
    <fieldset className="space-y-2">
      <legend className="text-lg font-semibold text-zinc-900">ของเสีย (ชิ้น)</legend>
      <div className="flex items-center justify-center gap-4">
        <button type="button" aria-label="ลดของเสีย" disabled={qty <= 0} onClick={() => bump(-1)} className={`${STEP_BTN} h-14 w-16`}>
          <Minus className="h-7 w-7" aria-hidden="true" />
        </button>
        <output aria-live="polite" className={`min-w-16 text-center font-bold tabular-nums text-zinc-900 ${compact ? "text-3xl" : "text-5xl"}`}>
          {qty}
        </output>
        <button type="button" aria-label="เพิ่มของเสีย" disabled={qty >= 1000} onClick={() => bump(1)} className={`${STEP_BTN} h-14 w-16`}>
          <Plus className="h-7 w-7" aria-hidden="true" />
        </button>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {[-10, -5, 5, 10].map((d) => (
          <button
            key={d}
            type="button"
            aria-label={`${d < 0 ? "ลด" : "เพิ่ม"}ของเสีย ${Math.abs(d)} ชิ้น`}
            disabled={d < 0 ? qty <= 0 : qty >= 1000}
            onClick={() => bump(d)}
            className={`${STEP_BTN} min-h-14 text-xl`}
          >
            {d > 0 ? `+${d}` : `−${-d}`}
          </button>
        ))}
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
                className={`min-h-14 rounded-xl border-2 px-4 text-xl font-semibold ${reason === r ? "border-primary-600 bg-primary-50 text-primary-900" : "border-zinc-400 bg-white text-zinc-900"}`}
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

// ---------------------------------------------------------------------------
// จอส่ง/รับ v2 (ux-worker-send-receive-v2.md): แถบแบ่งก้อน + คำอธิบายใต้แถบ + ชิป toggle
// สี = ของอยู่กับใคร (ตาราง §2): ส่งไป = น้ำเงิน · อยู่กับฉัน/ได้รับ = อำพัน · เสีย/ขาด = แดง · ไม่ใช้เขียน (กันสับสนกับ "เสร็จ/ผ่าน QC") · ข้อความกำกับทุกครั้ง ไม่พึ่งสีอย่างเดียว

export type QtyTone = "sent" | "mine" | "bad";
const BAR_TONE: Record<QtyTone, string> = { sent: "bg-sky-700", mine: "bg-amber-600", bad: "bg-red-700" };
const CARD_TONE: Record<QtyTone, string> = { sent: "bg-sky-50 text-sky-950", mine: "bg-amber-50 text-amber-950", bad: "bg-red-50 text-red-900" };
const DOT_TONE: Record<QtyTone, string> = { sent: "text-sky-700", mine: "text-amber-600", bad: "text-red-700" };

/** แถบเดียวแบ่งก้อน (สูง 24px) — ก้อน qty=0 ไม่วาด · ก้อน > 0 กว้างไม่ต่ำกว่า 8px · empty = เทา (ช่องจำนวนว่างระหว่างพิมพ์) */
export function QtyBar({ segments, total, label, empty = false }: { segments: { key: string; qty: number; tone: QtyTone }[]; total: number; label: string; empty?: boolean }) {
  const base = Math.max(total, 1);
  return (
    <div data-testid="qty-bar" role="img" aria-label={label} className="flex h-6 w-full gap-0.5 overflow-hidden rounded-full bg-zinc-100">
      {empty ? (
        <span className="h-full w-full bg-zinc-300" />
      ) : (
        segments
          .filter((s) => s.qty > 0)
          .map((s) => (
            <span key={s.key} className={`h-full transition-[width] duration-150 motion-reduce:transition-none ${BAR_TONE[s.tone]}`} style={{ width: `${(s.qty / base) * 100}%`, minWidth: "8px" }} />
          ))
      )}
    </div>
  );
}

/** คำอธิบายใต้แถบ: ■ + label 16px + เลข 24px · 1–3 ช่อง · role="status" aria-live (ตัวเดียวต่อจอ) · qty null = "—" */
export function QtyLegend({ items }: { items: { key: string; label: string; qty: number | null; tone: QtyTone; prefix?: string }[] }) {
  return (
    <div role="status" aria-live="polite" className={`grid gap-2 ${items.length >= 3 ? "grid-cols-3" : items.length === 2 ? "grid-cols-2" : "grid-cols-1"}`}>
      {items.map((it) => (
        <div key={it.key} className={`rounded-xl p-2 ${CARD_TONE[it.tone]}`}>
          <div className="text-base font-semibold break-words">
            <span aria-hidden="true" className={DOT_TONE[it.tone]}>
              {it.prefix ?? "■"}
            </span>{" "}
            {it.label}
          </div>
          <div className="text-2xl font-bold tabular-nums">{it.qty === null ? "—" : it.qty}</div>
        </div>
      ))}
    </div>
  );
}

/** ชิป toggle "ส่งหมด N" / "ครบ N" (สูง 48px) — pressed = พื้นดำ (กำลังอยู่โหมดนี้) */
export function QtyAllChip({ label, pressed, onClick, disabled }: { label: string; pressed: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={`min-h-12 shrink-0 rounded-xl border-2 px-4 text-lg font-semibold disabled:opacity-50 ${pressed ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-400 bg-white text-zinc-900"}`}
    >
      {label}
    </button>
  );
}
