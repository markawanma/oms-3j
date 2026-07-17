import { getOpenSession, listLiveSessions } from "@/lib/actions/live";
import { LivePageClient } from "@/components/domain/LivePageClient";
import { ErrorState } from "@/components/ui/ErrorState";

export const dynamic = "force-dynamic";

export default async function LivePage() {
  let openResult, listResult;
  try {
    [openResult, listResult] = await Promise.all([getOpenSession(), listLiveSessions()]);
  } catch (err) {
    return <ErrorState message={err instanceof Error ? err.message : "เกิดข้อผิดพลาดที่ไม่คาดคิด"} />;
  }

  if (!openResult.ok) return <ErrorState message={openResult.error} />;
  if (!listResult.ok) return <ErrorState message={listResult.error} />;

  return (
    <div>
      <h1 className="mb-3 text-xl font-bold text-slate-900">จดออเดอร์เร็วตอนไลฟ์</h1>
      <LivePageClient initialOpenSession={openResult.data} initialSessions={listResult.data} />
    </div>
  );
}
