import { describe, expect, it } from "vitest";
import { nextHistoryState, readHistState } from "./screen-history";

const isId = (v: unknown): v is "a" | "b" => v === "a" || v === "b";

describe("nextHistoryState", () => {
  it("คง key เดิมทั้งหมด (__NA ของ Next) แล้วเติม key + i — ไม่เขียนทับทั้งก้อน (N9)", () => {
    const cur = { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: ["x"], gq: "q1", i: 1 };
    const next = nextHistoryState("gq", "q2", 2, cur);
    expect(next).toEqual({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: ["x"], gq: "q2", i: 2 });
    expect(cur.gq).toBe("q1"); // ไม่ mutate ของเดิม
  });
  it("state เดิมเป็น null / array / primitive = เริ่มจากว่าง ไม่ throw", () => {
    expect(nextHistoryState("gq", "q1", 1, null)).toEqual({ gq: "q1", i: 1 });
    expect(nextHistoryState("gq", "q1", 1, ["x"])).toEqual({ gq: "q1", i: 1 });
    expect(nextHistoryState("gq", "q1", 1, "str")).toEqual({ gq: "q1", i: 1 });
  });
});

describe("readHistState", () => {
  it("อ่าน id + i ที่ถูกรูป", () => {
    expect(readHistState("gq", isId, { gq: "a", i: 3 })).toEqual({ id: "a", i: 3 });
  });
  it("ไม่ใช่รูปที่รู้จัก = null (id ผิด · i ติดลบ/ทศนิยม/ไม่ใช่เลข · ไม่มี state)", () => {
    for (const bad of [null, undefined, [], "x", { gq: "zzz", i: 1 }, { gq: "a", i: -1 }, { gq: "a", i: 1.5 }, { gq: "a", i: "1" }, { i: 1 }, { rs: "a", i: 1 }]) {
      expect(readHistState("gq", isId, bad)).toBeNull();
    }
  });
});
