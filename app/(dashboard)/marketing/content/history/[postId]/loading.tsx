import { Skeleton } from "@/components/ui/Skeleton";

// Route-level Suspense fallback while the server page awaits
// getContentPostKpiDetail()/getContentTypes() — mirrors
// ../loading.tsx's shape (a skeleton block per section so layout doesn't
// jump once real content arrives: back link, header card, metrics card,
// status panel, checklist).
export default function ContentPostKpiDetailLoading() {
  return (
    <div className="space-y-4" role="status" aria-label="กำลังโหลด KPI ของโพสต์">
      <Skeleton className="h-6 w-32" />
      <Skeleton className="h-28 w-full rounded-lg" />
      <Skeleton className="h-20 w-full rounded-lg" />
      <Skeleton className="h-40 w-full rounded-lg" />
      <Skeleton className="h-11 w-full rounded-lg" />
    </div>
  );
}
