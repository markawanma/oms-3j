"use client";

// ProfileSummary — สรุปแบบการบันทึกเป็นข้อความ "ชั่ง: … / ชิ้นเสีย: … / เศษ: …" (ออฟฟิศเท่านั้น)
// อ่านจาก flag ที่ส่งมา (รายการแบบ หรือ snapshot ของขั้นในใบ) — ไม่คำนวณกติกาเอง

import { summarizeFlags } from "@/lib/jobs/profile-summary";

export interface SummaryDef {
  code: string;
  nameTh: string;
  metalPresent: boolean;
  /** 0195: ขั้นที่ใบทองไม่บังคับชั่ง (ขัด) — ไม่ระบุ = false */
  goldWeighExempt?: boolean;
  /** ปิดใช้ในทะเบียน = ไม่นับเป็น "ทุกขั้น" (ไม่ระบุ = ใช้งาน) */
  isActive?: boolean;
}
export interface SummaryFlag {
  stageCode: string;
  weigh: boolean;
  scrapQty: boolean;
  scrapWeight: boolean;
}

/** ข้อความสรุป 3 บรรทัดย่อ — แยกเป็นฟังก์ชันให้ใช้ซ้ำ/เทสต์ได้ */
export function profileSummaryParts(defs: readonly SummaryDef[], flags: readonly SummaryFlag[]): { weigh: string; scrapQty: string; scrapWeight: string } {
  const nameOf = (c: string) => defs.find((d) => d.code === c)?.nameTh ?? c;
  const live = defs.filter((d) => d.isActive !== false);
  const metal = live.filter((d) => d.metalPresent).map((d) => d.code);
  const all = live.map((d) => d.code);
  const pick = (k: "weigh" | "scrapQty" | "scrapWeight") => flags.filter((f) => f[k]).map((f) => f.stageCode);
  // 0195: ชั่งครบทุกขั้นที่มีโลหะ ยกเว้นขั้น exempt (แบบทองปริยาย) → ป้ายตรงตามจริง แทนรายการขั้นยาว
  const exempt = live.filter((d) => d.metalPresent && d.goldWeighExempt === true).map((d) => d.code);
  const guarded = metal.filter((c) => !exempt.includes(c));
  const weighed = pick("weigh");
  const exceptAll = exempt.length > 0 && guarded.length > 0 && weighed.length === guarded.length && guarded.every((c) => weighed.includes(c));
  return {
    weigh: exceptAll ? `ทุกขั้นที่มีโลหะ (ยกเว้น${exempt.map(nameOf).join(", ")})` : summarizeFlags(weighed, metal, nameOf, "ทุกขั้นที่มีโลหะ"),
    scrapQty: summarizeFlags(pick("scrapQty"), all, nameOf, "ทุกขั้น"),
    scrapWeight: summarizeFlags(pick("scrapWeight"), metal, nameOf, "ทุกขั้นที่มีโลหะ"),
  };
}

export function ProfileSummary({ defs, flags, className = "" }: { defs: readonly SummaryDef[]; flags: readonly SummaryFlag[]; className?: string }) {
  const s = profileSummaryParts(defs, flags);
  return (
    <p className={`text-sm text-zinc-700 break-words ${className}`}>
      {`ชั่ง: ${s.weigh} / ชิ้นเสีย: ${s.scrapQty} / เศษ: ${s.scrapWeight}`}
    </p>
  );
}
