import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getLiveSessionStats } from "@/lib/actions/live";
import { LiveOrderTakingClient } from "@/components/domain/LiveOrderTakingClient";
import { ErrorState } from "@/components/ui/ErrorState";
import type { LiveSession } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function LiveOrderTakingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let result;
  try {
    result = await getLiveSessionStats(id);
  } catch (err) {
    return <ErrorState message={err instanceof Error ? err.message : "เกิดข้อผิดพลาดที่ไม่คาดคิด"} />;
  }

  if (!result.ok) return <ErrorState message={result.error} />;

  const stats = result.data;

  if (stats.status !== "open") {
    return (
      <ErrorState message="ไลฟ์นี้ปิดไปแล้ว ไม่สามารถจดออเดอร์เพิ่มได้" />
    );
  }

  const session: LiveSession = {
    id: stats.liveSessionId,
    title: stats.title,
    status: stats.status,
    startedAt: stats.startedAt,
    endedAt: stats.endedAt,
    notes: null,
  };

  return (
    <div>
      <Link
        href="/live"
        className="mb-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        กลับไปหน้าไลฟ์
      </Link>
      <h1 className="mb-3 text-xl font-bold text-slate-900">{session.title || "จดออเดอร์เร็ว"}</h1>
      <LiveOrderTakingClient session={session} initialStats={stats} />
    </div>
  );
}
