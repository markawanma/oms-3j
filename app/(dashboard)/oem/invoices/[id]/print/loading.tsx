import { Skeleton } from "@/components/ui/Skeleton";

export default function OemInvoicePrintLoading() {
  return (
    <div className="mx-auto max-w-[210mm] space-y-4" role="status" aria-label="กำลังโหลดใบแจ้งหนี้">
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-24 w-full rounded-lg" />
      <Skeleton className="h-32 w-full rounded-lg" />
      <Skeleton className="h-64 w-full rounded-lg" />
    </div>
  );
}
