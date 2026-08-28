// lib/labels/match.test.ts — coverage for the "เคสห้ามผ่าน" list in
// docs/3j-jewelry/analytics/design-label-upload.md (province-matching part —
// case 7, idempotent apply, is SQL-level and tested via do-block by the
// owner at apply time, per the migration's header comment).
import { describe, expect, it } from "vitest";
import { matchProvince } from "./match";

describe("matchProvince", () => {
  // เคสห้ามผ่าน #1: ลาดกระบัง ต้องไม่ match เป็น กระบี่
  it("does not mistake ลาดกระบัง (Bangkok district) for กระบี่ (Krabi province)", () => {
    const text = "แขวงคลองสองต้นนุ่น เขตลาดกระบัง จังหวัดกรุงเทพมหานคร 10520";
    const result = matchProvince(text);
    expect(result.status).toBe("matched");
    expect(result.provinceCode).toBe("TH-10");
    expect(result.candidates.map((c) => c.code)).not.toContain("TH-81"); // กระบี่
  });

  it("still resolves ลาดกระบัง correctly with a tone-mark-bearing variant nearby", () => {
    // Same district name, but the text also carries a tone mark elsewhere
    // (Mai Ek on "ต้น") to prove folding doesn't break the surrounding match.
    const text = "แขวงคลองสองต้นนุ่น , เขตลาดกระบัง , จังหวัดกรุงเทพมหานคร 10520";
    const result = matchProvince(text);
    expect(result.status).toBe("matched");
    expect(result.provinceCode).toBe("TH-10");
  });

  // เคสห้ามผ่าน #2: ที่อยู่ผู้ส่ง (กทม.+10150) ต้องถูกตัด — ต่างจังหวัดไม่กลายเป็น
  // TH-10 แต่ลูกค้ากรุงเทพจริง (zipcode อื่น) ต้องยังได้ TH-10
  it("strips the sender's own Bangkok address, so an upcountry customer is not misread as Bangkok", () => {
    const text = [
      "จาก: 3J Jewelry บางขุนเทียน จอมทอง กรุงเทพมหานคร 10150",
      "ถึง: ลูกค้า อำเภอเมือง จังหวัดขอนแก่น 40000",
    ].join("\n");
    const result = matchProvince(text);
    expect(result.status).toBe("matched");
    expect(result.provinceCode).toBe("TH-40"); // ขอนแก่น
  });

  it("still resolves a real Bangkok customer (different zipcode from the sender) to TH-10", () => {
    const text = [
      "จาก: 3J Jewelry บางขุนเทียน จอมทอง กรุงเทพมหานคร 10150",
      "ถึง: ลูกค้า เขตบางนา จังหวัดกรุงเทพมหานคร 10260",
    ].join("\n");
    const result = matchProvince(text);
    expect(result.status).toBe("matched");
    expect(result.provinceCode).toBe("TH-10");
  });

  // เคสห้ามผ่าน #3 (ฝั่ง "ต้องไม่พัง"): ใบสระหาย (PUA) ต้อง match ได้
  it("matches a PUA-font label missing สระอุ (กรงเทพมหานคร instead of กรุงเทพมหานคร)", () => {
    const text = "เขตบางแค , กรงเทพมหานคร 10160";
    const result = matchProvince(text);
    expect(result.status).toBe("matched");
    expect(result.provinceCode).toBe("TH-10");
  });

  // เคสห้ามผ่าน #6: zipcode เดี่ยวห้ามชี้จังหวัด
  it("does not resolve a province from a lone zipcode with no province name nearby", () => {
    const text = "ที่อยู่ไม่ระบุจังหวัด รหัสไปรษณีย์ 40000";
    const result = matchProvince(text);
    expect(result.status).toBe("needs_review");
    expect(result.provinceCode).toBeNull();
    expect(result.candidates).toHaveLength(0);
  });

  // เคสห้ามผ่าน #5: สองจังหวัด candidate → needs_review พร้อม candidates ทั้งคู่
  it("returns needs_review with both candidates when two provinces are co-located with zipcodes", () => {
    const text = "สาขา 1 จังหวัดเชียงใหม่ 50000 และสาขา 2 จังหวัดเชียงราย 57000";
    const result = matchProvince(text);
    expect(result.status).toBe("needs_review");
    expect(result.provinceCode).toBeNull();
    const codes = result.candidates.map((c) => c.code).sort();
    expect(codes).toEqual(["TH-50", "TH-57"]);
  });

  // เคสห้ามผ่าน: จังหวัดสะกดอังกฤษ (alias) ต้อง match ได้
  it("matches an English alias spelling co-located with a zipcode", () => {
    const text = "Customer address, Chiang Mai 50200, Thailand";
    const result = matchProvince(text);
    expect(result.status).toBe("matched");
    expect(result.provinceCode).toBe("TH-50");
  });

  it("does not resolve any province from empty/whitespace text", () => {
    const result = matchProvince("   \n  ");
    expect(result.status).toBe("needs_review");
    expect(result.candidates).toHaveLength(0);
  });

  it("does not co-locate a province with a zipcode that is far away in the text (> 80 chars)", () => {
    const filler = "x".repeat(120);
    const text = `จังหวัดเชียงใหม่ ${filler} 50000`;
    const result = matchProvince(text);
    expect(result.status).toBe("needs_review");
    expect(result.candidates).toHaveLength(0);
  });
});

// regression 28 ส.ค. 69: เลข 5 หลักกลางเลขพัสดุ/Order ID ห้ามถูกนับเป็น zipcode
// (ใบจริงหน้า 8 ของ ใบออเดอร์18.pdf — zip จริงคือ 24190 ฉะเชิงเทรา)
it("does not treat digit runs inside tracking numbers as zipcodes", () => {
  const page =
    // ระยะห่างระหว่างที่อยู่ผู้ส่ง (กทม.) กับ zip ผู้รับ ต้องสมจริง (>80 ตัวอักษร
    // เหมือนใบจริงที่มีบรรทัดเวียดนาม+เลขพัสดุซ้ำคั่นกลาง) ไม่งั้นเทสต์นี้วัดผิดเรื่อง
    "อบต.หนองไม้แก่น 49 ม.3 JTTH203641111214 จาก 3J 112 ถ.เอกชัย แขวงบางขุนเทียน เขตจอมทอง, กรุงเทพมหานคร " +
    "Order ID: 585606536284767936 21-08-2026 Estimated Date: nguoi mua khong can phai tra chuyen phat nhanh COD DROP-OFF " +
    "JTTH203641111214 JTTH203641111214 JTTH203641111214 JTTH203641111214 " +
    "24190 สุนันทา NDD 19-08-2026 Shipping Date: 015A แปลงยาว , ฉะเชิงเทรา 727";
  const r = matchProvince(page);
  expect(r.status).toBe("matched");
  expect(r.provinceCode).toBe("TH-24");
  expect(r.zipcode).toBe("24190");
});

// UAT 28 ส.ค. 69: extract แทรกช่องว่างกลางคำ + ใบไม่มี zipcode ผู้ส่ง
it("matches when the province name has extraction-inserted spaces (สราษฎร ธาน)", () => {
  const text =
    "52/35 หมู่ 1 ตำบลขุนทะเล อำเภอเมือง เมองสราษฎรธานี , สราษฎร ธานี 84000 " +
    "จาก 3J jewelry 112/203 ถนนเอกชัย เขตจอมทอง แขวงบางขุนเทียน , เขตจอมทอง , กรงเทพมหานค ร";
  const r = matchProvince(text);
  expect(r.status).toBe("matched");
  expect(r.provinceCode).toBe("TH-84");
  expect(r.zipcode).toBe("84000");
});

it("excludes sender Bangkok via address markers when the label has no sender zipcode", () => {
  const text =
    "จาก 3J jewelry 112 ถ.เอกชัย แขวงบางขุนเทียน เขตจอมทอง , เขตจอมทอง , กรงเทพมหานค ร " +
    "ถึง ลูกค้า Order ID: 585607399613499101 JTTH203142711914 JTTH203142711914 JTTH203142711914 " +
    "JTTH203142711914 JTTH203142711914 nguoi mua khong can phai tra chuyen phat nhanh DROP-OFF " +
    "24190 สุนันทา แปลงยาว , ฉะเชิงเทรา";
  const r = matchProvince(text);
  expect(r.status).toBe("matched");
  expect(r.provinceCode).toBe("TH-24");
});

// UAT 29 ส.ค. 69 (real page: Aug12_2026.pdf, tracking JTTH202760754976,
// ขอนแก่น) — 126/954 real pages fell into needs_review with candidates=[]
// despite the province name being spelled correctly. Root cause: this font
// substitutes U+F70A-U+F70E (Private Use Area) for the tone mark instead of
// dropping it or using the real Unicode codepoint, so the folded haystack had
// ONE EXTRA character the folded reference name didn't. Codepoint built via
// String.fromCodePoint (not pasted directly) — per this file's own lesson,
// copying this exact character through a terminal silently drops it, which
// is exactly how the bug hid from a first manual repro attempt.
it("folds a PUA glyph (U+F70A) some label fonts substitute for a tone mark, so ขอนแก่น still matches", () => {
  const puaTonemark = String.fromCodePoint(0xf70a);
  // Mirrors the real page's shape: a district-prefixed mention that must NOT
  // match (no boundary before it — "เมือง" + name, like the ลาดกระบัง case)
  // followed by the real standalone occurrence next to the zipcode.
  const text = "เมือง" + "ขอนแก" + puaTonemark + "น , " + "ขอนแก" + puaTonemark + "น 40000";
  const r = matchProvince(text);
  expect(r.status).toBe("matched");
  expect(r.provinceCode).toBe("TH-40");
  expect(r.zipcode).toBe("40000");
});

// UAT 29 ส.ค. 69 (real pages: Aug12_2026.pdf p22/p23, กำแพงเพชร/ลำปาง — 18 of
// the 20 needs_review pages remaining after the PUA fix above). Root cause:
// this font emits the LEGACY decomposed encoding of สระอำ — NIKHAHIT (U+0E4D)
// followed by SARA AA (U+0E32) — instead of the precomposed U+0E33 the
// reference province names use (thai-provinces.json confirmed to use U+0E33
// throughout). Un-normalized, folding stripped the NIKHAHIT (it's a
// tone-mark-range codepoint) and left a bare SARA AA, one character short of
// the reference's folded form. Codepoints built via String.fromCharCode, not
// pasted, same reason as the test above.
it("normalizes the legacy decomposed สระอำ (NIKHAHIT+SARA AA) so กำแพงเพชร still matches", () => {
  const decomposedSaraAm = String.fromCharCode(0x0e4d) + String.fromCharCode(0x0e32);
  const text = "62150 " + "ก" + decomposedSaraAm + "แพงเพชร";
  const r = matchProvince(text);
  expect(r.status).toBe("matched");
  expect(r.provinceCode).toBe("TH-62");
  expect(r.zipcode).toBe("62150");
});
