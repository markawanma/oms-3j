import { redirect } from "next/navigation";

// Home ("/") sends the owner straight to /dashboard (เจ้าของสั่ง 10 ก.ย. 69:
// "อยากให้หน้า home เป็นหน้า dashboard แทนหน้าตอนนี้ที่เป็นออเดอร์ ไม่ได้ใช้").
//
// Why a redirect instead of moving the dashboard's code here: /dashboard is
// referenced in five places that would all have to move in lockstep —
// revalidatePath("/dashboard") in import-orders.ts + import-line-items.ts,
// the post-login redirect in (auth)/login/actions.ts, and TWO basePath props
// the date/channel filters use to rebuild their query-string URLs. Getting
// any one of those wrong breaks silently (a filter that navigates to the
// wrong route, or an import that no longer refreshes the numbers it just
// changed). A redirect keeps /dashboard as the single canonical URL and
// touches none of them.
//
// The order queue that used to live here moved to /orders — it reads
// public.orders, which is still empty (all real sales land in
// analytics.fact_order via the Shipnity import), so it renders a blank list
// today. Kept rather than deleted: it is the OMS side of the app and will
// have data once orders are written directly instead of imported.
export default function HomePage() {
  redirect("/dashboard");
}
