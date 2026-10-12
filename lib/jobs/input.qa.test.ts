// QA (R2-D2) — J1 ระบบใบงาน: ขอบเขตของ parseWeight / parseWeightOrZero / parseCount
// 🐞 BUG-J1-01: คอมมา "95,5" ถูกตัดทิ้งเป็น 955 (ตัวคั่นหลักพัน) → น้ำหนัก 10 เท่าโดยไม่มีเตือน
//    reproduce จริงบน /w/<token>: ช่างทองพิมพ์ "95,5" ในช่องน้ำหนักเข้า → job_stage.weight_in_g = 955.000
//    it.fails ด้านล่างจะ "ผ่าน" ตราบที่บั๊กยังอยู่ — เมื่อแก้แล้ว it.fails จะแดง ให้ลบ .fails ออก
import { describe, expect, it } from "vitest";
import { parseCount, parseWeight, parseWeightOrZero } from "@/lib/jobs/input";

describe("parseWeight — ค่าที่ต้องถูกปฏิเสธ", () => {
  const bad: Array<[string, unknown]> = [
    ["ศูนย์", "0"],
    ["ศูนย์ทศนิยม", "0.000"],
    ["ติดลบ", "-5"],
    ["ทศนิยม 4 ตำแหน่ง", "1.2345"],
    ["เลขยกกำลัง", "1e3"],
    ["Infinity", "Infinity"],
    ["NaN", "NaN"],
    ["ตัวหนังสือ", "abc"],
    ["เลขไทย", "๑๒"],
    ["เลขเต็มความกว้าง", "１２"],
    ["ช่องว่างกลางเลข", "1 000"],
    ["จุดซ้อน", "1.2.3"],
    ["จุดนำหน้าอย่างเดียว", ".5"],
    ["จุดท้าย", "5."],
    ["เกินเพดาน 100000", "100000.001"],
    ["ใหญ่ผิดปกติ", "99999999999"],
    ["emoji", "5🙂"],
    ["SQL", "1; drop table x"],
    ["object", { a: 1 }],
    ["array", [1]],
    ["boolean", true],
  ];
  it.each(bad)("ปฏิเสธ %s", (_n, v) => {
    expect(parseWeight(v).ok).toBe(false);
  });

  it("ว่าง/null/undefined = ok(null) (ไม่ใส่น้ำหนัก — ให้ด่าน weigh_required ตัดสิน)", () => {
    for (const v of ["", "   ", null, undefined]) {
      const r = parseWeight(v);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value).toBeNull();
    }
  });

  it("ขอบ: 0.001 และ 100000 ผ่าน · ช่องว่างหัวท้ายตัดให้", () => {
    const a = parseWeight("0.001");
    const b = parseWeight("100000");
    const c = parseWeight("  12.5  ");
    expect(a.ok && a.value).toBe(0.001);
    expect(b.ok && b.value).toBe(100000);
    expect(c.ok && c.value).toBe(12.5);
  });
});

describe("parseWeight — คอมมา", () => {
  it("BUG-J1-01 (แก้แล้ว 12 ต.ค.): '95,5' = 95.5 ไม่ใช่ 955", () => {
    const r = parseWeight("95,5");
    expect(r.ok && r.value).toBe(95.5);
  });
  it("มติ coordinator 12 ต.ค.: จุลภาคกำกวม ('1,234.5' / '1,234,5' / '12,5,') = ปฏิเสธพร้อมข้อความ ไม่เดา", () => {
    for (const v of ["1,234.5", "1,234,5", "12,5,", "1.234,5", ",,"]) {
      const r = parseWeight(v);
      expect(r.ok, v).toBe(false);
      if (!r.ok) expect(r.error).toContain("กำกวม");
    }
  });
  it("จุลภาคโดดๆ ที่ปลาย/หัว = ปฏิเสธ (รูปแบบเลขผิด)", () => {
    for (const v of [",5", "5,", ","]) expect(parseWeight(v).ok, v).toBe(false);
  });
  it("parseWeightOrZero ใช้กฎเดียวกัน", () => {
    expect(parseWeightOrZero("0,5", "เติมโลหะ")).toMatchObject({ ok: true, value: 0.5 });
    expect(parseWeightOrZero("1,234.5", "เติมโลหะ").ok).toBe(false);
  });
});

describe("parseWeightOrZero (เติมโลหะ)", () => {
  it("ว่าง/ไม่ส่ง = 0", () => {
    for (const v of ["", "  ", null, undefined]) {
      const r = parseWeightOrZero(v, "เติมโลหะ");
      expect(r.ok && r.value).toBe(0);
    }
  });
  it("0 / 0.0 / 0.000 = 0 · ติดลบ/ตัวหนังสือ/เกินเพดาน ปฏิเสธ", () => {
    for (const v of ["0", "0.0", "0.000"]) expect(parseWeightOrZero(v, "เติมโลหะ")).toMatchObject({ ok: true, value: 0 });
    for (const v of ["-1", "abc", "5000000", "0.0001"]) expect(parseWeightOrZero(v, "เติมโลหะ").ok).toBe(false);
  });
});

describe("parseCount (ของเสีย/จำนวน)", () => {
  it("ปฏิเสธ ทศนิยม · ติดลบ · เกิน max · ตัวหนังสือ · NaN · boolean", () => {
    for (const v of ["1.5", "-1", "abc", "", NaN, true, null, 1.5, -1]) expect(parseCount(v as never, "ของเสีย", 1000).ok).toBe(false);
    expect(parseCount("1001", "ของเสีย", 1000).ok).toBe(false);
  });
  it("ขอบ 0 และ max ผ่าน", () => {
    expect(parseCount("0", "ของเสีย", 1000)).toMatchObject({ ok: true, value: 0 });
    expect(parseCount(1000, "ของเสีย", 1000)).toMatchObject({ ok: true, value: 1000 });
  });
});
