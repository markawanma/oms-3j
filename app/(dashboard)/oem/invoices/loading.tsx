import { Skeleton } from "@/components/ui/Skeleton";

export default function OemInvoicesLoading() {
  return (
    <div className="space-y-4" role="status" aria-label="กำลังโหลดใบแจ้งหนี้ OEM">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-11 w-80 max-w-full rounded-md" />
      <Skeleton className="h-72 w-full rounded-lg" />
    </div>
  );
}
