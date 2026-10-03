import { Lock } from "lucide-react";
import { getTrendRadarFeed } from "@/lib/actions/trend-radar";
import { getContentTypes } from "@/lib/actions/content";
import { getEffectiveRole } from "@/lib/auth/role";
import { effectiveDateBangkok } from "@/lib/tiktok/format";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { TrendRadarFeed } from "@/components/domain/marketing/TrendRadarFeed";

export const dynamic = "force-dynamic";

// /marketing/trend-radar — "เรดาร์เทรนด์" (Tech Lead brief 4 ต.ค. 69): reads
// docs/3j-jewelry/marketing/trend-radar/YYYY-MM-DD.md, the daily-trend-radar
// scheduled task's output, straight from GitHub (see lib/actions/
// trend-radar.ts's header for why it's GitHub and not local disk) and lets
// the owner add an interesting angle straight to the content calendar
// instead of opening the file and retyping it into "เพิ่มแผนเอง" by hand.
//
// Same page shape as /marketing/content/history (role gate owner/admin
// before even calling the action — belt-and-suspenders with the gate
// INSIDE getTrendRadarFeed/getContentTypes too — and
// dynamic = "force-dynamic" because every open of this page must show
// today's actual GitHub content, never a cached render).
export default async function TrendRadarPage() {
  if ((await getEffectiveRole()) === "staff") {
    return (
      <EmptyState
        icon={Lock}
        title="หน้านี้จำกัดสิทธิ์"
        description="เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ดูเรดาร์เทรนด์ได้"
      />
    );
  }

  // Independent fetches — content_type is small global reference data; a
  // failure loading it must not take down the whole feed, chips simply
  // don't render for that angle (same reasoning as content/history/
  // [postId]/page.tsx's identical Promise.all + .catch pairing).
  const [feedResult, typesResult] = await Promise.all([
    getTrendRadarFeed(),
    getContentTypes().catch((err) => {
      console.error("getContentTypes failed (non-blocking, trend-radar page)", err);
      return { ok: false as const, error: "โหลดประเภทเนื้อหาไม่สำเร็จ" };
    }),
  ]);

  if (!feedResult.ok) {
    return <ErrorState message={feedResult.error} />;
  }

  const contentTypes = typesResult.ok ? typesResult.data : [];
  const today = effectiveDateBangkok(new Date().toISOString());

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-zinc-900">เรดาร์เทรนด์</h1>
        <p className="text-sm text-zinc-500">
          วัตถุดิบที่ทีมรีเสิร์ชกรองมาให้ทุกวัน ไม่ใช่ content สำเร็จ — เลือกมุมที่สนใจแล้วกด “เพิ่มเข้าปฏิทิน” ได้เลย
        </p>
      </div>

      {feedResult.data.length === 0 ? (
        <EmptyState title="ยังไม่มีไฟล์เรดาร์เทรนด์" description="รองานอัตโนมัติรันรอบแรก แล้วค่อยกลับมาดูหน้านี้" />
      ) : (
        <TrendRadarFeed days={feedResult.data} contentTypes={contentTypes} defaultDate={today} />
      )}
    </div>
  );
}
