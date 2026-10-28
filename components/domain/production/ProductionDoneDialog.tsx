"use client";

// ProductionDoneDialog — the confirm-before-"ผลิตเสร็จ" gate the P1b brief
// requires (item 3): every number shown here comes straight from
// analytics.production_order_preview (0131 §11), fetched FRESH the moment
// this dialog opens — never reused from a stale list-page fetch — so "ที่เห็น
// ก่อนกด = ที่จะถูก stamp" (design-production-order.md §"RPC 8 ตัว") holds
// literally: production_order_done (§12) calls the exact same
// production_cost_calc function with the exact same metal-price resolution
// preview does.
//
// No client-side cost math anywhere below — unitCost/prevUnitCost/
// metalPrices/costCalc are all read straight off the RPC response.
//
// 🔴 0132 (security review 18 ก.ย., M1) → 0186 ต่อโลหะ: preview and done are still two separate transactions, and
// analytics.oem_metal_price for today CAN be upserted over between them — so "ที่เห็นก่อนกด = ที่จะถูก stamp" is
// enforced server-side too: this dialog sends preview.metalPrices back as expectedMetalPrices, and production_order_done
// raises (instead of silently stamping a different price) if any metal's price doesn't match what it resolves at confirm time.
//
// 🔴 0141/0142: a cost_type='spec' line's unit cost DEPENDS on qty — so editing a qty input below re-runs the preview with
// that same qty (debounced), built with the EXACT SAME function (buildDoneItems/doneItems) that submit() sends to done.
//
// PM-B (UX spec A.7): ราคาโลหะต่อโลหะ (เงิน/ทอง/ทองเหลือง) · read-back โลหะ·เนื้อ·น้ำหนักต่อรายการ ก่อนยืนยัน ·
// ไม่มีราคาทอง/ทองเหลืองวันนี้ = กล่องแดง + เปิดหน้าราคาโลหะ (แท็บใหม่) + ตรวจอีกครั้ง (ไม่มีราคาเฉพาะใบ — มติ Q6) ·
// ปุ่มยืนยัน aria-disabled + เหตุผล (ไม่ใช่ disabled เฉยๆ)

import { useEffect, useId, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { doneProductionOrder, previewProductionOrder } from "@/lib/actions/production";
import type {
  DoneItemInput,
  ProductionMetal,
  ProductionOrderItemRow,
  ProductionOrderPreview,
  ProductionOrderPreviewItem,
  ProductionOrderRow,
} from "@/lib/production/types";
import { PRICE_CHANGED_MARKER, PRODUCTION_COST_TYPE_LABEL_TH, PRODUCTION_METAL_LABEL_TH } from "@/lib/production/types";
import { formatTHB } from "@/lib/format";
import { brassPerGramToKgText } from "@/lib/oem/metal-price";
import { effectiveDateBangkok, formatThaiDateOnly } from "@/lib/tiktok/format";
import { formatPurityPct } from "@/lib/units/purity";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { MetalTag } from "./MetalTag";
import { ProductionSpecCostCard } from "./ProductionSpecCostCard";

// ค่าต่อกรัมจาก server (numeric(14,4)) — แสดงอย่างน้อย 2 ตำแหน่ง สูงสุด 4 ไม่ปัดทิ้งเศษของทองเหลือง (0.3506)
const fmtPerGram = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });

interface DoneRow {
  productId: string;
  sku: string;
  productName: string;
  qtyPlanned: number;
  qtyDoneInput: string;
  makeSpec: ProductionOrderItemRow["makeSpec"];
  /** ค่า effective จาก DB ตอนโหลดหน้า — ใช้โชว์ก่อน preview กลับมา (preview คือค่าที่จะถูกล็อกจริง) */
  metal: ProductionMetal | null;
  purity: number | null;
  weightG: number | null;
}

const DEBOUNCE_MS = 350;

function parsedQty(input: string): number | null {
  const n = Number(input);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 100000) return null;
  return n;
}

function readBack(metal: ProductionMetal | null, purity: number | null, weightG: number | null, qty: number | null): string {
  const parts = [
    metal ? PRODUCTION_METAL_LABEL_TH[metal] : "ไม่ระบุโลหะ",
    purity != null ? `เนื้อ ${formatPurityPct(purity)}` : "เนื้อ —",
    weightG != null ? `น้ำหนัก ${weightG.toFixed(3)} g/ชิ้น` : "ไม่ได้ระบุน้ำหนัก",
  ];
  return `${parts.join(" · ")}${qty != null ? ` × ${qty.toLocaleString("en-US")}` : ""}`;
}

export function ProductionDoneDialog({
  order,
  items,
  onClose,
  onDone,
}: {
  order: ProductionOrderRow;
  items: ProductionOrderItemRow[];
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const reasonId = useId();
  // 0186: รายการที่ยังไม่มี SKU (productId null) ปิดใบ/คิดต้นทุนไม่ได้ (DB ตอบ sku_required) — หน้าใบผลิตกันที่ปุ่มก่อนเปิดกล่องนี้ ·
  // ตรงนี้กันซ้ำ: ไม่ให้แถวพวกนี้เข้า payload และปิดปุ่มยืนยันพร้อมบอกเหตุผล (ไม่ปล่อยให้ผู้ใช้กดไปชน error ของ DB)
  const unboundCount = items.filter((item) => item.productId === null).length;
  const [rows] = useState<DoneRow[]>(() =>
    items.flatMap((item) =>
      item.productId === null
        ? []
        : [
            {
              productId: item.productId,
              sku: item.sku ?? "",
              productName: item.productName ?? "",
              qtyPlanned: item.qtyPlanned,
              qtyDoneInput: String(item.qtyPlanned),
              makeSpec: item.makeSpec,
              metal: item.effectiveMetal,
              purity: item.effectivePurity,
              weightG: item.effectiveWeightG,
            },
          ]
    )
  );
  const [qtyByProductId, setQtyByProductId] = useState<Map<string, string>>(
    () => new Map(items.flatMap((item) => (item.productId === null ? [] : [[item.productId, String(item.qtyPlanned)] as [string, string]])))
  );
  const [preview, setPreview] = useState<ProductionOrderPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [pending, setPending] = useState(false);

  /** built once per (rows × qtyByProductId) change — the EXACT array sent to
   * both preview (below) and done (submit()), so what's shown is provably
   * what gets stamped. */
  const doneItems = useMemo<{ items: DoneItemInput[]; allValid: boolean }>(() => {
    const parsed: DoneItemInput[] = [];
    let allValid = true;
    for (const r of rows) {
      const input = qtyByProductId.get(r.productId) ?? r.qtyDoneInput;
      const qty = parsedQty(input);
      if (qty === null) {
        allValid = false;
        continue;
      }
      parsed.push({ productId: r.productId, qtyDone: qty });
    }
    return { items: parsed, allValid };
  }, [rows, qtyByProductId]);

  const itemsSignature = rows.map((r) => `${r.productId}:${qtyByProductId.get(r.productId) ?? ""}`).join("|");

  // re-preview (debounced) whenever a qty input changes (and on "ตรวจอีกครั้ง") — including the very first run on mount
  useEffect(() => {
    if (!doneItems.allValid) {
      // ผู้ใช้กำลังพิมพ์เลขที่ยังไม่สมบูรณ์อยู่ — รอให้ครบก่อนค่อยยิง ไม่ล้าง preview เดิมทิ้ง (กันตัวเลขกระพริบระหว่างพิมพ์)
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError(null);
    const timer = setTimeout(() => {
      previewProductionOrder(order.id, doneItems.items).then((result) => {
        if (cancelled) return;
        setPreviewLoading(false);
        if (!result.ok) {
          setPreviewError(result.error);
          return;
        }
        setPreview(result.data);
      });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id, itemsSignature, reloadKey]);

  function updateQty(productId: string, value: string) {
    setQtyByProductId((prev) => {
      const next = new Map(prev);
      next.set(productId, value);
      return next;
    });
  }

  function recheck() {
    setSubmitError(null);
    setPreview(null);
    setReloadKey((k) => k + 1);
  }

  const previewByProductId = new Map<string, ProductionOrderPreviewItem>(
    (preview?.items ?? []).map((it) => [it.productId, it])
  );

  const totalQtyDone = doneItems.items.reduce((sum, it) => sum + it.qtyDone, 0);
  // 0186 (R3): โลหะ (ทอง/ทองเหลือง) ที่ใบใช้แต่ยังไม่มีราคาของวันนี้ — done ยัง fail-closed อยู่ที่ DB · ที่นี่กันปุ่มพร้อมบอกทาง (ไม่มีราคาเฉพาะใบ)
  const missingPrices = preview?.missingPrices ?? [];
  const missingPriceLabels = missingPrices.map((m) => PRODUCTION_METAL_LABEL_TH[m]);
  const silverPrice = preview?.metalPrices?.silver ?? preview?.spotPriceThbPerGram ?? null;
  const goldPrice = preview?.metalPrices?.gold ?? null;
  const brassPrice = preview?.metalPrices?.brass ?? null;
  const brassKgText = brassPrice != null ? brassPerGramToKgText(String(brassPrice)) : null;
  const todayLabel = formatThaiDateOnly(effectiveDateBangkok(new Date().toISOString()));
  const priceChanged = !!submitError && submitError.includes(PRICE_CHANGED_MARKER);

  // เหตุผลที่กดยืนยันไม่ได้ (ข้อแรกที่ติด) — null = กดได้
  const blockReason: string | null =
    unboundCount > 0
      ? `ผลิตเสร็จ — ยังมี ${unboundCount} รายการที่ยังไม่ผูก SKU`
      : previewError
        ? "ผลิตเสร็จ — คิดต้นทุนไม่ได้ (ดูข้อความสีแดง)"
        : !doneItems.allValid
          ? "ผลิตเสร็จ — จำนวนที่ผลิตได้จริงไม่ถูกต้อง"
          : previewLoading
            ? "กำลังคิดต้นทุน…"
            : missingPriceLabels.length > 0
              ? `ผลิตเสร็จ — ยังไม่มีราคา${missingPriceLabels.join("/")}`
              : totalQtyDone === 0
                ? "ผลิตเสร็จ — ทุกรายการเป็น 0 ชิ้น"
                : priceChanged
                  ? "ผลิตเสร็จ — ราคาโลหะเปลี่ยน ตรวจอีกครั้งก่อน"
                  : null;
  const canSubmit = blockReason === null && !pending;

  function submit() {
    if (!canSubmit) return;
    setSubmitError(null);
    void (async () => {
      // state pending ของเราเอง (ไม่ใช้ useTransition: React 18 ไม่ถือ pending ข้าม await — ปุ่มยืนยันจะกดซ้ำได้ระหว่างรอ server ทั้งที่เป็นงานล็อกต้นทุน+เข้าสต็อก)
      setPending(true);
      let result: Awaited<ReturnType<typeof doneProductionOrder>>;
      try {
        result = await doneProductionOrder({
          productionOrderId: order.id,
          items: doneItems.items,
          // 0132 M1 → 0186 ต่อโลหะ — ราคาที่ preview ตัวนี้เห็นจริงตอนเปิดหน้าต่าง (หลังพิมพ์จำนวนล่าสุดแล้ว) ส่งกลับให้ DB เทียบกับราคาที่ resolve ได้จริง ณ ตอน
          // กดยืนยัน (กันราคาเลื่อนระหว่างที่หน้าต่างนี้เปิดค้างไว้) — อ็อบเจกต์เดียวกับที่ preview คืน (มีเฉพาะโลหะที่ใบใช้จริง · ใบ fixed ล้วน = {})
          expectedMetalPrices: preview?.metalPrices ?? null,
        });
      } catch {
        setSubmitError("บันทึกผลิตเสร็จไม่สำเร็จ ลองใหม่อีกครั้ง");
        return;
      } finally {
        setPending(false);
      }
      if (!result.ok) {
        setSubmitError(result.error);
        toast.push(result.error, "error");
        return;
      }
      toast.push(`บันทึกผลิตเสร็จ ${result.data.poNo} แล้ว — ของเข้าสต็อกและล็อกต้นทุนของรอบผลิตนี้แล้ว`);
      onDone();
    })();
  }

  return (
    <Modal open onClose={onClose} title={`ยืนยันผลิตเสร็จ — ${order.poNo}`}>
      <p className="rounded-md bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
        กดยืนยันแล้วต้นทุนของ <span className="font-semibold">รอบผลิตนี้</span> จะถูกล็อกตามราคาโลหะวันนี้
        และจำนวนที่ระบุจะถูกบวกเข้าสต็อกกลางทันที — แก้ไขไม่ได้ ต้องเปิดใบผลิตใหม่หากจำนวนผิด
        ต้นทุนของ SKU ในแคตตาล็อกไม่เปลี่ยน (SKU ที่คิดตามราคาเงิน/สเปคยังขยับตามราคาเงินทุกวันเหมือนเดิม)
      </p>

      {previewLoading && !preview && !previewError && (
        <p role="status" className="mt-3 text-sm text-zinc-600">
          กำลังคำนวณต้นทุนตัวอย่าง...
        </p>
      )}

      {previewError && (
        <div role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
            <p className="text-sm text-red-700">{previewError}</p>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={recheck}>
              ตรวจอีกครั้ง
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={onClose}>
              ปิดและไปแก้ที่การ์ด
            </Button>
          </div>
        </div>
      )}

      {unboundCount > 0 && (
        <p role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">
          ใบนี้มี {unboundCount} รายการที่ยังไม่ผูก SKU — ผูก SKU ให้ครบก่อน ระบบถึงคิดต้นทุนและเข้าสต็อกได้
        </p>
      )}

      {preview && !previewError && (
        <>
          <div className="mt-3">
            <h3 className="text-sm font-semibold text-zinc-800">
              ราคาโลหะที่จะใช้ (ของวันนี้ {todayLabel})
              {previewLoading && <span className="ml-1.5 text-xs font-normal text-zinc-500">(กำลังคำนวณใหม่...)</span>}
            </h3>
            <ul className="mt-1 space-y-1 text-sm text-zinc-700">
              {silverPrice != null && (
                <li className="flex flex-wrap items-center gap-2" data-testid="done-silver-price">
                  <MetalTag metal="silver" />
                  <span>
                    ราคาเงินที่จะใช้ในใบนี้: <span className="font-semibold tabular-nums">{formatTHB(silverPrice)}/กรัม</span>
                  </span>
                </li>
              )}
              {/* ราคาทอง/ทองเหลือง: โชว์ค่าที่ server คืนมาตรงๆ (preview.metalPrices) — ที่เห็น = ที่จะส่งกลับเป็น expectedMetalPrices และถูก stamp */}
              {goldPrice != null && (
                <li className="flex flex-wrap items-center gap-2" data-testid="done-gold-price">
                  <MetalTag metal="gold" />
                  <span>
                    ราคาทองที่จะใช้: <span className="font-semibold tabular-nums">{fmtPerGram(goldPrice)} บาท/กรัม</span> (ทอง 100%)
                  </span>
                </li>
              )}
              {brassPrice != null && (
                <li className="flex flex-wrap items-center gap-2" data-testid="done-brass-price">
                  <MetalTag metal="brass" />
                  <span>
                    ราคาทองเหลืองที่จะใช้:{" "}
                    <span className="font-semibold tabular-nums">{brassKgText != null ? `${brassKgText} บาท/กก.` : `${fmtPerGram(brassPrice)} บาท/กรัม`}</span>
                    {brassKgText != null && <span className="ml-1 text-zinc-500 tabular-nums">({fmtPerGram(brassPrice)} บาท/กรัม)</span>}
                  </span>
                </li>
              )}
              {silverPrice == null && goldPrice == null && brassPrice == null && missingPrices.length === 0 && (
                <li className="text-zinc-600">ทุกรายการในใบนี้เป็นต้นทุนคงที่ — ไม่ใช้ราคาโลหะ</li>
              )}
            </ul>
          </div>

          {missingPrices.length > 0 && (
            <div role="alert" className="mt-2 rounded-md border border-red-200 bg-red-50 p-3" data-testid="done-missing-price">
              <p className="text-sm text-red-800">
                ยังไม่มีราคา{missingPriceLabels.join("/")}ของวันนี้ ({todayLabel}) — ต้องกรอกราคา{missingPriceLabels.join("/")}ของวันนี้ก่อน ไม่มีราคาเฉพาะใบ · ห้ามใช้ราคาเก่า
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <a
                  href="/oem/rates"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-9 items-center rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                >
                  เปิดหน้าราคาโลหะ (แท็บใหม่)
                </a>
                <Button type="button" size="sm" variant="secondary" onClick={recheck}>
                  ตรวจอีกครั้ง
                </Button>
              </div>
            </div>
          )}

          <h3 className="mt-3 text-sm font-semibold text-zinc-800">รายการที่จะล็อก</h3>
          <div className="mt-1 space-y-2">
            {rows.map((r) => {
              const calc = previewByProductId.get(r.productId);
              const qtyInput = qtyByProductId.get(r.productId) ?? r.qtyDoneInput;
              const qtyInvalid = parsedQty(qtyInput) === null;
              const changed =
                calc?.unitCost != null && calc?.prevUnitCost != null && Math.abs(calc.unitCost - calc.prevUnitCost) > 0.005;
              // preview คือค่าที่จะถูกล็อกจริง — ใช้ค่าของ preview ตรงๆ (รวมค่าว่าง: น้ำหนัก null ต้องขึ้น "ไม่ได้ระบุ" ห้ามถอยไปหยิบค่าเก่าจากแถว) ·
              // ยกเว้นรายการ skipped (0 ชิ้น — RPC ไม่คิดจึงไม่คืนค่า) ใช้ค่าจากแถวแทน
              const live = calc && !calc.skipped ? calc : null;
              const metal = live ? (live.metal ?? r.metal) : r.metal;
              const rbPurity = live ? live.purity : r.purity;
              const rbWeight = live ? live.weightG : r.weightG;
              return (
                <div key={r.productId} className="rounded-md border border-zinc-200 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-zinc-800">
                      {metal && <MetalTag metal={metal} />}
                      <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                        {r.sku} <span className="font-normal text-zinc-600">· {r.productName}</span>
                      </span>
                    </span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={100000}
                      step={1}
                      value={qtyInput}
                      onChange={(e) => updateQty(r.productId, e.target.value)}
                      aria-label={`จำนวนที่ผลิตได้จริง ${r.sku}`}
                      aria-invalid={qtyInvalid}
                      className={`min-h-11 w-24 shrink-0 rounded-md border px-2 text-right text-sm tabular-nums ${
                        qtyInvalid ? "border-red-400" : "border-zinc-300"
                      }`}
                    />
                  </div>
                  {/* read-back: ค่าที่จะถูกล็อก (จาก preview ของ server) — พิมพ์ผิดตรงนี้ = ต้นทุนผิดทั้งล็อต */}
                  <p className="mt-1 text-xs text-zinc-700" data-testid={`done-readback-${r.productId}`}>
                    {readBack(metal, rbPurity, rbWeight, parsedQty(qtyInput))}
                  </p>
                  {calc?.priceMissing && (
                    <p className="mt-1 text-xs font-medium text-red-700">ยังไม่มีราคา{metal ? PRODUCTION_METAL_LABEL_TH[metal] : "โลหะ"}ของวันนี้ — ยังไม่คิดต้นทุนรายการนี้</p>
                  )}
                  <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-zinc-600">
                    แผนไว้ {r.qtyPlanned.toLocaleString("en-US")} ชิ้น
                    {calc && (
                      <Badge tone={calc.costType === "spot" ? "cyan" : calc.costType === "spec" ? "indigo" : "slate"}>
                        {PRODUCTION_COST_TYPE_LABEL_TH[calc.costType]}
                      </Badge>
                    )}
                    {calc?.skipped && <span className="text-amber-800">— ไม่ได้ผลิตชิ้นนี้ในรอบนี้ (0 ชิ้น)</span>}
                    {calc?.unitCost != null && (
                      <>
                        {"· ต้นทุน/ชิ้น: "}
                        {calc.prevUnitCost != null && changed ? (
                          <>
                            <span className="line-through text-zinc-400">{formatTHB(calc.prevUnitCost)}</span>{" "}
                            <span className="font-semibold text-zinc-800">{formatTHB(calc.unitCost)}</span>
                          </>
                        ) : (
                          <span className="font-semibold text-zinc-800">{formatTHB(calc.unitCost)}</span>
                        )}
                      </>
                    )}
                  </p>

                  {calc?.costType === "spec" && calc.costCalc && (
                    <ProductionSpecCostCard
                      makeSpec={r.makeSpec}
                      silverWeightG={calc.costCalc.weightG ?? calc.weightG ?? calc.silverWeightG}
                      silverPurity={calc.costCalc.purity ?? calc.purity ?? calc.silverPurity}
                      metal={calc.metal}
                      costCalc={calc.costCalc}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {totalQtyDone === 0 && (
            <p className="mt-2 text-xs text-amber-800">
              ทุกรายการเป็น 0 ชิ้น — ถ้าไม่ได้ผลิตจริงเลย ให้ปิดหน้าต่างนี้แล้วกด &quot;ยกเลิกใบ&quot; แทน
            </p>
          )}
        </>
      )}

      {submitError && (
        <div role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">
          <p>{priceChanged ? "ราคาโลหะเปลี่ยนระหว่างที่เปิดหน้านี้ — ตรวจราคาใหม่แล้วยืนยันอีกครั้ง" : submitError}</p>
          {priceChanged && (
            <Button type="button" size="sm" variant="secondary" className="mt-2" onClick={recheck}>
              ตรวจอีกครั้ง
            </Button>
          )}
        </div>
      )}

      {blockReason && !pending && (
        <p id={reasonId} className="mt-3 text-sm text-zinc-700">
          {blockReason}
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <Button type="button" variant="secondary" className="flex-1" onClick={onClose} disabled={pending}>
          ยกเลิก
        </Button>
        <Button
          type="button"
          variant="primary"
          className="flex-1 aria-disabled:cursor-not-allowed aria-disabled:bg-zinc-300 aria-disabled:hover:bg-zinc-300"
          loading={pending}
          aria-disabled={canSubmit ? undefined : true}
          aria-describedby={blockReason ? reasonId : undefined}
          onClick={submit}
        >
          ยืนยันผลิตเสร็จ
        </Button>
      </div>
    </Modal>
  );
}
