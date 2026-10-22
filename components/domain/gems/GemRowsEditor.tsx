"use client";

// GemRowsEditor — ตัวแก้รายการพลอยต่อชิ้น (ฟอร์มสร้างใบงาน · แก้พลอยของใบ · แม่แบบ SKU) — UX §3.3 §5.1 §10
//  - controlled: รับ rows + onChange เท่านั้น (ไม่เรียก server เอง) · ชื่อใหม่ (ชนิด/รูปทรง) อยู่ในเครื่องจนผู้ใช้กดบันทึก/สร้างใบ (UX P2) — ขึ้นรายการของแถวถัดไปพร้อมป้าย "ใหม่"
//  - ป้าย (ไอคอน+คำ ไม่พึ่งสี): จากแม่แบบ · แก้แล้ว · ใหม่ · แถวซ้ำ = กล่อง amber + ปุ่ม "รวมเข้าแถว n" (ไม่รวมเงียบๆ)
//  - รวมทั้งใบ = จำนวน/ชิ้น × จำนวนที่จะผลิต (จำนวนเต็ม ไม่มีปัดเศษ · DB คำนวณซ้ำและชนะ) · บอกตัวคูณตรงๆ
//  - 🔴 ไม่มีช่อง/ข้อความเรื่องราคา ต้นทุน เผื่อแตก (ฟอร์มนี้ staff ใช้ได้) · เทสต์ล็อก
//  - layout "card" (1 คอลัมน์ → 2 ที่ ≥ sm) | "grid" (12 คอลัมน์ที่ ≥ md — ใช้ใน Modal กว้าง)

import { useEffect, useRef, useState } from "react";
import { Plus, Sparkles, Trash2 } from "lucide-react";
import { Skeleton } from "@/components/ui/Skeleton";
import { GemPicker } from "@/components/domain/gems/GemPicker";
import type { PickerOption } from "@/components/domain/gems/GemPicker";
import { GemSizeFields } from "@/components/domain/gems/GemSizeFields";
import type { SizeChip } from "@/components/domain/gems/GemSizeFields";
import { FieldMsg, GEM_FIELD } from "@/components/domain/gems/ui";
import { draftTotals, emptyGemRow, findDuplicateRows, gemRowIssues, mergeDraftRows, pendingNewNames, rowIncompleteReason, rowLabelPreview, unlockRow } from "@/lib/jobs/gem-draft";
import type { GemDraftRow, RowField, RowIssue } from "@/lib/jobs/gem-draft";
import type { GemOptions } from "@/lib/jobs/gems";
import { gemSizeLabel } from "@/lib/jobs/shop-gems";

export type GemRowServerErrors = Record<string, { field: string | null; message: string }>;

const fmt = (n: number) => n.toLocaleString("en-US");

export function GemRowsEditor({
  idPrefix,
  rows,
  onChange,
  options,
  optionsState,
  optionsError,
  onRetryOptions,
  qtyPlanned,
  qtyNote,
  showIssues = false,
  serverErrors,
  onForceSimilar,
  disabled,
  emptyText = "ยังไม่มีพลอยในใบนี้",
  layout = "card",
  presentation = "popover",
  showTotals = true,
}: {
  idPrefix: string;
  rows: GemDraftRow[];
  onChange: (rows: GemDraftRow[]) => void;
  options: GemOptions | null;
  optionsState: "loading" | "error" | "ready";
  optionsError?: string | null;
  onRetryOptions?: () => void;
  /** จำนวนที่จะเริ่มผลิต (null = ยังไม่รู้ → ไม่แสดงรวม) */
  qtyPlanned: number | null;
  /** เช่น "สั่ง 30 + เผื่อ 5" */
  qtyNote?: string | null;
  /** true = แสดงปัญหาของทุกแถวทันที (หลังกดบันทึกครั้งแรก) · ไม่ใช่ = เฉพาะแถวที่ผู้ใช้แตะแล้ว */
  showIssues?: boolean;
  serverErrors?: GemRowServerErrors;
  onForceSimilar?: () => void;
  disabled?: boolean;
  emptyText?: string;
  layout?: "card" | "grid";
  presentation?: "popover" | "sheet";
  /** false = ไม่แสดง "รวม" (แม่แบบ SKU — ไม่มีจำนวนผลิต) */
  showTotals?: boolean;
}) {
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const addRef = useRef<HTMLButtonElement>(null);

  // โฟกัสช่องชนิดของแถวใหม่ หลัง render
  useEffect(() => {
    if (!focusKey) return;
    document.getElementById(`${idPrefix}-${focusKey}-type-btn`)?.focus();
    setFocusKey(null);
  }, [focusKey, idPrefix, rows]);

  const typeOptions: PickerOption[] = options ? options.types.map((t) => ({ id: t.id, name: t.name })) : [];
  const shapeOptions: PickerOption[] = options ? options.shapes.map((s) => ({ id: s.id, name: s.name, hasLength: s.hasLength })) : [];
  const pendingTypes = pendingNewNames(rows, "type");
  const pendingShapes = pendingNewNames(rows, "shape");
  const dups = findDuplicateRows(rows);
  const { lineTotals, total } = draftTotals(rows, qtyPlanned);

  function patch(i: number, p: Partial<GemDraftRow>) {
    onChange(rows.map((r, k) => (k === i ? { ...r, ...p, edited: r.origin === "manual" ? r.edited : true } : r)));
  }
  const touch = (key: string) => setTouched((s) => (s.has(key) ? s : new Set(s).add(key)));

  function addRow() {
    const r = emptyGemRow("manual");
    onChange([...rows, r]);
    setFocusKey(r.key);
  }

  function removeRow(i: number) {
    onChange(rows.filter((_, k) => k !== i));
    setNotice("ลบแถวแล้ว");
    // โฟกัสไม่หล่น: ไปที่ปุ่ม "เพิ่มพลอย"
    setTimeout(() => addRef.current?.focus(), 0);
  }

  const lastIncomplete = rows.length > 0 ? rowIncompleteReason(rows[rows.length - 1]) : null;

  function sizeChips(r: GemDraftRow): SizeChip[] {
    if (!options || r.type?.kind !== "existing" || r.shape?.kind !== "existing") return [];
    const t = r.type.id;
    const s = r.shape.id;
    return options.items
      .filter((it) => it.typeId === t && it.shapeId === s)
      .slice(0, 6)
      .map((it) => ({ sizeA: it.sizeA, sizeB: it.sizeB, label: gemSizeLabel(it.sizeA, it.sizeB) }));
  }

  return (
    <div className="space-y-3" data-testid="gem-rows-editor">
      {optionsState === "loading" && (
        <div role="status" aria-label="กำลังโหลดรายการพลอย" className="space-y-1.5">
          <Skeleton className="h-4 w-48" />
        </div>
      )}
      {optionsState === "error" && (
        <p role="status" className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-sm font-medium text-amber-950">
          โหลดรายการพลอยไม่ได้ — พิมพ์ชื่อเองได้ แต่ระบบยังเช็คชื่อซ้ำให้ไม่ได้ {optionsError ? `(${optionsError})` : ""}
          {onRetryOptions && (
            <button type="button" onClick={onRetryOptions} className="ml-2 min-h-11 px-2 font-semibold underline">
              ลองอีกครั้ง
            </button>
          )}
        </p>
      )}

      {rows.length === 0 && (
        <p className="rounded-md border border-dashed border-zinc-300 bg-white p-3 text-sm text-zinc-800" data-testid="gem-empty">
          {emptyText}
        </p>
      )}

      <ol className="space-y-3">
        {rows.map((r, i) => {
          const base = `${idPrefix}-${r.key}`;
          const visible = showIssues || touched.has(r.key);
          const all = gemRowIssues(r);
          const issues: RowIssue[] = visible ? all : [];
          const byField = (f: RowField) => issues.find((x) => x.field === f);
          const srv = serverErrors?.[r.key];
          const dupOf = dups.get(i);
          const preview = rowLabelPreview(r);
          const badges: { text: string; tone: string; icon?: boolean }[] = [];
          if (r.origin === "template" && !r.edited) badges.push({ text: "จากแม่แบบ", tone: "bg-sky-100 text-sky-950" });
          if (r.origin !== "manual" && r.edited) badges.push({ text: "แก้แล้ว", tone: "bg-amber-100 text-amber-950" });
          if (r.type?.kind === "new" || r.shape?.kind === "new") badges.push({ text: "ใหม่", tone: "bg-sky-100 text-sky-950", icon: true });
          const grid = layout === "grid";
          return (
            <li key={r.key} className={`rounded-md border p-3 ${srv ? "border-red-400 bg-red-50/40" : "border-zinc-300 bg-white"}`} data-testid={`gem-row-${i + 1}`} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) touch(r.key); }}>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-zinc-900">แถว {i + 1}</span>
                {badges.map((b) => (
                  <span key={b.text} className={`inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-xs font-medium ${b.tone}`}>
                    {b.icon && <Sparkles className="h-3 w-3" aria-hidden="true" />}
                    {b.text}
                  </span>
                ))}
                <button
                  type="button"
                  onClick={() => removeRow(i)}
                  disabled={disabled}
                  aria-label={`ลบพลอยแถว ${i + 1}`}
                  className="ml-auto inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-zinc-700 hover:bg-red-50 hover:text-red-700"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>

              {r.itemId !== null ? (
                <div className={`grid gap-2 ${grid ? "md:grid-cols-12" : "sm:grid-cols-2"}`}>
                  <div className={grid ? "md:col-span-9" : "sm:col-span-2"}>
                    <p className="text-sm font-medium text-zinc-800">รายการ</p>
                    <p className="flex flex-wrap items-center gap-2 text-base font-semibold text-zinc-900 break-words [overflow-wrap:anywhere]" data-testid={`gem-row-label-${i + 1}`}>
                      {r.label}
                      <button type="button" disabled={disabled} onClick={() => patch(i, unlockRow(r, options))} className="min-h-11 px-2 text-sm font-medium text-primary-700 underline">
                        เปลี่ยนรายการ
                      </button>
                    </p>
                  </div>
                  <QtyAndPos i={i} base={base} r={r} disabled={disabled} issues={issues} grid={grid} showTotals={showTotals} lineTotal={lineTotals[i]} onPatch={(p) => patch(i, p)} />
                </div>
              ) : (
                <div className={`grid gap-2 ${grid ? "md:grid-cols-12" : "sm:grid-cols-2"}`}>
                  <div className={grid ? "md:col-span-4" : ""}>
                    <p className="text-sm font-medium text-zinc-800">ชนิด *</p>
                    <GemPicker
                      kind="type"
                      id={`${base}-type`}
                      label={`ชนิดพลอยแถว ${i + 1}`}
                      options={typeOptions}
                      pending={pendingTypes.filter((p) => !(r.type?.kind === "new" && p.name === r.type.name))}
                      loading={optionsState === "loading"}
                      loadError={optionsState === "error" ? (optionsError ?? "โหลดไม่ได้") : null}
                      onRetry={onRetryOptions}
                      presentation={presentation}
                      disabled={disabled}
                      invalid={!!byField("type")}
                      describedBy={byField("type") ? `${base}-type-err` : undefined}
                      value={r.type}
                      onSelect={(v) => patch(i, { type: v, itemId: null })}
                      onForceSimilar={onForceSimilar}
                      onNotice={setNotice}
                    />
                    {byField("type") && <FieldMsg id={`${base}-type-err`}>{byField("type")!.message}</FieldMsg>}
                  </div>
                  <div className={grid ? "md:col-span-3" : ""}>
                    <p className="text-sm font-medium text-zinc-800">รูปทรง *</p>
                    <GemPicker
                      kind="shape"
                      id={`${base}-shape`}
                      label={`รูปทรงแถว ${i + 1}`}
                      options={shapeOptions}
                      pending={pendingShapes.filter((p) => !(r.shape?.kind === "new" && p.name === r.shape.name))}
                      loading={optionsState === "loading"}
                      loadError={optionsState === "error" ? (optionsError ?? "โหลดไม่ได้") : null}
                      onRetry={onRetryOptions}
                      presentation={presentation}
                      disabled={disabled}
                      invalid={!!byField("shape")}
                      describedBy={byField("shape") ? `${base}-shape-err` : undefined}
                      value={r.shape}
                      onSelect={(v) => {
                        // เปลี่ยนรูปทรงหลังกรอกขนาด: ค่าที่เข้ากันเก็บไว้ ที่เกินล้าง + บอก
                        const dropB = !v.hasLength && r.sizeB.trim() !== "";
                        if (dropB) setNotice("รูปทรงนี้ใส่ขนาดค่าเดียว — ล้างด้านที่สองออกแล้ว");
                        patch(i, { shape: v, itemId: null, sizeB: v.hasLength ? r.sizeB : "", bigConfirmed: false });
                      }}
                      onForceSimilar={onForceSimilar}
                      onNotice={setNotice}
                    />
                    {byField("shape") && <FieldMsg id={`${base}-shape-err`}>{byField("shape")!.message}</FieldMsg>}
                  </div>
                  <div className={grid ? "md:col-span-5" : "sm:col-span-2"}>
                    <p className="text-sm font-medium text-zinc-800">ขนาด (มม.) *</p>
                    <GemSizeFields
                      idBase={`${base}-size`}
                      row={r}
                      issues={issues}
                      disabled={disabled}
                      chips={sizeChips(r)}
                      onSize={(a, b) => patch(i, { sizeA: a, sizeB: b, bigConfirmed: false })}
                      onConfirmBig={(v) => patch(i, { bigConfirmed: v })}
                    />
                  </div>
                  <QtyAndPos i={i} base={base} r={r} disabled={disabled} issues={issues} grid={grid} showTotals={showTotals} lineTotal={lineTotals[i]} onPatch={(p) => patch(i, p)} />
                </div>
              )}

              {preview && r.itemId === null && (
                <p className="mt-2 text-sm text-zinc-800 break-words [overflow-wrap:anywhere]" data-testid={`gem-preview-${i + 1}`}>
                  ตัวอย่างชื่อ: {preview} <span className="text-zinc-600">(ระบบตั้งชื่อจริงตอนบันทึก)</span>
                </p>
              )}
              {dupOf !== undefined && (
                <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-950" data-testid={`gem-dup-${i + 1}`}>
                  <p className="font-medium">มีพลอยแบบเดียวกันอยู่แล้วที่แถว {dupOf + 1}</p>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      onChange(mergeDraftRows(rows, i, dupOf));
                      setNotice(`รวมเข้าแถว ${dupOf + 1} แล้ว`);
                    }}
                    className="mt-1 min-h-11 rounded-md border border-amber-400 bg-white px-3 font-medium hover:bg-amber-100"
                  >
                    รวมเข้าแถว {dupOf + 1}
                  </button>
                </div>
              )}
              {srv && (
                <p role="alert" className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-sm font-medium text-red-800 break-words" data-testid={`gem-server-error-${i + 1}`}>
                  พลอยแถว {i + 1}: {srv.message}
                </p>
              )}
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-center gap-3">
        <button
          ref={addRef}
          type="button"
          disabled={disabled}
          aria-disabled={lastIncomplete ? true : undefined}
          aria-describedby={lastIncomplete ? `${idPrefix}-add-why` : undefined}
          onClick={() => {
            if (lastIncomplete) {
              setTouched((s) => new Set(s).add(rows[rows.length - 1].key));
              return;
            }
            addRow();
          }}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-4 font-medium text-zinc-900 hover:bg-zinc-50 aria-disabled:opacity-60"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          เพิ่มพลอย
        </button>
        {rows.length > 0 && (
          <p role="status" aria-live="polite" className="ml-auto text-base font-bold text-zinc-900 tabular-nums" data-testid="gem-grand-total">
            รวม {rows.length} รายการ{showTotals && total !== null ? ` · ${fmt(total)} เม็ด` : ""}
          </p>
        )}
      </div>
      {lastIncomplete && (
        <p id={`${idPrefix}-add-why`} className="text-xs text-zinc-700">
          กรอกแถว {rows.length} ให้ครบก่อน — {lastIncomplete}
        </p>
      )}
      {showTotals && qtyPlanned !== null && rows.length > 0 && (
        <p className="text-xs text-zinc-700" data-testid="gem-multiplier">
          คูณด้วยจำนวนที่จะผลิต {fmt(qtyPlanned)} ชิ้น{qtyNote ? ` (${qtyNote})` : ""} · ตัวเลขสุดท้ายระบบคำนวณซ้ำตอนบันทึก
        </p>
      )}
      <p aria-live="polite" className="min-h-4 text-xs font-medium text-zinc-800" data-testid="gem-notice">
        {notice}
      </p>
    </div>
  );
}

function QtyAndPos({
  i,
  base,
  r,
  disabled,
  issues,
  grid,
  showTotals,
  lineTotal,
  onPatch,
}: {
  i: number;
  base: string;
  r: GemDraftRow;
  disabled?: boolean;
  issues: RowIssue[];
  grid: boolean;
  showTotals: boolean;
  lineTotal: number | null;
  onPatch: (p: Partial<GemDraftRow>) => void;
}) {
  const qErr = issues.find((x) => x.field === "qty_per_piece");
  const pErr = issues.find((x) => x.field === "position");
  return (
    <>
      <div className={grid ? "md:col-span-3" : ""}>
        <label htmlFor={`${base}-qty`} className="text-sm font-medium text-zinc-800">
          จำนวนต่อชิ้น *
        </label>
        <input
          id={`${base}-qty`}
          inputMode="numeric"
          autoComplete="off"
          value={r.qty}
          disabled={disabled}
          aria-invalid={qErr ? true : undefined}
          aria-describedby={qErr ? `${base}-qty-err` : undefined}
          onChange={(e) => onPatch({ qty: e.target.value })}
          className={`${GEM_FIELD} tabular-nums`}
        />
        {qErr && <FieldMsg id={`${base}-qty-err`}>{qErr.message}</FieldMsg>}
      </div>
      <div className={grid ? "md:col-span-6" : ""}>
        <label htmlFor={`${base}-pos`} className="text-sm font-medium text-zinc-800">
          ตำแหน่ง <span className="font-normal text-zinc-700">· ไม่บังคับ</span>
        </label>
        <input
          id={`${base}-pos`}
          value={r.position}
          disabled={disabled}
          maxLength={60}
          aria-invalid={pErr ? true : undefined}
          aria-describedby={pErr ? `${base}-pos-err` : undefined}
          onChange={(e) => onPatch({ position: e.target.value })}
          className={GEM_FIELD}
        />
        {pErr && <FieldMsg id={`${base}-pos-err`}>{pErr.message}</FieldMsg>}
      </div>
      {showTotals && (
        <div className={`${grid ? "md:col-span-3" : ""} flex items-end`}>
          <p className="min-h-11 text-base font-bold text-zinc-900 tabular-nums" data-testid={`gem-line-total-${i + 1}`}>
            {lineTotal !== null ? `รวม ${fmt(lineTotal)} เม็ด` : "รวม —"}
          </p>
        </div>
      )}
    </>
  );
}
