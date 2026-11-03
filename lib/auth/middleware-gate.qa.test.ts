// lib/auth/middleware-gate.qa.test.ts — QA 3 พ.ย. 69: ล็อกมติ A-แคบ ฝั่ง middleware (ก่อนหน้านี้ไม่มีเทสต์พฤติกรรมของ middleware.ts เลย)
// มติ: middleware ยังฟัง AUTH_GATE === "on" เท่านั้น (ไม่ใช่ actionGateEnforced) — off = ไม่ redirect แม้บน deployment จริง
// ถ้าใครเอา actionGateEnforced/isRealDeployment ไปใส่ middleware (ตามข้อเสนอ A-เต็มเดิม) เทสต์กลุ่ม "gate off" จะล้ม = เปลี่ยนมติโดยไม่ตั้งใจ
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

let sessionUser: { id: string } | null = null;
let memberCount = 0;
const getUserMock = vi.fn(async () => ({ data: { user: sessionUser }, error: null }));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser: getUserMock } }),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({ eq: () => Promise.resolve({ count: memberCount, error: null }) }),
    }),
  }),
}));

const URL_BASE = "https://app.example.test";

async function call(path: string) {
  const { middleware } = await import("@/middleware");
  return middleware(new NextRequest(new URL(path, URL_BASE)));
}
/** NextResponse.next() ไม่มี location; redirect มี 307 + location */
const locationOf = (r: Response) => r.headers.get("location");

beforeEach(() => {
  sessionUser = null;
  memberCount = 0;
  getUserMock.mockClear();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.example.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-test-key");
  vi.stubEnv("SUPABASE_URL", "https://supabase.example.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-test-key");
  vi.stubEnv("VERCEL_ENV", undefined);
  vi.stubEnv("AUTH_GATE", undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe("middleware — AUTH_GATE off/unset: ไม่ redirect เลย แม้บน deployment จริง (มติ A-แคบ: ชั้น action เป็นคนปฏิเสธ)", () => {
  const cases: [string, string | undefined][] = [
    ["production", undefined],
    ["production", "off"],
    ["preview", "off"],
    [undefined as unknown as string, undefined], // local
  ];
  it.each(cases)("VERCEL_ENV=%s AUTH_GATE=%j + no session + /orders -> pass-through (ไม่มี location)", async (vercel, gate) => {
    vi.stubEnv("VERCEL_ENV", vercel);
    vi.stubEnv("AUTH_GATE", gate);
    const r = await call("/orders");
    expect(locationOf(r)).toBeNull();
    expect(r.status).toBe(200);
  });

  it.each(["ON", "true", "1", " on", "yes"])('AUTH_GATE=%j (ไม่ใช่ "on" เป๊ะ) -> ถือว่า off, ไม่ redirect', async (gate) => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("AUTH_GATE", gate);
    const r = await call("/orders");
    expect(locationOf(r)).toBeNull();
  });

  it("gate off: ยัง refresh session (เรียก getUser) แต่ไม่ branch ตามผล", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    sessionUser = { id: "u1" };
    memberCount = 0; // session ไม่มี member — gate on จะเด้ง /pending
    const r = await call("/orders");
    expect(getUserMock).toHaveBeenCalled();
    expect(locationOf(r)).toBeNull();
  });
});

describe("middleware — AUTH_GATE=on: ด่านเดิมยังทำงาน (ต้องไม่พัง)", () => {
  beforeEach(() => vi.stubEnv("AUTH_GATE", "on"));

  it("no session + /orders?x=1 -> 307 /login?next=%2Forders%3Fx%3D1", async () => {
    const r = await call("/orders?x=1");
    expect(r.status).toBe(307);
    const loc = new URL(locationOf(r)!);
    expect(loc.pathname).toBe("/login");
    expect(loc.searchParams.get("next")).toBe("/orders?x=1");
  });

  it("no session + /login -> เข้าได้ (ไม่ loop)", async () => {
    const r = await call("/login");
    expect(locationOf(r)).toBeNull();
  });

  it("session ไม่มี member + /orders -> /pending", async () => {
    sessionUser = { id: "u-pending" };
    memberCount = 0;
    const r = await call("/orders");
    expect(new URL(locationOf(r)!).pathname).toBe("/pending");
  });

  it("session + member + /orders -> ผ่าน · /login -> /dashboard", async () => {
    sessionUser = { id: "u-member" };
    memberCount = 1;
    expect(locationOf(await call("/orders"))).toBeNull();
    expect(new URL(locationOf(await call("/login"))!).pathname).toBe("/dashboard");
  });

  it("POST-style route ไม่มี session ก็โดนเด้งเหมือน GET (ไม่ branch ตาม method)", async () => {
    const { middleware } = await import("@/middleware");
    const r = await middleware(new NextRequest(new URL("/orders", URL_BASE), { method: "POST" }));
    expect(new URL(locationOf(r)!).pathname).toBe("/login");
  });

  it("anon key หาย + gate on -> 503 (fail closed ไม่ใช่เปิดโล่ง)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    const r = await call("/orders");
    expect(r.status).toBe(503);
  });
});

describe("middleware — ข้อจำกัดที่รู้ตัว (documented, ไม่ใช่บั๊กใหม่)", () => {
  it("gate off + anon key หาย -> pass-through (fail-open ตั้งแต่ A1) — ชั้น action ยังปฏิเสธ แต่หน้าไม่เด้ง", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    const r = await call("/orders");
    expect(r.status).toBe(200);
    expect(locationOf(r)).toBeNull();
  });
});
