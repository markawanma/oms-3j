// lib/marketing/ring-size-format.test.ts — กติกาแสดงตัวเลขของหน้า /marketing/ring-size (ux-ring-size-stats.md §7.0)
// เคส "ต้องไม่พัง": หาร 0 ไม่เป็น NaN/Infinity · ฐาน < 30 ⇒ "3 จาก 8" · ฐาน 29 vs 30 (เส้นแบ่ง %) · 0 < % < 0.5 ⇒ "<1%" · เสมอ top 3
import { describe, expect, it } from "vitest";
import {
  RING_STATS_MIN_N,
  countPct,
  countWithBase,
  dailyNewestFirst,
  formatInt,
  maxAbandonStages,
  pctText,
  sizeTableRows,
  topSizes,
} from "./ring-size-format";

describe("countPct", () => {
  it("MIN_N = 30 (ค่าเดียวกับ gem quiz)", () => {
    expect(RING_STATS_MIN_N).toBe(30);
  });
  it("ฐาน 29 ⇒ ไม่โชว์ % · ฐาน 30 ⇒ โชว์ %", () => {
    expect(countPct(10, 29)).toEqual({ kind: "low", count: 10, base: 29 });
    expect(countPct(15, 30)).toMatchObject({ kind: "pct", pct: 50, label: "50%" });
  });
  it("ฐาน 0 ⇒ none (ไม่ใช่ NaN/Infinity)", () => {
    expect(countPct(0, 0)).toEqual({ kind: "none" });
    expect(countPct(5, 0)).toEqual({ kind: "none" });
    expect(pctText(5, 0)).toBe("—");
    expect(countWithBase(5, 0)).toBe("—");
  });
  it("0 < % < 0.5 ⇒ '<1%' (ห้ามโชว์ 0% ทั้งที่มีของ) · count 0 ⇒ '0%'", () => {
    expect(countPct(1, 1000)).toMatchObject({ kind: "pct", label: "<1%" });
    expect(countPct(0, 1000)).toMatchObject({ kind: "pct", label: "0%" });
    expect(countPct(5, 1000)).toMatchObject({ label: "1%" }); // 0.5% ปัดขึ้นเป็น 1%
  });
  it("ปัดเป็นจำนวนเต็ม · ไม่บังคับรวม 100", () => {
    expect(countPct(1, 3 * 10)).toMatchObject({ label: "3%" });
    const sum = [1, 1, 1].map((c) => (countPct(c, 30) as { pct: number }).pct).reduce((a, b) => a + b, 0);
    expect(sum).toBe(9);
  });
  it("count เกินฐาน (ไม่ควรเกิด) ⇒ ไม่เกิน 100%", () => {
    expect(countPct(50, 40)).toMatchObject({ pct: 100, label: "100%" });
  });
  it.each([NaN, Infinity, -Infinity, -5, undefined as unknown as number, null as unknown as number, "7" as unknown as number])(
    "ค่าผิดปกติ %j ไม่ทำให้เกิด NaN/Infinity",
    (bad) => {
      for (const [c, b] of [
        [bad, 100],
        [10, bad],
        [bad, bad],
      ] as [number, number][]) {
        const text = `${pctText(c, b)}|${countWithBase(c, b)}|${formatInt(c)}`;
        expect(text).not.toMatch(/NaN|Infinity|undefined|null/);
      }
    }
  );
});

describe("countWithBase", () => {
  it("ฐาน >= 30 ⇒ 'จำนวน ครั้ง · %' · ฐาน < 30 ⇒ '3 จาก 8'", () => {
    expect(countWithBase(31, 187)).toBe("31 ครั้ง · 17%");
    expect(countWithBase(3, 8)).toBe("3 จาก 8");
    expect(countWithBase(0, 8)).toBe("0 จาก 8");
  });
  it("คั่นหลักพันแบบไทย ไม่ตัดเป็น k/M", () => {
    expect(formatInt(12345)).toBe("12,345");
    expect(formatInt(1_200_000)).toBe("1,200,000");
    expect(countWithBase(12345, 50000)).toContain("12,345");
  });
});

describe("topSizes", () => {
  it("count มาก→น้อย · เสมอกันเบอร์เล็กก่อน · ตัด count 0 · ได้ไม่เกิน 3", () => {
    const rows = [
      { size: 55, count: 24 },
      { size: 54, count: 31 },
      { size: 53, count: 24 },
      { size: 60, count: 24 },
      { size: 46, count: 0 },
    ];
    expect(topSizes(rows)).toEqual([
      { size: 54, count: 31 },
      { size: 53, count: 24 },
      { size: 55, count: 24 },
    ]);
  });
  it("มีน้อยกว่า 3 เบอร์ ⇒ โชว์เท่าที่มี · ว่าง ⇒ []", () => {
    expect(topSizes([{ size: 50, count: 2 }])).toEqual([{ size: 50, count: 2 }]);
    expect(topSizes([])).toEqual([]);
    expect(topSizes([{ size: 50, count: 0 }])).toEqual([]);
  });
  it("นับเบอร์นอกช่วงร้านได้ (เอาจาก result_sizes ทุกเบอร์)", () => {
    expect(topSizes([{ size: 40, count: 9 }, { size: 55, count: 1 }])[0]).toEqual({ size: 40, count: 9 });
  });
  it("ไม่แก้ array ต้นทาง", () => {
    const rows = [{ size: 60, count: 1 }, { size: 50, count: 9 }];
    const copy = JSON.stringify(rows);
    topSizes(rows);
    expect(JSON.stringify(rows)).toBe(copy);
  });
});

describe("sizeTableRows", () => {
  it("ครบทุกเบอร์ min..max รวมที่เป็น 0 · ไม่รวมเบอร์นอกช่วง", () => {
    const rows = sizeTableRows([{ size: 46, count: 4 }, { size: 40, count: 3 }, { size: 99, count: 1 }], 45, 48);
    expect(rows).toEqual([
      { size: 45, count: 0 },
      { size: 46, count: 4 },
      { size: 47, count: 0 },
      { size: 48, count: 0 },
    ]);
  });
  it("ช่วงผิดรูป ⇒ [] (ไม่วนลูปยาว)", () => {
    expect(sizeTableRows([], 68, 45)).toEqual([]);
    expect(sizeTableRows([], 0, 1_000_000)).toEqual([]);
    expect(sizeTableRows([], NaN, 5)).toEqual([]);
  });
});

describe("maxAbandonStages — Badge 'หยุดมากสุด'", () => {
  // abandonAt[k] = หยุดที่ขั้น k (0..6) · stage 0 ไม่เข้าการเลือก
  const abandon = [80, 20, 25, 18, 10, 14, 30];
  it("เลือกขั้นที่มากสุดในกลุ่ม 1..6 (ไม่นับ stage 0 แม้มากสุด)", () => {
    expect(maxAbandonStages(abandon, 412)).toEqual([6]);
  });
  it("เสมอ ⇒ ติดทุกขั้นที่เสมอ", () => {
    expect(maxAbandonStages([0, 9, 3, 9, 1, 0, 2], 100)).toEqual([1, 3]);
  });
  it("ฐานเปิดใช้ < 30 ⇒ ไม่ติด · ค่ามากสุด = 0 ⇒ ไม่ติด", () => {
    expect(maxAbandonStages(abandon, 29)).toEqual([]);
    expect(maxAbandonStages([5, 0, 0, 0, 0, 0, 0], 100)).toEqual([]);
    expect(maxAbandonStages([], 100)).toEqual([]);
  });
});

describe("dailyNewestFirst", () => {
  const rows = [{ date: "2026-10-30" }, { date: "2026-11-01" }, { date: "2026-10-31" }];
  it("ใหม่→เก่า · ไม่แก้ต้นทาง", () => {
    const copy = JSON.stringify(rows);
    expect(dailyNewestFirst(rows, null).map((r) => r.date)).toEqual(["2026-11-01", "2026-10-31", "2026-10-30"]);
    expect(JSON.stringify(rows)).toBe(copy);
  });
  it("ตัดวันก่อน data_since (ยังไม่ได้เก็บ ไม่ใช่ 0 ครั้ง) · วันเท่ากับ data_since ยังอยู่", () => {
    expect(dailyNewestFirst(rows, "2026-10-31").map((r) => r.date)).toEqual(["2026-11-01", "2026-10-31"]);
  });
});
