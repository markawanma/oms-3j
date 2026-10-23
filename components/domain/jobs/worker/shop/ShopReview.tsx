"use client";

// ShopReview — W-6/7 "ทวนก่อนเปิดงาน" (UX B.6 · ภาษาภาพ Open6)
// แถว "ทำจาก" มาก่อน "จำนวนผลิต" · ทองใช้กรอบหนาเหลืองทอง (จุดสุดท้ายที่คนเห็นโลหะก่อนเขียน DB — R6)
// ระหว่างส่ง: ทุกช่อง/ปุ่ม "แก้" disabled (fieldset) + ปุ่มหลัก "กำลังเปิดงาน…" · กันกดซ้ำที่ผู้เรียก (inflight) · idem key คงเดิมข้ามการลองใหม่
// ตัดปุ่มข้อความที่ใช้บ่อยออก (มติ ค6) · 🔴 ไม่มีตัวเลขเงิน

import type { Dispatch, SetStateAction } from "react";
import { BigButton } from "@/components/domain/jobs/worker/WorkerParts";
import { StickyAction } from "@/components/domain/jobs/worker/WorkerPanels";
import { ShopErrorBanner } from "@/components/domain/jobs/worker/shop/ShopErrorBanner";
import { ShopFieldError } from "@/components/domain/jobs/worker/shop/ShopMetalFields";
import { ShopMetalRow } from "@/components/domain/jobs/worker/shop/ShopMetalSummary";
import { ShopReviewGemsRow } from "@/components/domain/jobs/worker/shop/ShopReviewGemsRow";
import { dueLabel, noteIssue, qtySummary } from "@/lib/jobs/shop-open";
import type { ShopErrorView, ShopForm } from "@/lib/jobs/shop-open";
import { SHOP_PHOTO_TH } from "@/lib/jobs/shop-photos";
import type { ShopPhotoItem } from "@/lib/jobs/shop-photos";

const ROW = "flex items-start gap-3";
const DT = "w-24 shrink-0 pt-0.5 text-base font-semibold text-zinc-700";
const DD = "min-w-0 flex-1 text-lg font-semibold break-words text-zinc-900";

export function ShopReview({
  form,
  setForm,
  today,
  busy,
  error,
  waitLeft,
  readyNote,
  onSubmit,
  onEditProduct,
  onEditMetal,
  onEditGems,
  onBack,
  photos,
  onEditPhotos,
}: {
  form: ShopForm;
  setForm: Dispatch<SetStateAction<ShopForm>>;
  today: string;
  busy: boolean;
  error: ShopErrorView | null;
  waitLeft: number;
  /** ประกาศครั้งเดียวเมื่อนับถอยหลังจบ */
  readyNote: string | null;
  onSubmit: () => void;
  onEditProduct: () => void;
  onEditMetal: () => void;
  /** 0191 W3: กลับไป W-4 พลอย (แถวที่กรอกคงอยู่) */
  onEditGems: () => void;
  /** แก้จากข้อผิดพลาด: กลับไปช่อง/ขั้นที่ผิด */
  onBack: () => void;
  /** 0189 W2: รูปที่เลือกไว้ (ยังอยู่ในเครื่อง ยังไม่ส่ง) — ไม่ส่ง = ไม่มีแถว "รูป" */
  photos?: readonly ShopPhotoItem[];
  /** กลับไป W-5 (รูปคงอยู่) */
  onEditPhotos?: () => void;
}) {
  const unbound = form.mode === "new";
  const name = unbound ? form.label.replace(/\s+/g, " ").trim() : (form.product?.name ?? "");
  const sku = unbound ? null : (form.product?.sku ?? null);
  const nErr = noteIssue(form.note);
  const waiting = error?.action === "wait" && waitLeft > 0;
  const final = error?.action === "final";
  const blocked = waiting || final;
  const label = busy ? "กำลังเปิดงาน…" : waiting ? `รอ ${waitLeft} วิ…` : final ? "เปิดงานไม่ได้" : "เปิดงาน";

  return (
    <>
      <form
        className="mt-4 space-y-4"
        // 🔴 ฟอร์มนี้ไม่มีทาง submit ด้วยคีย์บอร์ด/Enter — เปิดงาน (เขียน DB) ได้ทางปุ่ม "เปิดงาน" ที่กดชัดเจนเท่านั้น (Enter ในช่องหมายเหตุเคยเปิดใบเงียบๆ)
        onSubmit={(e) => e.preventDefault()}
      >
        <fieldset disabled={busy} aria-busy={busy} className="space-y-4">
          <legend className="sr-only">สรุปงานที่จะเปิด</legend>
          <div className="space-y-3 rounded-2xl border-2 border-zinc-300 bg-white p-4">
            <div className={ROW}>
              <p className={DT}>สินค้า</p>
              <div className="min-w-0 flex-1">
                <p className="text-xl font-bold break-words text-zinc-900">{name}</p>
                {unbound ? (
                  <p className="mt-1 inline-block rounded-md bg-[#FFF1C2] px-2 py-0.5 text-base font-semibold text-[#5A3D00]">⚑ ไม่มีรหัสสินค้า</p>
                ) : (
                  <p className="text-base text-zinc-700">{sku}</p>
                )}
              </div>
              <button type="button" onClick={onEditProduct} aria-label="แก้สินค้า" className="min-h-11 shrink-0 rounded-lg px-3 text-lg font-semibold text-primary-800 underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-300 disabled:opacity-40">
                แก้
              </button>
            </div>
            <ShopMetalRow form={form} onEdit={onEditMetal} disabled={busy} compact />
            <div className={ROW}>
              <p className={DT}>จำนวนผลิต</p>
              <p className={DD}>{qtySummary(form)}</p>
            </div>
            <ShopReviewGemsRow form={form} onEdit={onEditGems} disabled={busy} />
            <div className={ROW}>
              <p className={DT}>กำหนดเสร็จ</p>
              <p className={DD}>{dueLabel(form.due, today)}</p>
            </div>
            <div className={ROW}>
              <p className={DT}>แบบใหม่</p>
              <p className={DD}>{form.isNewDesign ? "ใช่" : "ไม่ใช่"}</p>
            </div>
            {photos && onEditPhotos && (
              // แถวสุดท้ายของการ์ด (ไม่แทรกก่อน "ทำจาก/จำนวน" — โลหะ/เนื้อ/จำนวนคือจุดตรวจสำคัญสุด ไม่ควรถูกดันลง)
              <div className={ROW}>
                <p className={DT}>รูป</p>
                <div className="min-w-0 flex-1">
                  {photos.length > 0 ? (
                    <>
                      <div className="flex items-center gap-2">
                        <ul className="flex gap-1.5">
                          {[...photos.filter((p) => p.isPrimary), ...photos.filter((p) => !p.isPrimary)].map((p, i) => (
                            <li key={p.key} className="relative h-14 w-14 overflow-hidden rounded-lg border border-zinc-300 bg-zinc-100">
                              {p.smUrl && (
                                // eslint-disable-next-line @next/next/no-img-element -- blob URL ในเครื่อง
                                <img src={p.smUrl} alt={`รูปที่ ${i + 1} จาก ${photos.length}`} referrerPolicy="no-referrer" draggable={false} className="h-full w-full object-cover" />
                              )}
                              {p.isPrimary && (
                                <span aria-hidden="true" className="absolute left-0.5 top-0.5 rounded bg-white px-0.5 text-sm leading-none font-bold text-zinc-900 shadow">
                                  ★
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                        <p className="text-lg font-semibold text-zinc-900">{photos.length} รูป</p>
                      </div>
                      <p className="mt-1 text-base text-zinc-700">{SHOP_PHOTO_TH.reviewWillSend}</p>
                    </>
                  ) : (
                    <>
                      <p className="text-lg font-semibold text-zinc-900">{SHOP_PHOTO_TH.reviewNone}</p>
                      {unbound && <p className="mt-1 inline-block rounded-md bg-[#FFF1C2] px-2 py-0.5 text-base font-semibold text-[#5A3D00]">{SHOP_PHOTO_TH.reviewNoSkuNone}</p>}
                    </>
                  )}
                </div>
                <button type="button" onClick={onEditPhotos} aria-label={photos.length > 0 ? "แก้รูป" : "เพิ่มรูป"} className="min-h-11 shrink-0 rounded-lg px-3 text-lg font-semibold text-primary-800 underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-300 disabled:opacity-40">
                  {photos.length > 0 ? "แก้" : "เพิ่ม"}
                </button>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="shop-note" className="block text-lg font-bold text-zinc-900">
              หมายเหตุ <span className="font-normal text-zinc-600">· ไม่บังคับ</span>
            </label>
            <input
              id="shop-note"
              type="text"
              autoComplete="off"
              enterKeyHint="done"
              value={form.note}
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              onKeyDown={(e) => {
                // Enter = "เสร็จช่องนี้" (ปิดแป้นพิมพ์) ไม่ใช่เปิดงาน
                if (e.key === "Enter") {
                  e.preventDefault();
                  (e.currentTarget as HTMLInputElement).blur();
                }
              }}
              aria-invalid={nErr ? true : undefined}
              aria-describedby={nErr ? "shop-note-err" : undefined}
              className={`min-h-14 w-full rounded-xl border-2 border-zinc-400 bg-white px-4 text-xl text-zinc-900 focus:border-primary-600 focus:outline-none focus:ring-4 focus:ring-primary-200 ${nErr ? "ring-2 ring-red-500" : ""}`}
            />
            {nErr && <ShopFieldError id="shop-note-err">{nErr}</ShopFieldError>}
          </div>
        </fieldset>

        <p className="text-base text-zinc-700">เปิดแล้วช่างเริ่มได้ทันที · ออฟฟิศจะ &ldquo;รับทราบ&rdquo; และพิมพ์ใบ A5 ให้</p>
        {photos && photos.length > 0 && <p className="text-base font-semibold text-zinc-900">{SHOP_PHOTO_TH.reviewFooter(photos.length)}</p>}
        {error && <ShopErrorBanner view={error} waitLeft={waitLeft} busy={busy} onRetry={onSubmit} onBack={onBack} />}
        <p role="status" className="sr-only">
          {readyNote ?? ""}
        </p>
      </form>

      <StickyAction>
        <BigButton type="button" loading={busy} aria-disabled={blocked ? true : undefined} onClick={() => { if (!busy && !blocked) onSubmit(); }}>
          {label}
        </BigButton>
      </StickyAction>
    </>
  );
}
