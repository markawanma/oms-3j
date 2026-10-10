import { describe, expect, it } from "vitest";
import {
  canShift,
  addDays,
  applyFilters,
  calendarHref,
  compareInDay,
  countsByDay,
  dayCovers,
  daysInclusive,
  festivalSpansInRange,
  festivalsOnDay,
  filterOptions,
  groupByDay,
  isRealDate,
  monthGridOf,
  parseFilters,
  parseView,
  shiftAnchor,
  slotText,
  viewRange,
  weekRangeOf,
  weekdayIndex,
  MAX_RANGE_DAYS,
} from "./calendar-view";

describe("วันที่", () => {
  it("isRealDate ปฏิเสธวันที่ไม่มีจริง/รูปแบบผิด", () => {
    expect(isRealDate("2026-10-09")).toBe(true);
    for (const bad of ["2026-02-30", "2026-13-01", "09/10/2026", "", null, undefined, 20261009]) expect(isRealDate(bad as string)).toBe(false);
  });
  it("addDays ข้ามเดือน/ปี", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("weekdayIndex: จันทร์=0 อาทิตย์=6", () => {
    expect(weekdayIndex("2026-10-05")).toBe(0);
    expect(weekdayIndex("2026-10-11")).toBe(6);
  });
  it("สัปดาห์ จ–อา ของพฤหัส 8 ต.ค. 2569 และอาทิตย์ 11", () => {
    expect(weekRangeOf("2026-10-08")).toEqual({ from: "2026-10-05", to: "2026-10-11" });
    expect(weekRangeOf("2026-10-11")).toEqual({ from: "2026-10-05", to: "2026-10-11" });
    expect(weekRangeOf("2026-10-12")).toEqual({ from: "2026-10-12", to: "2026-10-18" });
  });
});

describe("กริดเดือน", () => {
  it("ต.ค. 2569: กริดเต็มสัปดาห์ จ–อา ครอบเดือนครบ", () => {
    const g = monthGridOf("2026-10-15");
    expect(g.monthStart).toBe("2026-10-01");
    expect(g.monthEnd).toBe("2026-10-31");
    expect(g.gridFrom).toBe("2026-09-28");
    expect(g.gridTo).toBe("2026-11-01");
    expect(g.weeks).toHaveLength(5);
    expect(g.weeks.every((w) => w.length === 7)).toBe(true);
    expect(g.weeks[0][0]).toBe("2026-09-28");
  });
  it("ช่วงที่ขอ ≤ เพดาน (เดือนที่ยาวสุด 6 สัปดาห์ = 42 วัน)", () => {
    for (const m of ["2026-02-10", "2026-03-10", "2027-05-10", "2026-08-10", "2026-11-10"]) {
      const g = monthGridOf(m);
      expect(daysInclusive(g.gridFrom, g.gridTo)).toBeLessThanOrEqual(MAX_RANGE_DAYS);
    }
  });
  it("ก.พ. 2569 (28 วัน เริ่มอาทิตย์) กริด 5 สัปดาห์", () => {
    expect(monthGridOf("2026-02-01").weeks).toHaveLength(5);
  });
  it("viewRange: สัปดาห์ = 7 วัน · เดือน/รายการ = กริดเดือน", () => {
    expect(viewRange("week", "2026-10-08")).toEqual({ from: "2026-10-05", to: "2026-10-11" });
    expect(viewRange("month", "2026-10-08")).toEqual({ from: "2026-09-28", to: "2026-11-01" });
    expect(viewRange("list", "2026-10-08")).toEqual(viewRange("month", "2026-10-08"));
  });
});

describe("นำทาง ‹ ›", () => {
  it("สัปดาห์ ±7 วัน", () => {
    expect(shiftAnchor("week", "2026-10-08", 1)).toBe("2026-10-15");
    expect(shiftAnchor("week", "2026-10-08", -1)).toBe("2026-10-01");
  });
  it("เดือน ±1 เดือน → วันที่ 1 (ไม่ล้นเดือนสั้น/ข้ามปี)", () => {
    expect(shiftAnchor("month", "2026-01-31", 1)).toBe("2026-02-01");
    expect(shiftAnchor("month", "2026-12-15", 1)).toBe("2027-01-01");
    expect(shiftAnchor("list", "2026-01-15", -1)).toBe("2025-12-01");
  });
});

describe("parseView", () => {
  it("ค่าเริ่มต้นสัปดาห์ · ?view ที่ถูกต้องชนะ cookie · cookie ผิด = สัปดาห์", () => {
    expect(parseView(undefined)).toBe("week");
    expect(parseView(undefined, "list")).toBe("list");
    expect(parseView("month", "list")).toBe("month");
    expect(parseView("xxx", "yyy")).toBe("week");
    expect(parseView(["month"], null)).toBe("month");
  });
});

describe("overlap — งานหลายวัน", () => {
  const span = { resolvedStart: "2026-10-30", resolvedEnd: "2026-11-02" };
  it("งาน 30 ต.ค.–2 พ.ย. ครอบทุกวันที่คร่อมสิ้นเดือน", () => {
    for (const d of ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]) expect(dayCovers(span, d)).toBe(true);
    expect(dayCovers(span, "2026-10-29")).toBe(false);
    expect(dayCovers(span, "2026-11-03")).toBe(false);
  });
  it("วันเดียว (end null) = วันเดียว · ไม่มีวัน = ไม่ครอบวันไหน · end ก่อน start = ถือเป็นวันเดียว", () => {
    expect(dayCovers({ resolvedStart: "2026-10-09", resolvedEnd: null }, "2026-10-09")).toBe(true);
    expect(dayCovers({ resolvedStart: "2026-10-09", resolvedEnd: null }, "2026-10-10")).toBe(false);
    expect(dayCovers({ resolvedStart: null, resolvedEnd: null }, "2026-10-09")).toBe(false);
    expect(dayCovers({ resolvedStart: "2026-10-09", resolvedEnd: "2026-10-01" }, "2026-10-05")).toBe(false);
  });
  it("groupByDay: งานหลายวันอยู่ทุกวัน วันที่ 2+ เป็น continuation", () => {
    const days = ["2026-10-31", "2026-11-01", "2026-11-02"];
    const g = groupByDay([{ ...span, title: "x" }], days);
    expect(g["2026-10-31"][0].continuation).toBe(true);
    expect(g["2026-11-02"]).toHaveLength(1);
    const first = groupByDay([{ ...span, title: "x" }], ["2026-10-30"]);
    expect(first["2026-10-30"][0].continuation).toBe(false);
  });
  it("countsByDay นับตามที่ครอบวัน", () => {
    const c = countsByDay([span, { resolvedStart: "2026-11-01", resolvedEnd: null }], ["2026-10-31", "2026-11-01"]);
    expect(c).toEqual({ "2026-10-31": 1, "2026-11-01": 2 });
  });
});

describe("เรียงในวัน + ป้ายช่วงเวลา", () => {
  it("มีเวลาก่อนตามเวลา → ช่วง (เช้า<บ่าย<ก่อนไลฟ์<ระหว่างไลฟ์) → ไม่ระบุ", () => {
    const items = [
      { title: "ไม่ระบุ" },
      { title: "ก่อนไลฟ์", timeSlot: "before_live" },
      { title: "เช้า", timeSlot: "morning" },
      { title: "20:00", startTime: "20:00" },
      { title: "09:00", startTime: "09:00" },
    ];
    expect([...items].sort(compareInDay).map((x) => x.title)).toEqual(["09:00", "20:00", "เช้า", "ก่อนไลฟ์", "ไม่ระบุ"]);
  });
  it("slotText: เวลา > ช่วง > null (ไม่แต่ง 'ทั้งวัน')", () => {
    expect(slotText({ startTime: "20:00", timeSlot: "morning" })).toBe("20:00 น.");
    expect(slotText({ timeSlot: "before_live" })).toBe("ก่อนไลฟ์");
    expect(slotText({})).toBeNull();
    expect(slotText({ timeSlot: "weird" })).toBeNull();
  });
});

describe("ตัวกรอง", () => {
  const rows = [
    { campaignId: "c1", campaignName: "ปิดเดือน ต.ค.", campaignType: "monthly", channel: "tiktok", effectiveStatus: "approved", contentTypeCode: "know" },
    { campaignId: "c2", campaignName: "งานเดี่ยว", campaignType: "content_task", channel: "line_oa", effectiveStatus: "planned", contentTypeCode: null },
    { campaignId: "c1", campaignName: "ปิดเดือน ต.ค.", campaignType: "monthly", channel: "tiktok_live", effectiveStatus: "in_review", contentTypeCode: "live" },
  ];
  it("parseFilters: ค่าว่าง/ยาวเกิน/ไม่ใช่สตริง ถูกทิ้ง", () => {
    expect(parseFilters({ campaign: "c1", channel: "", status: "x".repeat(81), type: ["a", "b"] })).toEqual({ campaign: "c1", channel: undefined, status: undefined, type: "a" });
  });
  it("กรองแบบ AND", () => {
    expect(applyFilters(rows, {})).toHaveLength(3);
    expect(applyFilters(rows, { campaign: "c1" })).toHaveLength(2);
    expect(applyFilters(rows, { campaign: "c1", status: "approved" })).toHaveLength(1);
    expect(applyFilters(rows, { type: "live", channel: "tiktok_live" })).toHaveLength(1);
    expect(applyFilters(rows, { campaign: "nope" })).toHaveLength(0);
  });
  it("ตัวเลือกแคมเปญ = เฉพาะแคมเปญจริง (ไม่รวมงานเดี่ยว content_task) · ป้ายไทย", () => {
    const o = filterOptions(rows);
    expect(o.campaigns).toEqual([{ value: "c1", label: "ปิดเดือน ต.ค." }]);
    expect(o.channels.map((c) => c.label).sort()).toEqual(["LINE OA", "TikTok", "TikTok LIVE"].sort());
    expect(o.statuses.map((s) => s.label)).toContain("รอตรวจ");
    expect(o.types.sort()).toEqual(["know", "live"]);
  });
});

describe("เทศกาล", () => {
  const ev = [
    { nameTh: "กินเจ", eventDate: "2026-10-10", durationDays: 9 },
    { nameTh: "11.11", eventDate: "2026-11-11", durationDays: 1 },
    { nameTh: "พัง", eventDate: "xxx", durationDays: 3 },
    { nameTh: "ไม่มีวัน", eventDate: "2026-10-12", durationDays: NaN },
  ];
  it("คร่อมสัปดาห์ที่แสดง → โผล่ · นอกช่วง/วันที่พัง → ไม่โผล่", () => {
    const s = festivalSpansInRange(ev, "2026-10-05", "2026-10-11");
    expect(s.map((x) => x.name)).toEqual(["กินเจ"]);
    expect(s[0]).toEqual({ name: "กินเจ", from: "2026-10-10", to: "2026-10-18" });
  });
  it("duration ไม่ถูกต้อง = 1 วัน", () => {
    const s = festivalSpansInRange(ev, "2026-10-12", "2026-10-12");
    expect(s.map((x) => x.name).sort()).toEqual(["กินเจ", "ไม่มีวัน"].sort());
    expect(s.find((x) => x.name === "ไม่มีวัน")?.to).toBe("2026-10-12");
  });
  it("festivalsOnDay", () => {
    const spans = festivalSpansInRange(ev, "2026-10-01", "2026-10-31");
    expect(festivalsOnDay(spans, "2026-10-14").map((x) => x.name)).toEqual(["กินเจ"]);
    expect(festivalsOnDay(spans, "2026-10-19")).toEqual([]);
  });
});

describe("calendarHref", () => {
  it("คง filter · ไม่ใส่ค่าว่าง · override ได้", () => {
    const s = { view: "week" as const, d: "2026-10-08", campaign: "c1" };
    expect(calendarHref(s)).toBe("/marketing/calendar?view=week&d=2026-10-08&campaign=c1");
    expect(calendarHref(s, { view: "month", d: "2026-11-01" })).toBe("/marketing/calendar?view=month&d=2026-11-01&campaign=c1");
    expect(calendarHref({ view: "list" })).toBe("/marketing/calendar?view=list");
  });
});

import { dayOfMonth, periodLabel } from "./calendar-view";

describe("periodLabel (พ.ศ.)", () => {
  it("สัปดาห์เดือนเดียวกัน / คร่อมเดือน / เดือน", () => {
    expect(periodLabel("week", "2026-10-08")).toContain("5–11");
    expect(periodLabel("week", "2026-10-08")).toContain("2569");
    const cross = periodLabel("week", "2026-10-01");
    expect(cross).toContain("28");
    expect(cross).toContain("2569");
    expect(periodLabel("month", "2026-10-15")).toContain("2569");
    expect(periodLabel("list", "2026-10-15")).toBe(periodLabel("month", "2026-10-01"));
  });
  it("dayOfMonth", () => {
    expect(dayOfMonth("2026-10-09")).toBe(9);
  });
});

import { firstVisibleDay, isCalendarDate, isMultiDay, layoutSpans } from "./calendar-view";

describe("isCalendarDate — clamp ปี 2025–2030", () => {
  it("ในช่วงผ่าน · นอกช่วง/วันที่ไม่จริง ไม่ผ่าน", () => {
    for (const ok of ["2025-01-01", "2026-10-10", "2030-12-31"]) expect(isCalendarDate(ok), ok).toBe(true);
    for (const bad of ["2024-12-31", "2031-01-01", "0001-01-01", "9999-12-31", "2026-02-30", "x", null]) expect(isCalendarDate(bad as string), String(bad)).toBe(false);
  });
});

describe("งานหลายวัน", () => {
  it("isMultiDay", () => {
    expect(isMultiDay({ resolvedStart: "2026-10-10", resolvedEnd: "2026-10-18" })).toBe(true);
    expect(isMultiDay({ resolvedStart: "2026-10-10", resolvedEnd: "2026-10-10" })).toBe(false);
    expect(isMultiDay({ resolvedStart: "2026-10-10", resolvedEnd: null })).toBe(false);
    expect(isMultiDay({ resolvedStart: null, resolvedEnd: "2026-10-10" })).toBe(false);
  });
  it("layoutSpans: ตัดให้อยู่ในสัปดาห์ · บอกว่าต่อก่อน/หลัง · คอลัมน์ถูก", () => {
    const bars = layoutSpans([{ resolvedStart: "2026-10-10", resolvedEnd: "2026-10-18", n: "กินเจ" }], "2026-10-05");
    expect(bars).toHaveLength(1);
    expect(bars[0]).toMatchObject({ startCol: 6, endCol: 7, continuesBefore: false, continuesAfter: true, lane: 0 });
    const next = layoutSpans([{ resolvedStart: "2026-10-10", resolvedEnd: "2026-10-18" }], "2026-10-12");
    expect(next[0]).toMatchObject({ startCol: 1, endCol: 7, continuesBefore: true, continuesAfter: false });
  });
  it("คร่อมสิ้นเดือน 30 ต.ค.–2 พ.ย. ในสัปดาห์ 26 ต.ค. = พฤ.–อา. · สัปดาห์ถัดไป = จ.–จ.", () => {
    const item = { resolvedStart: "2026-10-30", resolvedEnd: "2026-11-02" };
    expect(layoutSpans([item], "2026-10-26")[0]).toMatchObject({ startCol: 5, endCol: 7, continuesAfter: true });
    expect(layoutSpans([item], "2026-11-02")[0]).toMatchObject({ startCol: 1, endCol: 1, continuesBefore: true, continuesAfter: false });
  });
  it("นอกสัปดาห์ / วันเดียว ไม่มีแถบ · แถบชนกันแยกแถว ไม่ชนแยกใช้แถวเดียว", () => {
    expect(layoutSpans([{ resolvedStart: "2026-10-20", resolvedEnd: "2026-10-22" }], "2026-10-05")).toEqual([]);
    expect(layoutSpans([{ resolvedStart: "2026-10-06", resolvedEnd: null }], "2026-10-05")).toEqual([]);
    const bars = layoutSpans(
      [
        { resolvedStart: "2026-10-05", resolvedEnd: "2026-10-08", k: "a" },
        { resolvedStart: "2026-10-07", resolvedEnd: "2026-10-09", k: "b" },
        { resolvedStart: "2026-10-10", resolvedEnd: "2026-10-11", k: "c" },
      ],
      "2026-10-05"
    );
    const lane = (k: string) => bars.find((b) => (b.item as { k: string }).k === k)?.lane;
    expect(lane("a")).toBe(0);
    expect(lane("b")).toBe(1);
    expect(lane("c")).toBe(0);
  });
  it("firstVisibleDay: วันเริ่ม หรือวันแรกของช่วงถ้าเริ่มก่อนหน้า", () => {
    expect(firstVisibleDay({ resolvedStart: "2026-10-10", resolvedEnd: "2026-10-18" }, "2026-10-01")).toBe("2026-10-10");
    expect(firstVisibleDay({ resolvedStart: "2026-09-25", resolvedEnd: "2026-10-18" }, "2026-10-01")).toBe("2026-10-01");
    expect(firstVisibleDay({ resolvedStart: null, resolvedEnd: null }, "2026-10-01")).toBeNull();
  });
});

describe("canShift — ปุ่ม ‹ › ที่ขอบ (BUG-QA-4)", () => {
  it("ธ.ค. 2030 เดือนถัดไปไม่ได้ · ม.ค. 2025 เดือนก่อนไม่ได้ · กลางช่วงได้", () => {
    expect(canShift("month", "2030-12-31", 1)).toBe(false);
    expect(canShift("month", "2030-12-31", -1)).toBe(true);
    expect(canShift("month", "2025-01-15", -1)).toBe(false);
    expect(canShift("list", "2025-01-15", 1)).toBe(true);
    expect(canShift("week", "2026-10-14", 1)).toBe(true);
  });
  it("สัปดาห์สุดท้ายของ 2030 ถัดไปไม่ได้ · สัปดาห์แรกของ 2025 ก่อนไม่ได้", () => {
    expect(canShift("week", "2030-12-28", 1)).toBe(false);
    expect(canShift("week", "2025-01-03", -1)).toBe(false);
  });
});
