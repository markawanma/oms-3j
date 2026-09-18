import { Lock } from "lucide-react";
import { getEffectiveRole } from "@/lib/auth/role";
import { EmptyState } from "@/components/ui/EmptyState";
import { ProductionOrderNewClient } from "@/components/domain/production/ProductionOrderNewClient";

export const dynamic = "force-dynamic";

// /production/new — creates a new production order header. Owner/admin
// only, same reasoning as /production.
export default async function ProductionNewPage() {
  if ((await getEffectiveRole()) === "staff") {
    return (
      <EmptyState
        icon={Lock}
        title="หน้านี้จำกัดสิทธิ์"
        description="เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่สร้างใบผลิตเข้าสต็อกได้"
      />
    );
  }

  return <ProductionOrderNewClient />;
}
