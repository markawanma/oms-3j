"use client";

// ShopPhotosStrip — แถบ "รูปจากหน้างาน" ในการ์ด OfficeAck (/production/[id] ก่อนรับทราบ · PC) · UX §6 · มติเจ้าของ 21 ต.ค.
// ออฟฟิศเห็นรูปที่ผู้จัดการส่งจากหน้างานตอนตรวจโลหะพอดี: ภาพใหญ่ (96–112px) แตะ = viewer ใหญ่ · ★ ตั้งรูปหลัก (ออฟฟิศแก้ได้เสมอ ไม่ผูกกับช่างรับงาน) ·
// ลบรูปจากหน้างาน = บังคับเหตุผล (JobPhotoDeleteDialog requireReason · ชิปเหตุผล + พิมพ์เอง) — ใช้ action ออฟฟิศเดิม getJobPhotos/setPrimaryJobPhoto/removeJobPhoto
// ที่มา: ทุกรูปมาจากหน้างาน = caption เดียว "ถ่าย/ส่งโดย {ชื่อ} · {เวลา}" · มีหลายที่มา = ป้ายต่อภาพ (หน้างาน/ออฟฟิศ/แคตตาล็อก) — ไม่เปิดชื่อไฟล์/EXIF
// ปุ่ม "รับทราบ" ไม่ผูกกับรูป (รูปไม่ใช่ด่าน) — แถบนี้ล้ม/ว่าง ต้องไม่บล็อกการรับทราบ
// 4 state: loading (skeleton 3 ช่อง) · empty ("ผู้เปิดไม่ได้แนบรูปจากหน้างาน" บรรทัดเดียว) · error (โหลดไม่ได้ + ลองใหม่ · รูปเดียวพัง = แตะลองใหม่) · success
// 🔴 ไม่มีตัวเลขเงิน/ต้นทุน · type ของรูป (JobPhotoRow) ไม่มี path/ผู้อัปโหลด

import { useCallback, useEffect, useRef, useState } from "react";
import { getJobPhotos, removeJobPhoto, setPrimaryJobPhoto } from "@/lib/actions/job-photos";
import { JobPhotoDeleteDialog } from "@/components/domain/jobs/JobPhotoDeleteDialog";
import { JobPhotoManageBar } from "@/components/domain/jobs/JobPhotoManageBar";
import { JobPhotoThumb } from "@/components/domain/jobs/photos/JobPhotoThumb";
import { JobPhotoViewer } from "@/components/domain/jobs/photos/JobPhotoViewer";
import { useRefreshGate } from "@/components/domain/jobs/photos/useRefreshGate";
import type { PhotoView, RetryReason } from "@/components/domain/jobs/photos/types";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { formatBangkokTime } from "@/lib/format";
import { GENERIC_JOB_ERROR } from "@/lib/jobs/messages";
import { PHOTO_SOURCE_FROM_TH, photoSourceTag } from "@/lib/jobs/photos";
import type { JobPhotoRow } from "@/lib/jobs/photos";

export const MSG_STRIP_EMPTY = "ผู้เปิดไม่ได้แนบรูปจากหน้างาน";
export const MSG_STRIP_ERROR = "โหลดรูปไม่ได้ — ตรวจรูปที่หน้าใบงานได้";

/** รูปหลักขึ้นหน้า (loader เรียงแบบนี้อยู่แล้ว — ใช้ตอนแก้ในเครื่องแบบ optimistic) */
const primaryFirst = (l: readonly JobPhotoRow[]): JobPhotoRow[] => [...l.filter((p) => p.isPrimary), ...l.filter((p) => !p.isPrimary)];

export function ShopPhotosStrip({ jobId, jobNo, openedByName }: { jobId: string; jobNo: string; openedByName: string }) {
  const toast = useToast();
  const [photos, setPhotos] = useState<JobPhotoRow[] | null>(null);
  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const seq = useRef(0);
  const allowRefresh = useRefreshGate();

  const load = useCallback(
    async (silent: boolean) => {
      const n = ++seq.current;
      if (!silent) setState("loading");
      let r: Awaited<ReturnType<typeof getJobPhotos>> | null = null;
      try {
        r = await getJobPhotos(jobId);
      } catch {
        r = null;
      }
      if (!alive.current || n !== seq.current) return;
      if (r && r.ok) {
        setPhotos(r.data);
        setState("ready");
      } else if (!silent) setState("error");
    },
    [jobId],
  );

  useEffect(() => {
    alive.current = true;
    void load(false);
    return () => {
      alive.current = false;
    };
  }, [load]);

  // ลิงก์รูปหมดอายุ 15 นาที → ขอรายการใหม่ (อัตโนมัติ ≤ 2 ครั้ง · แตะ "ลองใหม่" ผ่านเสมอ)
  const refreshUrls = useCallback(
    (reason: RetryReason) => {
      if (!allowRefresh(reason)) return;
      void load(true);
    },
    [allowRefresh, load],
  );

  const list = photos ?? [];
  const shop = list.filter((p) => p.source === "shopfloor");
  const allShop = list.length > 0 && shop.length === list.length;
  const viewerIdx = viewerId ? list.findIndex((p) => p.id === viewerId) : -1;
  const deleting = deleteId ? list.find((p) => p.id === deleteId) : undefined;
  const firstTime = shop.map((p) => p.createdAt).filter((x): x is string => x !== null).sort()[0] ?? null;

  async function setPrimary(p: JobPhotoRow) {
    if (busy || p.isPrimary) return;
    const before = list;
    setPhotos(primaryFirst(list.map((x) => ({ ...x, isPrimary: x.id === p.id }))));
    setBusy(true);
    try {
      const r = await setPrimaryJobPhoto(p.id);
      if (!r.ok) {
        setPhotos(before);
        toast.push(r.error, "error");
      } else toast.push("ตั้งเป็นรูปหลักแล้ว");
    } catch {
      setPhotos(before);
      toast.push(GENERIC_JOB_ERROR, "error");
    } finally {
      setBusy(false);
    }
  }

  /** คืน null = ลบสำเร็จ · ข้อความ = ล้ม (แสดงในกล่องยืนยัน) */
  async function confirmDelete(p: JobPhotoRow, reason: string | null): Promise<string | null> {
    const r = reason === null ? await removeJobPhoto(p.id) : await removeJobPhoto(p.id, reason);
    if (!r.ok) return r.error;
    const at = list.findIndex((x) => x.id === p.id);
    const promoted = r.data.promotedPhotoId;
    const next = primaryFirst(list.filter((x) => x.id !== p.id).map((x) => (promoted && x.id === promoted ? { ...x, isPrimary: true } : x)));
    setPhotos(next);
    setDeleteId(null);
    setViewerId(next.length === 0 ? null : next[Math.min(at, next.length - 1)].id);
    toast.push("ลบรูปแล้ว");
    return null;
  }

  const views: PhotoView[] = list.map((p) => ({ id: p.id, smUrl: p.smUrl, mdUrl: p.mdUrl, isPrimary: p.isPrimary, fromCatalog: p.source === "product" }));

  return (
    <section aria-labelledby="shop-photos-strip-h" className="mt-3 rounded-md border border-zinc-300 bg-zinc-50 p-3">
      <h3 id="shop-photos-strip-h" className="text-sm font-semibold text-zinc-800">
        รูปจากหน้างาน{state === "ready" && shop.length > 0 ? ` · ${shop.length} รูป` : ""}
      </h3>

      {state === "loading" && (
        <div role="status" aria-label="กำลังโหลดรูป" className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(96px,112px))] gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="aspect-square" />
          ))}
        </div>
      )}

      {state === "error" && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <p role="status" className="text-sm text-zinc-800">
            {MSG_STRIP_ERROR}
          </p>
          <Button type="button" size="sm" variant="secondary" onClick={() => void load(false)}>
            ลองใหม่
          </Button>
        </div>
      )}

      {state === "ready" && shop.length === 0 && <p className="mt-1 text-sm text-zinc-600">{MSG_STRIP_EMPTY}</p>}

      {state === "ready" && shop.length > 0 && (
        <>
          <ul className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(96px,112px))] gap-2">
            {list.map((p, i) => (
              <li key={p.id}>
                <JobPhotoThumb
                  smUrl={p.smUrl}
                  size="tile"
                  isPrimary={p.isPrimary}
                  fromCatalog={p.source === "product"}
                  sourceTag={allShop ? null : photoSourceTag(p.source)}
                  label={`รูปที่ ${i + 1} จาก ${list.length} · ${p.isPrimary ? "รูปหลัก · " : ""}${allShop ? "" : `${PHOTO_SOURCE_FROM_TH[photoSourceTag(p.source)]} · `}แตะเพื่อดู`}
                  onClick={() => setViewerId(p.id)}
                  onRetryLoad={refreshUrls}
                />
              </li>
            ))}
          </ul>
          {allShop && (
            <p className="mt-2 text-xs text-zinc-700">
              ถ่าย/ส่งโดย {openedByName}
              {firstTime ? ` · ${formatBangkokTime(firstTime)}` : ""} (จากหน้างาน)
            </p>
          )}
        </>
      )}

      {viewerIdx >= 0 && (
        <JobPhotoViewer
          photos={views}
          index={viewerIdx}
          onIndexChange={(i) => setViewerId(list[i]?.id ?? null)}
          onClose={() => setViewerId(null)}
          title={jobNo}
          closeSize="office"
          onRetryLoad={refreshUrls}
          renderActions={({ index }) => {
            const p = list[index];
            if (!p) return null;
            return <JobPhotoManageBar isPrimary={p.isPrimary} canMoveBefore={false} canMoveAfter={false} showMove={false} busy={busy} onSetPrimary={() => void setPrimary(p)} onMove={() => undefined} onDelete={() => setDeleteId(p.id)} />;
          }}
        />
      )}
      {deleting && (
        <JobPhotoDeleteDialog
          jobNo={jobNo}
          count={list.length}
          isPrimary={deleting.isPrimary}
          fromCatalog={deleting.source === "product"}
          requireReason={deleting.source === "shopfloor"}
          onConfirm={(reason) => confirmDelete(deleting, reason)}
          onCancel={() => setDeleteId(null)}
        />
      )}
    </section>
  );
}
