import { Skeleton } from "@/components/ui/Skeleton";

// design §1.5 Loading row: skeleton cards under a "+ เพิ่มโพสต์ใหม่" trigger
// that stays tappable immediately (not blocked on the queue query) — this
// file is the route-level Suspense fallback while the server page awaits
// its data, so it can't render the real (interactive) button yet, but it
// visually reserves its place so the layout doesn't jump once data lands.
export default function ContentEntryLoading() {
  return (
    <div className="space-y-4" role="status" aria-label="กำลังโหลดคิวอ่านยอด content">
      <div className="space-y-1.5">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-56" />
      </div>
      <Skeleton className="h-11 w-full rounded-lg" />
      <Skeleton className="h-4 w-24" />
      <div className="space-y-2.5">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-40 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}
