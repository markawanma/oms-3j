import { Lock } from "lucide-react";
import { getContentEntryQueue, getContentTypes } from "@/lib/actions/content";
import { getEffectiveRole } from "@/lib/auth/role";
import { getDevShopId } from "@/lib/dev/context";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { ContentEntryQueue } from "@/components/domain/marketing/ContentEntryQueue";
import { effectiveDateBangkok } from "@/lib/tiktok/format";

export const dynamic = "force-dynamic";

const HEADER_DATE_FMT = new Intl.DateTimeFormat("th-TH", {
  timeZone: "Asia/Bangkok",
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

// /marketing/content/entry — "อ่านยอด" (design doc ux-content-measurement.md
// §1). A route of its own, not a calendar tab (§1.1: different mental model
// — "บันทึกประจำวันตอนดึก" vs. "วางแผน" — and a separate route means this
// page never pulls in MonthCalendar/MonthTimeline's month-of-data query on
// a possibly-flaky mobile connection at night). Same page shape as
// /marketing/calendar (role gate owner/admin, dynamic = "force-dynamic").
export default async function ContentEntryPage() {
  if ((await getEffectiveRole()) === "staff") {
    return (
      <EmptyState
        icon={Lock}
        title="หน้านี้จำกัดสิทธิ์"
        description="เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่อ่านค่า content ได้"
      />
    );
  }

  let shopId: string;
  try {
    shopId = getDevShopId();
  } catch (err) {
    return <ErrorState message={err instanceof Error ? err.message : "เกิดข้อผิดพลาดที่ไม่คาดคิด"} />;
  }

  const todayTh = effectiveDateBangkok(new Date().toISOString());

  // Independent fetches on purpose (design §1.5's error row): a failure in
  // the read-queue must never block the "+ เพิ่มโพสต์ใหม่วันนี้" widget.
  //
  // 🔴 M4 fix (26 ก.ย. 69): the line this replaced claimed "each action's
  // own try/catch turns a thrown error into {ok:false} rather than
  // rejecting" — NOT true. Both actions call requireOwnerAdmin() ->
  // getEffectiveRole() BEFORE their `try {`, so a session/cookie failure
  // rejects. And unlike the two calendar pages, this call sits outside any
  // try/catch at all (the one above closed already), so a rejection here
  // hits Next's error boundary and takes the whole page — including the
  // "+ เพิ่มโพสต์ใหม่วันนี้" widget the comment says must survive. Catch
  // BOTH so the page degrades the way it claims to.
  const [queueResult, typesResult] = await Promise.all([
    getContentEntryQueue().catch((err) => {
      console.error("getContentEntryQueue failed (non-blocking)", err);
      return { ok: false as const, error: "โหลดคิวอ่านยอดไม่สำเร็จ" };
    }),
    getContentTypes().catch((err) => {
      console.error("getContentTypes failed (non-blocking)", err);
      return { ok: false as const, error: "โหลดประเภทเนื้อหาไม่สำเร็จ" };
    }),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-zinc-900">อ่านยอด content</h1>
        <p className="text-sm text-zinc-500">{HEADER_DATE_FMT.format(new Date())}</p>
      </div>

      <ContentEntryQueue
        shopId={shopId}
        todayTh={todayTh}
        rows={queueResult.ok ? queueResult.data : null}
        queueError={queueResult.ok ? undefined : queueResult.error}
        contentTypes={typesResult.ok ? typesResult.data : []}
      />
    </div>
  );
}
