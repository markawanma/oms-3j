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

/** น้ำหนักสุทธิตอนปิดงานบังคับไหม — กติกาเดียวกับ DB (job_done): แบบสั่งบังคับ หรือ ใบทองที่มีขั้นต้องชั่งอย่างน้อย 1 ขั้น (0176 security M1) · ใช้แสดง/บังคับช่องในกล่อง ด่านจริงอยู่ที่ DB */
export function finalWeightRequired(j: { requireFinalWeight: boolean; metal: string; hasWeigh: boolean }): boolean {
  return j.requireFinalWeight || (j.metal === "gold" && j.hasWeigh);
}

export interface PickerStage {
  code: string;
  nameTh: string;
  metalPresent: boolean;
}

export interface PickerAnalysis {
  /** ชื่อขั้น (ที่ติ๊กในใบนี้) ที่แบบตั้งไว้ */
  weigh: string[];
  scrapQty: string[];
  scrapWeight: string[];
  /** ชื่อขั้นที่แบบตั้งชั่งแต่ใบนี้ไม่ผ่านขั้นนั้น (ข้ามไป) */
  weighNotInJob: string[];
  /** แบบมีขั้นชั่ง แต่ขั้นของใบนี้ไม่มีขั้นไหนชั่งเลย (เตือนเหลือง) */
  weighNoMatch: boolean;
  /** ใบทอง: ขั้นของใบที่โลหะอยู่ในมือแต่ไม่ชั่ง (กล่องแดง · ต้อง ack) */
  goldUnguarded: string[];
  /** น้ำหนักสุทธิตอนปิดงานบังคับไหม */
  finalRequired: boolean;
}

/**
 * ผลของ "แบบ × ขั้นของใบนี้" — lookup boolean ของแบบกับขั้นที่ติ๊กเท่านั้น (ไม่คำนวณกติกาใหม่)
 * @param profile flag ของแบบ (ไม่มีแถว = ปิดทั้ง 3)  @param stages ขั้นของใบนี้ (ที่ติ๊ก/ไม่ถูกข้าม) ตามลำดับ  @param allNames ชื่อไทยของทุกขั้น (หา weighNotInJob)
 */
export function analyzePicker(
  profile: { requireFinalWeight: boolean; stages: readonly { stageCode: string; weigh: boolean; scrapQty: boolean; scrapWeight: boolean }[] },
  stages: readonly PickerStage[],
  metal: string,
  allNames: Readonly<Record<string, string>> = {}
): PickerAnalysis {
  const flag = (code: string) => profile.stages.find((s) => s.stageCode === code);
  const inJob = new Set(stages.map((s) => s.code));
  const pick = (k: "weigh" | "scrapQty" | "scrapWeight") => stages.filter((s) => flag(s.code)?.[k] === true).map((s) => s.nameTh);
  const weigh = pick("weigh");
  const weighNotInJob = profile.stages.filter((s) => s.weigh && !inJob.has(s.stageCode)).map((s) => allNames[s.stageCode] ?? s.stageCode);
  const profileWeighs = profile.stages.some((s) => s.weigh);
  const goldUnguarded =
    metal === "gold"
      ? goldUnguardedStages(stages.map((s) => ({ code: s.code, metalPresent: s.metalPresent, weigh: flag(s.code)?.weigh === true }))).map((c) => stages.find((s) => s.code === c)?.nameTh ?? c)
      : [];
  return {
    weigh,
    scrapQty: pick("scrapQty"),
    scrapWeight: pick("scrapWeight"),
    weighNotInJob,
    weighNoMatch: profileWeighs && weigh.length === 0,
    goldUnguarded,
    finalRequired: finalWeightRequired({ requireFinalWeight: profile.requireFinalWeight, metal, hasWeigh: weigh.length > 0 }),
  };
}
