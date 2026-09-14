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
import {
  isMissingOrdersWriteDisabledError,
  mapMissingOrdersRpcError,
  MISSING_ORDERS_WRITE_DISABLED_PREFIX,
} from "./missing-orders-types";

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

// Backend-dev (Han Solo), 13 ก.ย. 69 — QA-1 fix, then C-3PO code review
// blocker fix same day. Message literals below are full,
// realistically-interpolated copies of the `raise exception` text in
// supabase/migrations/0115_import_delete_restore.sql (analytics.
// import_delete_orders / analytics.import_restore_orders), NOT just the
// bare needle substrings — the whole point is proving the match survives the
// function-name prefix and the %-formatted runtime values around it.
//
// C-3PO caught (with a fake-fetch repro against postgrest-js 2.112.3) that
// `supabase.rpc()` in this codebase is never chained with `.throwOnError()`,
// so the `error` deleteMissingOrders/restoreDeletedOrders `throw` is
// postgrest-js's raw parsed-JSON object — NOT a `PostgrestError` class
// instance (that class is only constructed when `shouldThrowOnError` is
// true). `mapMissingOrdersRpcError` takes `unknown` for exactly this reason
// — `pgError()` below builds the REAL shape (plain object, `instanceof Error`
// === false) instead of a bare string, so these tests would have caught the
// original 1-arg/instanceof-Error version being dead code on every real call.
function pgError(message: string): { code: string; details: null; hint: null; message: string } {
  return { code: "P0001", details: null, hint: null, message };
}

const FALLBACK = "ข้อความกลางเดิม (ตัวอย่างในเทสต์)";

describe("mapMissingOrdersRpcError — must map to specific Thai copy", () => {
  it("import_restore_orders: already restored / belongs to another shop", () => {
    const err = pgError(
      "import_restore_orders: deleted-order record 11111111-1111-1111-1111-111111111111 not found " +
        "(already restored, or belongs to another shop) — refusing the whole request, nothing was restored"
    );
    expect(mapMissingOrdersRpcError(err, FALLBACK)).toBe(
      "กู้คืนไปแล้ว (อาจกดจากอีกแท็บ) — รีเฟรชหน้าแล้วดูรายการใหม่"
    );
  });

  it("import_restore_orders: live order already exists for source_order_no (Shipnity reuse)", () => {
    const err = pgError(
      "import_restore_orders: a live order already exists for source_order_no ORD-123 " +
        "(id 22222222-2222-2222-2222-222222222222) — Shipnity may have reused this number for a new sale; " +
        "refusing the whole request, nothing was restored"
    );
    expect(mapMissingOrdersRpcError(err, FALLBACK)).toBe(
      "มีออเดอร์เลขเดียวกันถูกสร้างใหม่แล้ว (Shipnity ใช้เลขซ้ำ) — กู้คืนไม่ได้ ตรวจในระบบขายก่อน"
    );
  });

  it("import_delete_orders: requested id(s) not in the current candidate set", () => {
    const err = pgError(
      "import_delete_orders: 2 of the requested id(s) are not in the current candidate set " +
        "(e.g. 33333333-3333-3333-3333-333333333333) — refusing the whole request, nothing was deleted"
    );
    expect(mapMissingOrdersRpcError(err, FALLBACK)).toBe(
      "รายการที่เลือกบางใบไม่อยู่ในชุดใบหายแล้ว (อาจมีไฟล์ใหม่มาระหว่างนี้) — โหลดรายการใหม่แล้วเลือกอีกครั้ง"
    );
  });

  it("import_delete_orders: candidate count exceeds the safety cap", () => {
    const err = pgError(
      "import_delete_orders: 25 candidates exceeds the safety cap of 20 for this batch " +
        "(file_order_count=100) — investigate before bulk-deleting, nothing was deleted"
    );
    expect(mapMissingOrdersRpcError(err, FALLBACK)).toBe(
      "ใบหายเกินเพดานความปลอดภัยของไฟล์นี้ — ตรวจไฟล์ต้นทางก่อน ระบบไม่ลบอะไร"
    );
  });

  it("still matches when the error IS a real Error instance (e.g. .throwOnError() added later)", () => {
    const err = new Error(
      "import_delete_orders: 1 of the requested id(s) are not in the current candidate set (e.g. x) — refusing the whole request, nothing was deleted"
    );
    expect(mapMissingOrdersRpcError(err, FALLBACK)).toBe(
      "รายการที่เลือกบางใบไม่อยู่ในชุดใบหายแล้ว (อาจมีไฟล์ใหม่มาระหว่างนี้) — โหลดรายการใหม่แล้วเลือกอีกครั้ง"
    );
  });
});

describe("mapMissingOrdersRpcError — must fall back, not invent copy, never throw", () => {
  it("empty message -> fallback", () => {
    expect(mapMissingOrdersRpcError(pgError(""), FALLBACK)).toBe(FALLBACK);
  });

  it("unrelated/network error -> fallback", () => {
    expect(mapMissingOrdersRpcError(pgError("fetch failed"), FALLBACK)).toBe(FALLBACK);
  });

  it("import_delete_orders: reason is required -> fallback (already caught pre-RPC by this app)", () => {
    expect(mapMissingOrdersRpcError(pgError("import_delete_orders: reason is required"), FALLBACK)).toBe(FALLBACK);
  });

  it("import_restore_orders: cannot restore more than 200 -> fallback (already caught pre-RPC by this app)", () => {
    const err = pgError("import_restore_orders: cannot restore more than 200 orders in one call (got 250)");
    expect(mapMissingOrdersRpcError(err, FALLBACK)).toBe(FALLBACK);
  });

  it("import_delete_orders: ON DELETE CASCADE invariant guard -> fallback (internal, not user-actionable copy)", () => {
    const err = pgError(
      "import_delete_orders: expected ON DELETE CASCADE foreign keys into analytics.fact_order from exactly " +
        "{analytics.crm_order_override, analytics.dim_address, analytics.fact_order_item} but found " +
        "{analytics.dim_address, analytics.fact_order_item} — the snapshot/restore logic in this function does " +
        "not necessarily cover all cascading tables anymore; refusing to delete anything until this is reconciled"
    );
    expect(mapMissingOrdersRpcError(err, FALLBACK)).toBe(FALLBACK);
  });

  it("different fallback per call site is honored verbatim (no hardcoded generic inside the helper)", () => {
    const err = pgError("some other unmapped message");
    expect(mapMissingOrdersRpcError(err, "fallback A")).toBe("fallback A");
    expect(mapMissingOrdersRpcError(err, "fallback B")).toBe("fallback B");
  });

  // C-3PO should-fix #2 (13 ก.ย. 69): must-not-throw against every shape a
  // real catch(err) can actually hand this — not just the happy-path
  // PostgrestError-like object.
  it("null -> fallback, does not throw", () => {
    expect(() => mapMissingOrdersRpcError(null, FALLBACK)).not.toThrow();
    expect(mapMissingOrdersRpcError(null, FALLBACK)).toBe(FALLBACK);
  });

  it("undefined -> fallback, does not throw", () => {
    expect(() => mapMissingOrdersRpcError(undefined, FALLBACK)).not.toThrow();
    expect(mapMissingOrdersRpcError(undefined, FALLBACK)).toBe(FALLBACK);
  });

  it('bare string "boom" (no .message property) -> fallback, does not throw', () => {
    expect(() => mapMissingOrdersRpcError("boom", FALLBACK)).not.toThrow();
    expect(mapMissingOrdersRpcError("boom", FALLBACK)).toBe(FALLBACK);
  });

  it("plain object with no message property -> fallback, does not throw", () => {
    expect(() => mapMissingOrdersRpcError({ code: "23505" }, FALLBACK)).not.toThrow();
    expect(mapMissingOrdersRpcError({ code: "23505" }, FALLBACK)).toBe(FALLBACK);
  });

  it("message property that isn't a string -> fallback, does not throw", () => {
    expect(() => mapMissingOrdersRpcError({ message: 12345 }, FALLBACK)).not.toThrow();
    expect(mapMissingOrdersRpcError({ message: 12345 }, FALLBACK)).toBe(FALLBACK);
  });
});
