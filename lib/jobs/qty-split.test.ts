// qty-split (pure) — สูตรจำนวนชิ้นจอส่ง/รับหน้าช่าง v2 · เคส "ต้องถูก" ตาม ux-worker-send-receive-v2.md §9
import { describe, expect, it } from "vitest";
import { clampSendText, receiveButtonLabel, receiveDisabled, receiveView, sendButtonLabel, sendDisabled, splitView } from "@/lib/jobs/qty-split";

const label = (hold: number, scrap: number, n: number | null) => {
  const v = splitView({ hold, scrap, n });
  return { v, text: sendButtonLabel({ ...v, hold }) };
};

describe("splitView + sendButtonLabel", () => {
  it("ถือ 53 · เสีย 0 · n=40 → ส่ง 40 · เหลือ 13 · ผลรวม 53 · ปุ่มพูดผล", () => {
    const { v, text } = label(53, 0, 40);
    expect(v).toMatchObject({ allCount: 53, send: 40, keep: 13, scrap: 0, state: "partial" });
    expect(v.send + v.keep + v.scrap).toBe(53);
    expect(text).toBe("ส่ง 40 ชิ้น · เหลือกับฉัน 13");
  });
  it("ถือ 53 · เสีย 2 · ส่งหมด (n = ถือ − เสีย) → ส่ง 51 · เหลือ 0", () => {
    const { v, text } = label(53, 2, 51);
    expect(v).toMatchObject({ allCount: 51, send: 51, keep: 0, scrap: 2, state: "all" });
    expect(text).toBe("ส่ง 51 ชิ้น · เสีย 2");
  });
  it("ถือ 53 · เสีย 2 · n=40 → เหลือ 11 · 40+11+2 = 53 (เลขคี่)", () => {
    const { v, text } = label(53, 2, 40);
    expect(v).toMatchObject({ send: 40, keep: 11, scrap: 2, state: "partial" });
    expect(v.send + v.keep + v.scrap).toBe(53);
    expect(text).toBe("ส่ง 40 ชิ้น · เสีย 2 · เหลือกับฉัน 11");
  });
  it("ส่งหมด ไม่มีเสีย → 'ส่งหมด 53 ชิ้น'", () => {
    expect(label(53, 0, 53).text).toBe("ส่งหมด 53 ชิ้น");
  });
  it("n พิมพ์ 60 > allCount → over · ปุ่มปิด · 'ส่งได้ไม่เกิน 53 ชิ้น'", () => {
    const { v, text } = label(53, 0, 60);
    expect(v.state).toBe("over");
    expect(sendDisabled(v.state)).toBe(true);
    expect(text).toBe("ส่งได้ไม่เกิน 53 ชิ้น");
    expect(v.send).toBe(0);
  });
  it("n ว่าง/'0'/'abc' (ผู้เรียกส่ง null) → empty · ปุ่มปิด · 'ใส่จำนวนที่ส่ง'", () => {
    const { v, text } = label(53, 0, null);
    expect(v.state).toBe("empty");
    expect(sendDisabled(v.state)).toBe(true);
    expect(text).toBe("ใส่จำนวนที่ส่ง");
  });
  it("ถือ 1 → 'ส่ง 1 ชิ้น' (ไม่ใช่ ส่งหมด)", () => {
    expect(label(1, 0, 1).text).toBe("ส่ง 1 ชิ้น");
  });
  it("เสียหมดทั้งก้อน (allCount 0) → scrapAll · ปุ่มปิด · 'เสียหมดทั้ง 53 ชิ้น — แจ้งออฟฟิศให้ยกเลิก/ปิดใบ' (ไม่มีปุ่มแจ้งเสียหมด · ไม่ใช่ 'ส่ง 0 ชิ้น')", () => {
    for (const n of [0, 5, null]) {
      const { v, text } = label(53, 53, n);
      expect(v).toMatchObject({ allCount: 0, send: 0, keep: 0, state: "scrapAll" });
      expect(text).toBe("เสียหมดทั้ง 53 ชิ้น — แจ้งออฟฟิศให้ยกเลิก/ปิดใบ");
      expect(text).not.toMatch(/ส่ง 0|แจ้งเสียหมด/);
      expect(sendDisabled(v.state)).toBe(true);
    }
    expect(label(1, 1, 0).text).toBe("เสียหมดทั้ง 1 ชิ้น — แจ้งออฟฟิศให้ยกเลิก/ปิดใบ");
  });
  it("เสีย = ถือ − 1 ยังส่งได้ 1 ชิ้น (ไม่ใช่ scrapAll)", () => {
    const { v, text } = label(53, 52, 1);
    expect(v.state).toBe("all");
    expect(sendDisabled(v.state)).toBe(false);
    expect(text).toBe("ส่ง 1 ชิ้น · เสีย 52");
  });
  it("เสียมากกว่าที่ถือ (ข้อมูลผิด) ไม่ทำให้ติดลบ", () => {
    expect(splitView({ hold: 5, scrap: 9, n: 1 })).toMatchObject({ allCount: 0, send: 0, keep: 0 });
  });
  it("ผลรวม ส่งไป + เหลือ + เสีย = ถือ ทุกค่า n ที่ถูก (ไล่ทุกเลข)", () => {
    for (const [hold, scrap] of [[53, 0], [53, 2], [10, 3], [2, 1]] as const)
      for (let n = 1; n <= hold - scrap; n++) {
        const v = splitView({ hold, scrap, n });
        expect(v.send + v.keep + v.scrap).toBe(hold);
      }
  });
  it("state all/partial ไม่ปิดปุ่ม", () => {
    expect(sendDisabled("all")).toBe(false);
    expect(sendDisabled("partial")).toBe(false);
  });
});

describe("clampSendText", () => {
  it("เพิ่มเสียจน allCount < n → n = allCount", () => {
    expect(clampSendText("50", 53, 5)).toBe("48");
    expect(clampSendText("40", 53, 5)).toBe("40"); // ยังพอ ไม่ขยับ
  });
  it("โหมดส่งหมด (null) ตามสดเอง · เสียหมด = กลับ null · ว่าง/ผิดรูป คงเดิม (ไม่เดา)", () => {
    expect(clampSendText(null, 53, 5)).toBeNull();
    expect(clampSendText("10", 53, 53)).toBeNull();
    expect(clampSendText("", 53, 5)).toBe("");
    expect(clampSendText("abc", 53, 5)).toBe("abc");
  });
  it("ลดเสีย → n ไม่ขยับเอง", () => {
    expect(clampSendText("48", 53, 0)).toBe("48");
  });
});

describe("receiveView + receiveButtonLabel", () => {
  const btn = (E: number | null, r: number | null) => receiveButtonLabel(E, E === null ? null : receiveView({ expected: E, r }));
  it("E=50 r=47 → 'รับ 47 ชิ้น · ขาด 3' · ขาด 3", () => {
    expect(receiveView({ expected: 50, r: 47 })).toMatchObject({ got: 47, missing: 3, state: "short" });
    expect(btn(50, 47)).toBe("รับ 47 ชิ้น · ขาด 3");
  });
  it("r=50 → 'รับ 50 ชิ้น' ครบ (ขาด 0)", () => {
    expect(receiveView({ expected: 50, r: 50 })).toMatchObject({ missing: 0, state: "all" });
    expect(btn(50, 50)).toBe("รับ 50 ชิ้น");
  });
  it("r > E → over ปิดปุ่ม 'รับได้ไม่เกิน 50 ชิ้น' · r ว่าง → empty 'ใส่จำนวนที่ได้รับ'", () => {
    expect(receiveView({ expected: 50, r: 51 }).state).toBe("over");
    expect(btn(50, 51)).toBe("รับได้ไม่เกิน 50 ชิ้น");
    expect(btn(50, null)).toBe("ใส่จำนวนที่ได้รับ");
  });
  it("E=0 (ขั้นก่อนเสียหมด · ใบเก่า) → none · ปิดรับ · 'ขั้นก่อนเสียหมด — แจ้งออฟฟิศ' ไม่ว่า r เป็นอะไร", () => {
    for (const r of [0, 1, null]) {
      const v = receiveView({ expected: 0, r });
      expect(v).toMatchObject({ state: "none", got: 0, missing: 0 });
      expect(receiveDisabled(v.state)).toBe(true);
      expect(btn(0, r)).toBe("ขั้นก่อนเสียหมด — แจ้งออฟฟิศ");
    }
    expect(receiveDisabled("all")).toBe(false);
  });
  it("ไม่รู้จำนวน → 'รับงาน' เดิม · E=1 → 'รับ 1 ชิ้น'", () => {
    expect(btn(null, null)).toBe("รับงาน");
    expect(btn(1, 1)).toBe("รับ 1 ชิ้น");
  });
});
