// lib/marketing/calendar-errors.ts
//
// Pure module (no "use server", no "server-only") holding the Content
// Calendar RPC error mapper. Moved out of lib/actions/calendar.ts because
// that file is a "use server" module — Next.js only allows async function
// exports from those, so a plain function like this can't live there and
// still be unit-testable directly.

// Relative import (not the repo's usual "@/lib/..." alias): vitest.config.ts
// has no "@" alias configured (only tsconfig.json does, which Next.js reads
// directly but Vitest does not) — a relative import lets this file's test
// run under plain Vitest without touching the shared test config.
import { readErrorCode, readErrorMessage } from "../supabase/postgrest-error";

/** Maps a Postgres error to a Thai message, preferring the stable SQLSTATE
 * over message text (RPC wording can change without notice — 22023 can't). */
export function mapCalendarRpcError(err: unknown, fallback: string): string {
  const code = readErrorCode(err);
  if (code === "22023") {
    const msg = readErrorMessage(err);
    // Match the stable half of the sentence: 0058 reworded "tasks" -> "steps"
    // when delete became a per-step decision, and an exact-phrase match here
    // silently fell through to the generic error.
    if (msg.includes("can be deleted")) {
      return "ลบไม่ได้ — งานนี้มาจากแผนสำเร็จรูป (template) ลบได้เฉพาะงานที่เพิ่มเอง";
    }
    if (msg.includes("was edited by a human")) {
      return "แก้ไม่ได้ — มีคนแก้เนื้อหานี้ไปแล้ว AI จะไม่เขียนทับ";
    }
    if (msg.includes("clip_brief")) {
      return "รูปแบบ clip brief ไม่ถูกต้อง";
    }
  }
  return fallback;
}
