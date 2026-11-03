// lib/actions/ring-size-stats.qa.test.ts — QA อิสระ (qa/ring-size-p3): ด่านสิทธิ์ + ช่วงวัน + shop_id ของ getRingSizeStats
//
// เสริมเทสต์ของ dev (ring-size-stats.test.ts / .auth.test.ts) ด้วย: brute force ขอบช่วงวัน ผ่าน action จริงทีละคู่ · เรียกพร้อมกันคนละสิทธิ์ ·
// role แปลก/ไม่รู้จัก · ผลตอบกลับของ RPC แปลกรูป · input ที่พก __proto__/field เกิน
import { beforeEach, describe, expect, it, vi } from "vitest";

const getEffectiveRoleMock = vi.fn();
const getDevShopIdMock = vi.fn();
const rpcMock = vi.fn();
const schemaMock = vi.fn();

vi.mock("@/lib/auth/role", () => ({ getEffectiveRole: () => getEffectiveRoleMock() }));
vi.mock("@/lib/dev/context", () => ({ getDevShopId: () => getDevShopIdMock() }));
vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({
    schema: (name: string) => {
      schemaMock(name);
      return { rpc: rpcMock };
    },
  }),
}));

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const utcMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
const sqlAccepts = (from: string, to: string) => {
  const diff = Math.round((utcMs(to) - utcMs(from)) / DAY);
  return from <= to && diff >= 6 && diff <= 179;
};

function payload(sessions = 12): Record<string, unknown> {
  return { sessions, returning: 1, measured: 8 };
}

async function call(input: unknown) {
  const { getRingSizeStats } = await import("./ring-size-stats");
  return getRingSizeStats(input as { from: string; to: string });
}

beforeEach(() => {
  vi.clearAllMocks();
  getEffectiveRoleMock.mockResolvedValue("owner");
  getDevShopIdMock.mockReturnValue("shop-from-env");
  rpcMock.mockResolvedValue({ data: payload(), error: null });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("QA3 — ขอบช่วงวันผ่าน action จริง: RPC ถูกเรียกก็ต่อเมื่อสูตร SQL ยอมรับ", () => {
  it("คู่ (from,to) 4 จุดเริ่ม × to−from −2..182 ⇒ เรียก RPC ⇔ 6 ≤ diff ≤ 179 · ส่ง p_from/p_to ตรงตัว", async () => {
    let accepted = 0;
    let rejected = 0;
    for (const from of ["2026-01-01", "2026-02-27", "2026-12-25", "2028-02-20"]) {
      for (let off = -2; off <= 182; off++) {
        const to = iso(utcMs(from) + off * DAY);
        rpcMock.mockClear();
        const r = await call({ from, to });
        if (sqlAccepts(from, to)) {
          accepted++;
          expect(r.ok, `${from}→${to}`).toBe(true);
          expect(rpcMock).toHaveBeenCalledTimes(1);
          expect(rpcMock).toHaveBeenCalledWith("ring_size_stats", { p_shop_id: "shop-from-env", p_from: from, p_to: to });
        } else {
          rejected++;
          expect(r.ok, `${from}→${to}`).toBe(false);
          expect(rpcMock, `${from}→${to}`).not.toHaveBeenCalled();
        }
      }
    }
    expect(accepted).toBe(4 * 174); // diff 6..179 = 174 ค่า
    expect(rejected).toBe(4 * (185 - 174));
  });
});

describe("QA3 — input ขยะ/พก field เกิน ⇒ ไม่ถึง RPC หรือถึงแค่ 3 พารามิเตอร์", () => {
  it.each([
    [{ from: "2026-10-05'; drop table analytics.ring_size_session;--", to: "2026-11-03" }],
    [{ from: "2026-10-05", to: "9999-99-99" }],
    [{ from: "2026-10-05", to: "infinity" }],
    [{ from: "-infinity", to: "infinity" }],
    [{ from: "", to: "" }],
    [{ from: null, to: undefined }],
    [{ from: 1, to: 2 }],
    [{ from: ["2026-10-05"], to: ["2026-11-03"] }],
    [{}],
    [null],
    [undefined],
    ["2026-10-05"],
    [42],
  ])("input %# ⇒ ok:false · RPC ไม่ถูกเรียก · ไม่ throw", async (input) => {
    const r = await call(input);
    expect(r.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
    expect(JSON.stringify(r)).not.toMatch(/drop table|9999|infinity/);
  });

  it("input พก shop_id/p_shop_id/__proto__/field เกิน ⇒ RPC ได้ตรง 3 พารามิเตอร์ · p_shop_id = ค่าจาก env เท่านั้น", async () => {
    const input = JSON.parse(
      '{"from":"2026-10-05","to":"2026-11-03","shop_id":"evil","shopId":"evil","p_shop_id":"evil","__proto__":{"p_shop_id":"evil"},"constructor":{"prototype":{"p_shop_id":"evil"}}}'
    );
    const r = await call(input);
    expect(r.ok).toBe(true);
    const args = rpcMock.mock.calls[0][1] as Record<string, unknown>;
    expect(Object.keys(args).sort()).toEqual(["p_from", "p_shop_id", "p_to"]);
    expect(args.p_shop_id).toBe("shop-from-env");
    expect(JSON.stringify(args)).not.toContain("evil");
    expect(({} as Record<string, unknown>).p_shop_id).toBeUndefined(); // ไม่มี prototype pollution หลุด
  });
});

describe("QA3 — ด่านสิทธิ์: เรียกพร้อมกัน/role แปลก", () => {
  it("เรียกพร้อมกัน 40 ครั้ง สลับ staff/owner/admin ⇒ staff ไม่เคยถึง RPC · RPC = จำนวนที่ไม่ใช่ staff เป๊ะ", async () => {
    const roles = Array.from({ length: 40 }, (_, i) => (["staff", "owner", "admin", "staff"] as const)[i % 4]);
    for (const r of roles) getEffectiveRoleMock.mockResolvedValueOnce(r);
    const results = await Promise.all(roles.map(() => call({ from: "2026-10-05", to: "2026-11-03" })));
    results.forEach((r, i) => expect(r.ok, `#${i} ${roles[i]}`).toBe(roles[i] !== "staff"));
    expect(rpcMock).toHaveBeenCalledTimes(roles.filter((r) => r !== "staff").length);
  });

  it("getEffectiveRole throw ⇒ ไม่เรียก RPC (fail-closed)", async () => {
    getEffectiveRoleMock.mockRejectedValue(new Error("auth backend down"));
    const r = await call({ from: "2026-10-05", to: "2026-11-03" }).catch(() => ({ ok: false as const }));
    expect(r.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
    expect(schemaMock).not.toHaveBeenCalled();
  });

  it("staff ⇒ ไม่แตะ shop id และไม่สร้าง service client เลย", async () => {
    getEffectiveRoleMock.mockResolvedValue("staff");
    const r = await call({ from: "2026-10-05", to: "2026-11-03" });
    expect(r.ok).toBe(false);
    expect(getDevShopIdMock).not.toHaveBeenCalled();
    expect(schemaMock).not.toHaveBeenCalled();
  });

  // ⚠️ KNOWN-RISK (defense-in-depth, ระดับต่ำ): ด่านเป็น denylist — `=== "staff"` เท่านั้น ⇒ ค่า role ที่ไม่ใช่ owner/admin/staff
  // (undefined/null/"viewer") ผ่านเข้า RPC ได้ · ปัจจุบัน role.ts คืนได้แค่ 3 ค่า (fail-closed เป็น staff) จึงยังไม่เกิดจริง
  // เหมือน gem-quiz-stats.ts ทุกประการ (ธรรมเนียม repo) · it.fails = เทสต์ผ่านตราบที่ช่องนี้ยังอยู่ · พอเปลี่ยนเป็น allowlist มันจะ "ล้ม"
  // → ให้ลบ .fails ออก
  it.fails.each([[undefined], [null], ["viewer"], [""], ["OWNER"]])("[KNOWN-RISK] role=%s (ไม่ใช่ owner/admin) ควรถูกปฏิเสธ", async (role) => {
    getEffectiveRoleMock.mockResolvedValue(role);
    const r = await call({ from: "2026-10-05", to: "2026-11-03" });
    expect(r.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("QA5 — RPC ตอบแปลก ⇒ error state ปลอดภัย (ไม่ crash ไม่โชว์ของดิบ)", () => {
  const FIXED = "โหลดสถิติไม่สำเร็จ ลองใหม่อีกครั้ง";
  it.each([
    ["null", null],
    ["[]", []],
    ["[payload]", [payload()]],
    ["สตริง JSON", JSON.stringify(payload())],
    ["ตัวเลข", 42],
    ["sessions เป็นสตริง", { ...payload(), sessions: "12" }],
    ["sessions ติดลบ", { ...payload(), sessions: -1 }],
    ["sessions ทศนิยม", { ...payload(), sessions: 1.5 }],
    ["measured = null", { ...payload(), measured: null }],
    ["returning หาย", { sessions: 1, measured: 0 }],
  ] as [string, unknown][])("data = %s ⇒ ok:false ข้อความคงที่", async (_n, data) => {
    rpcMock.mockResolvedValue({ data, error: null });
    const r = await call({ from: "2026-10-05", to: "2026-11-03" });
    expect(r).toEqual({ ok: false, error: FIXED });
  });

  it.each(["22023", "42501", "57014", "PGRST301", "08006"])("RPC error code %s ⇒ ข้อความคงที่เหมือนกันหมด · log เฉพาะ code (ไม่มี message/details)", async (code) => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    rpcMock.mockResolvedValue({
      data: null,
      error: { code, message: "ring_size_stats: p_from ต้องไม่เกิน p_to user@example.com", details: "row (uuid) ...", hint: "secret-hint" },
    });
    const r = await call({ from: "2026-10-05", to: "2026-11-03" });
    expect(r).toEqual({ ok: false, error: FIXED });
    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).toContain(code);
    expect(logged).not.toMatch(/user@example|secret-hint|uuid|ต้องไม่เกิน/);
  });

  it("RPC ล้มเหลวด้วย throw (network/timeout) ⇒ ok:false ไม่ throw ขึ้นไป · log 'unknown'", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    rpcMock.mockRejectedValue(new TypeError("fetch failed https://udqmamplbymxnknkjnkz.supabase.co"));
    const r = await call({ from: "2026-10-05", to: "2026-11-03" });
    expect(r).toEqual({ ok: false, error: FIXED });
    expect(JSON.stringify(spy.mock.calls)).not.toMatch(/supabase\.co|fetch failed/);
  });

  it("ผลสำเร็จมี key เกิน (แถวดิบ/session id/เวลา/อีเมล) ⇒ ไม่ถึง client", async () => {
    rpcMock.mockResolvedValue({
      data: { ...payload(), rows: [{ id: "uuid-1", created_at: "2026-11-03T10:11:12Z" }], session_id: "sid", email: "a@b.co", created_at: "x" },
      error: null,
    });
    const r = await call({ from: "2026-10-05", to: "2026-11-03" });
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(/uuid-1|sid|a@b\.co|10:11:12|created_at|rows/);
  });
});
