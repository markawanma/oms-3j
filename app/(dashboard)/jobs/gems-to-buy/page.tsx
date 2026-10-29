import { Lock } from "lucide-react";
import { getGemPurchaseSummary } from "@/lib/actions/gems";
import { actorId } from "@/lib/jobs/office-server";
import { parseGtbParams, toGemsToBuyView } from "@/lib/jobs/gems-to-buy";
import { canManageJobs } from "@/lib/jobs/page-gate";
import { EmptyState } from "@/components/ui/EmptyState";
import { GemsToBuyClient } from "@/components/domain/jobs/gems-to-buy/GemsToBuyClient";
import { GemsToBuyError } from "@/components/domain/jobs/gems-to-buy/GemsToBuyError";

export const dynamic = "force-dynamic";

// /jobs/gems-to-buy — พลอยที่ต้องสั่งซื้อ (G1b · ux-gems-to-buy.md) — owner/admin เท่านั้น
// ชั้นแอป: ไม่ใช่ owner/admin → EmptyState จำกัดสิทธิ์ (ไม่เรียก action เลย) · ชั้น DB: RPC ตรวจ actor ซ้ำ (gem_require_office)
// 🔴 หน้านี้ "ไม่ prefetch ต้นทุน" — getGemPurchaseCost เรียกจาก client เฉพาะเมื่อเปิดสวิตช์ (useGemCost) → HTML/RSC ตอนสวิตช์ปิดไม่มีเลขราคา (เทสต์ gems-boundary.test.ts ล็อกว่าไฟล์นี้ไม่อ้างถึง)
// ผู้ติ๊ก (ordered_by = uuid) เทียบกับ session ที่นี่ → ส่งไป client แค่ "โดยคุณ/โดยคนอื่น" (ไม่ส่ง uuid ผู้ใช้ · ไม่ดึง auth.users/อีเมล)
export default async function GemsToBuyPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  if (!(await canManageJobs())) {
    return <EmptyState icon={Lock} title="หน้านี้จำกัดสิทธิ์" description="เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ดูและทำเครื่องหมายสั่งซื้อพลอยได้" />;
  }
  const { tab, filters } = parseGtbParams((await searchParams) ?? {});
  let res;
  try {
    res = await getGemPurchaseSummary();
  } catch {
    // ไม่สะท้อนข้อความดิบของ error (อาจมีรายละเอียดฐานข้อมูล)
    return <GemsToBuyError />;
  }
  if (!res.ok) return <GemsToBuyError />;
  const view = toGemsToBuyView(res.data, await actorId());
  return <GemsToBuyClient view={view} initialTab={tab} initialFilters={filters} />;
}
