export default function Loading() {
  return (
    <div className="space-y-3" role="status" aria-label="กำลังโหลดใบงาน">
      <div className="h-8 w-48 animate-pulse rounded bg-zinc-200" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded-lg bg-zinc-200" />
        ))}
      </div>
      <div className="h-40 animate-pulse rounded-lg bg-zinc-200" />
    </div>
  );
}
