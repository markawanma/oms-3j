import { Lock } from "lucide-react";
import { getOemSetting } from "@/lib/actions/oem";
import { getDevRole } from "@/lib/dev/context";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { QuoteCalculatorClient } from "@/components/domain/oem/QuoteCalculatorClient";

export const dynamic = "force-dynamic";

// /oem/quote — OEM price calculator (T5). Owner/admin only, same reasoning
// as /oem/rates (cost/margin breakdown is shown live on this page).
export default async function OemQuotePage() {
  if (getDevRole() === "staff") {
    return (
      <EmptyState
        icon={Lock}
        title="หน้านี้จำกัดสิทธิ์"
        description="เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่คิดราคางาน OEM ได้"
      />
    );
  }

  let settingResult;
  try {
    settingResult = await getOemSetting();
  } catch (err) {
    return <ErrorState message={err instanceof Error ? err.message : "เกิดข้อผิดพลาดที่ไม่คาดคิด"} />;
  }
  if (!settingResult.ok) return <ErrorState message={settingResult.error} />;

  return <QuoteCalculatorClient setting={settingResult.data} />;
}
