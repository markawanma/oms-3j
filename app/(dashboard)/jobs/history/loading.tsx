// loading ของ /jobs/history — h1 + แผงตัวกรอง + 5 แถว (~80px) · โครงเดียวกับหน้าจริง กันหน้ากระตุก
export default function Loading() {
  return (
    <div className="space-y-4" role="status" aria-label="กำลังโหลดประวัติงาน">
      <div className="h-7 w-32 animate-pulse rounded bg-zinc-200" />
      <div className="h-40 animate-pulse rounded-lg bg-zinc-200" />
      <div className="space-y-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-lg bg-zinc-200" />
        ))}
      </div>
    </div>
  );
}
