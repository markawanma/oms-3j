import { Skeleton } from "@/components/ui/Skeleton";

// Route-level Suspense fallback ตอนเข้าหน้าครั้งแรก — ทรงเดียวกับหน้าจริง (หัว · แถบกรอง · tile 3 ใบ · การ์ด) กัน layout shift
// ⚠️ Next ไม่แสดง fallback นี้เมื่อเปลี่ยนแค่ searchParams ของ segment เดิม — ตอนกดเปลี่ยนช่วง RingSizeStats ใช้ useTransition
// (เนื้อหาจาง + "กำลังอัปเดต…") แทน
export default function RingSizeStatsLoading() {
  return (
    <div className="space-y-4" role="status" aria-label="กำลังโหลดสถิติไซส์แหวน">
      <div className="space-y-1.5">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <Skeleton className="h-11 w-full rounded-md" />
      <div className="grid grid-cols-3 gap-2">
        <Skeleton className="h-20 rounded-lg" />
        <Skeleton className="h-20 rounded-lg" />
        <Skeleton className="h-20 rounded-lg" />
      </div>
      <Skeleton className="h-48 w-full rounded-lg" />
      <Skeleton className="h-48 w-full rounded-lg" />
    </div>
  );
}
