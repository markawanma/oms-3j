// MetalTag — ป้ายสีโลหะ (UX §1 token ใหม่): พื้นทึบ + glyph + ขอบ + ข้อความเสมอ (ไม่พึ่งสีอย่างเดียว · คนตาบอดสีแยกด้วย glyph/ข้อความ)
// ใช้ชื่อสั้น เงิน/ทอง/ทองเหลือง ไม่ใช่ "เงิน 925" (เงินแท่งเนื้อ 99.90% จะผิดทันที) — เนื้อ % อยู่ช่องแยกข้างป้ายเสมอ

import type { ProductionMetal } from "@/lib/production/types";
import { METAL_TAG } from "@/lib/production/metal-ui";

export function MetalTag({ metal, className = "" }: { metal: ProductionMetal; className?: string }) {
  const t = METAL_TAG[metal];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-sm px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${t.className} ${className}`}>
      <span aria-hidden="true">{t.glyph}</span>
      {t.label}
    </span>
  );
}
