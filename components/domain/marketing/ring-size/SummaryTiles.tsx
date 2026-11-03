import { StatCard } from "@/components/ui/StatCard";
import { countPct, formatInt } from "@/lib/marketing/ring-size-format";
import type { RingSizeStats } from "@/lib/marketing/ring-size-stats";

// ux-ring-size-stats.md §7.1 — 3 ตัวเลขแรกที่เจ้าของดู
// - "ครั้งที่เปิดใช้" ไม่ใช่คน (session ตายตามแท็บ)
// - "วัดได้เบอร์" ใช้ measured (ไม่ใช่ funnel[7] ซึ่งรวมหน้า "ค่าวัดผิดปกติ")
// - "กดปุ่ม LINE" = cta.line นับเฉพาะปุ่มหน้าผล (ลิงก์ช่วยเหลือตามจอไม่นับ) ⇒ ขั้นต่ำเสมอ · ไม่โชว์ % (ฐานที่ถูกไม่ใช่ measured)
//   และไม่มีอะไรที่จับคู่รายคนกับแชท LINE
const SUB = "text-zinc-600";

export function SummaryTiles({ stats }: { stats: RingSizeStats }) {
  const measuredPct = countPct(stats.measured, stats.sessions);
  const measuredSub =
    measuredPct.kind === "pct"
      ? `${measuredPct.label} ของที่เปิด`
      : measuredPct.kind === "low"
        ? `จาก ${formatInt(measuredPct.base)} ที่เปิด`
        : "—";

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <StatCard
          label="เปิดใช้ (ครั้ง)"
          value={<span className="text-xl sm:text-2xl">{formatInt(stats.sessions)}</span>}
          tone="brand"
          sub={<span className={SUB}>เคยใช้ในเครื่องนี้มาก่อน {formatInt(stats.returning)} ครั้ง</span>}
        />
        <StatCard label="วัดได้เบอร์" value={<span className="text-xl sm:text-2xl">{formatInt(stats.measured)}</span>} sub={<span className={SUB}>{measuredSub}</span>} />
        <StatCard
          label="กดปุ่ม LINE"
          value={<span className="text-xl sm:text-2xl">{stats.cta ? formatInt(stats.cta.line) : "—"}</span>}
          sub={<span className={SUB}>ขั้นต่ำ — อาจนับขาดบางครั้ง</span>}
        />
      </div>
      {stats.cta && (
        <p className="text-xs text-zinc-600">
          หลังเห็นผล (ขั้นต่ำเช่นกัน): แชร์ผล {formatInt(stats.cta.share)} · ดูหน้าร้าน {formatInt(stats.cta.shop)} · เกมพลอย{" "}
          {formatInt(stats.cta.gemQuiz)}
        </p>
      )}
    </div>
  );
}
