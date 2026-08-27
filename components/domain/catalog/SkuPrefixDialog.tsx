"use client";

// SkuPrefixDialog — "+ เพิ่ม prefix" on /catalog/sku-prefix (Phase 1a, docs/
// 3j-jewelry/oem/design-email-sku-phase1.md). Prefix input is filtered to
// A-Z on every keystroke (never lets an invalid char sit in the field), and
// the suggested starting number is fetched from previewSkuSeed and shown for
// confirmation — never sent to the DB silently. If the seed field is left
// untouched, submit falls back to the last fetched suggestion (never null).

import { useEffect, useRef, useState } from "react";
import { upsertSkuPrefix, previewSkuSeed } from "@/lib/actions/catalog-sku";
import type { SkuPrefixRow, SkuWorkType } from "@/lib/catalog/sku-prefix";
import {
  SKU_WORK_TYPE_LABEL_TH,
  findOverlappingPrefix,
  formatPaddedNumber,
  isValidSkuPrefix,
  sanitizeSkuPrefixInput,
} from "@/lib/catalog/sku-prefix";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

const inputCls = "mt-1 min-h-11 w-full rounded-md border border-zinc-300 px-2.5 text-base text-zinc-900";
const labelCls = "mt-3 block text-sm font-medium text-zinc-700";

const PREVIEW_DEBOUNCE_MS = 400;

export function SkuPrefixDialog({
  open,
  onClose,
  existing,
  onSaved,
  editing = null,
}: {
  open: boolean;
  onClose: () => void;
  existing: SkuPrefixRow[];
  onSaved: () => void;
  /** มีค่า = โหมดแก้ไข: prefill ทุกช่อง, prefix + ลักษณะงาน (work_type) ปิดแก้ไม่ได้
   * (DB ล็อกทั้งคู่หลังสร้างแล้ว — prefix แก้ได้เฉพาะยังไม่มี SKU ออก, work_type
   * แก้ไม่ได้เลย ดู upsertSkuPrefix comment), ไม่เรียก previewSkuSeed (ไม่มีเลข
   * ตั้งต้นให้แนะนำใหม่ — RPC รับ seedLastNo null ตอนแก้แปลว่า "ไม่แตะตัวนับ"). */
  editing?: SkuPrefixRow | null;
}) {
  const toast = useToast();
  const [kindLabel, setKindLabel] = useState("");
  const [workType, setWorkType] = useState<SkuWorkType>("plain");
  const [prefix, setPrefix] = useState("");
  const [seedInput, setSeedInput] = useState("");
  const [seedTouched, setSeedTouched] = useState(false);
  // Mirrors seedTouched for the async debounce callback below, which closes
  // over whatever `seedTouched` was at the moment the timer was scheduled —
  // by the time the RPC resolves 400ms later the user may have typed a seed
  // in between, and that stale `false` would silently overwrite it. Every
  // setSeedTouched call below has a matching seedTouchedRef.current write so
  // the ref is never behind the state it mirrors.
  const seedTouchedRef = useRef(false);
  const [suggestedSeed, setSuggestedSeed] = useState<number | null>(null);
  // จำนวนหลัก (เติมศูนย์) — same touched/ref/debounce pattern as the seed
  // above, wired through the SAME preview request (previewSkuSeed now
  // returns both suggested_seed and suggested_pad_width in one row).
  const [padInput, setPadInput] = useState("");
  const [padTouched, setPadTouched] = useState(false);
  const padTouchedRef = useRef(false);
  const [suggestedPadWidth, setSuggestedPadWidth] = useState<number | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function markSeedTouched(touched: boolean) {
    seedTouchedRef.current = touched;
    setSeedTouched(touched);
  }

  function markPadTouched(touched: boolean) {
    padTouchedRef.current = touched;
    setPadTouched(touched);
  }

  function reset() {
    setKindLabel("");
    setWorkType("plain");
    setPrefix("");
    setSeedInput("");
    markSeedTouched(false);
    setSuggestedSeed(null);
    setPadInput("");
    markPadTouched(false);
    setSuggestedPadWidth(null);
    setPreviewError(null);
    setSubmitError(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  // Prefill on open in edit mode (create mode uses the blank defaults above
  // + reset() on close, unchanged). Runs off `open` transitioning to true
  // rather than `editing` alone, so re-opening to edit the SAME row again
  // re-prefills correctly even though reset() already ran on the previous
  // close. padTouched is marked true so the debounce effect below (which is
  // skipped anyway in edit mode, see next effect) never overwrites the real
  // pad_width with a preview suggestion.
  useEffect(() => {
    if (!open) return;
    if (editing) {
      setKindLabel(editing.kindLabel);
      setWorkType(editing.workType);
      setPrefix(editing.prefix);
      setSeedInput("");
      markSeedTouched(false);
      setSuggestedSeed(null);
      setPadInput(String(editing.padWidth));
      markPadTouched(true);
      setSuggestedPadWidth(null);
      setPreviewError(null);
      setSubmitError(null);
    } else {
      reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);

  // Debounced live preview whenever a syntactically-valid prefix is typed.
  // Two race conditions this guards against:
  //   1. Stale `seedTouched` closure — user types a seed by hand inside the
  //      400ms debounce window, then the timer fires with the OLD (false)
  //      value it closed over and silently overwrites what they typed.
  //      Fixed by reading seedTouchedRef.current (always current) instead.
  //   2. Out-of-order responses — user types "R" then "RP" quickly; the "R"
  //      preview request can resolve AFTER the "RP" one and clobber it with
  //      a stale suggestion. Fixed by the `cancelled` flag: cleanup (which
  //      runs before every re-run, i.e. on every keystroke) marks the
  //      in-flight request cancelled, and the callback bails after await if
  //      it's no longer current.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    // โหมดแก้ไข: prefix ล็อกอยู่แล้ว (ช่อง disabled) ไม่มีอะไรให้แนะนำเลขตั้งต้น
    // ใหม่ — ข้ามทั้งบล็อกไปเลย ไม่เรียก previewSkuSeed
    if (editing) return;
    if (!isValidSkuPrefix(prefix)) {
      setSuggestedSeed(null);
      setSuggestedPadWidth(null);
      setPreviewError(null);
      if (!seedTouchedRef.current) setSeedInput("");
      if (!padTouchedRef.current) setPadInput("");
      return;
    }
    let cancelled = false;
    debounceRef.current = setTimeout(async () => {
      setPreviewLoading(true);
      setPreviewError(null);
      const result = await previewSkuSeed({ prefix });
      if (cancelled) return;
      setPreviewLoading(false);
      if (!result.ok) {
        setPreviewError(result.error);
        return;
      }
      setSuggestedSeed(result.data.suggestedSeed);
      if (!seedTouchedRef.current) setSeedInput(String(result.data.suggestedSeed));
      setSuggestedPadWidth(result.data.suggestedPadWidth);
      if (!padTouchedRef.current) setPadInput(String(result.data.suggestedPadWidth));
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefix]);

  const overlap = findOverlappingPrefix(prefix, existing, editing?.id ?? null);
  const validPrefix = isValidSkuPrefix(prefix);
  // โหมดแก้ไข: ไม่ส่ง seed เลย (RPC รับ null = ไม่แตะตัวนับ) — เลขตั้งต้นเดิม
  // ตั้งไว้ตอนสร้างเท่านั้น, แก้ทีหลังไม่มีความหมาย (SKU ออกไปแล้วบางส่วน).
  const finalSeed = editing ? null : seedInput.trim() !== "" ? Number(seedInput) : suggestedSeed;
  const validSeed = editing ? true : finalSeed !== null && Number.isInteger(finalSeed) && finalSeed >= 0;
  const finalPad = padInput.trim() !== "" ? Number(padInput) : suggestedPadWidth;
  const validPad = finalPad !== null && Number.isInteger(finalPad) && finalPad >= 0 && finalPad <= 6;
  const canSubmit = kindLabel.trim() !== "" && validPrefix && validSeed && validPad && !submitting;
  // ตัวอย่าง SKU ตัวถัดไป — คำนวณสด ไม่ยิง DB, ใช้ formatPaddedNumber ตัวเดียวกับ
  // ที่ backend คำนวณจริง (guard "ห้าม truncate" อยู่ในนั้นตัวเดียว) เพื่อให้ผู้ใช้
  // เห็นผลก่อนกดบันทึก — นี่คือ "แสดงผล" ไม่ใช่เลขที่ผูกกับเงิน จึงไม่ขัดกฎ
  // ห้ามคำนวณเลขเงินฝั่ง client
  const nextSkuPreview =
    validPrefix && validSeed && validPad && finalSeed !== null && finalPad !== null
      ? `${prefix}${formatPaddedNumber(finalSeed + 1, finalPad)}`
      : null;

  function submit() {
    if (!canSubmit || finalPad === null) return;
    if (!editing && finalSeed === null) return; // create mode still requires a confirmed seed
    setSubmitError(null);
    setSubmitting(true);
    upsertSkuPrefix({
      id: editing?.id ?? undefined,
      kindLabel: kindLabel.trim(),
      workType,
      prefix,
      seedLastNo: finalSeed, // null in edit mode = "ไม่แตะตัวนับ"
      padWidth: finalPad,
    }).then((result) => {
      setSubmitting(false);
      if (!result.ok) {
        setSubmitError(result.error);
        toast.push(result.error, "error");
        return;
      }
      toast.push(editing ? `แก้ไข prefix ${prefix} แล้ว` : `บันทึก prefix ${prefix} แล้ว`);
      onSaved();
      handleClose();
    });
  }

  return (
    <Modal open={open} onClose={handleClose} title={editing ? "แก้ไข prefix" : "เพิ่ม prefix"}>
      <label className={labelCls} htmlFor="sku-prefix-kind">
        ประเภทงาน
      </label>
      <input
        id="sku-prefix-kind"
        type="text"
        value={kindLabel}
        onChange={(e) => setKindLabel(e.target.value)}
        className={inputCls}
        placeholder="เช่น แหวน, ต่างหู, สร้อยคอ"
      />

      <span className={labelCls}>ลักษณะงาน</span>
      <div className="mt-1 flex gap-4">
        {(Object.keys(SKU_WORK_TYPE_LABEL_TH) as SkuWorkType[]).map((wt) => (
          <label
            key={wt}
            className={`flex min-h-11 items-center gap-2 text-sm ${editing ? "text-zinc-400" : "text-zinc-800"}`}
          >
            <input
              type="radio"
              name="sku-prefix-work-type"
              checked={workType === wt}
              disabled={Boolean(editing)}
              onChange={() => setWorkType(wt)}
              className="h-5 w-5 disabled:cursor-not-allowed"
            />
            {SKU_WORK_TYPE_LABEL_TH[wt]}
          </label>
        ))}
      </div>
      {editing && <p className="mt-1 text-xs text-zinc-400">แก้ไม่ได้หลังสร้างแล้ว — ถ้าผิดให้ลบแล้วสร้างใหม่</p>}

      <label className={labelCls} htmlFor="sku-prefix-prefix">
        prefix (A-Z ไม่เกิน 5 ตัว ปิดท้าย - ได้ เช่น RP หรือ B-)
      </label>
      <input
        id="sku-prefix-prefix"
        type="text"
        value={prefix}
        disabled={Boolean(editing)}
        onChange={(e) => setPrefix(sanitizeSkuPrefixInput(e.target.value))}
        className={`${inputCls} uppercase disabled:bg-zinc-100 disabled:text-zinc-400`}
        placeholder="เช่น RP"
      />
      {editing && <p className="mt-1 text-xs text-zinc-400">แก้ไม่ได้หลังสร้างแล้ว — ถ้าผิดให้ลบแล้วสร้างใหม่</p>}
      {overlap && (
        <p className="mt-1 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-700">
          มี prefix &quot;{overlap.prefix}&quot; ({overlap.kindLabel} · {SKU_WORK_TYPE_LABEL_TH[overlap.workType]}) อยู่แล้ว —
          เลขอาจไล่ชนกันได้ (ระบบกันไม่ให้ SKU ซ้ำจริงอยู่แล้ว แต่เลขอาจข้ามไม่เรียงสวย)
        </p>
      )}

      {!editing && (
        <>
          <label className={labelCls} htmlFor="sku-prefix-seed">
            เลขตั้งต้น
          </label>
          <input
            id="sku-prefix-seed"
            type="number"
            inputMode="numeric"
            min={0}
            step="1"
            value={seedInput}
            disabled={!validPrefix}
            onChange={(e) => {
              markSeedTouched(true);
              setSeedInput(e.target.value);
            }}
            className={`${inputCls} disabled:bg-zinc-100 disabled:text-zinc-400`}
            placeholder={validPrefix ? "0" : "กรอก prefix ก่อน"}
          />
          {previewLoading && <p className="mt-1 text-xs text-zinc-400">กำลังคำนวณเลขตั้งต้นแนะนำ...</p>}
          {previewError && <p className="mt-1 text-xs text-red-600">{previewError}</p>}
          {!previewLoading && !previewError && suggestedSeed !== null && (
            <p className="mt-1 text-xs text-zinc-400">
              เลขตั้งต้นแนะนำ: {suggestedSeed} (จาก SKU เดิมในระบบ) — แก้ได้ก่อนบันทึก
            </p>
          )}
        </>
      )}

      <label className={labelCls} htmlFor="sku-prefix-pad">
        จำนวนหลัก (เติมศูนย์)
      </label>
      <input
        id="sku-prefix-pad"
        type="number"
        inputMode="numeric"
        min={0}
        max={6}
        step="1"
        value={padInput}
        disabled={!validPrefix}
        onChange={(e) => {
          markPadTouched(true);
          setPadInput(e.target.value);
        }}
        className={`${inputCls} disabled:bg-zinc-100 disabled:text-zinc-400`}
        placeholder={validPrefix ? "0" : "กรอก prefix ก่อน"}
      />
      <p className="mt-1 text-xs text-zinc-400">0 = ไม่เติมศูนย์ (RP9964) · 2 = เติมเป็น 2 หลัก (B-08)</p>
      {!previewLoading && !previewError && suggestedPadWidth !== null && (
        <p className="mt-1 text-xs text-zinc-400">
          จำนวนหลักแนะนำ: {suggestedPadWidth} (จาก SKU เดิมในระบบ) — แก้ได้ก่อนบันทึก
        </p>
      )}
      {padInput.trim() !== "" && !validPad && (
        <p className="mt-1 text-xs text-red-600">จำนวนหลักต้องเป็นจำนวนเต็ม 0-6</p>
      )}
      {nextSkuPreview && (
        <p className="mt-1 rounded-md border border-zinc-200 bg-zinc-50 p-2 text-xs text-zinc-600">
          SKU ตัวถัดไป: <span className="font-mono font-semibold text-zinc-900">{nextSkuPreview}</span>
        </p>
      )}

      {submitError && (
        <p role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
          {submitError}
        </p>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={handleClose} disabled={submitting}>
          ยกเลิก
        </Button>
        <Button type="button" onClick={submit} loading={submitting} disabled={!canSubmit}>
          บันทึก
        </Button>
      </div>
    </Modal>
  );
}
