// lib/marketing/calendar-errors.test.ts
//
// Unit tests for mapCalendarRpcError (lib/marketing/calendar-errors.ts).
// Pure in-memory tests — no disk I/O, no DB — same style as
// lib/import/order-diff.test.ts.
//
// Uses a distinctive FALLBACK sentinel (not real Thai copy) so an assertion
// of `toBe(FALLBACK)` can never accidentally pass because it happens to
// match one of the real Thai strings — keeps "should map" and "should fall
// through" cases unambiguous.

import { describe, expect, it } from "vitest";
import { mapCalendarRpcError } from "./calendar-errors";

const FALLBACK = "__fallback__";

const TH_TEMPLATE_STEP =
  "ลบไม่ได้ — งานนี้มาจากแผนสำเร็จรูป (template) ลบได้เฉพาะงานที่เพิ่มเอง";
const TH_HUMAN_EDITED = "แก้ไม่ได้ — มีคนแก้เนื้อหานี้ไปแล้ว AI จะไม่เขียนทับ";
const TH_CLIP_BRIEF = "รูปแบบ clip brief ไม่ถูกต้อง";

describe("mapCalendarRpcError — maps known 22023 messages to Thai copy", () => {
  it("maps the current (0058) 'can be deleted' wording (plain-object shape)", () => {
    const err = {
      code: "22023",
      message:
        "campaign_delete_step: only manually-created steps can be deleted (this step came from a template plan)",
    };
    expect(mapCalendarRpcError(err, FALLBACK)).toBe(TH_TEMPLATE_STEP);
  });

  it("maps the old (0057) 'can be deleted' wording too — regression guard against reword drift", () => {
    const err = {
      code: "22023",
      message:
        "campaign_delete_step: only manually-created tasks can be deleted (this step belongs to a template plan)",
    };
    expect(mapCalendarRpcError(err, FALLBACK)).toBe(TH_TEMPLATE_STEP);
  });

  it("maps 'was edited by a human' (plain-object shape)", () => {
    const err = {
      code: "22023",
      message:
        "campaign_ai_draft_artifact: artifact 3f2e... was edited by a human, refusing to overwrite",
    };
    expect(mapCalendarRpcError(err, FALLBACK)).toBe(TH_HUMAN_EDITED);
  });

  it("maps 'clip_brief' (plain-object shape)", () => {
    const err = { code: "22023", message: "clip_brief.shots[].id must be unique" };
    expect(mapCalendarRpcError(err, FALLBACK)).toBe(TH_CLIP_BRIEF);
  });

  it("maps 'can be deleted' via the throwOnError Error shape too", () => {
    const err = Object.assign(
      new Error(
        "campaign_delete_step: only manually-created steps can be deleted (this step came from a template plan)"
      ),
      { code: "22023" }
    );
    expect(mapCalendarRpcError(err, FALLBACK)).toBe(TH_TEMPLATE_STEP);
  });

  it("maps 'was edited by a human' via the throwOnError Error shape too", () => {
    const err = Object.assign(
      new Error(
        "campaign_ai_draft_artifact: artifact 3f2e... was edited by a human, refusing to overwrite"
      ),
      { code: "22023" }
    );
    expect(mapCalendarRpcError(err, FALLBACK)).toBe(TH_HUMAN_EDITED);
  });

  it("maps 'clip_brief' via the throwOnError Error shape too", () => {
    const err = Object.assign(new Error("clip_brief.shots[].id must be unique"), {
      code: "22023",
    });
    expect(mapCalendarRpcError(err, FALLBACK)).toBe(TH_CLIP_BRIEF);
  });

  it("checks 'can be deleted' before 'clip_brief' when a message contains both needles — pins the if/else-if order", () => {
    const err = {
      code: "22023",
      message: "clip_brief steps can be deleted only when manually-created",
    };
    expect(mapCalendarRpcError(err, FALLBACK)).toBe(TH_TEMPLATE_STEP);
  });
});

describe("mapCalendarRpcError — falls through to fallback (must not over-match)", () => {
  it("does NOT map a matching message with a different SQLSTATE — code gate is load-bearing", () => {
    // P0001 is a generic raised exception, not ours. Only 22023 is the
    // SQLSTATE our calendar RPCs use for these three domain errors — a
    // message-only match here would risk mapping an unrelated raise from
    // some other function that happens to share wording.
    const err = { code: "P0001", message: "...steps can be deleted..." };
    expect(mapCalendarRpcError(err, FALLBACK)).toBe(FALLBACK);
  });

  it("does NOT map 22023 with unrelated message text", () => {
    const err = { code: "22023", message: "something unrelated" };
    expect(mapCalendarRpcError(err, FALLBACK)).toBe(FALLBACK);
  });

  it("does NOT map 22023 with no message at all", () => {
    const err = { code: "22023" };
    expect(mapCalendarRpcError(err, FALLBACK)).toBe(FALLBACK);
  });

  it("does NOT map a matching message with no code at all — code gate decides, not message text", () => {
    const err = new Error(
      "campaign_delete_step: only manually-created steps can be deleted (this step came from a template plan)"
    );
    expect(mapCalendarRpcError(err, FALLBACK)).toBe(FALLBACK);
  });

  it("falls through (never throws) for null", () => {
    expect(mapCalendarRpcError(null, FALLBACK)).toBe(FALLBACK);
  });

  it("falls through (never throws) for undefined", () => {
    expect(mapCalendarRpcError(undefined, FALLBACK)).toBe(FALLBACK);
  });

  it("falls through (never throws) for a bare string", () => {
    expect(mapCalendarRpcError("a string", FALLBACK)).toBe(FALLBACK);
  });

  it("falls through (never throws) for a number", () => {
    expect(mapCalendarRpcError(42, FALLBACK)).toBe(FALLBACK);
  });

  it("falls through (never throws) for an empty object", () => {
    expect(mapCalendarRpcError({}, FALLBACK)).toBe(FALLBACK);
  });
});
