"use client";

import { useCallback, useState } from "react";
import { AlertTriangle, PartyPopper, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorBanner } from "@/components/ui/ErrorState";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import type { UploadBatchSummary, UploadQueueItem, UploadReviewRow } from "@/lib/tiktok/types";
import {
  ACCEPTED_EXTENSIONS,
  MAX_FILE_SIZE_BYTES,
  buildInitialQueue,
  buildMockResult,
  formatFileSize,
  mergeBatchSummary,
  shouldMockFail,
} from "@/lib/tiktok/upload-simulation";
import { UploadDropzone } from "./UploadDropzone";
import { UploadQueueList } from "./UploadQueueList";
import { UploadQueueSkeleton } from "./UploadQueueSkeleton";
import { BatchSummaryCard } from "./BatchSummaryCard";
import { ReviewQueueList } from "./ReviewQueueList";

interface RejectedFile {
  id: string;
  name: string;
  reason: string;
}

let rejectedIdCounter = 0;
function nextRejectedId(): string {
  rejectedIdCounter += 1;
  return `rejected-${rejectedIdCounter}`;
}

/**
 * UploadPageClient — Phase 1 has NO real parser/backend yet (design §8 open
 * question #1 is still unresolved: OCR/LLM-vision vs. template+regex, which
 * changes the whole latency model). Every state transition here is
 * simulated client-side (lib/tiktok/upload-simulation.ts) — the mandatory
 * "ระบบอ่านไฟล์ยังไม่เปิดใช้งาน (จำลอง)" notice below is the single highest-
 * risk mitigation the design doc calls out (§ ความเสี่ยง: "ต้อง label ชัด...
 * กันลากไฟล์จริงแล้วคิดว่าบันทึกแล้ว").
 */
export function UploadPageClient() {
  const toast = useToast();
  const [queue, setQueue] = useState<UploadQueueItem[]>([]);
  const [rejected, setRejected] = useState<RejectedFile[]>([]);
  const [summary, setSummary] = useState<UploadBatchSummary | null>(null);
  const [reviewQueue, setReviewQueue] = useState<UploadReviewRow[]>([]);
  const [validating, setValidating] = useState(false);
  const [confirmAllOpen, setConfirmAllOpen] = useState(false);

  const animateItem = useCallback((id: string, willFail: boolean, delayOffset: number, onSettle?: () => void) => {
    const steps = [30, 65, 100];
    steps.forEach((pct, i) => {
      window.setTimeout(
        () => {
          setQueue((prev) =>
            prev.map((item): UploadQueueItem => {
              if (item.id !== id) return item;
              if (pct < 100) {
                return { ...item, status: "parsing", progressPct: pct, metaText: `กำลังอ่าน… ${pct}%` };
              }
              if (willFail) {
                return {
                  ...item,
                  status: "failed",
                  progressPct: undefined,
                  metaText: "อ่านไม่ออก — ภาพเบลอเกินไป (จำลอง)",
                  errorText: "อ่านไม่ออก — ภาพเบลอเกินไป (จำลอง)",
                };
              }
              return { ...item, status: "done", progressPct: undefined, metaText: "อ่านสำเร็จ (จำลอง)" };
            })
          );
          if (pct === 100) onSettle?.();
        },
        delayOffset + i * 350
      );
    });
  }, []);

  const handleFilesSelected = useCallback(
    (fileList: FileList) => {
      const files = Array.from(fileList);
      const accepted: File[] = [];
      const newRejections: RejectedFile[] = [];

      for (const file of files) {
        const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
        if (!ACCEPTED_EXTENSIONS.includes(ext)) {
          newRejections.push({ id: nextRejectedId(), name: file.name, reason: "ชนิดไฟล์ไม่รองรับ (รับ PDF/JPG/PNG เท่านั้น)" });
          continue;
        }
        if (file.size > MAX_FILE_SIZE_BYTES) {
          newRejections.push({ id: nextRejectedId(), name: file.name, reason: `ไฟล์ใหญ่เกิน 20MB (${formatFileSize(file.size)})` });
          continue;
        }
        accepted.push(file);
      }

      // Client-side type/size validation is instant — rejects surface right
      // away, never waiting on the (simulated) "queued" round-trip below
      // (design §3: "reject เร็ว ไม่รอ round-trip").
      if (newRejections.length > 0) {
        setRejected((prev) => [...prev, ...newRejections]);
      }
      if (accepted.length === 0) return;

      setValidating(true);
      window.setTimeout(() => {
        setValidating(false);
        const newItems = buildInitialQueue(accepted);
        setQueue((prev) => [...prev, ...newItems]);

        newItems.forEach((item, i) => animateItem(item.id, shouldMockFail(i), i * 250));

        const totalDurationMs = newItems.length * 250 + 3 * 350 + 150;
        window.setTimeout(() => {
          const outcomes = newItems.map((_, i): "failed" | "done" => (shouldMockFail(i) ? "failed" : "done"));
          const batchResult = buildMockResult(outcomes);
          setSummary((prev) => mergeBatchSummary(prev, batchResult.summary));
          setReviewQueue((prev) => [...prev, ...batchResult.reviewQueue]);
          toast.push(`ประมวลผล ${newItems.length} ไฟล์เสร็จแล้ว (จำลอง)`);
        }, totalDurationMs);
      }, 300);
    },
    [animateItem, toast]
  );

  const handleRetryItem = useCallback(
    (id: string) => {
      setQueue((prev) =>
        prev.map((item): UploadQueueItem =>
          item.id === id ? { ...item, status: "parsing", progressPct: 0, metaText: "กำลังอ่านใหม่…" } : item
        )
      );
      animateItem(id, false, 0, () => {
        setSummary((prev) => (prev ? { ...prev, failed: Math.max(prev.failed - 1, 0), success: prev.success + 1 } : prev));
        toast.push("อัปโหลดใหม่สำเร็จ (จำลอง)");
      });
    },
    [animateItem, toast]
  );

  const handleConfirmRow = useCallback(
    (id: string) => {
      setReviewQueue((prev) => prev.filter((r) => r.id !== id));
      toast.push("ยืนยันแถวเรียบร้อย (จำลอง)");
    },
    [toast]
  );

  const handleConfirmAll = useCallback(() => {
    setReviewQueue([]);
    setConfirmAllOpen(false);
    toast.push("ยืนยันรายการที่เหลือทั้งหมดแล้ว (จำลอง)");
  }, [toast]);

  const hasAnyActivity = queue.length > 0 || rejected.length > 0;

  return (
    <div className="space-y-4">
      <p className="flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        ระบบอ่านไฟล์ยังไม่เปิดใช้งาน (จำลอง) — ไฟล์ที่ลากมาจะไม่ถูกอัปโหลด/บันทึกจริง หน้านี้ใช้ดู UI เท่านั้น
      </p>

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

      {validating && <UploadQueueSkeleton />}

      {!validating && queue.length > 0 && (
        <section aria-label="คิวอัปโหลด">
          <p className="mb-2 text-xs font-bold tracking-wide text-zinc-400 uppercase">ไฟล์ในคิว</p>
          <UploadQueueList items={queue} onRetry={handleRetryItem} />
        </section>
      )}

      {summary && (
        <section aria-label="สรุปผลอัปโหลด">
          <p className="mb-2 text-xs font-bold tracking-wide text-zinc-400 uppercase">สรุปรอบนี้</p>
          <BatchSummaryCard summary={summary} />
        </section>
      )}

      {reviewQueue.length > 0 && (
        <section aria-label="รายการรอตรวจสอบ">
          <p className="mb-2 text-xs font-bold tracking-wide text-zinc-400 uppercase">รอตรวจสอบก่อนบันทึก</p>
          <ReviewQueueList rows={reviewQueue} onConfirm={handleConfirmRow} />
          <p className="mt-3 text-center text-xs text-zinc-500">
            เหลือรอตรวจสอบ <span className="font-bold text-zinc-700">{reviewQueue.length}</span> รายการ
          </p>
          <Button variant="primary" className="mt-2 w-full" onClick={() => setConfirmAllOpen(true)}>
            ยืนยันทั้งหมดที่เหลือ
          </Button>
        </section>
      )}

      {summary && reviewQueue.length === 0 && (
        <p className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-green-300 bg-green-50 px-4 py-3 text-center text-sm text-green-800">
          <PartyPopper className="h-4 w-4 shrink-0" aria-hidden="true" />
          ตรวจสอบครบแล้ว — บันทึกออเดอร์เรียบร้อย (จำลอง)
        </p>
      )}

      {!hasAnyActivity && !validating && (
        <EmptyState icon={UploadCloud} title="ยังไม่มีไฟล์วันนี้" description="ลากไฟล์ใบปะหน้ามาวาง หรือกดเลือกไฟล์ด้านบน" />
      )}

      <Modal open={confirmAllOpen} onClose={() => setConfirmAllOpen(false)} title="ยืนยันทั้งหมดที่เหลือ?">
        <p className="text-sm text-zinc-600">
          จะยืนยัน {reviewQueue.length} รายการที่เหลือทั้งหมดโดยไม่แก้ไขทีละแถว — ตรวจสอบแล้วว่าข้อมูลถูกต้องก่อนกดยืนยัน
          (การกระทำนี้เป็นการจำลอง ไม่มีข้อมูลถูกบันทึกจริง)
        </p>
        <div className="mt-4 flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => setConfirmAllOpen(false)}>
            ยกเลิก
          </Button>
          <Button variant="primary" className="flex-1" onClick={handleConfirmAll}>
            ยืนยันทั้งหมด
          </Button>
        </div>
      </Modal>

      <p className="border-t border-zinc-200 pt-3 text-xs leading-relaxed text-zinc-400">
        <span className="font-medium text-zinc-500">อัปโหลดใบปะหน้า</span> — หน้านี้จำลอง state ทั้งหมด (MOCK, ยังไม่ต่อ parser
        จริง) · ไฟล์พัง (parse fail) แยกจาก &quot;รอ review&quot; · ที่อยู่/SKU ไม่ชัด = amber/slate ไม่ใช่แดง
      </p>
    </div>
  );
}
