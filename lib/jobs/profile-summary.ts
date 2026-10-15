// lib/jobs/profile-summary.ts — สรุปแบบการบันทึกเป็นข้อความ + หาขั้นทองที่ไม่มีด่านชั่ง (pure)
// ไม่ตัดสินกติกาแทน DB: ใช้แสดง/เตือนเท่านั้น (ด่านจริง = job_stage_guard/job_worker_resolve)

/** รายชื่อสั้น: ≤ 4 แสดงทั้งหมด · > 4 แสดง 3 ชื่อแรก + "และอีก n ขั้น" */
export function shortList(names: readonly string[]): string {
  if (names.length <= 4) return names.join(", ");
  return `${names.slice(0, 3).join(", ")} และอีก ${names.length - 3} ขั้น`;
}

/**
 * สรุป flag หนึ่งชนิด: ว่าง = "ไม่มี" · เท่ากับ universe ทั้งชุด (และ universe ไม่ว่าง) = allLabel · อย่างอื่น = shortList ตามลำดับ universe
 * @param selected รหัสขั้นที่ติ๊ก  @param universe รหัสขั้นทั้งหมดที่ติ๊กได้ (เรียงตามลำดับขั้น)  @param nameOf รหัส → ชื่อไทย
 */
export function summarizeFlags(selected: readonly string[], universe: readonly string[], nameOf: (code: string) => string, allLabel = "ทุกขั้นที่มีโลหะ"): string {
  const pick = universe.filter((c) => selected.includes(c));
  // รหัสที่ไม่อยู่ใน universe (เช่น ขั้นที่ปิดใช้แล้ว) ยังต้องโชว์ — ต่อท้าย
  for (const c of selected) if (!pick.includes(c)) pick.push(c);
  if (pick.length === 0) return "ไม่มี";
  // "ทุกขั้น…" ได้เฉพาะเมื่อเท่ากับ universe เป๊ะ (มีขั้นนอก universe ติดมาด้วย = ไม่ใช่ "ทุกขั้นที่มีโลหะ")
  if (universe.length > 0 && pick.length === universe.length && universe.every((c) => selected.includes(c))) return allLabel;
  return shortList(pick.map(nameOf));
}

export interface GuardStage {
  code: string;
  /** โลหะอยู่ในมือที่ขั้นนี้ (def.metal_present) */
  metalPresent: boolean;
  /** ขั้นนี้ต้องชั่ง */
  weigh: boolean;
  /** ขั้นที่ข้ามไว้ไม่นับ */
  skipped?: boolean;
}

/** ขั้นที่ "โลหะอยู่ในมือแต่ไม่ชั่ง" = ไม่มีด่านกันทองหายในขั้นนั้น (ใช้กับใบทองเท่านั้น — ผู้เรียกตัดสินโลหะ) · คืนรหัสตามลำดับที่ส่งมา */
export function goldUnguardedStages(stages: readonly GuardStage[]): string[] {
  return stages.filter((s) => s.metalPresent && !s.weigh && !s.skipped).map((s) => s.code);
}

/** แบบนี้มีขั้นที่ต้องชั่งอย่างน้อย 1 ขั้นไหม */
export function profileHasWeigh(flags: readonly { weigh: boolean }[]): boolean {
  return flags.some((f) => f.weigh);
}
