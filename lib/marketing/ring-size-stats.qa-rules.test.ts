// lib/marketing/ring-size-stats.qa-rules.test.ts — QA อิสระ (qa/ring-size-p3): ขอบช่วงวัน · วันไทย · กติกาตัวเลข · ถ้อยคำ · gate ของ middleware
//
// ไม่พึ่งเทสต์ของ dev: คำนวณค่าคาดหวังด้วยวิธีอื่น (เลขวันจาก Date.UTC / กำลังหารตรงๆ) แล้วเทียบกับ implementation
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as pageStaticInfo from "next/dist/build/analysis/get-page-static-info";
import {
  RING_DEFAULT_RANGE,
  RING_RANGE_KEYS,
  bangkokTodayISO,
  checkRingStatsRange,
  isRealDateISO,
  parseRingSizeFilters,
  presetRange,
  ringSizeHref,
  rangeFromDataSince,
  type RingSizeSearchParams,
} from "./ring-size-filters";
import {
  RING_STATS_MIN_N,
  barWidthPct,
  countPct,
  countWithBase,
  dailyNewestFirst,
  formatInt,
  maxAbandonStages,
  pctText,
  sizeTableRows,
  topSizes,
} from "./ring-size-format";
import { FRICTION_ROWS, IN_APP_LABELS, METHOD_LABELS, REF_LABELS, STAGE_ABANDON_LABELS, STAGE_REACHED_LABELS } from "./ring-size-labels";
import { isExemptPath } from "@/lib/auth/exempt-path";

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const utcMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
/** ตัดสินแบบ SQL (0193): from<=to และ 6 <= (to-from) <= 179 */
const sqlAccepts = (from: string, to: string) => {
  const diff = Math.round((utcMs(to) - utcMs(from)) / DAY);
  return from <= to && diff >= 6 && diff <= 179;
};

const BANNED = /PDPA|ปลอดภัยตามกฎหมาย|session|RPC|migration|\bstage\b|\bG[1-5]\b/i;
const BAD_TOKENS = /NaN|Infinity|undefined|\bnull\b|\[object/;

describe("QA3 — ขอบช่วงวัน: checkRingStatsRange ตรงกับกติกา SQL ทุกคู่ (brute force)", () => {
  it("ทุกคู่ (from,to) รอบปลายปี/ปีอธิกสุรทิน · ตัดสินตรงกับสูตร SQL 6..179", () => {
    let checked = 0;
    for (const start of ["2026-12-20", "2028-02-20", "2026-01-01"]) {
      for (let f = 0; f < 4; f++) {
        for (let off = -3; off <= 200; off++) {
          const from = iso(utcMs(start) + f * DAY);
          const to = iso(utcMs(from) + off * DAY);
          expect(checkRingStatsRange(from, to) === null, `${from}→${to}`).toBe(sqlAccepts(from, to));
          checked++;
        }
      }
    }
    expect(checked).toBe(3 * 4 * 204);
  });

  it("ขอบ 5/6/179/180 (to−from) ตรงตามที่สั่ง", () => {
    const from = "2026-05-01";
    const to = (d: number) => iso(utcMs(from) + d * DAY);
    expect(checkRingStatsRange(from, to(5))).not.toBeNull();
    expect(checkRingStatsRange(from, to(6))).toBeNull();
    expect(checkRingStatsRange(from, to(179))).toBeNull();
    expect(checkRingStatsRange(from, to(180))).not.toBeNull();
    expect(checkRingStatsRange(from, from)).not.toBeNull();
    expect(checkRingStatsRange(to(1), from)).not.toBeNull();
  });

  it.each([
    ["", "2026-10-30"],
    ["2026-13-01", "2026-12-01"],
    ["2026-02-29", "2026-03-30"], // 2026 ไม่ใช่ปีอธิกสุรทิน
    ["2026-04-31", "2026-05-31"],
    ["2026-1-5", "2026-02-05"],
    [" 2026-10-05", "2026-11-03"],
    ["2026-10-05 ", "2026-11-03"],
    ["2026-10-05\n", "2026-11-03"],
    ["2026-10-05T00:00:00Z", "2026-11-03"],
    ["infinity", "2026-11-03"],
    ["-infinity", "infinity"],
    ["NaN", "NaN"],
    ["２０２６-１０-０５", "2026-11-03"], // เลขเต็มความกว้าง
    ["٢٠٢٦-١٠-٠٥", "2026-11-03"], // เลขอารบิก-อินดิก
    ["2026-10-05'; drop table x;--", "2026-11-03"],
    ["2026-10-05", "2026-11-03\u0000"],
    ["🙂", "🙂"],
    ["x".repeat(5000), "y".repeat(5000)],
    [null, "2026-11-03"],
    [undefined, undefined],
    [20261005, 20261103],
    [new Date("2026-10-05"), new Date("2026-11-03")],
    [{}, []],
    [["2026-10-05"], ["2026-11-03"]],
  ] as [unknown, unknown][])("ขยะ #%# ⇒ ถูกปฏิเสธด้วยข้อความไทยคงที่ (ไม่ throw · ไม่ echo input)", (from, to) => {
    const msg = checkRingStatsRange(from, to);
    expect(msg).not.toBeNull();
    expect(msg).toMatch(/^[ก-๙0-9 ]+$/); // ข้อความไทย/ตัวเลขล้วน ไม่มีอักขระของ input ปน
    expect(msg).not.toMatch(BAD_TOKENS);
  });

  it("isRealDateISO: ปีอธิกสุรทิน 2028-02-29 จริง · 2100-02-29 ไม่จริง · 2026-02-29 ไม่จริง", () => {
    expect(isRealDateISO("2028-02-29")).toBe(true);
    expect(isRealDateISO("2100-02-29")).toBe(false);
    expect(isRealDateISO("2026-02-29")).toBe(false);
  });
});

describe("QA3 — วันไทย (UTC+7): bangkokTodayISO / preset ที่ขอบ 00:00–07:00", () => {
  it("ทุก 15 นาทีรอบเที่ยงคืนไทย (UTC 16:00–18:00) ⇒ วันไทย = (UTC+7h) ตัดวัน", () => {
    const base = Date.parse("2026-11-02T16:00:00Z");
    for (let m = 0; m <= 8 * 60; m += 15) {
      const t = base + m * 60_000;
      expect(bangkokTodayISO(new Date(t)), new Date(t).toISOString()).toBe(new Date(t + 7 * 3600_000).toISOString().slice(0, 10));
    }
    // เส้นแบ่งตรงๆ
    expect(bangkokTodayISO(new Date("2026-11-02T16:59:59.999Z"))).toBe("2026-11-02");
    expect(bangkokTodayISO(new Date("2026-11-02T17:00:00.000Z"))).toBe("2026-11-03");
  });

  it.each([
    ["2026-12-31T17:00:00Z", "2027-01-01"],
    ["2026-12-31T16:59:00Z", "2026-12-31"],
    ["2028-02-28T17:00:00Z", "2028-02-29"],
    ["2028-02-29T17:00:00Z", "2028-03-01"],
    ["2026-02-28T17:00:00Z", "2026-03-01"],
  ])("ข้ามเดือน/ปี/ปีอธิกสุรทิน %s ⇒ %s", (utc, expected) => {
    expect(bangkokTodayISO(new Date(utc))).toBe(expected);
  });

  it("preset 7/30/90/180 จบที่วันนี้ · นับรวมวันนี้ได้ 7/30/90/180 วันเป๊ะ · ผ่านด่านเดียวกับ RPC ทุกวันของ 2 ปี", () => {
    const want = { "7d": 7, "30d": 30, "90d": 90, "180d": 180 } as const;
    for (let d = 0; d < 800; d += 1) {
      const today = iso(utcMs("2026-01-01") + d * DAY);
      for (const key of RING_RANGE_KEYS) {
        const { from, to } = presetRange(key, today);
        expect(to).toBe(today);
        expect(Math.round((utcMs(to) - utcMs(from)) / DAY) + 1, `${key}@${today}`).toBe(want[key]);
        expect(sqlAccepts(from, to), `${key}@${today}`).toBe(true);
      }
    }
  });

  it("rangeFromDataSince ให้ช่วงที่ RPC รับเสมอ ไม่ว่า data_since จะเก่า/ใหม่/อนาคตแค่ไหน", () => {
    const today = "2026-11-03";
    for (let back = -30; back <= 400; back++) {
      const ds = iso(utcMs(today) - back * DAY);
      const r = rangeFromDataSince(ds, today);
      expect(sqlAccepts(r.from, r.to), `ds=${ds}`).toBe(true);
      expect(r.to).toBe(today);
    }
  });
});

describe("QA3 — parseRingSizeFilters: fuzz (ผลต้องผ่านด่านเสมอ · ไม่ throw · idempotent)", () => {
  const TODAY = "2026-11-03";
  // LCG คงที่ — ผลซ้ำได้
  let seed = 123456789;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];

  const dateish = (): string | string[] | undefined => {
    const r = rnd();
    if (r < 0.1) return undefined;
    if (r < 0.15) return "";
    if (r < 0.2) return pick(["2026-02-30", "infinity", "-infinity", "x", "2026-13-40", "2026-10-05T00:00", "０", "2026-1-1"]);
    if (r < 0.25) return [iso(utcMs(TODAY) - 10 * DAY), iso(utcMs(TODAY) - 20 * DAY)];
    const off = Math.floor(rnd() * 420) - 40; // -40..+380 วันก่อนวันนี้ (ครอบอนาคตด้วย)
    return iso(utcMs(TODAY) - off * DAY);
  };
  const rangeish = (): string | string[] | undefined => {
    const r = rnd();
    if (r < 0.4) return undefined;
    if (r < 0.7) return pick(RING_RANGE_KEYS);
    return pick(["999d", "0d", "-7d", "7D", "7d ", "30", "all", "__proto__", ["7d", "90d"]] as const) as string | string[];
  };

  it("5,000 อินพุตสุ่ม ⇒ ผ่าน checkRingStatsRange · to ≤ วันนี้ · ไม่ throw · notices เป็นสตริงไทย", () => {
    let customCount = 0;
    for (let i = 0; i < 5000; i++) {
      const sp: RingSizeSearchParams = { from: dateish(), to: dateish(), range: rangeish(), src: rnd() < 0.2 ? "line" : undefined };
      const r = parseRingSizeFilters(sp, TODAY);
      expect(checkRingStatsRange(r.from, r.to), JSON.stringify(sp)).toBeNull();
      expect(r.to <= TODAY, JSON.stringify(sp)).toBe(true);
      expect(Array.isArray(r.notices)).toBe(true);
      for (const n of r.notices) {
        expect(typeof n).toBe("string");
        expect(n).not.toMatch(BAD_TOKENS);
      }
      if (r.range === "custom") customCount++;
      else expect({ from: r.from, to: r.to }).toEqual(presetRange(r.range, TODAY));
      expect(Object.keys(r).sort()).toEqual(["from", "notices", "range", "to"]); // ไม่มี src/shop หลุดออกมา
    }
    expect(customCount).toBeGreaterThan(200); // กันเทสต์ผ่านเพราะสุ่มไม่เคยเข้าเส้นทาง custom
  });

  it("round trip: URL ที่ระบบสร้างเอง (ringSizeHref) อ่านกลับได้ตัวกรองเดิม ไม่มี notice", () => {
    for (const key of RING_RANGE_KEYS) {
      const f = presetRange(key, TODAY);
      const url = new URL(ringSizeHref({ range: key }), "https://x.invalid");
      const r = parseRingSizeFilters(Object.fromEntries(url.searchParams), TODAY);
      expect(r).toEqual({ ...f, range: key, notices: [] });
    }
    for (const [from, to] of [
      ["2026-10-28", "2026-11-03"], // 7 วันพอดี
      ["2026-05-08", "2026-11-03"], // 180 วันพอดี
      ["2026-09-01", "2026-09-30"],
    ]) {
      const url = new URL(ringSizeHref({ range: "custom", from, to }), "https://x.invalid");
      const r = parseRingSizeFilters(Object.fromEntries(url.searchParams), TODAY);
      expect(r).toEqual({ from, to, range: "custom", notices: [] });
    }
  });

  it("ค่าเริ่มต้น (ไม่มี param) = 30 วัน และ URL ของ 30 วัน = สะอาด ไม่มี query", () => {
    expect(RING_DEFAULT_RANGE).toBe("30d");
    expect(ringSizeHref({ range: "30d" })).toBe("/marketing/ring-size");
    expect(ringSizeHref({ range: "7d" })).toBe("/marketing/ring-size?range=7d");
    expect(parseRingSizeFilters({}, TODAY)).toEqual({ ...presetRange("30d", TODAY), range: "30d", notices: [] });
    expect(parseRingSizeFilters(null, TODAY).range).toBe("30d");
    expect(parseRingSizeFilters(undefined, TODAY).range).toBe("30d");
  });

  it("src / shop_id / p_shop_id ใน searchParams ไม่ปรากฏในผล (ไม่ถูกเก็บ ไม่ถูกส่งต่อ)", () => {
    const hostile = { src: "line", shop_id: "evil", shopId: "evil", p_shop_id: "evil", range: "7d" } as unknown as RingSizeSearchParams;
    const r = parseRingSizeFilters(hostile, TODAY);
    expect(JSON.stringify(r)).not.toMatch(/evil|line/);
  });
});

describe("QA4 — กติกาตัวเลข: ฐาน 29 vs 30 · หาร 0 · <1% · 'n จาก N' · ไม่มี NaN/Infinity", () => {
  it("เส้นแบ่งฐาน: 29 ⇒ 'low' ไม่มี % · 30 ⇒ 'pct' (ค่าคงที่ = 30)", () => {
    expect(RING_STATS_MIN_N).toBe(30);
    expect(countPct(3, 29)).toEqual({ kind: "low", count: 3, base: 29 });
    expect(countPct(3, 30)).toMatchObject({ kind: "pct", label: "10%" });
    expect(pctText(3, 29)).toBe("จาก 29");
    expect(pctText(3, 30)).toBe("10%");
    expect(countWithBase(3, 8)).toBe("3 จาก 8");
    expect(countWithBase(3, 29)).toBe("3 จาก 29");
    expect(countWithBase(15, 30)).toBe("15 ครั้ง · 50%");
  });

  it("ฐาน 0 ⇒ '—' ทุกทาง (ไม่ NaN/Infinity)", () => {
    expect(countPct(0, 0)).toEqual({ kind: "none" });
    expect(countPct(5, 0)).toEqual({ kind: "none" });
    expect(pctText(0, 0)).toBe("—");
    expect(countWithBase(7, 0)).toBe("—");
    expect(barWidthPct(5, 0)).toBe(0);
    expect(barWidthPct(0, 0)).toBe(0);
  });

  it("'<1%': มีของแต่ปัดเป็น 0 ⇒ '<1%' · ไม่มีของ ⇒ '0%' · ขอบ 0.5% ปัดเป็น 1%", () => {
    expect(pctText(1, 300)).toBe("<1%"); // 0.33%
    expect(pctText(1, 1000)).toBe("<1%");
    expect(pctText(1, 201)).toBe("<1%"); // 0.4975%
    expect(pctText(1, 200)).toBe("1%"); // 0.5% พอดี
    expect(pctText(0, 300)).toBe("0%");
    expect(pctText(299, 300)).toBe("100%"); // 99.67 ปัดขึ้น — spec ไม่บังคับรวม 100
  });

  it("ตาราง (count × base) ทุกค่า: ไม่ NaN/Infinity/undefined · % อยู่ใน 0..100 · count>base ไม่ทำให้เกิน 100%", () => {
    const bases = [0, 1, 7, 29, 30, 31, 100, 999, 100000];
    const counts = [0, 1, 2, 7, 29, 30, 31, 100, 1000, 100000, 1e9];
    for (const b of bases) {
      for (const c of counts) {
        for (const s of [String(pctText(c, b)), countWithBase(c, b), formatInt(c)]) {
          expect(s, `${c}/${b}`).not.toMatch(BAD_TOKENS);
        }
        const r = countPct(c, b);
        if (r.kind === "pct") {
          expect(r.pct).toBeGreaterThanOrEqual(0);
          expect(r.pct).toBeLessThanOrEqual(100);
          expect(Number.isFinite(r.pct)).toBe(true);
        }
        const w = barWidthPct(c, b);
        expect(Number.isInteger(w) && w >= 0 && w <= 100, `bar ${c}/${b}`).toBe(true);
      }
    }
  });

  it("อินพุตเพี้ยน (NaN/Infinity/ลบ/สตริง/null/undefined) ⇒ ไม่ throw · ไม่โชว์คำต้องห้าม", () => {
    const junk = [NaN, Infinity, -Infinity, -5, 0.4, "12", null, undefined, {}, [], true] as unknown[];
    for (const a of junk) {
      for (const b of [...junk, 100]) {
        const x = a as number;
        const y = b as number;
        for (const s of [pctText(x, y), countWithBase(x, y), formatInt(x), String(barWidthPct(x, y)), JSON.stringify(countPct(x, y))]) {
          expect(s, `${String(a)}/${String(b)}`).not.toMatch(/NaN|Infinity|undefined|\[object/);
        }
      }
    }
  });

  it("formatInt: คั่นหลักพัน th-TH · 5–6 หลักไม่ตัดเป็น k/M", () => {
    expect(formatInt(12345)).toBe("12,345");
    expect(formatInt(123456)).toBe("123,456");
    expect(formatInt(0)).toBe("0");
    expect(formatInt(1234567)).not.toMatch(/[kKmM]/);
  });

  it("topSizes: เสมอ ⇒ เบอร์เล็กก่อน · ตัด 0 · มีน้อยกว่า 3 ⇒ โชว์เท่าที่มี · ไม่แก้ array เดิม", () => {
    const input = Object.freeze([
      Object.freeze({ size: 56, count: 4 }),
      Object.freeze({ size: 52, count: 4 }),
      Object.freeze({ size: 54, count: 4 }),
      Object.freeze({ size: 50, count: 4 }),
      Object.freeze({ size: 60, count: 0 }),
    ]);
    expect(topSizes(input).map((r) => r.size)).toEqual([50, 52, 54]);
    expect(topSizes([{ size: 55, count: 2 }])).toEqual([{ size: 55, count: 2 }]);
    expect(topSizes([])).toEqual([]);
    expect(topSizes([{ size: 55, count: 0 }])).toEqual([]);
  });

  it("sizeTableRows: ครบทุกเบอร์ในช่วง (รวม 0) · เบอร์นอกช่วงไม่เข้าตาราง · ช่วงผิดรูป ⇒ [] ไม่วนลูปยาว", () => {
    const rows = sizeTableRows([{ size: 40, count: 9 }, { size: 52, count: 3 }, { size: 52, count: 2 }], 50, 54);
    expect(rows).toEqual([
      { size: 50, count: 0 },
      { size: 51, count: 0 },
      { size: 52, count: 5 },
      { size: 53, count: 0 },
      { size: 54, count: 0 },
    ]);
    expect(sizeTableRows([], 60, 50)).toEqual([]);
    expect(sizeTableRows([], 0, 1_000_000)).toEqual([]);
    expect(sizeTableRows([], 1.5, 4)).toEqual([]);
    expect(sizeTableRows([], NaN, 4)).toEqual([]);
  });

  it("maxAbandonStages: ฐาน 29 ⇒ ไม่ติด · 30 ⇒ ติด · stage 0 ไม่เข้าการเลือก · เสมอ ⇒ ติดทุกขั้นที่เสมอ · ศูนย์ล้วน ⇒ ไม่ติด", () => {
    const a = [999, 5, 9, 9, 1, 0, 2];
    expect(maxAbandonStages(a, 29)).toEqual([]);
    expect(maxAbandonStages(a, 30)).toEqual([2, 3]);
    expect(maxAbandonStages([50, 0, 0, 0, 0, 0, 0], 100)).toEqual([]);
    expect(maxAbandonStages([], 100)).toEqual([]);
    expect(maxAbandonStages([1], 100)).toEqual([]);
  });

  it("dailyNewestFirst: ใหม่→เก่า · ตัดวันก่อน data_since · ไม่แก้ array เดิม · ไม่มี data_since ⇒ ไม่ตัด", () => {
    const rows = Object.freeze([
      { date: "2026-10-01", sessions: 1 },
      { date: "2026-10-03", sessions: 3 },
      { date: "2026-10-02", sessions: 2 },
    ]);
    expect(dailyNewestFirst(rows, "2026-10-02").map((r) => r.date)).toEqual(["2026-10-03", "2026-10-02"]);
    expect(dailyNewestFirst(rows, null).map((r) => r.date)).toEqual(["2026-10-03", "2026-10-02", "2026-10-01"]);
    expect(dailyNewestFirst(rows, "2026-12-01")).toEqual([]);
    expect(rows.map((r) => r.date)).toEqual(["2026-10-01", "2026-10-03", "2026-10-02"]);
  });
});

describe("QA7 — ถ้อยคำ: ป้ายทั้งหมดในไฟล์ labels ไม่มีคำต้องห้าม · ไม่มีรหัส G1–G5 · ไม่ hardcode 45/68", () => {
  const all = [
    ...Object.values(STAGE_REACHED_LABELS),
    ...Object.values(STAGE_ABANDON_LABELS),
    ...Object.values(IN_APP_LABELS),
    ...Object.values(METHOD_LABELS),
    ...Object.values(REF_LABELS),
    ...FRICTION_ROWS.flatMap((r) => [r.title, r.hint]),
  ];
  it("มีป้ายให้สแกน ≥ 30 ตัว (กันเทสต์ผ่านเพราะสแกนว่าง)", () => {
    expect(all.length).toBeGreaterThanOrEqual(30);
  });
  it.each(all.map((s, i) => [i, s]))("label #%i ไม่มีคำต้องห้าม", (_i, s) => {
    expect(s).not.toMatch(BANNED);
    expect(s).not.toMatch(/\b45\b|\b68\b/);
    expect(s).not.toMatch(BAD_TOKENS);
  });
});

describe("QA6 — /marketing/ring-size ยังถูก gate (matcher จริงของ Next + mirror) · /ring-size สาธารณะไม่กระทบ", () => {
  const getMiddlewareMatchers = (
    pageStaticInfo as unknown as {
      getMiddlewareMatchers: (matcher: unknown, nextConfig: Record<string, unknown>) => Array<{ regexp: string }>;
    }
  ).getMiddlewareMatchers;
  const mw = readFileSync(join(process.cwd(), "middleware.ts"), "utf8");
  const m = /matcher:\s*\[\s*"([^"]+)"\s*,?\s*\]/.exec(mw);
  const source = JSON.parse(`"${m![1]}"`) as string;
  const re = new RegExp(getMiddlewareMatchers(source, {} as never)[0].regexp);
  const middlewareRuns = (p: string) => re.test(p);

  const GATED = [
    "/marketing/ring-size",
    "/marketing/ring-size/",
    "/marketing/ring-size?range=7d",
    "/marketing/ring-size/x",
    "/marketing/ring-size.png", // ลวง extension (บทเรียน H1 25 ต.ค.)
    "/marketing/ring-size/x.png",
    "/marketing/ring-size/ring-size.png",
    "/marketing/ring-size/..%2f",
    "/marketing//ring-size",
    "/Marketing/ring-size",
    "/marketing/RING-SIZE",
    "/marketing/ring-size%2e",
    "/marketing/ring-size;/ring-size",
    "/marketing/gem-quiz",
  ];
  it.each(GATED)("%s ⇒ middleware รัน (ถูก gate) และ mirror ไม่ปล่อย", (p) => {
    expect(middlewareRuns(p), `matcher ${p}`).toBe(true);
    expect(isExemptPath(p.split("?")[0]), `mirror ${p}`).toBe(false);
  });
  it.each(["/ring-size", "/ring-size/", "/api/ring-size/event", "/gem-quiz"])("สาธารณะเดิม %s ⇒ ยังข้าม gate เหมือนเดิม", (p) => {
    expect(middlewareRuns(p), `matcher ${p}`).toBe(false);
    expect(isExemptPath(p)).toBe(true);
  });
  it.each(["/ring-size/x", "/ring-sizes", "/api/ring-size/stats", "/api/ring-size", "/ring-size/stats"])("path ใกล้เคียง %s ⇒ ยังถูก gate", (p) => {
    expect(middlewareRuns(p), `matcher ${p}`).toBe(true);
    expect(isExemptPath(p)).toBe(false);
  });
});
