"use client";

// RateCell — one editable (rate_key, scope) cell on /oem/rates. Saves on
// blur/Enter (optimistic; reverts the input back to the last-saved value on
// error), not as part of a page-wide submit — the owner fills this form one
// field at a time across days (T4 design brief).

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { saveRate } from "@/lib/actions/oem";
import type { OemRateStatusRow } from "@/lib/oem/types";
import { oemScopeLabel, oemUnitLabel, roundTo } from "@/lib/oem/display";
import { formatThaiDateOnly } from "@/lib/tiktok/format";
import { useToast } from "@/components/ui/Toast";

function toDisplay(row: OemRateStatusRow): string {
  if (row.value == null) return "";
  return row.inputUnit === "pct" ? String(roundTo(row.value * 100, 4)) : String(row.value);
}

// 0066: oem_rate_upsert now RAISES if these 3 keys are saved without a note
// (§3 of the migration) — recovery/sprue/polish are the ones owners
// systematically mis-estimate from memory. Without a visible field here, the
// owner would type a number, hit blur, and get a raw Postgres error with no
// idea what "p_note" means. cite = "from the melt house's last statement",
// not a guess.
const NOTE_REQUIRED_KEYS = new Set(["sprue_loss_pct", "recovery_rate_pct", "polish_loss_pct"]);

export function RateCell({ row }: { row: OemRateStatusRow }) {
  const toast = useToast();
  const router = useRouter();
  const isPct = row.inputUnit === "pct";
  const noteRequired = NOTE_REQUIRED_KEYS.has(row.rateKey);
  const [value, setValue] = useState(toDisplay(row));
  const [note, setNote] = useState(row.note ?? "");
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  // Resync from the server's last-known value after a refresh (e.g. this
  // exact save landing, or someone else editing the same shop concurrently).
  useEffect(() => {
    setValue(toDisplay(row));
    setNote(row.note ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.value, row.effectiveFrom, row.note]);

  const id = `oem-rate-${row.rateKey}-${row.scope}`;
  const unit = oemUnitLabel(row.rateKey, row.inputUnit);

  async function commit() {
    const trimmed = value.trim();
    if (trimmed === "") {
      setValue(toDisplay(row));
      return;
    }
    const raw = Number(trimmed);
    if (!Number.isFinite(raw) || raw < 0) {
      toast.push("ค่าต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป", "error");
      setValue(toDisplay(row));
      return;
    }
    if (isPct && raw >= 100) {
      toast.push("เปอร์เซ็นต์ต้องน้อยกว่า 100", "error");
      setValue(toDisplay(row));
      return;
    }
    const finalValue = isPct ? raw / 100 : raw;
    const trimmedNote = note.trim();
    const valueUnchanged = row.value != null && Math.abs(finalValue - row.value) < 1e-9;
    const noteUnchanged = trimmedNote === (row.note ?? "").trim();

    // 0066: DB now raises without a note on these 3 keys — surface that here
    // instead of letting the raw "22023" error be the owner's first hint.
    // Keep the typed number on screen (don't revert) so they don't lose it
    // while going to fill in the note field next to it.
    if (noteRequired && trimmedNote === "") {
      if (valueUnchanged) return; // just tabbed through, nothing to save
      toast.push("ช่องนี้ต้องระบุแหล่งที่มา (เช่น ใบชั่งจริง/ใบสรุปโรงหลอมรอบล่าสุด) ก่อนบันทึกได้", "error");
      return;
    }
    if (valueUnchanged && noteUnchanged) return; // no change

    setSaving(true);
    const result = await saveRate({
      rateKey: row.rateKey,
      value: finalValue,
      scope: row.scope,
      note: trimmedNote || null,
    });
    setSaving(false);
    if (!result.ok) {
      toast.push(result.error, "error");
      setValue(toDisplay(row));
      return;
    }
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 1500);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-0.5">
      {row.scopeKind !== "none" && (
        <span className="text-xs font-medium text-zinc-500">{oemScopeLabel(row.scopeKind, row.scope)}</span>
      )}
      <div className="flex items-center gap-1.5">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={0}
          step="any"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
          }}
          placeholder="ยังไม่กรอก"
          className="min-h-11 w-28 rounded-md border border-zinc-300 px-2.5 text-sm text-zinc-900 tabular-nums placeholder:text-zinc-400"
        />
        {unit && <span className="text-xs text-zinc-500">{unit}</span>}
        {saving && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-zinc-400" aria-hidden="true" />}
        {!saving && justSaved && <Check className="h-3.5 w-3.5 shrink-0 text-green-600" aria-hidden="true" />}
      </div>
      {/* 0066: sprue/recovery/polish are the 3 keys owners systematically
         mis-estimate from memory — DB now requires a cited source before it
         will save these. Shown only for those 3 keys, not every cell. */}
      {noteRequired && (
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
          }}
          placeholder="แหล่งที่มา เช่น ใบชั่งจริง/ใบสรุปโรงหลอมรอบล่าสุด (ห้ามกรอกจากความจำ)"
          aria-label="แหล่งที่มาของตัวเลขนี้"
          className="min-h-9 w-64 max-w-full rounded-md border border-zinc-300 px-2.5 text-xs text-zinc-900 placeholder:text-zinc-400"
        />
      )}
      {row.effectiveFrom && !row.isMissing && (
        <span className="text-[0.68rem] text-zinc-400">มีผลตั้งแต่ {formatThaiDateOnly(row.effectiveFrom)}</span>
      )}
    </div>
  );
}
