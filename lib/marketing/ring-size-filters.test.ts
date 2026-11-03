// lib/marketing/ring-size-filters.test.ts — ตัวกรองช่วงวันของหน้า /marketing/ring-size
// เคสห้ามผ่าน #3 ของ brief: ช่วง < 7 / > 180 วัน (นับแบบเดียวกับ RPC 0193: diff 5 ⇒ ปฏิเสธ · 6 ⇒ ผ่าน · 179 ⇒ ผ่าน · 180 ⇒ ปฏิเสธ) ·
// from > to · วันที่ไม่ใช่วันจริง / infinity / ขยะ · วันไทย (UTC เหลื่อม 00:00–07:00)
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  RING_RANGE_KEYS,
  addDaysISO,
  bangkokTodayISO,
  checkRingStatsRange,
  inclusiveDays,
  isRealDateISO,
  parseRingSizeFilters,
  presetRange,
  rangeFromDataSince,
  ringSizeHref,
} from "./ring-size-filters";

const TODAY = "2026-11-03";

describe("isRealDateISO", () => {
  it.each(["2026-11-03", "2024-02-29", "2026-12-31", "0001-01-01"])("%s เป็นวันจริง", (s) => {
    expect(isRealDateISO(s)).toBe(true);
  });
  it.each([
    "2026-02-30", // ไม่มีวันนี้
    "2026-02-29", // ไม่ใช่ปีอธิกสุรทิน
    "2026-13-01",
    "2026-00-10",
    "2026-11-31",
    "infinity",
    "-infinity",
    "2026-1-5",
    "2026-11-03 ",
    " 2026-11-03",
    "2026-11-03\n",
    "2026-11-03T00:00:00Z",
    "๒๐๒๖-๑๑-๐๓", // เลขไทย — \d ต้องไม่ผ่าน
    "'; drop table x; --",
    "",
    "abc",
  ])("ปฏิเสธ %j", (s) => {
    expect(isRealDateISO(s)).toBe(false);
  });
  it.each([null, undefined, 20261103, {}, [], ["2026-11-03"]])("ปฏิเสธชนิดที่ไม่ใช่ข้อความ %j", (v) => {
    expect(isRealDateISO(v)).toBe(false);
  });
});

describe("checkRingStatsRange — ขอบ 7/180 วันตรง RPC (to − from = 6..179)", () => {
  const to = "2026-11-03";
  const fromForDiff = (diff: number) => addDaysISO(to, -diff);

  it("diff 5 (6 วัน) ⇒ ปฏิเสธ", () => {
    expect(checkRingStatsRange(fromForDiff(5), to)).not.toBeNull();
  });
  it("diff 6 (7 วันพอดี) ⇒ ผ่าน", () => {
    expect(checkRingStatsRange(fromForDiff(6), to)).toBeNull();
  });
  it("diff 179 (180 วันพอดี) ⇒ ผ่าน", () => {
    expect(checkRingStatsRange(fromForDiff(179), to)).toBeNull();
  });
  it("diff 180 (181 วัน) ⇒ ปฏิเสธ", () => {
    expect(checkRingStatsRange(fromForDiff(180), to)).not.toBeNull();
  });
  it("from = to (วันเดียว) ⇒ ปฏิเสธ", () => {
    expect(checkRingStatsRange(to, to)).not.toBeNull();
  });
  it("from > to ⇒ ปฏิเสธ", () => {
    expect(checkRingStatsRange("2026-11-03", "2026-10-01")).not.toBeNull();
  });
  it.each([
    ["2026-02-30", "2026-11-03"],
    ["2026-10-01", "2026-02-30"],
    ["infinity", "2026-11-03"],
    ["2026-10-01", "infinity"],
    ["-infinity", "infinity"],
    ["abc", "def"],
    ["", ""],
    [undefined, undefined],
    [null, "2026-11-03"],
    [20261001, 20261103],
  ])("วันที่ไม่ใช่วันจริง/ขยะ (%j, %j) ⇒ ปฏิเสธ ไม่ throw", (a, b) => {
    expect(() => checkRingStatsRange(a, b)).not.toThrow();
    expect(checkRingStatsRange(a, b)).not.toBeNull();
  });
  it("ข้อความที่ได้ไม่ echo ค่าที่ client ส่งมา", () => {
    const msg = checkRingStatsRange("<script>alert(1)</script>", "2026-11-03");
    expect(msg).not.toContain("script");
  });
  it("inclusiveDays นับรวมปลาย", () => {
    expect(inclusiveDays("2026-11-03", "2026-11-03")).toBe(1);
    expect(inclusiveDays("2026-10-28", "2026-11-03")).toBe(7);
    expect(inclusiveDays("2026-05-08", "2026-11-03")).toBe(180);
  });
});

describe("bangkokTodayISO — วันไทย ไม่ใช่ UTC", () => {
  it("UTC 17:00 วันที่ 2 = ไทย 00:00 วันที่ 3", () => {
    expect(bangkokTodayISO(new Date("2026-11-02T17:00:00Z"))).toBe("2026-11-03");
  });
  it("UTC 16:59:59 วันที่ 2 = ไทยยังเป็นวันที่ 2 (ขอบก่อนเที่ยงคืนไทย)", () => {
    expect(bangkokTodayISO(new Date("2026-11-02T16:59:59Z"))).toBe("2026-11-02");
  });
  it("UTC 00:00 วันที่ 3 = ไทย 07:00 วันที่ 3", () => {
    expect(bangkokTodayISO(new Date("2026-11-03T00:00:00Z"))).toBe("2026-11-03");
  });
  it("ข้ามปี: UTC 31 ธ.ค. 20:00 = ไทย 1 ม.ค. 03:00", () => {
    expect(bangkokTodayISO(new Date("2026-12-31T20:00:00Z"))).toBe("2027-01-01");
  });
});

describe("preset 7d/30d/90d/180d — from คำนวณถูกที่ขอบวัน (วันไทย)", () => {
  it.each([
    ["7d", 7],
    ["30d", 30],
    ["90d", 90],
    ["180d", 180],
  ] as const)("%s = %i วันนับรวมวันนี้ และผ่านด่านเดียวกับ RPC", (key, days) => {
    const r = presetRange(key, TODAY);
    expect(r.to).toBe(TODAY);
    expect(inclusiveDays(r.from, r.to)).toBe(days);
    expect(checkRingStatsRange(r.from, r.to)).toBeNull();
  });
  it("to = วันนี้แบบไทยเมื่อ UTC ยังเป็นเมื่อวาน (00:00–07:00 ไทย)", () => {
    const today = bangkokTodayISO(new Date("2026-11-02T18:30:00Z")); // ไทย 01:30 วันที่ 3
    const r = parseRingSizeFilters({ range: "7d" }, today);
    expect(r.to).toBe("2026-11-03");
    expect(r.from).toBe("2026-10-28");
  });
});

describe("parseRingSizeFilters", () => {
  it("ไม่มี param ⇒ 30 วันล่าสุด ไม่มี notice", () => {
    expect(parseRingSizeFilters({}, TODAY)).toEqual({ from: "2026-10-05", to: TODAY, range: "30d", notices: [] });
    expect(parseRingSizeFilters(null, TODAY).range).toBe("30d");
    expect(parseRingSizeFilters(undefined, TODAY).range).toBe("30d");
  });

  it.each(RING_RANGE_KEYS)("range=%s ใช้ได้", (k) => {
    const r = parseRingSizeFilters({ range: k }, TODAY);
    expect(r.range).toBe(k);
    expect(r.notices).toEqual([]);
    expect(checkRingStatsRange(r.from, r.to)).toBeNull();
  });

  it("range นอกชุด (999d / 30D / ขยะ) ⇒ ค่าเริ่มต้น + notice (ไม่ปรับเงียบ)", () => {
    for (const bad of ["999d", "30D", "0d", "7", "1;drop", " 30d"]) {
      const r = parseRingSizeFilters({ range: bad }, TODAY);
      expect(r.range).toBe("30d");
      expect(r.notices.length).toBe(1);
    }
  });

  it("from+to ที่ถูกต้อง ชนะ range", () => {
    const r = parseRingSizeFilters({ range: "7d", from: "2026-09-26", to: "2026-10-25" }, TODAY);
    expect(r).toEqual({ from: "2026-09-26", to: "2026-10-25", range: "custom", notices: [] });
  });

  it("from/to ผิดรูป (30 ก.พ.) ⇒ ทิ้งทั้งคู่ + notice แล้วใช้ range", () => {
    const r = parseRingSizeFilters({ range: "90d", from: "2026-02-30", to: "2026-10-25" }, TODAY);
    expect(r.range).toBe("90d");
    expect(r.notices.length).toBe(1);
  });

  it("ส่งมาแค่ from หรือแค่ to ⇒ ทิ้ง + notice", () => {
    expect(parseRingSizeFilters({ from: "2026-10-01" }, TODAY).range).toBe("30d");
    expect(parseRingSizeFilters({ to: "2026-10-01" }, TODAY).notices.length).toBe(1);
  });

  it("to อนาคต ⇒ ปรับเป็นวันนี้ + notice", () => {
    const r = parseRingSizeFilters({ from: "2026-10-20", to: "2027-01-01" }, TODAY);
    expect(r.to).toBe(TODAY);
    expect(r.range).toBe("custom");
    expect(r.notices.length).toBe(1);
  });

  it("from อนาคตทั้งคู่ ⇒ from > to หลังปรับ ⇒ ค่าเริ่มต้น", () => {
    const r = parseRingSizeFilters({ from: "2027-01-01", to: "2027-02-01" }, TODAY);
    expect(r.range).toBe("30d");
    expect(r.to).toBe(TODAY);
    expect(r.notices.length).toBeGreaterThan(0);
  });

  it("from > to ⇒ ค่าเริ่มต้น + notice", () => {
    const r = parseRingSizeFilters({ from: "2026-10-25", to: "2026-09-26" }, TODAY);
    expect(r.range).toBe("30d");
    expect(r.notices.length).toBe(1);
  });

  it("ช่วง 181 วัน ⇒ ตัด from ให้เหลือ 180 วัน + notice", () => {
    const from = addDaysISO(TODAY, -180); // 181 วันนับรวมปลาย
    const r = parseRingSizeFilters({ from, to: TODAY }, TODAY);
    expect(inclusiveDays(r.from, r.to)).toBe(180);
    expect(r.range).toBe("custom");
    expect(r.notices.length).toBe(1);
  });

  it("ช่วง 180 วันพอดี ⇒ ไม่ปรับ ไม่มี notice", () => {
    const from = addDaysISO(TODAY, -179);
    const r = parseRingSizeFilters({ from, to: TODAY }, TODAY);
    expect(r).toEqual({ from, to: TODAY, range: "custom", notices: [] });
  });

  it("ช่วง 6 วัน ⇒ ค่าเริ่มต้น + notice · 7 วันพอดี ⇒ ผ่าน", () => {
    const six = parseRingSizeFilters({ from: addDaysISO(TODAY, -5), to: TODAY }, TODAY);
    expect(six.range).toBe("30d");
    expect(six.notices.length).toBeGreaterThan(0);
    const seven = parseRingSizeFilters({ from: addDaysISO(TODAY, -6), to: TODAY }, TODAY);
    expect(seven.range).toBe("custom");
    expect(seven.notices).toEqual([]);
  });

  it("ขยะ/infinity/array ซ้ำ key ⇒ ไม่ throw ได้ค่าที่ผ่านด่านเสมอ", () => {
    const junk: unknown[] = ["infinity", "-infinity", "NaN", "null", "undefined", "../../etc", "%00", "<b>", ["2026-10-01", "2026-10-02"], "9999-12-31", "0000-01-01"];
    for (const a of junk) {
      for (const b of junk) {
        const r = parseRingSizeFilters({ from: a as string, to: b as string, range: a as string }, TODAY);
        expect(checkRingStatsRange(r.from, r.to)).toBeNull();
        expect(r.to <= TODAY).toBe(true);
      }
    }
  });

  it("src= ถูกเพิกเฉย: ไม่มีผลต่อช่วง ไม่มี notice ไม่ติดไปใน href", () => {
    const withSrc = parseRingSizeFilters({ range: "7d", src: "line" }, TODAY);
    const without = parseRingSizeFilters({ range: "7d" }, TODAY);
    expect(withSrc).toEqual(without);
    expect(JSON.stringify(withSrc)).not.toContain("src");
    expect(ringSizeHref({ range: withSrc.range })).not.toContain("src");
    // ค่า src ที่ขยะก็ไม่ทำให้ parse พัง
    expect(() => parseRingSizeFilters({ src: "x'; --" }, TODAY)).not.toThrow();
  });
});

describe("ringSizeHref", () => {
  it("30d = URL สะอาด · อื่นๆ = ?range= · custom = from/to", () => {
    expect(ringSizeHref({ range: "30d" })).toBe("/marketing/ring-size");
    expect(ringSizeHref({ range: "7d" })).toBe("/marketing/ring-size?range=7d");
    expect(ringSizeHref({ range: "180d" })).toBe("/marketing/ring-size?range=180d");
    expect(ringSizeHref({ range: "custom", from: "2026-09-26", to: "2026-10-25" })).toBe("/marketing/ring-size?from=2026-09-26&to=2026-10-25");
  });
});

describe("rangeFromDataSince — ปุ่ม 'ดูตั้งแต่ …' ต้องได้ช่วงที่ RPC รับเสมอ", () => {
  it("data_since นานพอ ⇒ ใช้ data_since", () => {
    const r = rangeFromDataSince("2026-09-01", TODAY);
    expect(r).toEqual({ from: "2026-09-01", to: TODAY });
    expect(checkRingStatsRange(r.from, r.to)).toBeNull();
  });
  it("data_since ใกล้วันนี้ (ช่วง < 7 วัน) ⇒ ถอยเป็น 7 วัน", () => {
    const r = rangeFromDataSince("2026-11-02", TODAY);
    expect(inclusiveDays(r.from, r.to)).toBe(7);
    expect(checkRingStatsRange(r.from, r.to)).toBeNull();
  });
  it("data_since เก่ากว่า 180 วัน ⇒ ตัดเหลือ 180 วัน", () => {
    const r = rangeFromDataSince("2025-01-01", TODAY);
    expect(inclusiveDays(r.from, r.to)).toBe(180);
    expect(checkRingStatsRange(r.from, r.to)).toBeNull();
  });
});

describe("ไฟล์นี้ไม่มี src / ช่องทางเป็นตัวกรอง", () => {
  it("ซอร์ส parse ไม่ส่ง src ต่อ (ตัดตัวกรองช่องทางตามมติ 25 ต.ค. 69)", () => {
    const code = readFileSync(new URL("./ring-size-filters.ts", import.meta.url), "utf8");
    // `src` ปรากฏได้แค่ในชนิดของ searchParams (รับไว้เพื่อเพิกเฉย) — ห้ามอยู่ใน ParsedRingSizeFilters / href
    expect(code).not.toMatch(/src:\s*string\s*\|\s*null/);
    expect(code).not.toMatch(/p\.set\(["']src["']/);
  });
});
