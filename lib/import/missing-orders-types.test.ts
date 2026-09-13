// lib/import/missing-orders-types.test.ts
//
// Unit tests for the pure helpers in lib/import/missing-orders-types.ts
// (cancel-detection Phase 1). Written by QA (R2-D2), 13 ก.ย. 69, per task
// brief step 5 — "isMissingOrdersWriteDisabledError() string-match ตรงกับ
// ข้อความจริงของ requireMissingOrdersWriteEnabled() ใน backend — จุดนี้ Luke
// เตือนเองว่าเปราะ".
//
// NOT covered here (documented gap, see final QA report): blockedReasonMessage()
// in components/domain/crm/MissingOrdersPanel.tsx is a module-private function
// (not exported) — QA is not permitted to edit components/ to export it for
// testing, and this repo has no @testing-library/react / jsdom setup to render
// the component instead. Verified by static code review only: its switch
// statement covers all 8 MissingOrdersBlockedReason values (including
// `default`), cross-checked against the type's own doc comment.

import { describe, expect, it } from "vitest";
import { isMissingOrdersWriteDisabledError, MISSING_ORDERS_WRITE_DISABLED_PREFIX } from "./missing-orders-types";

// Hardcoded, byte-for-byte copy of the error string
// lib/actions/import-missing-orders.ts's requireMissingOrdersWriteEnabled()
// actually returns (see that file, line ~70). This is intentionally a
// SEPARATE literal from MISSING_ORDERS_WRITE_DISABLED_PREFIX (not imported
// from the action, since "use server" files can only export async
// functions — see that file's own header) — the whole point of this test is
// to catch the two ever drifting apart from each other independently.
const REAL_BACKEND_WRITE_DISABLED_MESSAGE =
  "ระบบลบ/กู้คืนออเดอร์ยังปิดอยู่ (เปิดได้หลัง Auth A2 หรือเจ้าของสั่งเปิด)";

describe("isMissingOrdersWriteDisabledError — must catch", () => {
  it("matches the real backend message verbatim", () => {
    expect(isMissingOrdersWriteDisabledError(REAL_BACKEND_WRITE_DISABLED_MESSAGE)).toBe(true);
  });

  it("matches the prefix constant alone (exact)", () => {
    expect(isMissingOrdersWriteDisabledError(MISSING_ORDERS_WRITE_DISABLED_PREFIX)).toBe(true);
  });

  it("still matches if the backend appends a different parenthetical later", () => {
    // startsWith, not exact-equals — the parenthetical explanation is allowed
    // to change wording without breaking this fallback, only the leading
    // Thai sentence is load-bearing.
    expect(isMissingOrdersWriteDisabledError("ระบบลบ/กู้คืนออเดอร์ยังปิดอยู่ (เหตุผลใหม่)")).toBe(true);
  });
});

describe("isMissingOrdersWriteDisabledError — must not break / must not false-positive", () => {
  it("empty string -> false", () => {
    expect(isMissingOrdersWriteDisabledError("")).toBe(false);
  });

  it("unrelated action error -> false (e.g. deleteMissingOrders' own validation errors)", () => {
    expect(isMissingOrdersWriteDisabledError("กรุณาระบุเหตุผลก่อนลบ")).toBe(false);
    expect(isMissingOrdersWriteDisabledError("กรุณาเลือกอย่างน้อย 1 ออเดอร์ที่จะลบ")).toBe(false);
    expect(
      isMissingOrdersWriteDisabledError(
        "ลบออเดอร์ไม่สำเร็จ — รายการที่เลือกอาจไม่ตรงกับที่ระบบตรวจล่าสุดแล้ว (มีการนำเข้าไฟล์ใหม่ระหว่างนี้) ลองกดตรวจซ้ำแล้วลองใหม่"
      )
    ).toBe(false);
  });

  it("prefix present but NOT at the start -> false (startsWith semantics, not includes)", () => {
    expect(isMissingOrdersWriteDisabledError(`คำเตือน: ${MISSING_ORDERS_WRITE_DISABLED_PREFIX}`)).toBe(false);
  });

  it("prefix with different trailing punctuation/whitespace still matches (startsWith)", () => {
    expect(isMissingOrdersWriteDisabledError(`${MISSING_ORDERS_WRITE_DISABLED_PREFIX}!!!`)).toBe(true);
  });

  it("case/character-for-character near-miss (one character short) -> false", () => {
    const truncated = MISSING_ORDERS_WRITE_DISABLED_PREFIX.slice(0, -1);
    // The truncated prefix does NOT start with the FULL prefix constant, so
    // this must be false — guards against a future edit silently shortening
    // the constant without anyone noticing the fallback got looser.
    expect(isMissingOrdersWriteDisabledError(truncated)).toBe(false);
  });
});
