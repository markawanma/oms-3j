// lib/site/hosts.ts — hostname ของโดเมนลูกค้า (tools.) กับหลังบ้าน (app.) · pure ไม่อ่าน env
//
// 🔴 กฎของ host tools. มีหน้าที่ "ตัดสิทธิ์" อย่างเดียว ห้าม "ให้สิทธิ์" เพิ่ม (design-tools-hub §0)
// ค่าเป็นมติเจ้าของตายตัว ไม่ใช่ env — env เพิ่ม failure mode "ลืมตั้ง → tools. ทำตัวเป็น app. = โชว์ login"
// next.config.mjs import ไฟล์ .ts นี้ไม่ได้ → literal ในนั้นต้องตรงกับ TOOLS_HOST (lib/site/tools-host.test.ts ตรวจ drift)

export const TOOLS_HOST = "tools.3jthailand.com";
export const APP_HOST = "app.3jthailand.com";
export const TOOLS_ORIGIN = `https://${TOOLS_HOST}`;

/** allowlist ของ path ที่เปิดได้บน tools. (ไม่รวม "/" = hub ซึ่ง middleware rewrite เอง) — ต้องตรงกับ TOOLS_ALLOWLIST_ITEMS ใน next.config.mjs (test ตรวจ drift)
 *  ใช้ในชั้น (2) ของ middleware: path นอกนี้ = 307 "/" แม้ชั้น (1) ของ next.config จะไม่ทำงาน (security M1) */
export const TOOLS_PASSTHROUGH_ALTERNATIVES = [
  String.raw`ring-size/?$`,
  String.raw`gem-quiz/?$`,
  String.raw`ring-builder/?$`,
  String.raw`api/gem-quiz/submit/?$`,
  String.raw`api/ring-size/event/?$`,
  String.raw`api/ring-builder/quote/?$`,
  String.raw`_next/static/`,
  String.raw`_next/image/?$`,
  String.raw`[^/]+\.(?:svg|png|jpg|jpeg|gif|webp|ico)$`,
  String.raw`gem-quiz/[^/]+\.(?:svg|png|jpg|jpeg|webp)$`,
  String.raw`ring-size/[^/]+\.(?:svg|png|jpg|jpeg|webp)$`,
] as const;

const TOOLS_PASSTHROUGH_RE = new RegExp(`^(?:${TOOLS_PASSTHROUGH_ALTERNATIVES.join("|")})`);

/** pathname (ขึ้นต้น "/") อยู่ใน allowlist ของ tools. ไหม — case-sensitive (/RING-SIZE ไม่ผ่าน → 307) */
export function isToolsPassthroughPath(pathname: string): boolean {
  return TOOLS_PASSTHROUGH_RE.test(pathname.startsWith("/") ? pathname.slice(1) : pathname);
}

/** hostname ที่ normalize แล้ว: ตัด :port · lowercase · ตัด "." ท้าย 1 ตัว · รูปแบบเพี้ยน/ว่าง → null
 *  ตัด port แบบเดียวกับ Next (`host.split(":", 1)[0]`) เพื่อให้ redirects() ใน next.config กับ middleware ตัดสินตรงกัน */
export function normalizeHost(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const hostname = raw.split(":", 1)[0].toLowerCase();
  const trimmed = hostname.endsWith(".") ? hostname.slice(0, -1) : hostname;
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(trimmed)) return null;
  return trimmed;
}

/** เทียบเท่าเป๊ะ (===) หลัง normalize — ห้าม endsWith/includes (evil-tools.… · tools.….evil.com ต้องไม่ใช่) */
export function isToolsHost(raw: string | null | undefined): boolean {
  return normalizeHost(raw) === TOOLS_HOST;
}

/** ปลายทางของลิงก์ "← เครื่องมือ 3J" (ToolsHubLink) — "/" ไม่ใช่ "/tools" (P3 · 18 พ.ย. 69)
 *  หลัง P2 หน้าลูกค้า 3 หน้า "อยู่บน tools. เสมอ" (app. 307 ออกหมด) → "/" บน tools. = hub ตรงๆ ไม่เสีย hop (/tools บน tools. = 307 → "/")
 *  ⚠️ บน localhost / *.vercel.app (ไม่ redirect · N2) "/" = dashboard → login: กดลิงก์นี้ตอนทดสอบบน preview จะไปหน้า login — เป็นพฤติกรรมที่รู้ ไม่ใช่บั๊ก
 *  relative ตั้งใจ: ห้ามใส่ origin เต็ม (กลาย app.→tools. ข้ามโดเมนแล้ว localStorage/ผลวัดหาย) · <a href> ธรรมดา ห้าม next/link */
export const HUB_URL = "/";
