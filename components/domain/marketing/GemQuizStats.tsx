"use client";

// components/domain/marketing/GemQuizStats.tsx — หน้าสถิติภายใน /marketing/
// gem-quiz (design doc §7, docs/3j-jewelry/analytics/design-gem-quiz.md).
// Presentational เท่านั้น — ตัวเลขทุกตัวมาจาก analytics.gem_quiz_stats (RPC
// รวมใน DB แล้ว, F14: PostgREST ตัด 1000 แถวเงียบ ห้ามดึงแถวดิบมารวมในนี้) ·
// การคำนวณในไฟล์นี้มีแค่การจัดกลุ่ม/ปัดเศษเพื่อ "แสดงผล" (เช่น % ของ agreement,
// รวม count ตาม price_group) ไม่ใช่การคิดตัวเลขทางธุรกิจใหม่.
//
// 🔴 ตัวกรอง "แหล่งที่มา" (card/share/live/direct) ที่ design §7 ระบุไว้ **ไม่
// ได้ทำในรอบนี้** — เช็คโค้ดจริงแล้ว lib/actions/gem-quiz-stats.ts's
// GetGemQuizStatsInput และ RPC analytics.gem_quiz_stats (§3.4 ของ design)
// ไม่มี parameter กรองตาม src เลย มีแค่ from/to/includeRetake จะกรองฝั่ง
// client จาก respondents/bySrc/daily/agreement ที่เป็นผลรวมทั้งหมดไปแล้วจะทำ
// ให้ตัวเลขที่ UI โชว์ "ไม่สมเหตุผลกับตัวกรองที่เลือก" (เช่น n ไม่ขยับตามตัว
// กรอง) ซึ่งหลอกผู้ใช้มากกว่าการไม่มีตัวกรองเลย — จึงตัดออกและรายงานกลับ
// (ต้องแก้ RPC ก่อนถึงจะเพิ่มตัวกรองนี้ได้จริง). ส่วนการ "แยก card vs share"
// ที่ design ต้องการ (item 4) ยังทำได้เต็มที่ด้วย bySrc/bySrcLiked ที่ RPC
// คืนมาอยู่แล้ว ไม่ต้องพึ่งตัวกรองนี้.
import { useRouter } from "next/navigation";
import { StatCard } from "@/components/ui/StatCard";
import { Badge } from "@/components/ui/Badge";
import { GEM_QUIZ_QUESTIONS, GEM_QUIZ_STONES } from "@/lib/gem-quiz/config";
import type {
  GemQuizCrosstabRow,
  GemQuizSrc,
  GemQuizStats as GemQuizStatsData,
  GemQuizStoneCount,
} from "@/lib/actions/gem-quiz-stats";

const MIN_RESPONDENTS_FOR_CONFIDENCE = 30; // pattern เดียวกับ content-kpi-screen-design.md

const SRC_LABEL: Record<GemQuizSrc, string> = {
  card: "การ์ด (ซื้อแล้ว)",
  share: "เพื่อนที่ถูกชวน",
  live: "ไลฟ์",
  direct: "เข้าตรง",
};

function optionLabel(questionCode: string, optionCode: string): string {
  const question = GEM_QUIZ_QUESTIONS.find((q) => q.code === questionCode);
  return question?.options.find((o) => o.code === optionCode)?.labelTh ?? optionCode;
}

function questionLabel(questionCode: string): string {
  return GEM_QUIZ_QUESTIONS.find((q) => q.code === questionCode)?.labelTh ?? questionCode;
}

function stoneLabel(stoneCode: string): string {
  return GEM_QUIZ_STONES.find((s) => s.code === stoneCode)?.labelTh ?? stoneCode;
}

/** แท่ง % แบบเดียวกับ ContentKpiPanel's ProgressBar — ย้ำ pattern เดิมในโมดูล
 * นี้แทนเพิ่ม chart library (design §7 "ไม่ต้องเพิ่ม chart library"). */
function PercentBar({ label, count, denominator }: { label: string; count: number; denominator: number }) {
  const pct = denominator > 0 ? Math.min(100, Math.round((count / denominator) * 100)) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium text-zinc-700">{label}</span>
        <span className="tabular-nums text-zinc-500">
          {count} ({pct}%)
        </span>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-zinc-200"
        role="progressbar"
        aria-valuenow={count}
        aria-valuemin={0}
        aria-valuemax={denominator}
        aria-label={label}
      >
        <div className="h-full rounded-full bg-primary-600" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function StoneCountList({ title, rows, denominator, multiSelectNote }: { title: string; rows: GemQuizStoneCount[]; denominator: number; multiSelectNote?: boolean }) {
  const sorted = [...rows].sort((a, b) => b.count - a.count);
  return (
    <section className="space-y-2.5 rounded-lg border border-zinc-200 bg-white p-3.5">
      <h3 className="text-sm font-bold text-zinc-800">{title}</h3>
      {multiSelectNote && <p className="text-xs text-zinc-400">เลือกได้หลายตัว — % รวมกันเกิน 100% ได้</p>}
      {sorted.length === 0 ? (
        <p className="text-sm text-zinc-400">ยังไม่มีข้อมูล</p>
      ) : (
        <div className="space-y-2">
          {sorted.map((row) => (
            <PercentBar key={row.code} label={row.labelTh} count={row.count} denominator={denominator} />
          ))}
        </div>
      )}
    </section>
  );
}

export function GemQuizStats({
  stats,
  filters,
}: {
  stats: GemQuizStatsData;
  filters: { from: string; to: string; includeRetake: boolean };
}) {
  const router = useRouter();

  function navigate(next: Partial<{ from: string; to: string; includeRetake: boolean }>) {
    const merged = { ...filters, ...next };
    const params = new URLSearchParams({ from: merged.from, to: merged.to });
    if (merged.includeRetake) params.set("retake", "1");
    router.push(`/marketing/gem-quiz?${params.toString()}`);
  }

  const priceGroupTotals = { 1: 0, 2: 0 };
  for (const row of stats.liked) priceGroupTotals[row.priceGroup] += row.count;

  const bySrcLikedByStone = new Map<string, { card: number; share: number }>();
  for (const row of stats.bySrcLiked) {
    if (row.src !== "card" && row.src !== "share") continue;
    const entry = bySrcLikedByStone.get(row.code) ?? { card: 0, share: 0 };
    entry[row.src] = row.count;
    bySrcLikedByStone.set(row.code, entry);
  }

  const crosstabByQuestion = new Map<string, GemQuizCrosstabRow[]>();
  for (const row of stats.crosstab) {
    const list = crosstabByQuestion.get(row.questionCode) ?? [];
    list.push(row);
    crosstabByQuestion.set(row.questionCode, list);
  }

  const agreementPct = stats.agreement.eligible > 0 ? Math.round((stats.agreement.recommendedInLiked / stats.agreement.eligible) * 100) : null;

  const maxDaily = stats.daily.reduce((max, d) => Math.max(max, d.count), 0);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-zinc-900">สถิติแบบทดสอบเลือกพลอย</h1>
        <p className="text-sm text-zinc-500">
          ผู้ตอบจากการ์ด (card) คือคนที่ซื้อไปแล้ว — ไม่ใช่ตลาดทั้งหมด ตีความคู่กับจำนวน n เสมอ
        </p>
      </div>

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => e.preventDefault()}
        aria-label="ตัวกรองสถิติแบบทดสอบพลอย"
      >
        <label className="flex flex-col gap-1 text-xs font-semibold text-zinc-600">
          ตั้งแต่
          <input
            type="date"
            value={filters.from}
            max={filters.to}
            onChange={(e) => e.target.value && navigate({ from: e.target.value })}
            className="min-h-11 rounded-md border border-zinc-300 px-2.5 text-sm text-zinc-900"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-zinc-600">
          ถึง
          <input
            type="date"
            value={filters.to}
            min={filters.from}
            onChange={(e) => e.target.value && navigate({ to: e.target.value })}
            className="min-h-11 rounded-md border border-zinc-300 px-2.5 text-sm text-zinc-900"
          />
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm font-medium text-zinc-700">
          <input
            type="checkbox"
            checked={filters.includeRetake}
            onChange={(e) => navigate({ includeRetake: e.target.checked })}
            className="h-4 w-4"
          />
          รวมคนที่ทำซ้ำ
        </label>
      </form>

      <div className="flex items-center gap-2">
        <StatCard label="จำนวนผู้ตอบ" value={stats.respondents} tone="brand" />
        {stats.respondents < MIN_RESPONDENTS_FOR_CONFIDENCE && <Badge tone="amber">ข้อมูลยังน้อย</Badge>}
      </div>

      <StoneCountList title="พลอยที่ชอบ (Q1)" rows={stats.liked} denominator={stats.respondents} multiSelectNote />
      {stats.likedNone > 0 && (
        <p className="text-xs text-zinc-400">
          "ยังไม่มีในใจ": {stats.likedNone} คน ({stats.respondents > 0 ? Math.round((stats.likedNone / stats.respondents) * 100) : 0}%)
        </p>
      )}

      <section className="space-y-2.5 rounded-lg border border-zinc-200 bg-white p-3.5">
        <h3 className="text-sm font-bold text-zinc-800">แยกตามกลุ่มราคา (Q1)</h3>
        <PercentBar label="กลุ่ม 1" count={priceGroupTotals[1]} denominator={stats.respondents} />
        <PercentBar label="กลุ่ม 2" count={priceGroupTotals[2]} denominator={stats.respondents} />
      </section>

      <StoneCountList title="พลอยที่ระบบแนะนำ" rows={stats.recommended} denominator={stats.respondents} />

      <section className="space-y-2.5 rounded-lg border border-zinc-200 bg-white p-3.5">
        <h3 className="text-sm font-bold text-zinc-800">ผู้ซื้อแล้ว (การ์ด) เทียบ เพื่อนที่ถูกชวน (แชร์)</h3>
        {bySrcLikedByStone.size === 0 ? (
          <p className="text-sm text-zinc-400">ยังไม่มีข้อมูล</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold text-zinc-500">
                <th className="py-1">พลอย</th>
                <th className="py-1 text-right">การ์ด</th>
                <th className="py-1 text-right">แชร์</th>
              </tr>
            </thead>
            <tbody>
              {[...bySrcLikedByStone.entries()]
                .sort((a, b) => b[1].card + b[1].share - (a[1].card + a[1].share))
                .map(([code, counts]) => (
                  <tr key={code} className="border-t border-zinc-100">
                    <td className="py-1.5 text-zinc-700">{stoneLabel(code)}</td>
                    <td className="py-1.5 text-right tabular-nums text-zinc-700">{counts.card}</td>
                    <td className="py-1.5 text-right tabular-nums text-zinc-700">{counts.share}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
        <p className="text-xs text-zinc-400">
          ทั้งหมด — การ์ด {stats.bySrc.card} · แชร์ {stats.bySrc.share} · ไลฟ์ {stats.bySrc.live} · เข้าตรง {stats.bySrc.direct}
        </p>
      </section>

      <section className="space-y-3 rounded-lg border border-zinc-200 bg-white p-3.5">
        <h3 className="text-sm font-bold text-zinc-800">ระบบแนะนำตรงกับที่ชอบ</h3>
        {agreementPct === null ? (
          <p className="text-sm text-zinc-400">ยังไม่มีคนที่ตอบ Q1 ไว้ให้เทียบ</p>
        ) : (
          <PercentBar label="ตรงกับที่ชอบ" count={stats.agreement.recommendedInLiked} denominator={stats.agreement.eligible} />
        )}
      </section>

      <section className="space-y-2.5 rounded-lg border border-zinc-200 bg-white p-3.5">
        <h3 className="text-sm font-bold text-zinc-800">พลอยที่ชอบ × คำถามแนะนำ</h3>
        {crosstabByQuestion.size === 0 ? (
          <p className="text-sm text-zinc-400">ยังไม่มีข้อมูล</p>
        ) : (
          <div className="space-y-4">
            {[...crosstabByQuestion.entries()].map(([questionCode, rows]) => (
              <div key={questionCode}>
                <p className="text-xs font-semibold text-zinc-600">{questionLabel(questionCode)}</p>
                <table className="mt-1 w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs font-semibold text-zinc-500">
                      <th className="py-1">ตัวเลือก</th>
                      <th className="py-1">พลอยที่ชอบ</th>
                      <th className="py-1 text-right">จำนวน</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows
                      .sort((a, b) => b.count - a.count)
                      .map((row, idx) => (
                        <tr key={`${row.optionCode}-${row.stoneCode}-${idx}`} className="border-t border-zinc-100">
                          <td className="py-1.5 text-zinc-700">{optionLabel(row.questionCode, row.optionCode)}</td>
                          <td className="py-1.5 text-zinc-700">{stoneLabel(row.stoneCode)}</td>
                          <td className="py-1.5 text-right tabular-nums text-zinc-700">{row.count}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2 rounded-lg border border-zinc-200 bg-white p-3.5">
        <h3 className="text-sm font-bold text-zinc-800">รายวัน</h3>
        {stats.daily.length === 0 ? (
          <p className="text-sm text-zinc-400">ยังไม่มีข้อมูล</p>
        ) : (
          <div className="space-y-1.5">
            {stats.daily.map((d) => (
              <div key={d.date} className="flex items-center gap-2 text-xs">
                <span className="w-20 shrink-0 tabular-nums text-zinc-500">{d.date}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-200">
                  <div
                    className="h-full rounded-full bg-primary-600"
                    style={{ width: `${maxDaily > 0 ? Math.round((d.count / maxDaily) * 100) : 0}%` }}
                  />
                </div>
                <span className="w-6 shrink-0 text-right tabular-nums text-zinc-700">{d.count}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
