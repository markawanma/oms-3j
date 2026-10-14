// lib/jobs/source.ts — รายการต้นทาง (ใบเสนอราคา OEM) ที่สร้างใบงานผลิตได้ (pure)
// ใบงานมีไว้ติดตามงานในโรงงาน: เฉพาะโลหะที่ผ่านขั้นผลิต (เงิน 925 / ทอง / ทองเหลือง) · เงินแท่ง (silver999) และสินค้า/บริการ (product) ไม่มีขั้นตอนผลิต
// ซ่อนปุ่มฝั่งหน้าจอเพื่อไม่ให้กดแล้วเจอ error — DB ยังปฏิเสธซ้ำ (hint metal_unsupported) ถ้าใครเรียกตรง

export const JOB_METALS = ["silver", "gold", "brass"] as const;

export function isJobMetal(metal: unknown): boolean {
  return typeof metal === "string" && (JOB_METALS as readonly string[]).includes(metal);
}
