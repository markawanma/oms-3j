import Link from "next/link";
import { Clapperboard, Lock } from "lucide-react";
import { getEffectiveRole } from "@/lib/auth/role";
import { getShootData } from "@/lib/actions/content-shoot";
import { getContentTypes } from "@/lib/actions/content";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageError } from "@/components/domain/marketing/workflow/PageError";
import { ShootBoard } from "@/components/domain/marketing/shoot/ShootBoard";
import { TruncatedNotice } from "@/components/domain/marketing/calendar/CalendarNotices";
import { shootWeekFrom, shootWeekHref, shootWeekLabel, toShootItems } from "@/lib/marketing/shoot";
import type { ContentTypeOption } from "@/lib/marketing/piece-types";

export const dynamic = "force-dynamic";

// /marketing/shoot — รอบถ่ายสัปดาห์ (content-ui-build-plan.md §4 P1b ข้อ 3)
// เฉพาะชิ้น approved + needs_shoot ของสัปดาห์ (ไม่มี in_review) · จัดกลุ่มตามสถานที่ · จบรอบ = ผลิตแล้ว
export default async function ShootPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if ((await getEffectiveRole()) === "staff") {
    return <EmptyState icon={Lock} title="หน้านี้จำกัดสิทธิ์" description="เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ดูรอบถ่ายได้" />;
  }

  const sp = await searchParams;
  const wRaw = Array.isArray(sp.w) ? sp.w[0] : sp.w;

  let res;
  try {
    res = await getShootData(wRaw);
  } catch (err) {
    console.error("ShootPage failed", { message: err instanceof Error ? err.message : "unknown" });
    return <PageError message="โหลดรอบถ่ายไม่สำเร็จ ลองใหม่อีกครั้ง" />;
  }
  if (!res.ok) return <PageError message={res.error} />;
  const d = res.data;

  const typesRes = await getContentTypes().catch(() => ({ ok: false as const, error: "" }));
  const types: ContentTypeOption[] = typesRes.ok ? typesRes.data.map((c) => ({ code: c.code, labelTh: c.labelTh, colorHex: c.colorHex })) : [];

  const items = toShootItems(d.rows);
  const prev = shootWeekHref(d.weekFrom, -1, d.todayTh);
  const next = shootWeekHref(d.weekFrom, 1, d.todayTh);
  const here = d.weekFrom === shootWeekFrom(d.todayTh, null) ? "/marketing/shoot" : `/marketing/shoot?w=${d.weekFrom}`;
  const NAV_LINK = "inline-flex min-h-11 items-center rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 hover:bg-zinc-50 print:hidden";

  return (
    <div className="space-y-4">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold text-zinc-900">รอบถ่ายสัปดาห์ {shootWeekLabel(d.weekFrom)}</h1>
        <nav aria-label="เลือกสัปดาห์" className="flex flex-wrap gap-2">
          {prev && (
            <Link href={prev} className={NAV_LINK}>
              ‹ สัปดาห์ก่อน
            </Link>
          )}
          {here !== "/marketing/shoot" && (
            <Link href="/marketing/shoot" className={NAV_LINK}>
              สัปดาห์นี้
            </Link>
          )}
          {next && (
            <Link href={next} className={NAV_LINK}>
              สัปดาห์ถัดไป ›
            </Link>
          )}
        </nav>
      </header>

      {d.truncated && <TruncatedNotice what="ชิ้นที่ต้องถ่าย" />}

      {items.length === 0 ? (
        <EmptyState
          icon={Clapperboard}
          title="ไม่มีชิ้นที่ต้องถ่ายในสัปดาห์นี้"
          description="ชิ้นที่อนุมัติแล้วและยังมีสถานะ “ต้องถ่าย” ในสัปดาห์นี้จะขึ้นที่นี่ — ชิ้นที่ยังรอตรวจยังไม่อยู่ในรอบถ่าย"
          action={
            <Link href="/marketing/calendar" className="inline-flex min-h-11 items-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-800 hover:bg-zinc-50">
              ไปดูปฏิทิน
            </Link>
          }
        />
      ) : (
        <ShootBoard key={d.weekFrom} items={items} contentTypes={types} todayTh={d.todayTh} shareUrlPath={here} />
      )}
    </div>
  );
}
