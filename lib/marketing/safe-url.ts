// lib/marketing/safe-url.ts — ลิงก์ที่มาจากข้อมูล (แหล่งอ้างอิง · ลิงก์โพสต์) ก่อน render เป็น <a href> (security L1)
// อนุญาตเฉพาะ http/https ที่ parse ได้ ไม่มี user:pass@ และไม่ยาวเกินเหตุ — ไม่ผ่าน = null → ผู้เรียกแสดงเป็นข้อความธรรมดา ไม่ใช่ลิงก์
// (กัน javascript: / data: / vbscript: ที่หลุดมาในแถวเก่าหรือที่เขียนตรงนอก UI)

const MAX_URL_LEN = 2048;

export function safeHttpUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (!t || t.length > MAX_URL_LEN || /[\s\u0000-\u001f]/.test(t)) return null;
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  return u.toString();
}
