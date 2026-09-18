import { Lock } from "lucide-react";
import { getProductionOrder, getProductionSkuOptions } from "@/lib/actions/production";
import { getEffectiveRole } from "@/lib/auth/role";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { ProductionOrderDetailClient } from "@/components/domain/production/ProductionOrderDetailClient";

export const dynamic = "force-dynamic";

// /production/[id] — one production order: header (editable while open),
// items (add/remove while open), ผลิตเสร็จ/ยกเลิก. Owner/admin only, same
// reasoning as /production.
export default async function ProductionOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  if ((await getEffectiveRole()) === "staff") {
    return (
      <EmptyState
        icon={Lock}
        title="หน้านี้จำกัดสิทธิ์"
        description="เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ดูใบผลิตเข้าสต็อกได้"
      />
    );
  }

  const { id } = await params;

  let detailResult, skuOptionsResult;
  try {
    [detailResult, skuOptionsResult] = await Promise.all([getProductionOrder(id), getProductionSkuOptions()]);
  } catch (err) {
    return <ErrorState message={err instanceof Error ? err.message : "เกิดข้อผิดพลาดที่ไม่คาดคิด"} />;
  }
  if (!detailResult.ok) return <ErrorState message={detailResult.error} />;

  // Degrade, don't block the whole order page over the SKU picker — an
  // owner should still be able to view/ผลิตเสร็จ/ยกเลิก an existing order
  // even if the picker read fails; ProductionAddItemForm shows the error
  // inline and disables adding new items until it's fixed.
  if (!skuOptionsResult.ok) console.error("getProductionSkuOptions failed:", skuOptionsResult.error);
  const skuOptions = skuOptionsResult.ok ? skuOptionsResult.data : [];
  const skuOptionsError = skuOptionsResult.ok ? null : skuOptionsResult.error;

  return (
    <ProductionOrderDetailClient
      order={detailResult.data.order}
      items={detailResult.data.items}
      skuOptions={skuOptions}
      skuOptionsError={skuOptionsError}
    />
  );
}
