// markTargetForJobs — ชุด { lineIds, expected } ชุดเดียวที่ใช้ทุกทาง: แท็บยังไม่สั่ง = line ที่ orderedQty null หรือ < ต้องใช้ · แท็บสั่งแล้ว = line ที่ orderedQty ไม่ null
import { describe, expect, it } from "vitest";
import { markTargetForJobs } from "./gems-to-buy";
import type { GtbJob } from "./gems-to-buy";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
type L = GtbJob["lines"][number];
const line = (n: number, needed: number, ordered: number | null): L => ({ lineId: U(n), qtyNeededNow: needed, orderedQty: ordered });
const job = (lines: L[]): Pick<GtbJob, "lineIds" | "lines"> => ({ lineIds: lines.map((l) => l.lineId), lines });

describe("markTargetForJobs — ติ๊ก (ordered=true)", () => {
  it("ใบ line เดียวที่ยังไม่ติ๊ก = line นั้น + expected = ยอดต้องใช้ (ไม่ใช่ยอดที่เหลือ)", () => {
    expect(markTargetForJobs([job([line(1, 90, null)])], true)).toEqual({ lineIds: [U(1)], expected: { [U(1)]: 90 } });
  });
  it("เอาเฉพาะ line ที่ orderedQty === null หรือ < ต้องใช้ — ติ๊กครบแล้ว (=) และสั่งเกิน (>) ไม่ถูกส่ง", () => {
    const t = markTargetForJobs([job([line(1, 10, null), line(2, 20, 20), line(3, 90, 70), line(4, 50, 70)])], true);
    expect(t.lineIds).toEqual([U(1), U(3)]);
    expect(t.expected).toEqual({ [U(1)]: 10, [U(3)]: 90 });
  });
  it("หลายใบ: รวมเป็นชุดเดียว · ลำดับตามใบ→line · key ของ expected = lineIds พอดี", () => {
    const t = markTargetForJobs([job([line(1, 12, null), line(2, 8, null)]), job([line(3, 5, 5)]), job([line(4, 7, null)])], true);
    expect(t.lineIds).toEqual([U(1), U(2), U(4)]);
    expect(new Set(Object.keys(t.expected as Record<string, number>))).toEqual(new Set(t.lineIds));
    expect(t.expected).toEqual({ [U(1)]: 12, [U(2)]: 8, [U(4)]: 7 });
  });
  it("ทุก line ติ๊กครบแล้ว = lineIds ว่าง (ไม่มีอะไรต้องทำ) แต่ไม่ใช่ข้อมูลเสีย (expected ไม่ใช่ null)", () => {
    const t = markTargetForJobs([job([line(1, 10, 10)])], true);
    expect(t.lineIds).toEqual([]);
    expect(t.expected).not.toBeNull();
  });
});

describe("markTargetForJobs — ยกเลิก (ordered=false)", () => {
  it("เอาเฉพาะ line ที่ติ๊กอยู่ (orderedQty ไม่ null) — ไม่ส่ง expected", () => {
    const t = markTargetForJobs([job([line(1, 10, null), line(2, 20, 20), line(3, 90, 70), line(4, 50, 70)])], false);
    expect(t.lineIds).toEqual([U(2), U(3), U(4)]);
    expect(t.expected).toBeUndefined();
  });
  it("ไม่มี line ติ๊กอยู่ = ว่าง", () => {
    expect(markTargetForJobs([job([line(1, 10, null)])], false)).toEqual({ lineIds: [], expected: undefined });
  });
});

describe("markTargetForJobs — ข้อมูลไม่ครบ = { lineIds: [], expected: null } (ไม่เดา ไม่ยิง) ทั้งสองทิศทาง", () => {
  const BAD = { lineIds: [], expected: null };
  for (const ordered of [true, false]) {
    const tag = ordered ? "ติ๊ก" : "ยกเลิก";
    it(`${tag}: ไม่มีอะไร/ไม่มี lines/ids ไม่ตรง lineIds/ยอดไม่ใช่จำนวนเต็มบวก/line ซ้ำ`, () => {
      expect(markTargetForJobs([], ordered).lineIds).toEqual([]);
      expect(markTargetForJobs([{ lineIds: [U(1)], lines: [] }], ordered)).toEqual(BAD);
      expect(markTargetForJobs([{ lineIds: [U(1), U(2)], lines: [line(1, 10, null)] }], ordered)).toEqual(BAD);
      expect(markTargetForJobs([{ lineIds: [U(1)], lines: [line(9, 10, null)] }], ordered)).toEqual(BAD);
      expect(markTargetForJobs([job([line(1, 0, null)])], ordered)).toEqual(BAD);
      expect(markTargetForJobs([job([line(1, 1.5, null)])], ordered)).toEqual(BAD);
      expect(markTargetForJobs([job([line(1, 10, null)]), job([line(1, 10, null)])], ordered)).toEqual(BAD);
    });
  }
  it("job หนึ่งเสียทำให้ทั้งชุดเสีย (ไม่ข้ามใบที่เสียแล้วส่งที่เหลือ)", () => {
    expect(markTargetForJobs([job([line(1, 10, null)]), { lineIds: [U(2)], lines: [] }], true)).toEqual(BAD);
  });
});
