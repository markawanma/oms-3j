// security H1: issueShopIntakeToken ประกอบ URL + SVG ที่ server จาก APP_ORIGIN (production เท่านั้น) — ก่อนเรียก RPC (ล้ม = ไม่เพิกถอนของเดิม)
// ห้ามผ่าน: ไม่ตั้ง APP_ORIGIN (ถอยไปใช้ Host) · VERCEL_ENV=preview/development · NODE_ENV ไม่ใช่ production บนเครื่อง dev · APP_ORIGIN ผิดรูป · Host ปลอมที่ชี้ preview
// ต้องไม่พัง: production + APP_ORIGIN ถูก → ออกได้ QR ชี้ APP_ORIGIN/w/s/<token> · ไม่คืน token ดิบ · warning ส่งต่อ (host ไม่ตรง)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SHOP = "a7c850ee-6776-4c3e-ba72-ba9e8caba2b7";
const USER = "99999999-9999-4999-8999-999999999999";
const RAW = "Zz9-_xYz0123456789AbCdEfGhIjKlMnOpQrStUvWx9";

const rpcMock = vi.fn();
let hostHeader: string | null = null;
vi.mock("@/lib/auth/role", () => ({ getEffectiveRole: () => Promise.resolve("owner") }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: () => Promise.resolve({ id: USER }), requireSessionIfGateOn: () => Promise.resolve() }));
vi.mock("@/lib/dev/context", () => ({ getDevShopId: () => SHOP }));
vi.mock("@/lib/supabase/server", () => ({ getServiceClient: () => ({ schema: () => ({ rpc: rpcMock, from: () => ({}) }) }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => ({ get: (n: string) => (n.toLowerCase() === "host" || n.toLowerCase() === "x-forwarded-host" ? hostHeader : null) }) }));
const rendered: string[] = [];
vi.mock("@/lib/jobs/qr", async (orig) => {
  const m = await orig<typeof import("@/lib/jobs/qr")>();
  return { ...m, renderQrSvg: (t: string) => (rendered.push(t), m.renderQrSvg(t)) };
});

import { issueShopIntakeToken } from "./job-workers";

const KEYS = ["APP_ORIGIN", "VERCEL_ENV", "NODE_ENV"] as const;
const env0: Record<string, string | undefined> = {};
const set = (o: Partial<Record<(typeof KEYS)[number], string | undefined>>) => {
  for (const k of KEYS) {
    const v = k in o ? o[k] : process.env[k];
    if (v === undefined) delete (process.env as Record<string, string | undefined>)[k];
    else (process.env as Record<string, string | undefined>)[k] = v;
  }
};

beforeEach(() => {
  for (const k of KEYS) env0[k] = process.env[k];
  vi.clearAllMocks();
  rendered.length = 0;
  hostHeader = "app.example.test";
  rpcMock.mockResolvedValue({ data: { token: RAW, issued_at: "2026-10-21T03:00:00Z", revoked_previous: 1 }, error: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  for (const k of KEYS) {
    if (env0[k] === undefined) delete (process.env as Record<string, string | undefined>)[k];
    else (process.env as Record<string, string | undefined>)[k] = env0[k];
  }
});

const REFUSE = "ออก QR ร้านได้เฉพาะที่ app.3jthailand.com";

describe("ห้ามผ่าน — ไม่เรียก RPC (ไม่เพิกถอนของเดิม) ไม่ render QR", () => {
  const cases: [string, () => void][] = [
    ["ไม่ตั้ง APP_ORIGIN (ถอยไปใช้ Host) แม้ production", () => set({ APP_ORIGIN: undefined, VERCEL_ENV: "production" })],
    ["APP_ORIGIN ว่าง", () => set({ APP_ORIGIN: "  ", VERCEL_ENV: "production" })],
    ["VERCEL_ENV = preview", () => set({ APP_ORIGIN: "https://app.example.test", VERCEL_ENV: "preview" })],
    ["VERCEL_ENV = development", () => set({ APP_ORIGIN: "https://app.example.test", VERCEL_ENV: "development" })],
    ["ไม่ใช่ Vercel + NODE_ENV = development", () => set({ APP_ORIGIN: "https://app.example.test", VERCEL_ENV: undefined, NODE_ENV: "development" })],
  ];
  it.each(cases)("%s", async (_n, setup) => {
    setup();
    const r = await issueShopIntakeToken();
    expect(r).toEqual({ ok: false, error: REFUSE });
    expect(rpcMock).not.toHaveBeenCalled();
    expect(rendered).toHaveLength(0);
  });

  it("APP_ORIGIN ผิดรูป (มี path / ท้าย /) → ปฏิเสธด้วยข้อความ origin เดิม · ไม่เรียก RPC", async () => {
    for (const bad of ["https://app.example.test/", "https://app.example.test/x", "ftp://x.test", "app.example.test"]) {
      set({ APP_ORIGIN: bad, VERCEL_ENV: "production" });
      const r = await issueShopIntakeToken();
      expect(r.ok, bad).toBe(false);
      expect(rpcMock).not.toHaveBeenCalled();
    }
  });

  it("Host ปลอม/เป็น preview ไม่มีผลต่อ origin ใน QR (ใช้ APP_ORIGIN เสมอ)", async () => {
    set({ APP_ORIGIN: "https://app.example.test", VERCEL_ENV: "production" });
    hostHeader = "evil-preview-git-x-3j.vercel.app";
    const r = await issueShopIntakeToken();
    expect(r.ok).toBe(true);
    expect(rendered).toEqual([`https://app.example.test/w/s/${RAW}`]);
    // host ที่เปิดหน้าไม่ตรง APP_ORIGIN → มี warning ส่งต่อให้การ์ดเตือน
    if (r.ok) expect(r.data.warning).toContain("preview");
  });
});

describe("ต้องไม่พัง — production + APP_ORIGIN", () => {
  it("ออกได้: QR ชี้ APP_ORIGIN/w/s/<token> · คืน svg ไม่คืน token · เรียก RPC ครั้งเดียว", async () => {
    set({ APP_ORIGIN: "https://app.example.test", VERCEL_ENV: "production" });
    const r = await issueShopIntakeToken();
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rendered).toEqual([`https://app.example.test/w/s/${RAW}`]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.svg.startsWith("<svg")).toBe(true);
      expect(r.data).toMatchObject({ issuedAt: "2026-10-21T03:00:00Z", revokedPrevious: 1, warning: null });
    }
    expect(JSON.stringify(r)).not.toContain(RAW);
  });

  it("ไม่ใช่ Vercel แต่ next start NODE_ENV=production + APP_ORIGIN = production ที่ติดตั้งเอง → ออกได้", async () => {
    set({ APP_ORIGIN: "https://app.example.test", VERCEL_ENV: undefined, NODE_ENV: "production" });
    expect((await issueShopIntakeToken()).ok).toBe(true);
  });

  it("RPC ล้ม → ผลล้ม ไม่มี svg (ไม่ render)", async () => {
    set({ APP_ORIGIN: "https://app.example.test", VERCEL_ENV: "production" });
    rpcMock.mockResolvedValue({ data: null, error: { code: "42501", message: "denied" } });
    const r = await issueShopIntakeToken();
    expect(r.ok).toBe(false);
    expect(rendered).toHaveLength(0);
  });
});
