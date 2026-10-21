"use client";

// ProductionItemBindPanel — ผูก SKU ให้รายการที่ยังไม่มี SKU (W1 · UX B.10.1) + แก้ชื่อแบบก่อนผูก (R2)
// • ค้น SKU จากรายการที่ server ส่งมาแล้ว (ใช้ datalist แบบเดียวกับฟอร์มเพิ่มรายการ) — ไม่ใส่ SKU ที่อยู่ในใบนี้แล้ว (DB กันซ้ำอีกชั้น)
// • ผูกแล้วแก้ไม่ได้ → ต้องยืนยันก่อนเสมอ (2 ขั้น) · ไม่ทับโลหะ/เนื้อ/น้ำหนักที่หน้างานกรอก · เตือนโลหะไม่ตรง "จาก response ของ DB" (ไม่คิดเอง)
// • มีค่าที่แก้ค้างยังไม่บันทึกในการ์ด → aria-disabled (refresh หลังผูกจะรีเซ็ตค่าที่พิมพ์ค้าง)
// 🔴 ไม่มีการคิดเงิน/ต้นทุน · SKU ที่เลือกได้ = active และไม่ใช่ live* (server กรองแล้ว)
// 4 state: loading (ปุ่ม "กำลังผูก…") · empty (ไม่มี SKU ให้เลือก) · error (role=alert ค่าที่กรอกคงอยู่) · success (toast + refresh)

import { useEffect, useId, useState } from "react";
import { bindProductionItemProduct, setProductionItemLabel } from "@/lib/actions/production";
import type { ProductionOrderItemRow, ProductionOrderRow, ProductionSkuOption } from "@/lib/production/types";
import { PRODUCTION_METAL_LABEL_TH } from "@/lib/production/types";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

const inputCls = "mt-1 min-h-11 w-full rounded-md border border-zinc-300 bg-white px-2.5 text-base text-zinc-900 disabled:bg-zinc-100";
const labelCls = "block text-sm font-medium text-zinc-700";

const optionLabel = (o: ProductionSkuOption): string => `${o.sku} · ${o.name}`;

export function ProductionItemBindPanel({
  order,
  row,
  skuOptions,
  skuOptionsError,
  usedProductIds,
  cardDirty,
  onChanged,
}: {
  order: Pick<ProductionOrderRow, "id" | "poNo">;
  row: ProductionOrderItemRow;
  skuOptions: readonly ProductionSkuOption[];
  skuOptionsError: string | null;
  usedProductIds: ReadonlySet<string>;
  /** การ์ดรายการนี้มีค่าที่แก้ค้างยังไม่บันทึก */
  cardDirty: boolean;
  onChanged?: () => void;
}) {
  const toast = useToast();
  const uid = useId();
  const available = skuOptions.filter((o) => !usedProductIds.has(o.productId));
  const [text, setText] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState(row.pendingProductLabel ?? "");
  const [labelBusy, setLabelBusy] = useState(false);
  const [labelError, setLabelError] = useState<string | null>(null);

  // ชื่อแบบเปลี่ยนจริงจากเซิร์ฟเวอร์ (หลัง refresh) → ซิงก์ช่อง
  useEffect(() => setLabelDraft(row.pendingProductLabel ?? ""), [row.pendingProductLabel]);

  const selected = available.find((o) => optionLabel(o) === text) ?? null;
  const duplicate = !selected && skuOptions.some((o) => optionLabel(o) === text && usedProductIds.has(o.productId));
  const labelTrim = labelDraft.replace(/\s+/g, " ").trim();
  const labelChanged = labelTrim !== "" && labelTrim !== (row.pendingProductLabel ?? "");

  async function bind() {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    let r: Awaited<ReturnType<typeof bindProductionItemProduct>>;
    try {
      r = await bindProductionItemProduct({ productionOrderId: order.id, itemId: row.id, productId: selected.productId });
    } catch {
      setError("ผูก SKU ไม่สำเร็จ ลองอีกครั้ง (ค่าที่เลือกยังอยู่)");
      return;
    } finally {
      setBusy(false);
    }
    if (!r.ok) {
      setError(r.error);
      return;
    }
    const d = r.data;
    const warn = d.metalMismatch && d.itemMetal && d.skuMetal ? ` · ⚠ โลหะไม่ตรง: SKU ระบุเป็น${PRODUCTION_METAL_LABEL_TH[d.skuMetal]} แต่รายการเป็น${PRODUCTION_METAL_LABEL_TH[d.itemMetal]} — ตรวจให้ตรงของจริง` : "";
    const filled = d.weightFilled ? " · เติมน้ำหนักจาก SKU ให้แล้ว" : "";
    toast.push(`ผูก ${d.sku} แล้ว${warn}${filled}`);
    setConfirming(false);
    setText("");
    onChanged?.();
  }

  async function saveLabel() {
    if (!labelChanged || labelBusy || cardDirty) return;
    setLabelBusy(true);
    setLabelError(null);
    let r: Awaited<ReturnType<typeof setProductionItemLabel>>;
    try {
      r = await setProductionItemLabel({ productionOrderId: order.id, itemId: row.id, label: labelTrim });
    } catch {
      setLabelError("แก้ชื่อแบบไม่สำเร็จ ลองอีกครั้ง (ชื่อที่พิมพ์ยังอยู่)");
      return;
    } finally {
      setLabelBusy(false);
    }
    if (!r.ok) {
      setLabelError(r.error);
      return;
    }
    toast.push(`แก้ชื่อแบบเป็น "${r.data.label}" แล้ว`);
    onChanged?.();
  }

  const disabledBind = !selected || busy;

  return (
    <section aria-label="ผูก SKU" className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3">
      <p className="text-sm font-semibold text-amber-950">
        <span aria-hidden="true">⚑</span> ยังไม่ผูก SKU — ผูกกับรหัสสินค้าในระบบ ระบบถึงคิดต้นทุนและเข้าสต็อกได้
      </p>

      {skuOptionsError ? (
        <p role="alert" className="text-sm text-red-700">
          โหลดรายการ SKU ไม่สำเร็จ — {skuOptionsError}
        </p>
      ) : available.length === 0 ? (
        <p className="text-sm text-zinc-700">ยังไม่มี SKU ที่เลือกได้ (ต้อง active และไม่ใช่ SKU เฉพาะไลฟ์ · ไม่นับ SKU ที่อยู่ในใบนี้แล้ว) — สร้าง SKU ใหม่ที่หน้า สินค้า ก่อน</p>
      ) : (
        <div>
          <label htmlFor={`${uid}-sku`} className={labelCls}>
            ค้นหา SKU
          </label>
          <input
            id={`${uid}-sku`}
            type="text"
            list={`${uid}-opts`}
            value={text}
            disabled={busy}
            onChange={(e) => {
              setText(e.target.value);
              setConfirming(false);
              setError(null);
            }}
            placeholder="พิมพ์ค้นหา SKU หรือชื่อสินค้า"
            className={inputCls}
          />
          <datalist id={`${uid}-opts`}>
            {available.map((o) => (
              <option key={o.productId} value={optionLabel(o)} />
            ))}
          </datalist>
          {duplicate && (
            <p role="alert" className="mt-1 text-xs text-red-700">
              SKU นี้มีอยู่ในใบผลิตนี้แล้ว — เลือก SKU อื่น
            </p>
          )}
        </div>
      )}

      {confirming && selected ? (
        <div role="alertdialog" aria-label="ยืนยันผูก SKU" className="space-y-2 rounded-md border border-amber-400 bg-white p-3">
          <p className="text-sm text-zinc-900">
            ผูก <strong>{optionLabel(selected)}</strong> กับ &quot;{row.pendingProductLabel ?? "รายการนี้"}&quot; ?
          </p>
          <p className="text-xs text-zinc-700">ผูกแล้วแก้ไม่ได้ · โลหะ/เนื้อ/น้ำหนักที่หน้างานกรอกไว้ไม่เปลี่ยน · ใบงานที่เปิดไว้จะได้รหัสสินค้านี้ด้วย</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" loading={busy} onClick={() => void bind()}>
              {busy ? "กำลังผูก…" : "ยืนยันผูก SKU"}
            </Button>
            <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => setConfirming(false)}>
              กลับ
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            aria-disabled={disabledBind || cardDirty ? true : undefined}
            aria-describedby={cardDirty ? `${uid}-dirty` : undefined}
            className="aria-disabled:cursor-not-allowed aria-disabled:bg-zinc-300 aria-disabled:hover:bg-zinc-300"
            onClick={() => {
              if (disabledBind || cardDirty) return;
              setConfirming(true);
            }}
          >
            ผูก SKU
          </Button>
          {cardDirty && (
            <span id={`${uid}-dirty`} className="text-xs text-amber-900">
              บันทึกรายการนี้ก่อน แล้วค่อยผูก SKU
            </span>
          )}
          {!selected && !cardDirty && text !== "" && !duplicate && <span className="text-xs text-zinc-600">เลือกจากรายการที่ขึ้นให้</span>}
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-md border border-red-200 bg-white p-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <details className="text-sm">
        <summary className="cursor-pointer select-none text-zinc-700">แก้ชื่อแบบ (ก่อนผูก SKU)</summary>
        <div className="mt-2 space-y-2">
          <label htmlFor={`${uid}-label`} className={labelCls}>
            ชื่อแบบ
          </label>
          <input id={`${uid}-label`} type="text" value={labelDraft} disabled={labelBusy} onChange={(e) => setLabelDraft(e.target.value)} className={inputCls} />
          {labelError && (
            <p role="alert" className="text-sm text-red-700">
              {labelError}
            </p>
          )}
          <Button type="button" size="sm" variant="secondary" loading={labelBusy} aria-disabled={labelChanged && !cardDirty ? undefined : true} onClick={() => void saveLabel()}>
            บันทึกชื่อแบบ
          </Button>
        </div>
      </details>
    </section>
  );
}
