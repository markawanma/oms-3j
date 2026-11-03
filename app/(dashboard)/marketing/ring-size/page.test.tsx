// @vitest-environment jsdom
// app/(dashboard)/marketing/ring-size/page.test.tsx — server page ของ /marketing/ring-size
//
// เรียกฟังก์ชันของ page ตรงๆ แล้วตรวจ element ที่คืน (ไม่ render) — พิสูจน์:
//   เคส 1/2 staff · ไม่ใช่สมาชิก (role = staff) ⇒ ไม่เรียก action/RPC เลย · เคส 3 searchParams ขยะ ⇒ ค่าเริ่มต้น/แจ้ง ไม่ crash
//   เคส 4 shop id ไม่รับจาก URL · เคส 6 ไม่ log ก้อน error · วันไทย: to = วันนี้ตามเวลาไทยแม้ UTC ยังเป็นเมื่อวาน
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkRingStatsRange } from "@/lib/marketing/ring-size-filters";

const getEffectiveRoleMock = vi.fn();
const getDevShopIdMock = vi.fn();
const getRingSizeStatsMock = vi.fn();

vi.mock("@/lib/auth/role", () => ({ getEffectiveRole: () => getEffectiveRoleMock() }));
vi.mock("@/lib/dev/context", () => ({ getDevShopId: () => getDevShopIdMock() }));
vi.mock("@/lib/actions/ring-size-stats", () => ({ getRingSizeStats: (input: unknown) => getRingSizeStatsMock(input) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { RingSizeStats } from "@/components/domain/marketing/RingSizeStats";
import RingSizeStatsPage, { dynamic } from "./page";

type Props = Record<string, unknown>;
const ok = { ok: true as const, data: { sessions: 0 } };

async function render(sp: Record<string, string | string[] | undefined> = {}) {
  const el = (await RingSizeStatsPage({ searchParams: Promise.resolve(sp) })) as { type: unknown; props: Props };
  return el;
}

let errSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-03T05:00:00Z")); // ไทย 12:00 วันที่ 3
  getEffectiveRoleMock.mockResolvedValue("owner");
  getDevShopIdMock.mockReturnValue("shop-from-env");
  getRingSizeStatsMock.mockResolvedValue(ok);
  errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("เคส 1/2 — staff (รวมไม่ล็อกอิน/ไม่ใช่สมาชิกที่ role.ts ตีเป็น staff) ⇒ lock ก่อนเรียก action", () => {
  it("staff เห็น EmptyState 'หน้านี้จำกัดสิทธิ์' เหมือนหน้าเกมพลอย · ไม่เรียก action · ไม่แตะ shop id", async () => {
    getEffectiveRoleMock.mockResolvedValue("staff");
    const el = await render({ range: "7d" });
    expect(el.type).toBe(EmptyState);
    expect(el.props.title).toBe("หน้านี้จำกัดสิทธิ์");
    expect(el.props.description).toBe("เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ดูสถิติไซส์แหวนได้");
    expect(getRingSizeStatsMock).not.toHaveBeenCalled();
    expect(getDevShopIdMock).not.toHaveBeenCalled();
  });

  // security L1: ด่านเป็น allowlist — ค่า role อื่นทุกชนิดที่ไม่ใช่ owner/admin ต้องถูก lock (ไม่ใช่เฉพาะ "staff")
  it.each([[undefined], [null], ["viewer"], [""], ["OWNER"]])("role=%s (ไม่ใช่ owner/admin) ⇒ lock ไม่เรียก action", async (role) => {
    getEffectiveRoleMock.mockResolvedValue(role);
    const el = await render();
    expect(el.type).toBe(EmptyState);
    expect(getRingSizeStatsMock).not.toHaveBeenCalled();
    expect(getDevShopIdMock).not.toHaveBeenCalled();
  });

  it.each(["owner", "admin"])("%s ⇒ เรียก action", async (role) => {
    getEffectiveRoleMock.mockResolvedValue(role);
    const el = await render();
    expect(el.type).toBe(RingSizeStats);
    expect(getRingSizeStatsMock).toHaveBeenCalledTimes(1);
  });
});

describe("state: ตั้งค่าไม่ครบ", () => {
  it("getDevShopId throw ⇒ ErrorState ข้อความคงที่ (ไม่เผยชื่อ env) · ไม่เรียก action", async () => {
    getDevShopIdMock.mockImplementation(() => {
      throw new Error("DEV_SHOP_ID is not set. seed a shop (see docs/dev-seed.sql)");
    });
    const el = await render();
    expect(el.type).toBe(ErrorState);
    expect(String(el.props.message)).not.toMatch(/DEV_SHOP_ID|dev-seed|docs\//);
    expect(getRingSizeStatsMock).not.toHaveBeenCalled();
  });
});

describe("ค่าเริ่มต้น + วันไทย", () => {
  it("ไม่มี param ⇒ 30 วันล่าสุด จบที่วันนี้ตามเวลาไทย · ส่ง action แค่ {from,to}", async () => {
    const el = await render();
    expect(getRingSizeStatsMock).toHaveBeenCalledWith({ from: "2026-10-05", to: "2026-11-03" });
    expect(Object.keys(getRingSizeStatsMock.mock.calls[0][0] as object).sort()).toEqual(["from", "to"]);
    expect(el.props.filters).toEqual({ from: "2026-10-05", to: "2026-11-03", range: "30d" });
    expect(el.props.today).toBe("2026-11-03");
    expect(el.props.notices).toEqual([]);
  });

  it("UTC ยังเป็นเมื่อวาน (ไทย 00:00–07:00) ⇒ to = วันนี้แบบไทย", async () => {
    vi.setSystemTime(new Date("2026-11-02T18:30:00Z")); // ไทย 01:30 วันที่ 3
    await render({ range: "7d" });
    expect(getRingSizeStatsMock).toHaveBeenCalledWith({ from: "2026-10-28", to: "2026-11-03" });
    vi.setSystemTime(new Date("2026-11-02T16:59:00Z")); // ไทย 23:59 วันที่ 2
    await render({ range: "7d" });
    expect(getRingSizeStatsMock).toHaveBeenLastCalledWith({ from: "2026-10-27", to: "2026-11-02" });
  });

  it("chip 7/30/90/180 ⇒ ช่วงนับรวมวันนี้ถูกต้อง (ขอบ 7 วัน และ 180 วันพอดี ผ่านด่านเดียวกับ RPC)", async () => {
    for (const [range, days] of [["7d", 7], ["30d", 30], ["90d", 90], ["180d", 180]] as const) {
      getRingSizeStatsMock.mockClear();
      await render({ range });
      const input = getRingSizeStatsMock.mock.calls[0][0] as { from: string; to: string };
      expect(checkRingStatsRange(input.from, input.to)).toBeNull();
      const span = Math.round((Date.parse(input.to) - Date.parse(input.from)) / 86_400_000) + 1;
      expect(span).toBe(days);
    }
  });
});

describe("เคส 3 — searchParams ผิด/ขยะ ⇒ แปลงเป็นค่าที่ผ่านด่าน + แจ้ง ไม่ crash", () => {
  const junk: Record<string, string | string[] | undefined>[] = [
    { from: "2026-02-30", to: "2026-10-25" },
    { from: "2026-11-03", to: "2026-10-01" },
    { from: "2026-10-20", to: "2099-01-01" },
    { from: "2020-01-01", to: "2026-11-03" }, // เกิน 180 วัน
    { from: "2026-10-30", to: "2026-11-03" }, // สั้นกว่า 7 วัน
    { from: "infinity", to: "-infinity" },
    { range: "999d" },
    { range: ["7d", "30d"] },
    { from: ["2026-10-01", "2026-10-02"], to: "2026-11-03" },
    { from: "<script>alert(1)</script>", to: "'; drop table x;--" },
    { src: "LINE" },
    { src: "a b" },
    { src: "zzz", range: "7d" },
    { src: "x".repeat(300) },
    { from: "", to: "", range: "" },
  ];
  it.each(junk.map((j, i) => [i, JSON.stringify(j).slice(0, 60), j] as const))("#%i %s ⇒ action ได้ช่วงที่ผ่านด่านเสมอ", async (_i, _label, sp) => {
    getRingSizeStatsMock.mockClear();
    const el = await render(sp);
    expect(el.type).toBe(RingSizeStats);
    const input = getRingSizeStatsMock.mock.calls[0][0] as { from: string; to: string };
    expect(checkRingStatsRange(input.from, input.to)).toBeNull();
    expect(input.to <= "2026-11-03").toBe(true);
    expect(Object.keys(input).sort()).toEqual(["from", "to"]);
  });

  it("ค่าผิด ⇒ มี notice ให้เจ้าของรู้ (ไม่ปรับเงียบ)", async () => {
    const el = await render({ range: "999d" });
    expect((el.props.notices as string[]).length).toBe(1);
    const el2 = await render({ from: "2020-01-01", to: "2026-11-03" });
    expect((el2.props.notices as string[]).join(" ")).toMatch(/180 วัน/);
  });

  it("ช่วง 7 วันพอดี และ 180 วันพอดีแบบ from/to ⇒ ไม่ปรับ ไม่ notice", async () => {
    const seven = await render({ from: "2026-10-28", to: "2026-11-03" });
    expect(seven.props.notices).toEqual([]);
    const full = await render({ from: "2026-05-08", to: "2026-11-03" });
    expect(full.props.notices).toEqual([]);
    expect(full.props.filters).toEqual({ from: "2026-05-08", to: "2026-11-03", range: "custom" });
  });

  it("src= ถูกเพิกเฉย: ผลเหมือนไม่มี src ทุกประการ", async () => {
    const a = await render({ range: "90d", src: "line" });
    const b = await render({ range: "90d" });
    expect(a.props).toEqual(b.props);
    expect(JSON.stringify(a.props)).not.toContain("src");
  });
});

describe("เคส 4 — shop id ไม่รับจาก URL/client", () => {
  it("shop_id / shopId / p_shop_id ใน searchParams ไม่ถึง action", async () => {
    await render({ shop_id: "evil", shopId: "evil", p_shop_id: "evil", shop: "evil" } as Record<string, string>);
    const input = getRingSizeStatsMock.mock.calls[0][0];
    expect(JSON.stringify(input)).not.toContain("evil");
    expect(Object.keys(input as object).sort()).toEqual(["from", "to"]);
  });
});

describe("state: error ⇒ ส่งต่อให้ shell (แถบกรองรอด) · ไม่เผยข้อความดิบ · ไม่ log ก้อน error", () => {
  it("action คืน ok:false ⇒ ส่งต่อตามนั้น", async () => {
    getRingSizeStatsMock.mockResolvedValue({ ok: false, error: "โหลดสถิติไม่สำเร็จ ลองใหม่อีกครั้ง" });
    const el = await render();
    expect(el.type).toBe(RingSizeStats);
    expect(el.props.result).toEqual({ ok: false, error: "โหลดสถิติไม่สำเร็จ ลองใหม่อีกครั้ง" });
  });

  it("action throw (ไม่ควรเกิด) ⇒ ok:false ข้อความคงที่ · log เฉพาะ code ไม่มี message/PII", async () => {
    const PII = "somchai@example.com";
    getRingSizeStatsMock.mockRejectedValue({ code: "57014", message: `timeout ${PII}`, details: `DETAIL ${PII}` });
    const el = await render();
    expect(el.props.result).toEqual({ ok: false, error: "โหลดสถิติไม่สำเร็จ ลองใหม่อีกครั้ง" });
    const logged = JSON.stringify(errSpy.mock.calls);
    expect(logged).toContain("57014");
    expect(logged).not.toContain(PII);
    expect(logged).not.toContain("DETAIL");
    for (const args of errSpy.mock.calls as unknown[][]) for (const a of args) expect(typeof a).toBe("string");
  });

  it("throw ที่ไม่มี code ⇒ log 'unknown'", async () => {
    getRingSizeStatsMock.mockRejectedValue(new Error("boom"));
    await render();
    expect(JSON.stringify(errSpy.mock.calls)).toContain("unknown");
    expect(JSON.stringify(errSpy.mock.calls)).not.toContain("boom");
  });
});

describe("หน้า: force-dynamic (ข้อมูลสดทุกครั้ง)", () => {
  it("export dynamic = 'force-dynamic'", () => {
    expect(dynamic).toBe("force-dynamic");
  });
});
