import { Lock, PackageSearch } from "lucide-react";
import { getMetalPrices, getOemSetting, getRateStatus, getSellerProfile } from "@/lib/actions/oem";
import { getEffectiveRole } from "@/lib/auth/role";
import { EMPTY_SELLER_PROFILE } from "@/lib/oem/sellerProfile";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { RatesPageClient } from "@/components/domain/oem/RatesPageClient";

export const dynamic = "force-dynamic";

// /oem/rates — OEM cost intake (T4, docs/3j-jewelry/marketing/oem-pricing-
// floor.md §6). Owner/admin only: same reasoning as /catalog and /settings —
// these are competitively-sensitive cost numbers, not general shop data.
export default async function OemRatesPage() {
  if ((await getEffectiveRole()) === "staff") {
    return (
      <EmptyState
        icon={Lock}
        title="หน้านี้จำกัดสิทธิ์"
        description="เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ดูและแก้ไขต้นทุนงาน OEM ได้"
      />
    );
  }

  let statusResult, settingResult, metalResult, sellerResult;
  try {
    [statusResult, settingResult, metalResult, sellerResult] = await Promise.all([
      getRateStatus(),
      getOemSetting(),
      getMetalPrices(),
      getSellerProfile(),
    ]);
  } catch (err) {
    return <ErrorState message={err instanceof Error ? err.message : "เกิดข้อผิดพลาดที่ไม่คาดคิด"} />;
  }

  if (!statusResult.ok) return <ErrorState message={statusResult.error} />;
  if (!settingResult.ok) return <ErrorState message={settingResult.error} />;
  if (!metalResult.ok) return <ErrorState message={metalResult.error} />;
  // Degrade, don't take down the whole cost-intake page over this one
  // section — e.g. right after a migration lands, PostgREST's schema cache
  // can lag behind (analytics.v_oem_seller not found yet) even though
  // everything else on this page reads fine. SellerProfileSection shows its
  // own inline error banner instead (see sellerLoadError below).
  if (!sellerResult.ok) console.error("getSellerProfile failed:", sellerResult.error);

  // Defensive only — 0061 seeds oem_rate_def/oem_rate_scope_option globally,
  // so a real shop should never see zero rows. Guards against a broken/empty
  // seed rather than something the owner can fix from this page.
  if (statusResult.data.rows.length === 0) {
    return (
      <EmptyState
        icon={PackageSearch}
        title="ยังไม่มีรายการต้นทุนให้กรอก"
        description="ไม่พบ reference data ของฟอร์มต้นทุน OEM — ตรวจ migration 0061 (oem_rate_def)"
      />
    );
  }

  // H1 fix (security round 2): "today" for the ล็อกราคานี้ไว้วันนี้ button's
  // staleness check MUST be computed here (Server Component, runs on the
  // server) — never `new Date()` client-side, whose local clock/timezone
  // can't be trusted. Matches the DB's own definition of "today"
  // (analytics.production_spot_resolve, 0131: `(now() at time zone
  // 'Asia/Bangkok')::date`) exactly, in the same "YYYY-MM-DD" shape as
  // oem_metal_price.as_of_date, so a plain string compare on the client
  // (MetalPriceSection's `isStale`) is safe.
  const todayBkk = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  return (
    <RatesPageClient
      rows={statusResult.data.rows}
      readiness={statusResult.data.readiness}
      setting={settingResult.data}
      metalPrices={metalResult.data}
      sellerProfile={sellerResult.ok ? sellerResult.data : EMPTY_SELLER_PROFILE}
      sellerLoadError={sellerResult.ok ? null : sellerResult.error}
      todayBkk={todayBkk}
    />
  );
}
