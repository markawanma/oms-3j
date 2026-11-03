"use client";

// components/domain/marketing/RingSizeStats.tsx — เปลือก client ของหน้าสรุป /marketing/ring-size (P3)
// สเปค: docs/3j-jewelry/oms/ux-ring-size-stats.md §4 §9 §12 (D14: แถบกรอง + เนื้อหาอยู่ใน shell เดียว เพื่อให้แถบกรองรอดทุก state)
//
// หน้านี้ read-only: ไม่มี network call ของตัวเอง — ข้อมูลมาจาก server page เท่านั้น (เปลี่ยนตัวกรอง = router.push → page เรียก action ใหม่)
// state: error / empty (3 แบบ) / ข้อมูลน้อย (<30) / success — ทุก state เห็นแถบกรองเสมอ (บทเรียน gem quiz S3)
// ตัวเลขทุกตัวมาจาก RPC — ที่นี่หาร/เรียง/รวมเพื่อแสดงเท่านั้น
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { thaiDate } from "@/lib/jobs/dates";
import { RING_STATS_MIN_N, formatInt } from "@/lib/marketing/ring-size-format";
import { inclusiveDays, rangeFromDataSince, ringSizeHref, type RingSizeFilters } from "@/lib/marketing/ring-size-filters";
import type { RingSizeStats as RingSizeStatsData } from "@/lib/marketing/ring-size-stats";
import { ChannelTable } from "@/components/domain/marketing/ring-size/ChannelTable";
import { CircHistogram } from "@/components/domain/marketing/ring-size/CircHistogram";
import { DailyList } from "@/components/domain/marketing/ring-size/DailyList";
import { FrictionTable } from "@/components/domain/marketing/ring-size/FrictionTable";
import { FunnelList } from "@/components/domain/marketing/ring-size/FunnelList";
import { MethodComparison } from "@/components/domain/marketing/ring-size/MethodComparison";
import { ReadingNotes } from "@/components/domain/marketing/ring-size/ReadingNotes";
import { RingSizeFilterBar } from "@/components/domain/marketing/ring-size/RingSizeFilterBar";
import { SizeDistribution } from "@/components/domain/marketing/ring-size/SizeDistribution";
import { SummaryTiles } from "@/components/domain/marketing/ring-size/SummaryTiles";

/** ปลายทางของปุ่ม "ขยายเป็น 90 วัน" (ตรงกับ ringSizeHref({ range: "90d" })) */
const EXPAND_TARGET_DAYS = 90;

export type RingSizeStatsResult = { ok: true; data: RingSizeStatsData } | { ok: false; error: string };

export function RingSizeStats({
  result,
  filters,
  today,
  notices,
}: {
  result: RingSizeStatsResult;
  filters: RingSizeFilters;
  /** วันนี้ตามเวลาไทย (server คำนวณ — client ไม่คิดเอง กันเครื่องผู้ใช้ตั้งเวลาเพี้ยน) */
  today: string;
  /** ข้อความที่ server ปรับ URL ให้ (ห้ามปรับเงียบ) */
  notices: readonly string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const navigate = (href: string) => startTransition(() => router.push(href));
  const retry = () => startTransition(() => router.refresh());

  const stats = result.ok ? result.data : null;

  return (
    <div className="space-y-4" aria-busy={pending}>
      <div>
        <h1 className="text-lg font-bold text-zinc-900">สถิติไซส์แหวน</h1>
        <p className="text-sm text-zinc-600">
          ไม่ระบุตัวตน · นับเป็น "ครั้งที่เปิดใช้" ไม่ใช่จำนวนคน
          {stats && (
            <>
              {" "}
              —{" "}
              <a href="#rs-notes-heading" className="underline underline-offset-2">
                อ่านวิธีนับ
              </a>
            </>
          )}
        </p>
      </div>

      <RingSizeFilterBar filters={filters} today={today} dataSince={stats?.dataSince ?? null} pending={pending} onNavigate={navigate} />

      {notices.length > 0 && (
        <div role="status" className="space-y-0.5 rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
          {notices.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </div>
      )}

      <div className={`space-y-4 ${pending ? "opacity-60" : ""}`}>
        {!result.ok ? (
          <div className="space-y-3">
            <ErrorState message={result.error} />
            <div className="flex justify-center">
              <Button variant="secondary" onClick={retry} loading={pending}>
                ลองใหม่
              </Button>
            </div>
          </div>
        ) : (
          <StatsBody stats={result.data} filters={filters} today={today} onNavigate={navigate} />
        )}
      </div>
    </div>
  );
}

function StatsBody({
  stats,
  filters,
  today,
  onNavigate,
}: {
  stats: RingSizeStatsData;
  filters: RingSizeFilters;
  today: string;
  onNavigate: (href: string) => void;
}) {
  if (stats.sessions === 0) {
    return (
      <>
        <EmptyRange stats={stats} filters={filters} today={today} onNavigate={onNavigate} />
        <ReadingNotes />
      </>
    );
  }

  const lowData = stats.sessions < RING_STATS_MIN_N;
  const partialData = stats.dataSince !== null && stats.dataSince > filters.from;

  return (
    <>
      {lowData && (
        <div role="status" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p className="font-semibold">ข้อมูลยังน้อย — เปิดใช้เพียง {formatInt(stats.sessions)} ครั้ง</p>
          <p>โชว์เป็นจำนวนครั้ง · เปอร์เซ็นต์จะขึ้นเมื่อฐานที่ใช้หารมีอย่างน้อย {RING_STATS_MIN_N} ครั้ง</p>
        </div>
      )}
      {partialData && stats.dataSince && (
        <p role="status" className="rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
          เริ่มมีข้อมูลตั้งแต่ {thaiDate(stats.dataSince)} — ก่อนหน้านั้นยังไม่ได้เก็บ
        </p>
      )}
      <SummaryTiles stats={stats} />
      <SizeDistribution stats={stats} />
      <MethodComparison stats={stats} />
      <FunnelList stats={stats} />
      <ChannelTable stats={stats} />
      <FrictionTable stats={stats} />
      <DailyList stats={stats} from={filters.from} />
      <CircHistogram stats={stats} />
      <ReadingNotes />
    </>
  );
}

/** sessions = 0 — 3 แบบ (ไม่เคยมีข้อมูล / ช่วงอยู่ก่อนเริ่มเก็บ / ช่วงนี้ว่าง) · แถบกรองอยู่บนสุดเสมอ จึงขยายช่วงเองได้ */
function EmptyRange({
  stats,
  filters,
  today,
  onNavigate,
}: {
  stats: RingSizeStatsData;
  filters: RingSizeFilters;
  today: string;
  onNavigate: (href: string) => void;
}) {
  if (stats.dataSince === null) {
    return (
      <EmptyState
        icon={BarChart3}
        title="ยังไม่มีคนใช้เครื่องมือวัดไซส์"
        description="สถิติจะขึ้นเมื่อมีคนเริ่มใช้ — ถ้ารอนานผิดปกติ แจ้งทีมพัฒนาให้ตรวจว่าเปิดเก็บสถิติแล้วหรือยัง"
      />
    );
  }
  if (stats.dataSince > filters.to) {
    const r = rangeFromDataSince(stats.dataSince, today);
    return (
      <EmptyState
        icon={BarChart3}
        title="ช่วงนี้อยู่ก่อนวันที่เริ่มเก็บข้อมูล"
        description={`เริ่มเก็บข้อมูลวันที่ ${thaiDate(stats.dataSince)}`}
        action={
          <Button variant="secondary" onClick={() => onNavigate(ringSizeHref({ range: "custom", from: r.from, to: r.to }))}>
            ดูตั้งแต่ {thaiDate(r.from)}
          </Button>
        }
      />
    );
  }
  // โชว์ปุ่มเฉพาะเมื่อขยายได้จริง: ช่วงปัจจุบัน (นับวัน รวมช่วง "กำหนดเอง") สั้นกว่า 90 วัน — ไม่งั้นกดแล้วหดลง
  const canExpand = inclusiveDays(filters.from, filters.to) < EXPAND_TARGET_DAYS;
  return (
    <EmptyState
      icon={BarChart3}
      title="ไม่มีการใช้งานในช่วงที่เลือก"
      description="ลองขยายช่วงเวลา หรือกลับมาดูใหม่เมื่อมีคนใช้เครื่องมือวัดไซส์มากขึ้น"
      action={
        canExpand ? (
          <Button variant="secondary" onClick={() => onNavigate(ringSizeHref({ range: "90d" }))}>
            ขยายเป็น 90 วัน
          </Button>
        ) : undefined
      }
    />
  );
}
