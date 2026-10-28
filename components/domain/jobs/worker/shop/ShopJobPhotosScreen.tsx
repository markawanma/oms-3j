"use client";

// ShopJobPhotosScreen — W-10 จอ "แก้ JB-xxxx" ของใบที่ฉันเปิด: ส่วนพลอย (ShopJobGemsSection · 0191 W3) บน + ส่วนรูป (W2) ล่าง · เดิม "จอแก้รูป" (UX §5A.2 · มติ Q1=B) + ปุ่ม "ออก QR ใหม่" (มติ 21 ต.ค. ทับ Q8-ก)
// ใช้ ShopPhotoUploadPanel ตัวเดียวกับ W-8 (โหมด edit): รูปโหลดจาก server (signed URL 15 นาที) แทนไฟล์ในเครื่อง · รูปที่บันทึกแล้วไม่โชว์ "ส่งแล้ว" · รูปใหม่ = ย่อ → ส่งทีละรูปอ้างใบด้วย jobId (ไม่มี idem key ของใบแล้ว) + clientPhotoKey ต่อรูป (กันซ้ำตอนลองใหม่)
// แก้ได้จนช่างเริ่มรับงาน (server เป็นด่านจริง — ป้าย "แก้ได้" ในรายการอาจเก่า จอนี้โหลดซ้ำเสมอและรับ locked จาก server ทั้งตอนโหลด/ส่ง/ลบ)
// ออก QR ใหม่: ไม่เพิกถอน QR เดิม · เพดาน 5 ใบ/ใบงาน (DB) · token ดิบแปลงเป็น SVG ทันทีแล้วทิ้ง (ไม่เก็บ state/storage/log) · กันกดซ้ำด้วย inflight + idem key ต่อการออก (key เดิมข้ามการลองใหม่ → server ตอบ already ไม่กินโควตาเพิ่ม · ได้ผลชัดเจนแล้วเปลี่ยน key)
// 4 state: loading (skeleton) · empty (0 รูป: แก้ได้/ล็อก คนละข้อความ — ในการ์ดรูป) · error (โหลดไม่ได้ + ลองอีกครั้ง/ใส่ PIN ใหม่ · ส่ง/ลบ/ล้ม ในแถว) · success (แถวรูป + ปุ่มเพิ่ม หรือแถบล็อก)
// ใบปิด/ยกเลิกระหว่างเปิดจอ: แถบ info + "กลับไปรายการ" · session หมดเวลา: แถวล้ม/ข้อความ + แผ่น PIN (หน้านี้คง mount ผ่าน ShopIntakeApp — ผ่านแล้วกลับมาที่จอเดิม)

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { intakeListPhotos, intakeReissueToken } from "@/lib/actions/job-worker";
import { Modal } from "@/components/ui/Modal";
import { BigButton } from "@/components/domain/jobs/worker/WorkerParts";
import { ShopExitGuard } from "@/components/domain/jobs/worker/shop/ShopExitGuard";
import { ShopJobGemsSection } from "@/components/domain/jobs/worker/shop/ShopJobGemsSection";
import { ShopMetalTag } from "@/components/domain/jobs/worker/shop/ShopMetalTag";
import { ShopPhotoQrPair } from "@/components/domain/jobs/worker/shop/ShopPhotoQrPair";
import { ShopPhotoUploadPanel } from "@/components/domain/jobs/worker/shop/ShopPhotoUploadPanel";
import { orderedItems } from "@/components/domain/jobs/worker/shop/ShopPhotoViewerHost";
import { useIntakePhotoIo } from "@/components/domain/jobs/worker/shop/useIntakePhotoIo";
import { useShopPhotos } from "@/components/domain/jobs/worker/shop/useShopPhotos";
import { useRefreshGate } from "@/components/domain/jobs/photos/useRefreshGate";
import type { RetryReason } from "@/components/domain/jobs/photos/types";
import { renderQrSvgClient, workerPageUrl } from "@/lib/jobs/qr-client";
import { newIdemKey } from "@/lib/jobs/shop-open";
import { REISSUE_TH, SHOP_PHOTO_TH, leaveGuard, positions, reissueErrorView } from "@/lib/jobs/shop-photos";
import { SHOP_GEM_TH } from "@/lib/jobs/shop-gem-flow";
import type { MyIntakeJob } from "@/lib/jobs/shop-photo-server";

export const MSG_JOBPHOTOS_LOAD_FAIL = "โหลดรูปไม่ได้ — เช็คสัญญาณแล้วลองอีกครั้ง";
export const MSG_JOB_CLOSED = "ใบนี้ปิดหรือยกเลิกแล้ว";
const MSG_QR_DRAW_FAIL = "สร้างภาพ QR ไม่สำเร็จ — ลองออก QR ใหม่อีกครั้ง";

type Load = { kind: "loading" } | { kind: "error"; message: string; pin: boolean } | { kind: "ready" };

export function ShopJobPhotosScreen({ token, job, onBack, onSessionLost }: { token: string; job: MyIntakeJob; onBack: () => void; onSessionLost: () => void }) {
  const io = useIntakePhotoIo(token);
  // รูปหลักอาจเป็นของออฟฟิศ/แคตตาล็อก — ไม่บังคับดาวที่รูปของผู้จัดการ (ตามที่ server บอก)
  const photos = useShopPhotos({ io, enforcePrimary: false });
  const { loadServer, start } = photos;
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [guard, setGuard] = useState(false);
  const [reissue, setReissue] = useState<null | { phase: "confirm"; busy: boolean; error: string | null; pin: boolean; final: boolean }>(null);
  const [qr, setQr] = useState<string | null>(null);
  const headRef = useRef<HTMLHeadingElement>(null);
  const seq = useRef(0);
  const alive = useRef(true);
  const inflight = useRef(false);
  // idem key ของการออก QR ใหม่: คงเดิมข้ามการ "ลองใหม่" หลังเน็ตหลุด (ครั้งก่อนออกไปแล้ว = server ตอบ already ไม่กินโควตา) · เปลี่ยนเมื่อได้ผลชัดเจนแล้ว (ออกสำเร็จ/ออกไปแล้ว) ให้กดครั้งถัดไปเป็น QR ใบใหม่
  const reissueKey = useRef<string | null>(null);
  const allowRefresh = useRefreshGate();
  const lost = useRef(onSessionLost);
  useEffect(() => {
    lost.current = onSessionLost;
  });

  const loadList = useCallback(
    async (silent: boolean) => {
      const n = ++seq.current;
      if (!silent) setLoad({ kind: "loading" });
      let r: Awaited<ReturnType<typeof intakeListPhotos>> | null = null;
      try {
        r = await intakeListPhotos(token, { jobId: job.jobId });
      } catch {
        r = null;
      }
      if (!alive.current || n !== seq.current) return;
      if (r && r.ok) {
        loadServer(r);
        setLoad({ kind: "ready" });
        return;
      }
      if (silent) return; // ขอลิงก์รูปใหม่ล้ม — รูปเดิมยังใช้ได้/แตะลองใหม่ได้
      const pin = r !== null && r.code === "session_required";
      if (pin) lost.current();
      setLoad({ kind: "error", message: pin ? SHOP_PHOTO_TH.failPin : MSG_JOBPHOTOS_LOAD_FAIL, pin });
    },
    [token, job.jobId, loadServer],
  );

  useEffect(() => {
    alive.current = true;
    start({ jobId: job.jobId });
    void loadList(false);
    return () => {
      alive.current = false;
    };
  }, [job.jobId, loadList, start]);

  // โฟกัสหัวจอเมื่อเข้าจอ/เปลี่ยนสภาพ (loading → ready/error) — screen reader อ่านหัวใหม่
  const loadKind = load.kind;
  useEffect(() => {
    if (loadKind !== "loading") headRef.current?.focus();
  }, [loadKind]);

  // ลิงก์รูปหมดอายุ 15 นาที → ขอรายการใหม่ (อัตโนมัติ ≤ 2 ครั้ง · แตะ "ลองใหม่" ผ่านเสมอ)
  const onRetryLoad = useCallback(
    (reason: RetryReason) => {
      if (!allowRefresh(reason)) return;
      void loadList(true);
    },
    [allowRefresh, loadList],
  );

  const g = leaveGuard(photos.items, photos.lock);
  const list = orderedItems(photos.items);
  function tryBack() {
    if (g.needed) setGuard(true);
    else onBack();
  }

  async function doReissue() {
    if (inflight.current) return;
    inflight.current = true;
    setReissue({ phase: "confirm", busy: true, error: null, pin: false, final: false });
    if (reissueKey.current === null) reissueKey.current = newIdemKey();
    let r: Awaited<ReturnType<typeof intakeReissueToken>> | null = null;
    try {
      r = await intakeReissueToken(token, job.jobId, reissueKey.current);
    } catch {
      r = null;
    } finally {
      inflight.current = false;
    }
    if (!alive.current) return;
    if (r === null) {
      setReissue({ phase: "confirm", busy: false, error: REISSUE_TH.netFail, pin: false, final: false });
      return;
    }
    if (!r.ok) {
      const v = reissueErrorView(r);
      if (v.needsPin) {
        // session หมดเวลา: โหลด hub ใหม่ (แผ่น PIN เดิมขึ้นเอง พร้อมข้อความ "หมดเวลาแล้ว") — ปิดกล่องนี้ ใส่ PIN แล้วกด "ออก QR ใหม่" ซ้ำได้
        lost.current();
        setReissue(null);
        return;
      }
      setReissue({ phase: "confirm", busy: false, error: v.message, pin: false, final: v.final });
      return;
    }
    // ผลชัดเจนแล้ว (ออกสำเร็จ หรือ key เดิมออกไปแล้ว) → ครั้งถัดไปใช้ key ใหม่
    reissueKey.current = null;
    if (r.already || r.token === null) {
      // key เดิมออกไปแล้วแต่คำขอก่อนหน้าตอบไม่ถึง: server ไม่มี QR ดิบส่งซ้ำ — บอกผู้ใช้ให้กดออกใหม่ (key ใหม่)
      setReissue({ phase: "confirm", busy: false, error: REISSUE_TH.already, pin: false, final: false });
      return;
    }
    // token ดิบ → SVG ทันที แล้วทิ้ง (ไม่เก็บใน state)
    let svg: string | null = null;
    try {
      svg = renderQrSvgClient(workerPageUrl(window.location.origin, r.token));
    } catch {
      svg = null;
    }
    if (svg === null) {
      setReissue({ phase: "confirm", busy: false, error: MSG_QR_DRAW_FAIL, pin: false, final: false });
      return;
    }
    setReissue(null);
    setQr(svg);
  }

  // ---------- จอผลลัพธ์ QR ใหม่ (แสดงครั้งเดียว) ----------
  if (qr !== null) {
    // คู่รูป+QR เฉพาะเมื่อรู้ "รูปหลักจริง" (ดาวจาก server) — ไม่เลือกรูปอื่นมาแทนแล้วติดป้าย "รูปหลัก" · รูปหลักเป็นของออฟฟิศ/ไม่มีรูปหลักของเรา = QR เดี่ยว
    const primary = list.find((i) => i.isPrimary && i.smUrl) ?? null;
    return (
      <div className="space-y-4 text-center">
        <h1 ref={headRef} tabIndex={-1} className="text-2xl font-bold text-zinc-900 focus:outline-none">
          {REISSUE_TH.resultTitle(job.jobNo)}
        </h1>
        {primary ? (
          <ShopPhotoQrPair jobNo={job.jobNo} svg={qr} gated={false} primaryUrl={primary.smUrl} primaryStatus="sent" />
        ) : (
          <div className="flex justify-center">
            {/* SVG สร้างในเบราว์เซอร์จากไลบรารี vendored (ดำบนขาว ไม่มีสคริปต์) จาก URL ของใบงานที่เพิ่งออก — ไม่ใช่ข้อมูลจากผู้ใช้ */}
            <div className="h-[200px] w-[200px] rounded-xl border border-zinc-300 bg-white p-1" role="img" aria-label={`QR ใบงาน ${job.jobNo}`} dangerouslySetInnerHTML={{ __html: qr }} />
          </div>
        )}
        <p className="text-[17px] font-bold text-zinc-900">
          ให้ช่างสแกน QR นี้จากจอ
          <br />
          เพื่อเปิดใบงานนี้
        </p>
        <p role="note" className="rounded-xl border-2 border-amber-400 bg-amber-50 p-3 text-left text-base text-amber-950">
          {REISSUE_TH.once}
        </p>
        <BigButton type="button" onClick={() => setQr(null)}>
          {REISSUE_TH.done}
        </BigButton>
      </div>
    );
  }

  const closed = load.kind === "ready" && photos.lock === "closed";

  return (
    <div className="space-y-4">
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <button type="button" onClick={tryBack} aria-label="กลับไปใบที่ฉันเปิด" className="-ml-2 flex h-14 w-14 shrink-0 items-center justify-center rounded-xl text-zinc-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-300">
            <ChevronLeft className="h-8 w-8" aria-hidden="true" />
          </button>
          <p className="text-base font-semibold text-zinc-700">ใบที่ฉันเปิด</p>
        </div>
        <h1 ref={headRef} tabIndex={-1} className="text-2xl font-bold text-zinc-900 focus:outline-none">
          {SHOP_GEM_TH.editTitle(job.jobNo)}
        </h1>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-lg text-zinc-900">
          <span className="font-semibold break-words">{job.designLabel}</span>
          {job.metal && <ShopMetalTag metal={job.metal} size="sm" />}
          <span className="tabular-nums">· {job.qty.toLocaleString("en-US")} ชิ้น</span>
        </p>
      </header>

      {/* W-10 = "แก้ใบ": พลอย (บน) → รูป (ล่าง — ของ W2 ไม่เปลี่ยน) · หน้าต่างแก้เดียวกัน (จนช่างเริ่มรับงาน) */}
      <ShopJobGemsSection token={token} job={job} onSessionLost={onSessionLost} />

      {load.kind === "loading" && (
        <div role="status" aria-busy="true" aria-label="กำลังโหลดรูป" className="animate-pulse space-y-2">
          <div className="h-12 rounded-xl bg-zinc-200" />
          <div className="h-[72px] rounded-xl bg-zinc-200" />
          <div className="h-[72px] rounded-xl bg-zinc-200" />
        </div>
      )}

      {load.kind === "error" && (
        <div className="space-y-2 rounded-xl bg-red-50 p-3 text-red-900">
          <p role="alert" className="text-lg font-semibold">
            {load.message}
          </p>
          {/* session หมดเวลา: แผ่น PIN ขึ้นเองจากการโหลด hub ใหม่ (ซ่อนจอนี้ไว้ ไม่ unmount) — ใส่ PIN แล้วกลับมากด "ลองอีกครั้ง" */}
          <BigButton type="button" tone="secondary" onClick={() => void loadList(false)}>
            {SHOP_PHOTO_TH.retryAgain}
          </BigButton>
        </div>
      )}

      {closed && (
        <div className="space-y-3">
          <p role="note" className="rounded-xl border-2 border-sky-300 bg-sky-50 p-3 text-lg font-semibold text-sky-950">
            {MSG_JOB_CLOSED}
          </p>
          <BigButton type="button" onClick={onBack}>
            กลับไปรายการ
          </BigButton>
        </div>
      )}

      {load.kind === "ready" && !closed && (
        <>
          {photos.lock === null && (
            <p role="note" className="rounded-xl border-2 border-sky-300 bg-sky-50 p-3 text-lg font-semibold text-sky-950">
              ✎ {SHOP_PHOTO_TH.editable}
            </p>
          )}
          <ShopPhotoUploadPanel photos={photos} jobNo={job.jobNo} mode="edit" onSessionLost={onSessionLost} onRetryLoad={onRetryLoad} />

          <section aria-labelledby="shop-reissue-h" className="space-y-2">
            <h2 id="shop-reissue-h" className="sr-only">
              QR ใบงาน
            </h2>
            <p className="flex items-start gap-2 text-base text-zinc-700">
              <span aria-hidden="true">ⓘ</span>
              <span className="min-w-0 break-words">{REISSUE_TH.note}</span>
            </p>
            <BigButton type="button" tone="secondary" onClick={() => setReissue({ phase: "confirm", busy: false, error: null, pin: false, final: false })}>
              {REISSUE_TH.button}
            </BigButton>
          </section>

          <BigButton type="button" tone="secondary" onClick={tryBack}>
            กลับ
          </BigButton>
        </>
      )}

      {reissue && (
        <Modal open onClose={reissue.busy ? () => undefined : () => setReissue(null)} title={REISSUE_TH.title(job.jobNo)}>
          <div className="space-y-3">
            <p className="text-lg text-zinc-900">{REISSUE_TH.body}</p>
            {reissue.error && (
              <p role="alert" className="rounded-xl border-2 border-red-200 bg-red-50 p-3 text-lg font-semibold text-red-800">
                {reissue.error}
              </p>
            )}
            {!reissue.final && (
              <BigButton type="button" loading={reissue.busy} onClick={() => void doReissue()}>
                {reissue.busy ? REISSUE_TH.working : REISSUE_TH.confirm}
              </BigButton>
            )}
            <BigButton type="button" tone="secondary" disabled={reissue.busy} onClick={() => setReissue(null)}>
              {reissue.final ? "ปิด" : "ยกเลิก"}
            </BigButton>
          </div>
        </Modal>
      )}

      {guard && (
        <ShopExitGuard
          numbers={positions(list, (i) => list[i].serverId === null)}
          locked={photos.lock !== null && !g.canStillSend}
          hasQr={false}
          showKept={false}
          onStay={() => setGuard(false)}
          onLeave={() => {
            setGuard(false);
            onBack();
          }}
        />
      )}
    </div>
  );
}
