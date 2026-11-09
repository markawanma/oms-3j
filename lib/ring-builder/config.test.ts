// parity: ช่วงไซซ์/เพดานที่อยู่หลายที่ต้องตรงกัน (TS ⇔ DB ⇔ /ring-size) · ไม่แตะ /ring-size
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SHOP_RING_SIZES } from "@/lib/ring-size/config";
import { CODE_PREFIX, CZ_WHITE, MAX_DESIGN_NO, MAX_STONE_NO, MAX_STONES, MAX_TOTAL_THB, MIN_STONES, QUOTE_REASONS, RING_BUILDER_SIZES } from "./config";

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
