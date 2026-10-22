// lib/jobs/shop-gems.qa.test.ts — QA (R2-D2 · 22 ต.ค. 69) · parity ของ shop-gems.ts กับ DB จริง (migration 0190 · dry-run บน DB จริงแล้วถอยกลับ)
// ค่าคาดหวังด้านล่างคือ "ผลที่ DB ตอบจริง" ของ analytics.gem_name_similar / gem_name_norm (ไม่ใช่ค่าที่เดาจากโค้ด TS) — จับจาก scripts/verify/verify-0190-qa.sql ชุด parity 735 คู่ (0 ต่าง) แล้วคัดชุดที่ครอบ Unicode/ไทย/ขอบ threshold มาไว้ที่นี่
// รอบ 22 ต.ค. (review S1): เพิ่มการกวาดทุกจุดรหัสเทียบ DB จริง (ชุด DB_STRIPPED) · it.fails ที่เหลือ 0 ข้อ — ข้อต่างที่เคยเจอแก้ครบแล้ว (เลขล้วนต่างระบบเลข · สัญลักษณ์ ASCII)
import { describe, expect, it } from "vitest";
import { cleanGemName, gemNameSimilar, normalizeGemName } from "./shop-gems";

// [a, b, similar(a,b), norm(a), norm(b)] — ค่าจาก DB
const DB_ROWS: [string, string, boolean, string, string][] = [
  ["โกเมน", "โกเมนต์", true, "โกเมน", "โกเมนต์"],
  ["อเมทิสต์", "อเมทิส", true, "อเมทิสต์", "อเมทิส"],
  ["CZ", "cz", true, "cz", "cz"],
  ["CZ", "C Z", true, "cz", "cz"],
  ["ไพลิน", "ไพลิน ", true, "ไพลิน", "ไพลิน"],
  ["ＣＺ", "cz", true, "cz", "cz"],
  ["ทับทิม", "ไพลิน", false, "ทับทิม", "ไพลิน"],
  ["ซิทริน", "เพอริดอท", false, "ซิทริน", "เพอริดอท"],
  ["กลม", "หยดน้ำ", false, "กลม", "หยดน้ํา"],
  ["CZ", "AZ", false, "cz", "az"],
  ["หัวใจ", "ทรงหัวใจ", true, "หัวใจ", "ทรงหัวใจ"],
  ["Moonstone", "Sunstone", true, "moonstone", "sunstone"],
  ["6 เหลี่ยม", "8 เหลี่ยม", true, "6เหลี่ยม", "8เหลี่ยม"],
  ["น้ำ", "นํ้า", false, "น้ํา", "นํ้า"],
  ["แหวน", "เเหวน", false, "แหวน", "เเหวน"],
  ["ก้อน", "ก้อนๆ", true, "ก้อน", "ก้อนๆ"],
  ["Ａ１", "A1", true, "a1", "a1"],
  ["ﬁne", "fine", true, "fine", "fine"],
  ["İstanbul", "istanbul", true, "i̇stanbul", "istanbul"],
  ["ǅ", "dž", true, "dž", "dž"],
  ["ß", "ss", false, "ß", "ss"],
  ["Σ", "ς", false, "σ", "ς"],
  ["straße", "STRASSE", true, "straße", "strasse"],
  ["ก็", "กํ", false, "ก็", "กํ"],
  ["เพอริดอท", "เพริดอท", true, "เพอริดอท", "เพริดอท"],
  ["ทัวร์มาลีน", "ทัวร์มาลิน", true, "ทัวร์มาลีน", "ทัวร์มาลิน"],
  ["CZ·", "CZ", true, "cz", "cz"],
  ["C.Z.", "CZ", true, "cz", "cz"],
  ["C-Z", "C_Z", true, "cz", "cz"],
  ["ＡＢＣＤ", "abcd", true, "abcd", "abcd"],
  ["abcd", "abce", true, "abcd", "abce"],
  ["abcde", "abcdf", true, "abcde", "abcdf"],
  ["abcdef", "abcdgg", true, "abcdef", "abcdgg"],
  ["abcdefg", "abcdxxx", false, "abcdefg", "abcdxxx"],
  ["abcdefgh", "abcdxxxx", false, "abcdefgh", "abcdxxxx"],
];

describe("parity ของ shop-gems.ts กับ DB (ค่าจับจาก gem_name_similar/gem_name_norm จริง)", () => {
  it.each(DB_ROWS)("similar(%j, %j) = %s เหมือน DB", (a, b, sim) => {
    expect(gemNameSimilar(a, b)).toBe(sim);
    expect(gemNameSimilar(b, a)).toBe(sim); // สมมาตร
  });
  it.each(DB_ROWS)("normalize(%j) / normalize(%j) เหมือน DB", (a, b, _sim, na, nb) => {
    expect(normalizeGemName(a)).toBe(na);
    expect(normalizeGemName(b)).toBe(nb);
  });
  it("ชื่อพลอยจริงที่ตัวดักเตือนเกิน (false positive ที่ DB เป็นแบบเดียวกัน — ตัวดักไม่ใช่ตัวบล็อก ผู้ใช้กดเพิ่มใหม่ได้)", () => {
    // วัดจากชื่อพลอยจริง 64 ชื่อ (2,016 คู่): เตือนมั่ว 3 คู่ + ตัวเลขต่างหลักเดียว (6 เหลี่ยม/8 เหลี่ยม) — ทำเอกสารไว้ ไม่ใช่ข้อกำหนด
    expect(gemNameSimilar("Moonstone", "Sunstone")).toBe(true);
    expect(gemNameSimilar("โรโดไลต์", "ไอโอไลต์")).toBe(true);
    expect(gemNameSimilar("แทนซาไนต์", "โมซาไนต์")).toBe(true);
    expect(gemNameSimilar("6 เหลี่ยม", "8 เหลี่ยม")).toBe(true);
    expect(gemNameSimilar("6 เหลี่ยม", "สามเหลี่ยม")).toBe(true); // รูปทรง seed 2 ตัวเตือนกันเอง
  });
  it("ที่จับไม่ได้ (รู้และยอมรับ): พิมพ์ เ+เ แทน แ · ไทย↔อังกฤษ · ชื่อสั้น ≤ 3", () => {
    expect(gemNameSimilar("แหวน", "เเหวน")).toBe(false);
    expect(gemNameSimilar("ไข่", "ไข")).toBe(false);
    expect(gemNameSimilar("Blue Topaz", "บลูโทแพซ")).toBe(false);
  });
});

describe("ที่เคยต่างจาก DB (แก้แล้ว — ล็อกไว้กันถอยหลัง)", () => {
  it("สัญลักษณ์ ASCII ($ + < = > ^ ` | ~) DB เก็บไว้ใน norm — TS ต้องไม่ตัดทิ้ง (\\p{S} ไม่ถูกตัด) · วรรคตอน (- . · ( )) ถูกตัดเหมือน DB", () => {
    expect(normalizeGemName("CZ+")).toBe("cz+");
    expect(normalizeGemName("C$Z")).toBe("c$z");
    expect(normalizeGemName("C-Z")).toBe("cz");
    expect(normalizeGemName("(CZ)")).toBe("cz");
    expect(normalizeGemName("CZ\u00b7")).toBe("cz");
    expect(gemNameSimilar("CZ+", "CZ")).toBe(false); // DB: คนละชื่อ (norm "cz+" ≠ "cz" · สั้น ≤ 3 → เทียบเท่ากันอย่างเดียว)
  });
  it("ชื่อที่เป็นเลขล้วนต่างระบบเลข (เลขไทย ๑๒ · อารบิก-อินดิก ١٢ · เต็มความกว้าง １２ · ยกกำลัง ²³) ต้องถูกปฏิเสธเหมือน '12'", () => {
    for (const n of ["12", "๑๒", "١٢", "１２", "²³", "๑๒๓๔"]) expect(cleanGemName(n).ok, n).toBe(false);
  });
  it("ต้องมีตัวอักษรจริง ≥ 1 ตัว (DB: norm ~ [[:alpha:]]): '+1' · '$$' · '1.5' · สระ/วรรณยุกต์ลอยๆ ตก · พยัญชนะไทย/ละติน/จีน ผ่าน", () => {
    for (const n of ["+1", "$$", "1.5", "ิิ", "้้"]) expect(cleanGemName(n).ok, n).toBe(false);
    for (const n of ["ก็", "ะะ", "๑ก", "A๑", "6 เหลี่ยม", "日本", "CZ"]) expect(cleanGemName(n).ok, n).toBe(true);
  });
});

// กวาดทุกจุดรหัส U+0001-1FFFF + U+E0000-E00FF: "ตัดทิ้งหมดหรือไม่" (norm ว่าง) ของ TS เทียบกับ DB จริง
// DB_STRIPPED = ช่วงจุดรหัสที่ analytics.gem_name_norm(chr(cp)) ได้ผลว่างบน DB จริง (en_US.UTF-8 · PostgreSQL ของโปรเจกต์ · 22 ต.ค. 69) — จับด้วย do-block อ่านอย่างเดียว
const DB_STRIPPED = "9-13,28-35,37-42,44-47,58-59,63-64,91-93,95-95,123-123,125-125,133-133,160-161,167-167,171-171,173-173,182-183,187-187,191-191,847-847,894-894,903-903,1370-1375,1417-1418,1470-1470,1472-1472,1475-1475,1478-1478,1523-1524,1545-1546,1548-1549,1563-1567,1642-1645,1748-1748,1792-1805,2039-2041,2096-2110,2142-2142,2404-2405,2416-2416,2557-2557,2678-2678,2800-2800,3191-3191,3204-3204,3572-3572,3663-3663,3674-3675,3844-3858,3860-3860,3898-3901,3973-3973,4048-4052,4057-4058,4170-4175,4347-4347,4447-4448,4960-4968,5120-5120,5742-5742,5760-5760,5787-5788,5867-5869,5941-5942,6068-6069,6100-6102,6104-6106,6144-6159,6468-6469,6686-6687,6816-6822,6824-6829,7002-7008,7037-7038,7164-7167,7227-7231,7294-7295,7360-7367,7379-7379,8192-8214,8216-8253,8255-8259,8261-8273,8275-8303,8317-8318,8333-8334,8968-8971,9001-9002,10088-10101,10181-10182,10214-10223,10627-10648,10712-10715,10748-10749,11513-11516,11518-11519,11632-11632,11776-11822,11824-11855,11858-11869,12288-12291,12296-12305,12308-12319,12336-12336,12349-12349,12448-12448,12539-12539,12644-12644,42238-42239,42509-42511,42611-42611,42622-42622,42738-42743,43124-43127,43214-43215,43256-43258,43260-43260,43310-43311,43359-43359,43457-43469,43486-43487,43612-43615,43742-43743,43760-43761,44011-44011,64830-64831,65040-65049,65072-65096,65101-65106,65108-65121,65123-65123,65128-65128,65130-65131,65279-65279,65281-65283,65285-65290,65292-65295,65306-65307,65311-65312,65339-65341,65343-65343,65371-65371,65373-65373,65375-65381,65440-65440,65529-65531,65792-65794,66463-66463,66512-66512,66927-66927,67671-67671,67871-67871,67903-67903,68176-68184,68223-68223,68336-68342,68409-68415,68505-68508,69293-69293,69461-69465,69510-69513,69703-69709,69819-69820,69822-69825,69952-69955,70004-70005,70085-70088,70093-70093,70107-70107,70109-70111,70200-70205,70313-70313,70731-70735,70746-70747,70749-70749,70854-70854,71105-71127,71233-71235,71264-71276,71353-71353,71484-71486,71739-71739,72004-72006,72162-72162,72255-72262,72346-72348,72350-72354,72448-72457,72769-72773,72816-72817,73463-73464,73539-73551,73727-73727,74864-74868,77809-77810,92782-92783,92917-92917,92983-92987,92996-92996,93847-93850,94178-94178,113823-113827,119155-119162,121479-121483,125278-125279,917504-917631";
const dbStripped = new Set<number>();
for (const r of DB_STRIPPED.split(",")) {
  const [lo, hi] = r.split("-").map(Number);
  for (let c = lo; c <= hi; c++) dbStripped.add(c);
}

describe("parity ทั้งช่วงจุดรหัสของ normalizeGemName กับ DB (กวาด 131,000+ จุดรหัส)", () => {
  const cps: number[] = [];
  for (let c = 1; c <= 0x1ffff; c++) if (c < 0xd800 || c > 0xdfff) cps.push(c);
  for (let c = 0xe0000; c <= 0xe00ff; c++) cps.push(c);

  it("ที่ DB ตัดทิ้งหมด TS ต้องตัดทิ้งหมดด้วย (ไม่มีจุดรหัสไหนที่ DB ตัดแต่ TS เก็บ)", () => {
    const onlyDb = cps.filter((c) => dbStripped.has(c) && normalizeGemName(String.fromCodePoint(c)) !== "");
    expect(onlyDb.map((c) => "U+" + c.toString(16).toUpperCase())).toEqual([]);
  });
  it("ที่ TS ตัดแต่ DB เก็บ: ได้เฉพาะวรรคตอน (\\p{P}) ที่ Unicode ใหม่กว่า PostgreSQL ของโปรเจกต์ (เช่น Unicode 16 ~14 ตัว) — ห้ามเป็นตัวอักษร/เลข/สัญลักษณ์", () => {
    const onlyTs = cps.filter((c) => !dbStripped.has(c) && normalizeGemName(String.fromCodePoint(c)) === "");
    expect(onlyTs.filter((c) => !/\p{P}/u.test(String.fromCodePoint(c))).map((c) => "U+" + c.toString(16).toUpperCase())).toEqual([]);
    expect(onlyTs.length).toBeLessThanOrEqual(40);
  });
});

describe("ที่ต้องไม่พัง (ทดสอบฝั่งตรงข้าม)", () => {
  it("ชื่อไทยปกติที่มีวรรณยุกต์/สระ/ๆ ผ่านและไม่ถูกตัด", () => {
    for (const n of ["ไพลิน", "ก็", "น้ำเงิน", "เพอริดอท", "6 เหลี่ยม", "CZ", "Blue Topaz"]) {
      const r = cleanGemName(n);
      expect(r.ok, n).toBe(true);
      expect(Array.from(normalizeGemName(n)).length, n).toBeGreaterThanOrEqual(2);
    }
  });
});
