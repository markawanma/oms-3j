"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { UploadCloud } from "lucide-react";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorBanner } from "@/components/ui/ErrorState";
import { useToast } from "@/components/ui/Toast";
import { createLabelUpload, parseLabelFile } from "@/lib/actions/labels";
import type { LabelParseSummary } from "@/lib/labels/types";
import { ACCEPTED_EXTENSIONS, MAX_FILE_SIZE_BYTES, formatFileSize } from "@/lib/labels/constants-ui";
import { sha256Hex } from "@/lib/labels/sha256-client";
import type { UploadQueueItem } from "@/lib/tiktok/types";
import type { CrmProvinceOption } from "@/lib/crm/order-override";
import { UploadDropzone } from "./UploadDropzone";
import { UploadQueueList } from "./UploadQueueList";
import { BatchSummaryCard } from "./BatchSummaryCard";
import { LabelFileHistory } from "./LabelFileHistory";
import { PendingReviewQueue } from "./PendingReviewQueue";
import { ProvinceFixPanel } from "./ProvinceFixPanel";

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

// Layout redesign (design-approved 4 ต.ค. 69, docs/3j-jewelry/analytics/
// upload-page-layout-design.md) — 3 accordion sections instead of one long
// stacked page. "upload" starts open, "review"/"history" start folded;
// folding/unfolding never unmounts a section's children (CollapsibleSection
// uses the `hidden` attribute, not conditional rendering) so the per-row
// form state in LabelReviewQueueRow/ProvinceFixRow below survives being
// folded away and back (design doc §2/§4.1 step 6).
type SectionId = "upload" | "review" | "history";
const SECTION_IDS: readonly SectionId[] = ["upload", "review", "history"];

function isSectionId(value: string | null): value is SectionId {
  return value != null && (SECTION_IDS as readonly string[]).includes(value);
}

// Duplicated from UploadQueueList.tsx on purpose — that file is one of the
// ones the design brief says not to touch (accordion only changes the
// parent layer), and its IN_PROGRESS_STATUSES const isn't exported. Same
// 3 literal values, just needed here too for the "อัปโหลด" section's badge
// count (design doc §3: "จำนวนไฟล์ที่กำลังประมวลผล ... ถ้า >0").
const IN_PROGRESS_STATUSES: UploadQueueItem["status"][] = ["preparing", "uploading", "parsing"];

/**
 * UploadPageClient — /tiktok/upload, REAL flow (docs/3j-jewelry/analytics/
 * design-label-upload.md §3/§8). Per file: validate → sha256 (crypto.subtle)
 * → createLabelUpload() → PUT to signed Storage URL (skipped when the file
 * already exists by hash) → parseLabelFile() → per-file summary + an
 * interactive review queue (Phase A, design-label-teach-loop-yoda-11sep.md
 * §5 A — resolve/ignore a page right there, not read-only anymore).
 *
 * Every action call below is wrapped in try/catch so a thrown error surfaces
 * as the same "failed" queue state + retry button a real network/server
 * error would, with no special-casing.
 *
 * Files queue and process ONE AT A TIME (never parallel — design brief
 * "คิวไล่ทีละไฟล์ ไม่ยิง parse พร้อมกันหมด"), via pendingRef/processingRef
 * below rather than Promise.all.
 *
 * provinces/canEdit: fetched server-side in page.tsx (getCrmEditOptions() +
 * getDevRole(), same pattern as app/(dashboard)/crm/customers/[id]/page.tsx)
 * and threaded down to every Phase A interactive piece below (queue rows +
 * ProvinceFixPanel) — avoids each one re-fetching the same 77-province
 * reference list independently.
 *
 * Exported as a thin Suspense wrapper around UploadPageClientInner because
 * that inner component calls useSearchParams() (deep-link support, design
 * doc §6.2) — Next.js requires a Suspense boundary around any component
 * reading search params on the client, or the build either errors (static
 * routes) or silently opts the whole route out of static rendering.
 */
export function UploadPageClient(props: { provinces: CrmProvinceOption[]; canEdit: boolean }) {
  return (
    <Suspense fallback={null}>
      <UploadPageClientInner {...props} />
    </Suspense>
  );
}

function UploadPageClientInner({
  provinces,
  canEdit,
}: {
  provinces: CrmProvinceOption[];
  canEdit: boolean;
}) {
  const toast = useToast();
  const searchParams = useSearchParams();
  const [queue, setQueue] = useState<UploadQueueItem[]>([]);
  const [rejected, setRejected] = useState<RejectedFile[]>([]);
  // Bumped after every successful parse so <PendingReviewQueue /> (bug 2 fix
  // — the durable, shop-wide review queue read from stg_label_page) reloads
  // right away instead of only after the owner leaves and returns to this page.
  const [reviewRefreshSignal, setReviewRefreshSignal] = useState(0);

  // Accordion state (design doc §6.2) — "upload" open by default, the other
  // two folded. Controlled here (not inside CollapsibleSection) so
  // openSection()/the deep-link effect below can flip a single section open
  // without ever touching the others.
  const [openSections, setOpenSections] = useState<Record<SectionId, boolean>>({
    upload: true,
    review: false,
    history: false,
  });

  // "ตรวจ/แก้ไข" header badge count — lifted out of PendingReviewQueue via
  // onCountChange (design doc §6.3) because the badge lives in this
  // section's header, which stays rendered even while the content area
  // is `hidden`. undefined = loading (no callback yet), null = error,
  // number = real count. See CollapsibleSection.tsx for why three states.
  const [reviewCount, setReviewCount] = useState<number | null | undefined>(undefined);
  const [reviewPulse, setReviewPulse] = useState(false);
  const pulseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // File objects never go into React state (large binary blobs, and we only
  // ever need them keyed by item id for processing/retry) — kept in a ref map instead.
  const fileMapRef = useRef<Map<string, File>>(new Map());
  const pendingRef = useRef<string[]>([]);
  const processingRef = useRef(false);

  // openSection NEVER closes other sections (design doc §6.2: "merge เป็น
  // true เพิ่มจาก default (ไม่ไปปิดตัวอื่น)") — used both for the
  // auto-expand-after-parse case (no scroll) and the deep-link / "จัดการใน
  // คิวรวมด้านล่าง" button case (scroll). The 150ms delay mirrors the
  // scrollIntoView pattern ContentEntryQueue.tsx already uses elsewhere in
  // this app, giving the just-unhidden content a frame to lay out first.
  const openSection = useCallback((id: SectionId, opts?: { scroll?: boolean }) => {
    setOpenSections((prev) => (prev[id] ? prev : { ...prev, [id]: true }));
    if (opts?.scroll) {
      window.setTimeout(() => {
        document.getElementById(`${id}-section`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 150);
    }
  }, []);

  const toggleSection = useCallback((id: SectionId) => {
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  // Deep-link (design doc §4.2/§6.2): read `?open=review` ONCE on mount only
  // — this is a one-way "URL -> initial state" hint, never synced back to
  // the URL afterwards (so clicking sections around doesn't spam browser
  // history). Deliberately empty deps array; searchParams is only consulted
  // at mount time by design, not re-read on navigation within this page.
  useEffect(() => {
    const requested = searchParams.get("open");
    if (isSectionId(requested)) {
      openSection(requested, { scroll: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (pulseTimeoutRef.current) clearTimeout(pulseTimeoutRef.current);
    };
  }, []);

  // Stable identity (empty deps — setState setters never change) is load
  // bearing: PendingReviewQueue's own `load` useCallback depends on this
  // prop, which feeds a useEffect that re-fetches on identity change. An
  // inline arrow function here would get a new identity every render this
  // component makes, causing a redundant extra fetch on every mount/refresh.
  const handleReviewCountChange = useCallback((count: number | null) => {
    setReviewCount(count);
  }, []);

  const triggerReviewPulse = useCallback(() => {
    setReviewPulse(true);
    if (pulseTimeoutRef.current) clearTimeout(pulseTimeoutRef.current);
    pulseTimeoutRef.current = setTimeout(() => setReviewPulse(false), 2500);
  }, []);

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
        // Design doc §4.1 step 3 — auto-expand "ตรวจ/แก้ไข" WITHOUT scrolling
        // (owner may still be dragging the next file in) + a short pulse on
        // its badge to draw the eye without jumping the page.
        openSection("review");
        triggerReviewPulse();
        toast.push(`อ่าน ${file.name} เสร็จแล้ว — เติมจังหวัด ${summary.applied} ออเดอร์`);
      } catch (err) {
        const msg = messageFromError(err, "เกิดข้อผิดพลาดไม่ทราบสาเหตุ");
        updateItem(id, { status: "failed", errorText: msg, metaText: msg });
      }
    },
    [toast, updateItem, openSection, triggerReviewPulse]
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
  const inProgressCount = queue.filter((item) => IN_PROGRESS_STATUSES.includes(item.status)).length;

  return (
    <div className="space-y-3">
      <CollapsibleSection
        id="upload"
        title="อัปโหลด"
        open={openSections.upload}
        onToggle={() => toggleSection("upload")}
        badge={{ count: inProgressCount, tone: "blue" }}
      >
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
                {/* QA-1 fix (13 ก.ย. 69, R2-D2): เดิม section นี้ render
                    <ReviewQueueList> ที่มีปุ่มยืนยัน/ข้ามกดได้ตรงนี้ "ด้วย" — ขณะที่
                    bump reviewRefreshSignal ด้านล่าง (handleFilesSelected → parse
                    สำเร็จ) ทำให้ <PendingReviewQueue> โหลดหน้าเดียวกันจาก DB มา
                    render อีกชุด (คนละ state, คนละ component instance) กลายเป็น
                    "แถวรอตรวจ" 1 หน้าโผล่กดได้ 2 ที่พร้อมกัน — กดยืนยันที่นี่แล้ว
                    สำเนาใน PendingReviewQueue ยังค้างอยู่จนกว่าจะโหลดใหม่ กดซ้ำที่
                    สำเนานั้นเจอ error จาก RPC ("already resolved") ที่ดูเหมือนระบบพัง
                    ทั้งที่จริงสำเร็จไปแล้ว.

                    แก้ทางแคบสุด (ตามที่ QA เสนอ แทนที่จะทำ shared state ข้าม
                    component คนละ data source กัน — ของเดิมเป็น state คนละก้อน
                    จริง: rows ที่นี่มาจาก LabelParseSummary ของรอบอัปโหลดนี้ ส่วน
                    PendingReviewQueue query จาก stg_label_page ตรง ผูก callback
                    ร่วมกันเสี่ยง sync ผิดจังหวะมากกว่าคุ้ม): ที่นี่เหลือแค่ตัวเลข +
                    ปุ่มไปที่เดียวที่กดได้จริงคือ PendingReviewQueue ในส่วน
                    "ตรวจ/แก้ไข" ด้านล่าง — ReviewQueueList.tsx (ปุ่มกดตรงนี้) ถูก
                    ลบออกทั้งไฟล์.

                    Accordion redesign (4 ต.ค. 69): ลิงก์นี้เคยเป็น
                    <a href="#pending-review-queue"> เฉยๆ — เปลี่ยนเป็นปุ่มที่
                    expand + scroll section "ตรวจ/แก้ไข" ให้ในคลิกเดียว เพราะถ้า
                    section นั้นพับอยู่ การกระโดดไปที่ id เฉยๆจะไม่เห็นอะไรเลย
                    (design doc §4.2). */}
                {summary.reviewRows.length > 0 && (
                  <p className="mt-1 text-xs text-zinc-500">
                    รอตรวจสอบ {summary.reviewRows.length} หน้า —{" "}
                    <button
                      type="button"
                      onClick={() => openSection("review", { scroll: true })}
                      className="font-medium text-primary-700 underline underline-offset-2"
                    >
                      จัดการในคิวรวมด้านล่าง
                    </button>
                  </p>
                )}
              </section>
            );
          })}

          {!hasAnyActivity && (
            <EmptyState icon={UploadCloud} title="ยังไม่มีไฟล์วันนี้" description="ลากไฟล์ใบปะหน้ามาวาง หรือกดเลือกไฟล์ด้านบน" />
          )}
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        id="review"
        title="ตรวจ/แก้ไข"
        open={openSections.review}
        onToggle={() => toggleSection("review")}
        badge={{ count: reviewCount, pulse: reviewPulse }}
      >
        <div className="space-y-4">
          {/* บล็อกย่อย (a): คิวอัตโนมัติ จาก stg_label_page */}
          <PendingReviewQueue
            refreshSignal={reviewRefreshSignal}
            provinces={provinces}
            canEdit={canEdit}
            onCountChange={handleReviewCountChange}
          />
          {/* เส้นแบ่ง sub-block ตาม wireframe §5 — ProvinceFixPanel เป็นทางเข้า
              "แก้ไขจังหวัด" อีกทาง (ค้นด้วยเลขพัสดุ/เลขที่ออเดอร์) ไม่ผูกกับ
              stg_label_page เลย แต่เจ้าของยืนยันแล้วว่าให้อยู่ section เดียวกับ
              คิวตรวจ (design doc §3/§9) */}
          <div className="border-t border-zinc-200" />
          <ProvinceFixPanel provinces={provinces} canEdit={canEdit} />
        </div>
      </CollapsibleSection>

      <CollapsibleSection id="history" title="ประวัติไฟล์" open={openSections.history} onToggle={() => toggleSection("history")}>
        {/* "อ่านใหม่" ต่อไฟล์ (task brief 4 ก.ย. 69) — onReparsed bump signal
            เดียวกับตอนไฟล์ใหม่ parse เสร็จ เพราะ parseLabelFile() ที่ปุ่มนี้เรียก
            อาจเปลี่ยนคิวรอตรวจ (stg_label_page) ของไฟล์นั้นเหมือนกัน */}
        <LabelFileHistory onReparsed={() => setReviewRefreshSignal((n) => n + 1)} />
      </CollapsibleSection>
    </div>
  );
}
