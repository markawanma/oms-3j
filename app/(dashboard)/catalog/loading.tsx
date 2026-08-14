import { Skeleton } from "@/components/ui/Skeleton";

export default function CatalogLoading() {
  return (
    <div className="space-y-4" role="status" aria-label="กำลังโหลดรายการสินค้า">
      <div className="flex items-center justify-between">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-9 w-28 rounded-md" />
      </div>
      <Skeleton className="h-72 w-full rounded-lg" />
    </div>
  );
}
