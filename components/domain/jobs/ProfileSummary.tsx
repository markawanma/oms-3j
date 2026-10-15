"use client";

// ProfileSummary — สรุปแบบการบันทึกเป็นข้อความ "ชั่ง: … / ชิ้นเสีย: … / เศษ: …" (ออฟฟิศเท่านั้น)
// อ่านจาก flag ที่ส่งมา (รายการแบบ หรือ snapshot ของขั้นในใบ) — ไม่คำนวณกติกาเอง

import { summarizeFlags } from "@/lib/jobs/profile-summary";

export interface SummaryDef {
  code: string;
  nameTh: string;
  metalPresent: boolean;
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
  const metal = defs.filter((d) => d.metalPresent).map((d) => d.code);
  const all = defs.map((d) => d.code);
  const pick = (k: "weigh" | "scrapQty" | "scrapWeight") => flags.filter((f) => f[k]).map((f) => f.stageCode);
  return {
    weigh: summarizeFlags(pick("weigh"), metal, nameOf, "ทุกขั้นที่มีโลหะ"),
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
