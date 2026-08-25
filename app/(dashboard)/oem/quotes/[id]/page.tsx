import { Lock } from "lucide-react";
import { getOemProvinces, getQuote, getQuoteItems } from "@/lib/actions/oem";
import { getDevRole } from "@/lib/dev/context";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { QuoteDetailClient } from "@/components/domain/oem/QuoteDetailClient";

export const dynamic = "force-dynamic";

// /oem/quotes/[id] — single saved OEM quote (T6). Owner/admin only, same
// reasoning as the rest of the OEM module.
export default async function OemQuoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  if (getDevRole() === "staff") {
    return (
      <EmptyState
        icon={Lock}
        title="หน้านี้จำกัดสิทธิ์"
        description="เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ดูใบเสนอราคางาน OEM ได้"
      />
    );
  }

  const { id } = await params;

  let quoteResult, itemsResult, provincesResult;
  try {
    [quoteResult, itemsResult, provincesResult] = await Promise.all([getQuote(id), getQuoteItems(id), getOemProvinces()]);
  } catch (err) {
    return <ErrorState message={err instanceof Error ? err.message : "เกิดข้อผิดพลาดที่ไม่คาดคิด"} />;
  }
  if (!quoteResult.ok) return <ErrorState message={quoteResult.error} />;
  if (!itemsResult.ok) return <ErrorState message={itemsResult.error} />;
  // Degrade gracefully, don't block the whole quote page over the province
  // dropdown — BillingDialog falls back to a free-text field when this is
  // empty (see its own comment).
  if (!provincesResult.ok) console.error("getOemProvinces failed:", provincesResult.error);
  const provinces = provincesResult.ok ? provincesResult.data : [];

  return <QuoteDetailClient quote={quoteResult.data} items={itemsResult.data} provinces={provinces} />;
}
