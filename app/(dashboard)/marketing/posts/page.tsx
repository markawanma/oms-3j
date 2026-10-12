import { Link2, Lock, Send } from "lucide-react";
import { canUseContentWorkflow } from "@/lib/marketing/page-gate";
import { logRpcFailure } from "@/lib/marketing/piece-server";
import { getPostsPageData } from "@/lib/actions/content-posts";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageError, SectionError } from "@/components/domain/marketing/workflow/PageError";
import { PileSection } from "@/components/domain/marketing/workflow/InboxSections";
import { PostCard } from "@/components/domain/marketing/workflow/PostCard";
import { OrphanPostList } from "@/components/domain/marketing/posts/OrphanPostCard";
import { TruncatedNotice } from "@/components/domain/marketing/calendar/CalendarNotices";
import { buildPostPile } from "@/lib/marketing/inbox-piles";
import { formatThaiDay } from "@/lib/marketing/format";

export const dynamic = "force-dynamic";

// /marketing/posts — โพสต์วันนี้ + ผูกโพสต์นอกแผน (content-ui-build-plan.md §2.6 ค)
// ส่วนบน: กอง "วันนี้ต้องโพสต์" (ชุดเดียวกับหน้าแรก) · ส่วนล่าง: โพสต์ที่วางลิงก์แล้วแต่ยังไม่ผูกชิ้นงาน → ผูกได้ (DB ตัดสินด่าน)
export default async function PostsPage() {
  if (!(await canUseContentWorkflow())) {
    return <EmptyState icon={Lock} title="หน้านี้จำกัดสิทธิ์" description="เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่จัดการโพสต์ได้" />;
  }

  let res;
  try {
    res = await getPostsPageData();
  } catch (err) {
    logRpcFailure("PostsPage", err);
    return <PageError message="โหลดหน้าโพสต์วันนี้ไม่สำเร็จ ลองใหม่อีกครั้ง" />;
  }
  if (!res.ok) return <PageError message={res.error} />;
  const d = res.data;

  const typeOf = (code: string | null) => (code ? d.contentTypes.find((t) => t.code === code) : undefined);
  const overdue = new Set(d.overdueNoLinkIds);
  const pile = d.postRows.ok ? buildPostPile(d.postRows.data, d.todayTh, overdue) : [];
  const pileCount = d.postCount.ok ? d.postCount.data : pile.length;
  const orphans = d.orphans.ok ? d.orphans.data : null;

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm text-zinc-700">{formatThaiDay(d.todayTh, true)}</p>
        <h1 className="text-2xl font-bold text-zinc-900">โพสต์วันนี้</h1>
      </header>

      {!d.postRows.ok ? (
        <SectionError message={d.postRows.error} />
      ) : pile.length === 0 ? (
        <EmptyState icon={Send} title="ไม่มีชิ้นที่ต้องโพสต์วันนี้" description="ชิ้นที่อนุมัติแล้วและถึงวันโพสต์จะขึ้นที่นี่" />
      ) : (
        <PileSection id="pile-post" title="วันนี้ต้องโพสต์" count={pileCount} shown={pile.length}>
          {pile.map((p) => (
            <PostCard key={p.stepId} piece={p} contentType={typeOf(p.contentTypeCode)} overdueNoLink={overdue.has(p.stepId)} todayTh={d.todayTh} />
          ))}
        </PileSection>
      )}

      <section aria-labelledby="orphan-h" className="space-y-2">
        <h2 id="orphan-h" className="text-lg font-bold text-zinc-900">
          โพสต์ที่ยังไม่ผูกชิ้นงาน
          {orphans && <span className="ml-2 text-sm font-medium text-zinc-700 tabular-nums">({orphans.rows.length})</span>}
        </h2>
        <p className="text-sm text-zinc-700">โพสต์ที่วางลิงก์ไว้แล้วแต่ไม่ได้มาจากชิ้นงานในปฏิทิน — ผูกกับชิ้นงานเพื่อให้วัดผลรายชิ้นได้</p>
        {!d.orphans.ok ? (
          <SectionError message={d.orphans.error} />
        ) : orphans && orphans.rows.length === 0 ? (
          <EmptyState icon={Link2} title="ไม่มีโพสต์ค้างผูก" description="โพสต์ทุกใบผูกกับชิ้นงานแล้ว" />
        ) : (
          <>
            {orphans?.truncated && <TruncatedNotice what="โพสต์" />}
            {!d.candidates.ok && <SectionError message={d.candidates.error} />}
            <OrphanPostList posts={orphans?.rows ?? []} candidates={d.candidates.ok ? d.candidates.data : []} />
          </>
        )}
      </section>
    </div>
  );
}
