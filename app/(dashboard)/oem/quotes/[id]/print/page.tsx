import { Lock } from "lucide-react";
import { getQuote, getQuoteItems, getSellerProfile } from "@/lib/actions/oem";
import { getEffectiveRole } from "@/lib/auth/role";
import { toPrintableQuote } from "@/lib/oem/printableQuote";
import { EMPTY_SELLER_PROFILE } from "@/lib/oem/sellerProfile";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { PrintQuoteClient } from "@/components/domain/oem/PrintQuoteClient";
import { PrintFileTitle } from "@/components/ui/PrintFileTitle";
import { quotePrintTitle } from "@/lib/oem/print-title";

export const dynamic = "force-dynamic";

// /oem/quotes/[id]/print — printable A4 quotation for a saved OEM quote.
// Same auth gate as /oem/quotes/[id] (owner/admin only — calcPrice-derived
// numbers are the shop's entire cost structure, see requireOwnerAdmin's
// comment in lib/actions/oem.ts). Every customer-safety rule (draft blocked,
// missing seller profile fields blocked, cost/margin fields never rendered)
// lives in PrintQuoteClient — see its file header before touching either.
//
// toPrintableQuote() here is the actual security boundary (see
// lib/oem/printableQuote.ts's header): OemQuoteRow/OemQuoteItemRow carry
// cost/margin/calc fields that must never serialize into PrintQuoteClient's
// RSC flight payload (a "use client" component's props ship to the browser
// in full, rendered or not). This is the one and only place that
// narrows full DB rows down to the print-safe shape — do not pass
// quoteResult.data / itemsResult.data to PrintQuoteClient directly.
export default async function OemQuotePrintPage({ params }: { params: Promise<{ id: string }> }) {
  if ((await getEffectiveRole()) === "staff") {
    return (
      <EmptyState
        icon={Lock}
        title="หน้านี้จำกัดสิทธิ์"
        description="เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่พิมพ์ใบเสนอราคางาน OEM ได้"
      />
    );
  }

  const { id } = await params;

  let quoteResult, itemsResult, sellerResult;
  try {
    [quoteResult, itemsResult, sellerResult] = await Promise.all([getQuote(id), getQuoteItems(id), getSellerProfile()]);
  } catch (err) {
    return <ErrorState message={err instanceof Error ? err.message : "เกิดข้อผิดพลาดที่ไม่คาดคิด"} />;
  }
  if (!quoteResult.ok) return <ErrorState message={quoteResult.error} />;
  if (!itemsResult.ok) return <ErrorState message={itemsResult.error} />;
  if (itemsResult.data.length === 0) {
    return <EmptyState title="ไม่พบรายการในใบเสนอราคานี้" description="ใบเสนอราคานี้ยังไม่มีรายการสินค้า พิมพ์ไม่ได้" />;
  }
  // Degrade, don't ErrorState the whole print page over this — an empty
  // seller profile is ALREADY the correct conservative default here
  // (PrintQuoteClient blocks printing until every required seller field is
  // present), so a fetch failure and "not filled in yet" end up showing the
  // same safe "พิมพ์ไม่ได้" screen instead of a hard crash.
  if (!sellerResult.ok) console.error("getSellerProfile failed:", sellerResult.error);

  // ชื่อไฟล์ PDF อ่านจาก PrintableQuote (ด่าน boundary เดิม) เท่านั้น — เลขที่ + วันออกใบ + ชื่อผู้ซื้อ ไม่มียอด/ต้นทุน
  const quote = toPrintableQuote(quoteResult.data, itemsResult.data);
  return (
    <>
      <PrintFileTitle title={quotePrintTitle(quote)} />
      <PrintQuoteClient quote={quote} sellerProfile={sellerResult.ok ? sellerResult.data : EMPTY_SELLER_PROFILE} />
    </>
  );
}
