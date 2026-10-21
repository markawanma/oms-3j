"use client";

// ShopOpenSuccess — W-8 เปิดสำเร็จ (UX B.7 · ภาษาภาพ Open7)
//   W-8a สำเร็จ: เลขใบ + ป้ายโลหะ + QR ใบงานบนจอ (แสดงครั้งเดียว — token ดิบอยู่ใน state ของ React เท่านั้น ไม่ลง storage/URL/log)
//   W-8b กดซ้ำ/ลองใหม่หลังเน็ตสะดุด ("เปิดไว้แล้ว") — ไม่มี QR (DB เก็บแต่ hash) · ไม่มี "เปิดอีกใบ" (กันเปิดซ้ำซ้อน) · ค่าที่โชว์มาจาก DB เท่านั้น ไม่ใช่ฟอร์ม
//   ใบถูกยกเลิกไปแล้ว (status = cancelled) → "ใบนี้ถูกยกเลิกแล้ว" — ไม่ใช่ "เปิดไว้แล้ว"
// ไม่มีปุ่ม "เปิดผิด? ยกเลิก" (ยังไม่มี RPC ยกเลิกโดยผู้เปิด) → ข้อความ "เปิดผิด แจ้งออฟฟิศ" · ไม่โชว์น้ำหนักงานทองหลังเปิด (N1) · 🔴 ไม่มีตัวเลขเงิน

import { useEffect, useMemo, useRef } from "react";
import { CheckCircle2, Info, XCircle } from "lucide-react";
import { BigButton } from "@/components/domain/jobs/worker/WorkerParts";
import { ShopMetalTag } from "@/components/domain/jobs/worker/shop/ShopMetalTag";
import { renderQrSvgClient, workerPageUrl } from "@/lib/jobs/qr-client";
import type { IntakeOpenResult } from "@/lib/jobs/worker-server";

export function ShopOpenSuccess({ result, purityLabel, onAnother, onFinish }: { result: IntakeOpenResult; purityLabel?: string | null; onAnother: () => void; onFinish: () => void }) {
  const headRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headRef.current?.focus();
  }, []);
  const cancelled = result.status === "cancelled";
  const already = result.already && !cancelled;
  // QR = URL ของใบงาน (/w/<token ใบงาน>) · SVG สร้างในเบราว์เซอร์จากไลบรารี vendored (ดำบนขาว ไม่มีสคริปต์) — เหมือน SplitDone
  const svg = useMemo(() => {
    if (result.token === null || cancelled) return null;
    try {
      return renderQrSvgClient(workerPageUrl(window.location.origin, result.token));
    } catch {
      return null;
    }
  }, [result.token, cancelled]);
  const qty = result.qtyPlanned ?? result.qtyOrder;
  const title = cancelled ? "ใบนี้ถูกยกเลิกแล้ว" : already ? "เปิดไว้แล้ว" : "เปิดงานแล้ว";
  const tone = cancelled ? "text-red-800" : already ? "text-sky-800" : "text-green-800";

  return (
    <div className="space-y-4 text-center">
      <div className="flex justify-center">
        {cancelled ? (
          <XCircle data-testid="done-cancelled" className="h-16 w-16 text-red-700" aria-hidden="true" />
        ) : already ? (
          <Info data-testid="done-already" className="h-16 w-16 text-sky-700" aria-hidden="true" />
        ) : (
          <CheckCircle2 data-testid="done-ok" className="h-16 w-16 text-green-700" aria-hidden="true" />
        )}
      </div>
      <h1 ref={headRef} tabIndex={-1} className="space-y-1 focus:outline-none">
        <span className={`block text-lg font-bold ${tone}`}>{title}</span>
        <span className="block text-[44px] leading-tight font-extrabold tracking-tight text-zinc-900">{result.jobNo}</span>
      </h1>

      <div className="space-y-2">
        <p className="text-base text-zinc-800 break-words">
          <span className="font-semibold">{result.designLabel}</span> · {already || cancelled ? "" : "ผลิต "}
          {qty.toLocaleString("en-US")} ชิ้น
        </p>
        {!cancelled && (
          <p className="flex flex-wrap items-center justify-center gap-2 text-lg">
            <ShopMetalTag metal={result.metal} size="md" />
            {!already && purityLabel && <span className="font-bold tabular-nums text-zinc-900">{purityLabel}</span>}
          </p>
        )}
        {result.skuPending && !cancelled && (
          <p className="mx-auto inline-block rounded-md bg-[#FFF1C2] px-2.5 py-1 text-base font-semibold text-[#5A3D00]">⚑ ยังไม่มีรหัสสินค้า — ออฟฟิศจะผูกให้</p>
        )}
      </div>

      {!already && !cancelled && (
        <>
          {svg && (
            <div className="flex justify-center">
              {/* SVG สร้างในเบราว์เซอร์จากไลบรารี vendored (ดำบนขาว ไม่มีสคริปต์) จาก URL ของใบงานที่เพิ่งออก — ไม่ใช่ข้อมูลจากผู้ใช้ */}
              <div className="h-[200px] w-[200px] rounded-xl border border-zinc-300 bg-white p-1" role="img" aria-label={`QR ใบงาน ${result.jobNo}`} dangerouslySetInnerHTML={{ __html: svg }} />
            </div>
          )}
          <p className="text-[17px] font-bold text-zinc-900">
            ให้ช่างขั้นแรกสแกนจากจอนี้
            <br />
            เพื่อรับงานได้เลย
          </p>
          <p role="note" className="rounded-xl border-2 border-amber-400 bg-amber-50 p-3 text-left text-base text-amber-950">
            ⚠ QR นี้แสดงครั้งเดียว — ออกจากหน้านี้แล้วจะหายจากจอ (ขอออฟฟิศพิมพ์ใบให้ได้)
          </p>
        </>
      )}

      {already && (
        <p role="note" className="rounded-xl border-2 border-sky-300 bg-sky-50 p-3 text-left text-lg text-sky-950">
          ⓘ งานนี้เปิดเรียบร้อยแล้ว แต่ QR แสดงซ้ำไม่ได้ — ขอออฟฟิศพิมพ์ใบงานให้ หรือออก QR ใหม่
        </p>
      )}
      {cancelled && (
        <p role="note" className="rounded-xl border-2 border-red-200 bg-red-50 p-3 text-left text-lg text-red-900">
          ใบที่เปิดไว้ก่อนหน้านี้ถูกยกเลิกแล้ว — ถ้ายังต้องการผลิต แจ้งออฟฟิศ
        </p>
      )}

      {already || cancelled ? (
        <BigButton type="button" onClick={onFinish}>
          เสร็จแล้ว
        </BigButton>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <BigButton type="button" onClick={onAnother}>
              เปิดอีกใบ
            </BigButton>
            <BigButton type="button" tone="secondary" onClick={onFinish}>
              เสร็จแล้ว
            </BigButton>
          </div>
          <p className="text-base text-zinc-700">เปิดผิด? แจ้งออฟฟิศ — โลหะหรือสินค้าที่เปิดไปแล้วแก้จากหน้านี้ไม่ได้</p>
        </>
      )}
    </div>
  );
}
