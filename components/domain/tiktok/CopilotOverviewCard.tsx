// Static H1 2026 context card (design §5: "CopilotOverviewCard (แถบ H1 +
// sparkline)"). Numbers are copied from the approved mockup's "ฐานการวิเคราะห์"
// panel, sourced from docs/3j-jewelry/analytics/sales-2026-h1-summary.md —
// a real historical aggregate, NOT re-derived from live orders on this page.
// Explicitly labeled as static so nobody mistakes it for a live query tied
// to a (currently nonexistent) date filter on this page.

const STATS: { label: string; value: string; sub: string; tone: "up" | "down" | "flat" }[] = [
  { label: "ยอดขาย H1", value: "฿19.8M", sub: "3,823 ออเดอร์", tone: "flat" },
  { label: "ม.ค. เดือนเดียว", value: "62%", sub: "ของทั้งครึ่งปี", tone: "flat" },
  { label: "AOV เปลี่ยน", value: "฿17,106→฿715", sub: "▼ high→low", tone: "down" },
  { label: "ช่องทางเด่น", value: "LINE→TikTok", sub: "TikTok 0→45%", tone: "up" },
];

const SPARK_LINE = "M4,6 L44,34 L84,38 L124,41 L164,40 L204,40 L244,43";
const SPARK_FILL = `${SPARK_LINE} L244,50 L4,50 Z`;

const TONE_CLASS: Record<"up" | "down" | "flat", string> = {
  up: "text-green-600",
  down: "text-slate-500",
  flat: "text-slate-400",
};

export function CopilotOverviewCard() {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-start gap-3.5 px-4 pt-3.5 pb-2.5">
        <div className="min-w-[160px] flex-1">
          <p className="text-[0.68rem] font-bold tracking-wider text-slate-400 uppercase">ฐานการวิเคราะห์ · ม.ค.–ก.ค. 2026</p>
          <p className="mt-0.5 text-base font-bold text-slate-900">ยอดขายครึ่งปีแรก — ภาพเต็มที่คำแนะนำอ้างอิง</p>
        </div>
        <svg
          width={200}
          height={42}
          viewBox="0 0 248 52"
          role="img"
          aria-label="ยอดขายรายเดือนร่วงจาก 12.2 ล้านเหลือ 0.59 ล้าน"
          className="shrink-0"
        >
          <defs>
            <linearGradient id="copilot-overview-spark" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#a2191d" stopOpacity={0.28} />
              <stop offset="1" stopColor="#a2191d" stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={SPARK_FILL} fill="url(#copilot-overview-spark)" />
          <path d={SPARK_LINE} fill="none" stroke="#a2191d" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={4} cy={6} r={3.2} fill="#a2191d" />
          <circle cx={244} cy={43} r={3.2} fill="#a2191d" />
        </svg>
      </div>
      <div className="grid grid-cols-2 gap-px border-t border-slate-200 bg-slate-200 sm:grid-cols-4">
        {STATS.map((s) => (
          <div key={s.label} className="bg-white px-3.5 py-2.5">
            <div className="text-[0.68rem] text-slate-500">{s.label}</div>
            <div className="text-base font-bold text-slate-900 tabular-nums">{s.value}</div>
            <div className={`text-xs font-bold ${TONE_CLASS[s.tone]}`}>{s.sub}</div>
          </div>
        ))}
      </div>
      <p className="border-t border-slate-200 bg-slate-50 px-4 py-2 text-[0.68rem] leading-relaxed text-slate-400">
        ตัวเลข H1 ด้านบนเป็นสรุปสถิตย์ (static) จากไฟล์สรุปยอดขายจริง — ไม่ใช่ query สดของหน้านี้
      </p>
    </div>
  );
}
