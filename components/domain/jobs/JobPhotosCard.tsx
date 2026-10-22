"use client";

// JobPhotosCard — การ์ด "รูปงาน" บนหน้า /jobs/[id] (ออฟฟิศ owner/admin) · ux-job-photos.md §3.1-§3.4
// ชั้นเรียก action: อัปโหลด (ย่อก่อนส่งเสมอ · ทีละ 2 · ส่งทีละรูปทันที) · ตั้งรูปหลัก · เลื่อน · ลบ (ยืนยัน) · ดึงรูปจากแคตตาล็อก (กดเอง) · โหลดลิงก์ใหม่เมื่อหมดอายุ (15 นาที)
// ครบ 4 state: loading (skeleton ตอนโหลดรายการจาก client) · error (โหลดรายการไม่ได้ + ลองใหม่ · รูปพัง = แตะลองใหม่ · ส่งล้ม = แตะลองใหม่) · empty (ยังไม่มีรูป) · success
// ใบปิดแล้วเพิ่ม/ลบรูปได้ (มติเจ้าของ 19 ต.ค. 69 — ทับ ux D10) · รูปไม่ใช่ด่าน — ไม่บล็อกอะไร · server เป็นด่านจริง (เพดาน 5 · ใบแม่เท่านั้น · สิทธิ์) ปุ่มเป็นแค่ทางเลือกที่แสดง
// ชั้นแสดงผลล้วน (Thumb/Viewer/AddButtons) อยู่ components/domain/jobs/photos/ — การ์ดนี้เป็นตัวเดียวที่ import "use server" ของออฟฟิศ

import { useCallback, useEffect, useRef, useState } from "react";
import { ImageDown, ImageOff, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorBanner } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { JobPhotoDeleteDialog } from "@/components/domain/jobs/JobPhotoDeleteDialog";
import { JobPhotoManageBar } from "@/components/domain/jobs/JobPhotoManageBar";
import { JobPhotoUploadTile } from "@/components/domain/jobs/JobPhotoUploadTile";
import { useJobPhotoUploads } from "@/components/domain/jobs/useJobPhotoUploads";
import { JobPhotoThumb } from "@/components/domain/jobs/photos/JobPhotoThumb";
import { JobPhotoViewer } from "@/components/domain/jobs/photos/JobPhotoViewer";
import { PhotoAddButtons } from "@/components/domain/jobs/photos/PhotoAddButtons";
import { useRefreshGate } from "@/components/domain/jobs/photos/useRefreshGate";
import type { PhotoView, RetryReason } from "@/components/domain/jobs/photos/types";
import { getJobPhotos, pullJobPhotoFromCatalog, removeJobPhoto, reorderJobPhotos, setPrimaryJobPhoto, uploadJobPhoto } from "@/lib/actions/job-photos";
import { MAX_REFERENCE_PHOTOS } from "@/lib/images/constants";
import type { ImageVariants } from "@/lib/images/client";
import { GENERIC_JOB_ERROR } from "@/lib/jobs/messages";
import { PHOTO_SOURCE_FROM_TH, photoSourceTag } from "@/lib/jobs/photos";
import type { JobPhotoRow } from "@/lib/jobs/photos";

const toView = (p: JobPhotoRow): PhotoView => ({ id: p.id, smUrl: p.smUrl, mdUrl: p.mdUrl, isPrimary: p.isPrimary, fromCatalog: p.source === "product" });

/** รูปหลักขึ้นหน้า (loader เรียงแบบนี้อยู่แล้ว — ใช้ตอนแก้ในเครื่องแบบ optimistic) */
function primaryFirst(list: readonly JobPhotoRow[]): JobPhotoRow[] {
  return [...list.filter((p) => p.isPrimary), ...list.filter((p) => !p.isPrimary)];
}

/** เรียงรูปตามลำดับ id ที่ให้ (รูปที่ไม่อยู่ในรายการ เช่นเพิ่งอัปเสร็จระหว่างนั้น ต่อท้าย — ไม่หาย) */
function orderBy(list: readonly JobPhotoRow[], ids: readonly string[]): JobPhotoRow[] {
  const at = new Map(ids.map((id, i) => [id, i]));
  return [...list].sort((a, b) => (at.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (at.get(b.id) ?? Number.MAX_SAFE_INTEGER));
}

/** แทรกรูปที่ server ตอบกลับ: รูปหลักใหม่ล้างธงของเดิม · id ซ้ำ = แทนที่ */
function withRow(list: readonly JobPhotoRow[], row: JobPhotoRow): JobPhotoRow[] {
  const rest = list.filter((p) => p.id !== row.id).map((p) => (row.isPrimary ? { ...p, isPrimary: false } : p));
  return primaryFirst([...rest, row]);
}

export function JobPhotosCard({
  jobId,
  jobNo,
  sku,
  sourceKind,
  activeTokens,
  photos: initial,
}: {
  jobId: string;
  jobNo: string;
  sku: string | null;
  sourceKind: string;
  /** QR ที่ใช้งานอยู่ — > 0 = เคยพิมพ์ใบแล้ว (กระดาษใบนั้นไม่มีรูปที่เพิ่มทีหลัง) */
  activeTokens: number;
  /** undefined = อ่านรูปไม่ได้ (ไม่ใช่ "ไม่มีรูป") */
  photos: JobPhotoRow[] | undefined;
}) {
  const toast = useToast();
  const [photos, setPhotos] = useState<JobPhotoRow[] | null>(initial ?? null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [manageBusy, setManageBusy] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [wasOffline, setWasOffline] = useState(false);

  // server ส่งข้อมูลใหม่มา (revalidate หลัง action / router.refresh) = ใช้ของ server แทน
  useEffect(() => {
    setPhotos(initial ?? null);
    if (initial) setLoadError(null);
  }, [initial]);

  const send = useCallback(
    async (v: ImageVariants) => {
      const fd = new FormData();
      fd.set("jobId", jobId);
      fd.set("md", v.md.blob, "md.jpg");
      fd.set("sm", v.sm.blob, "sm.jpg");
      return uploadJobPhoto(fd);
    },
    [jobId],
  );
  const onUploaded = useCallback((row: JobPhotoRow) => setPhotos((prev) => withRow(prev ?? [], row)), []);
  const up = useJobPhotoUploads({ send, onUploaded });

  const failedRetryable = up.items.filter((i) => i.phase === "error" && i.retryable);
  // เคยหลุดเน็ต → จำไว้จนกว่าเน็ตกลับมาและไม่มีรูปล้มค้างแล้ว (ขณะออฟไลน์ไม่ล้าง — ไม่งั้นแถบ "เน็ตกลับมาแล้ว" ไม่เคยขึ้น)
  const failedCount = failedRetryable.length;
  useEffect(() => {
    if (!up.online) setWasOffline(true);
    else if (failedCount === 0) setWasOffline(false);
  }, [up.online, failedCount]);

  // ---------- ลิงก์รูปหมดอายุ 15 นาที → โหลดรายการใหม่ (รูปพัง/แตะลองใหม่) ----------
  // อัตโนมัติ ≤ 2 ครั้ง (ห่าง ≥ 10 วินาที) จนผู้ใช้แตะ "ลองใหม่" แล้วรีเซ็ต — กันวนเมื่อรูปพังด้วยเหตุอื่นที่ไม่ใช่ลิงก์หมดอายุ (useRefreshGate)
  const allowRefresh = useRefreshGate();
  const refreshing = useRef(false);
  const refreshUrls = useCallback(
    async (reason: RetryReason) => {
      if (refreshing.current) return;
      if (!allowRefresh(reason)) return;
      refreshing.current = true;
      try {
        const r = await getJobPhotos(jobId);
        if (r.ok) setPhotos(r.data);
        else if (reason === "tap") toast.push(r.error, "error");
      } catch {
        if (reason === "tap") toast.push(GENERIC_JOB_ERROR, "error");
      } finally {
        refreshing.current = false;
      }
    },
    [jobId, toast, allowRefresh],
  );

  /** อ่านรายการจริงจาก server (ล้มแล้วคืน null — ไม่ throw) */
  async function fetchPhotos(): Promise<JobPhotoRow[] | null> {
    try {
      const r = await getJobPhotos(jobId);
      return r.ok ? r.data : null;
    } catch {
      return null;
    }
  }

  /**
   * S1: แก้แบบ optimistic ล้ม → ห้ามเอา snapshot เก่าทับทั้งรายการ (รูปที่เพิ่งอัปเสร็จระหว่างรอจะหาย) · ทางหลัก = อ่านจาก server ใหม่
   * อ่านไม่ได้ = ย้อนเฉพาะธงรูปหลัก+ลำดับของรูปที่มีใน snapshot (รูปใหม่คงอยู่)
   */
  async function recover(before: readonly JobPhotoRow[]) {
    const fresh = await fetchPhotos();
    if (fresh) {
      setPhotos(fresh);
      return;
    }
    const flag = new Map(before.map((p) => [p.id, p.isPrimary]));
    setPhotos((prev) => orderBy((prev ?? []).map((x) => (flag.has(x.id) ? { ...x, isPrimary: flag.get(x.id) as boolean } : x)), before.map((p) => p.id)));
  }

  /** โหลดรายการไม่ได้ตั้งแต่แรก (photos undefined) → ปุ่ม "ลองใหม่" ของแถบแดง */
  async function reload() {
    setLoading(true);
    setLoadError(null);
    try {
      const r = await getJobPhotos(jobId);
      if (r.ok) setPhotos(r.data);
      else setLoadError(r.error);
    } catch {
      setLoadError(GENERIC_JOB_ERROR);
    } finally {
      setLoading(false);
    }
  }

  const list = photos ?? [];
  const slots = list.length + up.items.filter((i) => i.phase !== "error").length;
  const remaining = Math.max(0, MAX_REFERENCE_PHOTOS - slots);
  const cap = photos !== null && remaining === 0;

  function onFiles(files: File[]) {
    if (photos === null || remaining === 0) return;
    const accepted = files.slice(0, remaining);
    const cut = files.length - accepted.length;
    setNotice(cut > 0 ? `เลือกมา ${files.length} รูป ใส่ได้อีก ${remaining} รูป — ตัด ${cut} รูปท้ายออก` : null);
    up.enqueue(accepted);
  }

  // ---------- จัดการรูป (optimistic + rollback) ----------
  async function setPrimary(p: JobPhotoRow) {
    if (manageBusy || p.isPrimary) return;
    const before = list;
    setPhotos((prev) => primaryFirst((prev ?? []).map((x) => ({ ...x, isPrimary: x.id === p.id }))));
    setManageBusy(true);
    try {
      const r = await setPrimaryJobPhoto(p.id);
      if (!r.ok) {
        await recover(before);
        toast.push(r.error, "error");
      } else toast.push("ตั้งเป็นรูปหลักแล้ว");
    } catch {
      await recover(before);
      toast.push(GENERIC_JOB_ERROR, "error");
    } finally {
      setManageBusy(false);
    }
  }

  async function move(p: JobPhotoRow, dir: -1 | 1) {
    if (manageBusy) return;
    const head = list.filter((x) => x.isPrimary);
    const rest = list.filter((x) => !x.isPrimary);
    const k = rest.findIndex((x) => x.id === p.id);
    const to = k + dir;
    if (k < 0 || to < 0 || to >= rest.length) return;
    [rest[k], rest[to]] = [rest[to], rest[k]];
    const next = [...head, ...rest];
    const before = list;
    const ids = next.map((x) => x.id);
    setPhotos((prev) => orderBy(prev ?? [], ids));
    setManageBusy(true);
    try {
      const r = await reorderJobPhotos(jobId, ids);
      if (!r.ok) {
        await recover(before);
        toast.push(r.error, "error");
      }
    } catch {
      await recover(before);
      toast.push(GENERIC_JOB_ERROR, "error");
    } finally {
      setManageBusy(false);
    }
  }

  /** คืน null = ลบสำเร็จ · ข้อความ = ล้ม (แสดงในกล่องยืนยัน) · reason มีเฉพาะรูปจากหน้างาน (บังคับเหตุผล — กล่องตรวจก่อนส่ง) · ไม่มี = เรียกเหมือนเดิมเป๊ะ */
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

  async function pull() {
    if (pulling) return;
    setPulling(true);
    try {
      const r = await pullJobPhotoFromCatalog(jobId);
      if (r.ok) {
        setPhotos((prev) => withRow(prev ?? [], r.data));
        toast.push("ดึงรูปจากแคตตาล็อกแล้ว");
      } else toast.push(r.error, "error");
    } catch {
      toast.push(GENERIC_JOB_ERROR, "error");
    } finally {
      setPulling(false);
    }
  }

  const viewerIdx = viewerId ? list.findIndex((p) => p.id === viewerId) : -1;
  const deleting = deleteId ? list.find((p) => p.id === deleteId) : undefined;
  const canPull = sku !== null && photos !== null && remaining > 0 && !list.some((p) => p.source === "product");
  // 0189 W2: ใบมีรูปจากหน้างาน + ที่มาอื่นปนกัน = ป้ายที่มาต่อภาพ (ออฟฟิศต้องแยกรูปของผู้จัดการออกจากรูปที่ตัวเองถ่าย) · ไม่มีรูปหน้างาน = พฤติกรรมเดิม (ป้าย "จากแคตตาล็อก" อย่างเดียว)
  const mixedSources = list.some((p) => p.source === "shopfloor") && new Set(list.map((p) => p.source)).size > 1;
  const tagOf = (p: JobPhotoRow) => (mixedSources ? photoSourceTag(p.source) : null);

  const inflight = up.items.filter((i) => i.phase !== "error").length;
  const failed = up.items.length - inflight;
  const liveText = inflight > 0 ? `กำลังส่งรูป ${inflight} รูป` : failed > 0 ? `ส่งไม่สำเร็จ ${failed} รูป` : "";

  // ข้อความช่วยบรรทัดเดียว (ลำดับความสำคัญบน→ล่าง · ไม่มีเน็ตเป็นแถบแยกด้านบน)
  const help =
    activeTokens > 0 && list.length > 0
      ? "ใบกระดาษที่พิมพ์ไปแล้วอาจไม่มีรูปหลัก (ถ้าเพิ่มรูปหลังพิมพ์) — ช่างดูรูปจากมือถือ (สแกน QR) ได้ทันที · ถ้าต้องการให้กระดาษมีรูปต้องพิมพ์ใหม่ (QR ใบเก่าจะใช้ไม่ได้)"
      : sourceKind === "oem"
        ? "รูปนี้ช่างทุกขั้นเห็นผ่าน QR และพิมพ์บนใบงาน"
        : null;

  return (
    <section id="job-photos" aria-labelledby="job-photos-h" className="scroll-mt-4 space-y-3 rounded-lg border border-zinc-200 bg-white p-4 max-lg:order-first">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="job-photos-h" className="text-lg font-bold text-zinc-900">
          รูปงาน
        </h2>
        {photos !== null && (
          <span className="text-sm font-medium text-zinc-800 tabular-nums" aria-label={`${slots} จาก ${MAX_REFERENCE_PHOTOS} รูป`}>
            {slots}/{MAX_REFERENCE_PHOTOS}
          </span>
        )}
      </div>
      <p className="text-sm text-zinc-700">ช่างเห็นรูปนี้บนมือถือ · รูปแรกพิมพ์บนใบ A5</p>

      <p role="status" aria-live="polite" className="sr-only">
        {liveText}
      </p>

      {!up.online && (
        <p role="status" className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-sm font-medium text-amber-900">
          <WifiOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          ไม่มีอินเทอร์เน็ต — ส่งรูปไม่ได้ตอนนี้ รูปที่ถ่ายไว้ค้างอยู่ในหน้านี้ ห้ามปิดหน้า
        </p>
      )}
      {up.online && wasOffline && failedRetryable.length > 0 && (
        <div role="status" className="flex flex-wrap items-center gap-2 rounded-md border border-green-300 bg-green-50 p-2.5 text-sm font-medium text-green-900">
          เน็ตกลับมาแล้ว — แตะรูปสีแดงเพื่อส่งใหม่
          {failedRetryable.length >= 2 && (
            <Button type="button" variant="secondary" onClick={() => up.retryAll(failedRetryable.map((i) => i.id))}>
              ส่งใหม่ทั้งหมด ({failedRetryable.length} รูป)
            </Button>
          )}
        </div>
      )}
      {up.busy && <p className="text-sm font-medium text-amber-900">ยังมีรูปที่ส่งไม่เสร็จ — อย่าปิดหน้านี้</p>}

      {photos === null ? (
        loading ? (
          <div role="status" aria-label="กำลังโหลดรูป" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="aspect-square" />
            ))}
          </div>
        ) : (
          <ErrorBanner message={loadError ?? "โหลดรูปงานไม่ได้ — หน้าใบงานส่วนอื่นยังใช้ได้"} onRetry={() => void reload()} />
        )
      ) : (
        <>
          {cap ? (
            <p role="status" className="rounded-md bg-zinc-100 p-2.5 text-sm font-semibold text-zinc-900">
              ครบ {MAX_REFERENCE_PHOTOS} รูปแล้ว — ลบรูปก่อนถ้าจะเพิ่ม
            </p>
          ) : (
            <PhotoAddButtons onFiles={onFiles} />
          )}
          {canPull && (
            <Button type="button" variant="secondary" onClick={() => void pull()} loading={pulling} className="w-full sm:w-auto">
              <ImageDown className="h-4 w-4" aria-hidden="true" />
              ดึงรูปจากแคตตาล็อก ({sku})
            </Button>
          )}
          {notice && (
            <p role="status" className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-sm font-medium text-amber-900">
              {notice}
            </p>
          )}
          {help && <p className="text-sm text-zinc-700">{help}</p>}

          {list.length === 0 && up.items.length === 0 ? (
            <EmptyState
              icon={ImageOff}
              title="ยังไม่มีรูปงาน"
              description={sku === null ? "สินค้าใหม่ไม่มีรหัส — ถ่ายรูปให้ช่างรู้ว่าทำชิ้นไหน" : "ถ่ายรูปชิ้นงานให้ช่างดูว่าทำถูกชิ้น (รูปไม่บังคับ)"}
            />
          ) : (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {list.map((p, i) => (
                <li key={p.id}>
                  <JobPhotoThumb
                    smUrl={p.smUrl}
                    size="tile"
                    isPrimary={p.isPrimary}
                    fromCatalog={p.source === "product"}
                    sourceTag={tagOf(p)}
                    label={`รูปที่ ${i + 1} จาก ${list.length} · ${p.isPrimary ? "รูปหลัก · " : ""}แตะเพื่อดู${tagOf(p) ? ` · ${PHOTO_SOURCE_FROM_TH[photoSourceTag(p.source)]}` : p.source === "product" ? " · จากแคตตาล็อก" : ""}`}
                    onClick={() => setViewerId(p.id)}
                    onRetryLoad={(r) => void refreshUrls(r)}
                  />
                </li>
              ))}
              {up.items.map((it) => (
                <li key={it.id}>
                  <JobPhotoUploadTile item={it} onRetry={() => up.retry(it.id)} onRemove={() => up.remove(it.id)} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {viewerIdx >= 0 && (
        <JobPhotoViewer
          photos={list.map(toView)}
          index={viewerIdx}
          onIndexChange={(i) => setViewerId(list[i]?.id ?? null)}
          onClose={() => setViewerId(null)}
          title={jobNo}
          closeSize="office"
          onRetryLoad={(r) => void refreshUrls(r)}
          renderActions={({ index }) => {
            const p = list[index];
            if (!p) return null;
            const rest = list.filter((x) => !x.isPrimary);
            const k = rest.findIndex((x) => x.id === p.id);
            return <JobPhotoManageBar isPrimary={p.isPrimary} canMoveBefore={k > 0} canMoveAfter={k >= 0 && k < rest.length - 1} busy={manageBusy} onSetPrimary={() => void setPrimary(p)} onMove={(d) => void move(p, d)} onDelete={() => setDeleteId(p.id)} />;
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
