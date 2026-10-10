import Link from "next/link";
import { Lock, MessageCircleQuestion } from "lucide-react";
import { canUseContentWorkflow } from "@/lib/marketing/page-gate";
import { logRpcFailure } from "@/lib/marketing/piece-server";
import { getRecoInbox } from "@/lib/actions/content-inbox";
import { EmptyState } from "@/components/ui/EmptyState";
import { AiQuestionList } from "@/components/domain/marketing/workflow/AiQuestionCard";
import { PageError } from "@/components/domain/marketing/workflow/PageError";
import { sortRecoPending } from "@/lib/marketing/inbox-piles";
import type { RecoInboxRow } from "@/lib/marketing/piece-types";

export const dynamic = "force-dynamic";

// /marketing/questions — คำถาม/ข้อเสนอจาก AI ทั้งหมด (§2.3): แท็บ "รอตอบ" | "ตอบแล้ว/หมดเวลา"
export default async function QuestionsPage({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  if (!(await canUseContentWorkflow())) {
    return <EmptyState icon={Lock} title="หน้านี้จำกัดสิทธิ์" description="เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ตอบข้อเสนอจาก AI ได้" />;
  }
  const sp = await searchParams;
  const tabRaw = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  const tab = tabRaw === "done" ? "done" : "pending";

  let res;
  try {
    res = await getRecoInbox();
  } catch (err) {
    logRpcFailure("QuestionsPage", err);
    return <PageError message="โหลดคำถามจาก AI ไม่สำเร็จ ลองใหม่อีกครั้ง" />;
  }
  if (!res.ok) return <PageError message={res.error} />;

  // DB เรียงมาแล้ว (query แยกรอตอบ/ประวัติ) — sortRecoPending คงไว้เป็นด่านสุดท้ายของลำดับแสดงผล
  const pending: RecoInboxRow[] = sortRecoPending(res.data.pending);
  const history: RecoInboxRow[] = res.data.history;
  const list = tab === "pending" ? pending : history;

  const tabCls = (active: boolean) =>
    `inline-flex min-h-11 items-center rounded-md px-3 text-sm font-semibold ${
      active ? "bg-primary-100 text-primary-700" : "text-zinc-700 hover:bg-zinc-100"
    }`;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-zinc-900">คำถามและข้อเสนอจาก AI</h1>

      <nav aria-label="หมวดคำถาม" className="flex gap-1 border-b border-zinc-200 pb-1">
        <Link href="/marketing/questions" aria-current={tab === "pending" ? "page" : undefined} className={tabCls(tab === "pending")}>
          รอตอบ ({pending.length})
        </Link>
        <Link href="/marketing/questions?tab=done" aria-current={tab === "done" ? "page" : undefined} className={tabCls(tab === "done")}>
          ตอบแล้ว/หมดเวลา ({history.length})
        </Link>
      </nav>

      {list.length === 0 ? (
        tab === "pending" ? (
          <EmptyState
            icon={MessageCircleQuestion}
            title="ไม่มีคำถามรอตอบ"
            description="ข้อเสนอชุดถัดไปมากับสรุปรายสัปดาห์"
          />
        ) : (
          <EmptyState icon={MessageCircleQuestion} title="ยังไม่มีประวัติ" description="ข้อเสนอที่ตอบแล้วหรือหมดเวลาจะมาอยู่ตรงนี้" />
        )
      ) : (
        <ul className="space-y-3" aria-live="polite">
          <AiQuestionList rows={list} />
        </ul>
      )}
    </div>
  );
}
