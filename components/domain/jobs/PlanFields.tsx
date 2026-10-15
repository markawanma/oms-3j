"use client";

// PlanFields — น้ำหนักเป้าหมายต่อชิ้น + "โลหะที่ต้องเตรียม" + "กำหนดเอง" (ใช้ร่วม: ฟอร์มสร้างใบงาน · dialog แก้แผนบนหน้าใบงาน)
// 🔴 ห้ามคำนวณในหน้านี้ — ตัวเลขโลหะ/สูตรมาจาก DB (preview = getJobPlanSuggest) เราแค่จัดรูปแสดง
// 🔴 อัตรา reject/ก้านต้น (%) แสดงเฉพาะฟอร์มออฟฟิศนี้ — ห้ามไหลไป /w/ หรือใบพิมพ์
// state ครบ 4: idle/ไม่มีน้ำหนัก (ข้ามได้) · loading (skeleton aria-busy) · error (+ลองใหม่) · ready

import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { FIELD, Field } from "@/components/domain/jobs/JobDialogs";
import type { PlanPreviewState } from "@/components/domain/jobs/usePlanPreview";
import { parseText, parseWeight } from "@/lib/jobs/input";
import { METAL_LABEL } from "@/lib/jobs/types";

export interface PlanFieldsValue {
  targetText: string;
  overrideOn: boolean;
  overrideText: string;
  overrideReason: string;
}

export const EMPTY_PLAN_FIELDS: PlanFieldsValue = { targetText: "", overrideOn: false, overrideText: "", overrideReason: "" };

/** กรัมแบบ 3 ตำแหน่ง (แสดงผลเท่านั้น) */
export const fmtG = (n: number): string => n.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const fmtPct = (n: number): string => `${Number(n.toFixed(2))}%`;

export const TARGET_SOURCE_LABEL: Record<string, string> = { quote: "ใบเสนอราคา", product: "แคตตาล็อก SKU", input: "กรอกเอง" };

/** ผลตรวจรูปแบบของช่องกรอก (client เช็คเฉพาะรูปแบบ — DB เป็นด่านจริง) */
export interface PlanFieldsIssues {
  /** มีน้ำหนักเป้าหมายใช้งานได้ (กรอกเอง หรือค่าจากต้นทาง) และรูปแบบถูก — ไม่มี = ไม่วางแผนโลหะ (ซ่อนการ์ด/ช่องกำหนดเอง) */
  hasTarget: boolean;
  targetError: string | null;
  overrideError: string | null;
  reasonMissing: boolean;
  /** true = ห้ามกดบันทึก/สร้าง */
  blocking: boolean;
}

export function planFieldsIssues(v: PlanFieldsValue, defaultTargetText = ""): PlanFieldsIssues {
  const t = parseWeight(v.targetText, "น้ำหนักเป้าหมายต่อชิ้น");
  const targetError = t.ok ? null : t.error;
  const hasTarget = targetError === null && (v.targetText.trim() !== "" || defaultTargetText !== "");
  let overrideError: string | null = null;
  let reasonMissing = false;
  if (v.overrideOn && hasTarget) {
    const o = parseWeight(v.overrideText, "โลหะที่กำหนดเอง");
    if (!o.ok) overrideError = o.error;
    else if (o.value === null) overrideError = "ใส่น้ำหนักโลหะที่กำหนดเอง";
    const why = parseText(v.overrideReason, "เหตุผล", 200, true);
    reasonMissing = !why.ok;
  }
  return { hasTarget, targetError, overrideError, reasonMissing, blocking: targetError !== null || overrideError !== null || reasonMissing };
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

interface Props {
  idPrefix: string;
  metal: string;
  value: PlanFieldsValue;
  onChange: (next: PlanFieldsValue) => void;
  preview: PlanPreviewState;
  onRetry: () => void;
  /** ที่มาของน้ำหนักเริ่มต้น (quote/product) · input = กรอกเอง */
  defaultSource: "quote" | "product" | null;
  /** ค่าเริ่มต้นจากต้นทาง (ใช้บอกว่า "ว่าง = ใช้ค่าต้นทาง") */
  defaultTargetText: string;
  disabled?: boolean;
  /** true = ไม่มี preview ให้ถาม (เช่น ใบที่ไม่มีรายการต้นทาง) → บอกว่าระบบจะคำนวณตอนบันทึก */
  noPreview?: boolean;
}

export function PlanFields({ idPrefix, metal, value, onChange, preview, onRetry, defaultSource, defaultTargetText, disabled, noPreview }: Props) {
  const issues = planFieldsIssues(value, defaultTargetText);
  const metalTh = METAL_LABEL[metal] ?? metal;
  const set = (p: Partial<PlanFieldsValue>) => onChange({ ...value, ...p });
  const data = preview.s === "ready" ? preview.data : null;
  const changedFromDefault = value.targetText.trim() !== "" && value.targetText.trim() !== defaultTargetText;
  const sourceKey = changedFromDefault ? "input" : (data?.targetPieceGSource ?? defaultSource);
  const sourceLabel = sourceKey ? TARGET_SOURCE_LABEL[sourceKey] : null;
  const hasTarget = issues.hasTarget;

  const basis = data?.metalPlanBasis ?? null;
  const computedG = num(basis?.computed_g);
  const sprue = num(basis?.sprue_loss_pct);
  const bQty = num(basis?.qty_planned);
  const bTarget = num(basis?.target_piece_g);
  const sprueMissing = data !== null && sprue === null && computedG === null;
  const overrideParsed = value.overrideOn ? parseWeight(value.overrideText, "x") : null;
  const overrideG = overrideParsed && overrideParsed.ok ? overrideParsed.value : null;

  return (
    <div className="space-y-2">
      <Field
        id={`${idPrefix}-target`}
        label={`น้ำหนักต่อชิ้น (เป้าหมาย) — กรัม${metal ? ` · ${metalTh}` : ""}`}
        hint={issues.targetError ? undefined : value.targetText.trim() === "" && defaultTargetText === "" ? "ไม่ใส่ = ไม่วางแผนโลหะ (ข้ามได้)" : value.targetText.trim() === "" ? `ว่าง = ใช้ค่าจากต้นทาง ${defaultTargetText} g` : sourceLabel ? `ที่มา: ${sourceLabel}` : undefined}
      >
        <input
          id={`${idPrefix}-target`}
          inputMode="decimal"
          value={value.targetText}
          onChange={(e) => set({ targetText: e.target.value })}
          disabled={disabled}
          aria-invalid={issues.targetError ? true : undefined}
          aria-describedby={issues.targetError ? `${idPrefix}-target-err` : undefined}
          placeholder={defaultTargetText || undefined}
          className={FIELD}
        />
      </Field>
      {issues.targetError && (
        <p id={`${idPrefix}-target-err`} role="alert" className="text-xs font-medium text-red-800">
          {issues.targetError}
        </p>
      )}

      {hasTarget && (
        <section aria-label="โลหะที่ต้องเตรียม" aria-busy={preview.s === "loading"} className="space-y-2 rounded-md border border-zinc-200 bg-zinc-50 p-3">
          <h3 className="text-sm font-semibold text-zinc-800">โลหะที่ต้องเตรียม</h3>
          {preview.s === "loading" && (
            <div role="status" aria-label="กำลังคำนวณโลหะที่ต้องเตรียม" className="space-y-2">
              <Skeleton className="h-8 w-40" />
              <Skeleton className="h-4 w-64 max-w-full" />
            </div>
          )}
          {preview.s === "error" && (
            <div className="space-y-2">
              <p role="alert" className="text-sm font-medium text-red-800">
                {preview.message}
              </p>
              <p className="text-xs text-zinc-700">ระบบจะคำนวณโลหะตอนบันทึก</p>
              <Button type="button" size="sm" variant="secondary" onClick={onRetry}>
                ลองใหม่
              </Button>
            </div>
          )}
          {preview.s === "idle" && <p className="text-xs text-zinc-700">{noPreview ? "ระบบจะคำนวณโลหะตอนบันทึก" : "แก้ช่องที่ผิดก่อน แล้วระบบจะคำนวณให้"}</p>}
          {data && (
            <div className="space-y-1">
              {value.overrideOn && overrideG !== null ? (
                <p className="text-3xl font-bold text-zinc-900">
                  {fmtG(overrideG)} <span className="text-base font-medium">g</span> <span className="text-sm font-semibold text-amber-900">(กำหนดเอง)</span>
                </p>
              ) : data.metalPlanG !== null ? (
                <p className="text-3xl font-bold text-zinc-900">
                  {fmtG(data.metalPlanG)} <span className="text-base font-medium">g</span>
                </p>
              ) : (
                <p className="text-3xl font-bold text-zinc-500" aria-label="ยังคำนวณไม่ได้">
                  —
                </p>
              )}
              {!value.overrideOn && data.metalPlanG !== null && bQty !== null && bTarget !== null && sprue !== null && (
                <p className="text-xs text-zinc-700">
                  {bQty.toLocaleString("en-US")} ชิ้น × {fmtG(bTarget)} g × (1 + ก้านต้น {fmtPct(sprue)})
                </p>
              )}
              {sprueMissing && !value.overrideOn && (
                <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs font-medium text-amber-900">
                  ยังไม่มีอัตราก้านต้น ({metalTh}) — ใช้ “กำหนดเอง” หรือไปตั้งที่{" "}
                  <Link href="/oem/rates" className="underline">
                    จัดการต้นทุน
                  </Link>
                </p>
              )}
            </div>
          )}

          {!value.overrideOn ? (
            <Button type="button" size="sm" variant="secondary" onClick={() => set({ overrideOn: true })} disabled={disabled}>
              กำหนดเอง
            </Button>
          ) : (
            <div className="space-y-2 border-t border-zinc-200 pt-2">
              <Field id={`${idPrefix}-override`} label="โลหะที่ต้องเตรียม (กำหนดเอง) — กรัม">
                <input
                  id={`${idPrefix}-override`}
                  inputMode="decimal"
                  value={value.overrideText}
                  onChange={(e) => set({ overrideText: e.target.value })}
                  disabled={disabled}
                  aria-invalid={issues.overrideError ? true : undefined}
                  className={FIELD}
                />
              </Field>
              {issues.overrideError && value.overrideText.trim() !== "" && (
                <p role="alert" className="text-xs font-medium text-red-800">
                  {issues.overrideError}
                </p>
              )}
              <Field id={`${idPrefix}-why`} label="เหตุผลที่กำหนดเอง (จำเป็น)" hint={issues.reasonMissing && value.overrideText.trim() !== "" ? "ต้องระบุเหตุผล" : undefined}>
                <input id={`${idPrefix}-why`} value={value.overrideReason} onChange={(e) => set({ overrideReason: e.target.value })} maxLength={200} disabled={disabled} className={FIELD} />
              </Field>
              {data && data.metalPlanG !== null && <p className="text-xs text-zinc-700">ระบบคำนวณได้ {fmtG(data.metalPlanG)} g</p>}
              <Button type="button" size="sm" variant="secondary" onClick={() => set({ overrideOn: false, overrideText: "", overrideReason: "" })} disabled={disabled}>
                ใช้ค่าระบบ
              </Button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
