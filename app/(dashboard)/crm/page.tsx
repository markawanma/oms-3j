import { redirect } from "next/navigation";

// `/crm` has no view of its own (mirrors app/(dashboard)/tiktok/page.tsx) —
// always land on the brand overview, the sub-nav's first tab.
export default function CrmIndexPage() {
  redirect("/crm/overview");
}
