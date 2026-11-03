import { Lock } from "lucide-react";
import { getRingSizeStats } from "@/lib/actions/ring-size-stats";
import { getEffectiveRole } from "@/lib/auth/role";
import { getDevShopId } from "@/lib/dev/context";
import { bangkokTodayISO, parseRingSizeFilters, type RingSizeSearchParams } from "@/lib/marketing/ring-size-filters";
import { readErrorCode } from "@/lib/supabase/postgrest-error";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { RingSizeStats } from "@/components/domain/marketing/RingSizeStats";

export const dynamic = "force-dynamic";

// /marketing/ring-size — สถิติไซส์แหวนแบบไม่ระบุตัวตน (P3 · อ่านอย่างเดียว owner/admin)
// สเปค: docs/3j-jewelry/oms/ux-ring-size-stats.md · RPC: analytics.ring_size_stats (0193)
// Pattern เดียวกับ /marketing/gem-quiz: role gate → EmptyState · getDevShopId ใน try → ErrorState · ตัวกรองผ่าน searchParams
//
// 🔴 staff = ไม่เรียก action/RPC เลย (ด่านแอปคือด่านเดียว — RPC ข้ามการตรวจสิทธิ์เมื่อเป็น service_role) · action เช็คสิทธิ์ซ้ำเองด้วย
// 🔴 searchParams ผิด/ขยะ ⇒ parseRingSizeFilters แปลงเป็นค่าเริ่มต้น + แจ้ง ไม่ throw · `src=` เพิกเฉย (ไม่มีตัวกรองช่องทางแล้ว)
// 🔴 ไม่รับ/ไม่อ่าน shop id จาก URL — shop มาจาก env ฝั่ง server ใน action เท่านั้น
export default async function RingSizeStatsPage({ searchParams }: { searchParams: Promise<RingSizeSearchParams> }) {
  if ((await getEffectiveRole()) === "staff") {
    return (
      <EmptyState
        icon={Lock}
        title="หน้านี้จำกัดสิทธิ์"
        description="เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ดูสถิติไซส์แหวนได้"
      />
    );
  }

  try {
    getDevShopId();
  } catch {
    // ข้อความคงที่ — ไม่โชว์ข้อความ error ดิบของ env (ชื่อตัวแปร/พาธเอกสารไม่ควรขึ้นจอ)
    return <ErrorState message="ตั้งค่าระบบยังไม่ครบ แจ้งทีมพัฒนาให้ตรวจการตั้งค่าร้าน" />;
  }

  const today = bangkokTodayISO();
  const { notices, ...filters } = parseRingSizeFilters(await searchParams, today);

  const result = await getRingSizeStats({ from: filters.from, to: filters.to }).catch((err) => {
    // ห้าม log error ของ supabase ทั้งก้อน (PII/host) — log แค่ code (memory supabase-error-logging-trap)
    console.error("getRingSizeStats failed (page)", readErrorCode(err) ?? "unknown");
    return { ok: false as const, error: "โหลดสถิติไม่สำเร็จ ลองใหม่อีกครั้ง" };
  });

  // ตัวกรองรอดทุก state (error/empty/ข้อมูลน้อย) — RingSizeStats เป็นเจ้าของแถบกรอง ไม่ใช่ page
  return <RingSizeStats result={result} filters={filters} today={today} notices={notices} />;
}
