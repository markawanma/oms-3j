import { Skeleton } from "@/components/ui/Skeleton";

export default function OemQuoteLoading() {
  return (
    <div className="space-y-4" role="status" aria-label="กำลังโหลดหน้าคิดราคา OEM">
      <div>
        <Skeleton className="h-6 w-48" />
        <Skeleton className="mt-2 h-4 w-64" />
      </div>
      <div className="grid gap-4 md:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-96 w-full rounded-lg" />
      </div>
    </div>
  );
}
