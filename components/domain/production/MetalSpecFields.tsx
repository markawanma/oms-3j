"use client";

// MetalSpecFields — ชุดช่อง "วัสดุ · ความบริสุทธิ์ (%) · น้ำหนัก/ชิ้น (กรัม)" (+ ช่องที่ผู้เรียกใส่เพิ่ม เช่น จำนวน/แบบใหม่) ของรายการในใบผลิต
// ลำดับ/ป้ายเดียวกับหน้า OEM (วัสดุ → ความบริสุทธิ์ → น้ำหนัก → จำนวน) ผ่าน primitive ร่วม: PurityPctInput (ห้ามทำช่องใหม่) · ไม่มีช่องราคา/ต้นทุนเลย (type boundary)
// 🔴 ไม่มีการคิดเงิน/ไม่มีสูตร default ซ้ำ — ค่าเริ่ม/ค่าที่เก็บจริงตัดสินที่ server (production_item_spec) ฟอร์มนี้แค่แสดงและรับค่า

import { useState } from "react";
import type { ReactNode } from "react";
import type { ProductionMetal } from "@/lib/production/types";
import { PRODUCTION_METAL_LABEL_TH } from "@/lib/production/types";
import type { MetalSpecFieldErrors } from "@/lib/production/metal-ui";
import { PurityPctInput } from "@/components/ui/PurityPctInput";
import { MetalRadioRows } from "./MetalRadioRows";

const inputCls = "mt-1 min-h-11 w-full rounded-md border border-zinc-300 px-2.5 text-base text-zinc-900 tabular-nums disabled:bg-zinc-100 disabled:text-zinc-500";
const labelCls = "block text-sm font-medium text-zinc-700";

export interface SkuMetalHint {
  /** โลหะของ SKU (ค่าที่ DB คืน — ใช้เมื่อ known เท่านั้น) */
  metal: ProductionMetal | null;
  /** true เฉพาะ SKU ที่ "ระบุโลหะจริง" (make_spec.metal / โหมด spot) — กัน warning "ต่างจาก SKU" ผิดทุกครั้งที่เปิดงานทอง (UX P1) */
  known: boolean;
}

export function MetalSpecFields({
  idBase,
  metal,
  purityText,
  weightText,
  onMetalChange,
  onPurityChange,
  onWeightChange,
  busy,
  metalLockReason,
  skuMetal,
  errors,
  forceShow,
  metalNotes,
  purityBadge,
  weightBadge,
  weightHint,
  extra,
}: {
  /** prefix ของ id ช่อง (useId ของผู้เรียก) — id จริง: `${idBase}-purity` · `${idBase}-weight` (ผู้เรียกใช้โฟกัสช่องแรกที่ผิด) */
  idBase: string;
  metal: ProductionMetal;
  purityText: string;
  weightText: string;
  onMetalChange: (next: ProductionMetal) => void;
  onPurityChange: (next: string) => void;
  onWeightChange: (next: string) => void;
  busy?: boolean;
  /** มีใบงานเดินอยู่ = ล็อกโลหะ (UX A.3.2) */
  metalLockReason?: string | null;
  /** null = รายการไม่มี SKU (ไม่มีข้อความเทียบ SKU) */
  skuMetal: SkuMetalHint | null;
  errors?: MetalSpecFieldErrors;
  forceShow?: boolean;
  /** ข้อความเล็กใต้ช่องวัสดุ — บอกว่าอะไรถูกรีเซ็ต/ล้างตามโลหะใหม่ (ไม่เงียบ) */
  metalNotes?: string[];
  /** "จาก SKU" | "แก้ในใบนี้" — แสดงผลอย่างเดียว ไม่ตัดสิน */
  purityBadge?: string | null;
  weightBadge?: string | null;
  /** ข้อความเล็กใต้ช่องน้ำหนัก (เช่น "น้ำหนักเป้าของใบงานไม่เปลี่ยนตาม") */
  weightHint?: string | null;
  /** ช่องที่สามของกริด (จำนวน/แบบใหม่) */
  extra?: ReactNode;
}) {
  const purityId = `${idBase}-purity`;
  const weightId = `${idBase}-weight`;
  // ข้อความ error น้ำหนักขึ้นหลัง blur (หรือหลังพยายามบันทึก) — พิมพ์ "3." กลางทางต้องไม่วูบแดง/ถูกอ่านออกเสียงทุกปุ่ม (แพทเทิร์นเดียวกับ PurityPctInput)
  const [weightTouched, setWeightTouched] = useState(false);
  const weightError = weightTouched || forceShow ? (errors?.weight ?? null) : null;
  const showMismatch = skuMetal !== null && skuMetal.known && skuMetal.metal !== null && skuMetal.metal !== metal;
  const showNeutral = skuMetal !== null && !skuMetal.known;
  const brass = metal === "brass";

  return (
    <div className="space-y-3">
      <div>
        <p className={labelCls}>วัสดุ</p>
        <div className="mt-1">
          <MetalRadioRows value={metal} onChange={onMetalChange} disabledReason={metalLockReason} busy={busy} />
        </div>
        {showMismatch && skuMetal?.metal && (
          <p role="note" className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
            ⚠ สินค้านี้ระบุเป็น {PRODUCTION_METAL_LABEL_TH[skuMetal.metal]} แต่รายการนี้เป็น {PRODUCTION_METAL_LABEL_TH[metal]} — ตรวจให้ตรงของจริง (ไม่บล็อก)
          </p>
        )}
        {showNeutral && <p className="mt-2 text-xs text-zinc-700">ⓘ สินค้านี้ยังไม่ระบุโลหะในระบบ — ตรวจให้ตรงของจริง</p>}
        {(metalNotes ?? []).map((n) => (
          <p key={n} role="status" className="mt-1 text-xs text-zinc-600">
            {n}
          </p>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor={purityId} className={labelCls}>
            ความบริสุทธิ์ (%) {metal === "gold" && <span className="text-red-600">*บังคับกรอก</span>}
          </label>
          <div className="mt-1">
            {brass ? (
              <div className="relative">
                <input
                  id={purityId}
                  type="text"
                  readOnly
                  aria-readonly="true"
                  value="100.00"
                  aria-describedby={`${purityId}-lock`}
                  className="min-h-11 w-full rounded-md border border-zinc-300 bg-zinc-100 px-2.5 pr-8 text-base text-zinc-700 tabular-nums"
                />
                <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-sm text-zinc-500">
                  %
                </span>
              </div>
            ) : (
              <PurityPctInput id={purityId} value={purityText} onChange={onPurityChange} className={inputCls.replace("mt-1 ", "")} issue={errors?.purity ?? undefined} forceShow={forceShow} />
            )}
          </div>
          {brass ? (
            <p id={`${purityId}-lock`} className="mt-1 text-xs text-zinc-600">
              ทองเหลืองล็อกเนื้อ 100%
            </p>
          ) : (
            <p className="mt-1 text-xs text-zinc-500">
              ขั้นต่ำ 37.50{metal === "gold" ? " · ทอง = ว่างเสมอ ต้องกรอกเอง" : ""}
              {purityBadge && <span className="ml-1.5 rounded-sm bg-zinc-100 px-1 py-0.5 text-[0.7rem] text-zinc-700">{purityBadge}</span>}
            </p>
          )}
        </div>

        <div>
          <label htmlFor={weightId} className={labelCls}>
            น้ำหนัก/ชิ้น (กรัม)
          </label>
          <input
            id={weightId}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={weightText}
            onChange={(e) => onWeightChange(e.target.value)}
            onBlur={() => setWeightTouched(true)}
            placeholder="ไม่ระบุ"
            aria-invalid={errors?.weight ? true : undefined}
            aria-describedby={weightError ? `${weightId}-err` : undefined}
            className={`${inputCls} ${weightError ? "ring-1 ring-red-500" : ""}`}
          />
          {weightError ? (
            <p id={`${weightId}-err`} role="alert" className="pt-0.5 text-[11px] font-normal text-red-600">
              {weightError}
            </p>
          ) : (
            <p className="mt-1 text-xs text-zinc-500">
              ไม่บังคับตอนสร้าง · ห้ามเดาจากชื่อสินค้า
              {weightBadge && <span className="ml-1.5 rounded-sm bg-zinc-100 px-1 py-0.5 text-[0.7rem] text-zinc-700">{weightBadge}</span>}
            </p>
          )}
          {weightHint && <p className="mt-1 text-xs text-zinc-600">{weightHint}</p>}
        </div>

        {extra}
      </div>
    </div>
  );
}
