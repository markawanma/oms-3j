// ShopMetalTag — ป้ายสีโลหะบนจอผู้จัดการ (UX §1): พื้นทึบ + glyph + ขอบ + ข้อความเสมอ (ไม่พึ่งสีอย่างเดียว)
// ไม่ import MetalTag ของจอใบผลิต: ไฟล์นั้นลากโมดูลใบผลิต/OEM เข้ากราฟหน้าสาธารณะ — ใช้ค่าจาก leaf module lib/units/metal-tag.ts ตัวเดียวกับจอใบผลิต

import { METAL_TAG } from "@/lib/units/metal-tag";
import type { MetalKey as ShopMetal } from "@/lib/units/metal-tag";

const SIZE = { sm: "px-2 py-0.5 text-base", md: "px-3 py-1 text-xl", lg: "px-3.5 py-1.5 text-2xl" } as const;

export function ShopMetalTag({ metal, size = "md", className = "" }: { metal: ShopMetal; size?: keyof typeof SIZE; className?: string }) {
  const t = METAL_TAG[metal];
  return (
    <span data-metal={metal} className={`inline-flex shrink-0 items-center gap-1.5 rounded-md font-bold whitespace-nowrap ${SIZE[size]} ${t.className} ${className}`}>
      <span aria-hidden="true">{t.glyph}</span>
      {t.label}
    </span>
  );
}
