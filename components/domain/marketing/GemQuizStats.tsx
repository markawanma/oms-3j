"use client";

// components/domain/marketing/GemQuizStats.tsx — หน้าสถิติภายใน /marketing/
// gem-quiz. Presentational เท่านั้น — ตัวเลขทุกตัวมาจาก analytics.gem_quiz_stats
// (RPC รวมใน DB แล้ว, F14: PostgREST ตัด 1000 แถวเงียบ ห้ามดึงแถวดิบมารวมในนี้)
// การคำนวณในไฟล์นี้มีแค่การจัดกลุ่ม/ปัดเศษเพื่อ "แสดงผล" ไม่ใช่การคิดตัวเลข
// ทางธุรกิจใหม่.
//
// 🔴 ตัวกรอง "แหล่งที่มา" (card/share/live/direct) ที่ design v1 §7 ระบุไว้
// **ไม่ได้ทำ** — เช็คโค้ดจริงแล้ว lib/actions/gem-quiz-stats.ts's
// GetGemQuizStatsInput และ RPC analytics.gem_quiz_stats ไม่มี parameter กรอง
// ตาม src เลย มีแค่ from/to/includeRetake จะกรองฝั่ง client จาก
// respondents/bySrc/daily ที่เป็นผลรวมทั้งหมดไปแล้วจะทำให้ตัวเลขที่ UI โชว์
// "ไม่สมเหตุผลกับตัวกรองที่เลือก" ซึ่งหลอกผู้ใช้มากกว่าการไม่มีตัวกรองเลย —
// จึงตัดออกและรายงานกลับ (ต้องแก้ RPC ก่อนถึงจะเพิ่มตัวกรองนี้ได้จริง). ส่วน
// การ "แยก card vs share" ยังทำได้เต็มที่ด้วย bySrc/bySrcLiked.
//
// v2 (5 ต.ค. 69, design doc §6 ของ design-gem-quiz-v2-reconcile.md — migration
// 0157): เพิ่ม liked_first (พลอยที่ชอบ "อันดับ 1" แยกจากทุกอันดับที่เลือก),
// daily_breakdown (ใช้ทำเทรนด์ Q2 รายวัน/รายสัปดาห์ + distribution ของ Q1/Q3/
// Q5) · ลบ section "แยกตามกลุ่มราคา" และ "ระบบแนะนำตรงกับที่ชอบ (agreement)"
// ออกจากหน้านี้ (ข้อมูล/ฟังก์ชันฝั่ง DB ไม่ได้ถูกแตะ แค่ไม่โชว์ใน UI แล้ว —
// price_group อ้างอิงกลุ่มราคาที่ไม่มีความหมายกับพลอย 5 ตัวใหม่, agreement
// เทียบกับ "ชอบ" ซึ่งตีความไม่ตรงกับคำถามธุรกิจของ v2 อีกต่อไป)
// section ใหม่ด้านล่างโชว์ "ยังไม่มีข้อมูล" เฉยๆ เมื่อ likedFirst/dailyBreakdown
// ว่าง (ไม่พูดถึง migration ในข้อความที่เจ้าของเห็น — ศัพท์ dev ไม่ควรขึ้นจอ
// เจ้าของ, code review finding S2) ไม่ว่าสาเหตุจะเป็น "0157 ยังไม่ apply" หรือ
// "apply แล้วแต่ไม่มีใครทำแบบทดสอบในช่วงที่เลือกจริงๆ" ก็ตาม
import { useRouter } from "next/navigation";
import { StatCard } from "@/components/ui/StatCard";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { GEM_QUIZ_QUESTIONS, GEM_QUIZ_STONE_BY_CODE } from "@/lib/gem-quiz/config";
import type {
  GemQuizCrosstabRow,
  GemQuizDailyBreakdownRow,
  GemQuizSrc,
  GemQuizStats as GemQuizStatsData,
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

// code review S5: ใช้ GEM_QUIZ_STONE_BY_CODE แทน .find() — stoneCode มาจาก
// RPC/DB (รวมรหัสพลอยที่ปิดไปแล้วอย่าง "ruby" ในข้อมูลเก่าได้) ไม่ใช่ literal
// ที่รู้แน่ตอน compile-time จึงต้องกัน hasOwnProperty เหมือน recommend.ts's
// L1 fix (prototype pollution) + คง fallback โชว์รหัสดิบไว้เหมือนเดิมถ้าไม่เจอ
function stoneLabel(stoneCode: string): string {
  const table = GEM_QUIZ_STONE_BY_CODE as Readonly<Record<string, { labelTh: string }>>;
  const stone = Object.prototype.hasOwnProperty.call(table, stoneCode) ? table[stoneCode] : undefined;
  return stone?.labelTh ?? stoneCode;
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

// รับแค่ {code,count}[] (ไม่พึ่ง label_th ของ RPC อีกต่อไป) — resolve ชื่อผ่าน
// stoneLabel()/optionLabel() เสมอ ใช้ร่วมกันได้ทั้ง liked/recommended (มี
// label_th จาก RPC แต่ไม่ใช้) และ likedFirst (ไม่มี label_th เลยตาม shape
// ของ 0157 — ดู lib/actions/gem-quiz-stats.ts)
function StoneCountList({
  title,
  rows,
  denominator,
  multiSelectNote,
}: {
  title: string;
  rows: { code: string; count: number }[];
  denominator: number;
  multiSelectNote?: boolean;
}) {
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
            <PercentBar key={row.code} label={stoneLabel(row.code)} count={row.count} denominator={denominator} />
          ))}
        </div>
      )}
    </section>
  );
}

// code review N6: Q1/Q3/Q5 เคยเป็น 3 section ก๊อปวางกันเกือบทั้งก้อน รวมเป็น
// component เดียว รับแค่ questionCode + rows (sum แล้วจาก daily_breakdown)
function AnswerDistribution({
  title,
  questionCode,
  rows,
  denominator,
}: {
  title: string;
  questionCode: string;
  rows: { code: string; count: number }[];
  denominator: number;
}) {
  return (
    <section className="space-y-3 rounded-lg border border-zinc-200 bg-white p-3.5">
      <h3 className="text-sm font-bold text-zinc-800">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-zinc-400">ยังไม่มีข้อมูล</p>
      ) : (
        <div className="space-y-2">
          {[...rows]
            .sort((a, b) => b.count - a.count)
            .map((row) => (
              <PercentBar key={row.code} label={optionLabel(questionCode, row.code)} count={row.count} denominator={denominator} />
            ))}
        </div>
      )}
    </section>
  );
}

const THAI_WEEKDAY_LABELS = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"] as const;

/** weekday ของวันที่ไทย (date เป็น YYYY-MM-DD วันธุรกิจไทยอยู่แล้วจาก RPC) —
 * ใช้ตัวเดียวกับ O6/design doc §6: "weekday = new Date(date+"T00:00:00Z").
 * getUTCDay()" เพื่อไม่ชน timezone shift จากการแปลงเป็น local time ของ
 * เบราว์เซอร์ผู้ใช้ */
function weekdayIndexOf(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay();
}

/** รวม count ของ daily_breakdown ตาม dim ที่กำหนด แยกตาม code — ไม่สนใจวันที่
 * (ใช้ทำ distribution ของ Q1/Q3/Q5 แบบรวมทั้งช่วงที่เลือก) */
function sumBreakdownByCode(rows: readonly GemQuizDailyBreakdownRow[], dim: string): { code: string; count: number }[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (row.dim !== dim) continue;
    totals.set(row.code, (totals.get(row.code) ?? 0) + row.count);
  }
  return [...totals.entries()].map(([code, count]) => ({ code, count }));
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

  const maxDaily = stats.daily.reduce((max, d) => Math.max(max, d.count), 0);

  // --- v2: เทรนด์ Q2 (intention) รายวัน + รายวันในสัปดาห์ (O6: weekday = วันที่
  // ลูกค้าทำแบบทดสอบจริง) + distribution ของ Q1(birth_day)/Q3(feeling)/
  // Q5(jewelry_type) — ทั้งหมด derive จาก daily_breakdown ของ 0157 ล้วนๆ
  // ไม่มี RPC/query เพิ่ม (ว่างเปล่า = [] ถ้า 0157 ยังไม่ apply, ดูหัวไฟล์) ---
  const intentionRows = stats.dailyBreakdown.filter((r) => r.dim === "intention");
  const intentionDates = [...new Set(intentionRows.map((r) => r.date))].sort();
  const intentionOptions = GEM_QUIZ_QUESTIONS.find((q) => q.code === "intention")?.options ?? [];

  const intentionByWeekday: number[][] = Array.from({ length: 7 }, () => intentionOptions.map(() => 0));
  // code review N7: ใช้ Map เทียบ date+code ครั้งเดียว แทน .find() ซ้อนในลูป
  // render (ของเดิม O(dates × options) ครั้ง .find() ต่อ render — ช่วงยาว 366
  // วันจะกลายเป็นเทียบหลักล้านครั้งทุกครั้งที่ re-render)
  const intentionCountByDateCode = new Map<string, number>();
  for (const row of intentionRows) {
    const weekday = weekdayIndexOf(row.date);
    const optIdx = intentionOptions.findIndex((o) => o.code === row.code);
    if (optIdx >= 0) intentionByWeekday[weekday][optIdx] += row.count;
    intentionCountByDateCode.set(`${row.date}|${row.code}`, row.count);
  }

  const likedFirstDenominator = stats.respondents; // 1 คนเลือกอันดับ 1 ได้แค่ตัวเดียว (ไม่ใช่ multi-select)
  const birthDayDistribution = sumBreakdownByCode(stats.dailyBreakdown, "birth_day");
  const feelingDistribution = sumBreakdownByCode(stats.dailyBreakdown, "feeling");
  const jewelryTypeDistribution = sumBreakdownByCode(stats.dailyBreakdown, "jewelry_type");

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

      {stats.respondents === 0 ? (
        // code review S3: ย้ายมาจาก page.tsx — อยู่ใต้ฟอร์มกรองแล้ว เจ้าของ
        // ขยายช่วงวันที่เองได้ทันทีโดยไม่ต้องออกจากหน้านี้
        <EmptyState
          title="ยังไม่มีคนทำแบบทดสอบในช่วงที่เลือก"
          description="ลองขยายช่วงวันที่ด้านบน หรือกลับมาดูใหม่หลังการ์ด QR ถูกส่งออกไป"
        />
      ) : (
      <>
      <div className="flex items-center gap-2">
        <StatCard label="จำนวนผู้ตอบ" value={stats.respondents} tone="brand" />
        {stats.respondents < MIN_RESPONDENTS_FOR_CONFIDENCE && <Badge tone="amber">ข้อมูลยังน้อย</Badge>}
      </div>

      <StoneCountList title="พลอยที่ชอบ (ทุกอันดับที่เลือก — Q4)" rows={stats.liked} denominator={stats.respondents} multiSelectNote />
      <StoneCountList title="พลอยที่ชอบอันดับ 1 (Q4)" rows={stats.likedFirst} denominator={likedFirstDenominator} />
      {/* code review N5 ตัดอันนี้ออกตอน Q4 บังคับเลือก 1-3 (MIN_LIKED_STONES=1)
          — กลับมติ 5 ต.ค. 69 คืน "ยังไม่แน่ใจ แนะนำให้ฉัน" กลับมาแล้ว field
          ฝั่ง DB (liked_none) ไม่เคยถูกแตะเลยตลอด ยังนับถูกต้อง คืน UI กลับมา */}
      {stats.likedNone > 0 && (
        <p className="text-xs text-zinc-400">
          "ยังไม่แน่ใจ แนะนำให้ฉัน": {stats.likedNone} คน (
          {stats.respondents > 0 ? Math.round((stats.likedNone / stats.respondents) * 100) : 0}%)
        </p>
      )}

      <StoneCountList title="พลอยที่ระบบแนะนำ" rows={stats.recommended} denominator={stats.respondents} />

      <AnswerDistribution
        title="การกระจายคำตอบ — วันเกิด (Q1)"
        questionCode="birth_day"
        rows={birthDayDistribution}
        denominator={stats.respondents}
      />
      <AnswerDistribution
        title="การกระจายคำตอบ — ความรู้สึก (Q3)"
        questionCode="feeling"
        rows={feelingDistribution}
        denominator={stats.respondents}
      />
      <AnswerDistribution
        title="การกระจายคำตอบ — สไตล์เครื่องประดับ (Q5)"
        questionCode="jewelry_type"
        rows={jewelryTypeDistribution}
        denominator={stats.respondents}
      />

      <section className="space-y-3 rounded-lg border border-zinc-200 bg-white p-3.5">
        <h3 className="text-sm font-bold text-zinc-800">เทรนด์ Q2 (เป้าหมายวันนี้) รายวัน</h3>
        {intentionDates.length === 0 ? (
          <p className="text-sm text-zinc-400">ยังไม่มีข้อมูล</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold text-zinc-500">
                  <th className="py-1 pr-2">วันที่</th>
                  {intentionOptions.map((opt) => (
                    <th key={opt.code} className="whitespace-nowrap py-1 pr-3 text-right">
                      {opt.labelTh}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {intentionDates.map((date) => (
                  <tr key={date} className="border-t border-zinc-100">
                    <td className="py-1.5 pr-2 tabular-nums text-zinc-700">{date}</td>
                    {intentionOptions.map((opt) => {
                      const count = intentionCountByDateCode.get(`${date}|${opt.code}`) ?? 0;
                      return (
                        <td key={opt.code} className="py-1.5 pr-3 text-right tabular-nums text-zinc-700">
                          {count}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3 rounded-lg border border-zinc-200 bg-white p-3.5">
        <h3 className="text-sm font-bold text-zinc-800">Q2 (เป้าหมายวันนี้) ตามวันในสัปดาห์ที่ทำแบบทดสอบ</h3>
        {intentionDates.length === 0 ? (
          <p className="text-sm text-zinc-400">ยังไม่มีข้อมูล</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold text-zinc-500">
                  <th className="py-1 pr-2">วัน</th>
                  {intentionOptions.map((opt) => (
                    <th key={opt.code} className="whitespace-nowrap py-1 pr-3 text-right">
                      {opt.labelTh}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {THAI_WEEKDAY_LABELS.map((label, weekdayIdx) => (
                  <tr key={label} className="border-t border-zinc-100">
                    <td className="py-1.5 pr-2 text-zinc-700">{label}</td>
                    {intentionOptions.map((opt, optIdx) => (
                      <td key={opt.code} className="py-1.5 pr-3 text-right tabular-nums text-zinc-700">
                        {intentionByWeekday[weekdayIdx][optIdx]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

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
      </>
      )}
    </div>
  );
}
