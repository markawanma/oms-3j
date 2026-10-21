// ShopMetalTag — ป้ายสีโลหะบนจอผู้จัดการ (UX §1): พื้นทึบ + glyph + ขอบ + ข้อความเสมอ (ไม่พึ่งสีอย่างเดียว)
// ไม่ import MetalTag ของจอใบผลิต: ไฟล์นั้นลากโมดูลใบผลิต/OEM เข้ากราฟหน้าสาธารณะ — class ตรงกันด้วยเทสต์ (shop-open.test.ts)

import { SHOP_METAL_TAG } from "@/lib/jobs/shop-open";
import type { ShopMetal } from "@/lib/jobs/shop-open";

const SIZE = { sm: "px-2 py-0.5 text-base", md: "px-3 py-1 text-xl", lg: "px-3.5 py-1.5 text-2xl" } as const;

export function ShopMetalTag({ metal, size = "md", className = "" }: { metal: ShopMetal; size?: keyof typeof SIZE; className?: string }) {
  const t = SHOP_METAL_TAG[metal];
  return (
    <span data-metal={metal} className={`inline-flex shrink-0 items-center gap-1.5 rounded-md font-bold whitespace-nowrap ${SIZE[size]} ${t.className} ${className}`}>
      <span aria-hidden="true">{t.glyph}</span>
      {t.label}
    </span>
  );
}
