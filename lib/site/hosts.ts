// lib/site/hosts.ts — hostname ของโดเมนลูกค้า (tools.) กับหลังบ้าน (app.) · pure ไม่อ่าน env
//
// 🔴 กฎของ host tools. มีหน้าที่ "ตัดสิทธิ์" อย่างเดียว ห้าม "ให้สิทธิ์" เพิ่ม (design-tools-hub §0)
// ค่าเป็นมติเจ้าของตายตัว ไม่ใช่ env — env เพิ่ม failure mode "ลืมตั้ง → tools. ทำตัวเป็น app. = โชว์ login"
// next.config.mjs import ไฟล์ .ts นี้ไม่ได้ → literal ในนั้นต้องตรงกับ TOOLS_HOST (lib/site/tools-host.test.ts ตรวจ drift)

export const TOOLS_HOST = "tools.3jthailand.com";
export const APP_HOST = "app.3jthailand.com";
export const TOOLS_ORIGIN = `https://${TOOLS_HOST}`;

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
