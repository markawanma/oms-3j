// qty-split (pure) — "ได้รับเพิ่มแล้ว" (0183): ค้าง open · ได้รับเพิ่ม n → ได้รับเพิ่ม/ยังค้าง · ป้ายปุ่ม · ข้อความหลังสำเร็จ
import { describe, expect, it } from "vitest";
import { arriveButtonLabel, arriveDisabled, arriveDoneMessage, arriveView } from "@/lib/jobs/qty-split";

describe("arriveView", () => {
  it("n = open → all · ยังค้าง 0 · ปุ่ม 'รับเพิ่ม 2 ชิ้น'", () => {
    const v = arriveView({ open: 2, n: 2 });
    expect(v).toEqual({ open: 2, got: 2, remaining: 0, state: "all" });
    expect(arriveButtonLabel(v)).toBe("รับเพิ่ม 2 ชิ้น");
    expect(arriveDisabled(v.state)).toBe(false);
  });
  it("n < open → partial · ยังค้าง = open − n · ได้ + ค้าง = open ทุกค่า n", () => {
    const v = arriveView({ open: 5, n: 1 });
    expect(v).toEqual({ open: 5, got: 1, remaining: 4, state: "partial" });
    expect(arriveButtonLabel(v)).toBe("รับเพิ่ม 1 ชิ้น");
    expect(arriveDisabled(v.state)).toBe(false);
    for (const open of [2, 3, 7, 48]) for (let n = 1; n <= open; n++) {
      const x = arriveView({ open, n });
      expect(x.got + x.remaining).toBe(open);
    }
  });
  it("n > open → over · ปุ่มปิด 'ได้รับเพิ่มได้ไม่เกิน 5 ชิ้น' · ไม่นับ got", () => {
    const v = arriveView({ open: 5, n: 6 });
    expect(v).toMatchObject({ got: 0, remaining: 0, state: "over" });
    expect(arriveButtonLabel(v)).toBe("ได้รับเพิ่มได้ไม่เกิน 5 ชิ้น");
    expect(arriveDisabled(v.state)).toBe(true);
  });
  it("n ว่าง/พิมพ์ไม่ผ่าน (null) → empty · ปุ่มปิด 'ใส่จำนวนที่ได้รับเพิ่ม'", () => {
    const v = arriveView({ open: 5, n: null });
    expect(v.state).toBe("empty");
    expect(arriveButtonLabel(v)).toBe("ใส่จำนวนที่ได้รับเพิ่ม");
    expect(arriveDisabled(v.state)).toBe(true);
  });
});

describe("arriveDoneMessage", () => {
  it("ครบ: 'รับเพิ่ม 2 ชิ้นแล้ว · ถืออยู่ที่ขั้น ตรวจ QC ส่งต่อได้' (ไม่มี 'ยังค้าง')", () => {
    const m = arriveDoneMessage(2, 0, "ตรวจ QC");
    expect(m).toBe("รับเพิ่ม 2 ชิ้นแล้ว · ถืออยู่ที่ขั้น ตรวจ QC ส่งต่อได้");
    expect(m).not.toMatch(/ค้าง/);
  });
  it("ยังค้าง: ต่อท้าย '· ยังค้าง 4 ชิ้น'", () => {
    expect(arriveDoneMessage(1, 4, "ตรวจ QC")).toBe("รับเพิ่ม 1 ชิ้นแล้ว · ถืออยู่ที่ขั้น ตรวจ QC ส่งต่อได้ · ยังค้าง 4 ชิ้น");
  });
});
