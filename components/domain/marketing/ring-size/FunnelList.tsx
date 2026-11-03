import { Badge } from "@/components/ui/Badge";
import { RelativeBar } from "@/components/ui/RelativeBar";
import { countWithBase, formatInt, maxAbandonStages, pctText } from "@/lib/marketing/ring-size-format";
import { stageAbandonLabel, stageNumber, stageReachedLabel } from "@/lib/marketing/ring-size-labels";
import type { RingSizeStats } from "@/lib/marketing/ring-size-stats";
import { NoData, StatsCard } from "./StatsCard";

// ux-ring-size-stats.md §7.4 — คนเลิกกลางทางที่ไหน · <ol> ทุกขนาดจอ (ลำดับขั้น = รายการเรียงลำดับ ไม่ใช่ตารางหลายมิติ)
// ฐานเดียว = เปิดใช้ (sessions) ทั้ง "ไปถึง" และ "เลิก" · เลขขั้นบนจอ = stage + 1 (stageNumber ที่เดียว) · ไม่มีรหัสขั้นของระบบบนจอ
// stage 7 (ถึงหน้าผลลัพธ์) รวมหน้า "ค่าวัดผิดปกติ" ⇒ "ได้เบอร์" ใช้ measured เสมอ ไม่ใช้ funnel[7]

export function FunnelList({ stats }: { stats: RingSizeStats }) {
  const { funnel, abandonAt, sessions, measured } = stats;
  const base = `จากเปิดใช้ ${formatInt(sessions)} ครั้ง`;
  if (!funnel || !abandonAt) {
    return (
      <StatsCard id="rs-funnel" title="คนเลิกกลางทางที่ไหน" base={base}>
        <NoData />
      </StatsCard>
    );
  }
  const stopMost = new Set(maxAbandonStages(abandonAt, sessions));
  const last = funnel.length - 1;

  return (
    <StatsCard id="rs-funnel" title="คนเลิกกลางทางที่ไหน" base={base}>
      <ol className="space-y-2">
        {funnel.map((reached, stage) => {
          const abandonLabel = stageAbandonLabel(stage);
          const abandoned = stage < abandonAt.length ? abandonAt[stage] : null;
          return (
            <li key={stage} className="rounded-md border border-zinc-100 p-2">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <p className="min-w-0 break-words text-sm font-medium text-zinc-800">
                  <span className="tabular-nums">{stageNumber(stage)}</span> {stageReachedLabel(stage)}
                </p>
                <p className="text-sm tabular-nums text-zinc-800">
                  <span className="font-semibold">{formatInt(reached)}</span>{" "}
                  <span className="text-zinc-600">{pctText(reached, sessions)}</span>
                </p>
              </div>
              <RelativeBar value={reached} max={sessions} className="my-1.5" />
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-xs text-zinc-600">
                {abandoned !== null && abandonLabel ? (
                  <p className="min-w-0 break-words">
                    {abandonLabel}: <span className="tabular-nums">{countWithBase(abandoned, sessions)}</span>
                  </p>
                ) : (
                  <p>(จบ ไม่นับเป็นเลิก)</p>
                )}
                {stopMost.has(stage) && <Badge tone="amber">หยุดมากสุด</Badge>}
              </div>
              {stage === last && (
                <p className="mt-1 text-xs text-zinc-600">
                  └ ได้เบอร์ <span className="tabular-nums">{formatInt(measured)}</span> · ที่เหลือคือหน้า "ค่าวัดผิดปกติ"
                </p>
              )}
            </li>
          );
        })}
      </ol>
      <p className="text-xs text-zinc-600">
        คนที่เคยเทียบจอไว้ในเครื่องเดิมข้ามขั้น 3–5 ไปเลย จึงนับว่าผ่านขั้นเหล่านั้นแล้ว · "เลิก" = ปิดหน้า/ออกไปโดยไม่ไปต่อ
        ถ้ากลับมาใหม่นับเป็นครั้งใหม่
      </p>
    </StatsCard>
  );
}
