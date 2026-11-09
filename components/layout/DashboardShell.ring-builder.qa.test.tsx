// @vitest-environment jsdom
// QA (R2-D2) 10 พ.ย. 69 — regression ของ DashboardShell หลังเพิ่ม ownerAdminOnly: เมนูใหม่ต้องไม่กระทบ role อื่น/เมนูอื่น
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

afterEach(cleanup);

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));
vi.mock("next/link", () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));
vi.mock("@/lib/actions/auth", () => ({ signOut: vi.fn() }));

import { DashboardShell } from "@/components/layout/DashboardShell";

const NEW = "/catalog/ring-builder";
const links = (role: "owner" | "admin" | "staff" | null | undefined) => {
  render(
    <DashboardShell role={role}>
      <p>x</p>
    </DashboardShell>,
  );
  return within(screen.getAllByRole("navigation", { name: "เมนูหลัก" })[0]).queryAllByRole("link").map((a) => a.getAttribute("href"));
};

describe("DashboardShell — เมนู ring builder ไม่กระทบ role อื่น", () => {
  it("role แปลก ('superuser' / '') ที่ไม่ใช่ owner/admin → ซ่อนเมนูใหม่ (allowlist ไม่ใช่ denylist)", () => {
    expect(links("superuser" as never)).not.toContain(NEW);
    cleanup();
    expect(links("" as never)).not.toContain(NEW);
  });
  it("role = null (ไม่มี session จริง/DEV flow) → ยังแสดงเหมือนเมนูอื่น (พฤติกรรมเดิมของกลุ่มเมนู) — ด่านจริงอยู่ที่หน้า/action", () => {
    expect(links(null)).toContain(NEW);
  });
  it("เมนูเดิมของ staff ครบเท่าเดิม: ต่างจาก owner เฉพาะ 'ออกแบบแหวน' (+ กลุ่มใบงาน/สมาชิกที่ซ่อนอยู่เดิม)", () => {
    const staff = links("staff");
    cleanup();
    const admin = links("admin");
    const onlyAdmin = admin.filter((h) => !staff.includes(h));
    expect(onlyAdmin).toContain(NEW);
    // ทุกลิงก์ที่ staff เห็น admin ต้องเห็นด้วย (ไม่มีเมนูเดิมหายจาก staff เพราะการ filter ใหม่)
    expect(staff.every((h) => admin.includes(h))).toBe(true);
    // เมนูเดิมในหมวดเดียวกันของ staff ยังอยู่
    for (const h of ["/settings", "/oem/rates", "/oem/gems", "/oem/quote", "/oem/quotes"]) expect(staff, h).toContain(h);
  });
  it("owner เห็นเมนูใหม่ + 'สมาชิก' (กลุ่มทีมเดิมไม่หาย)", () => {
    const owner = links("owner");
    expect(owner).toContain(NEW);
    expect(owner).toContain("/settings/members");
  });
  it("เมนูใหม่ปรากฏครั้งเดียวต่อ sidebar (ไม่ซ้ำ)", () => {
    const owner = links("owner");
    expect(owner.filter((h) => h === NEW)).toHaveLength(1);
  });
});
