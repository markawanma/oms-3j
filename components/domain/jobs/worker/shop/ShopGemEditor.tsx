"use client";

// ShopGemEditor — ตัวแก้รายการพลอยต่อชิ้นบนมือถือผู้จัดการ (W-4 · แผ่นแก้พลอย W-10) — UX ux-gems.md §3.3 §3.4 §3.7 §11
//  - controlled: รับ rows + onChange เท่านั้น (ไม่เรียก server เอง · ผู้เรียกถือคำขอ/error) · ชื่อใหม่อยู่ในเครื่องจนผู้ใช้กด "เปิดงาน"/"บันทึก" (UX P2) — ขึ้นรายการของแถวถัดไปพร้อมป้าย "ใหม่"
//  - accordion ทีละ 1 แถว: แถวพับ = สรุปบรรทัดเดียว + ป้าย · แถวที่ยังไม่ครบ "ห้ามพับ" · "เสร็จแถวนี้"/"＋ เพิ่มพลอย" aria-disabled + เหตุผลที่ชี้ช่องที่ขาด
//  - ปุ่ม/ช่อง ≥ 56px · ตัวอักษร ≥ 18px (รอง ≥ 16px) · เลือกชนิด/รูปทรงด้วย GemPicker แบบ sheet เต็มจอ · จำนวนใช้ QtyStepper เดิม (พิมพ์เลขตรงได้)
//  - รวมทั้งใบ = จำนวน/ชิ้น × จำนวนที่จะผลิต (จำนวนเต็ม ไม่มีปัดเศษ · DB คำนวณซ้ำและชนะ) · ไม่บวกเผื่อพลอยแตก
//  - 🔴 ไม่มีช่อง/ข้อความเรื่องเงิน ราคา ต้นทุน เผื่อแตก (เทสต์ worker-boundary.shop ล็อก)

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Plus, Sparkles, Trash2 } from "lucide-react";
import { BIG_BTN, BigButton, QtyStepper } from "@/components/domain/jobs/worker/WorkerParts";
import { ShopFieldError } from "@/components/domain/jobs/worker/shop/ShopMetalFields";
import { GemPicker } from "@/components/domain/gems/GemPicker";
import type { PickerOption } from "@/components/domain/gems/GemPicker";
import { GEM_FIELD_WORKER } from "@/components/domain/gems/ui";
import { draftTotals, emptyGemRow, findDuplicateRows, gemRowIssues, mergeDraftRows, parseGemQty, pendingNewNames, rowIncompleteReason, rowLabelPreview, rowSizes, unlockRow } from "@/lib/jobs/gem-draft";
import type { GemDraftRow, RowField, RowIssue } from "@/lib/jobs/gem-draft";
import type { GemOptions } from "@/lib/jobs/gems";
import { GEM_LIMITS, gemSizeLabel, gemSizeNeedsConfirm } from "@/lib/jobs/shop-gems";
import { SHOP_GEM_TH, gemFieldDomId, rowIncompleteMessage } from "@/lib/jobs/shop-gem-flow";
import type { GemRowErrors } from "@/lib/jobs/shop-gem-flow";
import type { GemCatalogSize } from "@/lib/jobs/worker-server";

const fmt = (n: number) => n.toLocaleString("en-US");
const LABEL = "block text-[17px] font-bold text-zinc-900";
const CHIP = "min-h-12 rounded-full border-2 border-zinc-400 bg-white px-4 text-lg font-semibold tabular-nums text-zinc-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-300";

export interface ShopGemFocusRequest {
  rowKey: string | null;
  field: string | null;
  /** เพิ่มทุกครั้งที่ขอ (ขอซ้ำที่แถวเดิมก็ทำงานใหม่) */
  nonce: number;
}

/** ค่าที่หยุดนิ่ง ms หนึ่ง — ไว้ประกาศ "รวมทั้งใบ" ให้ screen reader ตอนหยุดพิมพ์ (ไม่อ่านทุกตัวอักษร) */
function useSettled<T>(value: T, ms = 400): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function ShopGemEditor({
  idPrefix,
  rows,
  onChange,
  options,
  sizes,
  optionsState,
  onRetryOptions,
  qtyPlanned,
  showIssues = false,
  serverErrors,
  focusRequest,
  disabled,
  onForceSimilar,
  emptyText = "ยังไม่มีพลอยในใบนี้",
}: {
  idPrefix: string;
  rows: GemDraftRow[];
  onChange: (rows: GemDraftRow[]) => void;
  options: GemOptions | null;
  /** ขนาดที่เคยใช้ (ชิป "เคยใช้") */
  sizes: readonly GemCatalogSize[];
  optionsState: "loading" | "error" | "ready";
  onRetryOptions?: () => void;
  /** จำนวนที่จะเริ่มผลิต (null = ยังไม่รู้ → ไม่แสดงรวม) */
  qtyPlanned: number | null;
  /** true = แสดงปัญหาของทุกแถวทันที (หลังกด "ถัดไป"/"บันทึก" ที่ไปไม่ได้) */
  showIssues?: boolean;
  /** error จาก server ต่อแถว (key ของแถว) — ฟอร์มคงอยู่ */
  serverErrors?: GemRowErrors;
  /** พาไปแถว/ช่องที่ผิด (จาก error ของ server) */
  focusRequest?: ShopGemFocusRequest | null;
  disabled?: boolean;
  /** ผู้ใช้ยืนยัน "เพิ่มใหม่จริงๆ" ข้ามตัวดักชื่อคล้ายฝั่งจอ */
  onForceSimilar?: (info: { kind: "type" | "shape"; name: string }) => void;
  emptyText?: string;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const addRef = useRef<HTMLButtonElement>(null);

  const firstIncomplete = rows.find((r) => gemRowIssues(r).length > 0)?.key ?? null;
  // แถวที่ยังไม่ครบ = เปิดเสมอ (ห้ามพับ) · ค้างเปิดต่อจนกดเสร็จเองเมื่อครบ (ไม่พับกลางการพิมพ์)
  const openNow = firstIncomplete ?? openKey;
  useEffect(() => {
    if (firstIncomplete && firstIncomplete !== openKey) setOpenKey(firstIncomplete);
  }, [firstIncomplete, openKey]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  // พาไปแถว/ช่องที่ผิด
  const reqNonce = focusRequest?.nonce ?? null;
  const reqKey = focusRequest?.rowKey ?? null;
  const reqField = focusRequest?.field ?? null;
  useEffect(() => {
    if (reqNonce === null || reqKey === null) return;
    setOpenKey(reqKey);
    setTouched((s) => new Set(s).add(reqKey));
    const t = setTimeout(() => (document.getElementById(gemFieldDomId(idPrefix, reqKey, reqField)) ?? document.getElementById(`${idPrefix}-${reqKey}-head`))?.focus(), 0);
    return () => clearTimeout(t);
  }, [reqNonce, reqKey, reqField, idPrefix]);

  const typeOptions: PickerOption[] = options ? options.types.map((t) => ({ id: t.id, name: t.name })) : [];
  const shapeOptions: PickerOption[] = options ? options.shapes.map((s) => ({ id: s.id, name: s.name, hasLength: s.hasLength })) : [];
  const pendingTypes = pendingNewNames(rows, "type");
  const pendingShapes = pendingNewNames(rows, "shape");
  const dups = findDuplicateRows(rows, options);
  const { lineTotals, total } = draftTotals(rows, qtyPlanned);
  const touch = (key: string) => setTouched((s) => (s.has(key) ? s : new Set(s).add(key)));

  function patch(i: number, p: Partial<GemDraftRow>) {
    onChange(rows.map((r, k) => (k === i ? { ...r, ...p, edited: r.origin === "manual" ? r.edited : true } : r)));
  }

  function addRow() {
    const r = emptyGemRow("manual");
    onChange([...rows, r]);
    setOpenKey(r.key);
    setTimeout(() => document.getElementById(`${idPrefix}-${r.key}-type-btn`)?.focus(), 0);
  }

  function removeRow(i: number) {
    const gone = rows[i];
    onChange(rows.filter((_, k) => k !== i));
    if (openKey === gone.key) setOpenKey(null);
    setNotice(gone.origin === "template" ? `ลบแถวแล้ว · ${SHOP_GEM_TH.onlyThisJob}` : "ลบแถวแล้ว");
    // โฟกัสไม่หล่น: ไปที่ปุ่ม "เพิ่มพลอย"
    setTimeout(() => addRef.current?.focus(), 0);
  }

  function chipsOf(r: GemDraftRow): { sizeA: number; sizeB: number | null; label: string }[] {
    if (r.type?.kind !== "existing" || r.shape?.kind !== "existing") return [];
    const t = r.type.id;
    const s = r.shape.id;
    return sizes
      .filter((z) => z.typeId === t && z.shapeId === s)
      .slice(0, 6)
      .map((z) => ({ sizeA: z.sizeA, sizeB: z.sizeB, label: gemSizeLabel(z.sizeA, z.sizeB) }));
  }

  const incompleteIdx = firstIncomplete === null ? -1 : rows.findIndex((r) => r.key === firstIncomplete);
  const addWhy = rows.length >= GEM_LIMITS.linesMax ? SHOP_GEM_TH.tooMany : incompleteIdx >= 0 ? `กรอกแถว ${incompleteIdx + 1} ให้ครบก่อน` : null;
  const totalText = `รวมพลอยทั้งใบ ${rows.length} รายการ${total !== null ? ` · ${fmt(total)} เม็ด` : ""}`;
  const settledTotal = useSettled(totalText);

  return (
    <div className="space-y-3" data-testid="shop-gem-editor">
      {optionsState === "loading" && (
        <div role="status" aria-label={SHOP_GEM_TH.loadingCatalog} className="space-y-2">
          <div className="h-5 w-56 animate-pulse rounded bg-zinc-200" />
          <span className="sr-only">{SHOP_GEM_TH.loadingCatalog}…</span>
        </div>
      )}
      {optionsState === "error" && (
        <div role="status" className="space-y-2 rounded-xl border-2 border-amber-300 bg-amber-50 p-3 text-amber-950">
          <p className="text-lg font-semibold">{SHOP_GEM_TH.catalogError}</p>
          {onRetryOptions && (
            <button type="button" onClick={onRetryOptions} className="min-h-12 rounded-xl border-2 border-amber-600 bg-white px-5 text-lg font-bold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-300">
              {SHOP_GEM_TH.retry}
            </button>
          )}
        </div>
      )}

      {rows.length === 0 && (
        <p className="rounded-xl border-2 border-dashed border-zinc-300 bg-white p-4 text-lg text-zinc-800" data-testid="shop-gem-empty">
          {emptyText}
        </p>
      )}

      <ol className="space-y-3">
        {rows.map((r, i) => {
          const base = `${idPrefix}-${r.key}`;
          const open = openNow === r.key;
          const all = gemRowIssues(r);
          const complete = all.length === 0;
          const visible = showIssues || touched.has(r.key);
          const issues: RowIssue[] = visible ? all : [];
          const byField = (f: RowField) => issues.find((x) => x.field === f);
          const srv = serverErrors?.[r.key];
          const dupOf = dups.get(i);
          const preview = rowLabelPreview(r);
          const qty = parseGemQty(r.qty);
          const lineTotal = lineTotals[i];
          const badges: { text: string; tone: string; icon?: boolean }[] = [];
          if (r.origin === "template" && !r.edited) badges.push({ text: SHOP_GEM_TH.fromTemplate, tone: "bg-sky-100 text-sky-950" });
          if (r.origin !== "manual" && r.edited) badges.push({ text: SHOP_GEM_TH.edited, tone: "bg-amber-100 text-amber-950" });
          if (r.type?.kind === "new" || r.shape?.kind === "new") badges.push({ text: SHOP_GEM_TH.isNew, tone: "bg-sky-100 text-sky-950", icon: true });
          const badgeEls = badges.map((b) => (
            <span key={b.text} className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-base font-semibold ${b.tone}`}>
              {b.icon && <Sparkles className="h-4 w-4" aria-hidden="true" />}
              {b.text}
            </span>
          ));
          const why = !complete ? rowIncompleteMessage(i + 1, rowIncompleteReason(r) ?? "") : null;

          const dupBox = dupOf !== undefined && (
            <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3 text-amber-950" data-testid={`shop-gem-dup-${i + 1}`}>
              <p className="text-lg font-semibold">มีพลอยแบบเดียวกันอยู่แล้วที่แถว {dupOf + 1}</p>
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  onChange(mergeDraftRows(rows, i, dupOf));
                  setOpenKey(rows[dupOf].key);
                  setNotice(`รวมเข้าแถว ${dupOf + 1} แล้ว`);
                }}
                className="mt-2 min-h-14 w-full rounded-xl border-2 border-amber-500 bg-white px-4 text-lg font-bold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-300"
              >
                รวมเข้าแถว {dupOf + 1}
              </button>
            </div>
          );
          const srvBox = srv && (
            <p role="alert" className="rounded-xl border-2 border-red-200 bg-red-50 p-3 text-lg font-semibold break-words text-red-800" data-testid={`shop-gem-server-error-${i + 1}`}>
              พลอยแถว {i + 1}: {srv.message}
            </p>
          );

          return (
            <li key={r.key} className={`rounded-2xl border-2 bg-white p-3 ${srv ? "border-red-500" : open ? "border-zinc-900" : "border-zinc-300"}`} data-testid={`shop-gem-row-${i + 1}`} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) touch(r.key); }}>
              {!open ? (
                <div className="space-y-2">
                  <button
                    type="button"
                    id={`${base}-head`}
                    aria-expanded={false}
                    aria-controls={`${base}-body`}
                    disabled={disabled}
                    onClick={() => setOpenKey(r.key)}
                    className="flex min-h-[72px] w-full items-start justify-between gap-3 rounded-xl text-left focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-300"
                  >
                    <span className="min-w-0 flex-1 space-y-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-base font-semibold text-zinc-700">{SHOP_GEM_TH.rowOpenAria(i + 1)}</span>
                        {badgeEls}
                      </span>
                      <span className="block text-lg font-bold break-words [overflow-wrap:anywhere] text-zinc-900" data-testid={`shop-gem-row-label-${i + 1}`}>
                        {preview ?? "พลอย (ยังไม่ครบ)"}
                      </span>
                      <span className="block text-base tabular-nums text-zinc-800">
                        {qty !== null ? `${fmt(qty)} เม็ด/ชิ้น` : "—"}
                        {lineTotal !== null ? ` · รวม ${fmt(lineTotal)} เม็ด` : ""}
                      </span>
                    </span>
                    <span className="inline-flex shrink-0 items-center gap-1 pt-1 text-lg font-semibold text-primary-800 underline">
                      {SHOP_GEM_TH.edit}
                      <ChevronDown className="h-5 w-5" aria-hidden="true" />
                    </span>
                  </button>
                  {dupBox}
                  {srvBox}
                </div>
              ) : (
                <div id={`${base}-body`} className="space-y-3">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      id={`${base}-head`}
                      aria-expanded
                      aria-controls={`${base}-body`}
                      aria-disabled={!complete ? true : undefined}
                      disabled={disabled}
                      onClick={() => {
                        if (!complete) return touch(r.key);
                        setOpenKey(null);
                      }}
                      className="flex min-h-12 min-w-0 flex-1 flex-wrap items-center gap-2 rounded-xl text-left focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-300"
                    >
                      <span className="text-lg font-bold text-zinc-900">{SHOP_GEM_TH.rowOpenAria(i + 1)}</span>
                      {badgeEls}
                      {complete && <ChevronUp className="h-5 w-5 text-zinc-700" aria-hidden="true" />}
                    </button>
                    <button type="button" onClick={() => removeRow(i)} disabled={disabled} aria-label={`ลบพลอยแถว ${i + 1}`} className="inline-flex min-h-12 min-w-12 shrink-0 items-center justify-center gap-1 rounded-xl px-3 text-lg font-semibold text-red-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-300">
                      <Trash2 className="h-5 w-5" aria-hidden="true" />
                      {SHOP_GEM_TH.removeRow}
                    </button>
                  </div>
                  {r.origin === "template" && !r.edited && <p className="text-base text-zinc-700">{SHOP_GEM_TH.onlyThisJob} — แม่แบบ SKU ไม่เปลี่ยน</p>}

                  {r.itemId !== null ? (
                    <div className="space-y-1">
                      <p className={LABEL}>รายการ</p>
                      <p className="text-lg font-bold break-words [overflow-wrap:anywhere] text-zinc-900" data-testid={`shop-gem-row-fixed-${i + 1}`}>
                        {r.label}
                      </p>
                      <button type="button" disabled={disabled} onClick={() => patch(i, unlockRow(r, options))} className="min-h-12 rounded-lg px-1 text-lg font-semibold text-primary-800 underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-300">
                        เปลี่ยนรายการ
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="space-y-1">
                        <p className={LABEL}>ชนิด *</p>
                        <GemPicker
                          kind="type"
                          id={`${base}-type`}
                          label={`ชนิดพลอยแถว ${i + 1}`}
                          options={typeOptions}
                          pending={pendingTypes.filter((p) => !(r.type?.kind === "new" && p.name === r.type.name))}
                          loading={optionsState === "loading"}
                          loadError={optionsState === "error" ? "โหลดไม่ได้" : null}
                          onRetry={onRetryOptions}
                          presentation="sheet"
                          disabled={disabled}
                          invalid={!!byField("type")}
                          describedBy={byField("type") ? `${base}-type-err` : undefined}
                          value={r.type}
                          onSelect={(v) => patch(i, { type: v, itemId: null })}
                          onForceSimilar={onForceSimilar}
                          onNotice={setNotice}
                        />
                        {byField("type") && <ShopFieldError id={`${base}-type-err`}>{byField("type")!.message}</ShopFieldError>}
                      </div>
                      <div className="space-y-1">
                        <p className={LABEL}>รูปทรง *</p>
                        <GemPicker
                          kind="shape"
                          id={`${base}-shape`}
                          label={`รูปทรงแถว ${i + 1}`}
                          options={shapeOptions}
                          pending={pendingShapes.filter((p) => !(r.shape?.kind === "new" && p.name === r.shape.name))}
                          loading={optionsState === "loading"}
                          loadError={optionsState === "error" ? "โหลดไม่ได้" : null}
                          onRetry={onRetryOptions}
                          presentation="sheet"
                          disabled={disabled}
                          invalid={!!byField("shape")}
                          describedBy={byField("shape") ? `${base}-shape-err` : undefined}
                          value={r.shape}
                          onSelect={(v) => {
                            // เปลี่ยนรูปทรงหลังกรอกขนาด: ค่าที่เข้ากันเก็บไว้ ที่เกินล้าง + บอก
                            if (!v.hasLength && r.sizeB.trim() !== "") setNotice("รูปทรงนี้ใส่ขนาดค่าเดียว — ล้างด้านที่สองออกแล้ว");
                            patch(i, { shape: v, itemId: null, sizeB: v.hasLength ? r.sizeB : "", bigConfirmed: false });
                          }}
                          onForceSimilar={onForceSimilar}
                          onNotice={setNotice}
                        />
                        {byField("shape") && <ShopFieldError id={`${base}-shape-err`}>{byField("shape")!.message}</ShopFieldError>}
                      </div>
                      <div className="space-y-1.5">
                        <p className={LABEL}>ขนาด (มม.) *</p>
                        <SizeFields base={base} row={r} issues={issues} disabled={disabled} chips={chipsOf(r)} onSize={(a, b) => patch(i, { sizeA: a, sizeB: b, bigConfirmed: false })} onConfirmBig={(v) => patch(i, { bigConfirmed: v })} />
                      </div>
                    </>
                  )}

                  <QtyStepper
                    id={`${base}-qty`}
                    label="จำนวนต่อชิ้น"
                    value={r.qty}
                    onChange={(v) => patch(i, { qty: v })}
                    min={1}
                    max={GEM_LIMITS.qtyMax}
                    disabled={disabled}
                    error={byField("qty_per_piece")?.message ?? null}
                  />
                  <div className="space-y-1">
                    <label htmlFor={`${base}-pos`} className={LABEL}>
                      ตำแหน่ง <span className="font-normal text-zinc-700">· ไม่บังคับ</span>
                    </label>
                    <input
                      id={`${base}-pos`}
                      value={r.position}
                      disabled={disabled}
                      maxLength={GEM_LIMITS.positionMax}
                      autoComplete="off"
                      enterKeyHint="done"
                      aria-invalid={byField("position") ? true : undefined}
                      aria-describedby={byField("position") ? `${base}-pos-err` : undefined}
                      onChange={(e) => patch(i, { position: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          (e.currentTarget as HTMLInputElement).blur();
                        }
                      }}
                      className={GEM_FIELD_WORKER}
                    />
                    {byField("position") && <ShopFieldError id={`${base}-pos-err`}>{byField("position")!.message}</ShopFieldError>}
                  </div>

                  {preview && r.itemId === null && (
                    <p className="text-base break-words [overflow-wrap:anywhere] text-zinc-800" data-testid={`shop-gem-preview-${i + 1}`}>
                      ตัวอย่างชื่อ: {preview} <span className="text-zinc-700">(ระบบตั้งชื่อจริงตอนบันทึก)</span>
                    </p>
                  )}
                  {lineTotal !== null && qty !== null && qtyPlanned !== null && (
                    <p className="text-lg font-bold tabular-nums text-zinc-900" data-testid={`shop-gem-line-total-${i + 1}`}>
                      รวมทั้งใบ {fmt(lineTotal)} เม็ด ({fmt(qty)} × {fmt(qtyPlanned)})
                    </p>
                  )}
                  {dupBox}
                  {srvBox}
                  {why && (
                    <p id={`${base}-why`} className="text-base font-medium text-zinc-800">
                      {why}
                    </p>
                  )}
                  <BigButton
                    type="button"
                    tone="secondary"
                    disabled={disabled}
                    aria-disabled={!complete ? true : undefined}
                    aria-describedby={!complete ? `${base}-why` : undefined}
                    onClick={() => {
                      if (!complete) {
                        touch(r.key);
                        const f = all[0]?.field ?? null;
                        document.getElementById(gemFieldDomId(idPrefix, r.key, f === "size_big" ? "size_a" : f))?.focus();
                        return;
                      }
                      setOpenKey(null);
                      setTimeout(() => document.getElementById(`${base}-head`)?.focus(), 0);
                    }}
                  >
                    {SHOP_GEM_TH.rowDone}
                  </BigButton>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {/* ปุ่มรอง (ไม่ใช่ปุ่มหลัก — ปุ่มหลักจอนี้คือ "ถัดไป") · BigButton ไม่ forwardRef จึงใช้ class กลางตัวเดียวกัน */}
      <button
        ref={addRef}
        type="button"
        disabled={disabled}
        aria-disabled={addWhy ? true : undefined}
        aria-describedby={addWhy ? `${idPrefix}-add-why` : undefined}
        onClick={() => (addWhy ? undefined : addRow())}
        className={`${BIG_BTN} border-2 border-zinc-400 bg-white text-zinc-900`}
      >
        <Plus className="h-6 w-6" aria-hidden="true" />
        {SHOP_GEM_TH.addRow}
      </button>
      {addWhy && (
        <p id={`${idPrefix}-add-why`} className="text-base font-medium text-zinc-800">
          {addWhy}
        </p>
      )}

      {rows.length > 0 && (
        <>
          <p aria-hidden="true" className="border-t border-zinc-200 pt-3 text-lg font-bold tabular-nums text-zinc-900" data-testid="shop-gem-grand-total">
            {totalText}
          </p>
          <p role="status" aria-live="polite" className="sr-only">
            {settledTotal}
          </p>
        </>
      )}
      <p aria-live="polite" className="min-h-5 text-base font-medium text-zinc-900" data-testid="shop-gem-notice">
        {notice}
      </p>
    </div>
  );
}

/** ช่องขนาด: 1 ค่า = ช่องเดียว · 2 ค่า = [กว้าง] × [ยาว] · กรอกกลับด้านเรียงให้ + บอก · > 30 มม. ต้องติ๊กยืนยัน · ชิป "เคยใช้" */
function SizeFields({
  base,
  row,
  issues,
  disabled,
  chips,
  onSize,
  onConfirmBig,
}: {
  base: string;
  row: GemDraftRow;
  issues: RowIssue[];
  disabled?: boolean;
  chips: { sizeA: number; sizeB: number | null; label: string }[];
  onSize: (a: string, b: string) => void;
  onConfirmBig: (v: boolean) => void;
}) {
  const two = row.shape?.hasLength === true;
  const sz = rowSizes(row);
  const errA = issues.find((x) => x.field === "size_a");
  const errB = issues.find((x) => x.field === "size_b");
  const bigErr = issues.find((x) => x.field === "size_big");
  const needBig = sz !== null && gemSizeNeedsConfirm(sz.a, sz.b);
  const bigWhich = sz ? (sz.b !== null && sz.b > GEM_LIMITS.sizeWarn ? sz.b : sz.a) : null;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <input
          id={`${base}-size-a`}
          aria-label={two ? "ขนาดด้านกว้าง (มม.)" : "ขนาด (มม.)"}
          inputMode="decimal"
          autoComplete="off"
          enterKeyHint="next"
          value={row.sizeA}
          disabled={disabled || !row.shape}
          aria-invalid={errA ? true : undefined}
          aria-describedby={errA ? `${base}-size-a-err` : undefined}
          onChange={(e) => onSize(e.target.value, row.sizeB)}
          onFocus={(e) => e.target.select()}
          className={`${GEM_FIELD_WORKER} min-w-0 text-center font-bold tabular-nums`}
        />
        {two && (
          <>
            <span aria-hidden="true" className="text-2xl font-bold text-zinc-700">
              ×
            </span>
            <input
              id={`${base}-size-b`}
              aria-label="ขนาดด้านยาว (มม.)"
              inputMode="decimal"
              autoComplete="off"
              enterKeyHint="done"
              value={row.sizeB}
              disabled={disabled}
              aria-invalid={errB ? true : undefined}
              aria-describedby={errB ? `${base}-size-b-err` : undefined}
              onChange={(e) => onSize(row.sizeA, e.target.value)}
              onFocus={(e) => e.target.select()}
              className={`${GEM_FIELD_WORKER} min-w-0 text-center font-bold tabular-nums`}
            />
          </>
        )}
        <span className="shrink-0 text-lg font-semibold text-zinc-800">มม.</span>
      </div>
      {!row.shape && <p className="text-base text-zinc-700">เลือกรูปทรงก่อน</p>}
      {errA && <ShopFieldError id={`${base}-size-a-err`}>{errA.message}</ShopFieldError>}
      {errB && <ShopFieldError id={`${base}-size-b-err`}>{errB.message}</ShopFieldError>}
      {sz?.swapped && (
        <p className="text-base font-medium text-zinc-900" data-testid="shop-gem-swapped">
          เรียงเป็น {gemSizeLabel(sz.a, sz.b)} ให้
        </p>
      )}
      {needBig && (
        <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3 text-amber-950" data-testid="shop-gem-big-size">
          <p className="text-lg font-semibold">ขนาด {bigWhich} มม. ใหญ่ผิดปกติสำหรับพลอยเครื่องประดับ — ตรวจว่าเป็นมิลลิเมตร</p>
          <label className="mt-2 flex min-h-14 cursor-pointer items-center gap-3 text-lg font-semibold">
            <input type="checkbox" className="h-7 w-7 shrink-0 accent-primary-600" checked={row.bigConfirmed} disabled={disabled} onChange={(e) => onConfirmBig(e.target.checked)} />
            ใช่ ขนาดนี้ถูกต้อง
          </label>
          {bigErr && !row.bigConfirmed && <ShopFieldError>{bigErr.message}</ShopFieldError>}
        </div>
      )}
      {chips.length > 0 && (
        <div role="group" aria-label="ขนาดที่เคยใช้" className="flex flex-wrap items-center gap-2">
          <span className="text-base text-zinc-700">เคยใช้:</span>
          {chips.slice(0, 6).map((c) => (
            <button key={c.label} type="button" disabled={disabled} onClick={() => onSize(String(c.sizeA), c.sizeB === null ? "" : String(c.sizeB))} className={CHIP}>
              {c.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

