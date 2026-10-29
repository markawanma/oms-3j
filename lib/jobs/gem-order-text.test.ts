// lib/jobs/gem-order-text.ts — ข้อความคัดลอกไป LINE: 🔴 ไม่มีราคา/ต้นทุนแม้ input มี · จัดกลุ่มตามชนิด · ตามที่เลือก/ที่เห็น · เคส "ต้องไม่พัง" (ชื่อยาว · หลักล้าน · 0 รายการ)
import { describe, expect, it } from "vitest";
import { buildGemOrderText, gemOrderDateLabel, toGemOrderLines } from "./gem-order-text";
import type { GemOrderLine } from "./gem-order-text";

const line = (typeName: string, shapeName: string, sizeLabel: string, qty: number): GemOrderLine => ({ typeName, shapeName, sizeLabel, unitLabel: "เม็ด", qty });

describe("gemOrderDateLabel", () => {
  it("24 ต.ค. 69 (พ.ศ. 2 หลัก) · ไม่ใช่วันที่ = ว่าง", () => {
    expect(gemOrderDateLabel("2026-10-24")).toBe("24 ต.ค. 69");
    expect(gemOrderDateLabel("2026-01-05")).toBe("5 ม.ค. 69");
    expect(gemOrderDateLabel("x")).toBe("");
    expect(gemOrderDateLabel("2026-13-01")).toBe("");
  });
});

describe("buildGemOrderText", () => {
  it("รูปแบบตาม spec §6.2: หัว+วันที่ · จัดกลุ่มตามชนิด · รูปทรง→ขนาด · คั่นหลักพัน · รวม n รายการ", () => {
    const text = buildGemOrderText(
      [line("ไพลิน", "กลม", "1.5", 1050), line("โกเมน", "กลม", "2", 120), line("โกเมน", "ไข่", "4×6", 70)],
      { dateLabel: "24 ต.ค. 69" },
    );
    expect(text).toBe(["รายการสั่งซื้อพลอย · 24 ต.ค. 69", "", "โกเมน", "- กลม 2 มม. 120 เม็ด", "- ไข่ 4×6 มม. 70 เม็ด", "ไพลิน", "- กลม 1.5 มม. 1,050 เม็ด", "", "รวม 3 รายการ"].join("\n"));
  });
  it("ลำดับคงที่ ไม่ขึ้นกับลำดับ input · ขนาดเรียงเลขจริง (2 ก่อน 10)", () => {
    const a = buildGemOrderText([line("โกเมน", "กลม", "10", 1), line("โกเมน", "กลม", "2", 1), line("โกเมน", "กลม", "4×6", 1), line("โกเมน", "กลม", "4×5", 1)], { dateLabel: "" });
    const b = buildGemOrderText([line("โกเมน", "กลม", "4×5", 1), line("โกเมน", "กลม", "10", 1), line("โกเมน", "กลม", "4×6", 1), line("โกเมน", "กลม", "2", 1)], { dateLabel: "" });
    expect(a).toBe(b);
    expect(a.split("\n").filter((l) => l.startsWith("- ")).map((l) => l.split(" ")[2])).toEqual(["2", "4×5", "4×6", "10"]);
  });
  it("0 รายการ = ข้อความว่าง (ผู้เรียกต้องไม่คัดลอก)", () => {
    expect(buildGemOrderText([], { dateLabel: "24 ต.ค. 69" })).toBe("");
  });
  it("ไม่มีวันที่ = หัวไม่มีจุดกลาง · ไม่แต่งหัว/ท้ายอื่น (ไม่มีชื่อร้าน/เบอร์/ขอบคุณ)", () => {
    const t = buildGemOrderText([line("A", "B", "1", 2)], { dateLabel: "" });
    expect(t.split("\n")[0]).toBe("รายการสั่งซื้อพลอย");
    expect(t).not.toMatch(/ขอบคุณ|โทร|LINE|คุณ|ร้าน|ติดต่อ/i);
  });
  it("เคสไม่พัง: ชื่อยาวไม่เว้นวรรค · ตัวเลขหลักล้าน · ขึ้นบรรทัดใหม่ในชื่อถูกยุบ (ไม่ทำให้บรรทัดแตก)", () => {
    const long = "ก".repeat(120);
    const t = buildGemOrderText([line(long, "รูป\nทรง", "1", 1_234_567)], { dateLabel: "" });
    expect(t).toContain(long);
    expect(t).toContain("1,234,567 เม็ด");
    expect(t).toContain("- รูป ทรง 1 มม.");
  });
  it("ไม่มีคำ/สัญลักษณ์เรื่องเงิน · ไม่ใช้ 'ต้องสั่ง' · ไม่มีเลข JB · ไม่มีอิโมจิ", () => {
    const t = buildGemOrderText([line("โกเมน", "ไข่", "4×6", 70)], { dateLabel: "24 ต.ค. 69" });
    expect(t).not.toMatch(/บาท|฿|ราคา|ต้นทุน|ต้องสั่ง|JB-/);
    expect(/\p{Extended_Pictographic}/u.test(t)).toBe(false);
  });
});

describe("toGemOrderLines — 🔴 ประกอบทีละ field (ราคาที่ติดมากับ input ไม่หลุด)", () => {
  const poisoned = {
    key: "k", qty: 70, price: 987.65, cost: 4321.09, costRemainingThb: 55555.55, supplier: "ร้านลับ", jobNo: "JB-0099", dueDate: "2026-10-30",
    group: { typeName: "โกเมน", shapeName: "ไข่", sizeLabel: "4×6", label: "โกเมน · ไข่ · 4×6 มม.", price: 987.65, unitCost: 4321.09, hasPrice: true, costThb: 55555.55 },
  };
  it("ผลมีแค่ 5 field · ไม่มีเลขราคา/ต้นทุน/ผู้ขาย/เลข JB/กำหนดส่ง", () => {
    const lines = toGemOrderLines([poisoned]);
    expect(lines).toEqual([{ typeName: "โกเมน", shapeName: "ไข่", sizeLabel: "4×6", unitLabel: "เม็ด", qty: 70 }]);
    expect(Object.keys(lines[0]).sort()).toEqual(["qty", "shapeName", "sizeLabel", "typeName", "unitLabel"]);
    const json = JSON.stringify(lines);
    for (const bad of ["987.65", "4321.09", "55555.55", "ร้านลับ", "JB-0099", "2026-10-30"]) expect(json).not.toContain(bad);
  });
  it("ข้อความที่สร้างจาก input ที่ปนราคา ไม่มีตัวเลขราคา", () => {
    const text = buildGemOrderText(toGemOrderLines([poisoned]), { dateLabel: "24 ต.ค. 69" });
    for (const bad of ["987", "4321", "55555", "ร้านลับ", "JB-0099"]) expect(text).not.toContain(bad);
    expect(text).toContain("- ไข่ 4×6 มม. 70 เม็ด");
  });
  it("buildGemOrderText เองก็ไม่อ่าน field แปลกปลอม แม้ผู้เรียกยัดมาตรงๆ (runtime)", () => {
    const sneaky = { ...line("โกเมน", "ไข่", "4×6", 70), price: 987.65, cost: 4321.09 } as GemOrderLine;
    const text = buildGemOrderText([sneaky], { dateLabel: "" });
    expect(text).not.toContain("987");
    expect(text).not.toContain("4321");
  });
  it("ตามที่เลือก/ที่เห็น: ส่งเฉพาะแถวที่ให้ → ข้อความมีเฉพาะแถวนั้น", () => {
    const rows = [
      { qty: 5, group: { typeName: "A", shapeName: "ก", sizeLabel: "1" } },
      { qty: 6, group: { typeName: "B", shapeName: "ข", sizeLabel: "2" } },
      { qty: 7, group: { typeName: "C", shapeName: "ค", sizeLabel: "3" } },
    ];
    const text = buildGemOrderText(toGemOrderLines(rows.slice(1, 2)), { dateLabel: "" });
    expect(text).toContain("B");
    expect(text).not.toContain("A\n");
    expect(text).not.toContain("- ค");
    expect(text).toContain("รวม 1 รายการ");
  });
  it("จำนวน = ยอดที่ส่งเข้ามา (ยอด 'ยังไม่สั่ง' ของแถว) ไม่ใช่ยอดอื่น", () => {
    const text = buildGemOrderText(toGemOrderLines([{ qty: 30, group: { typeName: "โกเมน", shapeName: "ไข่", sizeLabel: "4×6" } }]), { dateLabel: "" });
    expect(text).toContain("30 เม็ด");
  });
});
