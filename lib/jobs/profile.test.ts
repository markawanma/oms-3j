// 0176 แบบการบันทึก: mapper (ทีละ field) + สรุป/ขั้นทองไม่มีด่าน — pure
import { describe, expect, it } from "vitest";
import { mapProfilesData, mapRecordProfile } from "@/lib/jobs/profile";
import { analyzePicker, finalWeightRequired, goldUnguardedStages, profileHasWeigh, shortList, summarizeFlags } from "@/lib/jobs/profile-summary";
import { mapBoardRow, mapJobDetail, mapStageRow } from "@/lib/jobs/types";

const ID = "11111111-1111-4111-8111-111111111111";
const name = (c: string) => ({ cast: "หล่อ", sprue: "ตัดต้น", file: "ตะไบ", polish: "ขัด", plate: "ชุบ", qc: "QC" })[c] ?? c;

describe("mapRecordProfile / mapProfilesData", () => {
  it("อ่านทีละ field · key แปลกที่ DB เพิ่มทีหลังไม่ไหลเข้า (ไม่ spread)", () => {
    const p = mapRecordProfile({ id: ID, name: "แบบ 1", note: null, require_final_weight: true, is_active: true, seq: 10, is_default: true, is_default_gold: false, jobs_open: 3, secret_cost: 99,
      stages: [{ stage_code: "cast", weigh: true, scrap_qty: true, scrap_weight: false, price: 5 }, { nope: 1 }] });
    expect(p).toEqual({ id: ID, name: "แบบ 1", note: null, requireFinalWeight: true, isActive: true, seq: 10, isDefault: true, isDefaultGold: false, jobsOpen: 3,
      stages: [{ stageCode: "cast", weigh: true, scrapQty: true, scrapWeight: false }] });
  });
  it("ไม่มี id/ชื่อ = null · flag ต้อง true จริงเท่านั้น ('true' ข้อความ = false)", () => {
    expect(mapRecordProfile({ name: "x" })).toBeNull();
    expect(mapRecordProfile({ id: ID })).toBeNull();
    expect(mapRecordProfile({ id: ID, name: "x", is_default: "true", stages: [{ stage_code: "cast", weigh: "true" }] })).toMatchObject({ isDefault: false, stages: [{ weigh: false }] });
  });
  it("ข้อมูลว่าง/ผิดชนิดไม่ throw", () => {
    expect(mapProfilesData(null)).toEqual({ profiles: [], defaultProfileId: null, defaultGoldProfileId: null, stageDefs: [] });
    const d = mapProfilesData({ profiles: [{ id: ID, name: "ก" }, 5], default_profile_id: ID, default_gold_profile_id: null,
      stage_defs: [{ code: "cast", name_th: "หล่อ", seq_default: 1, metal_present: true, is_active: true }, { code: "plate", name_th: "ชุบ", seq_default: 5, metal_present: false, is_active: false }] });
    expect(d.profiles).toHaveLength(1);
    expect(d.defaultProfileId).toBe(ID);
    expect(d.stageDefs).toEqual([{ code: "cast", nameTh: "หล่อ", seq: 1, metalPresent: true, isActive: true }, { code: "plate", nameTh: "ชุบ", seq: 5, metalPresent: false, isActive: false }]);
  });
});

describe("shortList / summarizeFlags", () => {
  it("≤ 4 ชื่อแสดงทั้งหมด · > 4 = 3 ชื่อแรก + 'และอีก n ขั้น'", () => {
    expect(shortList(["หล่อ", "ขัด"])).toBe("หล่อ, ขัด");
    expect(shortList(["ก", "ข", "ค", "ง"])).toBe("ก, ข, ค, ง");
    expect(shortList(["หล่อ", "ตัดต้น", "ตะไบ", "ขัด", "ชุบ", "QC"])).toBe("หล่อ, ตัดต้น, ตะไบ และอีก 3 ขั้น");
  });
  const metal = ["cast", "sprue", "file", "polish", "plate"];
  it("ว่าง = 'ไม่มี' · ครบทุกขั้นโลหะ = 'ทุกขั้นที่มีโลหะ' · บางขั้น = รายชื่อตามลำดับขั้น", () => {
    expect(summarizeFlags([], metal, name)).toBe("ไม่มี");
    expect(summarizeFlags(metal, metal, name)).toBe("ทุกขั้นที่มีโลหะ");
    expect(summarizeFlags(["polish", "cast"], metal, name)).toBe("หล่อ, ขัด");
    expect(summarizeFlags(["cast", "sprue", "file", "polish"], metal, name)).toBe("หล่อ, ตัดต้น, ตะไบ, ขัด");
    expect(summarizeFlags(["cast", "sprue", "file", "polish", "plate", "qc"], metal, name)).toContain("และอีก");
  });
  it("universe ว่าง (ไม่มีขั้นโลหะ) ไม่ถูกนับว่า 'ครบทุกขั้น' · ขั้นนอก universe (ปิดใช้แล้ว) ยังโชว์", () => {
    expect(summarizeFlags([], [], name)).toBe("ไม่มี");
    expect(summarizeFlags(["qc"], metal, name)).toBe("QC");
  });
});

describe("goldUnguardedStages / profileHasWeigh", () => {
  const st = (code: string, metalPresent: boolean, weigh: boolean, skipped = false) => ({ code, metalPresent, weigh, skipped });
  it("ขั้นที่โลหะอยู่ในมือแต่ไม่ชั่ง = ไม่มีด่าน · ขั้นไม่มีโลหะ/ขั้นที่ชั่ง/ขั้นที่ข้าม ไม่นับ", () => {
    expect(goldUnguardedStages([st("wax", false, false), st("cast", true, true), st("file", true, false), st("polish", true, false, true), st("qc", true, false)])).toEqual(["file", "qc"]);
    expect(goldUnguardedStages([st("cast", true, true)])).toEqual([]);
    expect(goldUnguardedStages([])).toEqual([]);
  });
  it("profileHasWeigh", () => {
    expect(profileHasWeigh([{ weigh: false }, { weigh: true }])).toBe(true);
    expect(profileHasWeigh([{ weigh: false }])).toBe(false);
    expect(profileHasWeigh([])).toBe(false);
  });
});

describe("types: ใบเดิมไม่มีแบบ (คอลัมน์ว่าง) ไม่พัง", () => {
  it("mapBoardRow/mapJobDetail: profile null · hasWeigh/goldUnguarded false", () => {
    const b = mapBoardRow({ id: ID, job_no: "JB-1" })!;
    expect(b).toMatchObject({ profileName: null, hasWeigh: false, goldUnguarded: false });
    const j = mapJobDetail({ id: ID, job_no: "JB-1" })!;
    expect(j).toMatchObject({ profileId: null, profileName: null, requireFinalWeight: false, weighRequired: false });
  });
  it("mapStageRow: คอลัมน์ใหม่ไม่มี = ถามชิ้นเสีย (ค่าเริ่ม DB) ไม่ถามเศษ · metalPresent จาก def", () => {
    const s = mapStageRow({ id: "s1", stage_code: "cast", status: "pending", weigh_required: true }, { cast: "หล่อ" }, {}, { cast: true })!;
    expect(s).toMatchObject({ scrapQtyAsk: true, scrapWeightAsk: false, metalPresent: true, weighRequired: true });
    const t = mapStageRow({ id: "s2", stage_code: "qc", status: "pending", scrap_qty_ask: false, scrap_weight_ask: true }, {}, {})!;
    expect(t).toMatchObject({ scrapQtyAsk: false, scrapWeightAsk: true, metalPresent: false });
  });
});

describe("finalWeightRequired — กติกาเดียวกับ DB (job_done)", () => {
  it("แบบบังคับ = บังคับทุกโลหะ · ทองที่มีขั้นชั่ง = บังคับ · ทองไม่ชั่งเลย/เงิน = ไม่บังคับ", () => {
    expect(finalWeightRequired({ requireFinalWeight: true, metal: "silver", hasWeigh: false })).toBe(true);
    expect(finalWeightRequired({ requireFinalWeight: false, metal: "gold", hasWeigh: true })).toBe(true);
    expect(finalWeightRequired({ requireFinalWeight: false, metal: "gold", hasWeigh: false })).toBe(false);
    expect(finalWeightRequired({ requireFinalWeight: false, metal: "silver", hasWeigh: true })).toBe(false);
    expect(finalWeightRequired({ requireFinalWeight: false, metal: "brass", hasWeigh: true })).toBe(false);
  });
});

describe("analyzePicker — แบบ × ขั้นของใบนี้", () => {
  const st = (code: string, nameTh: string, metalPresent = true) => ({ code, nameTh, metalPresent });
  const flags = [{ stageCode: "cast", weigh: true, scrapQty: true, scrapWeight: false }, { stageCode: "file", weigh: true, scrapQty: false, scrapWeight: true }];
  const names = { cast: "หล่อ", file: "ตะไบ", polish: "ขัด" };
  it("lookup เฉพาะขั้นที่ติ๊ก · ขั้นที่แบบตั้งชั่งแต่ใบไม่ผ่าน = weighNotInJob", () => {
    const a = analyzePicker({ requireFinalWeight: false, stages: flags }, [st("cast", "หล่อ"), st("polish", "ขัด")], "silver", names);
    expect(a).toMatchObject({ weigh: ["หล่อ"], scrapQty: ["หล่อ"], scrapWeight: [], weighNotInJob: ["ตะไบ"], weighNoMatch: false, goldUnguarded: [], finalRequired: false });
  });
  it("แบบมีขั้นชั่งแต่ใบไม่มีขั้นชั่งเลย = weighNoMatch · แบบไม่ชั่งเลย ไม่ใช่ weighNoMatch", () => {
    expect(analyzePicker({ requireFinalWeight: false, stages: flags }, [st("polish", "ขัด")], "silver", names).weighNoMatch).toBe(true);
    expect(analyzePicker({ requireFinalWeight: false, stages: [] }, [st("polish", "ขัด")], "silver", names).weighNoMatch).toBe(false);
  });
  it("ทอง: ขั้นโลหะไม่ชั่ง = goldUnguarded ตามชื่อขั้น · ขั้นไม่มีโลหะไม่นับ · เงินไม่มี", () => {
    const stages = [st("wax", "เทียน", false), st("cast", "หล่อ"), st("polish", "ขัด")];
    expect(analyzePicker({ requireFinalWeight: false, stages: flags }, stages, "gold", names)).toMatchObject({ goldUnguarded: ["ขัด"], finalRequired: true });
    expect(analyzePicker({ requireFinalWeight: false, stages: flags }, stages, "silver", names).goldUnguarded).toEqual([]);
    expect(analyzePicker({ requireFinalWeight: false, stages: [] }, stages, "gold", names)).toMatchObject({ goldUnguarded: ["หล่อ", "ขัด"], finalRequired: false });
  });
  it("requireFinalWeight ของแบบ = บังคับ (เงิน)", () => {
    expect(analyzePicker({ requireFinalWeight: true, stages: [] }, [st("cast", "หล่อ")], "silver").finalRequired).toBe(true);
  });
});
