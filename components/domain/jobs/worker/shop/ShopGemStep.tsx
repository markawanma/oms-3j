"use client";

// ShopGemStep — W-4 "พลอย" (UX ux-gems.md §3 · หลัง W-3 จำนวน ก่อน W-5 รูป)
//  - SKU ไม่มีแม่แบบ: 🔴 ต้องตอบก่อน "ชิ้นนี้ฝังพลอยไหม?" (ไม่มีค่าเริ่ม — กันลืมแล้วใบไม่มีขั้นฝังโดยไม่มีใครสังเกต P8) · SKU มีแม่แบบ: เริ่ม "มีพลอย" + แถวจากแม่แบบ (ป้าย "จากแม่แบบ")
//  - "มีพลอย" ต้อง ≥ 1 แถวที่ครบและไม่ซ้ำ · "ไม่มีพลอย" ที่มีแถวอยู่ = กล่องยืนยันก่อนล้าง (ล้างเฉพาะใบนี้ แม่แบบ SKU ไม่เปลี่ยน)
//  - พลอยไปพร้อมคำขอเปิดใบ ผ่านทั้งหมดหรือไม่เปิดเลย — server ปฏิเสธแถวไหน พากลับมาที่นี่แถว/ช่องนั้น (serverErrors + focusRequest) ฟอร์มและรูปคงอยู่
//  - 4 state: loading (catalog — กรอกได้ทันทีไม่รอ) · empty (ยังไม่ตอบ / ไม่มีพลอย) · error (catalog โหลดไม่ได้ ไม่บล็อก · error ต่อแถว/ทั้งขั้น) · success (แถวพับ + รวม + ถัดไป)
//  - 🔴 ไม่มีตัวเลขเงิน/ราคา · state อยู่ใน ShopForm.gems (ผู้เรียกถือ) — จอนี้ไม่เรียก server เอง (catalog มาจาก useShopGemCatalog ของผู้เรียก)

import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { BigButton } from "@/components/domain/jobs/worker/WorkerParts";
import { StickyAction } from "@/components/domain/jobs/worker/WorkerPanels";
import { ShopConfirmBox } from "@/components/domain/jobs/worker/shop/ShopConfirmBox";
import { ShopGemEditor } from "@/components/domain/jobs/worker/shop/ShopGemEditor";
import type { ShopGemFocusRequest } from "@/components/domain/jobs/worker/shop/ShopGemEditor";
import type { ShopGemCatalog } from "@/components/domain/jobs/worker/shop/useShopGemCatalog";
import { emptyGemRow } from "@/lib/jobs/gem-draft";
import type { GemDraftRow } from "@/lib/jobs/gem-draft";
import { SHOP_GEM_TH, addForce, gemRowHasContent, gemStepIssue, issueFocusField, pruneForce, seedFromTemplate } from "@/lib/jobs/shop-gem-flow";
import type { GemAnswer, GemRowErrors } from "@/lib/jobs/shop-gem-flow";
import { plannedQtyOf } from "@/lib/jobs/shop-open";
import type { ShopForm } from "@/lib/jobs/shop-open";

const ID_PREFIX = "shop-gem";
const fmt = (n: number) => n.toLocaleString("en-US");

export function ShopGemStep({
  form,
  setForm,
  catalog,
  onNext,
  serverErrors,
  generalError,
  focusRequest,
  onEdited,
}: {
  form: ShopForm;
  setForm: Dispatch<SetStateAction<ShopForm>>;
  /** รายการชนิด/รูปทรง/แม่แบบ (ผู้เรียกถือ — ไม่โหลดซ้ำทุกครั้งที่กลับมาขั้นนี้) */
  catalog: ShopGemCatalog;
  onNext: () => void;
  /** error ต่อแถวที่ server ปฏิเสธตอนกด "เปิดงาน" (key ของแถว) */
  serverErrors: GemRowErrors;
  /** error ระดับทั้งขั้น (เช่น เพดานชื่อใหม่ · คำตอบไม่ครบ) */
  generalError: string | null;
  /** พาไปแถว/ช่องที่ผิด */
  focusRequest: ShopGemFocusRequest | null;
  /** ผู้ใช้แก้พลอย → ผู้เรียกล้าง error ของ server (แก้แล้วไม่ควรค้างข้อความเก่า) */
  onEdited: () => void;
}) {
  const g = form.gems;
  const productId = form.mode === "sku" ? (form.product?.id ?? null) : null;
  const [changing, setChanging] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [localFocus, setLocalFocus] = useState<ShopGemFocusRequest | null>(null);
  const nonce = useRef(0);
  const radioRef = useRef<HTMLButtonElement>(null);
  const planned = plannedQtyOf(form);

  const { options, optionsState } = catalog;
  const ready = catalog.state.s === "ready" ? catalog.state.data : null;
  const onReloadCatalog = catalog.reload;

  // SKU ที่มีแม่แบบ: เริ่ม "มีพลอย" + แถวจากแม่แบบ (ครั้งเดียวต่อ SKU — seed ล้างเมื่อเปลี่ยนสินค้า) · ไม่มีแม่แบบ = ไม่มีค่าเริ่ม
  // แม่แบบมาช้า: ผู้ใช้กด "มีพลอย" ไปก่อน catalog โหลดเสร็จ (ได้แถวเปล่า) → เติมแม่แบบเมื่อมาถึง ถ้ายังมีแต่แถวเปล่าที่ไม่ได้กรอก (ไม่ทับสิ่งที่พิมพ์ · ไม่ทับ "ไม่มีพลอย")
  // แถวเท่าแม่แบบเป๊ะ = ส่ง "template" (ไม่ใช่ has แทนเงียบๆ) — seed เป็นตัวบอก (isTemplateUntouched)
  const blank = g.rows.every((r) => !gemRowHasContent(r));
  useEffect(() => {
    if (!ready || productId === null || g.seed !== null || !ready.hasTemplate || ready.template.length === 0) return;
    const seedable = (gs: ShopForm["gems"]) => gs.seed === null && (gs.answer === "unset" || (gs.answer === "has" && gs.rows.every((r) => !gemRowHasContent(r))));
    if (!seedable(g)) return;
    setForm((f) => (seedable(f.gems) && f.mode === "sku" && f.product?.id === productId ? { ...f, gems: seedFromTemplate(productId, ready.template) } : f));
    // g เป็นวัตถุใหม่ทุก render — ใช้ field ที่ตัดสินจริงเป็น dependency
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, productId, g.answer, g.seed, blank, setForm]);

  function setRows(rows: GemDraftRow[]) {
    setForm((f) => ({ ...f, gems: { ...f.gems, rows, force: pruneForce(f.gems.force, rows) } }));
    onEdited();
  }

  function chooseHas() {
    setChanging(false);
    if (g.answer === "has") return;
    const fresh = g.rows.length === 0 ? emptyGemRow("manual") : null;
    const templ = ready && productId !== null && ready.hasTemplate && ready.template.length > 0 ? ready.template : null;
    setForm((f) => {
      if (f.gems.rows.length > 0) return { ...f, gems: { ...f.gems, answer: "has" } };
      if (templ && productId !== null) return { ...f, gems: seedFromTemplate(productId, templ) };
      return { ...f, gems: { ...f.gems, answer: "has", rows: fresh ? [fresh] : [] } };
    });
    onEdited();
    if (fresh && !templ) setLocalFocus({ rowKey: fresh.key, field: "type", nonce: ++nonce.current });
  }

  function applyNone() {
    setConfirmClear(false);
    setChanging(false);
    setForm((f) => ({ ...f, gems: { ...f.gems, answer: "none", rows: [], force: [] } }));
    onEdited();
  }

  function chooseNone() {
    if (g.answer === "none") {
      setChanging(false);
      return;
    }
    if (g.rows.some(gemRowHasContent)) setConfirmClear(true);
    else applyNone();
  }

  const issue = gemStepIssue(g, options);
  const showReason = issue !== null && (attempted || g.answer === "unset");

  function next() {
    setAttempted(true);
    if (issue === null) {
      onNext();
      return;
    }
    if (issue.rowKey) {
      setLocalFocus({ rowKey: issue.rowKey, field: issueFocusField(g.rows.find((r) => r.key === issue.rowKey)), nonce: ++nonce.current });
      return;
    }
    radioRef.current?.focus();
  }

  const checked = (a: GemAnswer) => g.answer === a;
  const showRadios = g.answer === "unset" || changing;
  const fr = focusRequest ?? localFocus;
  const answerLabel = g.answer === "has" ? SHOP_GEM_TH.has : SHOP_GEM_TH.none;
  const RADIO = "flex min-h-16 w-full items-center gap-3 rounded-2xl border-2 px-4 text-left text-xl font-bold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-300";

  return (
    <>
      <div className="mt-3 space-y-4">
        {showRadios ? (
          <section aria-labelledby="shop-gem-q" className="space-y-3">
            <p id="shop-gem-q" className="text-lg text-zinc-900">
              {SHOP_GEM_TH.question}
            </p>
            <div role="radiogroup" aria-labelledby="shop-gem-q" aria-describedby="shop-gem-q-hint" className="space-y-2">
              <button ref={radioRef} type="button" role="radio" aria-checked={checked("has")} onClick={chooseHas} className={`${RADIO} ${checked("has") ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-900"}`}>
                <span aria-hidden="true" className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${checked("has") ? "border-white" : "border-zinc-500"}`}>
                  {checked("has") && <span className="h-3 w-3 rounded-full bg-white" />}
                </span>
                {SHOP_GEM_TH.has}
              </button>
              <button type="button" role="radio" aria-checked={checked("none")} onClick={chooseNone} className={`${RADIO} ${checked("none") ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-900"}`}>
                <span aria-hidden="true" className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${checked("none") ? "border-white" : "border-zinc-500"}`}>
                  {checked("none") && <span className="h-3 w-3 rounded-full bg-white" />}
                </span>
                {SHOP_GEM_TH.none}
              </button>
            </div>
            <p id="shop-gem-q-hint" className="flex items-start gap-2 text-base text-zinc-700">
              <span aria-hidden="true">ⓘ</span>
              <span>
                {SHOP_GEM_TH.hintHas} · {SHOP_GEM_TH.hintNone}
              </span>
            </p>
          </section>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <p className="inline-flex min-h-12 items-center rounded-xl border-2 border-zinc-900 bg-white px-4 text-xl font-bold text-zinc-900" data-testid="shop-gem-answer">
              {answerLabel}
            </p>
            <button type="button" onClick={() => setChanging(true)} className="min-h-12 rounded-lg px-3 text-lg font-semibold text-primary-800 underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-300">
              {SHOP_GEM_TH.change}
            </button>
          </div>
        )}

        {/* รายการพลอยของร้าน/แม่แบบ SKU กำลังโหลด หรือโหลดไม่ได้ — บอกตั้งแต่ยังไม่ได้ตอบ (SKU ที่มีแม่แบบจะได้แถวมาให้หลังโหลดเสร็จ) · ไม่บล็อกการตอบ (ตอนตอบ "มีพลอย" ตัวแก้แสดงสถานะเดียวกันเอง) */}
        {g.answer !== "has" && (catalog.state.s === "idle" || catalog.state.s === "loading") && (
          <div role="status" aria-label={SHOP_GEM_TH.loadingCatalog} className="space-y-2" data-testid="shop-gem-catalog-loading">
            <div className="h-5 w-56 animate-pulse rounded bg-zinc-200" />
            <span className="sr-only">{SHOP_GEM_TH.loadingCatalog}…</span>
          </div>
        )}
        {g.answer !== "has" && catalog.state.s === "error" && (
          <div role="status" className="space-y-2 rounded-xl border-2 border-amber-300 bg-amber-50 p-3 text-amber-950" data-testid="shop-gem-catalog-error">
            <p className="text-lg font-semibold">{SHOP_GEM_TH.catalogError}</p>
            <button type="button" onClick={onReloadCatalog} className="min-h-12 rounded-xl border-2 border-amber-600 bg-white px-5 text-lg font-bold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-300">
              {SHOP_GEM_TH.retry}
            </button>
          </div>
        )}

        {generalError && (
          <p role="alert" className="rounded-xl border-2 border-red-200 bg-red-50 p-3 text-lg font-semibold break-words text-red-800" data-testid="shop-gem-general-error">
            {generalError}
          </p>
        )}

        {g.answer === "none" && !changing && (
          <p className="rounded-xl border-2 border-dashed border-zinc-300 bg-white p-4 text-lg text-zinc-900" data-testid="shop-gem-none-summary">
            {SHOP_GEM_TH.summaryNone}
          </p>
        )}

        {g.answer === "has" && (
          <>
            {planned.qty !== null && (
              <p className="text-base text-zinc-800" data-testid="shop-gem-multiplier">
                คูณด้วยจำนวนที่จะผลิต {fmt(planned.qty)} ชิ้น{planned.note ? ` (${planned.note})` : ""}
              </p>
            )}
            <ShopGemEditor
              idPrefix={ID_PREFIX}
              rows={g.rows}
              onChange={setRows}
              options={options}
              sizes={ready ? ready.sizes : []}
              optionsState={optionsState}
              onRetryOptions={onReloadCatalog}
              qtyPlanned={planned.qty}
              showIssues={attempted}
              serverErrors={serverErrors}
              focusRequest={fr}
              onForceSimilar={(info) => {
                setForm((f) => ({ ...f, gems: { ...f.gems, force: addForce(f.gems.force, info) } }));
              }}
              emptyText="ยังไม่มีพลอยในใบนี้"
            />
          </>
        )}
      </div>

      <StickyAction>
        {showReason && issue && (
          <p id="shop-gem-next-why" role="status" className="mb-2 text-base font-semibold text-zinc-900">
            {issue.message}
          </p>
        )}
        <BigButton type="button" aria-disabled={issue ? true : undefined} aria-describedby={showReason ? "shop-gem-next-why" : undefined} onClick={next}>
          ถัดไป
        </BigButton>
      </StickyAction>

      {/* ล้างพลอยออกจากใบ — focus เริ่มที่ปุ่มปลอดภัย "ไม่ล้าง" */}
      {confirmClear && (
        <ShopConfirmBox title={SHOP_GEM_TH.clearConfirmTitle} body={SHOP_GEM_TH.clearConfirm(g.rows.filter(gemRowHasContent).length)} safe={SHOP_GEM_TH.clearNo} risky={SHOP_GEM_TH.clearYes} onSafe={() => setConfirmClear(false)} onRisky={applyNone} testId="shop-gem-clear-confirm" />
      )}
    </>
  );
}
