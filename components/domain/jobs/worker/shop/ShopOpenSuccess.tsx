"use client";

// ShopOpenSuccess — W-8 เปิดสำเร็จ (UX B.7 · ภาษาภาพ Open7 + W2 ux-w2-shop-photos.md §5)
//   W-8a สำเร็จ: เลขใบ + ป้ายโลหะ + QR ใบงานบนจอ (แสดงครั้งเดียว — token ดิบอยู่ใน state ของ React เท่านั้น ไม่ลง storage/URL/log)
//   W-8b กดซ้ำ/ลองใหม่หลังเน็ตสะดุด ("เปิดไว้แล้ว") — ไม่มี QR (DB เก็บแต่ hash) · ไม่มี "เปิดอีกใบ" (กันเปิดซ้ำซ้อน) · ค่าที่โชว์มาจาก DB เท่านั้น ไม่ใช่ฟอร์ม
//   ใบถูกยกเลิกไปแล้ว (status = cancelled) → "ใบนี้ถูกยกเลิกแล้ว" — ไม่ใช่ "เปิดไว้แล้ว" · ไม่แสดงการ์ดรูป
// W2 (รูปจากหน้างาน):
//   • ไม่เลือกรูปเลย = DOM เดิมทุกประการ + แถวเดียว "＋ เพิ่มรูป" (เพิ่มภายหลังได้ — QR ไม่ซ่อนย้อนหลัง ผู้จัดการอาจยื่นจอไปแล้ว)
//   • มีรูป: ส่งทีละรูปอัตโนมัติ (ShopOpenFlow เรียก photos.start) · 🔴 ซ่อน QR จนส่งรูปครบ (กันช่างสแกนแล้วรับงานก่อนรูปมา) + "แสดง QR เลย" (ทางข้าม 1 ชั้น) · ส่งครบ/มีล้ม/ล็อก = แสดง
//   • รูปหลักคู่ QR (128 + 184) · exit guard เมื่อกด "เสร็จแล้ว/เปิดอีกใบ" ตอนยังมีรูปไม่ถึง server
// ไม่มีปุ่ม "เปิดผิด? ยกเลิก" (ยังไม่มี RPC ยกเลิกโดยผู้เปิด) → ข้อความ "เปิดผิด แจ้งออฟฟิศ" · ไม่โชว์น้ำหนักงานทองหลังเปิด (N1) · 🔴 ไม่มีตัวเลขเงิน

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Info, XCircle } from "lucide-react";
import { BigButton } from "@/components/domain/jobs/worker/WorkerParts";
import { ShopExitGuard } from "@/components/domain/jobs/worker/shop/ShopExitGuard";
import { ShopMetalTag } from "@/components/domain/jobs/worker/shop/ShopMetalTag";
import { ShopPhotoQrPair } from "@/components/domain/jobs/worker/shop/ShopPhotoQrPair";
import type { PrimaryPhotoStatus } from "@/components/domain/jobs/worker/shop/ShopPhotoQrPair";
import { ShopPhotoRejections } from "@/components/domain/jobs/worker/shop/ShopPhotoRejections";
import { ShopPhotoUploadPanel } from "@/components/domain/jobs/worker/shop/ShopPhotoUploadPanel";
import { orderedItems } from "@/components/domain/jobs/worker/shop/ShopPhotoViewerHost";
import type { ShopPhotosApi } from "@/components/domain/jobs/worker/shop/useShopPhotos";
import { PhotoAddButtons } from "@/components/domain/jobs/photos/PhotoAddButtons";
import { renderQrSvgClient, workerPageUrl } from "@/lib/jobs/qr-client";
import { SHOP_PHOTO_TH, leaveGuard, positions } from "@/lib/jobs/shop-photos";
import type { IntakeOpenResult } from "@/lib/jobs/worker-server";

/** ไม่เลือกรูปไว้เลย: แถวเดียว "＋ เพิ่มรูป" → กางเป็นปุ่มถ่าย/เลือก (เพิ่มแล้วการ์ดรูปขึ้นแทน · QR คงอยู่) */
function AddPhotoRow({ photos }: { photos: ShopPhotosApi }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <div className="space-y-2 text-left">
        {/* notice ยังต้องเห็นแม้การ์ดรูปหายไปแล้ว (เช่น "ถ้ารูปนี้ส่งถึงแล้ว จะอยู่ใน ใบที่ฉันเปิด — ลบได้ที่นั่น" หลังเอารูปสุดท้ายออก) */}
        <ShopPhotoRejections rejections={photos.rejections} notice={photos.notice} onDismiss={photos.dismissRejection} />
        <BigButton type="button" tone="secondary" onClick={() => setOpen(true)}>
          {SHOP_PHOTO_TH.addAfter}
        </BigButton>
      </div>
    );
  }
  return (
    <div className="space-y-2 text-left">
      <PhotoAddButtons variant="worker" libraryLabel="เลือกจากคลัง" onFiles={photos.pick} />
      <ShopPhotoRejections rejections={photos.rejections} notice={photos.notice} onDismiss={photos.dismissRejection} />
    </div>
  );
}

export function ShopOpenSuccess({
  result,
  purityLabel,
  onAnother,
  onFinish,
  photos,
  onSessionLost,
}: {
  result: IntakeOpenResult;
  purityLabel?: string | null;
  onAnother: () => void;
  onFinish: () => void;
  /** รูปจากหน้างาน (ShopOpenFlow ถือ) — ไม่ส่ง = หน้าเดิมเป๊ะ (ไม่มีแถวเพิ่มรูป) */
  photos?: ShopPhotosApi;
  onSessionLost?: () => void;
}) {
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

  // ---------- รูปจากหน้างาน ----------
  const items = cancelled ? [] : (photos?.items ?? []);
  const hasPhotos = items.length > 0;
  const summary = photos?.summary ?? "none";
  // QR gate ตัดสินครั้งเดียวตอนเข้าจอ: มีรูปชุดเปิดใบ = ซ่อน QR จนส่งครบ · ไม่มีรูป = ไม่เคยซ่อน (เพิ่มรูปทีหลังก็ไม่ซ่อนย้อนหลัง)
  const [gated] = useState(() => !already && !cancelled && items.length > 0);
  const [released, setReleased] = useState(false);
  const [announce, setAnnounce] = useState("");
  const qrShown = !gated || released || summary !== "sending";
  useEffect(() => {
    if (gated && qrShown && !released) {
      setReleased(true);
      if (summary === "done") setAnnounce(SHOP_PHOTO_TH.qrReady);
    }
  }, [gated, qrShown, released, summary]);
  const gateActive = gated && !qrShown;

  const [guardFor, setGuardFor] = useState<null | "another" | "finish">(null);
  const guard = leaveGuard(items, photos?.lock ?? null);
  const list = orderedItems(items);
  const unsentNumbers = positions(list, (i) => list[i].serverId === null);
  const failedNumbers = positions(list, (i) => list[i].phase === "error");
  function leave(kind: "another" | "finish") {
    if (photos && !cancelled && guard.needed) setGuardFor(kind);
    else if (kind === "another") onAnother();
    else onFinish();
  }
  const primary = list[0];
  const primaryStatus: PrimaryPhotoStatus = !primary ? "unsent" : primary.phase === "done" ? "sent" : primary.phase === "queued" || primary.phase === "uploading" || primary.phase === "resizing" ? "sending" : "unsent";
  const showPair = hasPhotos && !already && !cancelled && svg !== null;

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
        <span className={`block text-lg font-bold ${tone}`}>{title}</span>{" "}
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

      {photos && hasPhotos && <ShopPhotoUploadPanel photos={photos} jobNo={result.jobNo} mode="open" onSessionLost={onSessionLost ?? (() => undefined)} />}

      {!already && !cancelled && (
        <>
          {showPair ? (
            <ShopPhotoQrPair jobNo={result.jobNo} svg={svg} gated={gateActive} primaryUrl={primary?.smUrl ?? null} primaryStatus={primaryStatus} />
          ) : (
            svg && (
              <div className="flex justify-center">
                {/* SVG สร้างในเบราว์เซอร์จากไลบรารี vendored (ดำบนขาว ไม่มีสคริปต์) จาก URL ของใบงานที่เพิ่งออก — ไม่ใช่ข้อมูลจากผู้ใช้ */}
                <div className="h-[200px] w-[200px] rounded-xl border border-zinc-300 bg-white p-1" role="img" aria-label={`QR ใบงาน ${result.jobNo}`} dangerouslySetInnerHTML={{ __html: svg }} />
              </div>
            )
          )}
          {gateActive && (
            <div role="status" className="space-y-2 rounded-xl border-2 border-sky-300 bg-sky-50 p-3 text-left text-sky-950">
              <p className="text-lg font-semibold">{SHOP_PHOTO_TH.qrGate}</p>
              <button type="button" onClick={() => setReleased(true)} className="min-h-12 w-full rounded-lg text-lg font-semibold text-primary-800 underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-300">
                {SHOP_PHOTO_TH.qrShowNow}
              </button>
            </div>
          )}
          {!gateActive && qrShown && gated && summary === "partial" && failedNumbers && (
            <p role="status" className="rounded-xl border-2 border-amber-400 bg-amber-50 p-3 text-left text-lg text-amber-950">
              {SHOP_PHOTO_TH.qrPartial(failedNumbers)}
            </p>
          )}
          <p role="status" aria-live="polite" className="sr-only">
            {announce}
          </p>
          {!gateActive && (
            <>
              <p className="text-[17px] font-bold text-zinc-900">
                ให้ช่างขั้นแรกสแกนจากจอนี้
                <br />
                เพื่อรับงานได้เลย
              </p>
              <p role="note" className="rounded-xl border-2 border-amber-400 bg-amber-50 p-3 text-left text-base text-amber-950">
                ⚠ QR นี้แสดงครั้งเดียว — ออกจากหน้านี้แล้วจะหายจากจอ (ขอออฟฟิศพิมพ์ใบให้ หรือออก QR ใหม่ที่ &ldquo;ใบที่ฉันเปิด&rdquo; ได้)
              </p>
            </>
          )}
          {photos && !hasPhotos && <AddPhotoRow photos={photos} />}
        </>
      )}

      {/* W-8b: รูปยังอยู่ในหน้านี้ (คำขอเปิดแรกสำเร็จแต่ไม่ได้ตอบกลับ → ยังไม่เคยส่งรูป) — การ์ดรูปด้านบนส่งต่อได้ตามปกติ (ไม่มี QR จึงไม่มี gate) */}
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
        <BigButton type="button" onClick={() => leave("finish")}>
          เสร็จแล้ว
        </BigButton>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <BigButton type="button" onClick={() => leave("another")}>
              เปิดอีกใบ
            </BigButton>
            <BigButton type="button" tone="secondary" onClick={() => leave("finish")}>
              เสร็จแล้ว
            </BigButton>
          </div>
          <p className="text-base text-zinc-700">เปิดผิด? แจ้งออฟฟิศ — โลหะหรือสินค้าที่เปิดไปแล้วแก้จากหน้านี้ไม่ได้</p>
        </>
      )}

      {guardFor && photos && (
        <ShopExitGuard
          numbers={unsentNumbers}
          locked={photos.lock !== null && !guard.canStillSend}
          hasQr={svg !== null && !already}
          showKept
          onStay={() => setGuardFor(null)}
          onLeave={() => {
            const k = guardFor;
            setGuardFor(null);
            if (k === "another") onAnother();
            else onFinish();
          }}
        />
      )}
    </div>
  );
}
