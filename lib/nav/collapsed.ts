/**
 * สถานะ "พับหมวดเมนู" ของ DashboardShell (เจ้าของสั่ง 20 ต.ค. 69: "เมนูเริ่มเยอะแล้ว ทำปิดเปิดให้หน่อย")
 *
 * เก็บใน localStorage เป็น array ของ label หมวดที่ "พับอยู่" — ไม่เคยตั้ง = ว่าง = กางทุกหมวด
 * (ไม่เปลี่ยนสิ่งที่เจ้าของคุ้น) · ทุกการเข้าถึง storage ห่อ try/catch: private mode / quota / ถูกบล็อก
 * = ไม่จำ แต่ต้องไม่พัง (แม้แต่การแตะ `window.localStorage` เฉยๆ ก็ throw SecurityError ได้)
 *
 * ฟังก์ชันเหล่านี้แตะ window — เรียกจาก useEffect เท่านั้น ห้ามเรียกตอน render (SSR/hydration)
 */

export const NAV_COLLAPSED_KEY = "nav.collapsed.v1";

// กัน payload ขยะ/ใหญ่ผิดปกติใน storage — เมนูจริงมี < 10 หมวด
const MAX_ENTRIES = 50;
const MAX_LABEL_LEN = 100;

/** แปลงค่าดิบจาก storage → รายการ label ที่ใช้ได้ · ค่าเสีย/ผิดรูป = [] (กางทั้งหมด) */
export function parseCollapsed(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    const out: string[] = [];
    for (const v of data) {
      if (typeof v !== "string" || v.length === 0 || v.length > MAX_LABEL_LEN) continue;
      if (!out.includes(v)) out.push(v);
      if (out.length >= MAX_ENTRIES) break;
    }
    return out;
  } catch {
    return [];
  }
}

export function loadCollapsed(): string[] {
  try {
    return parseCollapsed(window.localStorage.getItem(NAV_COLLAPSED_KEY));
  } catch {
    return [];
  }
}

export function saveCollapsed(labels: Iterable<string>): void {
  try {
    window.localStorage.setItem(NAV_COLLAPSED_KEY, JSON.stringify(Array.from(labels).slice(0, MAX_ENTRIES)));
  } catch {
    // ไม่จำก็ไม่เป็นไร — สถานะใน memory ยังใช้งานได้ตามปกติ
  }
}
