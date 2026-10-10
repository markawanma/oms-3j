// lib/marketing/signal-input.ts — อินพุตของ "แปะลิงก์ที่เจอ" (content_signal_capture · แผน §4 P4 ข้อ 1 ที่ดึงมาไว้ท้าย P1b)
// 🔴 pure ล้วน: ห้ามมีโค้ดที่เรียกเครือข่ายไปยังลิงก์ของคนอื่น (oEmbed/fetch/เปิดลิงก์) — ผิด ToS (memory platform-engagement-apis)
//    ประโยคตรวจใต้ช่องลิงก์ = parse จากสตริงของเราเองเท่านั้น · การตรวจซ้ำตัดสินที่ DB (23505)
// ตัวเลขย่อ "16K/1.2M/1.2 หมื่น" → จำนวนเต็ม + ธงประมาณ (parse ฝั่ง server — ค่าไม่ใช่ตัวเลข = ข้อความใต้ช่อง)

export const MAX_METRIC = 10_000_000_000;

export type MetricParse = { ok: true; value: number | null; abbreviated: boolean } | { ok: false; error: string };

const SUFFIX: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9, พัน: 1e3, หมื่น: 1e4, แสน: 1e5, ล้าน: 1e6 };

/** "" → ไม่เห็น (null) · "1,234" · "16K" · "1.2M" · "2.5 หมื่น" · ห้ามติดลบ/ทศนิยมเกินย่อ/NaN/Infinity · "0" = 0 จริง (ที่เห็นบนจอ) */
export function parseMetric(raw: string): MetricParse {
  const t = (typeof raw === "string" ? raw : "").normalize("NFKC").replace(/[\s,_]/g, "").toLowerCase();
  if (t === "") return { ok: true, value: null, abbreviated: false };
  const m = /^(\d+(?:\.\d+)?)(k|m|b|พัน|หมื่น|แสน|ล้าน)?$/u.exec(t);
  if (!m) return { ok: false, error: "ใส่เป็นตัวเลข เช่น 1200 · 16K · 1.2M (ไม่เห็นให้เว้นว่าง)" };
  const num = Number(m[1]);
  if (!Number.isFinite(num)) return { ok: false, error: "ตัวเลขไม่ถูกต้อง" };
  const mult = m[2] ? SUFFIX[m[2]] : 1;
  if (!m[2] && m[1].includes(".")) return { ok: false, error: "ตัวเลขเต็มต้องไม่มีทศนิยม — ถ้าเป็นตัวย่อให้ใส่ K / M" };
  const value = Math.round(num * mult);
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_METRIC) return { ok: false, error: "ตัวเลขใหญ่เกินที่รับได้" };
  return { ok: true, value, abbreviated: !!m[2] };
}

// ---------------------------------------------------------------------------
// ลิงก์
// ---------------------------------------------------------------------------

const TRACKING_PARAMS = new Set(["fbclid", "igshid", "igsh", "si", "is_from_webapp", "sender_device", "_t", "_r", "feature", "ref", "ref_src", "mibextid", "gclid", "share_id", "share_link_id", "u_code", "sec_user_id", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "utm_id"]);

export type CleanLink = { ok: true; url: string } | { ok: false; error: string };

/** ตัด tracking param + fragment · youtu.be/ID → youtube.com/watch?v=ID · ไม่ใช่ http(s) หรือมี user:pass = ปฏิเสธ · ไม่ resolve ลิงก์สั้น (ไม่ออกเครือข่าย) */
export function cleanSignalUrl(raw: string): CleanLink {
  const t = (typeof raw === "string" ? raw : "").trim();
  if (!t) return { ok: false, error: "วางลิงก์คลิปที่เจอก่อน" };
  if (t.length > 500) return { ok: false, error: "ลิงก์ยาวเกิน 500 ตัวอักษร" };
  if (/[\s<>"\\]/.test(t)) return { ok: false, error: "ลิงก์ไม่ถูกต้อง (มีช่องว่างหรืออักขระต้องห้าม)" };
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    return { ok: false, error: "ลิงก์ไม่ถูกต้อง — คัดลอกลิงก์จากแอปมาวางใหม่" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, error: "ลิงก์ต้องขึ้นต้นด้วย http:// หรือ https://" };
  if (u.username || u.password) return { ok: false, error: "ลิงก์ไม่ถูกต้อง" };

  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "youtu.be") {
    const id = u.pathname.split("/").filter(Boolean)[0];
    if (!id) return { ok: false, error: "ลิงก์ YouTube ไม่ครบ" };
    return { ok: true, url: `https://www.youtube.com/watch?v=${encodeURIComponent(id)}` };
  }
  u.hash = "";
  for (const k of [...u.searchParams.keys()]) if (TRACKING_PARAMS.has(k.toLowerCase())) u.searchParams.delete(k);
  const out = u.toString();
  if (out.length > 500) return { ok: false, error: "ลิงก์ยาวเกิน 500 ตัวอักษร" };
  return { ok: true, url: out };
}

export interface LinkHint {
  /** ค่าที่ส่งเป็น platform (ตัวพิมพ์เล็ก) · null = ไม่รู้จัก */
  platform: string | null;
  platformLabel: string;
  /** @handle ถ้า parse ได้จาก path (TikTok เท่านั้น) */
  account: string | null;
}

const HOSTS: { test: (h: string) => boolean; platform: string; label: string }[] = [
  { test: (h) => h === "tiktok.com" || h.endsWith(".tiktok.com"), platform: "tiktok", label: "TikTok" },
  { test: (h) => h === "instagram.com" || h.endsWith(".instagram.com"), platform: "instagram", label: "Instagram" },
  { test: (h) => h === "facebook.com" || h.endsWith(".facebook.com") || h === "fb.watch" || h === "fb.com", platform: "facebook", label: "Facebook" },
  { test: (h) => h === "youtube.com" || h.endsWith(".youtube.com") || h === "youtu.be", platform: "youtube", label: "YouTube" },
];

/** "TikTok · @user" จากสตริงลิงก์ล้วนๆ — ไม่เรียกเครือข่าย */
export function describeLink(clean: string): LinkHint {
  let u: URL;
  try {
    u = new URL(clean);
  } catch {
    return { platform: null, platformLabel: "ไม่รู้จักแพลตฟอร์ม", account: null };
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const hit = HOSTS.find((h) => h.test(host));
  const handle = hit?.platform === "tiktok" ? /\/(@[A-Za-z0-9._]{1,40})(?:\/|$)/.exec(u.pathname)?.[1] ?? null : null;
  return { platform: hit?.platform ?? null, platformLabel: hit?.label ?? "ไม่รู้จักแพลตฟอร์ม", account: handle };
}
