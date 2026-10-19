"use client";

// SublotPrintClient — ใบย่อย (ถุงของส่วนที่แยก) A5 แนวตั้ง · พิมพ์เช้าถัดไปได้ (ระหว่างนั้นใช้ QR บนจอช่าง)
// 🔴 รับเฉพาะ PrintableSublot (lib/jobs/print.ts — ประกอบทีละ field) — ไม่มีราคา/ต้นทุน/ชื่อลูกค้า/เลขอ้างอิง/ชื่อผู้เปิดใบ/น้ำหนัก
// QR = token ใหม่ของใบแม่เดิม (มติ ข1) ออกตอนกดปุ่ม · ไม่เพิกถอนใบเก่า (ถุงอื่นถือ QR เดิมอยู่) · เพดาน 5 ใบ: ครบแล้วพิมพ์ไม่ได้จนกว่าจะเลือกเพิกถอนเอง
// ปุ่ม/คำเตือนทั้งหมด print:hidden

import { useEffect, useState } from "react";
import Link from "next/link";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { PrintPhoto } from "@/components/domain/jobs/photos/PrintPhoto";
import { PrintPhotoStatus } from "@/components/domain/jobs/photos/PrintPhotoStatus";
import { usePrintPhoto } from "@/components/domain/jobs/photos/usePrintPhoto";
import { ErrorLine } from "@/components/domain/jobs/JobDialogs";
import { QR_CAP, QR_CHANGED, QrManager, useQrList } from "@/components/domain/jobs/JobLotsSection";
import type { QrTarget } from "@/components/domain/jobs/JobPrintClient";
import { issueJobQr } from "@/lib/actions/job-office-write";
import type { IssuedQr } from "@/lib/actions/job-office-write";
import { thaiDate } from "@/lib/jobs/dates";
import { GENERIC_JOB_ERROR } from "@/lib/jobs/messages";
import type { PrintableSublot } from "@/lib/jobs/print";

export function SublotSheet({ sub, qrSvg, showPhoto = true, onPhotoLoad, onPhotoError, photoRef }: { sub: PrintableSublot; qrSvg: string | null; /** 0182: false = ตัดรูปหลักของใบแม่ออก (โหลดไม่ได้ → พิมพ์แบบไม่มีรูป) */ showPhoto?: boolean; onPhotoLoad?: () => void; onPhotoError?: () => void; photoRef?: React.Ref<HTMLImageElement> }) {
  const photoUrl = showPhoto ? sub.primaryPhotoUrl : null;
  // ข้อความใต้หัวใบ (ผ่านมาแล้ว · คำอธิบาย QR) — มีรูป: อยู่แถวเดียวกับรูปหลัก 30×30 มม. · ไม่มีรูป: markup เดิมเป๊ะ
  const notes = (
    <>
      <p className="mt-3 text-[10pt]">
        <strong>ผ่านมาแล้ว:</strong> {sub.passedLine || "—"}
        {sub.stageName ? ` (ต่อที่ ${sub.stageName})` : ""}
      </p>
      <p className="mt-2 text-[8.5pt]">สแกน QR นี้ = เปิดใบงานเดิม ระบบแสดงเฉพาะส่วนของคนที่สแกน</p>
    </>
  );
  return (
    <article aria-label={`ใบย่อย ${sub.lotLabel}`} className="job-sheet mx-auto w-[148mm] bg-white p-[7mm] text-[10pt] leading-snug text-black print:p-0">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[9pt] font-semibold">ใบย่อย · {sub.sourceLabel} · พิมพ์ {thaiDate(sub.printedOn)}</p>
          <p className="text-[26pt] leading-none font-extrabold tracking-tight tabular-nums">{sub.lotLabel}</p>
          <p className="mt-2 text-[14pt] font-bold break-words">{sub.designLabel}</p>
          <p className="text-[11pt]">
            {sub.metalLabel}
            {sub.sku ? ` · ${sub.sku}` : ""}
          </p>
          <p className="mt-2 text-[11pt]">จำนวนในถุงนี้</p>
          <p className="text-[30pt] leading-none font-extrabold tabular-nums">{sub.qty} <span className="text-[14pt] font-bold">ชิ้น</span></p>
          {sub.dueDate && <p className="mt-1 text-[11pt] font-semibold">กำหนดส่ง {thaiDate(sub.dueDate)}</p>}
        </div>
        <div className="flex w-[42mm] shrink-0 flex-col items-center">
          {qrSvg ? (
            // SVG สร้างฝั่ง server จากไลบรารี vendored (สีดำบนขาว ไม่มีสคริปต์) — ไม่ใช่ข้อมูลจากผู้ใช้
            <div className="h-[42mm] w-[42mm]" role="img" aria-label={`QR ใบงานเดิม ${sub.lotLabel}`} dangerouslySetInnerHTML={{ __html: qrSvg }} />
          ) : (
            <div className="flex h-[42mm] w-[42mm] items-center justify-center border-2 border-dashed border-zinc-400 p-2 text-center text-[8pt] text-zinc-600">QR จะปรากฏหลังกด “ออก QR และพิมพ์”</div>
          )}
          <p className="mt-0.5 text-[8pt]">สแกนเพื่อรับ / ส่งต่อ</p>
        </div>
      </header>
      {photoUrl ? (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">{notes}</div>
          <PrintPhoto url={photoUrl} alt={`รูปงาน ${sub.lotLabel}`} onLoad={onPhotoLoad} onError={onPhotoError} imgRef={photoRef} className="mt-3" />
        </div>
      ) : (
        notes
      )}
      <div className="mt-2 h-[16mm] border border-zinc-700 p-1 text-[8pt]">หมายเหตุ</div>
    </article>
  );
}

export function SublotPrintClient({ sub, qrTarget = { host: null, warning: null, error: null } }: { sub: PrintableSublot; qrTarget?: QrTarget }) {
  const qr = useQrList(sub.jobId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<IssuedQr | null>(null);
  // 0182: รูปหลักของใบแม่ — รอโหลดก่อนพิมพ์ · โหลดไม่ได้/หมดเวลา 8 วินาที = ตัดรูปออกแล้วพิมพ์ต่อ
  const photo = usePrintPhoto(sub.primaryPhotoUrl);
  const photoLoading = photo.status === "loading";

  // พิมพ์หลัง React วาด QR แล้วเท่านั้น และหลังรูปหลักโหลดเสร็จ/ตัดสินแล้ว
  useEffect(() => {
    if (!issued || photoLoading) return;
    const t = setTimeout(() => window.print(), 250);
    return () => clearTimeout(t);
  }, [issued, photoLoading]);

  async function issue() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // ไม่ส่ง revokePrevious = ไม่เพิกถอน QR ใบไหนเลย (L6 · ถุงอื่นของใบเดียวกันถืออยู่) · ชนิด sublot ชี้ส่วนนี้ · เพิกถอนต้องเลือกเองที่รายการ QR
      const r = await issueJobQr(sub.jobId, true, { purpose: "sublot", lotJobId: sub.lotJobId });
      if (r.ok) {
        setIssued(r.data);
        window.dispatchEvent(new Event(QR_CHANGED));
      } else setError(r.error);
    } catch {
      setError(GENERIC_JOB_ERROR);
    } finally {
      setBusy(false);
    }
  }

  const blocked = qr.capReached;
  return (
    <div className="space-y-4">
      <style>{"@media print { @page { size: A5 portrait; margin: 8mm; } body { background: #fff !important; } }"}</style>
      <section aria-label="ออก QR และพิมพ์ใบย่อย" className="max-w-xl space-y-3 rounded-lg border border-zinc-200 bg-white p-4 print:hidden">
        <h1 className="text-xl font-bold text-zinc-900">พิมพ์ใบย่อย {sub.lotLabel}</h1>
        <p className="text-sm text-zinc-800">
          ระบบจะออก QR ใหม่ของใบงานเดิม (สแกนแล้วเปิดใบเดียวกัน แสดงเฉพาะส่วนของคนที่สแกน) — <strong>ไม่</strong>เพิกถอน QR ใบอื่น ถุงอื่นที่ถือใบเดิมอยู่ยังสแกนได้
        </p>
        {qrTarget.host && <p className="text-sm text-zinc-800">QR จะชี้ไปที่ <strong className="break-all">{qrTarget.host}</strong></p>}
        {qrTarget.warning && (
          <p role="alert" className="rounded-md border-2 border-amber-400 bg-amber-50 p-2.5 text-sm font-semibold text-amber-950">
            {qrTarget.warning}
          </p>
        )}
        <ErrorLine message={qrTarget.error ?? error} />
        {blocked && (
          <p role="alert" className="rounded-md border-2 border-amber-400 bg-amber-50 p-2.5 text-sm font-semibold text-amber-950">
            QR ใช้งานครบ {QR_CAP} ใบแล้ว — เลือกเพิกถอนใบที่หายหรือไม่ใช้ด้านล่างก่อน จึงพิมพ์ใบย่อยเพิ่มได้ (ระบบไม่เพิกถอนให้เอง)
          </p>
        )}
        <PrintPhotoStatus status={photo.status} url={sub.primaryPhotoUrl} addHref={`/jobs/${sub.jobId}#job-photos`} />
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => void issue()} loading={busy} disabled={qrTarget.error !== null || blocked || qr.state.s !== "ok" || photoLoading}>
            <Printer className="h-4 w-4" aria-hidden="true" />
            {photoLoading ? "กำลังโหลดรูป…" : issued ? "ออก QR ใหม่และพิมพ์อีกครั้ง" : "ออก QR และพิมพ์"}
          </Button>
          {issued && (
            <Button type="button" variant="secondary" onClick={() => window.print()} disabled={photoLoading}>
              พิมพ์ใบนี้ซ้ำ
            </Button>
          )}
          <Link href={`/jobs/${sub.jobId}`} className="inline-flex min-h-11 items-center rounded-md border border-zinc-300 bg-white px-4 text-base font-medium text-zinc-800 hover:bg-zinc-50">
            กลับหน้าใบงาน
          </Link>
        </div>
        {issued && (
          <p role="status" className="text-sm text-green-900">
            ออก QR ใบที่ {issued.printNo} แล้ว — QR นี้แสดงได้เฉพาะหน้านี้ ถ้าปิดหน้าก่อนพิมพ์ต้องออกใหม่ (ใบที่ออกไปแล้วยังใช้ได้)
          </p>
        )}
        <QrManager jobId={sub.jobId} qr={qr} />
      </section>
      <SublotSheet sub={sub} qrSvg={issued?.svg ?? null} showPhoto={photo.status !== "failed"} onPhotoLoad={photo.onLoad} onPhotoError={photo.onError} photoRef={photo.imgRef} />
    </div>
  );
}
