import { Lock } from "lucide-react";
import { getGemQuizStats } from "@/lib/actions/gem-quiz-stats";
import { getEffectiveRole } from "@/lib/auth/role";
import { getDevShopId } from "@/lib/dev/context";
import { readErrorCode } from "@/lib/supabase/postgrest-error";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { GemQuizStats } from "@/components/domain/marketing/GemQuizStats";

export const dynamic = "force-dynamic";

// /marketing/gem-quiz — สถิติภายในของแบบทดสอบเลือกพลอย (design doc §7,
// docs/3j-jewelry/analytics/design-gem-quiz.md). Pattern เดียวกับ
// /marketing/content/history: role gate owner/admin -> EmptyState, getDevShopId
// ใน try -> ErrorState, filter ผ่าน searchParams (bookmarkable URL, เหมือน
// /crm/orders's from/to convention).
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function bangkokTodayISO(): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(
    new Date()
  );
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const d = parts.find((p) => p.type === "day")!.value;
  return `${y}-${m}-${d}`;
}

function addDaysISO(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default async function GemQuizStatsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; retake?: string }>;
}) {
  if ((await getEffectiveRole()) === "staff") {
    return (
      <EmptyState
        icon={Lock}
        title="หน้านี้จำกัดสิทธิ์"
        description="เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ดูสถิติแบบทดสอบพลอยได้"
      />
    );
  }

  try {
    getDevShopId();
  } catch (err) {
    return <ErrorState message={err instanceof Error ? err.message : "เกิดข้อผิดพลาดที่ไม่คาดคิด"} />;
  }

  const { from: fromParam, to: toParam, retake: retakeParam } = await searchParams;
  const today = bangkokTodayISO();
  const defaultFrom = addDaysISO(today, -29); // default 30 วันล่าสุด (design §7)
  const from = fromParam && DATE_RE.test(fromParam) ? fromParam : defaultFrom;
  const to = toParam && DATE_RE.test(toParam) ? toParam : today;
  const includeRetake = retakeParam === "1";

  const result = await getGemQuizStats({ from, to, includeRetake }).catch((err) => {
    // security audit L3 (5 ต.ค. 69): ห้าม log error ของ supabase ทั้งก้อน —
    // details พ่วง host/stack, DETAIL พ่วง PII ได้ (memory:
    // supabase-error-logging-trap) — log แค่ code
    console.error("getGemQuizStats failed (page)", readErrorCode(err) ?? "unknown");
    return { ok: false as const, error: "โหลดสถิติไม่สำเร็จ ลองใหม่อีกครั้ง" };
  });

  if (!result.ok) {
    return <ErrorState message={result.error} />;
  }

  if (result.data.respondents === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-lg font-bold text-zinc-900">สถิติแบบทดสอบเลือกพลอย</h1>
        <EmptyState
          title="ยังไม่มีคนทำแบบทดสอบในช่วงที่เลือก"
          description="ลองขยายช่วงวันที่ หรือกลับมาดูใหม่หลังการ์ด QR ถูกส่งออกไป"
        />
      </div>
    );
  }

  return <GemQuizStats stats={result.data} filters={{ from, to, includeRetake }} />;
}
