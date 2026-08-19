import { Lock } from "lucide-react";
import { getQuotes } from "@/lib/actions/oem";
import { getDevRole } from "@/lib/dev/context";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { QuotesPageClient } from "@/components/domain/oem/QuotesPageClient";

export const dynamic = "force-dynamic";

// /oem/quotes — OEM quote registry (T6). Owner/admin only, same reasoning as
// /oem/rates and /oem/quote.
export default async function OemQuotesPage() {
  if (getDevRole() === "staff") {
    return (
      <EmptyState
        icon={Lock}
        title="หน้านี้จำกัดสิทธิ์"
        description="เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ดูใบเสนอราคางาน OEM ได้"
      />
    );
  }

  let quotesResult;
  try {
    quotesResult = await getQuotes();
  } catch (err) {
    return <ErrorState message={err instanceof Error ? err.message : "เกิดข้อผิดพลาดที่ไม่คาดคิด"} />;
  }
  if (!quotesResult.ok) return <ErrorState message={quotesResult.error} />;

  return <QuotesPageClient quotes={quotesResult.data} />;
}
