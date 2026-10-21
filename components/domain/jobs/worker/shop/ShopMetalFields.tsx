"use client";

// ShopMetalFields — ช่อง "วัสดุ · เนื้อโลหะ (%) · น้ำหนักต่อชิ้น (กรัม)" ของผู้จัดการ (W-2b และแผ่นแก้ที่ W-3/W-6)
// radio แนวตั้ง ≥ 64px เห็นทุกตัวเลือก+สีตลอด (R6: ผิดโลหะแล้วด่านทองหาย) · ช่องกรอก ≥ 56px ตัวอักษร ≥ 18px · error ≥ 15px มีไอคอน ⚠ ไม่พึ่งสี
// 🔴 ไม่มีช่องราคา/ต้นทุน/ป้ายเงินใดๆ · ไม่มีสูตร default ซ้ำ — ค่าเริ่มมาจาก lib/jobs/shop-open.ts · DB เป็นผู้ตัดสินจริง

import { useId, useState } from "react";
import { Check } from "lucide-react";
import { PurityPctInput } from "@/components/ui/PurityPctInput";
import { ShopMetalTag } from "@/components/domain/jobs/worker/shop/ShopMetalTag";
import { SHOP_METALS, SHOP_METAL_HINT, SHOP_METAL_TAG } from "@/lib/jobs/shop-open";
import type { ShopMetal, ShopMetalIssues, SkuMetalNote } from "@/lib/jobs/shop-open";

const FIELD = "min-h-14 w-full rounded-xl border-2 border-zinc-400 bg-white px-4 text-2xl font-semibold tabular-nums text-zinc-900 focus:border-primary-600 focus:outline-none focus:ring-4 focus:ring-primary-200 disabled:bg-zinc-100 disabled:text-zinc-600";

export function ShopFieldError({ id, children }: { id?: string; children: string }) {
  return (
    <p id={id} role="alert" className="flex items-start gap-1.5 text-base font-semibold text-red-700">
      <span aria-hidden="true">⚠</span>
      <span>{children}</span>
    </p>
  );
}

export function ShopMetalFields({
  idBase,
  metal,
  purityText,
  weightText,
  onMetalChange,
  onPurityChange,
  onWeightChange,
  issues,
  forceShow,
  notes,
  skuNote,
  skuMetal,
  profileBlock,
  busy,
  purityBadge,
}: {
  /** prefix id ช่อง: `${idBase}-purity` · `${idBase}-weight` (ผู้เรียกใช้โฟกัสช่องที่ผิด) */
  idBase: string;
  metal: ShopMetal;
  purityText: string;
  weightText: string;
  onMetalChange: (next: ShopMetal) => void;
  onPurityChange: (v: string) => void;
  onWeightChange: (v: string) => void;
  issues?: ShopMetalIssues;
  forceShow?: boolean;
  /** บรรทัดเล็กใต้ช่องวัสดุ (เนื้อรีเซ็ต / ล้างน้ำหนัก) */
  notes?: string[];
  skuNote?: SkuMetalNote;
  /** โลหะของ SKU (ใช้ประกอบข้อความ warn เท่านั้น) */
  skuMetal?: ShopMetal | null;
  /** ข้อความเมื่อโลหะที่เลือกยังไม่มีแบบการบันทึก (pre-check R1) */
  profileBlock?: string | null;
  busy?: boolean;
  /** "ค่าจากสินค้าในระบบ" / "แก้แล้ว" */
  purityBadge?: string | null;
}) {
  const uid = useId();
  const purityId = `${idBase}-purity`;
  const weightId = `${idBase}-weight`;
  const [weightTouched, setWeightTouched] = useState(false);
  const weightError = weightTouched || forceShow ? (issues?.weight ?? null) : null;
  const brass = metal === "brass";
  return (
    <div className="space-y-4">
      <fieldset disabled={busy} className="space-y-2">
        <legend className="text-lg font-bold text-zinc-900">
          วัสดุ <span className="text-primary-700">*</span>
        </legend>
        <div role="radiogroup" aria-label="วัสดุ" className="space-y-2">
          {SHOP_METALS.map((m) => {
            const checked = metal === m;
            return (
              <label
                key={m}
                className={`relative flex min-h-16 cursor-pointer items-center gap-3 rounded-xl px-4 py-2 has-[:focus-visible]:outline has-[:focus-visible]:outline-4 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary-600 ${
                  checked ? "border-2 border-zinc-900 bg-zinc-50" : "border-2 border-zinc-300 bg-white"
                }`}
              >
                <input type="radio" name={`${uid}-metal`} value={m} checked={checked} onChange={() => onMetalChange(m)} className="sr-only" aria-describedby={`${uid}-${m}-hint`} />
                <span aria-hidden="true" className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 ${checked ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-400"}`}>
                  {checked && <Check className="h-4 w-4" />}
                </span>
                <ShopMetalTag metal={m} size="md" />
                <span id={`${uid}-${m}-hint`} className="ml-auto text-right text-base text-zinc-700">
                  {SHOP_METAL_HINT[m]}
                </span>
              </label>
            );
          })}
        </div>
        {(notes ?? []).map((n) => (
          <p key={n} role="status" className="text-base text-zinc-700">
            {n}
          </p>
        ))}
      </fieldset>

      {skuNote === "warn" && skuMetal && (
        <p role="note" className="rounded-xl border-2 border-amber-400 bg-amber-50 p-3 text-lg text-amber-950">
          ⚠ สินค้านี้ในระบบเป็น {SHOP_METAL_TAG[skuMetal].label} — คุณเลือก {SHOP_METAL_TAG[metal].label} · เปิดงานได้ ออฟฟิศจะเห็นคำเตือนนี้ ตรวจให้ตรงของจริง
        </p>
      )}
      {skuNote === "neutral" && (
        <p role="note" className="rounded-xl border-2 border-zinc-300 bg-zinc-50 p-3 text-lg text-zinc-800">
          ⓘ สินค้านี้ยังไม่ระบุโลหะในระบบ — ตรวจให้ตรงของจริง
        </p>
      )}
      {profileBlock && (
        <p role="alert" className="rounded-xl border-2 border-red-300 bg-red-50 p-3 text-lg font-semibold text-red-800">
          {profileBlock}
        </p>
      )}

      <div className="space-y-1.5">
        <label htmlFor={purityId} className="block text-lg font-bold text-zinc-900">
          เนื้อโลหะ (%) {metal === "gold" && <span className="text-primary-700">*ต้องกรอก</span>}
        </label>
        {brass ? (
          <div className="relative">
            <input id={purityId} type="text" readOnly aria-readonly="true" value="100.00" aria-describedby={`${purityId}-lock`} className={`${FIELD} bg-zinc-100 pr-10 text-zinc-700`} />
            <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-lg text-zinc-500">
              %
            </span>
          </div>
        ) : (
          <PurityPctInput id={purityId} size="lg" value={purityText} onChange={onPurityChange} className={FIELD} issue={issues?.purity ?? null} forceShow={forceShow} disabled={busy} />
        )}
        {brass ? (
          <p id={`${purityId}-lock`} className="text-base text-zinc-700">
            ทองเหลืองไม่ต้องระบุเนื้อ
          </p>
        ) : metal === "gold" ? (
          <p className="text-base text-zinc-700">ทองหลายเนื้อ (K) — พิมพ์เนื้อจริงของงานนี้ ขั้นต่ำ 37.50%</p>
        ) : (
          <p className="text-base text-zinc-700">ค่าเริ่มของเงิน — แก้ได้ ถ้าไม่ใช่ 925 · ขั้นต่ำ 37.50%</p>
        )}
        {purityBadge && <p className="text-base font-semibold text-zinc-800">{purityBadge}</p>}
      </div>

      <div className="space-y-1.5">
        <label htmlFor={weightId} className="block text-lg font-bold text-zinc-900">
          น้ำหนักต่อชิ้น (กรัม) <span className="font-normal text-zinc-600">· ไม่บังคับ</span>
        </label>
        <input
          id={weightId}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          disabled={busy}
          value={weightText}
          onChange={(e) => onWeightChange(e.target.value.replace(/[^0-9.,]/g, ""))}
          onBlur={() => setWeightTouched(true)}
          aria-invalid={issues?.weight ? true : undefined}
          aria-describedby={weightError ? `${weightId}-err` : `${weightId}-hint`}
          className={`${FIELD} ${weightError ? "ring-2 ring-red-500" : ""}`}
        />
        {weightError ? (
          <ShopFieldError id={`${weightId}-err`}>{weightError}</ShopFieldError>
        ) : (
          <p id={`${weightId}-hint`} className="text-base text-zinc-700">
            ไม่รู้ก็เว้นว่างได้ ออฟฟิศเติมให้ทีหลัง
          </p>
        )}
      </div>
    </div>
  );
}
