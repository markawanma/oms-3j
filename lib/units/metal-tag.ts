// lib/units/metal-tag.ts — leaf module (ไม่มี import เลย): ป้ายสีโลหะ · ค่าเริ่มเนื้อต่อโลหะ · ข้อความ "เนื้อรีเซ็ต/ล้างน้ำหนัก"
// ที่เดียวของค่าเหล่านี้ — ใช้ร่วมกันของจอใบผลิต (lib/production/metal-ui.ts re-export) และจอผู้จัดการบนมือถือ (lib/jobs/shop-open.ts import ตรง)
// ทำเป็น leaf เพราะหน้าสาธารณะ /w/s/ ห้ามลาก lib/production · lib/oem (รูปร่างต้นทุน/margin) ขึ้น client bundle — ไฟล์นี้ไม่ลากอะไรมาด้วย
// UX §1: พื้นทึบ + glyph + ขอบ เสมอ (ไม่พึ่งสีอย่างเดียว) · ชื่อสั้น เงิน/ทอง/ทองเหลือง (ไม่ใช่ "เงิน 925" — เงินแท่งเนื้อ 99.90% จะผิดทันที)
// 🔴 ไม่มีการคิดเงิน/ราคา

export type MetalKey = "silver" | "gold" | "brass";

export const METAL_TAG: Record<MetalKey, { label: string; glyph: string; className: string }> = {
  silver: { label: "เงิน", glyph: "◇", className: "bg-slate-200 text-slate-900 border border-slate-500" },
  gold: { label: "ทอง", glyph: "◆", className: "bg-yellow-300 text-yellow-950 border border-yellow-600" },
  brass: { label: "ทองเหลือง", glyph: "▲", className: "bg-orange-300 text-orange-950 border border-orange-600" },
};

/** ค่าเริ่มช่อง "เนื้อโลหะ (%)": เงิน 92.50 (มติเจ้าของ · แก้ได้ · ว่างได้) · ทอง ว่าง (บังคับกรอก) · ทองเหลือง 100.00 (ล็อก) */
export const DEFAULT_PURITY_PCT: Record<MetalKey, string> = { silver: "92.50", gold: "", brass: "100.00" };

export const MSG_METAL_RESET_PURITY = "เนื้อรีเซ็ตตามโลหะใหม่";
export const MSG_WEIGHT_CLEARED_FROM_SKU = "ล้างน้ำหนักจากสินค้าแล้ว (ใช้กับเงินเท่านั้น)";
