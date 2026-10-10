// L3: ด่านสิทธิ์ของหน้าสายงาน content เป็น allowlist owner|admin — role แปลกไม่ผ่าน · ทุกหน้าใช้ตัวเดียวกัน (กันลืมหน้าใหม่)
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const getEffectiveRoleMock = vi.fn();
vi.mock("@/lib/auth/role", () => ({ getEffectiveRole: () => getEffectiveRoleMock() }));

import { canUseContentWorkflow } from "./page-gate";

beforeEach(() => vi.clearAllMocks());

describe("canUseContentWorkflow", () => {
  it("owner / admin ผ่าน", async () => {
    for (const r of ["owner", "admin"]) {
      getEffectiveRoleMock.mockResolvedValue(r);
      expect(await canUseContentWorkflow()).toBe(true);
    }
  });
  it("ห้ามผ่าน: staff · viewer · role อนาคต · ว่าง · undefined · ตัวพิมพ์ต่าง", async () => {
    for (const r of ["staff", "viewer", "manager", "", undefined, null, "Owner", "ADMIN", "owner "]) {
      getEffectiveRoleMock.mockResolvedValue(r);
      expect(await canUseContentWorkflow(), String(r)).toBe(false);
    }
  });
});

describe("ทุกหน้าสายงาน content ใช้ด่าน allowlist ตัวเดียว", () => {
  const PAGES = ["(inbox)/page.tsx", "calendar/page.tsx", "pieces/(list)/page.tsx", "pieces/[stepId]/page.tsx", "posts/page.tsx", "questions/page.tsx", "research/page.tsx", "research/capture/page.tsx", "shoot/page.tsx", "triage/page.tsx"];
  for (const f of PAGES) {
    it(f, () => {
      const src = readFileSync(join(process.cwd(), "app", "(dashboard)", "marketing", f), "utf8");
      expect(src).toContain("canUseContentWorkflow()");
      expect(src).not.toMatch(/===\s*"staff"/); // ด่านแบบ blacklist ปล่อย role แปลกผ่าน
    });
  }
});
