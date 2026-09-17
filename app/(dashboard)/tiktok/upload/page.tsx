import { getCrmEditOptions } from "@/lib/actions/crm";
import { getEffectiveRole } from "@/lib/auth/role";
import { UploadPageClient } from "@/components/domain/tiktok/UploadPageClient";

// canEdit / provinces — same pattern as app/(dashboard)/crm/customers/[id]/
// page.tsx: fetch once server-side, thread down as props, instead of every
// Phase A interactive piece (queue rows, ProvinceFixPanel) re-fetching the
// same 77-province reference list client-side. Falls back to [] when the
// fetch fails (or the caller is staff) rather than rendering broken empty
// dropdowns — UploadPageClient/its children disable the write controls
// accordingly (canEdit=false), same as requireOwnerAdmin() re-checks
// server-side on every action anyway.
export default async function TikTokUploadPage() {
  const canEdit = (await getEffectiveRole()) !== "staff";
  const editOptionsResult = canEdit ? await getCrmEditOptions() : null;
  const provinces = editOptionsResult && editOptionsResult.ok ? editOptionsResult.data.provinces : [];

  return <UploadPageClient provinces={provinces} canEdit={canEdit} />;
}
