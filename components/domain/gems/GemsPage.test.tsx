// @vitest-environment jsdom
// หน้า /oem/gems (server component): staff = จำกัดสิทธิ์ + ไม่เรียก action ราคา · error = ErrorState (ไม่รั่วข้อความดิบ) · สำเร็จ = แคตตาล็อก · ?tab= ปลอดภัย · loading.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

afterEach(cleanup);

const role = vi.fn(); // = canManageJobs()
const catalog = vi.fn();
// ด่านสิทธิ์ = canManageJobs (owner|admin allowlist — ทดสอบตัวมันเองที่ lib/jobs/page-gate.test.ts)
vi.mock("@/lib/jobs/page-gate", () => ({ canManageJobs: () => role() }));
vi.mock("@/lib/actions/gems", () => ({ getGemCatalog: (...a: unknown[]) => catalog(...a) }));
vi.mock("@/components/domain/gems/GemCatalogClient", () => ({
  GemCatalogClient: ({ catalog: c, initialTab, todayBkk }: { catalog: { items: unknown[] }; initialTab: string; todayBkk: string }) => (
    <div data-testid="catalog" data-tab={initialTab} data-today={todayBkk}>
      {c.items.length}
    </div>
  ),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/oem/gems", useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));

import OemGemsPage from "../../../app/(dashboard)/oem/gems/page";
import OemGemsLoading from "../../../app/(dashboard)/oem/gems/loading";

const renderPage = async (sp?: { tab?: string | string[] }) => render(await OemGemsPage({ searchParams: sp ? Promise.resolve(sp) : undefined }));

beforeEach(() => {
  vi.clearAllMocks();
  role.mockResolvedValue(true);
  catalog.mockResolvedValue({ ok: true, data: { types: [], shapes: [], items: [1, 2, 3] } });
});

describe("หน้า /oem/gems", () => {
  it("owner/admin: เรียก getGemCatalog(includeInactive=true) แล้วแสดงแคตตาล็อก พร้อมวันนี้ไทย", async () => {
    await renderPage();
    expect(screen.getByTestId("catalog")).toHaveTextContent("3");
    expect(catalog).toHaveBeenCalledWith(true);
    expect(screen.getByTestId("catalog").getAttribute("data-today")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("🔴 canManageJobs=false (staff · role แปลก · ไม่มี session): 'หน้านี้จำกัดสิทธิ์' และไม่เรียก action แคตตาล็อก/ราคาเลย", async () => {
    role.mockResolvedValue(false);
    await renderPage();
    expect(screen.getByText("หน้านี้จำกัดสิทธิ์")).toBeInTheDocument();
    expect(catalog).not.toHaveBeenCalled();
    expect(screen.queryByTestId("catalog")).not.toBeInTheDocument();
  });
  it("action ตอบ error = ErrorState · action throw = ข้อความกลาง ไม่รั่วข้อความดิบ", async () => {
    catalog.mockResolvedValue({ ok: false, error: "โหลดไม่ได้" });
    await renderPage();
    expect(screen.getByRole("alert")).toHaveTextContent("โหลดไม่ได้");
    cleanup();
    catalog.mockRejectedValue(new Error("password=hunter2"));
    await renderPage();
    expect(screen.getByRole("alert")).toHaveTextContent("โหลดแคตตาล็อกพลอยไม่สำเร็จ");
    expect(document.body.textContent).not.toContain("hunter2");
  });
  it("?tab=: types/shapes ผ่าน · ค่าอื่น/แปลก = รายการพลอย · array ใช้ตัวแรก", async () => {
    await renderPage({ tab: "shapes" });
    expect(screen.getByTestId("catalog").getAttribute("data-tab")).toBe("shapes");
    cleanup();
    await renderPage({ tab: "<script>" });
    expect(screen.getByTestId("catalog").getAttribute("data-tab")).toBe("items");
    cleanup();
    await renderPage({ tab: ["types", "shapes"] });
    expect(screen.getByTestId("catalog").getAttribute("data-tab")).toBe("types");
  });
  it("loading.tsx: role=status", () => {
    render(<OemGemsLoading />);
    expect(screen.getByRole("status", { name: "กำลังโหลดแคตตาล็อกพลอย" })).toBeInTheDocument();
  });
});