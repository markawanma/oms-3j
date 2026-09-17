"use client";

import { useCallback, useEffect, useState } from "react";
import { History } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import type { BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorBanner } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { getLabelFiles, parseLabelFile } from "@/lib/actions/labels";
import type { LabelFileListItem, LabelParseSummary } from "@/lib/labels/types";

const STATUS_TONE: Record<LabelFileListItem["status"], BadgeTone> = {
  uploaded: "blue",
  parsed: "green",
  parse_failed: "red",
  purged: "slate",
};

const STATUS_LABEL: Record<LabelFileListItem["status"], string> = {
  uploaded: "อัปแล้ว รอบันทึกผลอ่าน",
  parsed: "อ่านแล้ว",
  parse_failed: "อ่านไม่สำเร็จ",
  purged: "ลบไฟล์แล้ว (เกิน retention)",
};

// สถานะที่ยอมให้กด "อ่านใหม่" ได้ (task brief 4 ก.ย. 69):
// - parsed: เคสหลักตามโจทย์ — โดยเฉพาะไฟล์ที่เคยตก order_not_found แล้วออเดอร์เพิ่งเข้าระบบทีหลัง
// - parse_failed: parseLabelFile() รองรับ re-run อยู่แล้ว (เหมือนปุ่ม "ลองใหม่" ตอนอัปโหลดใน
//   UploadQueueList) — บางเคส parse_failed มาจาก error ชั่วคราว (เน็ตหลุดตอนโหลดจาก storage)
//   ไม่ใช่ไฟล์เสีย ให้ลองใหม่ได้โดยไม่ต้องอัปโหลดซ้ำ
// - uploaded: ยังไม่เคย parse เลย — นี่คือ flow "อ่านครั้งแรก" ไม่ใช่ "อ่านใหม่" ปกติแล้วคิวอัปโหลด
//   (UploadPageClient) จะพา state นี้ไปจบที่ parsed/parse_failed เองภายในรอบเดียวกัน อยู่นอกขอบเขต brief นี้
// - purged: พังชัวร์ — ไฟล์ใน storage bucket ถูกลบไปแล้ว parseLabelFile() คืน error
//   "อัปโหลดใหม่ก่อนอ่าน" เสมอ ไม่มีทางสำเร็จ โชว์ปุ่มที่กดแล้วพังทุกครั้งมีแต่ทำให้สับสน
const REPARSEABLE_STATUSES: LabelFileListItem["status"][] = ["parsed", "parse_failed"];

function formatDateTimeTH(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
}

function messageFromError(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

type ReparseHint = { text: string; worthClicking: boolean };

/**
 * "กดแล้วได้อะไร" (task brief §2) — บอกก่อนกดว่าคุ้มไหม ไม่ใช่แค่กดได้ไหม
 * null ใน orderNotFoundCount/rematchableCount = คำนวณไม่ได้ (getLabelFiles()
 * best-effort ล้มเหลว) → ไม่แสดงบรรทัดนี้เลย ไม่เดาว่าเป็น 0
 */
function reparseHint(file: LabelFileListItem): ReparseHint | null {
  if (file.orderNotFoundCount === null || file.rematchableCount === null) return null;
  if (file.orderNotFoundCount === 0) return null;
  if (file.rematchableCount > 0) {
    return {
      text: `⏳ ${file.orderNotFoundCount} หน้ายังหาออเดอร์ไม่เจอ — ตอนนี้ออเดอร์เข้าระบบแล้ว ${file.rematchableCount} หน้า กดอ่านใหม่เพื่อเติมจังหวัด`,
      worthClicking: true,
    };
  }
  // rematchableCount === 0 แต่ orderNotFoundCount > 0 — ห้ามเชียร์ให้กด (brief
  // "สิ่งที่ห้ามพัง" #4): บอกตามจริงว่ากดอ่านใหม่ก็ไม่ช่วย เพราะยังไม่มีออเดอร์ในระบบจริงๆ
  return {
    text: `${file.orderNotFoundCount} หน้ายังหาออเดอร์ไม่เจอ (ยังไม่มีออเดอร์ในระบบ) — กดอ่านใหม่ก็ยังไม่ช่วย`,
    worthClicking: false,
  };
}

/**
 * LabelFileHistory — "ประวัติไฟล์" ด้านล่างของ /tiktok/upload (design §8).
 * Loads independently of the upload queue above (own loading/error/empty
 * states) so a failed history fetch never blocks uploading new files.
 *
 * ปุ่ม "อ่านใหม่" ต่อไฟล์ (task brief 4 ก.ย. 69): เรียก parseLabelFile(fileId)
 * เดิม (ไม่มี backend ใหม่) — ไฟล์ที่เคยตก order_not_found เพราะออเดอร์ยังไม่เข้าระบบ
 * ตอนอัปโหลดครั้งแรก กดอ่านใหม่ได้เมื่อออเดอร์เข้าระบบแล้วทีหลัง โดยไม่ต้องลากไฟล์ PDF
 * เดิมกลับเข้ามาใหม่. onReparsed แจ้ง parent (UploadPageClient) ให้ bump
 * reviewRefreshSignal เดียวกับตอน parse ครั้งแรก — คิวรอตรวจที่ผูกกับไฟล์นี้อาจ
 * เปลี่ยนไปด้วย (design §"บั๊ก 2": คิวรอตรวจอ่านจาก DB ตรง ไม่ผูกกับ state ของรอบอัปโหลด).
 */
export function LabelFileHistory({ onReparsed }: { onReparsed?: () => void } = {}) {
  const toast = useToast();
  const [files, setFiles] = useState<LabelFileListItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // กันกดซ้ำซ้อนต่อไฟล์ — parse ต้องโหลด PDF จาก storage + อ่านทุกหน้าใหม่ ไม่ฟรี
  const [reparsingIds, setReparsingIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getLabelFiles();
      if (result.ok) {
        setFiles(result.data);
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดประวัติไฟล์ไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleReparse = useCallback(
    async (file: LabelFileListItem) => {
      if (reparsingIds.has(file.id)) return; // กันกดซ้ำระหว่างกำลังอ่าน (ปุ่มก็ disabled อยู่แล้วเช่นกัน)
      setReparsingIds((prev) => new Set(prev).add(file.id));
      try {
        const result = await parseLabelFile(file.id);
        if (result.ok) {
          const summary: LabelParseSummary = result.data;
          // ถ้อยคำเดียวกับตอนอัปโหลดครั้งแรกใน UploadPageClient — ไม่ให้ภาษาแตกกัน
          toast.push(`อ่าน ${summary.fileName} เสร็จแล้ว — เติมจังหวัด ${summary.applied} ออเดอร์`);
          onReparsed?.();
        } else {
          toast.push(`${file.fileName} — ${result.error}`, "error");
        }
      } catch (err) {
        toast.push(`${file.fileName} — ${messageFromError(err, "อ่านไฟล์ไม่สำเร็จ")}`, "error");
      } finally {
        setReparsingIds((prev) => {
          const next = new Set(prev);
          next.delete(file.id);
          return next;
        });
        // รีเฟรชรายการเสมอไม่ว่าสำเร็จหรือพัง — สถานะ/จำนวนหน้า/ตัวเลข rematch ของไฟล์นี้เปลี่ยนไปแล้ว
        void load();
      }
    },
    [reparsingIds, toast, load, onReparsed]
  );

  return (
    <section aria-label="ประวัติไฟล์ใบปะหน้า">
      <p className="mb-2 text-xs font-bold tracking-wide text-zinc-400 uppercase">ประวัติไฟล์</p>

      {loading && (
        <div className="flex flex-col gap-2" role="status" aria-label="กำลังโหลดประวัติไฟล์">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2.5 rounded-lg border border-zinc-200 bg-white p-3">
              <Skeleton className="h-8 w-8 rounded-md" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && error && <ErrorBanner message={error} onRetry={() => void load()} />}

      {!loading && !error && files && files.length === 0 && (
        <EmptyState icon={History} title="ยังไม่มีไฟล์ในประวัติ" description="ไฟล์ที่อัปโหลดแล้วจะโผล่ที่นี่" />
      )}

      {!loading && !error && files && files.length > 0 && (
        <div className="flex flex-col gap-2" role="list">
          {files.map((f) => {
            const hint = reparseHint(f);
            const canReparse = REPARSEABLE_STATUSES.includes(f.status);
            const isReparsing = reparsingIds.has(f.id);
            return (
              <div key={f.id} className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm" role="listitem">
                <div className="flex items-center gap-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-zinc-800">{f.fileName}</p>
                    <p className="mt-0.5 text-xs text-zinc-400">
                      {f.pageCount ?? "–"} หน้า · {formatDateTimeTH(f.uploadedAt)}
                    </p>
                  </div>
                  <Badge tone={STATUS_TONE[f.status]}>{STATUS_LABEL[f.status]}</Badge>
                </div>

                {hint && (
                  <p
                    className={`rounded-md px-2.5 py-1.5 text-xs ${
                      hint.worthClicking ? "bg-amber-50 text-amber-800" : "bg-zinc-50 text-zinc-500"
                    }`}
                  >
                    {hint.text}
                  </p>
                )}

                {canReparse && (
                  <div className="flex justify-end">
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={isReparsing}
                      disabled={isReparsing}
                      aria-label={`อ่านใหม่ — ${f.fileName}`}
                      onClick={() => void handleReparse(f)}
                    >
                      {isReparsing ? "กำลังอ่าน…" : "อ่านใหม่"}
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
