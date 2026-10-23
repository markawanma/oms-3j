"use client";

// ShopOpenFlow — วิซาร์ดเปิดใบ (W-2 → W-2b → W-3 → W-6/7 → W-8) · state ทั้งหมดอยู่ที่นี่ (local state — ไม่ใช้ global store)
// 🔴 หลักที่ต้องไม่พัง
//   • idem key สร้าง "ครั้งเดียวต่อฟอร์ม" (newForm) และคงไว้ข้ามการลองใหม่ทุกครั้ง (กดซ้ำ/เน็ตสะดุด = ใบเดียว) — เปลี่ยนเฉพาะเมื่อ DB บอกคีย์ชน/ผิดรูป หรือกด "เปิดอีกใบ"
//   • กันกดซ้ำด้วย inflight ref (ไม่พึ่ง state ที่ยังไม่ re-render)
//   • ทุก error: ฟอร์มและค่าที่กรอกไม่หาย · session หมดเวลา → ให้ผู้เรียกโหลด hub ใหม่ (แผ่น PIN) แล้วกลับมากด "เปิดงาน" ต่อ
//   • token ใบงานดิบ (QR) อยู่ใน state นี้เท่านั้น — ไม่เขียน storage/URL/log · ออกจากจอสำเร็จ = หาย
//   • ไม่มีตัวเลขเงิน/ราคา · ไม่มีลิงก์ออกนอกแอปช่าง

import { useCallback, useEffect, useRef, useState } from "react";
import { intakeOpen } from "@/lib/actions/job-worker";
import { bkkDateOf } from "@/lib/jobs/dates";
import {
  MSG_GEM_GENERIC, MSG_NETWORK, backToSearch, buildIntakeInput, isCleanMessage, newForm, newIdemKey, purityLabel, shopErrorView, shopOpenIssues, stepProgress, stepsFor,
} from "@/lib/jobs/shop-open";
import type { ShopErrorView, ShopFieldKey, ShopForm, ShopStep } from "@/lib/jobs/shop-open";
import type { GemDraftRow } from "@/lib/jobs/gem-draft";
import { addForce, gemStepIssue, interpretIntakeGemFail, pruneForce } from "@/lib/jobs/shop-gem-flow";
import type { GemRowErrors } from "@/lib/jobs/shop-gem-flow";
import type { GemForceItem } from "@/lib/jobs/gem-wire";
import type { GemSimilar, IntakeOpenResult } from "@/lib/jobs/worker-server";
import { focusField } from "@/components/domain/jobs/worker/WorkerPanels";
import { GemServerSimilar } from "@/components/domain/gems/useGemFail";
import { ShopGemStep } from "@/components/domain/jobs/worker/shop/ShopGemStep";
import type { ShopGemFocusRequest } from "@/components/domain/jobs/worker/shop/ShopGemEditor";
import { useShopGemCatalog } from "@/components/domain/jobs/worker/shop/useShopGemCatalog";
import { ShopMetalSheet } from "@/components/domain/jobs/worker/shop/ShopMetalSummary";
import type { ShopProfileReady } from "@/components/domain/jobs/worker/shop/ShopMetalSummary";
import { ShopMetalStep } from "@/components/domain/jobs/worker/shop/ShopMetalStep";
import { ShopOpenSuccess } from "@/components/domain/jobs/worker/shop/ShopOpenSuccess";
import { ShopPhotoStep } from "@/components/domain/jobs/worker/shop/ShopPhotoStep";
import { useIntakePhotoIo } from "@/components/domain/jobs/worker/shop/useIntakePhotoIo";
import { useShopPhotos } from "@/components/domain/jobs/worker/shop/useShopPhotos";
import { LABEL_FIELD_ID, ShopProductSearch } from "@/components/domain/jobs/worker/shop/ShopProductSearch";
import { ShopQtyStep } from "@/components/domain/jobs/worker/shop/ShopQtyStep";
import { ShopReview } from "@/components/domain/jobs/worker/shop/ShopReview";
import { ShopStepHeader } from "@/components/domain/jobs/worker/shop/ShopStepHeader";

export const todayBkk = (): string => bkkDateOf(new Date().toISOString()) ?? new Date().toISOString().slice(0, 10);

const TITLE: Record<ShopStep, string> = { search: "ผลิตอะไร?", metal: "ทำจากอะไร?", qty: "เท่าไร · เสร็จเมื่อไร", gems: "พลอย", photos: "ใส่รูปให้ช่างดู", review: "ทวนก่อนเปิดงาน" };
export const MSG_FORM_CLEARED = "เปลี่ยนคนแล้ว — ล้างฟอร์มเดิมเพื่อไม่ให้เปิดงานในชื่อคนใหม่โดยไม่ตั้งใจ เริ่มกรอกใหม่ได้เลย";
export const MSG_READY_AGAIN = "พร้อมแล้ว — กด \"เปิดงาน\" อีกครั้งได้";

export function ShopOpenFlow({
  token,
  ready,
  workerId,
  onExit,
  onSessionLost,
}: {
  token: string;
  ready: ShopProfileReady;
  /** ผู้จัดการที่ระบุตัวอยู่ตอนนี้ (null = hub กำลังให้ใส่ PIN) — ฟอร์มเป็นของคนที่เริ่มกรอก: คนอื่น login แทน = ล้างฟอร์ม */
  workerId: string | null;
  onExit: () => void;
  onSessionLost: () => void;
}) {
  const [form, setForm] = useState<ShopForm>(() => newForm());
  const [step, setStep] = useState<ShopStep>("search");
  const [query, setQuery] = useState("");
  const [showLabelError, setShowLabelError] = useState(false);
  const [sheet, setSheet] = useState<null | { focusPurity: boolean }>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ShopErrorView | null>(null);
  const [waitLeft, setWaitLeft] = useState(0);
  const [readyNote, setReadyNote] = useState<string | null>(null);
  const [done, setDone] = useState<{ result: IntakeOpenResult; purity: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // 0191 W3 (W-4): error ของพลอยจาก server (ต่อแถว/ทั้งขั้น) · พาไปแถว/ช่องที่ผิด · ชื่อที่ DB ถามว่าคล้ายของเดิม
  const [gemErrors, setGemErrors] = useState<GemRowErrors>({});
  const [gemGeneral, setGemGeneral] = useState<string | null>(null);
  const [gemFocus, setGemFocus] = useState<ShopGemFocusRequest | null>(null);
  const [gemSimilar, setGemSimilar] = useState<GemSimilar | null>(null);
  const gemNonce = useRef(0);
  const ownerRef = useRef<string | null>(workerId);
  const inflight = useRef(false);
  const headRef = useRef<HTMLHeadingElement>(null);
  const [today] = useState(todayBkk);
  // 0189 W2: รูปจากหน้างาน — state เดียวกับฟอร์ม (ล้างพร้อมฟอร์ม · ไม่ unmount ตอนแผ่น PIN ซ้อน) · action ฉีดเข้า hook (hook ไม่ import server action เอง)
  const photos = useShopPhotos({ io: useIntakePhotoIo(token) });
  const resetPhotos = photos.reset;
  // รายการชนิด/รูปทรง/แม่แบบ SKU: โหลดครั้งแรกที่เข้า W-4 (ต่อ SKU) · ถือไว้ที่นี่เพื่อไม่โหลดซ้ำทุกครั้งที่กลับมาขั้นนี้
  const catalogProductId = form.mode === "sku" ? (form.product?.id ?? null) : null;
  const gemCatalog = useShopGemCatalog({ token, productId: catalogProductId, enabled: step === "gems", onSessionLost });
  const clearGemErrors = useCallback(() => {
    setGemErrors({});
    setGemGeneral(null);
  }, []);

  // เปลี่ยนขั้น → โฟกัสหัวขั้น (screen reader อ่านหัวใหม่) + เลื่อนขึ้นบน
  useEffect(() => {
    if (sheet !== null) return; // แผ่นแก้เปิดอยู่ — แผ่นจัดการโฟกัสของมันเอง
    headRef.current?.focus();
    window.scrollTo?.(0, 0);
  }, [step, done, sheet]);

  // นับถอยหลัง (rate limit): ประกาศครั้งเดียวตอนเริ่ม (ข้อความใน banner) และตอนพร้อม (readyNote) — ตัวเลขรายวินาทีเป็น aria-hidden
  const waiting = error?.action === "wait" && waitLeft > 0;
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => {
      setWaitLeft((n) => {
        if (n <= 1) {
          clearInterval(t);
          return 0;
        }
        return n - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [waiting]);
  useEffect(() => {
    if (error?.action === "wait" && waitLeft === 0) {
      setError(null);
      setReadyNote(MSG_READY_AGAIN);
    }
  }, [error, waitLeft]);

  // session หมดเวลา → PIN ผ่านแล้วกลับมา: คนเดิม = ฟอร์มต่อ + banner "หมดเวลาแล้ว" หายไป · คนอื่นกด "ไม่ใช่ฉัน" แล้ว login แทน = ล้างฟอร์มทั้งก้อน (ไม่ให้ฟอร์มของคนเดิมเดินต่อในชื่อคนใหม่เงียบๆ)
  useEffect(() => {
    if (workerId === null) return; // hub กำลังให้ใส่ PIN (ฟอร์มซ่อนอยู่)
    if (ownerRef.current !== null && ownerRef.current !== workerId) {
      setForm(newForm());
      setStep("search");
      setQuery("");
      setShowLabelError(false);
      setSheet(null);
      setDone(null);
      setError(null);
      setWaitLeft(0);
      setReadyNote(null);
      setGemErrors({});
      setGemGeneral(null);
      setGemFocus(null);
      setGemSimilar(null);
      resetPhotos(); // รูปเป็นของคนที่เริ่มกรอก — หายพร้อมฟอร์ม (revoke blob ทุกอัน)
      setNotice(MSG_FORM_CLEARED);
    } else {
      setError((prev) => (prev?.action === "pin" ? null : prev));
    }
    ownerRef.current = workerId;
  }, [workerId, resetPhotos]);

  const go = useCallback((s: ShopStep) => {
    setNotice(null);
    setError(null);
    setReadyNote(null);
    setStep(s);
  }, []);

  const steps = stepsFor(form);
  const idx = steps.indexOf(step);
  const nextStep = () => go(steps[Math.min(idx + 1, steps.length - 1)]);
  const back = () => {
    if (step === "search") {
      if (form.mode === "new") {
        setShowLabelError(false);
        setForm(backToSearch(form));
        return;
      }
      onExit();
      return;
    }
    go(steps[Math.max(idx - 1, 0)]);
  };

  /** แก้วัสดุ: สินค้าใหม่ = กลับ W-2b · มี SKU = แผ่นแก้ */
  const editMetal = (focusPurity = false) => {
    if (form.mode === "new") {
      go("metal");
      if (focusPurity) setTimeout(() => focusField("shop-metal-purity"), 0);
    } else setSheet({ focusPurity });
  };

  /** กลับไปช่อง/ขั้นที่ผิด (จาก error หรือจากผลตรวจฟอร์ม) */
  function goToField(field: ShopFieldKey | undefined) {
    setError(null);
    setReadyNote(null);
    switch (field) {
      case "label":
      case "product":
        setShowLabelError(true);
        setStep("search");
        if (field === "label") setTimeout(() => focusField(LABEL_FIELD_ID), 0);
        return;
      case "metal":
      case "purity":
      case "weight":
        editMetal(field === "purity");
        return;
      case "qty":
      case "buffer":
      case "due":
        setStep("qty");
        setTimeout(() => focusField(field === "qty" ? "shop-qty" : field === "buffer" ? "shop-buffer" : "shop-due-date"), 0);
        return;
      case "note":
        setTimeout(() => focusField("shop-note"), 0);
        return;
      case "gems": {
        // พลอยผิด → กลับ W-4 แถว/ช่องที่ผิด (ฟอร์ม/รูป/แถวอื่นคงอยู่) · แถวมาจาก gem.row ของ DB ไม่งั้นแถวแรกที่ยังไม่ครบ
        setStep("gems");
        const n = error?.gem?.row;
        const fromServer = typeof n === "number" && n >= 1 && n <= form.gems.rows.length ? form.gems.rows[n - 1].key : null;
        const key = fromServer ?? gemStepIssue(form.gems, gemCatalog.options)?.rowKey ?? null;
        if (key) setGemFocus({ rowKey: key, field: fromServer ? (error?.gem?.field ?? null) : null, nonce: ++gemNonce.current });
        return;
      }
      default:
        return;
    }
  }

  /** override: ส่งซ้ำหลังผู้ใช้ตอบ "ชื่อคล้าย" (ใช้ตัวที่มี = แถวใหม่ · เพิ่มใหม่จริงๆ = force เฉพาะชื่อที่ DB ถาม) — state ยังไม่ทัน re-render จึงส่งค่าเข้าตรงๆ */
  async function submit(override?: { rows?: GemDraftRow[]; addForce?: GemForceItem }) {
    if (inflight.current) return;
    let f = form;
    if (override) {
      const rows = override.rows ?? form.gems.rows;
      const force = pruneForce(override.addForce ? addForce(form.gems.force, override.addForce) : form.gems.force, rows);
      f = { ...form, gems: { ...form.gems, rows, force } };
      setForm(f);
    }
    const issues = shopOpenIssues(f, today);
    if (issues.length > 0) {
      setError({ message: issues[0].message, action: "back", field: issues[0].field });
      return;
    }
    inflight.current = true;
    setBusy(true);
    setNotice(null);
    setError(null);
    setReadyNote(null);
    const usedKey = f.idemKey; // รูปอ้างใบด้วย idem key เดียวกับที่เปิดใบ
    let r: Awaited<ReturnType<typeof intakeOpen>> | null = null;
    try {
      r = await intakeOpen(token, buildIntakeInput(f, today));
    } catch {
      r = null; // เน็ตหลุด/ไม่ทราบผล — คีย์เดิมกดซ้ำได้ (DB ไม่เปิดซ้ำ)
    } finally {
      inflight.current = false;
      setBusy(false);
    }
    if (r === null) {
      setError({ message: MSG_NETWORK, action: "retry" });
      return;
    }
    if (r.ok) {
      setGemErrors({});
      setGemGeneral(null);
      setDone({ result: r.result, purity: purityLabel(f.metal, f.purityText) });
      // ใบเปิดสำเร็จ → ส่งรูปที่เก็บไว้ทีละรูป (หลักก่อน) · ใบที่ถูกยกเลิกไปแล้ว = ไม่ส่ง รูปหายพร้อมหน้า
      if (r.result.status === "cancelled") photos.reset();
      else photos.start({ idemKey: usedKey });
      return;
    }
    const view = shopErrorView(r);
    if (view.field === "gems") {
      // พลอยผิด = ใบไม่เปิดทั้งก้อน: ชื่อคล้าย → ถามบนหน้านี้ (ไม่ใช่ error) · แถวผิด → ผูกกับแถวนั้น (กลับไปแก้ที่ W-4)
      // ข้อความที่แสดงผ่านด่านเดียวกับแบนเนอร์ (isCleanMessage) — ไม่แสดงข้อความดิบที่มีรหัส/คำเกี่ยวกับเงิน
      const fv = interpretIntakeGemFail(r, f.gems.rows, (m) => (isCleanMessage(m) ? m : MSG_GEM_GENERIC));
      if (fv.similar) {
        setGemSimilar(fv.similar);
        return;
      }
      setGemErrors(fv.rowErrors);
      setGemGeneral(fv.generalError);
    }
    if (view.newKey) setForm((f) => ({ ...f, idemKey: newIdemKey() }));
    if (view.action === "wait") setWaitLeft(view.waitSeconds ?? 0);
    if (view.action === "pin") onSessionLost();
    setError(view);
  }

  if (done) {
    return (
      <ShopOpenSuccess
        result={done.result}
        purityLabel={done.purity}
        photos={photos}
        onSessionLost={onSessionLost}
        onAnother={() => {
          photos.reset();
          setDone(null);
          setGemErrors({});
          setGemGeneral(null);
          setGemFocus(null);
          setForm(newForm());
          setQuery("");
          setShowLabelError(false);
          setError(null);
          setStep("search");
        }}
        onFinish={() => {
          photos.reset();
          setDone(null);
          onExit();
        }}
      />
    );
  }

  const prog = stepProgress(form, step);
  const context = form.mode === "new" ? (form.label.trim() !== "" ? form.label.trim() : "สินค้าใหม่") : form.product && step !== "search" ? form.product.name : "เปิดงานใหม่";

  return (
    <div className="space-y-2">
      <div hidden={sheet !== null}>
        {notice && (
          <p role="status" className="mb-2 rounded-xl border-2 border-amber-300 bg-amber-50 p-3 text-lg font-semibold text-amber-950">
            {notice}
          </p>
        )}
        <ShopStepHeader ref={headRef} title={step === "search" && form.mode === "new" ? "สินค้าใหม่" : TITLE[step]} context={context} n={prog.n} total={prog.total} onBack={back} disabled={busy} />
        {step === "search" && (
          <ShopProductSearch
            token={token}
            form={form}
            setForm={setForm}
            onNext={nextStep}
            onSessionLost={onSessionLost}
            showLabelError={showLabelError}
            setShowLabelError={setShowLabelError}
            query={query}
            setQuery={setQuery}
          />
        )}
        {step === "metal" && <ShopMetalStep form={form} setForm={setForm} ready={ready} onNext={nextStep} />}
        {step === "qty" && <ShopQtyStep form={form} setForm={setForm} ready={ready} today={today} onNext={nextStep} onEditMetal={() => editMetal(false)} onNeedPurity={() => editMetal(true)} />}
        {step === "gems" && (
          <ShopGemStep
            form={form}
            setForm={setForm}
            catalog={gemCatalog}
            onNext={nextStep}
            serverErrors={gemErrors}
            generalError={gemGeneral}
            focusRequest={gemFocus}
            onEdited={clearGemErrors}
          />
        )}
        {step === "photos" && <ShopPhotoStep photos={photos} unbound={form.mode === "new"} onNext={nextStep} />}
        {step === "review" && (
          <ShopReview
            form={form}
            setForm={setForm}
            today={today}
            busy={busy}
            error={error}
            waitLeft={waitLeft}
            readyNote={readyNote}
            onSubmit={() => void submit()}
            onEditProduct={() => go("search")}
            onEditMetal={() => editMetal(false)}
            onEditGems={() => goToField("gems")}
            onBack={() => goToField(error?.field)}
            photos={photos.items}
            onEditPhotos={() => go("photos")}
          />
        )}
      </div>
      {gemSimilar && (
        <GemServerSimilar
          hit={gemSimilar}
          rows={form.gems.rows}
          options={gemCatalog.options}
          onRows={(rows) => setForm((cur) => ({ ...cur, gems: { ...cur.gems, rows, force: pruneForce(cur.gems.force, rows) } }))}
          onClose={() => setGemSimilar(null)}
          onResubmit={({ force, rows }) => void submit({ rows, addForce: force ? { kind: gemSimilar.kind, name: gemSimilar.name } : undefined })}
        />
      )}
      {sheet && (
        <ShopMetalSheet
          form={form}
          ready={ready}
          initialFocusPurity={sheet.focusPurity}
          onCancel={() => setSheet(null)}
          onApply={(next) => {
            setForm((f) => ({ ...f, ...next }));
            setSheet(null);
          }}
        />
      )}
    </div>
  );
}
