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
import { thaiDate } from "@/lib/jobs/dates";
import { GENERIC_JOB_ERROR } from "@/lib/jobs/messages";
import type { PrintableJob } from "@/lib/jobs/print";

const CELL = "border border-zinc-700 px-1 align-top";

export function JobSheet({ job, qrSvg }: { job: PrintableJob; qrSvg: string | null }) {
  return (
    <article aria-label={`ใบงาน ${job.jobNo}`} className="job-sheet mx-auto w-[148mm] bg-white p-[7mm] text-[10pt] leading-snug text-black print:p-0">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[9pt] font-semibold">ใบงานผลิต · {job.sourceLabel}</p>
          <p className="text-[30pt] leading-none font-extrabold tracking-tight tabular-nums">{job.jobNo}</p>
          <p className="mt-2 text-[14pt] font-bold break-words">{job.designLabel}</p>
          <p className="text-[11pt]">
            {job.qtyPlanned} ชิ้น · {job.metalLabel}
            {job.sku ? ` · ${job.sku}` : ""}
          </p>
          <p className="mt-1 text-[11pt] font-semibold">กำหนดส่ง {thaiDate(job.dueDate)}</p>
          <p className="mt-1 text-[10pt]">น้ำหนักตั้งต้น {job.weightStartG !== null ? `${job.weightStartG} g` : "............ g"}</p>
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
            <th className={CELL}>นน.เข้า</th>
            <th className={CELL}>วันส่ง</th>
            <th className={CELL}>นน.ออก</th>
            <th className={`${CELL} w-[9%]`}>เสีย</th>
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
              {Array.from({ length: 7 }, (_, i) => (
                <td key={i} className={CELL} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-[8pt]">* ขั้นที่ต้องชั่งน้ำหนักทุกครั้ง</p>
      <div className="mt-2 h-[16mm] border border-zinc-700 p-1 text-[8pt]">หมายเหตุ</div>
    </article>
  );
}

export function JobPrintClient({ job }: { job: PrintableJob }) {
  const [keep, setKeep] = useState(false);
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
        {error && (
          <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-2.5 text-sm font-medium text-red-800">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => void issue()} loading={busy}>
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
