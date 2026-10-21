"use client";

// ShopProductSearch — W-2 "ผลิตอะไร?" ค้น SKU + กิ่ง "สินค้าใหม่ (ยังไม่มีรหัส)" (UX B.3 · ภาษาภาพ Open2)
// ค้นล้มต้องไม่บล็อกงาน: กิ่งสินค้าใหม่ใช้ได้เสมอ · ช่องค้นไม่ถูกปิดระหว่างโหลด (พิมพ์ต่อได้) · ผลตอบกลับเก่าที่มาช้ากว่าไม่ทับผลใหม่ (seq)
// 🔴 ผลค้น = id/sku/ชื่อ/รูป/prefill โลหะ เท่านั้น (server allowlist) — ไม่มีราคา/ต้นทุน · ไม่โชว์น้ำหนักของทอง

import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { intakeSearch } from "@/lib/actions/job-worker";
import { ShopMetalTag } from "@/components/domain/jobs/worker/shop/ShopMetalTag";
import { ShopFieldError } from "@/components/domain/jobs/worker/shop/ShopMetalFields";
import { BigButton } from "@/components/domain/jobs/worker/WorkerParts";
import { StickyAction, focusField } from "@/components/domain/jobs/worker/WorkerPanels";
import { backToSearch, labelIssue, searchErrorMessage, selectProduct, startNewProduct, SHOP_LABEL_MAX } from "@/lib/jobs/shop-open";
import type { ShopForm } from "@/lib/jobs/shop-open";
import type { IntakeProduct } from "@/lib/jobs/worker-server";

type SearchState = { status: "idle" } | { status: "loading" } | { status: "error"; message: string } | { status: "done"; items: IntakeProduct[] };

export const SEARCH_DEBOUNCE_MS = 300;
export const LABEL_FIELD_ID = "shop-label";
const FIELD = "min-h-14 w-full rounded-xl border-2 border-zinc-400 bg-white px-4 text-xl text-zinc-900 focus:border-primary-600 focus:outline-none focus:ring-4 focus:ring-primary-200";

function Thumb({ url }: { url: string | null }) {
  const [broken, setBroken] = useState(false);
  if (!url || broken) return <span aria-hidden="true" className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-sm text-zinc-500">ไม่มีรูป</span>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" width={64} height={64} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="h-16 w-16 shrink-0 rounded-lg object-cover" />;
}

export function ShopProductSearch({
  token,
  form,
  setForm,
  onNext,
  onSessionLost,
  showLabelError,
  setShowLabelError,
  query,
  setQuery,
}: {
  token: string;
  form: ShopForm;
  setForm: Dispatch<SetStateAction<ShopForm>>;
  onNext: () => void;
  /** session หมดเวลา/ไม่พบ — ให้ผู้เรียกโหลด hub ใหม่ (แผ่น PIN) */
  onSessionLost: () => void;
  showLabelError: boolean;
  setShowLabelError: (v: boolean) => void;
  /** คำค้นถูกเก็บที่ผู้เรียก — ย้อนกลับมาหน้านี้แล้วคำค้นไม่หาย */
  query: string;
  setQuery: (q: string) => void;
}) {
  const [state, setState] = useState<SearchState>({ status: "idle" });
  const seq = useRef(0);
  const [retryTick, setRetryTick] = useState(0);
  const q = query.trim();

  const run = useCallback(
    async (text: string, my: number) => {
      try {
        const r = await intakeSearch(token, text);
        if (my !== seq.current) return; // มีคำค้นใหม่กว่าแล้ว
        if (r.ok) setState({ status: "done", items: r.items });
        else {
          if (r.code === "session_required") onSessionLost();
          setState({ status: "error", message: searchErrorMessage(r) });
        }
      } catch {
        if (my === seq.current) setState({ status: "error", message: searchErrorMessage({ error: "" }) });
      }
    },
    [token, onSessionLost],
  );

  useEffect(() => {
    const my = ++seq.current;
    if (q === "") {
      setState({ status: "idle" });
      return;
    }
    setState({ status: "loading" });
    const t = setTimeout(() => void run(q, my), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q, run, retryTick]);

  const selectedId = form.product?.id ?? null;
  const items = state.status === "done" ? state.items : [];
  const noneFound = state.status === "done" && items.length === 0;

  // ---------- กิ่งสินค้าใหม่ ----------
  if (form.mode === "new") {
    const issue = labelIssue(form.label);
    const shown = showLabelError ? issue : null;
    const len = form.label.replace(/\s+/g, " ").trim().length;
    return (
      <>
        <section aria-label="สินค้าใหม่ ยังไม่มีรหัส" className="mt-4 space-y-3 rounded-2xl border-2 border-dashed border-zinc-400 p-4 focus-within:border-solid focus-within:border-zinc-900">
          <p className="text-lg font-bold text-zinc-900">สินค้าใหม่ (ยังไม่มีรหัส)</p>
          <div className="space-y-1.5">
            <label htmlFor={LABEL_FIELD_ID} className="block text-lg font-bold text-zinc-900">
              ชื่อแบบ <span className="text-primary-700">*</span>
            </label>
            <input
              id={LABEL_FIELD_ID}
              type="text"
              autoComplete="off"
              enterKeyHint="next"
              value={form.label}
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
              onBlur={() => setShowLabelError(true)}
              aria-invalid={shown ? true : undefined}
              aria-describedby={shown ? `${LABEL_FIELD_ID}-err` : `${LABEL_FIELD_ID}-hint`}
              placeholder="เช่น แหวนลายใบไม้"
              className={`${FIELD} break-words ${shown ? "ring-2 ring-red-500" : ""}`}
            />
            <div className="flex items-start justify-between gap-3">
              <p id={`${LABEL_FIELD_ID}-hint`} className="text-base text-zinc-700">
                ตั้งชื่อให้ช่างเรียกถูก · ไม่เกิน {SHOP_LABEL_MAX} ตัวอักษร
              </p>
              <p aria-live="off" className={`shrink-0 text-base tabular-nums ${len > SHOP_LABEL_MAX ? "font-bold text-red-700" : "text-zinc-600"}`}>
                {len}/{SHOP_LABEL_MAX}
              </p>
            </div>
            {shown && <ShopFieldError id={`${LABEL_FIELD_ID}-err`}>{shown}</ShopFieldError>}
          </div>
          <BigButton type="button" tone="secondary" onClick={() => { setShowLabelError(false); setForm(backToSearch(form)); }}>
            ← กลับไปค้นสินค้า
          </BigButton>
        </section>
        <StickyAction>
          <BigButton
            type="button"
            aria-disabled={issue ? true : undefined}
            onClick={() => {
              if (issue) {
                setShowLabelError(true);
                focusField(LABEL_FIELD_ID);
                return;
              }
              onNext();
            }}
          >
            {form.label.trim() === "" ? MSG_NEXT_NEEDS_LABEL : "ถัดไป"}
          </BigButton>
        </StickyAction>
      </>
    );
  }

  // ---------- ค้นสินค้า ----------
  return (
    <>
      <div className="mt-4 space-y-3">
        <div className="space-y-1.5">
          <label htmlFor="shop-search" className="block text-lg font-bold text-zinc-900">
            ค้นชื่อสินค้าหรือรหัส
          </label>
          <input
            id="shop-search"
            type="search"
            autoComplete="off"
            enterKeyHint="search"
            maxLength={60}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-controls="shop-results"
            className={FIELD}
          />
        </div>

        {form.product && (
          <p role="status" className="rounded-xl border-2 border-zinc-900 bg-zinc-50 p-3 text-lg text-zinc-900">
            <span aria-hidden="true">✓ </span>เลือกแล้ว: <strong className="break-words">{form.product.name}</strong> <span className="text-base text-zinc-700">({form.product.sku})</span>
          </p>
        )}

        <div id="shop-results" aria-busy={state.status === "loading"}>
          {state.status === "idle" && <p className="text-lg text-zinc-700">พิมพ์ชื่อสินค้าหรือรหัส</p>}
          {state.status === "loading" && (
            <div role="status" aria-label="กำลังค้น" className="animate-pulse space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex h-[84px] items-center gap-3 rounded-2xl border-2 border-zinc-200 p-2.5">
                  <div className="h-16 w-16 rounded-lg bg-zinc-200" />
                  <div className="flex-1 space-y-2">
                    <div className="h-5 w-2/3 rounded bg-zinc-200" />
                    <div className="h-4 w-1/3 rounded bg-zinc-200" />
                  </div>
                </div>
              ))}
              <span className="sr-only">กำลังค้น…</span>
            </div>
          )}
          {state.status === "error" && (
            <div className="space-y-2">
              <p role="alert" className="rounded-xl border-2 border-red-200 bg-red-50 p-3 text-lg font-semibold text-red-800">
                {state.message}
              </p>
              <BigButton type="button" tone="secondary" onClick={() => setRetryTick((n) => n + 1)}>
                ลองอีกครั้ง
              </BigButton>
              <p className="text-base text-zinc-700">ค้นไม่ได้ก็ไม่เป็นไร — เปิดเป็นสินค้าใหม่ได้ด้านล่าง</p>
            </div>
          )}
          {state.status === "done" && items.length > 0 && (
            <div className="space-y-2">
              <p role="status" className="text-lg font-semibold text-zinc-900">
                เจอ {items.length} รายการ
              </p>
              <ul className="space-y-2">
                {items.map((it) => {
                  const on = selectedId === it.id;
                  return (
                    <li key={it.id}>
                      <button
                        type="button"
                        aria-pressed={on}
                        onClick={() => setForm((f) => selectProduct(f, it))}
                        className={`flex min-h-[84px] w-full items-center gap-3 rounded-2xl border-2 bg-white p-2.5 text-left focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-300 ${on ? "border-zinc-900 ring-1 ring-zinc-900" : "border-zinc-300"}`}
                      >
                        <Thumb url={it.imageUrl} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-xl font-bold break-words text-zinc-900">{it.name}</span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-2 text-base text-zinc-700">
                            <span>{it.sku}</span>
                            {it.prefill.metalKnown && <ShopMetalTag metal={it.prefill.metal} size="sm" />}
                          </span>
                        </span>
                        {on && <span aria-hidden="true" className="shrink-0 text-2xl font-bold text-zinc-900">✓</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {items.length >= 20 && <p className="text-base text-zinc-700">แสดง 20 รายการแรก — พิมพ์เพิ่มให้แคบลง</p>}
            </div>
          )}
          {noneFound && <p role="status" className="text-lg text-zinc-800">ไม่พบ &ldquo;{q}&rdquo; — ลองคำอื่น หรือเปิดเป็นสินค้าใหม่</p>}
        </div>

        <section aria-label="ไม่มีในรายการ" className="space-y-2 rounded-2xl border-2 border-dashed border-zinc-400 p-4">
          <p className="text-lg font-bold text-zinc-900">ไม่มีในรายการ?</p>
          <p className="text-base text-zinc-700">เปิดงานด้วยชื่อได้เลย ออฟฟิศผูกรหัสสินค้าให้ทีหลัง</p>
          <BigButton type="button" tone={noneFound ? "primary" : "secondary"} onClick={() => { setShowLabelError(false); setForm(startNewProduct(form)); }}>
            + สินค้าใหม่ (ยังไม่มีรหัส)
          </BigButton>
        </section>
      </div>

      <StickyAction>
        <BigButton type="button" aria-disabled={form.product ? undefined : true} onClick={() => { if (form.product) onNext(); }}>
          {form.product ? "ถัดไป" : "เลือกสินค้าก่อน"}
        </BigButton>
      </StickyAction>
    </>
  );
}

const MSG_NEXT_NEEDS_LABEL = "ใส่ชื่อแบบก่อน";
