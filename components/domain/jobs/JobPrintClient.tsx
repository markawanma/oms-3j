"use client";

// JobPrintClient — ใบงาน (traveler) A5 แนวตั้ง · พิมพ์ติดถุงงาน
// 🔴 รับเฉพาะ PrintableJob (lib/jobs/print.ts — ประกอบทีละ field) — ห้ามราคา/ต้นทุน/ชื่อลูกค้า/เลขอ้างอิง · props ถึงเบราว์เซอร์ทั้งก้อน
// QR: ออกตอนกดปุ่ม (job_token_issue → ได้ token ครั้งเดียว → SVG จาก server) · ใบเก่าถูกเพิกถอนเป็นค่าเริ่ม (ติ๊ก "พิมพ์สำเนาเพิ่ม" = ไม่เพิกถอน)
// ปิดหน้าก่อนพิมพ์ = QR นั้นหายไปจากหน้าจอ (ไม่เก็บ token) → ต้องออกใหม่ · ปุ่ม/คำเตือนทั้งหมด print:hidden

import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { issueJobQr } from "@/lib/actions/job-office-write";
import type { IssuedQr } from "@/lib/actions/job-office-write";
import { qtyOrderPlannedText } from "@/lib/jobs/board";
import { thaiDate } from "@/lib/jobs/dates";
import { GENERIC_JOB_ERROR } from "@/lib/jobs/messages";
import { METAL_LABEL } from "@/lib/jobs/types";
import type { PrintableJob } from "@/lib/jobs/print";

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

export function JobSheet({ job, qrSvg }: { job: PrintableJob; qrSvg: string | null }) {
  const cols = sheetColumns(job);
  return (
    <article aria-label={`ใบงาน ${job.jobNo}`} className="job-sheet mx-auto w-[148mm] bg-white p-[7mm] text-[10pt] leading-snug text-black print:p-0">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
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

export function JobPrintClient({ job, qr = { host: null, warning: null, error: null }, defaultKeep = false }: { job: PrintableJob; qr?: QrTarget; /** 0181: ใบที่แยกส่วนแล้ว — ถุงหลายใบถือ QR พร้อมกัน ค่าเริ่ม = ไม่เพิกถอนใบเก่า */ defaultKeep?: boolean }) {
  const [keep, setKeep] = useState(defaultKeep);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<IssuedQr | null>(null);

  // พิมพ์หลัง React วาด QR แล้วเท่านั้น (ไม่พิมพ์ใบที่ยังไม่มี QR)
  useEffect(() => {
    if (!issued) return;
    const t = setTimeout(() => window.print(), 250);
    return () => clearTimeout(t);
  }, [issued]);

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
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => void issue()} loading={busy} disabled={qr.error !== null}>
            <Printer className="h-4 w-4" aria-hidden="true" />
            {issued ? "ออก QR ใหม่และพิมพ์อีกครั้ง" : "ออก QR และพิมพ์"}
          </Button>
          {issued && (
            <Button type="button" variant="secondary" onClick={() => window.print()}>
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
      <JobSheet job={job} qrSvg={issued?.svg ?? null} />
    </div>
  );
}
