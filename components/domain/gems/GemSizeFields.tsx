"use client";

// GemSizeFields — ช่องขนาด (มม.) ตามรูปทรง: 1 ค่า = ช่องเดียว · 2 ค่า = [กว้าง] × [ยาว] · UX §3.3
// รับ , เป็น . (ทำที่ parseGemSize) · กรอกกลับด้าน (6×4) → จอบอก "เรียงเป็น 4×6 ให้" · > 30 มม. ขึ้นกล่อง amber + ติ๊กยืนยัน (R4) · ขนาดละ 1 แถว (ไม่มีช่วง)
// ชิป "เคยใช้" = ขนาดที่เคยมีของชนิด+รูปทรงนี้ (สูงสุด 6) — ลดการสะกดขนาดต่าง (4×6 กับ 4.0×6.0)

import { GEM_FIELD, FieldMsg } from "@/components/domain/gems/ui";
import type { GemDraftRow, RowIssue } from "@/lib/jobs/gem-draft";
import { rowSizes } from "@/lib/jobs/gem-draft";
import { GEM_LIMITS, gemSizeLabel, gemSizeNeedsConfirm } from "@/lib/jobs/shop-gems";

export interface SizeChip {
  sizeA: number;
  sizeB: number | null;
  label: string;
}

export function GemSizeFields({
  idBase,
  row,
  issues,
  disabled,
  chips,
  onSize,
  onConfirmBig,
}: {
  idBase: string;
  row: GemDraftRow;
  /** ปัญหาที่ต้องแสดง (กรองแล้วตาม touched/showIssues) */
  issues: RowIssue[];
  disabled?: boolean;
  chips: SizeChip[];
  onSize: (a: string, b: string) => void;
  onConfirmBig: (v: boolean) => void;
}) {
  const two = row.shape?.hasLength === true;
  const sz = rowSizes(row);
  const errA = issues.find((i) => i.field === "size_a" && !i.message.startsWith("ขนาดใหญ่ผิดปกติ"));
  const errB = issues.find((i) => i.field === "size_b");
  const needBig = sz !== null && gemSizeNeedsConfirm(sz.a, sz.b);
  const bigWhich = sz ? (sz.b !== null && sz.b > GEM_LIMITS.sizeWarn ? sz.b : sz.a) : null;
  return (
    <div>
      <div className="flex items-center gap-1.5">
        <input
          id={`${idBase}-a`}
          aria-label={two ? "ขนาดด้านกว้าง (มม.)" : "ขนาด (มม.)"}
          inputMode="decimal"
          autoComplete="off"
          value={row.sizeA}
          disabled={disabled || !row.shape}
          aria-invalid={errA ? true : undefined}
          aria-describedby={errA ? `${idBase}-a-err` : undefined}
          onChange={(e) => onSize(e.target.value, row.sizeB)}
          className={`${GEM_FIELD} min-w-0 tabular-nums`}
        />
        {two && (
          <>
            <span aria-hidden="true" className="text-zinc-700">
              ×
            </span>
            <input
              id={`${idBase}-b`}
              aria-label="ขนาดด้านยาว (มม.)"
              inputMode="decimal"
              autoComplete="off"
              value={row.sizeB}
              disabled={disabled}
              aria-invalid={errB ? true : undefined}
              aria-describedby={errB ? `${idBase}-b-err` : undefined}
              onChange={(e) => onSize(row.sizeA, e.target.value)}
              className={`${GEM_FIELD} min-w-0 tabular-nums`}
            />
          </>
        )}
        <span className="shrink-0 text-sm text-zinc-700">มม.</span>
      </div>
      {!row.shape && <p className="mt-1 text-xs text-zinc-700">เลือกรูปทรงก่อน</p>}
      {errA && <FieldMsg id={`${idBase}-a-err`}>{errA.message}</FieldMsg>}
      {errB && <FieldMsg id={`${idBase}-b-err`}>{errB.message}</FieldMsg>}
      {sz?.swapped && (
        <p className="mt-1 text-xs text-zinc-800" data-testid="gem-swapped">
          เรียงเป็น {gemSizeLabel(sz.a, sz.b)} ให้
        </p>
      )}
      {needBig && (
        <div className="mt-1 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-950" data-testid="gem-big-size">
          <p className="font-medium">ขนาด {bigWhich} มม. ใหญ่ผิดปกติสำหรับพลอยเครื่องประดับ — ตรวจว่าเป็นมิลลิเมตร</p>
          <label className="mt-1 flex min-h-11 items-center gap-2">
            <input type="checkbox" className="h-5 w-5 accent-primary-600" checked={row.bigConfirmed} disabled={disabled} onChange={(e) => onConfirmBig(e.target.checked)} />
            ใช่ ขนาดนี้ถูกต้อง
          </label>
        </div>
      )}
      {chips.length > 0 && (
        <div role="group" className="mt-1 flex flex-wrap items-center gap-1.5" aria-label="ขนาดที่เคยใช้">
          <span className="text-xs text-zinc-700">เคยใช้:</span>
          {chips.slice(0, 6).map((c) => (
            <button
              key={c.label}
              type="button"
              disabled={disabled}
              onClick={() => onSize(String(c.sizeA), c.sizeB === null ? "" : String(c.sizeB))}
              className="min-h-9 rounded-full border border-zinc-300 bg-white px-3 text-sm tabular-nums text-zinc-900 hover:bg-zinc-50"
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
