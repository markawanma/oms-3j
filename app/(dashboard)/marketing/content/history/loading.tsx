import { Skeleton } from "@/components/ui/Skeleton";

// Route-level Suspense fallback while the server page awaits
// getContentPostHistory()/getContentTypes() — mirrors
// app/(dashboard)/marketing/content/entry/loading.tsx's shape (header
// skeleton + a block reserving the table's place so layout doesn't jump).
export default function ContentHistoryLoading() {
  return (
    <div className="space-y-4" role="status" aria-label="กำลังโหลดประวัติโพสต์ content">
      <div className="space-y-1.5">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      <Skeleton className="h-64 w-full rounded-lg" />
    </div>
  );
}
