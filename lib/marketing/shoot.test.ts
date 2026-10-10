import { describe, expect, it } from "vitest";
import { doneKey, groupByLocation, isShotDone, locationKeyOf, needsShotConfirm, remainingShots, shootWeekFrom, shootWeekHref, shotsOf, summarize, toShootItems } from "./shoot";
import type { PieceRow } from "./piece-types";

const piece = (o: Partial<PieceRow>): PieceRow =>
  ({ stepId: "s1", title: "ชิ้น", pieceStatus: "approved", footageStatus: "needs_shoot", shootLocation: null, shootMinutesEst: null, resolvedStart: "2026-10-13", clipBrief: null, ...o }) as PieceRow;
const brief = (shots: unknown[]) => ({ shots }) as unknown as PieceRow["clipBrief"];

describe("shotsOf", () => {
  it("ทนข้อมูลไม่ครบ: ข้ามช็อตที่ไม่มี id/desc · ไม่ใช่ array = ว่าง · ไม่ throw", () => {
    expect(shotsOf(piece({ clipBrief: null }))).toEqual([]);
    expect(shotsOf(piece({ clipBrief: { shots: "x" } as unknown as PieceRow["clipBrief"] }))).toEqual([]);
    const s = shotsOf(piece({ clipBrief: brief([{ id: "a", desc: "มือ", done: true }, { id: "", desc: "x" }, { desc: "ไม่มี id" }, null, 5, { id: "b", desc: "หน้า", done: "yes" }]) }));
    expect(s).toEqual([
      { id: "a", desc: "มือ", done: true },
      { id: "b", desc: "หน้า", done: false },
    ]);
  });
});

describe("toShootItems — ชุดของหน้ารอบถ่าย", () => {
  it("เฉพาะ approved + needs_shoot · ไม่มี in_review/produced/มีภาพแล้ว", () => {
    const items = toShootItems([
      piece({ stepId: "a" }),
      piece({ stepId: "b", pieceStatus: "in_review" }),
      piece({ stepId: "c", pieceStatus: "produced" }),
      piece({ stepId: "d", footageStatus: "has_footage" }),
      piece({ stepId: "e", pieceStatus: "planned" }),
    ]);
    expect(items.map((i) => i.piece.stepId)).toEqual(["a"]);
  });
  it("เรียงตามวันแล้วชื่อ", () => {
    const items = toShootItems([piece({ stepId: "x", resolvedStart: "2026-10-15" }), piece({ stepId: "y", resolvedStart: "2026-10-13", title: "ข" }), piece({ stepId: "z", resolvedStart: "2026-10-13", title: "ก" })]);
    expect(items.map((i) => i.piece.stepId)).toEqual(["z", "y", "x"]);
  });
});

describe("กลุ่มสถานที่", () => {
  it("เรียง โรงงาน → โต๊ะสินค้า → หน้ากล้อง → อื่นๆ → ยังไม่ระบุ · ซ่อนกลุ่มว่าง · ค่านอก enum = ยังไม่ระบุ", () => {
    const items = toShootItems([
      piece({ stepId: "1", shootLocation: "host_cam" }),
      piece({ stepId: "2", shootLocation: null }),
      piece({ stepId: "3", shootLocation: "factory" }),
      piece({ stepId: "4", shootLocation: "ดวงจันทร์" }),
    ]);
    const g = groupByLocation(items);
    expect(g.map((x) => x.key)).toEqual(["factory", "host_cam", "unspecified"]);
    expect(g[2].items.map((i) => i.piece.stepId).sort()).toEqual(["2", "4"]);
    expect(locationKeyOf({ shootLocation: "product_table" })).toBe("product_table");
  });
});

describe("สรุป / ติ๊กช็อต", () => {
  const items = toShootItems([
    piece({ stepId: "a", shootMinutesEst: 15, clipBrief: brief([{ id: "1", desc: "x", done: true }, { id: "2", desc: "y", done: false }]) }),
    piece({ stepId: "b", shootMinutesEst: null, clipBrief: brief([{ id: "1", desc: "z", done: false }]) }),
    piece({ stepId: "c", shootMinutesEst: 0, clipBrief: null }),
  ]);

  it("รวมนาทีเฉพาะที่ระบุ (0 เป็นค่าจริง) · นับชิ้นที่ยังไม่ระบุ", () => {
    const s = summarize(items, {});
    expect(s).toMatchObject({ pieces: 3, shots: 3, shotsDone: 1, minutes: 15, unknownMinutesPieces: 1 });
  });
  it("ไม่มีชิ้นไหนระบุเวลา → minutes = null (ไม่เดาเป็น 0)", () => {
    expect(summarize(toShootItems([piece({})]), {}).minutes).toBeNull();
    expect(summarize([], {}).minutes).toBeNull();
  });
  it("local ทับค่า server", () => {
    const a = items.find((i) => i.piece.stepId === "a")!;
    expect(isShotDone(a, a.shots[1], {})).toBe(false);
    expect(isShotDone(a, a.shots[1], { [doneKey("a", "2")]: true })).toBe(true);
    expect(isShotDone(a, a.shots[0], { [doneKey("a", "1")]: false })).toBe(false);
    expect(remainingShots(a, { [doneKey("a", "2")]: true })).toBe(0);
  });
});

describe("needsShotConfirm (3.8)", () => {
  const items = toShootItems([
    piece({ stepId: "a", title: "ก", clipBrief: brief([{ id: "1", desc: "x", done: false }, { id: "2", desc: "y", done: true }]) }),
    piece({ stepId: "b", title: "ข", clipBrief: brief([{ id: "1", desc: "z", done: true }]) }),
    piece({ stepId: "c", title: "ค", clipBrief: null }),
  ]);
  it("ถามเฉพาะชิ้นที่ติ๊กถ่ายครบแต่ยังเหลือช็อต", () => {
    expect(needsShotConfirm(items, new Set(["a", "b", "c"]), {})).toEqual([{ stepId: "a", title: "ก", remaining: 1 }]);
  });
  it("ติ๊กช็อตครบ/ชิ้นไม่มี shot list/ไม่ได้ติ๊กถ่ายครบ → ไม่ถาม (ต้องไม่พัง)", () => {
    expect(needsShotConfirm(items, new Set(["a"]), { [doneKey("a", "1")]: true })).toEqual([]);
    expect(needsShotConfirm(items, new Set(["b", "c"]), {})).toEqual([]);
    expect(needsShotConfirm(items, new Set(), {})).toEqual([]);
  });
});

describe("สัปดาห์", () => {
  it("ค่าเริ่มต้น = สัปดาห์นี้ (แม้เสาร์) · ?w ผิด = สัปดาห์นี้ · ลิงก์ก่อน/ถัดไป · ออกนอกปี = null", () => {
    expect(shootWeekFrom("2026-10-10", null)).toBe("2026-10-05");
    expect(shootWeekFrom("2026-10-10", "2026-10-21")).toBe("2026-10-19");
    expect(shootWeekFrom("2026-10-10", "9999-01-01")).toBe("2026-10-05");
    expect(shootWeekHref("2026-10-12", -1, "2026-10-10")).toBe("/marketing/shoot");
    expect(shootWeekHref("2026-10-05", 1, "2026-10-10")).toBe("/marketing/shoot?w=2026-10-12");
    expect(shootWeekHref("2030-12-30", 1, "2026-10-10")).toBeNull();
  });
});
