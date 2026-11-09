import { Lock } from "lucide-react";
import { getRingBuilderAdmin } from "@/lib/actions/ring-builder";
import { getEffectiveRole } from "@/lib/auth/role";
import { isOwnerOrAdmin } from "@/lib/auth/owner-admin";
import { EmptyState } from "@/components/ui/EmptyState";
import { RingBuilderAdminClient } from "@/components/domain/ring-builder/admin/RingBuilderAdminClient";
import { parseRingTab } from "@/lib/ring-builder/admin-ui";

export const dynamic = "force-dynamic";

// /catalog/ring-builder — หลังบ้าน "ออกแบบแหวนแถวเอง" (พลอย·ราคาขาย / แบบแหวน / ตรวจรหัสสั่งทำ)
// ด่านสิทธิ์ชั้นแอป: owner/admin เท่านั้น (allowlist) · ด่านจริงอยู่ที่ทุก action (getEffectiveRole) และ RPC ชั้น DB
export default async function RingBuilderAdminPage({ searchParams }: { searchParams?: Promise<{ tab?: string | string[] }> }) {
  if (!isOwnerOrAdmin(await getEffectiveRole())) {
    return <EmptyState icon={Lock} title="หน้านี้จำกัดสิทธิ์" description="เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่จัดการพลอย แบบแหวน และราคาขายของหน้าออกแบบแหวนได้" />;
  }
  const tabParam = (await searchParams)?.tab;
  const tab = parseRingTab(Array.isArray(tabParam) ? tabParam[0] : tabParam);

  let initial = null;
  let initialError: string | null = null;
  try {
    const res = await getRingBuilderAdmin();
    if (res.ok) initial = res.data;
    else initialError = res.error;
  } catch {
    // ไม่สะท้อนข้อความดิบของ error
    initialError = "โหลดข้อมูลไม่สำเร็จ ลองใหม่อีกครั้ง";
  }
  return <RingBuilderAdminClient initial={initial} initialError={initialError} initialTab={tab} />;
}
