"use client";

// JobPrintClient — ใบงาน (traveler) A5 แนวตั้ง · พิมพ์ติดถุงงาน
// 🔴 รับเฉพาะ PrintableJob (lib/jobs/print.ts — ประกอบทีละ field) — ห้ามราคา/ต้นทุน/ชื่อลูกค้า/เลขอ้างอิง · props ถึงเบราว์เซอร์ทั้งก้อน
// QR: ออกตอนกดปุ่ม (job_token_issue → ได้ token ครั้งเดียว → SVG จาก server) · ใบเก่าถูกเพิกถอนเป็นค่าเริ่ม (ติ๊ก "พิมพ์สำเนาเพิ่ม" = ไม่เพิกถอน)
// ปิดหน้าก่อนพิมพ์ = QR นั้นหายไปจากหน้าจอ (ไม่เก็บ token) → ต้องออกใหม่ · ปุ่ม/คำเตือนทั้งหมด print:hidden

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { JobGemsSecondSheet, JobSheetGems } from "@/components/domain/jobs/JobSheetGems";
import { PrintPhoto } from "@/components/domain/jobs/photos/PrintPhoto";
import { PrintPhotoStatus } from "@/components/domain/jobs/photos/PrintPhotoStatus";
import { usePrintPhoto } from "@/components/domain/jobs/photos/usePrintPhoto";
import { issueJobQr } from "@/lib/actions/job-office-write";
import type { IssuedQr } from "@/lib/actions/job-office-write";
import { qtyOrderPlannedText } from "@/lib/jobs/board";
import { thaiDate } from "@/lib/jobs/dates";
import { GENERIC_JOB_ERROR } from "@/lib/jobs/messages";
import { METAL_LABEL } from "@/lib/jobs/types";
import type { PrintableJob } from "@/lib/jobs/print";
import { GEM_PRINT_NOTICE, PRINT_CONTENT_HEIGHT_MM, needsGemFit, nextGemPrintStep } from "@/lib/jobs/print-gems";
import type { GemPrintStep } from "@/lib/jobs/print-gems";

const CELL = "border border-zinc-700 px-1 align-top";

/**
 * คำหน้าช่อง % เขียนมือบนใบ (มติเจ้าของ 18 ต.ค. 69): งานเงิน = "เนื้อเงิน" · ทอง = "เนื้อทอง" · โลหะอื่น/ไม่รู้ = "เนื้อโลหะ"
 * PrintableJob ไม่มีรหัส metal (ด่าน type boundary ใน lib/jobs/print.ts — ไม่เพิ่ม field) จึงเทียบกับ METAL_LABEL ที่ toPrintableJob ใช้ทำ metalLabel
 * ("ทองเหลือง" ≠ "ทอง" เทียบเท่ากันทั้งสตริง จึงตกเป็น "เนื้อโลหะ")
 */
export function purityWord(metalLabel: string): string {
  if (metalLabel === METAL_LABEL.silver) return "เนื้อเงิน";
  if (metalLabel === METAL_LABEL.gold) return "เนื้อทอง";
  return "เนื้อโลหะ";
}

/**
 * คอลัมน์ของตารางขั้น (0176): ใบเดิม (ไม่มีแบบ) = ครบทุกคอลัมน์เหมือนเดิมทุกประการ
 * ใบที่มีแบบ = ตัดคอลัมน์ที่ทั้งใบไม่มีขั้นไหนกรอก (นน.เข้า/ออก · เสีย) และเพิ่ม "เศษ (g)" เฉพาะเมื่อมีขั้นที่ถามเศษ — เซลล์ของขั้นที่ไม่ต้องกรอก = "—"
 */
export function sheetColumns(job: Pick<PrintableJob, "profileName" | "stages">): { weigh: boolean; scrapQty: boolean; scrapWeight: boolean; legacy: boolean } {
  if (job.profileName === null) return { weigh: true, scrapQty: true, scrapWeight: false, legacy: true };
  return {
    weigh: job.stages.some((s) => s.weighRequired),
    scrapQty: job.stages.some((s) => s.scrapQtyAsk),
    scrapWeight: job.stages.some((s) => s.scrapWeightAsk),
    legacy: false,
  };
}

export function JobSheet({
  job,
  qrSvg,
  showPhoto = true,
  onPhotoLoad,
  onPhotoError,
  photoRef,
  gemMode = "normal",
  sheetRef,
}: {
  job: PrintableJob;
  qrSvg: string | null;
  /** 0182: false = ตัดรูปหลักออกจากใบ (รูปโหลดไม่ได้ → พิมพ์เป็น layout ไม่มีรูป ไม่พิมพ์กรอบว่าง/ไอคอนรูปแตก) */
  showPhoto?: boolean;
  onPhotoLoad?: () => void;
  onPhotoError?: () => void;
  photoRef?: React.Ref<HTMLImageElement>;
  /** 0190: ขั้นของบันไดล้นหน้า (ตัดรูป → บีบ → แผ่น 2) — ค่าเริ่ม normal · ใบไม่มีพลอยไม่ได้รับผลใดๆ */
  gemMode?: GemPrintStep;
  /** ให้ผู้เรียกวัดความสูงของแผ่น */
  sheetRef?: React.Ref<HTMLElement>;
}) {
  const cols = sheetColumns(job);
  return (
    <article ref={sheetRef} aria-label={`ใบงาน ${job.jobNo}`} className="job-sheet mx-auto w-[148mm] bg-white p-[7mm] text-[10pt] leading-snug text-black print:p-0">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {/* 0182: รูปหลัก 30×30 มม. ลอยขวาเป็นลูกแรกของคอลัมน์ข้อความ (ข้อความไหลอ้อม · ติด QR) — ไม่มีรูป = ไม่มีองค์ประกอบใหม่เลย (layout เดิมเป๊ะ) */}
          {job.primaryPhotoUrl && showPhoto && <PrintPhoto url={job.primaryPhotoUrl} alt={`รูปงาน ${job.jobNo}`} onLoad={onPhotoLoad} onError={onPhotoError} imgRef={photoRef} />}
          <p className="text-[9pt] font-semibold">ใบงานผลิต · {job.sourceLabel}</p>
          {job.profileName !== null && <p className="text-[9pt]">แบบ: {job.profileName}</p>}
          <p className="text-[30pt] leading-none font-extrabold tracking-tight tabular-nums">{job.jobNo}</p>
          <p className="mt-2 text-[14pt] font-bold break-words">{job.designLabel}</p>
          <p className="text-[11pt]">
            {qtyOrderPlannedText(job)} · {job.metalLabel}
            {job.sku ? ` · ${job.sku}` : ""}
          </p>
          <p className="mt-1 text-[11pt] font-semibold">กำหนดส่ง {thaiDate(job.dueDate)}</p>
          {/* 0175: แผนโลหะ (เฉพาะใบที่ toPrintableJob ปล่อยมา — ใบทองเป็น null ทั้งคู่ จึงไม่มีบรรทัดนี้) · ไม่มีเลขที่เบิกจริง/ledger/ดุล/ราคา */}
          {(job.targetPieceG !== null || job.metalPlanG !== null) && (
            <>
              <p className="mt-1 text-[10pt]">น้ำหนักเป้าหมาย/ชิ้น {job.targetPieceG !== null ? `${job.targetPieceG.toFixed(3)} g` : "—"}</p>
              <p className="text-[10pt] font-semibold">โลหะที่ต้องเตรียม {job.metalPlanG !== null ? `${Number(job.metalPlanG.toFixed(3))} g` : "—"}</p>
            </>
          )}
          <p className="mt-1 text-[10pt]">น้ำหนักตั้งต้น {job.weightStartG !== null ? `${job.weightStartG} g` : "............ g"}</p>
          <p className="mt-1 text-[10pt]">เบิกจริง ............ g &nbsp; {purityWord(job.metalLabel)} ............ %</p>
        </div>
        <div className="flex w-[42mm] shrink-0 flex-col items-center">
          {qrSvg ? (
            // SVG สร้างฝั่ง server จากไลบรารี vendored (สีดำบนขาว ไม่มีสคริปต์) — ไม่ใช่ข้อมูลจากผู้ใช้
            <div className="h-[42mm] w-[42mm]" role="img" aria-label={`QR สแกนเพื่ออัปเดตงาน ${job.jobNo}`} dangerouslySetInnerHTML={{ __html: qrSvg }} />
          ) : (
            <div className="flex h-[42mm] w-[42mm] items-center justify-center border-2 border-dashed border-zinc-400 p-2 text-center text-[8pt] text-zinc-600">QR จะปรากฏหลังกด “ออก QR และพิมพ์”</div>
          )}
          <p className="mt-0.5 text-[8pt]">สแกนเพื่อรับ / ส่งต่อ</p>
        </div>
      </header>

      <table className="mt-3 w-full border-collapse text-[8.5pt]">
        <thead>
          <tr className="bg-zinc-100 text-left">
            <th className={`${CELL} w-[24%]`}>ขั้น</th>
            <th className={CELL}>วันรับ</th>
            <th className={CELL}>ผู้รับเซ็น</th>
            {cols.weigh && <th className={CELL}>นน.เข้า</th>}
            <th className={CELL}>วันส่ง</th>
            {cols.weigh && <th className={CELL}>นน.ออก</th>}
            {cols.scrapQty && <th className={`${CELL} w-[9%]`}>เสีย</th>}
            {cols.scrapWeight && <th className={`${CELL} w-[10%]`}>เศษ (g)</th>}
            <th className={CELL}>ผู้ส่งเซ็น</th>
          </tr>
        </thead>
        <tbody>
          {job.stages.map((s) => (
            <tr key={s.seq} className="h-[9mm]">
              <td className={`${CELL} font-semibold`}>
                {s.seq}. {s.name}
                {s.weighRequired ? " *" : ""}
              </td>
              {/* ลำดับคอลัมน์: วันรับ · ผู้รับเซ็น · [นน.เข้า] · วันส่ง · [นน.ออก] · [เสีย] · [เศษ] · ผู้ส่งเซ็น — ช่องที่ขั้นนี้ไม่ต้องกรอก = "—" (ใบเดิมว่างทุกช่อง) */}
              <td className={CELL} />
              <td className={CELL} />
              {cols.weigh && <td className={CELL}>{!cols.legacy && !s.weighRequired ? "—" : ""}</td>}
              <td className={CELL} />
              {cols.weigh && <td className={CELL}>{!cols.legacy && !s.weighRequired ? "—" : ""}</td>}
              {cols.scrapQty && <td className={CELL}>{!cols.legacy && !s.scrapQtyAsk ? "—" : ""}</td>}
              {cols.scrapWeight && <td className={CELL}>{!s.scrapWeightAsk ? "—" : ""}</td>}
              <td className={CELL} />
            </tr>
          ))}
        </tbody>
      </table>
      {(cols.legacy || cols.weigh) && <p className="mt-1 text-[8pt]">* ขั้นที่ต้องชั่งน้ำหนักทุกครั้ง</p>}
      {/* 0190: ตารางพลอย (หลังตารางขั้น ก่อนกล่องหมายเหตุ) — ใบที่ไม่มีขั้นฝังและไม่มีพลอย = ไม่มีองค์ประกอบใหม่เลย */}
      <JobSheetGems gems={job.gems} state={job.gemsState} mode={gemMode} />
      <div className="mt-2 h-[16mm] border border-zinc-700 p-1 text-[8pt]">หมายเหตุ</div>
    </article>
  );
}

/** ที่อยู่ที่ QR จะชี้ไป + คำเตือน (preview/dev/โดเมนไม่ตรง APP_ORIGIN) หรือ error (ตั้งค่า origin ไม่ได้ → ออก QR ไม่ได้) — แสดงเฉพาะบนจอ */
export interface QrTarget {
  host: string | null;
  warning: string | null;
  error: string | null;
}

/**
 * วัดความสูงเนื้อหาของแผ่น (มม.) — ไม่รวม padding บนจอ (print:p-0) · วัดไม่ได้ (jsdom/ไม่มี layout) = null (ไม่ขยับบันได)
 * ⚠️ ค่าบนจอ ≠ กระดาษจริงเสมอไป (Chrome อาจย่อใบเมื่อพิมพ์) — ต้องทดสอบพิมพ์ A5 จริง (UX §8.3)
 */
export function measureSheetContentMm(el: HTMLElement): number | null {
  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;visibility:hidden;left:-9999px;top:0;width:1px;height:100mm";
  document.body.appendChild(probe);
  const pxPerMm = probe.getBoundingClientRect().height / 100;
  document.body.removeChild(probe);
  if (!(pxPerMm > 0)) return null;
  const cs = getComputedStyle(el);
  const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
  return (el.scrollHeight - pad) / pxPerMm;
}

export function JobPrintClient({
  job,
  qr = { host: null, warning: null, error: null },
  defaultKeep = false,
  gemsReadFailed = false,
  measureMm = measureSheetContentMm,
}: {
  job: PrintableJob;
  qr?: QrTarget;
  /** 0181: ใบที่แยกส่วนแล้ว — ถุงหลายใบถือ QR พร้อมกัน ค่าเริ่ม = ไม่เพิกถอนใบเก่า */
  defaultKeep?: boolean;
  /** 0190: อ่านพลอยของใบไม่ได้ (getJobDetail.gems === null) — ใบที่พิมพ์จะไม่มีตารางพลอย → เตือนบนจอ (print:hidden) ไม่ใช่เงียบ */
  gemsReadFailed?: boolean;
  /** ทดสอบ: แทนตัววัดความสูง (jsdom วัด layout ไม่ได้) */
  measureMm?: (el: HTMLElement) => number | null;
}) {
  const [keep, setKeep] = useState(defaultKeep);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<IssuedQr | null>(null);
  // 0190: ตารางพลอยล้นหน้า A5 → บันได (UX §8.3): ตัดรูป → บีบเป็นโหมดกระชับ → ย้ายตารางทั้งก้อนไปแผ่นที่ 2 · ห้ามตัดแถวพลอย · ทุกขั้นมีแถบ print:hidden บอก
  // ใบที่ไม่มีพลอยและไม่ใช่ "ยังไม่ระบุ" ไม่ถูกวัดและไม่เปลี่ยนอะไรเลย
  const sheetRef = useRef<HTMLElement>(null);
  const [step, setStep] = useState<GemPrintStep>("normal");
  const [fontsTick, setFontsTick] = useState(0);
  const [overflow, setOverflow] = useState(false);
  const photoCut = step === "noPhoto" || step === "compact";
  // 0182: รอรูปหลักโหลดก่อนพิมพ์ (ไม่พิมพ์กรอบว่าง) · โหลดไม่ได้/หมดเวลา 8 วินาที = ตัดรูปออกแล้วพิมพ์ต่อ
  // รูปที่บันไดตัดออกจากแผ่นแล้ว (photoCut) ไม่ต้องรอโหลดและไม่ขึ้น "โหลดรูปหลักไม่ได้" — ส่ง url=null ให้ hook (ไม่มี <img> ให้รอ event · ไม่เดิน timeout)
  const photo = usePrintPhoto(photoCut ? null : job.primaryPhotoUrl);
  const photoLoading = photo.status === "loading";
  // รูปเคยโหลดไม่ได้ (จำไว้แม้ถูกตัดออก — hook ลืมเมื่อ url เป็น null) · ใช้ตัดสินว่ามีรูปบนแผ่นไหมตอนไล่บันได
  const [photoBroken, setPhotoBroken] = useState(false);
  useEffect(() => {
    if (photo.status === "failed") setPhotoBroken(true);
  }, [photo.status]);
  const hasPhoto = job.primaryPhotoUrl !== null && !photoBroken;
  const hasRows = job.gems.length > 0;
  useEffect(() => {
    // ฟอนต์โหลดเสร็จแล้วความสูงอาจเปลี่ยน → วัดซ้ำครั้งเดียว
    let live = true;
    const ready = typeof document !== "undefined" ? document.fonts?.ready : undefined;
    void ready?.then(() => {
      if (live) setFontsTick((n) => n + 1);
    });
    return () => {
      live = false;
    };
  }, []);
  // ฟอนต์โหลดเสร็จ/รูปพัง = ความสูงเปลี่ยนจากที่ตัดสินไว้ → ไล่ใหม่จากขั้นแรก (ไม่ค้างขั้นที่เคยล้นด้วยเหตุที่หายไปแล้ว)
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setStep("normal");
  }, [fontsTick, photoBroken]);
  useLayoutEffect(() => {
    if (!needsGemFit(job.gems, job.gemsState)) return;
    const el = sheetRef.current;
    if (!el) return;
    const h = measureMm(el);
    if (h === null) return;
    if (h > PRINT_CONTENT_HEIGHT_MM) {
      const next = nextGemPrintStep(step, hasPhoto, hasRows);
      // หมดบันไดแล้ว (แผ่น 1 ยังล้น / ไม่มีแถวให้บีบ) = เตือนบนจอ ไม่เงียบ
      if (next !== step) setStep(next);
      else setOverflow(true);
    } else setOverflow(false);
  }, [job.gems, job.gemsState, step, hasPhoto, hasRows, fontsTick, measureMm]);
  // ตัดรูปเฉพาะขั้น noPhoto/compact · พอตารางย้ายไปแผ่น 2 แผ่นที่ 1 โล่งแล้ว รูปกลับมา (ไม่ทิ้งข้อมูลเกินจำเป็น)
  const showPhoto = !photoBroken && photo.status !== "failed" && !photoCut;
  const photoDropped = photoCut && job.primaryPhotoUrl !== null && !photoBroken;
  const gemNotice = GEM_PRINT_NOTICE[step];

  // พิมพ์หลัง React วาด QR แล้วเท่านั้น (ไม่พิมพ์ใบที่ยังไม่มี QR) และหลังรูปหลักโหลดเสร็จ/ตัดสินแล้ว
  useEffect(() => {
    if (!issued || photoLoading) return;
    const t = setTimeout(() => window.print(), 250);
    return () => clearTimeout(t);
  }, [issued, photoLoading]);

  async function issue() {
    setBusy(true);
    setError(null);
    try {
      const r = await issueJobQr(job.jobId, keep);
      if (r.ok) setIssued(r.data);
      else setError(r.error);
    } catch {
      setError(GENERIC_JOB_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <style>{"@media print { @page { size: A5 portrait; margin: 8mm; } body { background: #fff !important; } }"}</style>
      <section aria-label="ออก QR และพิมพ์" className="max-w-xl space-y-3 rounded-lg border border-zinc-200 bg-white p-4 print:hidden">
        <h1 className="text-xl font-bold text-zinc-900">พิมพ์ใบงาน {job.jobNo}</h1>
        <p className="text-sm text-zinc-800">กด “ออก QR และพิมพ์” ระบบจะสร้าง QR ใหม่ให้ใบนี้ แล้วเปิดหน้าพิมพ์ (A5 แนวตั้ง)</p>
        <label className="flex min-h-11 items-start gap-2 text-sm text-zinc-900">
          <input type="checkbox" className="mt-0.5 h-5 w-5 accent-primary-600" checked={keep} onChange={(e) => setKeep(e.target.checked)} disabled={busy} />
          <span>
            พิมพ์สำเนาเพิ่ม — <strong>ไม่</strong>เพิกถอน QR ใบเดิม (ใช้ได้ไม่เกิน 5 ใบ)
            {!keep && <span className="block text-xs text-amber-900">ไม่ติ๊ก = ใบงานที่พิมพ์ไว้ก่อนหน้าจะสแกนไม่ได้ทันที</span>}
          </span>
        </label>
        {qr.host && <p className="text-sm text-zinc-800">QR จะชี้ไปที่ <strong className="break-all">{qr.host}</strong></p>}
        {qr.warning && (
          <p role="alert" className="rounded-md border-2 border-amber-400 bg-amber-50 p-2.5 text-sm font-semibold text-amber-950">
            {qr.warning}
          </p>
        )}
        {(qr.error || error) && (
          <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-2.5 text-sm font-medium text-red-800">
            {qr.error ?? error}
          </p>
        )}
        {!photoDropped && <PrintPhotoStatus status={photoBroken ? "failed" : photo.status} url={job.primaryPhotoUrl} addHref={`/jobs/${job.jobId}#job-photos`} />}
        {/* 0190: แถบเตือนพลอย (บนจอเท่านั้น) — อ่านพลอยไม่ได้ · ยังไม่ระบุพลอย · ขั้นของบันไดล้นหน้า (ห้ามตัดสินเงียบ) */}
        {gemsReadFailed && (
          <p role="alert" data-testid="print-gems-read-failed" className="rounded-md border-2 border-amber-400 bg-amber-50 p-2.5 text-sm font-semibold text-amber-950">
            อ่านพลอยของใบนี้ไม่ได้ — ใบที่พิมพ์จะไม่มีตารางพลอย โหลดหน้าใหม่ก่อนพิมพ์
          </p>
        )}
        {!gemsReadFailed && job.gems.length === 0 && job.gemsState === "unspecified" && (
          <p role="status" data-testid="print-gems-unspecified" className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-sm font-medium text-amber-950">
            ใบนี้มีขั้นฝังพลอยแต่ยังไม่ระบุพลอย — กระดาษจะขึ้น “พลอย: ยังไม่ระบุ — ถามออฟฟิศก่อนฝัง” เพิ่มพลอยที่หน้าใบงานก่อนพิมพ์ถ้าต้องการให้มีตาราง
          </p>
        )}
        {gemNotice && (
          <p role="status" data-testid="print-gems-notice" className="rounded-md border border-sky-300 bg-sky-50 p-2.5 text-sm font-medium text-sky-950">
            {gemNotice}
          </p>
        )}
        {overflow && (
          <p role="alert" data-testid="print-gems-overflow" className="rounded-md border-2 border-amber-400 bg-amber-50 p-2.5 text-sm font-semibold text-amber-950">
            แผ่นที่ 1 ยังล้นหน้า A5 แม้ปรับตามขั้นแล้ว — เช็คตัวอย่างก่อนพิมพ์ (ลดจำนวนขั้นของใบ หรือย่อชื่อแบบ/หมายเหตุ) กระดาษอาจถูกตัดท้ายใบ
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => void issue()} loading={busy} disabled={qr.error !== null || photoLoading}>
            <Printer className="h-4 w-4" aria-hidden="true" />
            {photoLoading ? "กำลังโหลดรูป…" : issued ? "ออก QR ใหม่และพิมพ์อีกครั้ง" : "ออก QR และพิมพ์"}
          </Button>
          {issued && (
            <Button type="button" variant="secondary" onClick={() => window.print()} disabled={photoLoading}>
              พิมพ์ใบนี้ซ้ำ
            </Button>
          )}
        </div>
        {issued && (
          <p role="status" className="text-sm text-green-900">
            ออก QR ใบที่ {issued.printNo} แล้ว{issued.revokedPrevious > 0 ? ` · เพิกถอนใบเก่า ${issued.revokedPrevious} ใบ` : ""} — QR นี้แสดงได้เฉพาะหน้านี้ ถ้าปิดหน้าก่อนพิมพ์ต้องออกใหม่
          </p>
        )}
      </section>
      <JobSheet job={job} qrSvg={issued?.svg ?? null} showPhoto={showPhoto} onPhotoLoad={photo.onLoad} onPhotoError={photo.onError} photoRef={photo.imgRef} gemMode={step} sheetRef={sheetRef} />
      {step === "page2" && <JobGemsSecondSheet jobNo={job.jobNo} designLabel={job.designLabel} gems={job.gems} />}
    </div>
  );
}
