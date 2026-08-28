"use client";

import { useCallback, useRef, useState } from "react";
import { UploadCloud } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorBanner } from "@/components/ui/ErrorState";
import { useToast } from "@/components/ui/Toast";
import { createLabelUpload, parseLabelFile } from "@/lib/actions/labels";
import type { LabelParseSummary } from "@/lib/labels/types";
import { ACCEPTED_EXTENSIONS, MAX_FILE_SIZE_BYTES, formatFileSize } from "@/lib/labels/constants-ui";
import { sha256Hex } from "@/lib/labels/sha256-client";
import type { UploadQueueItem } from "@/lib/tiktok/types";
import { UploadDropzone } from "./UploadDropzone";
import { UploadQueueList } from "./UploadQueueList";
import { BatchSummaryCard } from "./BatchSummaryCard";
import { ReviewQueueList } from "./ReviewQueueList";
import { LabelFileHistory } from "./LabelFileHistory";
import { PendingReviewQueue } from "./PendingReviewQueue";

interface RejectedFile {
  id: string;
  name: string;
  reason: string;
}

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}-${Date.now()}`;
}

function messageFromError(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

/**
 * UploadPageClient — /tiktok/upload, REAL flow (docs/3j-jewelry/analytics/
 * design-label-upload.md §3/§8). Per file: validate → sha256 (crypto.subtle)
 * → createLabelUpload() → PUT to signed Storage URL (skipped when the file
 * already exists by hash) → parseLabelFile() → per-file summary + read-only
 * review table.
 *
 * lib/actions/labels.ts is still a STUB on this branch (throws — backend
 * lands on feat/label-upload-backend and gets merged separately) — every
 * action call below is wrapped in try/catch so that throw surfaces as the
 * exact same "failed" queue state + retry button a real network/server
 * error would, with no special-casing. There is deliberately no "(จำลอง)"
 * banner here anymore (design §8: no half-real/half-fake state) — a failed
 * item because the backend isn't wired yet is an honest error, not a mock.
 *
 * Files queue and process ONE AT A TIME (never parallel — design brief
 * "คิวไล่ทีละไฟล์ ไม่ยิง parse พร้อมกันหมด"), via pendingRef/processingRef
 * below rather than Promise.all.
 */
export function UploadPageClient() {
  const toast = useToast();
  const [queue, setQueue] = useState<UploadQueueItem[]>([]);
  const [rejected, setRejected] = useState<RejectedFile[]>([]);
  // Bumped after every successful parse so <PendingReviewQueue /> (bug 2 fix
  // — the durable, shop-wide review queue read from stg_label_page) reloads
  // right away instead of only after the owner leaves and returns to this page.
  const [reviewRefreshSignal, setReviewRefreshSignal] = useState(0);

  // File objects never go into React state (large binary blobs, and we only
  // ever need them keyed by item id for processing/retry) — kept in a ref map instead.
  const fileMapRef = useRef<Map<string, File>>(new Map());
  const pendingRef = useRef<string[]>([]);
  const processingRef = useRef(false);

  const updateItem = useCallback((id: string, patch: Partial<UploadQueueItem>) => {
    setQueue((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const processOneFile = useCallback(
    async (id: string, file: File) => {
      try {
        updateItem(id, { status: "preparing", metaText: `${formatFileSize(file.size)} · กำลังคำนวณ hash…`, errorText: undefined });
        const sha256 = await sha256Hex(file);

        const createResult = await createLabelUpload({ fileName: file.name, fileSize: file.size, sha256 });
        if (!createResult.ok) {
          updateItem(id, { status: "failed", errorText: createResult.error, metaText: createResult.error });
          return;
        }
        const { fileId, uploadUrl, alreadyExists } = createResult.data;
        updateItem(id, { fileId, alreadyExists });

        if (alreadyExists) {
          toast.push(`${file.name} — ไฟล์นี้เคยอัปแล้ว อ่านซ้ำจากไฟล์เดิม`);
          updateItem(id, { metaText: "ไฟล์นี้เคยอัปแล้ว — อ่านซ้ำจากไฟล์เดิม" });
        } else if (uploadUrl) {
          updateItem(id, { status: "uploading", metaText: `${formatFileSize(file.size)} · กำลังอัปโหลด…` });
          const putRes = await fetch(uploadUrl, {
            method: "PUT",
            body: file,
            headers: { "Content-Type": "application/pdf" },
          });
          if (!putRes.ok) {
            const msg = `อัปโหลดไม่สำเร็จ (HTTP ${putRes.status})`;
            updateItem(id, { status: "failed", errorText: msg, metaText: msg });
            return;
          }
        } else {
          // Contract says uploadUrl is only null when alreadyExists is true
          // (lib/labels/types.ts) — defend against a backend bug rather than
          // silently trying to parse a file that was never uploaded.
          const msg = "ระบบไม่ได้ส่งลิงก์อัปโหลดกลับมา";
          updateItem(id, { status: "failed", errorText: msg, metaText: msg });
          return;
        }

        updateItem(id, { status: "parsing", metaText: "กำลังอ่านไฟล์…" });
        const parseResult = await parseLabelFile(fileId);
        if (!parseResult.ok) {
          updateItem(id, { status: "failed", errorText: parseResult.error, metaText: parseResult.error });
          return;
        }

        const summary: LabelParseSummary = parseResult.data;
        updateItem(id, {
          status: "done",
          metaText: `${summary.pageCount} หน้า · เสร็จแล้ว`,
          summary,
        });
        setReviewRefreshSignal((n) => n + 1);
        toast.push(`อ่าน ${file.name} เสร็จแล้ว — เติมจังหวัด ${summary.applied} ออเดอร์`);
      } catch (err) {
        const msg = messageFromError(err, "เกิดข้อผิดพลาดไม่ทราบสาเหตุ");
        updateItem(id, { status: "failed", errorText: msg, metaText: msg });
      }
    },
    [toast, updateItem]
  );

  const drainQueue = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    try {
      while (pendingRef.current.length > 0) {
        const id = pendingRef.current.shift();
        if (!id) continue;
        const file = fileMapRef.current.get(id);
        if (!file) continue;
        await processOneFile(id, file);
      }
    } finally {
      processingRef.current = false;
    }
  }, [processOneFile]);

  const handleFilesSelected = useCallback(
    (files: File[]) => {
      const accepted: { item: UploadQueueItem; file: File }[] = [];
      const newRejections: RejectedFile[] = [];

      for (const file of files) {
        const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
        if (!ACCEPTED_EXTENSIONS.includes(ext)) {
          newRejections.push({ id: nextId("rejected"), name: file.name, reason: "ชนิดไฟล์ไม่รองรับ (รับ PDF เท่านั้น)" });
          continue;
        }
        if (file.size > MAX_FILE_SIZE_BYTES) {
          newRejections.push({ id: nextId("rejected"), name: file.name, reason: `ไฟล์ใหญ่เกิน 20MB (${formatFileSize(file.size)})` });
          continue;
        }
        const id = nextId("upload-item");
        accepted.push({
          item: { id, fileName: file.name, metaText: `${formatFileSize(file.size)} · รอคิว…`, status: "preparing" },
          file,
        });
      }

      // Client-side type/size validation is instant — rejects surface right
      // away, never waiting on the (queued) upload round-trip below.
      if (newRejections.length > 0) {
        setRejected((prev) => [...prev, ...newRejections]);
      }
      if (accepted.length === 0) return;

      for (const { item, file } of accepted) {
        fileMapRef.current.set(item.id, file);
      }
      setQueue((prev) => [...prev, ...accepted.map((a) => a.item)]);
      pendingRef.current.push(...accepted.map((a) => a.item.id));
      void drainQueue();
    },
    [drainQueue]
  );

  const handleRetryItem = useCallback(
    (id: string) => {
      const file = fileMapRef.current.get(id);
      if (!file) return;
      // Re-run the ENTIRE pipeline from scratch (hash → create → upload →
      // parse) — never reuse the previous attempt's fileId/summary as a
      // shortcut ("จำบั๊ก cache-null": a failed retry must hit the network for
      // real, not silently resolve from stale state).
      updateItem(id, { status: "preparing", errorText: undefined, summary: undefined, metaText: `${formatFileSize(file.size)} · รอคิว…` });
      pendingRef.current.push(id);
      void drainQueue();
    },
    [drainQueue, updateItem]
  );

  const hasAnyActivity = queue.length > 0 || rejected.length > 0;
  const doneItems = queue.filter((item) => item.status === "done" && item.summary);

  return (
    <div className="space-y-4">
      <UploadDropzone onFilesSelected={handleFilesSelected} />

      {rejected.length > 0 && (
        <div className="flex flex-col gap-2">
          {rejected.map((r) => (
            <ErrorBanner
              key={r.id}
              message={`${r.name} — ${r.reason}`}
              onRetry={() => setRejected((prev) => prev.filter((x) => x.id !== r.id))}
            />
          ))}
        </div>
      )}

      {queue.length > 0 && (
        <section aria-label="คิวอัปโหลด">
          <p className="mb-2 text-xs font-bold tracking-wide text-zinc-400 uppercase">ไฟล์ในคิว</p>
          <UploadQueueList items={queue} onRetry={handleRetryItem} />
        </section>
      )}

      {doneItems.map((item) => {
        const summary = item.summary as LabelParseSummary;
        return (
          <section key={item.id} aria-label={`สรุปผลอ่านไฟล์ ${item.fileName}`} className="space-y-2">
            <p className="text-xs font-bold tracking-wide text-zinc-400 uppercase">สรุป — {item.fileName}</p>
            <BatchSummaryCard summary={summary} />
            {summary.reviewRows.length > 0 && (
              <>
                <p className="mt-1 text-xs font-bold tracking-wide text-zinc-400 uppercase">รอตรวจสอบ ({summary.reviewRows.length})</p>
                <ReviewQueueList rows={summary.reviewRows} />
              </>
            )}
          </section>
        );
      })}

      {!hasAnyActivity && (
        <EmptyState icon={UploadCloud} title="ยังไม่มีไฟล์วันนี้" description="ลากไฟล์ใบปะหน้ามาวาง หรือกดเลือกไฟล์ด้านบน" />
      )}

      <PendingReviewQueue refreshSignal={reviewRefreshSignal} />

      <LabelFileHistory />
    </div>
  );
}
