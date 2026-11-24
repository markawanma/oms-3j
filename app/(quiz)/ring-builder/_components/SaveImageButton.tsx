"use client";

// SaveImageButton — ปุ่มรอง "บันทึกรูป" ในกล่องสรุป (เจ้าของสั่ง 25 พ.ย.: "เผื่อยังไม่อยากส่งแต่อยาก save ไว้เลือกดูก่อน") — ux-ring-save-image.md
// ทำงานทั้งหมดในเครื่อง: จับภาพ 3D มุมหน้า (captureFront) → compose ภาพพร้อมรายละเอียด → Web Share ถ้าได้ ไม่ได้ = sheet ให้กดค้างบันทึก
// 🔴 ไม่มี fetch/sendBeacon/storage/cookie/trackCta ในไฟล์นี้และ lib/ring-builder/save-image/* (S2/S3/S4 · เทสต์ spy) · ไม่มีรูปถ่ายจริงแทน 3D (S5)
// 🔴 ไม่ขึ้น "บันทึกแล้ว ✓": share() resolve = ผู้ใช้ปิดเมนูแชร์ ไม่ได้แปลว่ารูปลงอัลบั้ม (S7) · ผู้ใช้ยกเลิก = ไม่ใช่ error (S8)
// คืน fragment เพื่อวางเป็น grid item ในแถวปุ่มรองของ OrderSummary — ข้อความสถานะใต้แถวใช้ col-span-full
//
// 🔴 iOS user gesture (review 25 พ.ย.): navigator.share() ต้องถูกเรียกใน gesture ที่ยังสด — await ฟอนต์/compose/toBlob ก่อนแล้วค่อย share = NotAllowedError เกือบทุกครั้ง
//   → "สร้างรูปล่วงหน้า" (pre-compose): เมื่อเวที ready + ค่าที่เลือกนิ่ง 750ms → สร้าง File เก็บไว้ใน ref พร้อม key ของค่านั้น (JSON ของ input) + capture ที่ใช้
//   → ตอนกด: key+capture ตรง = เรียก deliverImage(file) ทันที (ส่วน sync ของมันเรียก share() ก่อน await แรก — ไม่มี await คั่นใน handler นี้)
//     ไม่พร้อม/ไม่ตรง = สร้างแล้ว "เปิด sheet" เสมอ (ไม่พยายาม share หลัง await) · ปุ่มใน sheet = gesture ใหม่ + ไฟล์พร้อม จึง share ได้
//   เลือก "รอค่านิ่ง + idle" แทน "เฉพาะเมื่อปุ่มอยู่ในจอ": ผู้ใช้แตะปุ่มทันทีที่เลื่อนมาถึง (มือถือ) IntersectionObserver จะยังไม่ทันสร้าง = ล้มที่จุดเดียวกับที่กำลังแก้
//     ราคาที่จ่ายคือสร้าง 1 รูปต่อการเลือกที่นิ่ง — ทำใน requestIdleCallback + ข้ามขณะลากแหวน (ไม่ให้เวทีกระตุก) + ไม่ทำเลยถ้าเครื่องไม่มี share/canShare (ไม่ได้ประโยชน์)
//   ไม่ซ้อนงาน: มี job เดียวต่อครั้ง · กดระหว่าง job วิ่ง = รอ job นั้น (ไม่เริ่มใหม่) · เกินเวลา 8 วิ = busy ค้างจน compose จบจริง (onTimeout)
//   ของเก่าไม่ leak: เก็บแค่ File เดียว (ไม่มี objectURL ค้าง — URL สร้างตอนเปิด sheet และ revoke ตอนปิด) · key/capture เปลี่ยน = ทิ้งทันที
import { useEffect, useId, useRef, useState } from "react";
import { SHOWCASE_COPY } from "@/lib/ring-builder/showcase/config";
import type { ShowcaseLineInput } from "@/lib/ring-builder/showcase/line-message";
import { canShareFile, deliverImage } from "@/lib/ring-builder/save-image/deliver";
import { makeSaveImage, type MakeImageResult } from "@/lib/ring-builder/save-image/make-image";
import type { CaptureFrontFn } from "@/lib/ring-builder/viewer/gl-renderer";
import { DownTrayIcon, SavePreviewSheet } from "./SavePreviewSheet";

/** ค่าต้องนิ่งเท่านี้ก่อนสร้างรูปล่วงหน้า (เปลี่ยนแบบ/พลอย/ไซซ์ถี่ๆ ไม่สร้างทุกครั้ง) */
export const PRECOMPOSE_DELAY_MS = 750;

type Phase = "idle" | "busy" | "failed";
interface SheetState {
  url: string;
  file: File;
  alt: string;
  canShare: boolean;
}
/** รูปที่สร้างไว้แล้ว — ใช้ได้เมื่อ key และ capture ตรงกับตอนกดเท่านั้น */
interface Prepared {
  key: string;
  capture: CaptureFrontFn;
  file: File;
  alt: string;
}
interface Job {
  key: string;
  capture: CaptureFrontFn;
  promise: Promise<MakeImageResult>;
}

/** มี Web Share API ที่แชร์ไฟล์ได้ในเครื่องนี้ไหม (ถ้าไม่มี สร้างล่วงหน้าไม่ได้ประโยชน์) */
function shareApiPresent(): boolean {
  if (typeof navigator === "undefined") return false;
  const n = navigator as unknown as { share?: unknown; canShare?: unknown };
  return typeof n.share === "function" && typeof n.canShare === "function";
}

function whenIdle(fn: () => void) {
  if (typeof requestIdleCallback === "function") requestIdleCallback(fn, { timeout: 1500 });
  else fn();
}

export function SaveImageButton({ input, ready, capture, designFailed = false }: { input: ShowcaseLineInput; ready: boolean; capture: CaptureFrontFn | null; designFailed?: boolean }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const busyRef = useRef(false);
  const aliveRef = useRef(true);
  const waitId = useId();

  const key = JSON.stringify(input); // ShowcaseLineInput เป็นข้อมูลล้วน — key เปลี่ยนเมื่อแบบ/พลอย/ไซซ์เปลี่ยน
  const canClick = ready && capture !== null;
  const latestRef = useRef({ key, input, capture });
  const preparedRef = useRef<Prepared | null>(null);
  const jobRef = useRef<Job | null>(null);
  const draggingRef = useRef(false);
  const resumeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    latestRef.current = { key, input, capture };
  });

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      preparedRef.current = null;
    };
  }, []);

  // objectURL ถูกคืนเมื่อ sheet ปิด/เปลี่ยน/unmount (S13)
  const sheetUrl = sheet?.url ?? null;
  useEffect(() => {
    if (!sheetUrl) return;
    return () => URL.revokeObjectURL(sheetUrl);
  }, [sheetUrl]);

  // กำลังลากแหวนอยู่ไหม (pointer เริ่มที่ <canvas>) — pre-compose ต้องไม่จับภาพ/resize canvas ระหว่างผู้ใช้ลาก
  useEffect(() => {
    const down = (e: Event) => {
      if (e.target instanceof HTMLCanvasElement) draggingRef.current = true;
    };
    const up = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      resumeRef.current?.();
    };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("pointerup", up, true);
    document.addEventListener("pointercancel", up, true);
    window.addEventListener("blur", up);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("pointerup", up, true);
      document.removeEventListener("pointercancel", up, true);
      window.removeEventListener("blur", up);
    };
  }, []);

  /** เริ่มสร้างรูป (ส่วน sync ของ makeSaveImage จับภาพทันที) · เกินเวลา = รอ compose จบจริงก่อนคืนผล · ผลสำเร็จ + ค่ายังตรงล่าสุด = เก็บเป็น prepared */
  function startMake(cap: CaptureFrontFn, inp: ShowcaseLineInput, k: string): Job {
    let still: Promise<void> | null = null;
    const promise = makeSaveImage({
      capture: cap,
      input: inp,
      themeEl: btnRef.current?.parentElement ?? btnRef.current ?? document.body,
      onTimeout: (done) => {
        still = done;
      },
    }).then(async (r) => {
      if (!r.ok && still) await still;
      return r;
    });
    const job: Job = { key: k, capture: cap, promise };
    jobRef.current = job;
    void promise.then((r) => {
      if (jobRef.current === job) jobRef.current = null;
      const L = latestRef.current;
      if (r.ok && aliveRef.current && L.key === k && L.capture === cap) preparedRef.current = { key: k, capture: cap, file: r.file, alt: r.alt };
    });
    return job;
  }

  // pre-compose: key/capture เปลี่ยน = ทิ้งของเก่า · ค่านิ่ง 750ms + idle + ไม่ได้ลาก = สร้างใหม่
  useEffect(() => {
    const p = preparedRef.current;
    if (p && (p.key !== key || p.capture !== capture)) preparedRef.current = null;
    if (!ready || !capture || !shareApiPresent() || preparedRef.current) return;
    const cap = capture;
    const inp = input;
    const k = key;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = () => {
      timer = undefined;
      if (cancelled || !aliveRef.current) return;
      const L = latestRef.current;
      if (L.key !== k || L.capture !== cap) return; // effect รอบใหม่จัดการเอง
      if (preparedRef.current?.key === k && preparedRef.current.capture === cap) return;
      if (draggingRef.current) return; // resumeRef จะเรียก schedule ใหม่ตอนปล่อย
      const running = jobRef.current;
      if (running) {
        // ไม่ซ้อนงาน: รอ job เดิมจบแล้วค่อยตัดสินใหม่
        void running.promise.then(() => {
          if (!cancelled) schedule();
        });
        return;
      }
      startMake(cap, inp, k);
    };
    const schedule = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => whenIdle(attempt), PRECOMPOSE_DELAY_MS);
    };
    resumeRef.current = schedule;
    schedule();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
      if (resumeRef.current === schedule) resumeRef.current = null;
    };
    // startMake อ่านค่าล่าสุดผ่าน ref/พารามิเตอร์ — ไม่ต้องอยู่ใน deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, capture, ready]);

  const busy = phase === "busy";

  function openSheet(file: File, alt: string) {
    setSheet({ url: URL.createObjectURL(file), file, alt, canShare: canShareFile(file) });
  }

  function onClick() {
    if (busyRef.current || !canClick || !capture) return;
    const pre = preparedRef.current;
    if (pre && pre.key === key && pre.capture === capture) {
      // 🔴 เส้นทางเร็ว: ไม่มี await ก่อนบรรทัดนี้ — deliverImage เรียก canShare + share() แบบ sync ใน gesture ของการกดนี้
      busyRef.current = true;
      const delivering = deliverImage(pre.file);
      void delivering.then((result) => {
        busyRef.current = false;
        if (!aliveRef.current) return;
        if (result === "needSheet") openSheet(pre.file, pre.alt);
        // shared / aborted = จบเงียบ (ไม่ยืนยันว่าบันทึกแล้ว · ไม่ใช่ error)
      });
      return;
    }
    void slowPath(capture);
  }

  /** ยังไม่มีรูปที่พร้อม: สร้างแล้วเปิด sheet (gesture หมดอายุแล้ว — ไม่พยายาม share) */
  async function slowPath(cap: CaptureFrontFn) {
    busyRef.current = true;
    setPhase("busy");
    const running = jobRef.current;
    let made: MakeImageResult;
    if (running) {
      await running.promise; // ไม่ซ้อนงาน: รอ job ที่วิ่งอยู่ (ไม่ reject)
      if (!aliveRef.current) return;
      const L = latestRef.current;
      const pre = preparedRef.current;
      if (pre && pre.key === L.key && pre.capture === L.capture) made = { ok: true, file: pre.file, alt: pre.alt };
      else if (L.capture) made = await startMake(L.capture, L.input, L.key).promise;
      else made = { ok: false };
    } else {
      made = await startMake(cap, input, key).promise; // จับภาพใน task เดียวกับการกด
    }
    if (!aliveRef.current) return;
    busyRef.current = false;
    if (!made.ok) {
      setPhase("failed");
      return;
    }
    setPhase("idle");
    openSheet(made.file, made.alt);
  }

  function closeSheet() {
    setSheet(null);
    btnRef.current?.focus(); // คืนโฟกัสไปปุ่มที่เปิด
  }

  function shareFromSheet() {
    // gesture ใหม่ + ไฟล์พร้อมแล้ว — deliverImage เรียก share() แบบ sync ในรอบนี้ · ผลไม่เปลี่ยน UI (ไม่อ้างว่าบันทึกแล้ว)
    if (sheet) void deliverImage(sheet.file);
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={onClick}
        disabled={!canClick || busy}
        aria-busy={busy || undefined}
        aria-describedby={!ready ? waitId : undefined}
        className="inline-flex min-h-14 w-full items-center justify-center gap-2.5 rounded-full border border-[var(--gq-border)] bg-white px-4 text-base font-medium text-[var(--gq-text)] transition-colors hover:bg-[var(--gq-burgundy-soft)] disabled:cursor-not-allowed disabled:text-zinc-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gq-burgundy)]"
      >
        <DownTrayIcon />
        {busy ? SHOWCASE_COPY.saveBusy : SHOWCASE_COPY.saveButton}
      </button>
      <p role="status" className="sr-only">
        {busy ? SHOWCASE_COPY.saveBusy : ""}
      </p>
      {!ready && (
        <p id={waitId} className="col-span-full text-sm text-[var(--gq-text-muted)]">
          {designFailed ? SHOWCASE_COPY.saveDesignFailed : SHOWCASE_COPY.saveWaitStage}
        </p>
      )}
      {phase === "failed" && (
        <p role="alert" className="col-span-full flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-3 text-sm leading-[1.55] text-amber-900">
          <svg className="mt-0.5 flex-none" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3l10 18H2z" />
            <path d="M12 10v5M12 18.2v.1" />
          </svg>
          <span>{SHOWCASE_COPY.saveFailed}</span>
        </p>
      )}
      {sheet && <SavePreviewSheet url={sheet.url} alt={sheet.alt} canShare={sheet.canShare} onShare={shareFromSheet} onClose={closeSheet} />}
    </>
  );
}
