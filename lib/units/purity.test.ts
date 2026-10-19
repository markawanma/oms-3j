import { describe, expect, it } from "vitest";
import {
  formatPurityPct,
  purityFormIssue,
  purityFractionFromForm,
  purityFractionToPct,
  purityPctIssue,
  purityPctToFraction,
} from "./purity";

describe("purityPctToFraction — ต้องผ่าน", () => {
  it.each([
    ["92.5", 0.925],
    ["92.50", 0.925],
    ["  92.50  ", 0.925],
    ["99.99", 0.9999],
    ["100", 1],
    ["100.00", 1],
    ["96.5", 0.965],
    ["91.67", 0.9167],
    ["99.9", 0.999],
    ["37.5", 0.375], // เส้นแบ่งล่าง: ทอง 9K (มติเจ้าของ 18 ต.ค. 69)
    ["37.50", 0.375],
    ["37.51", 0.3751],
    ["75", 0.75],
    ["92.", 0.92],
  ])("%s → %s (ตรงเป๊ะ ไม่มี float เศษ)", (input, expected) => {
    expect(purityPctToFraction(input)).toBe(expected);
    expect(purityPctIssue(input)).toBeNull();
  });

  it("ค่าว่าง → null และไม่ใช่ error (ฟอร์มที่บังคับกรอกเช็คเอง)", () => {
    expect(purityPctToFraction("")).toBeNull();
    expect(purityPctToFraction("   ")).toBeNull();
    expect(purityPctIssue("")).toBeNull();
    expect(purityPctIssue("  ")).toBeNull();
  });

  it("ทุกค่า 37.50-100.00 ที่ละ 0.01 → ได้สัดส่วนตรงเป๊ะ (ไม่มี float เศษ) และ round-trip กลับเป็นสตริงเดิม", () => {
    for (let bp = 3750; bp <= 10_000; bp++) {
      const pct = (bp / 100).toFixed(2);
      const f = purityPctToFraction(pct);
      expect(f, pct).toBe(bp / 10_000);
      expect(purityFractionToPct(f), pct).toBe(pct);
    }
  });
});

describe("purityPctToFraction — รายการที่ห้ามผ่าน (ต้อง null + มี error ไม่ใช่ปัดเงียบ)", () => {
  it.each([
    ["92.505", "ทศนิยม 3 ตำแหน่ง", "ทศนิยมไม่เกิน 2 ตำแหน่ง"],
    ["99.999", "ทศนิยม 3 ตำแหน่ง", "ทศนิยมไม่เกิน 2 ตำแหน่ง"],
    ["0", "ศูนย์", "กรอกเป็น %"],
    ["0.00", "ศูนย์", "กรอกเป็น %"],
    ["-5", "ติดลบ", "กรอกเป็นตัวเลข %"],
    ["100.01", "เกิน 100", "ต้องไม่เกิน 100%"],
    ["101", "เกิน 100", "ต้องไม่เกิน 100%"],
    ["1000", "4 หลัก", "ต้องไม่เกิน 100%"],
    ["abc", "ไม่ใช่ตัวเลข", "กรอกเป็นตัวเลข %"],
    ["92.5%", "พิมพ์หน่วยติดมา", "กรอกเป็นตัวเลข %"],
    ["1e2", "เลขยกกำลัง (Number() อ่านได้ = 100)", "กรอกเป็นตัวเลข %"],
    ["+92", "เครื่องหมายบวก", "กรอกเป็นตัวเลข %"],
    ["9 2", "ช่องว่างกลางตัวเลข", "กรอกเป็นตัวเลข %"],
    ["92,50", "ลูกน้ำ", "กรอกเป็นตัวเลข %"],
    ["Infinity", "Infinity", "กรอกเป็นตัวเลข %"],
    ["NaN", "NaN", "กรอกเป็นตัวเลข %"],
    [".", "จุดเดี่ยว", "กรอกเป็นตัวเลข %"],
  ])("%s (%s) ถูกปฏิเสธ", (input, _why, msgPart) => {
    expect(purityPctToFraction(input)).toBeNull();
    const issue = purityPctIssue(input);
    expect(issue).not.toBeNull();
    expect(issue).toContain(msgPart);
  });

  it.each(["0.925", "0.5", "0.99", "0.9999", "0.01", ".925"])(
    "%s (พิมพ์เป็นสัดส่วนเดิม = เนื้อเงิน <1%%) ถูกบล็อกด้วยข้อความ 'กรอกเป็น % เช่น 92.50'",
    (input) => {
      expect(purityPctToFraction(input)).toBeNull();
      expect(purityPctIssue(input)).toContain("กรอกเป็น % เช่น 92.50");
    }
  );

  it.each(["1", "1.0", "1.00", " 1 "])("%s → 'ถ้าหมายถึงเนื้อเต็มให้กรอก 100' (ไม่ผ่านแล้ว — เดิมผ่านเป็น 1%%)", (input) => {
    expect(purityPctToFraction(input)).toBeNull();
    expect(purityPctIssue(input)).toBe("ถ้าหมายถึงเนื้อเต็มให้กรอก 100");
  });

  it.each(["1.01", "9.25", "10", "36.99", "37.49", "37.499", "20"])(
    "%s (1–37.49%%) → 'เนื้อโลหะต่ำกว่า 37.50% — ตรวจว่าพิมพ์ตกหลักไหม'",
    (input) => {
      expect(purityPctToFraction(input)).toBeNull();
      expect(purityPctIssue(input)).toBe("เนื้อโลหะต่ำกว่า 37.50% — ตรวจว่าพิมพ์ตกหลักไหม");
    }
  );

  it("เส้นแบ่งล่าง: 37.49 ถูกปฏิเสธ · 37.50 ผ่าน → 0.375 · 100 ผ่าน → 1", () => {
    expect(purityPctToFraction("37.49")).toBeNull();
    expect(purityPctToFraction("37.5")).toBe(0.375);
    expect(purityPctToFraction("37.50")).toBe(0.375);
    expect(purityPctToFraction("100")).toBe(1);
  });

  it("ค่า <1 (สไตล์สัดส่วนเดิม) ยังได้ข้อความเดิม 'กรอกเป็น % เช่น 92.50 (ไม่ใช่สัดส่วน 0.925)'", () => {
    for (const input of ["0.925", "0.99", "0.5", "0", ".5"]) {
      expect(purityPctIssue(input), input).toBe("กรอกเป็น % เช่น 92.50 (ไม่ใช่สัดส่วน 0.925)");
    }
  });
});

describe("purityFractionToPct", () => {
  it("แสดง 2 ตำแหน่งเสมอ", () => {
    expect(purityFractionToPct(0.925)).toBe("92.50");
    expect(purityFractionToPct(0.9999)).toBe("99.99");
    expect(purityFractionToPct(1)).toBe("100.00");
    expect(purityFractionToPct(0.999)).toBe("99.90");
    expect(purityFractionToPct(0.9167)).toBe("91.67");
  });

  it("null/undefined/NaN → สตริงว่าง", () => {
    expect(purityFractionToPct(null)).toBe("");
    expect(purityFractionToPct(undefined)).toBe("");
    expect(purityFractionToPct(Number.NaN)).toBe("");
  });

  it("ค่าที่ละเอียดเกิน 4 ตำแหน่ง ปัดเพื่อแสดงเท่านั้น (92.575 → 92.58)", () => {
    expect(purityFractionToPct(0.92575)).toBe("92.58");
  });

  it("formatPurityPct: มี % · ไม่มีค่า = —", () => {
    expect(formatPurityPct(0.925)).toBe("92.50%");
    expect(formatPurityPct(null)).toBe("—");
  });
});

describe("purityFractionFromForm — เคสต้องไม่พัง (เปิดของเดิมแล้วบันทึกโดยไม่แก้)", () => {
  it("0.925 → ช่องแสดง 92.50 → ไม่แตะ → ส่ง 0.925 เป๊ะ (ไม่ใช่ 92.5 ไม่ใช่ 0.00925)", () => {
    const shown = purityFractionToPct(0.925);
    expect(shown).toBe("92.50");
    expect(purityFractionFromForm(shown, 0.925)).toBe(0.925);
    expect(purityFormIssue(shown, 0.925)).toBeNull();
  });

  it("ค่าเดิมละเอียดเกิน 4 ตำแหน่ง (0.92575) ไม่แตะ → ส่งค่าเดิม ไม่ถูกปัดทับเป็น 0.9258", () => {
    const shown = purityFractionToPct(0.92575);
    expect(purityFractionFromForm(shown, 0.92575)).toBe(0.92575);
  });

  it("แก้แล้ว → ใช้ค่าที่แก้ (ไม่ย้อนกลับไปค่าเดิม)", () => {
    expect(purityFractionFromForm("96.50", 0.925)).toBe(0.965);
    expect(purityFractionFromForm("92.51", 0.925)).toBe(0.9251);
  });

  it("เคลียร์ช่อง → null เหมือนเดิม", () => {
    expect(purityFractionFromForm("", 0.925)).toBeNull();
    expect(purityFractionFromForm("", null)).toBeNull();
  });

  it("ไม่มีค่าเดิม + กรอกใหม่ → แปลงปกติ · กรอกผิด → null + error", () => {
    expect(purityFractionFromForm("92.50", null)).toBe(0.925);
    expect(purityFractionFromForm("0.925", null)).toBeNull();
    expect(purityFormIssue("0.925", null)).toContain("กรอกเป็น % เช่น 92.50");
  });

  it("แก้เป็นค่าผิดทั้งที่เดิมมีค่า → ยังถูกปฏิเสธ (ไม่ fallback ไปค่าเดิมเงียบๆ)", () => {
    expect(purityFractionFromForm("92.505", 0.925)).toBeNull();
    expect(purityFormIssue("92.505", 0.925)).not.toBeNull();
  });
});
