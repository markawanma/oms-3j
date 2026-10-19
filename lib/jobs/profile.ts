// lib/jobs/profile.ts — แบบการบันทึกของใบงาน (0176): ชนิดข้อมูล + mapper (pure · ใช้ได้ทั้ง server และ client)
// ทุกค่าอ่านจาก DB ทีละ field (ไม่ spread) — field ใหม่ที่ DB เพิ่มทีหลังไม่ไหลเข้ามาเอง
// ไม่มีราคา/ต้นทุน/น้ำหนักในไฟล์นี้ (boolean + ชื่อล้วน)

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const bool = (v: unknown): boolean => v === true;
const int = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const obj = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** flag ต่อขั้น — ไม่มีแถวของขั้น = ปิดทั้ง 3 */
export interface ProfileStageFlag {
  stageCode: string;
  weigh: boolean;
  scrapQty: boolean;
  scrapWeight: boolean;
}

export interface RecordProfile {
  id: string;
  name: string;
  note: string | null;
  requireFinalWeight: boolean;
  isActive: boolean;
  seq: number;
  isDefault: boolean;
  isDefaultGold: boolean;
  stages: ProfileStageFlag[];
  /** จำนวนใบที่ยังเปิดอยู่ที่ใช้แบบนี้ (เฉพาะรายการจาก job_record_profile_list/upsert) */
  jobsOpen: number;
}

/** ทะเบียนขั้นสำหรับวาดตาราง: metalPresent = โลหะอยู่ในมือที่ขั้นนี้ (false = ชั่ง/เศษไม่ได้) */
export interface ProfileStageDef {
  code: string;
  nameTh: string;
  seq: number;
  metalPresent: boolean;
  isActive: boolean;
}

export interface ProfilesData {
  profiles: RecordProfile[];
  defaultProfileId: string | null;
  defaultGoldProfileId: string | null;
  stageDefs: ProfileStageDef[];
}

export function mapProfileStageFlag(raw: unknown): ProfileStageFlag | null {
  const r = obj(raw);
  const code = r ? str(r.stage_code) : null;
  if (!r || !code) return null;
  return { stageCode: code, weigh: bool(r.weigh), scrapQty: bool(r.scrap_qty), scrapWeight: bool(r.scrap_weight) };
}

export function mapRecordProfile(raw: unknown): RecordProfile | null {
  const r = obj(raw);
  const id = r ? str(r.id) : null;
  const name = r ? str(r.name) : null;
  if (!r || !id || !name) return null;
  return {
    id,
    name,
    note: str(r.note),
    requireFinalWeight: bool(r.require_final_weight),
    isActive: r.is_active !== false,
    seq: int(r.seq),
    isDefault: bool(r.is_default),
    isDefaultGold: bool(r.is_default_gold),
    stages: (Array.isArray(r.stages) ? r.stages : []).map(mapProfileStageFlag).filter((s): s is ProfileStageFlag => s !== null),
    jobsOpen: int(r.jobs_open),
  };
}

export function mapProfileStageDef(raw: unknown): ProfileStageDef | null {
  const r = obj(raw);
  const code = r ? str(r.code) : null;
  if (!r || !code) return null;
  return { code, nameTh: str(r.name_th) ?? code, seq: int(r.seq_default), metalPresent: bool(r.metal_present), isActive: r.is_active !== false };
}

export function mapProfilesData(raw: unknown): ProfilesData {
  const r = obj(raw) ?? {};
  return {
    profiles: (Array.isArray(r.profiles) ? r.profiles : []).map(mapRecordProfile).filter((p): p is RecordProfile => p !== null),
    defaultProfileId: str(r.default_profile_id),
    defaultGoldProfileId: str(r.default_gold_profile_id),
    stageDefs: (Array.isArray(r.stage_defs) ? r.stage_defs : []).map(mapProfileStageDef).filter((s): s is ProfileStageDef => s !== null),
  };
}
