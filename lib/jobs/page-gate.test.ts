// ด่านสิทธิ์หน้าออฟฟิศ (ใช้กับ /jobs/* และ /oem/gems — ราคาพลอย = ต้นทุน): allowlist owner|admin เท่านั้น
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const role = vi.fn();
vi.mock("@/lib/auth/role", () => ({ getEffectiveRole: () => role() }));

import { canManageJobs } from "@/lib/jobs/page-gate";

beforeEach(() => vi.clearAllMocks());

describe("canManageJobs", () => {
  for (const r of ["owner", "admin"]) {
    it(`${r} ผ่าน`, async () => {
      role.mockResolvedValue(r);
      expect(await canManageJobs()).toBe(true);
    });
  }
  // บทเรียน security P1b L3: เดิมเช็ค "ไม่ใช่ staff" ซึ่งปล่อย role แปลก/อนาคตผ่าน
  for (const r of ["staff", "viewer", "superadmin", "Owner", "ADMIN", "", null, undefined, 0, {}]) {
    it(`${JSON.stringify(r) ?? String(r)} ไม่ผ่าน`, async () => {
      role.mockResolvedValue(r);
      expect(await canManageJobs()).toBe(false);
    });
  }
});
