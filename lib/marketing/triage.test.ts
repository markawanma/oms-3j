import { describe, expect, it } from "vitest";
import {
  baselineLine,
  chosenInWeek,
  countByChannel,
  dayOptionLabel,
  distinctHookTypes,
  emptyDayCount,
  groupIdeas,
  needsLineConfirm,
  parsePlanBlockers,
  pieceCountsByDay,
  triageWeekDays,
  triageWeekFrom,
  triageWeekHref,
  triageWeekLabel,
} from "./triage";
import type { LineQuota, PieceRow } from "./piece-types";
import { PASS_OP_LABEL } from "./piece-labels";

const row = (o: Partial<PieceRow>): PieceRow =>
  ({ stepId: "s", pieceStatus: "idea", holdReason: null, hooks: [], resolvedStart: null, resolvedEnd: null, channel: null, pieceKind: null, ...o }) as PieceRow;
const quota = (o: Partial<LineQuota>): LineQuota => ({ used28d: 1, planned28d: 0, quota: 4, remaining28d: 3, overQuotaPlanned: false, ...o });

describe("triageWeekFrom", () => {
  it("วันใดก็ได้ในสัปดาห์ → วันจันทร์", () => {
    expect(triageWeekFrom("2026-10-10", "2026-10-14")).toBe("2026-10-12");
    expect(triageWeekFrom("2026-10-07", null)).toBe("2026-10-05");
  });
  it("เสาร์–อาทิตย์ ไม่ระบุสัปดาห์ = สัปดาห์ถัดไป · จันทร์–ศุกร์ = สัปดาห์นี้", () => {
    expect(triageWeekFrom("2026-10-10", null)).toBe("2026-10-12"); // เสาร์
    expect(triageWeekFrom("2026-10-11", null)).toBe("2026-10-12"); // อาทิตย์
    expect(triageWeekFrom("2026-10-09", null)).toBe("2026-10-05"); // ศุกร์
    expect(triageWeekFrom("2026-10-05", null)).toBe("2026-10-05"); // จันทร์
  });
  it("ผิดรูป/ปีนอกช่วง → สัปดาห์นี้", () => {
    expect(triageWeekFrom("2026-10-07", "9999-01-01")).toBe("2026-10-05");
    expect(triageWeekFrom("2026-10-07", "abc")).toBe("2026-10-05");
    expect(triageWeekFrom("2026-10-07", "2026-02-30")).toBe("2026-10-05");
    expect(triageWeekFrom("2026-10-07", "2026-10-11")).toBe("2026-10-05"); // อาทิตย์ของสัปดาห์ 5–11 ยังเป็นสัปดาห์นั้น
  });
});

describe("triageWeekHref / label / days", () => {
  it("สัปดาห์นี้ไม่มี ?w · สัปดาห์อื่นมี", () => {
    // วันนี้ศุกร์ 9 ต.ค. → ค่าเริ่มต้น = 5 ต.ค.
    expect(triageWeekHref("2026-10-12", -1, "2026-10-09")).toBe("/marketing/triage");
    expect(triageWeekHref("2026-10-05", 1, "2026-10-09")).toBe("/marketing/triage?w=2026-10-12");
    // วันนี้เสาร์ 10 ต.ค. → ค่าเริ่มต้น = 12 ต.ค.
    expect(triageWeekHref("2026-10-19", -1, "2026-10-10")).toBe("/marketing/triage");
  });
  it("ออกนอกปีที่รองรับ → null", () => {
    expect(triageWeekHref("2030-12-30", 1, "2026-10-10")).toBeNull();
    expect(triageWeekHref("2025-01-06", -1, "2026-10-10")).toBeNull();
  });
  it("7 วัน จันทร์–อาทิตย์", () => {
    const d = triageWeekDays("2026-10-12");
    expect(d).toHaveLength(7);
    expect(d[0]).toBe("2026-10-12");
    expect(d[6]).toBe("2026-10-18");
    expect(triageWeekLabel("2026-10-12")).toMatch(/12.*18/);
  });
});

describe("groupIdeas / chosenInWeek", () => {
  it("แยกรอคัดกับเลื่อนไว้ (hold overlay) · ไม่ปนสถานะอื่น", () => {
    const g = groupIdeas([row({ stepId: "a" }), row({ stepId: "b", holdReason: "รอภาพ" }), row({ stepId: "c", pieceStatus: "planned" })]);
    expect(g.pending.map((r) => r.stepId)).toEqual(["a"]);
    expect(g.held.map((r) => r.stepId)).toEqual(["b"]);
  });
  it("ลงปฏิทินแล้ว = planned ที่ไม่ถูกพัก เรียงตามวัน", () => {
    const c = chosenInWeek([
      row({ stepId: "x", pieceStatus: "planned", resolvedStart: "2026-10-16" }),
      row({ stepId: "y", pieceStatus: "planned", resolvedStart: "2026-10-14" }),
      row({ stepId: "z", pieceStatus: "planned", holdReason: "รอ" }),
      row({ stepId: "w", pieceStatus: "drafting", resolvedStart: "2026-10-15" }),
    ]);
    expect(c.map((r) => r.stepId)).toEqual(["y", "x"]);
  });
});

describe("pieceCountsByDay / emptyDayCount / countByChannel", () => {
  const days = triageWeekDays("2026-10-12");
  it("งานหลายวันนับทุกวันที่คร่อม · ยกเลิกไม่นับ · ไม่มีวันไม่นับ", () => {
    const c = pieceCountsByDay(
      [
        row({ pieceStatus: "planned", resolvedStart: "2026-10-13", resolvedEnd: "2026-10-15" }),
        row({ pieceStatus: "cancelled", resolvedStart: "2026-10-12" }),
        row({ pieceStatus: "idea", resolvedStart: null }),
        row({ pieceStatus: "approved", resolvedStart: "2026-10-18" }),
      ],
      days
    );
    expect(c["2026-10-12"]).toBe(0);
    expect(c["2026-10-13"]).toBe(1);
    expect(c["2026-10-15"]).toBe(1);
    expect(c["2026-10-16"]).toBe(0);
    expect(c["2026-10-18"]).toBe(1);
    expect(emptyDayCount(c)).toBe(3);
  });
  it("นับต่อช่อง ไม่มีตัวหาร", () => {
    const r = countByChannel([
      row({ channel: "tiktok" }),
      row({ channel: "tiktok" }),
      row({ channel: "line_oa" }),
      row({ channel: "tiktok", pieceStatus: "cancelled" }),
      row({ channel: null }),
    ]);
    expect(r).toEqual([
      { channel: "tiktok", n: 2 },
      { channel: "line_oa", n: 1 },
    ]);
  });
  it("ป้ายตัวเลือกวัน", () => {
    expect(dayOptionLabel("2026-10-14", 0)).toContain("ยังไม่มีชิ้น");
    expect(dayOptionLabel("2026-10-14", 2)).toContain("มี 2 ชิ้น");
  });
});

describe("needsLineConfirm", () => {
  it("LINE + เกินโควตา หรือ เหลือ 0 → ถาม · LINE ที่ยังเหลือ → ไม่ถาม", () => {
    expect(needsLineConfirm({ pieceKind: "line_message", channel: "line_oa" }, quota({ overQuotaPlanned: true }))).toBe(true);
    expect(needsLineConfirm({ pieceKind: "line_message", channel: "line_oa" }, quota({ remaining28d: 0 }))).toBe(true);
    expect(needsLineConfirm({ pieceKind: "line_message", channel: "line_oa" }, quota({}))).toBe(false);
  });
  it("ไม่ใช่ LINE หรือไม่มีข้อมูลโควตา → ไม่ถาม (ต้องไม่พัง)", () => {
    expect(needsLineConfirm({ pieceKind: "short_clip", channel: "tiktok" }, quota({ overQuotaPlanned: true, remaining28d: 0 }))).toBe(false);
    expect(needsLineConfirm({ pieceKind: "line_message", channel: "line_oa" }, null)).toBe(false);
  });
});

describe("baselineLine", () => {
  const base = { baselineValue: null, baselineAsOf: null, passThreshold: null, passOp: null, metricCode: "save_rate" } as const;
  it("แสดงตัวเลขดิบ ไม่ใส่ %", () => {
    const t = baselineLine({ ...base, baselineValue: 0.3, baselineAsOf: "2026-10-11", passThreshold: 0.36, passOp: ">=" }, PASS_OP_LABEL);
    expect(t).toContain("ฐาน 0.3");
    expect(t).toContain("เกณฑ์ ไม่น้อยกว่า 0.36");
    expect(t).not.toContain("%");
  });
  it("0 เป็นค่าจริง · ไม่วัดผล/ไม่มีค่า = null", () => {
    expect(baselineLine({ ...base, baselineValue: 0, passThreshold: 0, passOp: ">=" }, PASS_OP_LABEL)).toBe("ฐาน 0 → เกณฑ์ ไม่น้อยกว่า 0");
    expect(baselineLine({ ...base, metricCode: "none", baselineValue: 5 }, PASS_OP_LABEL)).toBeNull();
    expect(baselineLine(base, PASS_OP_LABEL)).toBeNull();
  });
});

describe("parsePlanBlockers", () => {
  it("แยกรายการที่ขาดจากข้อความ 55000", () => {
    expect(parsePlanBlockers("วางแผนไม่ได้ — ยังไม่ได้ตั้งวัน · ยังไม่มีเกณฑ์ผ่าน")).toEqual(["ยังไม่ได้ตั้งวัน", "ยังไม่มีเกณฑ์ผ่าน"]);
  });
  it("ข้อความอื่น/ว่าง → null", () => {
    expect(parsePlanBlockers("เปลี่ยนสถานะไม่สำเร็จ")).toBeNull();
    expect(parsePlanBlockers(null)).toBeNull();
    expect(parsePlanBlockers("วางแผนไม่ได้ — ")).toBeNull();
  });
});

describe("distinctHookTypes", () => {
  it("นับประเภทไม่ซ้ำ ไม่นับที่ยังไม่ติดประเภท", () => {
    const hooks = [{ hookType: "question" }, { hookType: "question" }, { hookType: null }, { hookType: "proof" }] as PieceRow["hooks"];
    expect(distinctHookTypes({ hooks })).toEqual(["question", "proof"]);
  });
});
