import { Lock } from "lucide-react";
import { getGemCatalog } from "@/lib/actions/gems";
import { canManageJobs } from "@/lib/jobs/page-gate";
import { effectiveDateBangkok } from "@/lib/tiktok/format";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { GemCatalogClient } from "@/components/domain/gems/GemCatalogClient";
import { parseGemTab } from "@/lib/jobs/gem-tabs";

export const dynamic = "force-dynamic";

// /oem/gems — แคตตาล็อกพลอย (G1a · UX ux-gems.md §7) — 🔴 ราคาพลอย = ต้นทุน: เฉพาะ owner/admin (เหมือน /oem/rates)
// ชั้นแอป: ไม่ใช่ owner/admin → EmptyState จำกัดสิทธิ์ (ไม่เรียก action ราคาเลย) · ชั้น DB: gem_catalog_list/gem_price_* ตรวจ actor owner/admin ซ้ำ (gem_require_office)
export default async function OemGemsPage({ searchParams }: { searchParams?: Promise<{ tab?: string | string[] }> }) {
  // allowlist owner | admin (role แปลก/อนาคต/ไม่มี session ไม่ผ่านโดยปริยาย — ไม่ใช่ "ไม่ใช่ staff")
  if (!(await canManageJobs())) {
    return <EmptyState icon={Lock} title="หน้านี้จำกัดสิทธิ์" description="เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ดูและแก้ไขแคตตาล็อกพลอยและราคาได้" />;
  }
  const tabParam = (await searchParams)?.tab;
  let res;
  try {
    // รวมที่ปิดใช้งาน/ถูกรวมแล้ว เพื่อให้ช่อง "แสดงที่ปิดใช้งาน" ทำงานฝั่งจอ (ตารางไม่แบ่งหน้า — เกิน ~200 แถวค่อยเพิ่ม)
    res = await getGemCatalog(true);
  } catch {
    // ไม่สะท้อนข้อความดิบของ error (อาจมีรายละเอียดฐานข้อมูล)
    return <ErrorState message="โหลดแคตตาล็อกพลอยไม่สำเร็จ ลองใหม่อีกครั้ง" />;
  }
  if (!res.ok) return <ErrorState message={res.error} />;
  return <GemCatalogClient catalog={res.data} todayBkk={effectiveDateBangkok(new Date().toISOString())} initialTab={parseGemTab(Array.isArray(tabParam) ? tabParam[0] : tabParam)} />;
}
