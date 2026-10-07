// lib/oem/quoteForm.test.ts — 0163 ราคาพิเศษเงินแท่ง: ด่านฝั่งฟอร์ม (รูปร่างของข้อมูลที่จะส่งไป calc) + วันยืนราคา
// ไม่มีการคิดเงินในไฟล์นี้ — ฟอร์มแค่ validate รูปร่าง "ต่ำกว่าทุนไหม" ตัดสินที่ DB (verify-0163.sql)
import { describe, expect, it } from "vitest";
import {
  OEM_BAR_OVERRIDE_MAX_DAYS,
  addDaysIso,
  bangkokToday,
  barOverrideIssue,
  barValidUntilIssue,
  buildJobInput,
  createJobForm,
  jobHasBarOverride,
} from "./quoteForm";
import type { JobForm } from "./quoteForm";

function barJob(over: Partial<JobForm> = {}): JobForm {
  return { ...createJobForm(30), metal: "silver999", barSize: "1_baht", qty: "2", ...over };
}

describe("buildJobInput — เงินแท่ง ไม่มีราคาพิเศษ (พฤติกรรมเดิม)", () => {
  it("override เป็น null ทั้งคู่เมื่อช่องว่าง", () => {
    const input = buildJobInput(barJob());
    expect(input).toEqual({
      metal: "silver999",
      barSize: "1_baht",
      qty: 2,
      engraveImageThb: null,
      engraveTextThb: null,
      barPriceOverrideThb: null,
      barPriceOverrideReason: null,
    });
  });

  it("เหตุผลลอย (ราคายังว่าง) ไม่ถูกส่งต่อ — reason ไม่ไป calc ถ้าราคายังว่าง", () => {
    const input = buildJobInput(barJob({ barPriceOverrideReason: "พิมพ์เหตุผลก่อนราคา" }));
    expect(input).not.toBeNull();
    expect(input?.barPriceOverrideThb).toBeNull();
    expect(input?.barPriceOverrideReason).toBeNull();
  });

  it("ราคาเป็นเว้นวรรคล้วน = ไม่มี override", () => {
    const input = buildJobInput(barJob({ barPriceOverrideThb: "   ", barPriceOverrideReason: "x" }));
    expect(input?.barPriceOverrideThb).toBeNull();
    expect(jobHasBarOverride(barJob({ barPriceOverrideThb: "   " }))).toBe(false);
  });
});

describe("buildJobInput — เงินแท่ง มีราคาพิเศษ", () => {
  it("ราคา + เหตุผลครบ → ส่งตัวเลขจริง (ไม่ปัด) + เหตุผลที่ trim แล้ว", () => {
    const input = buildJobInput(barJob({ barPriceOverrideThb: "1100", barPriceOverrideReason: "  bid งาน A  " }));
    expect(input?.barPriceOverrideThb).toBe(1100);
    expect(input?.barPriceOverrideReason).toBe("bid งาน A");
    expect(buildJobInput(barJob({ barPriceOverrideThb: "1234.56", barPriceOverrideReason: "x" }))?.barPriceOverrideThb).toBe(1234.56);
  });

  it("มีราคาแต่ไม่มีเหตุผล / เหตุผลเว้นวรรค → null (ไม่ยิง calc ระหว่างพิมพ์)", () => {
    expect(buildJobInput(barJob({ barPriceOverrideThb: "1100" }))).toBeNull();
    expect(buildJobInput(barJob({ barPriceOverrideThb: "1100", barPriceOverrideReason: "   " }))).toBeNull();
  });

  it.each(["0", "-5", "abc", "1e7", "1000001", "1234.567", "Infinity", "NaN"])("ราคา %s → null", (price) => {
    expect(buildJobInput(barJob({ barPriceOverrideThb: price, barPriceOverrideReason: "x" }))).toBeNull();
  });

  it("ขอบ: 0.01 และ 1,000,000 ผ่านรูปร่าง (DB เป็นคนตัดสินเรื่องทุน/เพดาน 2 เท่า)", () => {
    expect(buildJobInput(barJob({ barPriceOverrideThb: "0.01", barPriceOverrideReason: "x" }))?.barPriceOverrideThb).toBe(0.01);
    expect(buildJobInput(barJob({ barPriceOverrideThb: "1000000", barPriceOverrideReason: "x" }))?.barPriceOverrideThb).toBe(1000000);
  });

  it("ค่ายิงเลเซอร์ยังทำงานคู่กับราคาพิเศษ", () => {
    const input = buildJobInput(barJob({ barPriceOverrideThb: "1100", barPriceOverrideReason: "x", engraveImageThb: "150" }));
    expect(input?.engraveImageThb).toBe(150);
    expect(input?.barPriceOverrideThb).toBe(1100);
  });
});

describe("งานผลิต — ช่อง override ที่หลงมาต้องไม่รั่วเข้า input", () => {
  it("metal=silver ที่มีค่าค้างในช่องราคาพิเศษ → ไม่มี key override ใน input และ jobHasBarOverride=false", () => {
    const job: JobForm = {
      ...createJobForm(30),
      metal: "silver",
      itemKind: "แหวน",
      polishTier: "เรียบ",
      qty: "10",
      weightG: "5",
      barPriceOverrideThb: "1100",
      barPriceOverrideReason: "ค้างจากตอนเป็นเงินแท่ง",
    };
    const input = buildJobInput(job);
    expect(input).not.toBeNull();
    expect(input).not.toHaveProperty("barPriceOverrideThb");
    expect(input).not.toHaveProperty("barPriceOverrideReason");
    expect(jobHasBarOverride(job)).toBe(false);
    expect(barOverrideIssue(job)).toBeNull();
  });
});

describe("barOverrideIssue", () => {
  it("ไม่มีราคาพิเศษ → null", () => {
    expect(barOverrideIssue(barJob())).toBeNull();
  });
  it("ราคาผิดรูปร่าง / ทศนิยมเกิน 2 / ไม่มีเหตุผล → ข้อความ (ไม่ใช่ null)", () => {
    expect(barOverrideIssue(barJob({ barPriceOverrideThb: "-1", barPriceOverrideReason: "x" }))).toMatch(/มากกว่า 0/);
    expect(barOverrideIssue(barJob({ barPriceOverrideThb: "10.123", barPriceOverrideReason: "x" }))).toMatch(/2 ตำแหน่ง/);
    expect(barOverrideIssue(barJob({ barPriceOverrideThb: "1100" }))).toMatch(/เหตุผล/);
  });
  it("ครบ → null", () => {
    expect(barOverrideIssue(barJob({ barPriceOverrideThb: "1100", barPriceOverrideReason: "x" }))).toBeNull();
  });
});

describe("วันยืนราคา (เวลาไทย)", () => {
  it("bangkokToday: ช่วง 00:00-07:00 ไทยต้องเป็นวันใหม่ ไม่ใช่เมื่อวานแบบ UTC", () => {
    expect(bangkokToday(new Date("2026-10-06T18:30:00Z"))).toBe("2026-10-07"); // 01:30 ไทย
    expect(bangkokToday(new Date("2026-10-07T16:59:59Z"))).toBe("2026-10-07"); // 23:59:59 ไทย
    expect(bangkokToday(new Date("2026-10-07T17:00:00Z"))).toBe("2026-10-08"); // 00:00 ไทยวันถัดไป
  });

  it("addDaysIso: ข้ามเดือน/ข้ามปี/ปีอธิกสุรทิน", () => {
    expect(addDaysIso("2026-10-07", 30)).toBe("2026-11-06");
    expect(addDaysIso("2026-12-15", 30)).toBe("2027-01-14");
    expect(addDaysIso("2028-02-15", 30)).toBe("2028-03-16");
    expect(addDaysIso("2026-10-07", 0)).toBe("2026-10-07");
  });

  const now = new Date("2026-10-06T18:30:00Z"); // วันนี้ (ไทย) = 2026-10-07
  it("วันนี้ และ วันนี้+30 ผ่าน (ต้องไม่พัง)", () => {
    expect(barValidUntilIssue("2026-10-07", now)).toBeNull();
    expect(barValidUntilIssue(addDaysIso("2026-10-07", OEM_BAR_OVERRIDE_MAX_DAYS), now)).toBeNull();
  });
  it("เมื่อวาน (ไทย) / +31 / ว่าง / รูปแบบผิด → ข้อความ", () => {
    expect(barValidUntilIssue("2026-10-06", now)).toMatch(/ย้อนหลัง/);
    expect(barValidUntilIssue(addDaysIso("2026-10-07", 31), now)).toMatch(/ไม่เกิน 30 วัน/);
    expect(barValidUntilIssue("", now)).toMatch(/เลือกวัน/);
    expect(barValidUntilIssue("07/10/2026", now)).toMatch(/เลือกวัน/);
  });
});
