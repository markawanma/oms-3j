// @vitest-environment jsdom
// เมนูข้าง: "แคตตาล็อกพลอย" (/oem/gems) อยู่ใต้ "ต้นทุน & ตั้งค่า" ต่อจาก "ต้นทุน OEM" · active เมื่ออยู่ในหน้านั้น (ไม่ชน /oem/rates)
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

afterEach(cleanup);

let mockPath = "/dashboard";
vi.mock("next/navigation", () => ({ usePathname: () => mockPath }));
vi.mock("next/link", () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));
vi.mock("@/lib/actions/auth", () => ({ signOut: vi.fn() }));

import { DashboardShell } from "./DashboardShell";

const sidebar = () => within(screen.getAllByRole("navigation", { name: "เมนูหลัก" })[0]);

describe("เมนู 'แคตตาล็อกพลอย'", () => {
  it("อยู่ใต้ 'ต้นทุน & ตั้งค่า' ต่อจาก 'ต้นทุน OEM' ลิงก์ /oem/gems", () => {
    mockPath = "/dashboard";
    render(
      <DashboardShell role="admin">
        <p>x</p>
      </DashboardShell>,
    );
    const links = sidebar().getAllByRole("link").map((a) => a.getAttribute("href"));
    const i = links.indexOf("/oem/rates");
    expect(links[i + 1]).toBe("/oem/gems");
    expect(sidebar().getByRole("link", { name: "แคตตาล็อกพลอย" })).toHaveAttribute("href", "/oem/gems");
  });
  it("อยู่ที่ /oem/gems: ไฮไลต์เฉพาะแคตตาล็อกพลอย (aria-current) ไม่ใช่ต้นทุน OEM", () => {
    mockPath = "/oem/gems";
    render(
      <DashboardShell role="owner">
        <p>x</p>
      </DashboardShell>,
    );
    expect(sidebar().getByRole("link", { name: "แคตตาล็อกพลอย" })).toHaveAttribute("aria-current", "page");
    expect(sidebar().getByRole("link", { name: "ต้นทุน OEM" })).not.toHaveAttribute("aria-current");
  });
});
