import { redirect } from "next/navigation";

// `/tiktok` has no view of its own (design §1) — always land on the daily
// dashboard, mirroring the sub-nav's first tab.
export default function TikTokIndexPage() {
  redirect("/tiktok/dashboard");
}
