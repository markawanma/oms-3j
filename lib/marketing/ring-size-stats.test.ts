// lib/marketing/ring-size-stats.test.ts — ตัวแปลง jsonb ของ analytics.ring_size_stats (0193)
// เคสห้ามผ่าน #5: แถวดิบ / session id / เวลาระดับนาที ห้ามถึง client — ประกอบทีละ field ไม่ spread
// เคส "ต้องไม่พัง": RPC คืน key ไม่ครบ ⇒ ไม่ crash (section ว่าง = null ไม่ใช่เลข 0 ที่แต่งขึ้น)
import { describe, expect, it } from "vitest";
import { parseRingSizeStats } from "./ring-size-stats";

/** shape จริงของ 0193 ส่วน 5 (ตัวเลขเป็นตัวอย่างวางโครง ไม่ใช่ข้อมูลจริง) */
function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sessions: 40,
    returning: 5,
    measured: 30,
    shop_range: { min: 45, max: 68 },
    data_since: "2026-11-01",
    by_in_app: { line: 10, tiktok: 12, fb: 3, ig: 1, browser: 12, unknown: 2 },
    funnel: [40, 35, 33, 31, 30, 29, 28, 27],
    abandon_at: [5, 2, 2, 1, 1, 1, 1],
    result_sizes: [
      { size: 54, count: 7 },
      { size: 55, count: 4 },
    ],
    size_summary: { below_range: 1, in_range: 28, above_range: 1, between_count: 3 },
    circ_hist: [{ mm: 52, count: 2 }],
    method: { A: 20, B: 10 },
    method_stats: {
      A: { picked: 22, measured: 18, abandoned_at_measure: 2, invalid_sessions: 1, remeasured: 3, between: null },
      B: { picked: 12, measured: 8, abandoned_at_measure: 1, invalid_sessions: 2, remeasured: 1, between: 4 },
    },
    switched: { a_to_b: 2, b_to_a: 3, both: 5 },
    saw_between: 4,
    ref: { card: 15, coin: 20 },
    method_x_ref: { A_card: 8, A_coin: 12, B_card: 4, B_coin: 6 },
    cta: { line: 6, share: 2, shop: 1, gem_quiz: 0 },
    friction: { zoom_blocked: 3, calib_warn: 2, invalid: 3, stale_recalib: 1, remeasured: 4 },
    daily: [
      { date: "2026-11-01", sessions: 10, measured: 7 },
      { date: "2026-11-02", sessions: 0, measured: 0 },
    ],
    ...overrides,
  };
}

describe("parseRingSizeStats — happy path (key จริงของ 0193)", () => {
  it("แปลงเป็น camelCase ครบทุก field", () => {
    const s = parseRingSizeStats(payload());
    expect(s).not.toBeNull();
    expect(s).toMatchObject({
      sessions: 40,
      returning: 5,
      measured: 30,
      shopRange: { min: 45, max: 68 },
      dataSince: "2026-11-01",
      byInApp: { line: 10, tiktok: 12, fb: 3, ig: 1, browser: 12, unknown: 2 },
      sizeSummary: { belowRange: 1, inRange: 28, aboveRange: 1, betweenCount: 3 },
      method: { A: 20, B: 10 },
      switched: { aToB: 2, bToA: 3, both: 5 },
      sawBetween: 4,
      ref: { card: 15, coin: 20 },
      methodXRef: { aCard: 8, aCoin: 12, bCard: 4, bCoin: 6 },
      cta: { line: 6, share: 2, shop: 1, gemQuiz: 0 },
      friction: { zoomBlocked: 3, calibWarn: 2, invalid: 3, staleRecalib: 1, remeasured: 4 },
    });
    expect(s?.funnel).toHaveLength(8);
    expect(s?.abandonAt).toHaveLength(7);
    expect(s?.methodStats?.A).toEqual({ picked: 22, measured: 18, abandonedAtMeasure: 2, invalidSessions: 1, remeasured: 3, between: null });
    expect(s?.methodStats?.B.between).toBe(4);
    expect(s?.daily).toEqual([
      { date: "2026-11-01", sessions: 10, measured: 7 },
      { date: "2026-11-02", sessions: 0, measured: 0 },
    ]);
  });

  it("ไม่มี src / by_src / src_options (A3 เลิกแล้ว) ในผล", () => {
    const s = parseRingSizeStats(payload({ by_src: { line: 1 }, src_options: [{ code: "line" }], src: "line" }));
    const json = JSON.stringify(s);
    expect(json).not.toMatch(/by_src|bySrc|src_options|srcOptions|"src"/);
  });

  it("ตารางว่างทั้งหมด (0 ครั้ง): data_since null · array ศูนย์ · ไม่ crash", () => {
    const s = parseRingSizeStats(
      payload({
        sessions: 0,
        returning: 0,
        measured: 0,
        data_since: null,
        by_in_app: { line: 0, tiktok: 0, fb: 0, ig: 0, browser: 0, unknown: 0 },
        funnel: [0, 0, 0, 0, 0, 0, 0, 0],
        abandon_at: [0, 0, 0, 0, 0, 0, 0],
        result_sizes: [],
        size_summary: { below_range: 0, in_range: 0, above_range: 0, between_count: 0 },
        circ_hist: [],
        daily: [{ date: "2026-10-28", sessions: 0, measured: 0 }],
      })
    );
    expect(s).not.toBeNull();
    expect(s?.dataSince).toBeNull();
    expect(s?.resultSizes).toEqual([]);
  });

  it("method_stats.A.between ไม่ใช่ตัวเลขก็ผ่าน (A ไม่มีก้ำกึ่ง) แต่ B ต้องเป็นตัวเลข", () => {
    const base = payload();
    const ms = base.method_stats as Record<string, Record<string, unknown>>;
    const withA = parseRingSizeStats({ ...base, method_stats: { A: { ...ms.A, between: "ขยะ" }, B: ms.B } });
    expect(withA?.methodStats?.A.between).toBeNull();
    const badB = parseRingSizeStats({ ...base, method_stats: { A: ms.A, B: { ...ms.B, between: null } } });
    expect(badB?.methodStats).toBeNull();
  });
});

describe("เคส 5 — แถวดิบ / session id / เวลา ห้ามถึง client", () => {
  it("key ที่ RPC ไม่ได้สัญญา (rows / session_id / created_at / sid ...) ถูกทิ้ง ไม่โผล่ในผลทุกระดับ", () => {
    const evil = payload({
      rows: [{ session_id: "00000000-0000-4000-8000-000000000001", created_at: "2026-11-03T10:15:42Z" }],
      session_id: "00000000-0000-4000-8000-000000000002",
      sid: "abc",
      created_at: "2026-11-03T10:15:42Z",
      updated_at: "2026-11-03T10:16:42Z",
      shop_id: "shop-secret",
      by_in_app: { line: 1, tiktok: 0, fb: 0, ig: 0, browser: 0, unknown: 0, raw_ua: "Mozilla/5.0" },
      cta: { line: 1, share: 0, shop: 0, gem_quiz: 0, session_ids: ["x"] },
      friction: { zoom_blocked: 0, calib_warn: 0, invalid: 0, stale_recalib: 0, remeasured: 0, rows: [1] },
      size_summary: { below_range: 0, in_range: 1, above_range: 0, between_count: 0, rows: [1] },
      method_stats: {
        A: { picked: 1, measured: 1, abandoned_at_measure: 0, invalid_sessions: 0, remeasured: 0, between: null, session_id: "x" },
        B: { picked: 0, measured: 0, abandoned_at_measure: 0, invalid_sessions: 0, remeasured: 0, between: 0, created_at: "x" },
      },
      shop_range: { min: 45, max: 68, shop_id: "shop-secret" },
    });
    const json = JSON.stringify(parseRingSizeStats(evil));
    for (const leak of ["session_id", "sessionId", "\"sid\"", "created_at", "updated_at", "shop-secret", "shop_id", "Mozilla", "raw_ua", "00000000-0000-4000", "10:15", "\"rows\""]) {
      expect(json).not.toContain(leak);
    }
  });

  it("ผลเป็น object ใหม่ ไม่ใช่ตัวเดียวกับ raw (ไม่ spread / ไม่คืน reference เดิม)", () => {
    const raw = payload();
    const s = parseRingSizeStats(raw);
    expect(s).not.toBe(raw);
    expect(s?.byInApp).not.toBe(raw.by_in_app);
    expect(s?.cta).not.toBe(raw.cta);
    expect(s?.daily?.[0]).not.toBe((raw.daily as unknown[])[0]);
  });

  it("daily ที่พกเวลาระดับนาที/วินาที ⇒ ทั้ง section เป็น null (ไม่ปล่อยเวลาถึง client)", () => {
    const s = parseRingSizeStats(payload({ daily: [{ date: "2026-11-03T10:15:42Z", sessions: 1, measured: 0 }] }));
    expect(s?.daily).toBeNull();
    expect(JSON.stringify(s)).not.toContain("10:15");
  });

  it("แถวใน daily มี field เกิน (เช่น created_at) ⇒ ถูกทิ้ง เหลือแค่ date/sessions/measured", () => {
    const s = parseRingSizeStats(payload({ daily: [{ date: "2026-11-03", sessions: 1, measured: 0, created_at: "x", session_id: "y" }] }));
    expect(s?.daily).toEqual([{ date: "2026-11-03", sessions: 1, measured: 0 }]);
  });
});

describe("ตัวเลขหลักผิดสัญญา ⇒ null (⇒ error state)", () => {
  it.each([
    ["ไม่ใช่ object", "abc"],
    ["null", null],
    ["array", []],
    ["undefined", undefined],
    ["sessions เป็นสตริง", payload({ sessions: "40" })],
    ["sessions ติดลบ", payload({ sessions: -1 })],
    ["sessions เป็นทศนิยม", payload({ sessions: 1.5 })],
    ["sessions เป็น NaN", payload({ sessions: NaN })],
    ["sessions เป็น Infinity", payload({ sessions: Infinity })],
    ["sessions หาย", (() => { const p = payload(); delete p.sessions; return p; })()],
    ["returning เป็น null", payload({ returning: null })],
    ["measured หาย", (() => { const p = payload(); delete p.measured; return p; })()],
  ])("%s", (_name, raw) => {
    expect(() => parseRingSizeStats(raw)).not.toThrow();
    expect(parseRingSizeStats(raw)).toBeNull();
  });
});

describe("section หาย/ผิดรูป ⇒ null เฉพาะ section นั้น (ไม่ crash · ไม่แต่งเลข 0)", () => {
  it("key ทั้งหมดนอกจาก 3 ตัวเลขหลักหายไป ⇒ ได้ object ที่ทุก section = null", () => {
    const s = parseRingSizeStats({ sessions: 3, returning: 0, measured: 1 });
    expect(s).toMatchObject({
      sessions: 3,
      shopRange: null,
      dataSince: null,
      byInApp: null,
      funnel: null,
      abandonAt: null,
      resultSizes: null,
      sizeSummary: null,
      circHist: null,
      method: null,
      methodStats: null,
      switched: null,
      sawBetween: null,
      ref: null,
      methodXRef: null,
      cta: null,
      friction: null,
      daily: null,
    });
  });

  it.each([
    ["funnel ยาวผิด", { funnel: [1, 2, 3] }, "funnel"],
    ["funnel มีค่าลบ", { funnel: [1, 1, 1, 1, 1, 1, 1, -1] }, "funnel"],
    ["abandon_at ยาวผิด", { abandon_at: [1, 2] }, "abandonAt"],
    ["by_in_app ขาด bucket", { by_in_app: { line: 1 } }, "byInApp"],
    ["result_sizes ไม่ใช่ array", { result_sizes: {} }, "resultSizes"],
    ["result_sizes มีแถวเสีย", { result_sizes: [{ size: 54 }] }, "resultSizes"],
    ["size_summary ขาด key", { size_summary: { in_range: 1 } }, "sizeSummary"],
    ["cta ขาด gem_quiz", { cta: { line: 1, share: 1, shop: 1 } }, "cta"],
    ["friction มี NaN", { friction: { zoom_blocked: NaN, calib_warn: 0, invalid: 0, stale_recalib: 0, remeasured: 0 } }, "friction"],
    ["method_stats ขาดวิธี B", { method_stats: { A: (payload().method_stats as Record<string, unknown>).A } }, "methodStats"],
    ["switched เป็นสตริง", { switched: "x" }, "switched"],
  ])("%s ⇒ %s = null แต่ตัวเลขหลักยังอยู่", (_n, override, key) => {
    const s = parseRingSizeStats(payload(override)) as unknown as Record<string, unknown>;
    expect(s).not.toBeNull();
    expect(s[key]).toBeNull();
    expect(s.sessions).toBe(40);
  });
});

describe("shop_range — ห้าม hardcode 45/68 (เคส 7): ใช้ค่าจาก RPC · ผิดรูป ⇒ null ไม่ fallback", () => {
  it("ค่าจาก RPC ถูกส่งต่อตามจริง (ไม่ใช่ 45/68)", () => {
    expect(parseRingSizeStats(payload({ shop_range: { min: 50, max: 60 } }))?.shopRange).toEqual({ min: 50, max: 60 });
  });
  it.each([
    [{ min: 70, max: 50 }],
    [{ min: 10, max: 20 }], // นอก 30..90 ที่เก็บได้จริง
    [{ min: 40, max: 200 }],
    [{ min: "45", max: 68 }],
    [{ min: null, max: null }],
    [null],
    [undefined],
  ])("ผิดรูป %j ⇒ null (ไม่ fallback เป็น 45/68)", (sr) => {
    const s = parseRingSizeStats(payload({ shop_range: sr }));
    expect(s?.shopRange).toBeNull();
  });
});

describe("data_since", () => {
  it("รูปแบบผิด / เวลาพ่วง ⇒ null (ไม่ปล่อยเวลาถึง client)", () => {
    expect(parseRingSizeStats(payload({ data_since: "2026-11-01T10:15:00Z" }))?.dataSince).toBeNull();
    expect(parseRingSizeStats(payload({ data_since: 20261101 }))?.dataSince).toBeNull();
  });
});
