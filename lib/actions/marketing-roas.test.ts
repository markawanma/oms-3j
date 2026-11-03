// lib/actions/marketing-roas.test.ts — getChannelRoas (security H2 + L2, 3 พ.ย. 69)
// H2: break_even_roas = 1/blended_margin_pct, target_roas เปิด target_ad_gp_share ⇒ owner/admin เท่านั้น (ด่าน role ครอบใน member-guard.test.ts)
// ไฟล์นี้ล็อก L2: เมื่อ query ล้ม ต้อง log เฉพาะ code + message ที่ redact URL — ห้ามโยน error object ทั้งก้อน (supabase-error-logging-trap)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const roleMock = vi.fn();
let queryResult: { data: unknown; error: unknown } = { data: [], error: null };

function chain(): unknown {
  const p: unknown = new Proxy(function () {}, {
    get: (_t, k) => {
      if (k === "then") return (res: (v: unknown) => unknown) => res(queryResult);
      return () => p;
    },
    apply: () => p,
  });
  return p;
}

vi.mock("@/lib/auth/action-guard", () => ({ denyIfNotMember: async () => null }));
vi.mock("@/lib/auth/role", () => ({ getEffectiveRole: () => roleMock() }));
vi.mock("@/lib/dev/context", () => ({ getDevShopId: () => "shop-1" }));
vi.mock("@/lib/supabase/server", () => ({ getServiceClient: () => ({ schema: () => ({ from: () => chain() }) }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { getChannelRoas } from "./marketing";

let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  roleMock.mockResolvedValue("owner");
  queryResult = { data: [], error: null };
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => errSpy.mockRestore());

describe("getChannelRoas — log ปลอดภัย (L2)", () => {
  it("query ล้ม -> ข้อความคงที่ถึงผู้ใช้ · log เฉพาะ code + message redact URL ไม่มี details/stack/host", async () => {
    queryResult = {
      data: null,
      error: {
        code: "57014",
        message: "timeout calling https://abc.supabase.co/rest/v1/x?token=secret",
        details: "Caused by: Error: getaddrinfo ENOTFOUND abc.supabase.co\n    at stack...",
        hint: "h",
      },
    };
    const r = await getChannelRoas();
    expect(r).toEqual({ ok: false, error: "โหลดข้อมูล ROAS ไม่สำเร็จ ลองใหม่อีกครั้ง" });

    expect(errSpy).toHaveBeenCalledTimes(1);
    const args = errSpy.mock.calls[0];
    expect(args[0]).toBe("getChannelRoas failed");
    expect(args[1]).toEqual({ code: "57014", message: "timeout calling <url>" });
    const logged = JSON.stringify(args);
    expect(logged).not.toContain("supabase.co");
    expect(logged).not.toContain("getaddrinfo");
    expect(logged).not.toContain("secret");
  });

  it("ต้องไม่พัง: owner อ่านได้ตามปกติ (ไม่ log)", async () => {
    const r = await getChannelRoas();
    expect(r).toEqual({ ok: true, data: [] });
    expect(errSpy).not.toHaveBeenCalled();
  });
});
