// lib/marketing/post-link.ts — ตรวจ/แปลงอินพุตของ sheet "โพสต์แล้ว" (content_piece_post)
// (content-ui-build-plan.md §1.3 board 4/5, B17)
//
// Pure module. การ canonicalize ลิงก์ TikTok (ยิงเครือข่ายตามลิงก์สั้น) อยู่ที่ server action
// (lib/actions/content-pieces.ts) — ที่นี่มีเฉพาะตรรกะที่ไม่ต้องใช้เครือข่าย

import { PLATFORM_LABEL, POSTED_AT_INVALID_ERROR, checkPostedAt } from "@/lib/marketing/content-types";
import type { PiecePost } from "@/lib/marketing/piece-types";

export type PostPlatform = "tiktok" | "facebook" | "instagram";

/** ช่องทางที่ชนิดชิ้นงานโพสต์ได้ — ตรงกับ content_post_platform_ok_ (0160) */
export function platformsForKind(kind: string | null | undefined): PostPlatform[] {
  if (kind === "short_clip" || kind === "live_cut") return ["tiktok"];
  if (kind === "ig_fb_post") return ["facebook", "instagram"];
  return [];
}

/** ช่องทางที่ยังวางลิงก์ได้ = ช่องที่ชนิดรองรับ − ช่องที่มีโพสต์ active แล้ว (1 platform ต่อชิ้น 1 โพสต์) */
export function availablePlatforms(kind: string | null | undefined, posts: readonly PiecePost[]): PostPlatform[] {
  const used = new Set(posts.filter((p) => p.status === "active").map((p) => p.platform));
  return platformsForKind(kind).filter((p) => !used.has(p));
}

const HOST_SUFFIXES: Record<PostPlatform, string[]> = {
  tiktok: ["tiktok.com"],
  facebook: ["facebook.com", "fb.com", "fb.watch", "fb.me"],
  instagram: ["instagram.com", "instagr.am"],
};

const PLATFORM_NAME: Record<PostPlatform, string> = { tiktok: PLATFORM_LABEL.tiktok, facebook: PLATFORM_LABEL.facebook, instagram: PLATFORM_LABEL.instagram };

export type PostUrlCheck = { ok: true; url: string } | { ok: false; error: string };

/** ลิงก์ต้องเป็น http(s) และโฮสต์ตรงกับช่องทางที่เลือก — กันวางลิงก์ IG ลงช่อง Facebook ฯลฯ */
export function checkPostUrlHost(platform: PostPlatform, raw: string): PostUrlCheck {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: "วางลิงก์โพสต์ก่อน" };
  if (!/^https?:\/\//i.test(trimmed)) return { ok: false, error: "ลิงก์ต้องขึ้นต้นด้วย http:// หรือ https://" };
  let host: string;
  try {
    host = new URL(trimmed).hostname.toLowerCase();
  } catch {
    return { ok: false, error: "ลิงก์ไม่ถูกต้อง — คัดลอกลิงก์จากหน้าโพสต์มาวางใหม่" };
  }
  const ok = HOST_SUFFIXES[platform].some((s) => host === s || host.endsWith(`.${s}`));
  if (!ok) {
    return { ok: false, error: `ลิงก์นี้ไม่ใช่ลิงก์ของ ${PLATFORM_NAME[platform]} — ตรวจช่องทางที่เลือกอีกครั้ง` };
  }
  return { ok: true, url: trimmed };
}

// ---------------------------------------------------------------------------
// วัน-เวลาโพสต์ (ช่อง datetime-local ตีความเป็นเวลาไทยเสมอ — ไม่พึ่ง timezone เครื่อง)
// ---------------------------------------------------------------------------

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const FUTURE_SKEW_MS = 2 * 60 * 1000;

/** ค่าเริ่มต้นของช่อง datetime-local = "ตอนนี้" เวลาไทย (YYYY-MM-DDTHH:mm) */
export function nowBangkokLocalInput(nowMs: number = Date.now()): string {
  return new Date(nowMs + BANGKOK_OFFSET_MS).toISOString().slice(0, 16);
}

export type PostedAtInput = { ok: true; iso: string } | { ok: false; error: string };

/** "2026-10-09T14:30" (เวลาไทย) → ISO UTC หลังตรวจช่วง 1 ม.ค. 2568 – วันนี้ (+1 วันเผื่อนาฬิกา) */
export function postedAtFromLocalInput(local: string, nowMs: number = Date.now()): PostedAtInput {
  if (typeof local !== "string") return { ok: false, error: "ระบุวันและเวลาโพสต์ให้ครบ" };
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local.trim())) {
    return { ok: false, error: "ระบุวันและเวลาโพสต์ให้ครบ" };
  }
  const check = checkPostedAt(`${local.trim()}:00+07:00`, nowMs);
  if (!check.ok) return { ok: false, error: POSTED_AT_INVALID_ERROR };
  // checkPostedAt เผื่ออนาคตได้ถึง +1 วัน แต่ content_post_upsert (0148) ปฏิเสธเวลาที่เกิน "ตอนนี้" ⇒ ปฏิเสธก่อนถึง DB (เผื่อนาฬิกาเครื่องเหลื่อม 2 นาที)
  if (Date.parse(check.iso) > nowMs + FUTURE_SKEW_MS) {
    return { ok: false, error: "เวลาโพสต์ต้องไม่อยู่ในอนาคต" };
  }
  return { ok: true, iso: check.iso };
}
