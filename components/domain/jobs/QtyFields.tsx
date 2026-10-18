"use client";

// QtyFields — "จำนวนที่สั่ง (อ่านอย่างเดียว) · สวิตช์เผื่อของเสีย (ไม่บังคับ · ค่าเริ่มปิด) · เผื่อเพิ่ม [− n +]" + กล่องคำแนะนำ (ฟอร์มสร้างใบงาน)
// มติเจ้าของ 18 ต.ค. 69: ปิด = เริ่มผลิตเท่าที่ต้องการ (ช่องเริ่มผลิตไม่แสดง) · เปิด = กรอกเผื่อเพิ่ม b (เริ่มที่ 0) → เริ่มผลิต = สั่ง + b
// 🔴 ระบบ "ไม่เติมค่าให้เอง": ตัวเลขแนะนำ/เปอร์เซ็นต์ reject มาจาก job_plan_suggest แสดงเป็นคำแนะนำ — ใช้ได้เมื่อกด "ใช้ค่าแนะนำ" เท่านั้น
// rate % แสดงเฉพาะฟอร์มออฟฟิศ (ไม่ไหลไป /w/ หรือใบพิมพ์) · จำนวนเต็มเข้ม: "1,5" / "3.5" = error (ไม่กรองทิ้งเงียบ) — ใช้ parseBufferText

import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { FIELD, Field } from "@/components/domain/jobs/JobDialogs";
import { QtyBufferToggle } from "@/components/domain/jobs/QtyBufferToggle";
import type { JobPlanSuggestion } from "@/lib/actions/job-office";
import type { PlanPreviewState } from "@/components/domain/jobs/usePlanPreview";
import { bufferLabel } from "@/lib/jobs/board";
import { fmtPct } from "@/lib/jobs/format";

const n = (v: number): string => v.toLocaleString("en-US");

interface Props {
  idPrefix: string;
  kind: "oem" | "production";
  qtyOrder: number;
  /** สวิตช์เผื่อของเสีย — ผู้เรียกเริ่มที่ false ทุกครั้งที่เปิดกล่อง */
  bufferOn: boolean;
  onBufferOn: (next: boolean) => void;
  bufferText: string;
  onBufferText: (v: string) => void;
  /** ผล parseBufferText: ข้อความ error หรือ null (ปิดสวิตช์ = null เสมอ) */
  bufferError: string | null;
  /** จำนวนเผื่อที่ผ่านการตรวจแล้ว (ปิดสวิตช์ = 0) — null = ช่องยังไม่ถูกรูปแบบ */
  bufferValue: number | null;
  plan: JobPlanSuggestion | null;
  /** สถานะ preview จาก usePlanPreview — error = แจ้ง "คำนวณจำนวนแนะนำไม่ได้" เฉพาะตอนเปิดสวิตช์ (ปิดอยู่ไม่ขวางการสร้าง) */
  preview: PlanPreviewState;
  /** ไม่ส่ง = ไม่มีปุ่มลองใหม่ที่นี่ (เช่น การ์ดโลหะข้างล่างมีปุ่มของตัวเองอยู่แล้ว) */
  onRetry?: () => void;
  /** กด "ใช้ค่าแนะนำ" → ตั้งจำนวนเผื่อ = ค่าแนะนำ − จำนวนสั่ง */
  onUseSuggest: (buffer: number) => void;
  disabled?: boolean;
}

export function QtyFields({ idPrefix, kind, qtyOrder, bufferOn, onBufferOn, bufferText, onBufferText, bufferError, bufferValue, plan, preview, onRetry, onUseSuggest, disabled }: Props) {
  const suggest = plan?.qtyPlannedSuggest ?? null;
  const sugBuf = suggest !== null ? Math.max(0, plan?.bufferQty ?? suggest - qtyOrder) : null; // ผลต่างจำนวนชิ้น (ไม่ใช่เงิน/น้ำหนัก)
  const rb = plan?.rejectBasis ?? null;
  // อัตราเสียของที่ยังไม่ตั้ง → ไม่แนะนำเผื่อ (ไม่เดา) · ชุบนับเฉพาะเมื่อมีขั้นชุบในใบ
  const missingNames: string[] = [];
  if (rb) {
    if (rb.castPct === null) missingNames.push("หล่อ");
    if (rb.polishPct === null) missingNames.push("ขัด");
    if (rb.hasPlating && rb.platePct === null) missingNames.push("ชุบ");
  }
  const parts: string[] = [];
  if (rb) {
    if (rb.castPct !== null) parts.push(`หล่อเสีย ${fmtPct(rb.castPct)}`);
    if (rb.polishPct !== null) parts.push(`ขัด ${fmtPct(rb.polishPct)}`);
    if (rb.hasPlating && rb.platePct !== null) parts.push(`ชุบ ${fmtPct(rb.platePct)}`);
  }
  const planned = bufferOn ? (bufferValue !== null ? qtyOrder + bufferValue : null) : qtyOrder;
  const cur = bufferValue ?? 0;

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <p className="text-sm font-medium text-zinc-800">{kind === "oem" ? "จำนวนที่สั่ง" : "จำนวนที่ต้องการเข้าสต็อก"}</p>
        <p className="min-h-11 text-2xl font-bold text-zinc-900" data-testid="qty-order">
          {n(qtyOrder)} <span className="text-base font-medium">ชิ้น</span>
        </p>
      </div>

      <QtyBufferToggle id={`${idPrefix}-buffer`} checked={bufferOn} onChange={onBufferOn} disabled={disabled} />
      {/* aria-live: ปิดสวิตช์/เปลี่ยนเผื่อ → อ่าน "เริ่มผลิต N ชิ้น" */}
      <p aria-live="polite" data-testid="qty-start-summary" className="flex flex-wrap items-center gap-2 text-sm text-zinc-800">
        {bufferOn ? (
          planned !== null ? (
            <>
              <span>เริ่มผลิต {n(planned)} ชิ้น</span>
              {cur > 0 && <span className="inline-flex items-center rounded-md border border-sky-300 bg-sky-50 px-1.5 py-0.5 text-xs font-semibold text-sky-900">{bufferLabel(cur)}</span>}
            </>
          ) : (
            <span>ใส่จำนวนเผื่อให้ถูกรูปแบบก่อน</span>
          )
        ) : (
          <span>ปิดอยู่ = เริ่มผลิตเท่าที่ต้องการ ({n(qtyOrder)} ชิ้น)</span>
        )}
      </p>

      {bufferOn && (
        <div className="space-y-2">
          <Field id={`${idPrefix}-buffer-qty`} label="เผื่อเพิ่ม (ชิ้น)">
            <div className="flex items-center gap-2">
              <Button type="button" variant="secondary" className="min-w-11" aria-label="ลดจำนวนเผื่อ" onClick={() => onBufferText(String(Math.max(0, cur - 1)))} disabled={disabled || cur <= 0}>
                −
              </Button>
              <input
                id={`${idPrefix}-buffer-qty`}
                inputMode="numeric"
                value={bufferText}
                onChange={(e) => onBufferText(e.target.value)}
                disabled={disabled}
                aria-invalid={bufferError ? true : undefined}
                aria-describedby={bufferError ? `${idPrefix}-buffer-err` : undefined}
                className={`${FIELD} w-24 text-center`}
              />
              <Button type="button" variant="secondary" className="min-w-11" aria-label="เพิ่มจำนวนเผื่อ" onClick={() => onBufferText(String(cur + 1))} disabled={disabled}>
                +
              </Button>
            </div>
          </Field>
          {bufferError && (
            <p id={`${idPrefix}-buffer-err`} role="alert" className="text-xs font-medium text-red-800">
              {bufferError}
            </p>
          )}

          {preview.s === "error" && (
            // ไม่ใช่ความผิดของช่องเผื่อ → กล่องสีเหลือง (ไม่ใช้แดง) · มีปุ่มลองใหม่ (onRetry) = ไม่มีการ์ดโลหะข้างล่าง → ตัวนี้เป็น alert ตัวเดียว · ไม่มีปุ่ม = การ์ดโลหะมี alert ของตัวเองอยู่แล้ว ไม่ซ้ำ role
            <div className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 sm:flex-row sm:items-center sm:justify-between">
              <p role={onRetry ? "alert" : undefined} className="text-sm font-medium text-amber-900">
                คำนวณจำนวนแนะนำไม่ได้ — {preview.message}
              </p>
              {onRetry && (
                <Button type="button" size="sm" variant="secondary" onClick={onRetry} disabled={disabled}>
                  ลองใหม่
                </Button>
              )}
            </div>
          )}

          {suggest !== null && sugBuf !== null && (
            <div className="flex flex-col gap-2 rounded-md border border-sky-300 bg-sky-50 p-2.5 text-sm text-sky-900 sm:flex-row sm:items-center sm:justify-between">
              <p>
                {sugBuf > 0 ? `ระบบแนะนำเผื่อ +${n(sugBuf)}` : "ระบบแนะนำ: ไม่ต้องเผื่อ"} (เริ่มผลิต {n(suggest)} ชิ้น){parts.length > 0 ? `: ${parts.join(" · ")}` : ""}
              </p>
              {bufferValue !== sugBuf && (
                <Button type="button" size="sm" variant="secondary" onClick={() => onUseSuggest(sugBuf)} disabled={disabled}>
                  ใช้ค่าแนะนำ
                </Button>
              )}
            </div>
          )}

          {plan && suggest === null && missingNames.length > 0 && (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-sm font-medium text-amber-900">
              ยังไม่มีอัตราเสียของ [{missingNames.join(" · ")}] จึงไม่แนะนำเผื่อ — ตั้งที่{" "}
              <Link href="/oem/rates" className="underline">
                จัดการต้นทุน
              </Link>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
