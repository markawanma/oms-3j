import { Skeleton } from "@/components/ui/Skeleton";

export default function OemReceiptsLoading() {
  return (
    <div className="space-y-4" role="status" aria-label="กำลังโหลดใบเสร็จ/ใบกำกับภาษี OEM">
      <Skeleton className="h-6 w-64" />
      <Skeleton className="h-9 w-64 rounded-md" />
      <Skeleton className="h-72 w-full rounded-lg" />
    </div>
  );
}
