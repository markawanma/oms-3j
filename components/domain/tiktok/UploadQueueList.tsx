import { AlertTriangle, CheckCircle2, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { UploadQueueItem } from "@/lib/tiktok/types";

const STATUS_LABEL: Record<UploadQueueItem["status"], string> = {
  preparing: "กำลังเตรียม",
  uploading: "กำลังอัป",
  parsing: "กำลังอ่าน",
  done: "เสร็จ",
  failed: "ล้มเหลว",
};

const IN_PROGRESS_STATUSES: UploadQueueItem["status"][] = ["preparing", "uploading", "parsing"];

function UploadQueueItemRow({ item, onRetry }: { item: UploadQueueItem; onRetry: (id: string) => void }) {
  const inProgress = IN_PROGRESS_STATUSES.includes(item.status);

  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm" role="listitem">
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${item.status === "failed" ? "bg-amber-100" : "bg-zinc-100"}`}>
        {item.status === "failed" ? (
          <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden="true" />
        ) : item.status === "done" ? (
          <CheckCircle2 className="h-4 w-4 text-green-600" aria-hidden="true" />
        ) : inProgress ? (
          <Loader2 className="h-4 w-4 animate-spin text-primary-600" aria-hidden="true" />
        ) : (
          <FileText className="h-4 w-4 text-zinc-500" aria-hidden="true" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-zinc-800">{item.fileName}</p>
        <p className={`mt-0.5 text-xs ${item.status === "failed" ? "text-amber-700" : "text-zinc-400"}`}>{item.metaText}</p>
      </div>
      {item.status === "failed" ? (
        <Button variant="secondary" size="sm" onClick={() => onRetry(item.id)} className="shrink-0">
          ลองใหม่
        </Button>
      ) : (
        <span
          className={`shrink-0 rounded px-2 py-1 text-[0.68rem] font-bold ${
            item.status === "done" ? "bg-green-100 text-green-800" : "bg-primary-100 text-primary-700"
          }`}
        >
          {STATUS_LABEL[item.status]}
        </span>
      )}
    </div>
  );
}

export function UploadQueueList({ items, onRetry }: { items: UploadQueueItem[]; onRetry: (id: string) => void }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-2" role="list" aria-label="คิวอัปโหลด">
      {items.map((item) => (
        <UploadQueueItemRow key={item.id} item={item} onRetry={onRetry} />
      ))}
    </div>
  );
}
