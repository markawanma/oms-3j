import Link from "next/link";
import { Link2, Lock, Radar } from "lucide-react";
import { canUseContentWorkflow } from "@/lib/marketing/page-gate";
import { logRpcFailure } from "@/lib/marketing/piece-server";
import { getSignals } from "@/lib/actions/content-signals";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageError } from "@/components/domain/marketing/workflow/PageError";
import { SignalCard } from "@/components/domain/marketing/research/SignalCard";
import { SIGNAL_KINDS, signalKindLabel } from "@/lib/marketing/piece-labels";
import { SIGNAL_STATUSES, SIGNAL_STATUS_LABEL } from "@/lib/marketing/signal-types";

export const dynamic = "force-dynamic";

// /marketing/research — รายการสัญญาณ (ลิงก์ที่แปะ · เทรนด์ · คำถามไลฟ์ ฯลฯ) → หยิบเป็นไอเดีย / ไม่ใช้ / เก็บไว้ก่อน
// กรองด้วยลิงก์ (ค้างใน URL · ไม่ต้องใช้ JS) · ค่าเริ่มต้น "ใหม่" · ?id= = เปิดสัญญาณเดียว (จากลิงก์ "ลิงก์นี้เคยแปะแล้ว")
export default async function ResearchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!(await canUseContentWorkflow())) {
    return <EmptyState icon={Lock} title="หน้านี้จำกัดสิทธิ์" description="เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ดูสัญญาณได้" />;
  }

  const sp = await searchParams;
  let res;
  try {
    res = await getSignals(sp);
  } catch (err) {
    logRpcFailure("ResearchPage", err);
    return <PageError message="โหลดรายการสัญญาณไม่สำเร็จ ลองใหม่อีกครั้ง" />;
  }
  if (!res.ok) return <PageError message={res.error} />;
  const d = res.data;
  const q = d.query;

  const href = (over: { kind?: string; status?: string; page?: number }) => {
    const p = new URLSearchParams();
    const kind = over.kind ?? q.kind;
    const status = over.status ?? q.status;
    if (kind) p.set("kind", kind);
    if (status !== "new") p.set("status", status);
    if ((over.page ?? 1) > 1) p.set("page", String(over.page));
    const qs = p.toString();
    return qs ? `/marketing/research?${qs}` : "/marketing/research";
  };
  const CHIP = (on: boolean) =>
    `inline-flex min-h-11 items-center rounded-full border px-3.5 text-sm font-medium ${on ? "border-primary-600 bg-primary-50 text-primary-800" : "border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50"}`;
  const single = q.id !== "";

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">สัญญาณที่เก็บไว้</h1>
          <p className="text-sm text-zinc-700">ลิงก์ที่เจอ เทรนด์ และคำถามจากไลฟ์ — หยิบเป็นไอเดียเมื่อพร้อม</p>
        </div>
        <Link href="/marketing/research/capture" className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800">
          <Link2 className="h-4 w-4" aria-hidden="true" />
          แปะลิงก์ที่เจอ
        </Link>
      </header>

      {single ? (
        <Link href="/marketing/research" className="inline-flex min-h-11 items-center text-sm font-medium text-primary-700 underline">
          ‹ ดูสัญญาณทั้งหมด
        </Link>
      ) : (
        <>
          <nav aria-label="กรองตามสถานะ" className="flex flex-wrap gap-2">
            {SIGNAL_STATUSES.map((s) => (
              <Link key={s} href={href({ status: s })} aria-current={q.status === s ? "page" : undefined} className={CHIP(q.status === s)}>
                {SIGNAL_STATUS_LABEL[s]}
                {d.counts && <span className="ml-1 tabular-nums">({d.counts[s] ?? 0})</span>}
              </Link>
            ))}
            <Link href={href({ status: "all" })} aria-current={q.status === "all" ? "page" : undefined} className={CHIP(q.status === "all")}>
              ทั้งหมด
            </Link>
          </nav>
          <nav aria-label="กรองตามชนิด" className="flex flex-wrap gap-2">
            <Link href={href({ kind: "" })} aria-current={q.kind === "" ? "page" : undefined} className={CHIP(q.kind === "")}>
              ทุกชนิด
            </Link>
            {SIGNAL_KINDS.map((k) => (
              <Link key={k} href={href({ kind: k })} aria-current={q.kind === k ? "page" : undefined} className={CHIP(q.kind === k)}>
                {signalKindLabel(k)}
              </Link>
            ))}
          </nav>
        </>
      )}

      {d.rows.length === 0 ? (
        <EmptyState
          icon={Radar}
          title={single ? "ไม่พบสัญญาณนี้" : "ยังไม่มีสัญญาณ"}
          description={single ? "สัญญาณนี้อาจถูกลบหรือเป็นของร้านอื่น" : "เจอคลิปที่น่าสนใจ — แปะลิงก์ไว้ก่อน แล้วค่อยมาหยิบเป็นไอเดีย"}
          action={
            <Link href="/marketing/research/capture" className="inline-flex min-h-11 items-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-800 hover:bg-zinc-50">
              แปะลิงก์ที่เจอ
            </Link>
          }
        />
      ) : (
        <>
          <ul className="space-y-3">
            {d.rows.map((s) => (
              <SignalCard key={s.id} signal={s} piece={s.pickedStepId ? d.pieces[s.pickedStepId] : undefined} todayTh={d.todayTh} highlight={single} />
            ))}
          </ul>
          {!single && (
            <nav aria-label="เปลี่ยนหน้า" className="flex items-center justify-between gap-2">
              {q.page > 1 ? (
                <Link href={href({ page: q.page - 1 })} className="inline-flex min-h-11 items-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-800 hover:bg-zinc-50">
                  ‹ หน้าก่อน
                </Link>
              ) : (
                <span />
              )}
              <span className="text-sm text-zinc-700 tabular-nums">หน้า {q.page}</span>
              {d.hasNext ? (
                <Link href={href({ page: q.page + 1 })} className="inline-flex min-h-11 items-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-800 hover:bg-zinc-50">
                  หน้าถัดไป ›
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}
        </>
      )}
    </div>
  );
}
