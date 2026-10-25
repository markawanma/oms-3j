// lib/auth/exempt-path.ts — A2-lite (security review 2026-09-16, H3).
//
// middleware.ts's `config.matcher` is what ACTUALLY decides which routes
// bypass the auth gate — Next.js skips running the middleware function
// entirely for any path that fails to match that pattern. This file is a
// pure, unit-testable mirror of that same anchoring logic, kept ONLY so
// exempt-path.test.ts can prove the anchoring is correct without spinning
// up the Edge middleware runtime.
//
// ⚠️ Next.js requires `matcher` to be a statically-analyzable literal (no
// imported constant, no template literal built from a shared module) — so
// this can NOT be imported into middleware.ts and used to build the actual
// matcher. The two regexes are hand-kept in sync; if you change one, change
// the other, then run this file's test.
//
// Deliberately does NOT cover /login, /register, /pending — those are
// exempted differently, via `AUTH_ENTRY_PATHS.has(pathname)` (an exact Set
// lookup in middleware.ts), which has no prefix-match failure mode to
// anchor against in the first place.
//
// gem-quiz/?$ + api/gem-quiz/submit/?$ added for the public gem quiz (QR on
// the thank-you card — docs/3j-jewelry/analytics/design-gem-quiz.md §8):
// same anchoring reasoning as shop/stock/hero above, same R-10 look-alike
// risk (/gem-quizzes, /gem-quiz-admin, /api/gem-quiz-x must stay gated — see
// exempt-path.test.ts). Security audit M3 (4 ต.ค. 69): deliberately exempts
// ONLY the exact page and exact submit endpoint, not the whole subtree —
// `api/gem-quiz(?:/|$)` would have silently made any FUTURE route under
// /api/gem-quiz/ (e.g. a stats/export endpoint) public with no test catching
// it. A new route under this prefix must earn its own exemption explicitly.
//
// ring-size/?$ เพิ่ม 24 ต.ค. 69 (เครื่องมือวัดไซส์แหวนสาธารณะ — ไม่มี DB/API/ข้อมูลส่วนตัว): exact path เท่านั้น แบบเดียวกับ gem-quiz
// (/ring-sizes · /ring-size-admin · /ring-size/x · /api/ring-size-x ต้องยังถูก gate — ดู exempt-path.test.ts) · ต้องแก้คู่กับ middleware.ts matcher
//
// api/ring-size/event/?$ เพิ่ม 25 ต.ค. 69 (เก็บสถิติ /ring-size แบบไม่ระบุตัวตน — design-ring-size-analytics §2/§5 · F8):
// 🔴 exact endpoint เท่านั้น แบบเดียวกับ api/gem-quiz/submit — ห้ามเป็น `api/ring-size(?:/|$)` (จะเปิดทั้ง subtree ให้ route ในอนาคต
// เช่น stats/export โดยไม่มีใครรู้) · ต้องไม่หลุด: /api/ring-size · /api/ring-size/ · /api/ring-size/event/x · /api/ring-size/events ·
// /api/ring-size/event-x · /api/ring-sizes/event · /api/ring-size-x · ตัวพิมพ์ใหญ่ · traversal (ดู exempt-path.test.ts) · ต้องแก้คู่กับ middleware.ts matcher
//
// w/<token> เพิ่ม 12 ต.ค. 69 (ระบบใบงาน J1 — หน้าช่างสแกน QR ไม่ login · design-job-tracking.md §5.5):
// 🔴 เป็น "prefix /w/" แบบแคบที่สุด — ยอมเฉพาะ "หนึ่งเซกเมนต์ต่อท้าย /w/" ที่เป็นอักขระ base64url ล้วน [A-Za-z0-9_-]+ แล้วจบ
// (ไม่มี /w/ ล้วน · ไม่มีเซกเมนต์ซ้อน · ไม่มี ".." / "%2e" / "." — traversal อย่าง /w/../oem ไม่ผ่านรูปแบบนี้ จึงยังถูก gate)
// token จริง 43 ตัว · ความยาว/รูปแบบที่ผิดไปตกที่หน้าช่างซึ่งแสดง "ลิงก์ใช้ไม่ได้" โดยไม่แตะข้อมูลใด
// ไม่ใช้ `{n,m}` ใน matcher เพราะ Next แปลง matcher ด้วย path-to-regexp (ปีกกาในกลุ่ม regex เสี่ยงตีความผิด) — ตรวจความยาวที่หน้าแทน
//
// w/s/<token> เพิ่ม 20 ต.ค. 69 (W1 — ผู้จัดการเปิดใบจากมือถือด้วย QR ร้าน + PIN · design-job-lots-shopfloor.md §7.1):
// 🔴 แคบเท่าเดิม: ยอมเฉพาะ "w/s/ + หนึ่งเซกเมนต์ base64url ล้วน + จบ" — ไม่มี /w/s/ ล้วน · ไม่มีเซกเมนต์ซ้อน (/w/s/<token>/x) · ไม่มี ".." / "%2e" / "." · `s` ต้องเป็นตัวเดียวเป๊ะ (ไม่ใช่ /w/sx/<token>)
// (หมายเหตุ: /w/s เองตรงกับ alternative เดิม w/<token> เพราะ "s" เป็นอักขระ base64url — หน้าช่างแสดง "ลิงก์ใช้ไม่ได้" ตามเดิม ไม่แตะข้อมูลใด)
// ต้องแก้คู่กับ middleware.ts matcher แล้วรัน exempt-path.worker.test.ts
const EXEMPT_PATTERN =
  /^(?:_next\/static|_next\/image|favicon\.ico|api\/webhooks(?:\/|$)|api\/gem-quiz\/submit\/?$|api\/ring-size\/event\/?$|shop(?:\/|$)|gem-quiz\/?$|ring-size\/?$|stock\/hero(?:\/|$)|w\/[A-Za-z0-9_-]+\/?$|w\/s\/[A-Za-z0-9_-]+\/?$|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico)$)/;

/** true if `pathname` bypasses the auth gate entirely (middleware.ts never
 * runs for it) — mirrors config.matcher's negative-lookahead exactly. */
export function isExemptPath(pathname: string): boolean {
  const rest = pathname.startsWith("/") ? pathname.slice(1) : pathname;
  return EXEMPT_PATTERN.test(rest);
}
