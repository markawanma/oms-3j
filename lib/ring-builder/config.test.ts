// parity: ช่วงไซซ์/เพดานที่อยู่หลายที่ต้องตรงกัน (TS ⇔ DB ⇔ /ring-size) · ไม่แตะ /ring-size
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SHOP_RING_SIZES } from "@/lib/ring-size/config";
import {
  CODE_PREFIX, CZ_WHITE, MAX_BODY_PRICE_THB, MAX_DESIGN_NO, MAX_OFFER_PRICE_THB, MAX_STONE_NO, MAX_STONES, MAX_TOTAL_THB, MIN_STONES, MM100_MAX, MM100_MIN, NAME_MAX, QUOTE_REASONS, RING_BUILDER_SIZES, SORT_MAX, SORT_MIN,
} from "./config";

const sql = readFileSync(join(process.cwd(), "supabase/migrations/0196_ring_builder.sql"), "utf8");

describe("parity ช่วงไซซ์", () => {
  it("RING_BUILDER_SIZES = SHOP_RING_SIZES ของ /ring-size", () => {
    expect(SHOP_RING_SIZES).not.toBeNull();
    expect(RING_BUILDER_SIZES).toEqual(SHOP_RING_SIZES);
  });
  it("DB: analytics.rb_size_range() = int4range(min, max, '[]') ตรง TS", () => {
    expect(sql).toContain(`select int4range(${RING_BUILDER_SIZES.min}, ${RING_BUILDER_SIZES.max}, '[]')`);
  });
  it("ไซซ์ 45..68 ใส่ในรหัสได้ครบ 5 บิต (idx 0..23) และไม่ชน sentinel 31", () => {
    expect(RING_BUILDER_SIZES.max - RING_BUILDER_SIZES.min).toBeLessThan(24);
  });
});

describe("parity เพดานตัวเลข TS ⇔ DB", () => {
  it("จำนวนเม็ด 3..7 · design_no ≤ 4095 · stone_no ≤ 1023 · total ≤ 262143", () => {
    expect([MIN_STONES, MAX_STONES, MAX_DESIGN_NO, MAX_STONE_NO, MAX_TOTAL_THB]).toEqual([3, 7, 4095, 1023, 262143]);
    expect(sql).toContain("stone_count between 3 and 7");
    expect(sql).toContain("design_no between 1 and 4095");
    expect(sql).toContain("stone_no between 1 and 1023");
    expect(sql).toContain("v_total > 262143");
  });
  it("เหตุผลของ 400 ครบเท่าที่ rb_quote คืน", () => {
    for (const r of QUOTE_REASONS.filter((x) => x !== "invalid")) expect(sql).toContain(`'${r}'`);
    expect(sql).toContain("'invalid'");
  });
});

describe("S12 parity: ขอบเขตที่ DB บังคับ ⇔ config.ts", () => {
  it("ขนาดพลอย mm100 · เพดานราคา · ความยาวชื่อ · ลำดับ ตรงกับข้อความ SQL", () => {
    expect([MM100_MIN, MM100_MAX]).toEqual([50, 2000]);
    expect(sql).toContain(`stone_major_mm100 between ${MM100_MIN} and ${MM100_MAX}`);
    expect(sql).toContain(`stone_minor_mm100 between ${MM100_MIN} and ${MM100_MAX}`);
    expect(sql).toContain(`p_major_mm100 not between ${MM100_MIN} and ${MM100_MAX}`);
    expect(sql).toContain(`body_price_thb between 1 and ${MAX_BODY_PRICE_THB}`);
    expect(sql).toContain(`price_thb between 1 and ${MAX_OFFER_PRICE_THB}`);
    expect(sql).toContain(`p_body_price_thb not between 1 and ${MAX_BODY_PRICE_THB}`);
    expect(sql).toContain(`rb_text_ok(name_th, 1, ${NAME_MAX.shape})`);
    expect(sql).toContain(`rb_text_ok(name_th, 1, ${NAME_MAX.stone})`);
    expect(sql).toContain(`rb_text_ok(short_name, 1, ${NAME_MAX.shortName})`);
    expect(sql).toContain(`rb_text_ok(name, 1, ${NAME_MAX.design})`);
    expect(sql).toContain(`sort between ${SORT_MIN} and ${SORT_MAX}`);
  });
  it("S4: migration ไม่มีอักขระล่องหน/bidi/tag ดิบ — ต้องเขียนเป็น escape \\uXXXX เท่านั้น", () => {
    const bad = [...sql].filter((c) => {
      const p = c.codePointAt(0) as number;
      return (
        p === 0xad || p === 0x34f || p === 0x61c || p === 0x115f || p === 0x1160 || p === 0x17b4 || p === 0x17b5 || p === 0x180e ||
        (p >= 0x200b && p <= 0x200f) || (p >= 0x2028 && p <= 0x202e) || (p >= 0x2060 && p <= 0x206f) || p === 0x2800 || p === 0x3164 ||
        (p >= 0xfe00 && p <= 0xfe0f) || p === 0xfeff || p === 0xffa0 || (p >= 0xfff9 && p <= 0xfffb) || (p >= 0x1d173 && p <= 0x1d17a) || (p >= 0xe0000 && p <= 0xe01ef)
      );
    });
    expect(bad.map((c) => (c.codePointAt(0) as number).toString(16))).toEqual([]);
  });
  it("S4: class ล่องหน (escape) ครอบรายการที่ security สั่งครบ", () => {
    const line = sql.split("\n").find((l) => l.includes("p_t !~ '[[:cntrl:]")) ?? "";
    for (const esc of ["\\u00AD", "\\u034F", "\\u061C", "\\u115F", "\\u17B4", "\\u17B5", "\\u180E", "\\u2800", "\\u3164", "\\uFE00-\\uFE0F", "\\uFEFF", "\\uFFA0", "\\uFFF9-\\uFFFB", "\\U0001D173-\\U0001D17A", "\\U000E0000-\\U000E007F", "\\U000E0100-\\U000E01EF"]) {
      expect(line, esc).toContain(esc);
    }
  });
});

describe("ค่าคงที่ข้อความ", () => {
  it("CZ ขาว = stone 0 ไม่ใช่เพชร · prefix 3JR-", () => {
    expect(CZ_WHITE.stoneNo).toBe(0);
    expect(CZ_WHITE.name).toBe("CZ ขาว");
    expect(CZ_WHITE.name).not.toMatch(/เพชร/);
    expect(CODE_PREFIX).toBe("3JR-");
  });
  it("migration ไม่ grant ให้ authenticated/anon (ข้อ 18) — เช็ก LF ทำที่ขั้น apply (ข้อ 20: autocrlf ทำให้ working tree เป็น CRLF ได้)", () => {
    expect(sql).not.toMatch(/grant[^;]*to[^;]*\b(authenticated|anon)\b/i);
  });
});
