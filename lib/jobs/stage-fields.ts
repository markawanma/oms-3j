// lib/jobs/stage-fields.ts — "หน้าช่างต้องแสดงช่อง/ปุ่มอะไรในขั้นนี้" (0176 · pure · ไม่แตะ DB)
// ตัดสินจาก flag ที่ DB ส่งมา (job_worker_resolve) เท่านั้น — ไม่คำนวณกติกาเอง · ด่านจริงอยู่ที่ DB (weight_required / scrap_weight_not_asked)
// ใบเดิม (hasProfile ไม่ใช่ true) = UI เดิมทุกประการ: ช่องน้ำหนักทุกขั้น + ชิ้นเสีย + เติมโลหะ · ไม่ถามเศษ · ไม่มีบรรทัดบอก
// ไม่มีชื่อแบบ/ป้ายทอง/คำเตือนทอง ในไฟล์นี้ — ช่างเห็นแค่ "ช่องไหนต้องกรอก"

export interface StageFieldInput {
  /** ใบนี้มีแบบการบันทึกไหม (key หาย/ไม่ใช่ true = ใบเดิม) */
  hasProfile?: boolean;
  weightRequired: boolean;
  /** key หาย = ค่าเริ่มของ DB (ถามชิ้นเสีย) */
  scrapQtyAsk?: boolean;
  /** key หาย = ไม่ถามเศษ */
  scrapWeightAsk?: boolean;
  /** ช่างกด "+ แจ้งของเสียในขั้นนี้" เปิด stepper เองแล้ว (เฉพาะขั้นที่ไม่ถามชิ้นเสีย) */
  scrapOpen?: boolean;
}

export interface StageFieldPlan {
  legacy: boolean;
  /** ช่องน้ำหนักเข้า/ออก */
  showWeight: boolean;
  /** แสดง ScrapStepper (ถามชิ้นเสีย หรือช่างเปิดเอง) */
  showScrapStepper: boolean;
  /** แสดงปุ่ม dashed "+ แจ้งของเสียในขั้นนี้" (ขั้นที่ไม่ถามชิ้นเสียและยังไม่เปิด) */
  showScrapButton: boolean;
  /** ช่องเศษโลหะ (เฉพาะใบที่มีแบบ) */
  showScrapWeight: boolean;
  /** ปุ่ม + เติมโลหะ */
  showAddMetal: boolean;
  /** บรรทัดบอกบนจอรับงาน (null = ไม่แสดง) */
  receiveNote: string | null;
  /** บรรทัดบอกบนจอส่งต่อ — เมื่อช่างเปิด stepper ของเสียแล้วจะไม่บอกว่า "ไม่ต้องแจ้งของเสีย" */
  sendNote: string | null;
}

export function stageFieldPlan(i: StageFieldInput): StageFieldPlan {
  const legacy = i.hasProfile !== true;
  const asksScrap = legacy || i.scrapQtyAsk !== false;
  const showScrapStepper = asksScrap || i.scrapOpen === true;
  const showScrapWeight = !legacy && i.scrapWeightAsk === true;
  const showWeight = legacy || i.weightRequired;
  let receiveNote: string | null = null;
  let sendNote: string | null = null;
  if (!legacy && !i.weightRequired) {
    receiveNote = i.scrapQtyAsk === false && i.scrapWeightAsk !== true ? "ขั้นนี้ไม่ต้องบันทึกอะไร — กดรับงานได้เลย" : "ขั้นนี้ไม่ต้องชั่งน้ำหนัก";
    sendNote = !showScrapStepper && !showScrapWeight ? "ขั้นนี้ไม่ต้องชั่งหรือแจ้งของเสีย — กดส่งต่อได้เลย" : "ขั้นนี้ไม่ต้องชั่งน้ำหนัก";
  }
  return { legacy, showWeight, showScrapStepper, showScrapButton: !showScrapStepper, showScrapWeight, showAddMetal: legacy || i.weightRequired, receiveNote, sendNote };
}
