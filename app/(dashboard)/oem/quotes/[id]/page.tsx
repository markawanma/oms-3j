import { Lock } from "lucide-react";
import { getOemProvinces, getQuote, getQuoteItems, getReceipts, getSellerProfile } from "@/lib/actions/oem";
import { getDevRole } from "@/lib/dev/context";
import { EMPTY_SELLER_PROFILE } from "@/lib/oem/sellerProfile";
import type { OemDepositMode } from "@/lib/oem/types";
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

  let quoteResult, itemsResult, provincesResult, sellerResult, receiptsResult;
  try {
    [quoteResult, itemsResult, provincesResult, sellerResult, receiptsResult] = await Promise.all([
      getQuote(id),
      getQuoteItems(id),
      getOemProvinces(),
      // 0082: needed to gate the "แยกแสดงภาษี" VAT option in VatModeDialog
      // (breakdown requires sellerVatRegistered=true — same rule the RPC
      // itself enforces, see setQuoteVatMode's comment).
      getSellerProfile(),
      // 0084: every receipt for this DEAL (whole renegotiation chain, not
      // just this row's own quote_id — see getReceipts' comment).
      getReceipts(id),
    ]);
  } catch (err) {
    return <ErrorState message={err instanceof Error ? err.message : "เกิดข้อผิดพลาดที่ไม่คาดคิด"} />;
  }
  if (!quoteResult.ok) return <ErrorState message={quoteResult.error} />;
  if (!itemsResult.ok) return <ErrorState message={itemsResult.error} />;
  // Degrade, don't block the whole quote page over the receipt list — same
  // posture as provinces/seller profile below.
  if (!receiptsResult.ok) console.error("getReceipts failed:", receiptsResult.error);
  const receipts = receiptsResult.ok ? receiptsResult.data.rows : [];
  // Degrade, don't block the whole quote page over the province dropdown —
  // BillingDialog falls back to a free-text field when this is empty (see
  // its own comment).
  if (!provincesResult.ok) console.error("getOemProvinces failed:", provincesResult.error);
  const provinces = provincesResult.ok ? provincesResult.data : [];
  // Same degrade-not-block posture as /oem/rates and the print page: a
  // failed seller-profile fetch just means "treat VAT breakdown as disabled"
  // (EMPTY_SELLER_PROFILE.vatRegistered=false), the safe conservative default.
  if (!sellerResult.ok) console.error("getSellerProfile failed:", sellerResult.error);
  const sellerProfile = sellerResult.ok ? sellerResult.data : EMPTY_SELLER_PROFILE;

  // 0081: oem_quote_renegotiate silently clamps a THB-mode deposit down when
  // the new grand_total can't cover it (or clears it entirely if the new
  // total is <= 0) — the RPC has no channel to return a warning about that,
  // so this app has to notice on its own. Load the parent quote's raw
  // deposit_mode/deposit_input (NOT its computed amounts — those are stale
  // the moment a new quote exists) only when this quote actually came from a
  // renegotiation, and let QuoteDetailClient compare it against its own.
  let parentDeposit: { mode: OemDepositMode | null; input: number | null } | null = null;
  if (quoteResult.data.parentQuoteId) {
    const parentResult = await getQuote(quoteResult.data.parentQuoteId);
    if (parentResult.ok) {
      parentDeposit = { mode: parentResult.data.depositMode, input: parentResult.data.depositInput };
    } else {
      console.error("getQuote(parentQuoteId) failed:", parentResult.error);
    }
  }

  return (
    <QuoteDetailClient
      quote={quoteResult.data}
      items={itemsResult.data}
      provinces={provinces}
      sellerProfile={sellerProfile}
      parentDeposit={parentDeposit}
      receipts={receipts}
    />
  );
}
