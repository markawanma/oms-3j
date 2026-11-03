// lib/actions/ring-size-stats.test.ts — getRingSizeStats (หน้า /marketing/ring-size · P3)
//
// 🔴 เคสห้ามผ่านของ brief ที่ล็อกที่นี่ (ทุกเคสปฏิเสธเช็คว่า RPC "ไม่ถูกเรียกเลย"):
//   1 staff ปฏิเสธก่อน RPC · 3 ช่วงวันผิด/ขยะ ปฏิเสธที่ action · 4 shop_id มาจาก env ฝั่ง server เท่านั้น
//   5 ผลมีแต่ aggregate (ไม่ spread) · 6 ไม่ log error ทั้งก้อน (PII)
//   (เคส 2 "ไม่ล็อกอิน/ไม่ใช่สมาชิก" ผ่าน role.ts จริง → ring-size-stats.auth.test.ts)
// Mocking pattern เดียวกับ gem-quiz-stats.test.ts (getEffectiveRole + getDevShopId + getServiceClient().schema().rpc)
import { beforeEach, describe, expect, it, vi } from "vitest";

const getEffectiveRoleMock = vi.fn();
const getDevShopIdMock = vi.fn();
const rpcMock = vi.fn();
const schemaMock = vi.fn();

vi.mock("@/lib/auth/role", () => ({
  getEffectiveRole: () => getEffectiveRoleMock(),
}));

vi.mock("@/lib/dev/context", () => ({
  getDevShopId: () => getDevShopIdMock(),
}));

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({
    schema: (name: string) => {
      schemaMock(name);
      return { rpc: rpcMock };
    },
  }),
}));

/** shape จริงของ 0193 ส่วน 5 (ตัวเลขเป็นตัวอย่างวางโครง) */
function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sessions: 12,
    returning: 1,
    measured: 8,
    shop_range: { min: 45, max: 68 },
    data_since: "2026-11-03",
    by_in_app: { line: 4, tiktok: 4, fb: 0, ig: 0, browser: 4, unknown: 0 },
    funnel: [12, 10, 9, 9, 8, 8, 8, 8],
    abandon_at: [2, 1, 0, 1, 0, 0, 0],
    result_sizes: [{ size: 54, count: 5 }],
    size_summary: { below_range: 0, in_range: 8, above_range: 0, between_count: 1 },
    circ_hist: [],
    method: { A: 6, B: 2 },
    method_stats: {
      A: { picked: 6, measured: 5, abandoned_at_measure: 0, invalid_sessions: 0, remeasured: 1, between: null },
      B: { picked: 3, measured: 3, abandoned_at_measure: 0, invalid_sessions: 0, remeasured: 0, between: 1 },
    },
    switched: { a_to_b: 1, b_to_a: 0, both: 1 },
    saw_between: 1,
    ref: { card: 3, coin: 5 },
    method_x_ref: { A_card: 2, A_coin: 4, B_card: 1, B_coin: 1 },
    cta: { line: 2, share: 0, shop: 0, gem_quiz: 0 },
    friction: { zoom_blocked: 0, calib_warn: 0, invalid: 0, stale_recalib: 0, remeasured: 1 },
    daily: [{ date: "2026-11-03", sessions: 12, measured: 8 }],
    ...overrides,
  };
}

const VALID_INPUT = { from: "2026-10-05", to: "2026-11-03" }; // 30 วัน

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  getEffectiveRoleMock.mockResolvedValue("owner");
  getDevShopIdMock.mockReturnValue("shop-from-env");
  rpcMock.mockResolvedValue({ data: validPayload(), error: null });
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

async function call(input: { from: string; to: string }) {
  const { getRingSizeStats } = await import("./ring-size-stats");
  return getRingSizeStats(input);
}

function expectNoDbTouched() {
  expect(rpcMock).not.toHaveBeenCalled();
  expect(schemaMock).not.toHaveBeenCalled();
}

describe("เคส 1 — role gate: staff ปฏิเสธก่อนถึง RPC", () => {
  it("staff ⇒ ok:false · ไม่เรียก RPC · ไม่แตะ shop id · ไม่แตะ client", async () => {
    getEffectiveRoleMock.mockResolvedValue("staff");
    const r = await call(VALID_INPUT);
    expect(r.ok).toBe(false);
    expectNoDbTouched();
    expect(getDevShopIdMock).not.toHaveBeenCalled();
  });

  it("staff + ช่วงวันผิด ⇒ ได้ข้อความปฏิเสธสิทธิ์ (ด่านสิทธิ์มาก่อน — ไม่ให้ probe ตัวตรวจช่วงวัน)", async () => {
    getEffectiveRoleMock.mockResolvedValue("staff");
    const bad = await call({ from: "2026-02-30", to: "x" });
    const good = await call(VALID_INPUT);
    expect(bad).toEqual(good); // ข้อความเดียวกันทุกอินพุต
    expectNoDbTouched();
  });

  it("role ที่ไม่รู้จัก (fail-closed ที่ role.ts คืน staff) ⇒ ไม่ผ่านเช่นกัน", async () => {
    getEffectiveRoleMock.mockResolvedValue("staff");
    expect((await call(VALID_INPUT)).ok).toBe(false);
    expectNoDbTouched();
  });

  it.each(["owner", "admin"])("%s ⇒ ผ่านด่าน เรียก RPC 1 ครั้ง", async (role) => {
    getEffectiveRoleMock.mockResolvedValue(role);
    const r = await call(VALID_INPUT);
    expect(r.ok).toBe(true);
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });
});

describe("เคส 3 — ช่วงวัน: ปฏิเสธที่ action (ไม่พึ่ง 22023 ของ RPC)", () => {
  const to = "2026-11-03";
  const day = (diff: number) => {
    const d = new Date(`${to}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - diff);
    return d.toISOString().slice(0, 10);
  };

  it("diff 5 ⇒ ปฏิเสธ (ไม่เรียก RPC) · diff 6 ⇒ ผ่าน (7 วันพอดี)", async () => {
    expect((await call({ from: day(5), to })).ok).toBe(false);
    expectNoDbTouched();
    expect((await call({ from: day(6), to })).ok).toBe(true);
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("ring_size_stats", expect.objectContaining({ p_from: day(6), p_to: to }));
  });

  it("diff 179 ⇒ ผ่าน (180 วันพอดี) · diff 180 ⇒ ปฏิเสธ (ไม่เรียก RPC เพิ่ม)", async () => {
    expect((await call({ from: day(179), to })).ok).toBe(true);
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect((await call({ from: day(180), to })).ok).toBe(false);
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it("from === to (วันเดียว) ⇒ ปฏิเสธ", async () => {
    expect((await call({ from: to, to })).ok).toBe(false);
    expectNoDbTouched();
  });

  it("from > to ⇒ ปฏิเสธ", async () => {
    expect((await call({ from: "2026-11-03", to: "2026-10-01" })).ok).toBe(false);
    expectNoDbTouched();
  });

  it.each([
    ["2026-02-30", "2026-11-03"],
    ["2026-10-01", "2026-02-30"],
    ["infinity", "2026-11-03"],
    ["2026-10-01", "infinity"],
    ["-infinity", "infinity"],
    ["2026/10/01", "2026-11-03"],
    ["2026-10-01", "03-11-2026"],
    ["not-a-date", "2026-11-03"],
    ["", ""],
    ["2026-10-01'; drop table analytics.ring_size_session; --", "2026-11-03"],
    ["2026-10-01T00:00:00Z", "2026-11-03T00:00:00Z"],
    ["2026-10-01\n", "2026-11-03"],
    ["๒๐๒๖-๑๐-๐๑", "2026-11-03"],
    ["9999-12-31", "9999-12-31"],
    ["0000-01-01", "2026-11-03"], // security L3: ปี 0000 ผ่าน JS แต่ Postgres 22008
    ["0000-12-25", "0000-12-31"],
  ])("วันที่ไม่ใช่วันจริง/ขยะ (%j → %j) ⇒ ปฏิเสธก่อน RPC ไม่ throw", async (from, toVal) => {
    const r = await call({ from, to: toVal });
    expect(r.ok).toBe(false);
    expectNoDbTouched();
    expect(getDevShopIdMock).not.toHaveBeenCalled();
  });

  it("ชนิดผิด (ไม่ใช่ string) / input ว่าง ⇒ ปฏิเสธ ไม่ throw", async () => {
    const { getRingSizeStats } = await import("./ring-size-stats");
    for (const bad of [null, undefined, {}, { from: 1, to: 2 }, { from: null, to: null }, { from: ["2026-10-01"], to: ["2026-11-03"] }]) {
      const r = await getRingSizeStats(bad as unknown as { from: string; to: string });
      expect(r.ok).toBe(false);
    }
    expectNoDbTouched();
  });

  it("ข้อความปฏิเสธไม่ echo ค่าที่ client ส่งมา", async () => {
    const r = await call({ from: "<img src=x onerror=alert(1)>", to: "2026-11-03" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).not.toMatch(/img|onerror|alert/);
  });
});

describe("เคส 4 — shop_id มาจาก env ฝั่ง server เท่านั้น", () => {
  it("p_shop_id = getDevShopId() · RPC = analytics.ring_size_stats · ส่งแค่ 3 พารามิเตอร์", async () => {
    await call(VALID_INPUT);
    expect(schemaMock).toHaveBeenCalledWith("analytics");
    expect(rpcMock).toHaveBeenCalledWith("ring_size_stats", {
      p_shop_id: "shop-from-env",
      p_from: VALID_INPUT.from,
      p_to: VALID_INPUT.to,
    });
  });

  it("client แอบส่ง shopId/shop_id/p_shop_id มา ⇒ ถูกเพิกเฉย (ไม่ถึง RPC)", async () => {
    const { getRingSizeStats } = await import("./ring-size-stats");
    // @ts-expect-error — GetRingSizeStatsInput ไม่มี field shop (ด่านระดับชนิด): ถ้าวันหนึ่งเพิ่ม field นี้ บรรทัดนี้ต้องทำให้ tsc ล้ม
    await getRingSizeStats({ ...VALID_INPUT, shopId: "evil-shop" });
    const evil = { ...VALID_INPUT, shopId: "evil-shop", shop_id: "evil-shop", p_shop_id: "evil-shop", pShopId: "evil-shop" };
    await getRingSizeStats(evil as unknown as { from: string; to: string });
    expect(rpcMock).toHaveBeenCalledTimes(2);
    for (const [, params] of rpcMock.mock.calls) {
      expect(params).toEqual({ p_shop_id: "shop-from-env", p_from: VALID_INPUT.from, p_to: VALID_INPUT.to });
      expect(JSON.stringify(params)).not.toContain("evil-shop");
    }
  });

  it("ตั้งค่า shop ไม่ครบ (getDevShopId throw) ⇒ ok:false ไม่เรียก RPC ไม่ throw ขึ้นไป", async () => {
    getDevShopIdMock.mockImplementation(() => {
      throw new Error("DEV_SHOP_ID is not set");
    });
    const r = await call(VALID_INPUT);
    expect(r.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
    if (!r.ok) expect(r.error).not.toContain("DEV_SHOP_ID");
  });
});

describe("เคส 5 — มีแต่ aggregate ถึง client", () => {
  it("RPC คืน field เกิน (แถวดิบ / session id / เวลา) ⇒ ไม่ปรากฏในผลของ action", async () => {
    rpcMock.mockResolvedValue({
      data: validPayload({
        rows: [{ session_id: "00000000-0000-4000-8000-000000000001", created_at: "2026-11-03T10:15:42Z" }],
        session_id: "00000000-0000-4000-8000-000000000002",
        created_at: "2026-11-03T10:15:42Z",
        shop_id: "shop-from-env",
      }),
      error: null,
    });
    const r = await call(VALID_INPUT);
    expect(r.ok).toBe(true);
    const json = JSON.stringify(r);
    for (const leak of ["session_id", "created_at", "10:15", "00000000-0000-4000", "shop-from-env", "shop_id", "\"rows\""]) {
      expect(json).not.toContain(leak);
    }
  });

  it("ผลสำเร็จ: ค่าตรงกับที่ RPC ส่ง (camelCase)", async () => {
    const r = await call(VALID_INPUT);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.sessions).toBe(12);
      expect(r.data.measured).toBe(8);
      expect(r.data.shopRange).toEqual({ min: 45, max: 68 });
      expect(r.data.cta?.line).toBe(2);
    }
  });
});

describe("ต้องไม่พัง — ข้อมูลว่าง/น้อย", () => {
  it("ตารางว่างทั้งหมด (0 ครั้ง · data_since null) ⇒ ok:true ไม่ crash", async () => {
    rpcMock.mockResolvedValue({
      data: validPayload({
        sessions: 0,
        returning: 0,
        measured: 0,
        data_since: null,
        by_in_app: { line: 0, tiktok: 0, fb: 0, ig: 0, browser: 0, unknown: 0 },
        funnel: [0, 0, 0, 0, 0, 0, 0, 0],
        abandon_at: [0, 0, 0, 0, 0, 0, 0],
        result_sizes: [],
        size_summary: { below_range: 0, in_range: 0, above_range: 0, between_count: 0 },
        daily: [],
      }),
      error: null,
    });
    const r = await call(VALID_INPUT);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.sessions).toBe(0);
      expect(r.data.dataSince).toBeNull();
    }
  });
});

describe("RPC error ⇒ error state ปลอดภัย (ไม่ crash · ไม่เผยข้อความดิบ)", () => {
  const PII = "somchai@example.com 0812345678";

  it("RPC คืน error ⇒ ok:false · ข้อความคงที่ ไม่มี message/details ดิบ", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: "42501", message: `permission denied for ${PII}`, details: `Key (email)=(${PII})`, hint: "ดู host db.xxx.supabase.co" },
    });
    const r = await call(VALID_INPUT);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("โหลดสถิติไม่สำเร็จ ลองใหม่อีกครั้ง");
      expect(r.error).not.toMatch(/permission|somchai|supabase|42501/);
    }
  });

  it("RPC throw ตรง (network/timeout) ⇒ ok:false ไม่ throw ขึ้นไปหา caller", async () => {
    rpcMock.mockRejectedValue(new Error(`fetch failed ${PII}`));
    const r = await call(VALID_INPUT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).not.toContain("somchai");
  });

  it("RPC คืน shape เพี้ยน (ตัวเลขหลักหาย) ⇒ ok:false", async () => {
    rpcMock.mockResolvedValue({ data: { sessions: "x" }, error: null });
    expect((await call(VALID_INPUT)).ok).toBe(false);
    rpcMock.mockResolvedValue({ data: null, error: null });
    expect((await call(VALID_INPUT)).ok).toBe(false);
  });

  it("RPC คืน key ไม่ครบ (นอกจากตัวเลขหลัก) ⇒ ยัง ok:true ไม่ crash (section ว่าง)", async () => {
    rpcMock.mockResolvedValue({ data: { sessions: 3, returning: 0, measured: 1 }, error: null });
    const r = await call(VALID_INPUT);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.funnel).toBeNull();
  });
});

describe("เคส 6 — log เฉพาะ SQLSTATE ห้ามก้อน error ทั้งก้อน (PII)", () => {
  const PII = "somchai@example.com";
  const logged = () => JSON.stringify(consoleErrorSpy.mock.calls.map((c: unknown[]) => c.map((a) => (a instanceof Error ? { m: a.message, s: a.stack } : a))));

  it("error จาก supabase: log เฉพาะ code · ไม่มี message/details/hint/อีเมล", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: "22023", message: `bad ${PII}`, details: `DETAIL ${PII}`, hint: "HINT https://db.example.supabase.co/x?k=secret" },
    });
    await call(VALID_INPUT);
    expect(consoleErrorSpy).toHaveBeenCalled();
    const out = logged();
    expect(out).toContain("22023");
    for (const leak of [PII, "DETAIL", "HINT", "secret", "supabase.co"]) expect(out).not.toContain(leak);
    // ไม่ส่ง object ก้อนใดๆ เข้า console.error (มีแต่ข้อความ/รหัสเป็น string)
    for (const args of consoleErrorSpy.mock.calls as unknown[][]) {
      for (const a of args) expect(typeof a).toBe("string");
    }
  });

  it("throw ที่ไม่มี code ⇒ log 'unknown' ไม่มี message", async () => {
    rpcMock.mockRejectedValue(new Error(`boom ${PII}`));
    await call(VALID_INPUT);
    const out = logged();
    expect(out).toContain("unknown");
    expect(out).not.toContain(PII);
    expect(out).not.toContain("boom");
  });

  it("shape เพี้ยน ⇒ log ข้อความคงที่ ไม่ echo payload", async () => {
    rpcMock.mockResolvedValue({ data: { sessions: "x", pii: PII }, error: null });
    await call(VALID_INPUT);
    expect(logged()).not.toContain(PII);
  });
});
