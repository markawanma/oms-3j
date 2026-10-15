"use client";

// QtyFields — "จำนวนที่สั่ง (อ่านอย่างเดียว) | เริ่มผลิต [ ]" + กล่องแนะนำเผื่อเสีย + เตือนผลิตบางส่วน (ฟอร์มสร้างใบงาน)
// 🔴 ตัวเลขแนะนำ/เปอร์เซ็นต์ reject ทุกตัวมาจาก job_plan_suggest — ที่นี่แค่แสดง · rate % แสดงเฉพาะฟอร์มออฟฟิศ (ไม่ไหลไป /w/ หรือใบพิมพ์)
// จำนวนเต็มเข้ม: "1,5" / "3.5" = error (ไม่กรองทิ้งเงียบ) — ใช้ parseQtyText

import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { FIELD, Field } from "@/components/domain/jobs/JobDialogs";
import type { JobPlanSuggestion } from "@/lib/actions/job-office";
import type { PlanPreviewState } from "@/components/domain/jobs/usePlanPreview";
import { fmtPct } from "@/lib/jobs/format";


interface Props {
  idPrefix: string;
  kind: "oem" | "production";
  qtyOrder: number;
  qtyText: string;
  onQtyText: (v: string) => void;
  /** ผล parseQtyText ของช่องเริ่มผลิต: ข้อความ error หรือ null */
  qtyError: string | null;
  /** จำนวนที่ผ่านการตรวจแล้ว (ใช้เทียบกับที่สั่ง/ที่แนะนำ) */
  qtyValue: number | null;
  plan: JobPlanSuggestion | null;
  /** สถานะ preview จาก usePlanPreview — error = แจ้ง "คำนวณจำนวนแนะนำไม่ได้" (ไม่เงียบ แม้ใบไม่มีน้ำหนักเป้าหมายจึงไม่มีการ์ดโลหะให้แสดง error) */
  preview: PlanPreviewState;
  /** ไม่ส่ง = ไม่มีปุ่มลองใหม่ที่นี่ (เช่น การ์ดโลหะข้างล่างมีปุ่มของตัวเองอยู่แล้ว) */
  onRetry?: () => void;
  onUseSuggest: (n: number) => void;
  disabled?: boolean;
}

export function QtyFields({ idPrefix, kind, qtyOrder, qtyText, onQtyText, qtyError, qtyValue, plan, preview, onRetry, onUseSuggest, disabled }: Props) {
  const suggest = plan?.qtyPlannedSuggest ?? null;
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
  const short = qtyValue !== null && qtyValue < qtyOrder ? qtyOrder - qtyValue : 0; // ผลต่างจำนวนชิ้น (ไม่ใช่เงิน/น้ำหนัก)

  return (
    <div className="space-y-2">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <p className="text-sm font-medium text-zinc-800">{kind === "oem" ? "จำนวนที่สั่ง" : "จำนวนที่ต้องการเข้าสต็อก"}</p>
          <p className="min-h-11 text-2xl font-bold text-zinc-900" data-testid="qty-order">
            {qtyOrder.toLocaleString("en-US")} <span className="text-base font-medium">ชิ้น</span>
          </p>
        </div>
        <Field id={`${idPrefix}-qty`} label="เริ่มผลิต (ชิ้น)">
          <input
            id={`${idPrefix}-qty`}
            inputMode="numeric"
            value={qtyText}
            onChange={(e) => onQtyText(e.target.value)}
            disabled={disabled}
            aria-invalid={qtyError ? true : undefined}
            aria-describedby={qtyError ? `${idPrefix}-qty-err` : undefined}
            className={FIELD}
          />
        </Field>
      </div>
      {qtyError && (
        <p id={`${idPrefix}-qty-err`} role="alert" className="text-xs font-medium text-red-800">
          {qtyError}
        </p>
      )}

      {preview.s === "error" && (
        // ไม่ใช่ความผิดของช่อง "เริ่มผลิต" → กล่องสีเหลือง (ไม่ใช้แดง) · มีปุ่มลองใหม่ (onRetry) = ไม่มีการ์ดโลหะข้างล่าง → ตัวนี้เป็น alert ตัวเดียว · ไม่มีปุ่ม = การ์ดโลหะมี alert ของตัวเองอยู่แล้ว ไม่ซ้ำ role
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

      {suggest !== null && (
        <div className="flex flex-col gap-2 rounded-md border border-sky-300 bg-sky-50 p-2.5 text-sm text-sky-900 sm:flex-row sm:items-center sm:justify-between">
          <p>
            แนะนำ {suggest.toLocaleString("en-US")} ชิ้น{plan?.bufferQty !== null && plan?.bufferQty !== undefined && plan.bufferQty > 0 ? ` (เผื่อ ${plan.bufferQty.toLocaleString("en-US")})` : " (ไม่ต้องเผื่อ)"}
            {parts.length > 0 ? `: ${parts.join(" · ")}` : ""}
          </p>
          {qtyValue !== suggest && (
            <Button type="button" size="sm" variant="secondary" onClick={() => onUseSuggest(suggest)} disabled={disabled}>
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

      {short > 0 && qtyValue !== null && (
        <p role="status" className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-sm font-medium text-amber-900">
          ผลิตบางส่วน — เริ่ม {qtyValue.toLocaleString("en-US")} น้อยกว่าที่สั่ง {qtyOrder.toLocaleString("en-US")} (ขาด {short.toLocaleString("en-US")} ชิ้น)
        </p>
      )}
    </div>
  );
}
