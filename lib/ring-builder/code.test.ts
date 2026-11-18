import { describe, expect, it } from "vitest";
import {
  ALPHABET, bitsToChars, checkChar, checkCharValid, decodeCode, decodeFromText, encodeCode, extractCodes, formatCode, packPayload, payloadBitLength, pricedAtToSec, secToIso, TAG_BITS, type CodeFields,
} from "./code";

const TAG = "101100111000111100001010110100110011101010111100001100110101".slice(0, TAG_BITS).padEnd(TAG_BITS, "1");
const base: CodeFields = { designNo: 7, size: 54, positions: [3, 0, 0, 5, 0, 0, 3], totalThb: 720, pricedAtSec: 24_000_000 };

function encodeFields(f: CodeFields, tag = TAG): string {
  const p = packPayload(f);
  if (!p.ok) throw new Error(p.reason);
  return encodeCode(p.bits, tag);
}
const chars = (code: string) => code.replace(/-/g, "").slice(3);

describe("round-trip", () => {
  it.each([3, 4, 5, 6, 7])("n=%d: pack → encode → decode ได้ค่าเดิม · canonical ตรง", (n) => {
    const f: CodeFields = { designNo: 1234, size: 45, positions: Array.from({ length: n }, (_, i) => (i * 97) % 1024), totalThb: 262143, pricedAtSec: 2 ** 31 - 1 };
    const code = encodeFields(f);
    const d = decodeCode(code);
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.fields).toEqual(f);
    expect(d.tagBits).toBe(TAG);
    expect(d.canonical).toBe(code);
    expect(d.payloadBits.length).toBe(payloadBitLength(n));
  });

  it("size null (ให้แอดมินเช็ก = idx 31) วนครบรอบ · size 68 = idx 23", () => {
    const d = decodeCode(encodeFields({ ...base, size: null }));
    expect(d.ok && d.fields.size).toBe(null);
    const e = decodeCode(encodeFields({ ...base, size: 68 }));
    expect(e.ok && e.fields.size).toBe(68);
  });

  it("ความยาวตรงตาม design: 5 เม็ด = 38 ตัว (37+check) · 7 เม็ด = 42 ตัว · prefix 3JR- · ขีดทุก 5", () => {
    const five = encodeFields({ ...base, positions: [0, 0, 0, 0, 0] });
    const seven = encodeFields(base);
    expect(chars(five)).toHaveLength(38);
    expect(chars(seven)).toHaveLength(42);
    expect(five.startsWith("3JR-")).toBe(true);
    expect(five.slice(4).split("-").every((g, i, a) => (i < a.length - 1 ? g.length === 5 : g.length >= 1 && g.length <= 5))).toBe(true);
  });

  it("decoder ยอมตัวพิมพ์เล็ก/ช่องว่าง/ไม่มีขีด/I L→1 O→0 และได้ canonical เดิม", () => {
    const code = encodeFields(base);
    const messy = ` ${code.toLowerCase().replace(/-/g, " ")} `;
    const d = decodeCode(messy);
    expect(d.ok && d.canonical).toBe(code);
    // แทน 1→l / 0→o ทุกตัวในส่วนตัวอักษร (ไม่แตะ prefix)
    const sub = "3JR-" + chars(code).replace(/1/g, "l").replace(/0/g, "o");
    const d2 = decodeCode(sub);
    expect(d2.ok && d2.canonical).toBe(code);
  });
});

describe("encoder ปฏิเสธค่านอกช่วง", () => {
  it.each([
    [{ designNo: 0 }, "design_no"], [{ designNo: 4096 }, "design_no"], [{ designNo: 1.5 }, "design_no"],
    [{ size: 44 }, "size"], [{ size: 69 }, "size"], [{ size: 45.5 }, "size"], [{ size: NaN }, "size"],
    [{ positions: [0, 0] }, "count"], [{ positions: [0, 0, 0, 0, 0, 0, 0, 0] }, "count"],
    [{ positions: [0, 0, 1024] }, "stone_no"], [{ positions: [0, -1, 0] }, "stone_no"], [{ positions: [0, 1.5, 0] }, "stone_no"],
    [{ totalThb: 262144 }, "total"], [{ totalThb: -1 }, "total"], [{ totalThb: NaN }, "total"],
    [{ pricedAtSec: -1 }, "priced_at"], [{ pricedAtSec: 2 ** 31 }, "priced_at"],
  ] as [Partial<CodeFields>, string][])("%j → %s", (patch, reason) => {
    expect(packPayload({ ...base, ...patch })).toEqual({ ok: false, reason });
  });
});

describe("decoder ปฏิเสธรูปแบบผิด", () => {
  const good = encodeFields(base);
  it("ว่าง/ไม่มี prefix/ตัวอักษรนอกชุด (รวม U)/สั้นไป", () => {
    expect(decodeCode("")).toEqual({ ok: false, reason: "empty" });
    expect(decodeCode("   ")).toEqual({ ok: false, reason: "empty" });
    expect(decodeCode("3J-ABCDE")).toEqual({ ok: false, reason: "prefix" });
    expect(decodeCode("XYZ-" + chars(good))).toEqual({ ok: false, reason: "prefix" });
    expect(decodeCode("3JR-AB")).toEqual({ ok: false, reason: "too_short" });
    expect(decodeCode("3JR-" + chars(good).slice(0, 10) + "U" + chars(good).slice(11))).toEqual({ ok: false, reason: "alphabet" });
    expect(decodeCode("3JR-" + chars(good).slice(0, 10) + "*" + chars(good).slice(11))).toEqual({ ok: false, reason: "alphabet" });
  });
  it("ตัดสั้น/ต่อท้ายตัวอักษร ⇒ ไม่ผ่าน (check char หรือความยาว)", () => {
    for (let cut = 1; cut <= 12; cut++) expect(decodeCode(good.slice(0, good.length - cut)).ok).toBe(false);
    for (const ch of ALPHABET) expect(decodeCode(good + ch).ok).toBe(false);
  });
  it("version ≠ 1 · size_idx 24..30 · n นอก 3..7 · design_no 0 ⇒ ปฏิเสธ (สร้างโดยคำนวณ check char ใหม่ให้รูปแบบถูก)", () => {
    const p = packPayload(base);
    if (!p.ok) throw new Error();
    const rebuild = (bits: string) => {
      const body = bitsToChars(bits + TAG);
      return formatCode(body + checkChar(body));
    };
    const setBits = (at: number, w: number, v: number) => p.bits.slice(0, at) + v.toString(2).padStart(w, "0") + p.bits.slice(at + w);
    expect(decodeCode(rebuild(setBits(0, 4, 2)))).toEqual({ ok: false, reason: "version" });
    for (let idx = 24; idx <= 30; idx++) expect(decodeCode(rebuild(setBits(16, 5, idx)))).toEqual({ ok: false, reason: "size_idx" });
    expect(decodeCode(rebuild(setBits(21, 3, 2)))).toEqual({ ok: false, reason: "count" });
    expect(decodeCode(rebuild(setBits(21, 3, 0)))).toEqual({ ok: false, reason: "count" });
    expect(decodeCode(rebuild(setBits(4, 12, 0)))).toEqual({ ok: false, reason: "design_no" });
    // n ไม่ตรงความยาวจริง (บอก 6 เม็ดแต่บิตมี 7) ⇒ length
    expect(decodeCode(rebuild(setBits(21, 3, 6)))).toEqual({ ok: false, reason: "length" });
  });
  it("บิตเติมท้ายไม่เป็น 0 ⇒ padding (non-canonical)", () => {
    const body = chars(good).slice(0, -1);
    const last = ALPHABET.indexOf(body[body.length - 1]);
    const flipped = body.slice(0, -1) + ALPHABET[last ^ 1]; // บิตสุดท้ายของ 5 บิต = บิตเติม (203 บิต → เติม 2 บิต)
    const code = formatCode(flipped + checkChar(flipped));
    const r = decodeCode(code);
    expect(r.ok).toBe(false);
  });
});

describe("check char (Luhn mod 32) — แยกพิมพ์ผิดออกจากปลอม", () => {
  const code = encodeFields(base);
  const body = chars(code);
  it("พิมพ์ผิดทีละ 1 ตัวทุกตำแหน่ง × ทุกตัวอักษรที่ต่าง ⇒ check_char ล้มทุกเคส (รวมตัวที่ผิดคือ check char เอง)", () => {
    let n = 0;
    for (let i = 0; i < body.length; i++) {
      for (const ch of ALPHABET) {
        if (ch === body[i]) continue;
        const mutated = body.slice(0, i) + ch + body.slice(i + 1);
        expect(checkCharValid(mutated), `${i}:${ch}`).toBe(false);
        expect(decodeCode("3JR-" + mutated)).toEqual({ ok: false, reason: "check_char" });
        n++;
      }
    }
    expect(n).toBe(body.length * 31);
  });
  it("สลับตัวติดกันที่ต่างกัน ⇒ ล้มทุกคู่ ยกเว้นคู่ 0↔Z ซึ่งเป็นจุดบอดที่รู้ของ Luhn mod 32 (ไปตกที่ HMAC)", () => {
    let detected = 0;
    let blind = 0;
    for (let i = 0; i < body.length - 1; i++) {
      if (body[i] === body[i + 1]) continue;
      const swapped = body.slice(0, i) + body[i + 1] + body[i] + body.slice(i + 2);
      const pair = new Set([body[i], body[i + 1]]);
      if (checkCharValid(swapped)) {
        expect(pair.has("0") && pair.has("Z"), `คู่ที่หลุด: ${body[i]}${body[i + 1]}`).toBe(true);
        blind++;
      } else detected++;
    }
    expect(detected).toBeGreaterThan(0);
    expect(blind).toBeLessThanOrEqual(2);
  });
  it("ทุกตัวอักษรของ ALPHABET เป็น check char ที่คำนวณได้ และ checkCharValid ยืนยัน", () => {
    for (let i = 0; i < 200; i++) {
      const s = Array.from({ length: 20 }, (_, k) => ALPHABET[(i * 7 + k * 13) % 32]).join("");
      expect(checkCharValid(s + checkChar(s))).toBe(true);
    }
  });
});

describe("พลิกทุกบิตของ payload+tag (แล้วคำนวณ check char ใหม่ให้รูปแบบถูก) ⇒ decode ได้ค่าที่ต่างจากเดิมเสมอ (HMAC จะล้มที่ code-sign)", () => {
  it("n=5 และ n=7: ทุกบิต", () => {
    for (const positions of [[3, 0, 0, 5, 3], base.positions]) {
      const f = { ...base, positions };
      const p = packPayload(f);
      if (!p.ok) throw new Error();
      const all = p.bits + TAG;
      const original = decodeCode(encodeCode(p.bits, TAG));
      if (!original.ok) throw new Error();
      let rejectedFormat = 0;
      let changed = 0;
      for (let b = 0; b < all.length; b++) {
        const bits = all.slice(0, b) + (all[b] === "1" ? "0" : "1") + all.slice(b + 1);
        const body = bitsToChars(bits);
        const d = decodeCode(formatCode(body + checkChar(body)));
        if (!d.ok) {
          rejectedFormat++;
          continue;
        }
        const same = JSON.stringify(d.fields) === JSON.stringify(original.fields) && d.tagBits === original.tagBits;
        expect(same, `บิต ${b}`).toBe(false);
        changed++;
      }
      expect(rejectedFormat + changed).toBe(all.length);
      expect(changed).toBeGreaterThan(all.length / 2);
    }
  });
});

describe("extractCodes — ดึงรหัสจากข้อความทั้งก้อน", () => {
  const code = encodeFields(base);
  it("จากข้อความ LINE · ตัวพิมพ์เล็ก · ไม่ซ้ำ · ไม่เจอ = []", () => {
    const text = `สวัสดี ขอสั่งทำแหวนตามแบบนี้\nรหัสสั่งทำ: ${code.toLowerCase()}\nรบกวนยืนยัน\n${code}`;
    expect(extractCodes(text)).toEqual([code]); // ตัวพิมพ์เล็กกับใหญ่ = รหัสเดียวกัน → canonical หนึ่งรายการ
    expect(extractCodes("ไม่มีรหัส 3J-ABC")).toEqual([]);
    expect(extractCodes(undefined as unknown as string)).toEqual([]);
  });
  it("ดึงแล้ว decode ได้", () => {
    const [found] = extractCodes(`รหัสสั่งทำ: ${code}\nขอบคุณ`);
    expect(decodeCode(found).ok).toBe(true);
  });
});

describe("S11 — รหัสที่ถูก LINE ตัดบรรทัด/คั่นด้วยช่องว่าง", () => {
  const code = encodeFields(base);
  const groups = code.slice(4).split("-");
  const canon = decodeCode(code);
  it.each([
    ["คั่นด้วยช่องว่างแทนขีด", () => "3JR " + groups.join(" ")],
    ["ตัดบรรทัดกลางรหัส", () => "3JR-" + groups.slice(0, 3).join("-") + "\n" + groups.slice(3).join("-")],
    ["ตัดบรรทัดทุกกลุ่ม (CRLF)", () => "3JR-" + groups.join("\r\n")],
    ["ขีดคู่/ช่องว่างหลายตัว", () => "3jr -  " + groups.join(" -  ")],
    ["ปนข้อความไทยรอบข้าง", () => "รหัสสั่งทำ: 3JR-" + groups.join(" ") + "\nรบกวนยืนยัน"],
    ["มีคำภาษาอังกฤษต่อท้ายทันที", () => "3JR-" + groups.join("-") + " OK thanks"],
    ["มีคำภาษาอังกฤษต่อท้ายบรรทัดถัดไป", () => "3JR-" + groups.join("-") + "\nThanks"],
  ])("%s ⇒ ถอดได้ ได้รหัสเดิม", (_n, mk) => {
    const d = decodeFromText(mk());
    expect(d.ok && d.canonical).toBe(code);
    expect(canon.ok && d.ok && d.fields).toEqual(canon.ok ? canon.fields : null);
    expect(extractCodes(mk())).toEqual([code]);
  });
  it("ไม่มีตัวคั่นหลัง 3JR (เช่น 3JRX) ไม่ถูกจับ · ข้อความว่าง = empty · ไม่เจอ = not_found", () => {
    expect(decodeFromText("3JRABCDE")).toEqual({ ok: false, reason: "not_found" });
    expect(decodeFromText("   ")).toEqual({ ok: false, reason: "empty" });
    expect(decodeFromText("สวัสดี")).toEqual({ ok: false, reason: "not_found" });
  });
  it("พิมพ์ผิด 1 ตัวในรหัสที่คั่นด้วยช่องว่าง ⇒ check_char (ไม่ใช่ not_found)", () => {
    const bad = groups.slice();
    bad[1] = (bad[1][0] === "A" ? "B" : "A") + bad[1].slice(1);
    expect(decodeFromText("3JR " + bad.join(" "))).toEqual({ ok: false, reason: "check_char" });
  });
  it("รหัสสองตัวในข้อความเดียว ⇒ ได้ทั้งสอง", () => {
    const code2 = encodeFields({ ...base, designNo: 9 });
    expect(extractCodes(`ก ${code} ข\n${code2.replace(/-/g, " ")}`)).toEqual([code, code2]);
  });
});

describe("priced_at", () => {
  it("วินาทีนับจาก 2026-01-01Z · round-trip", () => {
    expect(pricedAtToSec("2026-01-01T00:00:00Z")).toBe(0);
    expect(pricedAtToSec("2026-01-01T00:01:01Z")).toBe(61);
    expect(secToIso(61)).toBe("2026-01-01T00:01:01Z");
    expect(pricedAtToSec("2025-12-31T23:59:59Z")).toBeNull();
    expect(pricedAtToSec("ไม่ใช่วันที่")).toBeNull();
    const sec = pricedAtToSec("2026-11-09T20:12:37Z");
    expect(sec && secToIso(sec)).toBe("2026-11-09T20:12:37Z");
  });
});
