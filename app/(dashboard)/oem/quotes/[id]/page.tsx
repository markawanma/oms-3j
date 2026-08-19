import { Lock } from "lucide-react";
import { getQuote } from "@/lib/actions/oem";
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

  let quoteResult;
  try {
    quoteResult = await getQuote(id);
  } catch (err) {
    return <ErrorState message={err instanceof Error ? err.message : "เกิดข้อผิดพลาดที่ไม่คาดคิด"} />;
  }
  if (!quoteResult.ok) return <ErrorState message={quoteResult.error} />;

  return <QuoteDetailClient quote={quoteResult.data} />;
}
