import { Skeleton } from "@/components/ui/Skeleton";

export default function SettingsLoading() {
  return (
    <div className="space-y-4" role="status" aria-label="กำลังโหลดการตั้งค่า">
      <Skeleton className="h-6 w-44" />
      <Skeleton className="h-32 w-full rounded-lg" />
      <Skeleton className="h-36 w-full rounded-lg" />
      <Skeleton className="h-44 w-full rounded-lg" />
    </div>
  );
}
