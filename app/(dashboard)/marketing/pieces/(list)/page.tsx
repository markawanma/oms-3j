import Link from "next/link";
import { FileSearch, Lock } from "lucide-react";
import { canUseContentWorkflow } from "@/lib/marketing/page-gate";
import { logRpcFailure } from "@/lib/marketing/piece-server";
import { getPiecesList } from "@/lib/actions/content-pieces-list";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageError, SectionError } from "@/components/domain/marketing/workflow/PageError";
import { PieceListRow } from "@/components/domain/marketing/pieces/PieceListRow";
import { CHANNELS, CHANNEL_LABEL } from "@/lib/marketing/piece-labels";
import { PAGE_SIZE, STATUS_CHIP_LABEL, STATUS_KEYS, hasActiveFilter, piecesHref } from "@/lib/marketing/pieces-list";

export const dynamic = "force-dynamic";

// /marketing/pieces — ชิ้นงานทั้งหมด (content-ui-build-plan.md §2.6 ข)
// กรองด้วยฟอร์ม GET ธรรมดา (ไม่ต้องใช้ JS) · ค่าเริ่มต้น "ยังไม่ปิด" · แบ่งหน้า 50 (ไม่มีจำนวนรวม — D15 view ช้า) · รวมชิ้นที่ยกเลิก + กู้คืนได้
const FIELD =
  "min-h-11 w-full rounded-md border border-zinc-300 bg-white px-2.5 text-base text-zinc-900 focus:border-primary-600 focus:outline-none focus:ring-1 focus:ring-primary-600";

export default async function PiecesListPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!(await canUseContentWorkflow())) {
    return <EmptyState icon={Lock} title="หน้านี้จำกัดสิทธิ์" description="เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ดูชิ้นงานทั้งหมดได้" />;
  }

  const sp = await searchParams;
  let res;
  try {
    res = await getPiecesList(sp);
  } catch (err) {
    logRpcFailure("PiecesListPage", err);
    return <PageError message="โหลดรายการชิ้นงานไม่สำเร็จ ลองใหม่อีกครั้ง" />;
  }
  if (!res.ok) return <PageError message={res.error} />;
  const d = res.data;
  const q = d.query;
  const typeOf = (code: string | null) => (code ? d.contentTypes.find((t) => t.code === code) : undefined);
  const filtered = hasActiveFilter(q);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold text-zinc-900">ชิ้นงานทั้งหมด</h1>
        <p className="text-sm text-zinc-700">ค่าเริ่มต้นแสดงเฉพาะชิ้นที่ยังไม่ปิด · เรียงตามวัน</p>
      </header>

      <nav aria-label="กรองตามสถานะ" className="flex flex-wrap gap-2">
        {STATUS_KEYS.map((s) => {
          const on = q.status === s;
          return (
            <Link
              key={s}
              href={piecesHref(q, { status: s, withPosted: false })}
              aria-current={on ? "page" : undefined}
              className={`inline-flex min-h-11 items-center rounded-full border px-3.5 text-sm font-medium ${
                on ? "border-primary-600 bg-primary-50 text-primary-800" : "border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50"
              }`}
            >
              {STATUS_CHIP_LABEL[s]}
            </Link>
          );
        })}
      </nav>

      <form method="get" action="/marketing/pieces" className="grid gap-3 rounded-lg border border-zinc-200 bg-white p-3 sm:grid-cols-2 lg:grid-cols-4">
        {q.status !== "open" && <input type="hidden" name="status" value={q.status} />}
        <div className="sm:col-span-2 lg:col-span-4">
          <label htmlFor="pl-q" className="mb-1 block text-sm font-medium text-zinc-800">
            ค้นชื่อชิ้นงาน
          </label>
          <input id="pl-q" name="q" type="search" defaultValue={q.q} maxLength={80} placeholder="พิมพ์บางส่วนของชื่อ" className={FIELD} />
        </div>
        <div>
          <label htmlFor="pl-campaign" className="mb-1 block text-sm font-medium text-zinc-800">
            แคมเปญ
          </label>
          <select id="pl-campaign" name="campaign" defaultValue={q.campaign} className={FIELD}>
            <option value="">ทั้งหมด</option>
            {d.campaigns.ok && d.campaigns.data.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="pl-channel" className="mb-1 block text-sm font-medium text-zinc-800">
            ช่องทาง
          </label>
          <select id="pl-channel" name="channel" defaultValue={q.channel} className={FIELD}>
            <option value="">ทั้งหมด</option>
            {CHANNELS.map((c) => (
              <option key={c} value={c}>
                {CHANNEL_LABEL[c]}
              </option>
            ))}
          </select>
        </div>
        {q.status === "open" && (
          <label className="flex min-h-11 items-center gap-2 text-sm text-zinc-900 sm:col-span-2">
            <input type="checkbox" name="posted" value="1" defaultChecked={q.withPosted} className="h-5 w-5 accent-primary-600" />
            รวมที่โพสต์แล้ว 60 วันล่าสุด
          </label>
        )}
        <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
          <button
            type="submit"
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary-600 px-4 text-base font-medium text-white hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2"
          >
            กรอง
          </button>
          {filtered && (
            <Link href="/marketing/pieces" className="inline-flex min-h-11 items-center rounded-md border border-zinc-300 bg-white px-4 text-base font-medium text-zinc-800 hover:bg-zinc-50">
              ล้างตัวกรอง
            </Link>
          )}
        </div>
      </form>
      {!d.campaigns.ok && <SectionError message={d.campaigns.error} />}

      {d.rows.length === 0 ? (
        <EmptyState
          icon={FileSearch}
          title="ยังไม่มีชิ้นงานที่ตรงเงื่อนไข"
          description={q.page > 1 ? "หน้านี้ไม่มีรายการแล้ว — กลับไปหน้าแรกของผลลัพธ์" : filtered ? "ลองเปลี่ยนตัวกรอง หรือล้างตัวกรองเพื่อดูชิ้นที่ยังไม่ปิดทั้งหมด" : "ยังไม่มีชิ้นงานที่ยังไม่ปิด"}
          action={
            filtered || q.page > 1 ? (
              <Link href="/marketing/pieces" className="inline-flex min-h-11 items-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-800 hover:bg-zinc-50">
                ล้างตัวกรอง
              </Link>
            ) : undefined
          }
        />
      ) : (
        <>
          <p className="text-sm text-zinc-700 tabular-nums">
            แสดง {(q.page - 1) * PAGE_SIZE + 1}–{(q.page - 1) * PAGE_SIZE + d.rows.length} {d.hasNext ? "(ยังมีหน้าถัดไป)" : ""}
          </p>
          <ul className="space-y-3">
            {d.rows.map((p) => (
              <PieceListRow key={p.stepId} piece={p} contentType={typeOf(p.contentTypeCode)} />
            ))}
          </ul>
          <nav aria-label="เปลี่ยนหน้า" className="flex items-center justify-between gap-2">
            {q.page > 1 ? (
              <Link href={piecesHref(q, { page: q.page - 1 })} className="inline-flex min-h-11 items-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-800 hover:bg-zinc-50">
                ‹ หน้าก่อน
              </Link>
            ) : (
              <span />
            )}
            <span className="text-sm text-zinc-700 tabular-nums">หน้า {q.page}</span>
            {d.hasNext ? (
              <Link href={piecesHref(q, { page: q.page + 1 })} className="inline-flex min-h-11 items-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-800 hover:bg-zinc-50">
                หน้าถัดไป ›
              </Link>
            ) : (
              <span />
            )}
          </nav>
        </>
      )}
    </div>
  );
}
