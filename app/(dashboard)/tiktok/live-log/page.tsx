import { Lock } from "lucide-react";
import { getChannelFollowerCount, getLiveSessionForDate } from "@/lib/actions/live-metrics";
import { getEffectiveRole } from "@/lib/auth/role";
import { getDevShopId } from "@/lib/dev/context";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LiveMetricsForm } from "@/components/domain/tiktok/LiveMetricsForm";
import { effectiveDateBangkok } from "@/lib/tiktok/format";

export const dynamic = "force-dynamic";

// /tiktok/live-log — งานด่วน 30 ก.ย. 69: เจ้าของสัญญาจะเริ่มจดคนดูพีคไลฟ์ตั้งแต่
// 1 ต.ค. 69 แต่ analytics.live_session_upsert (0121, ลงมาตั้งแต่ 16 ก.ย.)
// ไม่เคยมีหน้าจอให้กรอกเลยสักหน้า — ทางเดียวที่มีคือทักผ่านแชทให้ Tech Lead
// กรอกแทนทุกคืน หน้านี้คือจุดกรอกจริงจุดแรก รวม 2 ตัวเลขที่ content-kpi-
// definition.md §6 บอกว่าต้องจดมือ (วัด engagement คอนเทนต์ไม่ได้ถ้าไม่มี):
//   1. คนเข้าห้องไลฟ์พีค — คืนละ 1 ตัวเลข (แสดงทุกครั้งที่เปิดหน้า)
//   2. จำนวนเพื่อน LINE — สัปดาห์ละครั้ง (ยุบใน <details>, ไม่บังคับทุกครั้ง)
//
// เลือก /tiktok/live-log (ไม่ใช่ /marketing/...) เพราะ sidebar มีกลุ่ม
// "TikTok Ops" อยู่แล้วติดกับ "แดชบอร์ด TikTok" — งานนี้คือบันทึกผลไลฟ์ TikTok
// โดยตรง คนละเรื่องกับ /marketing/content/* ที่วัดผล content แต่ละคลิป
// (แม้ RPC ทั้งสองตัวจะอยู่ใต้ schema analytics เดียวกัน — grouping ที่นี่ยึด
// ตาม "ผู้ใช้ทำอะไรอยู่" ไม่ใช่ตาม schema).
//
// Page shape เดียวกับ /marketing/content/entry: role gate owner/admin,
// dynamic = "force-dynamic", fetch วันนี้ล่วงหน้าฝั่ง server เพื่อ pre-fill
// รอบแรกโดยไม่ต้อง round-trip ซ้ำตอน client mount.
export default async function LiveLogPage() {
  if ((await getEffectiveRole()) === "staff") {
    return (
      <EmptyState
        icon={Lock}
        title="หน้านี้จำกัดสิทธิ์"
        description="เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่บันทึกข้อมูลไลฟ์ได้"
      />
    );
  }

  try {
    getDevShopId();
  } catch (err) {
    return <ErrorState message={err instanceof Error ? err.message : "เกิดข้อผิดพลาดที่ไม่คาดคิด"} />;
  }

  const todayTh = effectiveDateBangkok(new Date().toISOString());

  // Independent fetches — คนละตาราง คนละ RPC กันเลย (live_session_log vs
  // channel_follower_log) ความล้มเหลวฝั่งใดฝั่งหนึ่งต้องไม่บล็อกอีกฝั่ง
  // (แพทเทิร์นเดียวกับ /marketing/content/entry's M4 fix)
  const [sessionResult, followerResult] = await Promise.all([
    getLiveSessionForDate(todayTh).catch((err) => {
      console.error("getLiveSessionForDate failed (page)", err);
      return { ok: false as const, error: "โหลดข้อมูลไลฟ์วันนี้ไม่สำเร็จ" };
    }),
    getChannelFollowerCount("line_oa", todayTh).catch((err) => {
      console.error("getChannelFollowerCount failed (page)", err);
      return { ok: false as const, error: "โหลดจำนวนเพื่อน LINE ไม่สำเร็จ" };
    }),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-zinc-900">จดไลฟ์</h1>
        <p className="text-sm text-zinc-500">กรอกคนดูพีคหลังไลฟ์จบ + อัปเดตเพื่อน LINE รายสัปดาห์</p>
      </div>

      <LiveMetricsForm
        todayTh={todayTh}
        initialSession={sessionResult.ok ? sessionResult.data : null}
        initialFollowerCount={followerResult.ok && followerResult.data ? followerResult.data.followerCount : null}
      />
    </div>
  );
}
