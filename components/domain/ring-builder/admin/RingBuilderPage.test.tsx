// @vitest-environment jsdom
// หน้า /catalog/ring-builder (server component): ด่าน owner/admin (allowlist) · error ไม่รั่วข้อความดิบ · ?tab= ปลอดภัย · loading.tsx · เมนู
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

afterEach(cleanup);

const role = vi.fn();
const admin = vi.fn();
vi.mock("@/lib/auth/role", () => ({ getEffectiveRole: () => role() }));
vi.mock("@/lib/actions/ring-builder", () => ({ getRingBuilderAdmin: (...a: unknown[]) => admin(...a) }));
vi.mock("@/components/domain/ring-builder/admin/RingBuilderAdminClient", () => ({
  RingBuilderAdminClient: (p: { initial: unknown; initialError: string | null; initialTab: string }) => (
    <div data-testid="client" data-tab={p.initialTab} data-has={String(p.initial !== null)} data-err={p.initialError ?? ""} />
  ),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/catalog/ring-builder" }));
vi.mock("next/link", () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));
vi.mock("@/lib/actions/auth", () => ({ signOut: vi.fn() }));

import Page from "../../../../app/(dashboard)/catalog/ring-builder/page";
import Loading from "../../../../app/(dashboard)/catalog/ring-builder/loading";
import { DashboardShell } from "@/components/layout/DashboardShell";

const renderPage = async (sp?: { tab?: string | string[] }) => render(await Page({ searchParams: sp ? Promise.resolve(sp) : undefined }));

beforeEach(() => {
  vi.clearAllMocks();
  role.mockResolvedValue("owner");
  admin.mockResolvedValue({ ok: true, data: { shapes: [] } });
});

describe("หน้า /catalog/ring-builder", () => {
  it.each(["owner", "admin"])("%s: โหลดข้อมูลแล้วแสดง client", async (r) => {
    role.mockResolvedValue(r);
    await renderPage();
    expect(screen.getByTestId("client")).toHaveAttribute("data-has", "true");
    expect(admin).toHaveBeenCalledTimes(1);
  });
  it.each(["staff", undefined, null, "superuser"])("role=%s: จำกัดสิทธิ์ · ไม่เรียก action", async (r) => {
    role.mockResolvedValue(r);
    await renderPage();
    expect(screen.getByText("หน้านี้จำกัดสิทธิ์")).toBeInTheDocument();
    expect(admin).not.toHaveBeenCalled();
    expect(screen.queryByTestId("client")).not.toBeInTheDocument();
  });
  it("action ล้มเหลว → ส่ง error ให้ client (ไม่ crash)", async () => {
    admin.mockResolvedValue({ ok: false, error: "โหลดข้อมูลไม่สำเร็จ ลองใหม่อีกครั้ง" });
    await renderPage();
    expect(screen.getByTestId("client")).toHaveAttribute("data-has", "false");
    expect(screen.getByTestId("client")).toHaveAttribute("data-err", "โหลดข้อมูลไม่สำเร็จ ลองใหม่อีกครั้ง");
  });
  it("action throw → ข้อความกลาง ไม่สะท้อนข้อความดิบ", async () => {
    admin.mockRejectedValue(new Error("secret db detail"));
    await renderPage();
    expect(screen.getByTestId("client").getAttribute("data-err")).not.toContain("secret");
    expect(screen.getByTestId("client").getAttribute("data-err")).not.toBe("");
  });
  it.each([
    [undefined, "gems"], [{ tab: "designs" }, "designs"], [{ tab: "verify" }, "verify"], [{ tab: "<script>" }, "gems"], [{ tab: ["verify", "x"] }, "verify"],
  ])("?tab=%j → %s", async (sp, expected) => {
    await renderPage(sp as { tab?: string | string[] } | undefined);
    expect(screen.getByTestId("client")).toHaveAttribute("data-tab", expected);
  });
  it("loading.tsx แสดงสถานะโหลด", () => {
    render(<Loading />);
    expect(screen.getByRole("status", { name: "กำลังโหลดหลังบ้านออกแบบแหวน" })).toBeInTheDocument();
  });
});

describe("เมนูข้าง", () => {
  const sidebarLinks = () => within(screen.getAllByRole("navigation", { name: "เมนูหลัก" })[0]).queryAllByRole("link").map((a) => a.getAttribute("href"));
  it.each(["owner", "admin"] as const)("%s เห็น 'ออกแบบแหวน (ราคาขาย)'", (r) => {
    render(<DashboardShell role={r}><p>x</p></DashboardShell>);
    expect(sidebarLinks()).toContain("/catalog/ring-builder");
  });
  it("staff ไม่เห็น (แต่เมนูอื่นในหมวดยังเห็น)", () => {
    render(<DashboardShell role="staff"><p>x</p></DashboardShell>);
    expect(sidebarLinks()).not.toContain("/catalog/ring-builder");
    expect(sidebarLinks()).toContain("/oem/gems");
  });
  it("อยู่ที่หน้านี้: ไฮไลต์เฉพาะเมนูนี้ ไม่ใช่ 'สินค้า / ต้นทุน'", () => {
    render(<DashboardShell role="owner"><p>x</p></DashboardShell>);
    const nav = within(screen.getAllByRole("navigation", { name: "เมนูหลัก" })[0]);
    expect(nav.getByRole("link", { name: "ออกแบบแหวน (ราคาขาย)" })).toHaveAttribute("aria-current", "page");
    expect(nav.getByRole("link", { name: "สินค้า / ต้นทุน" })).not.toHaveAttribute("aria-current");
  });
});
