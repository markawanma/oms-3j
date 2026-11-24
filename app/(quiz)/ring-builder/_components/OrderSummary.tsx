"use client";

// OrderSummary — การ์ดสรุป + ปุ่มส่ง LINE (oaMessage · หลัก) + คัดลอกข้อความ / บันทึกรูป (รองคู่) — ปุ่มอยู่ท้ายหน้า ไม่ติดล่างจอ
// 🔴 ไม่มีรหัส/QR/ฟอร์มข้อมูลส่วนบุคคล/ชำระเงิน · ลูกค้ากดส่งเองใน LINE · ข้อความแก้ได้ = ไม่ใช่หลักฐานราคา (แอดมินยืนยันเอง)
// ปุ่ม LINE เป็น <a> ธรรมดา ไม่ disabled เมื่อไม่มีไซซ์ (UX §6) — มีแถบเตือน (ไอคอน + ข้อความ ไม่พึ่งสีอย่างเดียว) · href/target/rel ห้ามเปลี่ยน (ux-ring-save-image N1)
// 25 พ.ย. 69 (additive ทั้งหมด · ไม่มี prop = พฤติกรรมเดิมทุกประการ):
//   · onEdit — P1d ปุ่ม "แก้" ที่แถวแบบแหวน/พลอย/ไซซ์ (แถวเดียวต่อกลุ่ม · ไม่แถวราคา/แถวย่อย) · แถวมีปุ่มสูง ≥44px · คอลัมน์ปุ่มกว้างเท่ากันทุกแถว (แถวไม่มีปุ่มเว้นที่ว่าง)
//   · saveImage — ปุ่ม "บันทึกรูป" (client-only) · แถวแถวรองคู่: คัดลอกข้อความ | บันทึกรูป · ลำดับ DOM = LINE → คัดลอก → บันทึกรูป
import { useEffect, useRef, useState } from "react";
import { GemIcon } from "../../gem-quiz/_components/GemIcon";
import { SHOWCASE_COPY } from "@/lib/ring-builder/showcase/config";
import { copyText } from "@/lib/ring-builder/showcase/clipboard";
import type { ShowcaseDesignId } from "@/lib/ring-builder/showcase/designs";
import { buildShowcaseDetailRows, type ShowcaseEditTarget } from "@/lib/ring-builder/showcase/detail-rows";
import { GEM_QUIZ_STONE_BY_CODE } from "@/lib/gem-quiz/config";
import { czIconColors } from "@/lib/ring-builder/viewer/gem-colors";
import type { CaptureFrontFn } from "@/lib/ring-builder/viewer/gl-renderer";
import { buildShowcaseLineHref, buildShowcaseLineMessage, type ShowcaseChoice } from "@/lib/ring-builder/showcase/line-message";
import { SaveImageButton } from "./SaveImageButton";

const COPIED_MS = 3000;

/** ปุ่ม "แก้": แถวไซซ์ที่ยังไม่เลือกใช้ "เลือก" แทน "แก้" (ux-ring-save-image §5 ข้อ 2) */
function editLabels(target: ShowcaseEditTarget, sizePending: boolean): { text: string; aria: string } {
  if (target === "design") return { text: SHOWCASE_COPY.editButton, aria: SHOWCASE_COPY.editAriaDesign };
  if (target === "gems") return { text: SHOWCASE_COPY.editButton, aria: SHOWCASE_COPY.editAriaGems };
  return sizePending ? { text: SHOWCASE_COPY.editSizeSelectButton, aria: SHOWCASE_COPY.editAriaSizeSelect } : { text: SHOWCASE_COPY.editButton, aria: SHOWCASE_COPY.editAriaSize };
}

export function OrderSummary({
  designId,
  choice,
  size,
  onEdit,
  saveImage,
}: {
  designId: ShowcaseDesignId;
  /** สิ่งที่เลือก — จอสรุปกับข้อความ LINE มาจากค่าเดียวกัน (resolveChoice) */
  choice: ShowcaseChoice;
  /** effectiveSize เท่านั้น (ไซซ์ที่ใช้กับแบบนี้ได้ หรือ null) — ห้ามส่งไซซ์ดิบ (Z2 ชั้น 1) */
  size: number | null;
  /** P1d: มี = แสดงปุ่ม "แก้" (พาไปหัวข้อนั้น · ไม่รีเซ็ตค่า) — ไม่มี = ไม่แสดง */
  onEdit?: (target: ShowcaseEditTarget) => void;
  /** ปุ่ม "บันทึกรูป": ไม่มี = ไม่แสดง (เวที 3D ใช้ไม่ได้ถาวร) · ready=false = แสดงแต่ปิดไว้ + ข้อความรอเวที */
  saveImage?: { ready: boolean; capture: CaptureFrontFn | null; designFailed?: boolean };
}) {
  const input = { designId, choice, size };
  const message = buildShowcaseLineMessage(input);
  const href = buildShowcaseLineHref(input);

  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  async function onCopy() {
    if (message === null) return;
    const ok = await copyText(message);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (ok) {
      setCopyFailed(false);
      setCopied(true);
      timerRef.current = setTimeout(() => setCopied(false), COPIED_MS);
    } else {
      setCopied(false);
      setCopyFailed(true);
    }
  }

  // แถวสรุป = helper เดียวกับภาพ "บันทึกรูป" (detail-rows.ts) — ลำดับ/ข้อความ/ราคาเท่าเดิม (N8)
  const rows = buildShowcaseDetailRows(input) ?? [];
  const showSave = saveImage !== undefined && href !== null; // ไซซ์ผิด (href null) = ซ่อนเหมือนปุ่ม LINE

  return (
    <div className="flex flex-col gap-3">
      <h2 className="font-quiz-serif text-xl font-semibold text-[var(--gq-burgundy-dark)]">{SHOWCASE_COPY.summaryHeading}</h2>
      {choice.kind === "ownSlots" && (
        // แถบสีเม็ด 1..N (ตกแต่ง — ข้อความด้านล่างคือข้อมูลจริง)
        <div aria-hidden="true" className="flex items-center justify-center gap-1.5">
          {choice.codes.map((c, i) => (
            <GemIcon key={i} colors={c === "cz" ? czIconColors() : GEM_QUIZ_STONE_BY_CODE[c].colors} size={20} />
          ))}
        </div>
      )}
      <dl className="rounded-2xl border border-[var(--gq-border-soft)] bg-white px-4">
        {rows.map((r) => {
          if (!onEdit) {
            // ไม่มี onEdit = โครงเดิมทุกประการ
            return (
              <div key={r.label} className="flex items-baseline justify-between gap-4 border-b border-[var(--gq-divider)] py-3 last:border-b-0">
                <dt className="text-sm text-[var(--gq-text-muted)]">{r.label}</dt>
                <dd className="text-right text-[15px] font-medium">{r.value}</dd>
              </div>
            );
          }
          const edit = r.editTarget ? editLabels(r.editTarget, size === null) : null;
          const target = r.editTarget;
          return (
            <div key={r.label} className="flex min-h-11 items-center justify-between gap-4 border-b border-[var(--gq-divider)] py-1.5 last:border-b-0">
              <dt className="text-sm text-[var(--gq-text-muted)]">{r.label}</dt>
              <dd className="m-0 flex min-w-0 items-center justify-end gap-2">
                <span className="min-w-0 text-right text-[15px] font-medium">{r.value}</span>
                {edit && target ? (
                  <button
                    type="button"
                    aria-label={edit.aria}
                    onClick={() => onEdit(target)}
                    className="inline-flex min-h-11 w-14 flex-none items-center justify-center rounded-full text-sm font-medium text-[var(--gq-burgundy)] transition-colors hover:bg-[var(--gq-burgundy-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gq-burgundy)]"
                  >
                    {edit.text}
                  </button>
                ) : (
                  <span aria-hidden="true" className="w-14 flex-none" />
                )}
              </dd>
            </div>
          );
        })}
      </dl>
      <p className="text-sm text-[var(--gq-text-muted)]">{SHOWCASE_COPY.notAnOrder}</p>

      {size === null && (
        <p className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-3 text-sm leading-[1.55] text-amber-900">
          <svg className="mt-0.5 flex-none" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3l10 18H2z" />
            <path d="M12 10v5M12 18.2v.1" />
          </svg>
          <span>{SHOWCASE_COPY.sizeMissingWarn}</span>
        </p>
      )}

      {href === null ? (
        <p role="alert" className="rounded-xl border border-[var(--gq-border)] bg-white px-3.5 py-3 text-sm">
          ไซซ์ที่เลือกไม่ถูกต้อง กรุณาเลือกไซซ์ใหม่
        </p>
      ) : (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-14 w-full items-center justify-center gap-2.5 rounded-full bg-[var(--gq-burgundy)] text-base font-medium text-white transition-colors hover:bg-[var(--gq-burgundy-dark)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gq-burgundy)]"
        >
          {SHOWCASE_COPY.lineButton}
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </a>
      )}

      {/* แถวรองคู่: "เก็บไว้ดูเอง" (คัดลอก | บันทึกรูป) — ปุ่มหลักมีอันเดียว (LINE) · ที่ฟอนต์ใหญ่/จอแคบตกเป็นคอลัมน์เดียวเอง ไม่ truncate */}
      <div className={showSave ? "grid grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] gap-3" : undefined}>
        <button
          type="button"
          onClick={onCopy}
          disabled={message === null}
          className="inline-flex min-h-14 w-full items-center justify-center rounded-full border border-[var(--gq-border)] bg-white text-base font-medium text-[var(--gq-text)] transition-colors hover:bg-[var(--gq-burgundy-soft)] disabled:cursor-not-allowed disabled:text-zinc-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gq-burgundy)]"
        >
          {copied ? SHOWCASE_COPY.copiedButton : SHOWCASE_COPY.copyButton}
        </button>
        {showSave && saveImage && <SaveImageButton input={input} ready={saveImage.ready} capture={saveImage.capture} designFailed={saveImage.designFailed} />}
      </div>
      <p role="status" className="sr-only">
        {copied ? SHOWCASE_COPY.copiedButton : ""}
      </p>

      {copyFailed && message !== null && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="ring-showcase-copy-fallback" className="text-sm text-[var(--gq-text-muted)]">
            {SHOWCASE_COPY.copyFailed}
          </label>
          <textarea
            id="ring-showcase-copy-fallback"
            readOnly
            rows={7}
            value={message}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full rounded-xl border border-[var(--gq-border)] bg-white p-3 text-sm leading-[1.6]"
          />
        </div>
      )}
    </div>
  );
}
