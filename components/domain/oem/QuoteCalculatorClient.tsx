"use client";

// QuoteCalculatorClient — /oem/quote (T5v2). Left: N job items, each
// collapsible (QuoteJobItemCard). Right: whole-quote summary + discount +
// save actions (QuoteResultPanel). This file owns form/orchestration state
// only — every displayed price/margin number comes from
// analytics.oem_price_calc via calcPrice()/saveQuote(); no arithmetic here
// (QuoteResultPanel's aggregate preview sums already-computed numbers only,
// see lib/oem/quoteForm.ts).
//
// No SKU picker / PDF in this phase (separate phase) — every saved item's
// product_id/sku_snapshot/product_name_snapshot is left unset; oem_quote_item
// stores itemKind (free text from OEM_ITEM_KIND_OPTIONS) as the only label.

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { calcPrice, saveQuote } from "@/lib/actions/oem";
import type { OemPriceCalcResult, OemSettingData } from "@/lib/oem/types";
import { roundTo } from "@/lib/oem/display";
import type { JobForm } from "@/lib/oem/quoteForm";
import { OEM_DEFAULT_PURITY, buildJobInput, createJobForm } from "@/lib/oem/quoteForm";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { QuoteJobItemCard } from "./QuoteJobItemCard";
import { QuoteResultPanel } from "./QuoteResultPanel";

function genKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);
}

interface ItemState {
  key: string;
  job: JobForm;
  collapsed: boolean;
  calc: OemPriceCalcResult | null;
  calcLoading: boolean;
  calcError: string | null;
}

const inputCls = "min-h-11 w-full rounded-md border border-zinc-300 px-2.5 text-sm text-zinc-900";
const labelCls = "flex flex-col gap-1 text-xs font-semibold text-zinc-600";

export function QuoteCalculatorClient({ setting }: { setting: OemSettingData }) {
  const router = useRouter();
  const toast = useToast();

  const defaultMarginPct = roundTo(setting.marginTargetPct * 100, 2);

  const [customerName, setCustomerName] = useState("");
  const [customerContact, setCustomerContact] = useState("");
  const [items, setItems] = useState<ItemState[]>(() => [
    { key: genKey(), job: createJobForm(defaultMarginPct), collapsed: false, calc: null, calcLoading: false, calcError: null },
  ]);
  const [discountThb, setDiscountThb] = useState("0");
  const [discountReason, setDiscountReason] = useState("");
  const [approvalNote, setApprovalNote] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [quoteId, setQuoteId] = useState<string | null>(null);
  const [savingDraft, startDraft] = useTransition();
  const [savingQuote, startQuote] = useTransition();

  function addItem() {
    setItems((prev) => [
      ...prev,
      { key: genKey(), job: createJobForm(defaultMarginPct), collapsed: false, calc: null, calcLoading: false, calcError: null },
    ]);
    setQuoteId(null);
  }

  function removeItem(key: string) {
    setItems((prev) => (prev.length <= 1 ? prev : prev.filter((it) => it.key !== key)));
    setQuoteId(null);
  }

  function toggleCollapse(key: string) {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, collapsed: !it.collapsed } : it)));
  }

  function updateItemField<K extends keyof JobForm>(key: string, field: K, value: JobForm[K]) {
    setItems((prev) =>
      prev.map((it) => {
        if (it.key !== key) return it;
        const nextJob = { ...it.job, [field]: value };
        if (field === "metal") nextJob.purity = OEM_DEFAULT_PURITY[value as JobForm["metal"]];
        return { ...it, job: nextJob };
      })
    );
    setQuoteId(null); // editing any item starts a fresh (unsaved) quote
  }

  // Snapshot of {key, input} per item, recomputed whenever any job field
  // changes — keyed (not index-based) so an add/remove mid-debounce can't
  // misalign a stale result onto the wrong item.
  const itemSnapshots = useMemo(() => items.map((it) => ({ key: it.key, input: buildJobInput(it.job) })), [items]);
  const allInputsValid = itemSnapshots.every((s) => s.input != null);

  // Debounced live preview — 300ms, cancels the previous timer on every
  // change. Recomputes every item with a valid input in parallel.
  useEffect(() => {
    const withInput = itemSnapshots.filter((s) => s.input != null);
    if (withInput.length === 0) {
      setItems((prev) => prev.map((it) => ({ ...it, calc: null, calcLoading: false, calcError: null })));
      return;
    }

    setItems((prev) =>
      prev.map((it) => {
        const snap = itemSnapshots.find((s) => s.key === it.key);
        return snap?.input ? { ...it, calcLoading: true } : { ...it, calc: null, calcLoading: false, calcError: null };
      })
    );

    const timer = setTimeout(async () => {
      const results = await Promise.all(
        withInput.map(async (s) => ({ key: s.key, result: await calcPrice(s.input!) }))
      );
      setItems((prev) =>
        prev.map((it) => {
          const r = results.find((x) => x.key === it.key);
          if (!r) return it; // this item had no valid input — already cleared above
          if (!r.result.ok) return { ...it, calc: null, calcLoading: false, calcError: r.result.error };
          return { ...it, calc: r.result.data, calcLoading: false, calcError: null };
        })
      );
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(itemSnapshots)]);

  function buildPayloadItems() {
    const payload: { input: NonNullable<(typeof itemSnapshots)[number]["input"]> }[] = [];
    for (const snap of itemSnapshots) {
      if (!snap.input) return null;
      payload.push({ input: snap.input });
    }
    return payload;
  }

  function handleSaveDraft() {
    const payloadItems = buildPayloadItems();
    if (!payloadItems) return;
    setSaveError(null);
    startDraft(async () => {
      const result = await saveQuote({
        items: payloadItems,
        quoteId,
        status: "draft",
        customerName: customerName.trim() || null,
        customerContact: customerContact.trim() || null,
        discountThb: Number(discountThb) || 0,
        discountReason: discountReason.trim() || null,
      });
      if (!result.ok) {
        setSaveError(result.error);
        toast.push(result.error, "error");
        return;
      }
      setQuoteId(result.data.quoteId);
      toast.push("บันทึกร่างแล้ว");
      router.refresh();
    });
  }

  function handleIssueQuote() {
    const payloadItems = buildPayloadItems();
    if (!payloadItems) return;
    setSaveError(null);
    startQuote(async () => {
      const result = await saveQuote({
        items: payloadItems,
        quoteId,
        status: "quoted",
        approvalNote: approvalNote.trim() || null,
        customerName: customerName.trim() || null,
        customerContact: customerContact.trim() || null,
        discountThb: Number(discountThb) || 0,
        discountReason: discountReason.trim() || null,
      });
      if (!result.ok) {
        setSaveError(result.error);
        toast.push(result.error, "error");
        return;
      }
      toast.push("ออกใบเสนอราคาแล้ว");
      router.push(`/oem/quotes/${result.data.quoteId}`);
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-zinc-900">คิดราคางาน OEM</h1>
        <p className="mt-0.5 text-sm text-zinc-500">ราคาคำนวณสดจากต้นทุนที่กรอกไว้ที่หน้า &quot;ต้นทุน&quot; — ใส่ได้หลายรายการต่อ 1 ใบเสนอราคา</p>
      </div>

      <div className="grid gap-4 md:grid-cols-[1fr_380px] md:items-start">
        {/* left: customer + N job items */}
        <div className="space-y-4">
          <section className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
            <h2 className="text-sm font-bold text-zinc-800">ลูกค้า</h2>
            <div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <label className={labelCls}>
                ชื่อลูกค้า
                <input type="text" value={customerName} onChange={(e) => setCustomerName(e.target.value)} className={inputCls} placeholder="เช่น ร้าน ABC" />
              </label>
              <label className={labelCls}>
                ช่องทางติดต่อ
                <input type="text" value={customerContact} onChange={(e) => setCustomerContact(e.target.value)} className={inputCls} placeholder="เบอร์โทร / LINE" />
              </label>
            </div>
          </section>

          <section className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-zinc-800">รายการงาน ({items.length})</h2>
              <Button type="button" variant="secondary" size="sm" onClick={addItem}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                เพิ่มรายการ
              </Button>
            </div>

            <div className="space-y-2.5">
              {items.map((it, idx) => (
                <QuoteJobItemCard
                  key={it.key}
                  index={idx}
                  job={it.job}
                  collapsed={it.collapsed}
                  canRemove={items.length > 1}
                  calc={it.calc}
                  calcLoading={it.calcLoading}
                  calcError={it.calcError}
                  onChange={(field, value) => updateItemField(it.key, field, value)}
                  onRemove={() => removeItem(it.key)}
                  onToggleCollapse={() => toggleCollapse(it.key)}
                />
              ))}
            </div>
          </section>
        </div>

        {/* right: whole-quote result (desktop sticky, mobile stacked below) */}
        <div className="md:sticky md:top-[7.5rem]">
          <QuoteResultPanel
            items={items.map((it) => ({ key: it.key, job: it.job, calc: it.calc, calcLoading: it.calcLoading, calcError: it.calcError }))}
            setting={setting}
            allInputsValid={allInputsValid}
            discountThb={discountThb}
            onDiscountThbChange={setDiscountThb}
            discountReason={discountReason}
            onDiscountReasonChange={setDiscountReason}
            approvalNote={approvalNote}
            onApprovalNoteChange={setApprovalNote}
            onSaveDraft={handleSaveDraft}
            onIssueQuote={handleIssueQuote}
            savingDraft={savingDraft}
            savingQuote={savingQuote}
            saveError={saveError}
          />
        </div>
      </div>
    </div>
  );
}
