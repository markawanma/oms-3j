// lib/jobs/messages.ts — แปลง code/hint ของระบบใบงานเป็นภาษาไทยสั้นๆ (pure · ใช้ได้ทั้ง server และ client)
//  - ช่าง: RPC ฝั่งช่างคืน {ok:false, code, message} — ใช้ตารางนี้ก่อน (ถ้อยคำสั้น เหมาะจอมือถือ) ไม่มี code ในตาราง = ใช้ message ของ DB ถ้าสะอาด
//  - ออฟฟิศ: RPC raise 22023 + hint — ใช้ข้อความ DB (ไทย มีเลขงาน/จำนวนที่ช่วยตัดสินใจ) ถ้าสะอาด ไม่งั้นตารางนี้
// ข้อความที่ผ่านฟังก์ชันนี้ต้องไม่มี: snake_case · ชื่อตาราง/ฟังก์ชัน · SQL · token/PIN ใดๆ

export const WORKER_CODE_TH: Record<string, string> = {
  invalid_token: "ลิงก์หรือ QR นี้ใช้ไม่ได้ — ขอพิมพ์ใบงานใหม่จากออฟฟิศ",
  rate_limited: "ลองบ่อยเกินไป รอสักครู่แล้วลองใหม่",
  bad_credentials: "ชื่อหรือ PIN ไม่ถูกต้อง",
  locked: "ใส่ PIN ผิดหลายครั้ง ถูกล็อกชั่วคราว — รอสักครู่ หรือให้ออฟฟิศรีเซ็ต PIN",
  locked_office: "ล็อกแล้ว ให้ออฟฟิศปลดล็อก",
  token_budget_exhausted: "ใบนี้ใส่ PIN ผิดเกินกำหนด ขอพิมพ์ใบใหม่จากออฟฟิศ",
  // 0174: ผู้รับต้องชั่งแบบไม่รู้คำตอบ — ห้ามบอกขนาดส่วนต่าง/น้ำหนักขั้นก่อนในข้อความ
  handoff_mismatch: "น้ำหนักที่รับไม่ตรงกับที่ขั้นก่อนส่งมา — ชั่งใหม่ ถ้ายังไม่ตรงให้แจ้งออฟฟิศ",
  session_required: "เลือกชื่อและใส่ PIN ก่อน",
  job_closed: "ใบงานนี้ปิดแล้ว",
  job_not_found: "ไม่พบใบงานนี้",
  job_on_hold: "ใบงานถูกพักอยู่ — รอออฟฟิศ",
  awaiting_deposit: "รอมัดจำ — ยังเริ่มผลิตไม่ได้",
  already_received: "มีคนรับขั้นนี้ไปแล้ว",
  all_done: "งานนี้ทำครบแล้ว รอออฟฟิศปิดงาน",
  already_sent: "ส่งขั้นนี้ไปแล้ว",
  not_holder: "ขั้นนี้ไม่ได้อยู่กับคุณ",
  not_received: "ยังไม่ได้รับงานขั้นนี้",
  out_of_order: "งานเปลี่ยนไปแล้ว — กดปุ่มโหลดใหม่ด้านล่าง",
  stage_changed: "งานเปลี่ยนไปแล้ว — กดปุ่มโหลดใหม่ด้านล่าง",
  stage_not_allowed: "ขั้นนี้ไม่ใช่ขั้นของคุณ",
  prev_not_sent: "ขั้นก่อนหน้ายังไม่กดส่งพร้อมน้ำหนัก — ให้เขากดส่งก่อน หรือแจ้งออฟฟิศ",
  weight_invalid: "น้ำหนักไม่ถูกต้อง (ตัวเลขมากกว่า 0 ทศนิยมไม่เกิน 3 ตำแหน่ง)",
  // 0176: ขั้นต้องชั่งแต่ไม่มีน้ำหนักมา = หน้าจอเก่า (ออฟฟิศเปลี่ยนแบบการบันทึกระหว่างที่ช่างเปิดค้าง) — ปุ่มโหลดใหม่ขึ้นคู่กัน
  weight_required: "ออฟฟิศเพิ่งเปลี่ยนวิธีบันทึกของขั้นนี้ — โหลดหน้าใหม่",
  weight_over: "น้ำหนักออกมากกว่าน้ำหนักเข้า — ถ้าเติมโลหะให้ใส่ช่อง “เติมโลหะ”",
  // 0178 — ข้อความตายตัว ไม่มีตัวเลขน้ำหนัก (N1 ทอง) · not_asked = หน้าจอค้างเก่า/ยิงตรง → ให้โหลดใหม่
  scrap_weight_not_asked: "ขั้นนี้ไม่ได้บันทึกเศษโลหะ — กดปุ่มโหลดใหม่ด้านล่าง",
  scrap_over: "น้ำหนักเศษมากกว่าส่วนที่หายไป — ชั่งใหม่",
  qty_invalid: "จำนวนไม่ถูกต้อง",
  reason_required: "เลือกเหตุผลของเสีย",
  reason_unexpected: "ไม่มีของเสีย ไม่ต้องเลือกเหตุผล",
  note_required: "ต้องมีหมายเหตุประกอบ",
  note_invalid: "หมายเหตุไม่ถูกต้อง",
  who_required: "ต้องระบุผู้รับงาน",
  date_invalid: "วันที่ไม่ถูกต้อง",
  // 0181 — ส่วนย่อย (ส่งต่อ n จาก N) · ส่วนต่างรอชี้แจง · ข้อความตายตัว ไม่มีตัวเลข/ชื่อ
  invalid_part: "ไม่พบส่วนนี้ในใบงาน — กดปุ่มโหลดใหม่",
  qty_hold_required: "ต้องระบุจำนวนที่ถืออยู่ — กดปุ่มโหลดใหม่แล้วลองอีกครั้ง",
  weight_unexpected: "การแยกส่วนนับจำนวนอย่างเดียว ไม่ต้องชั่งน้ำหนัก — กดปุ่มโหลดใหม่",
  not_splitter: "ยกเลิกได้เฉพาะส่วนที่คุณแยกเอง และยังเป็นผู้ถือขั้นนี้",
  cannot_return: "ผู้ถือเดิมส่งส่วนที่เหลือไปแล้ว คืนชิ้นไม่ได้ — แจ้งออฟฟิศ",
  scrap_recorded: "การแยกครั้งนี้มีของเสียที่บันทึกไว้ คืนชิ้นไม่ได้ — แจ้งออฟฟิศ",
  has_discrepancy: "ส่วนนี้มีส่วนต่างบันทึกอยู่ — แจ้งออฟฟิศ",
  discrepancy_open: "ส่วนนี้มีส่วนต่างรอชี้แจง — ชี้แจงก่อน",
  not_sender: "ชี้แจงได้เฉพาะผู้ส่งงานขั้นนั้น (หรือผู้ดูแลงานนอกร้าน)",
  kind_invalid: "ต้องเลือกว่าเสียหายหรือหาย",
  already_resolved: "ส่วนต่างนี้ชี้แจงแล้วหรือถูกยกเลิกแล้ว",
  reason_invalid: "เหตุผลมีอักขระที่ไม่อนุญาตหรือยาวเกินไป",
  disposition_invalid: "ช่างยกเลิกได้เฉพาะแบบคืนชิ้นให้ผู้ถือเดิม",
  has_split: "ส่วนนี้มีส่วนที่แยกต่อออกไปแล้ว — ยกเลิกส่วนนั้นก่อน",
  not_lot: "ไม่พบส่วนย่อยนี้",
  // 0181 (security H1/H2) — ข้อความตายตัว ไม่มีตัวเลขน้ำหนัก (N1)
  weight_move_required: "ทองที่ขั้นชั่ง: ต้องชั่งน้ำหนักส่วนที่แยกออกก่อน",
  office_required: "ส่วนต่างของงานทองที่มีน้ำหนักเทียบ ให้ออฟฟิศเป็นผู้ชี้แจง — แจ้งออฟฟิศ",
};

/** hint ที่ RPC ออฟฟิศ raise (22023/55000) — ใช้เป็นข้อความสำรองเมื่อข้อความ DB ไม่สะอาด */
export const OFFICE_HINT_TH: Record<string, string> = {
  actor_required: "ต้องเข้าสู่ระบบก่อนทำรายการ",
  channel_invalid: "ช่องทางบันทึกไม่ถูกต้อง",
  due_invalid: "กำหนดส่งต้องไม่ย้อนหลังและไม่เกิน 2 ปีข้างหน้า",
  item_not_found: "ไม่พบรายการนี้",
  job_closed: "ใบงานนี้ปิดแล้ว แก้ไขไม่ได้",
  job_exists: "รายการนี้มีใบงานอยู่แล้ว",
  job_not_found: "ไม่พบใบงานนี้",
  metal_unsupported: "โลหะของรายการนี้สร้างใบงานไม่ได้ (รองรับเงิน/ทอง/ทองเหลือง)",
  not_oem: "ใช้กับงาน OEM เท่านั้น",
  nothing_to_reopen: "ยังไม่มีความคืบหน้าให้ย้อน",
  pin_invalid: "PIN ต้องเป็นเลข 4 หลัก และห้ามซ้ำ/เรียงต่อเนื่อง/เดาง่าย",
  po_not_open: "ใบผลิตนี้ไม่ได้เปิดอยู่ สร้างใบงานไม่ได้",
  qty_exceeds_final: "จำนวนดีมากกว่าจำนวนที่เหลือจากขั้นสุดท้าย",
  qty_mismatch: "จำนวนดี + เสีย ต้องเท่ากับจำนวนที่วางแผน",
  quote_not_won: "สร้างใบงานได้เฉพาะใบเสนอราคาที่ได้งานแล้ว",
  source_invalid: "แหล่งที่มาของใบงานไม่ถูกต้อง",
  stage_not_found: "ไม่พบขั้นตอนนี้ในใบงาน",
  stage_not_pending: "ข้ามได้เฉพาะขั้นที่ยังไม่ได้รับงาน",
  stages_duplicate: "เลือกขั้นตอนซ้ำกัน",
  stages_empty: "เลือกขั้นตอนอย่างน้อยหนึ่งขั้น",
  stages_required: "เลือกขั้นที่ช่างทำอย่างน้อย 1 ขั้น",
  text_invalid: "ชื่อห้ามมีเครื่องหมาย < หรือ >",
  stage_required: "ขั้นนี้ข้ามไม่ได้ (ตรวจ QC และแพ็กต้องผ่านทุกใบงาน)",
  design_label_required: "ใบงาน OEM ต้องตั้งชื่อเรียกภายในก่อนสร้าง (ช่างเห็นชื่อนี้ — ห้ามมีชื่อแบรนด์ลูกค้า)",
  stages_invalid: "รายการขั้นตอนไม่ถูกต้อง",
  stages_need_qc_pack: "ต้องมีขั้น ตรวจ QC และ แพ็ก",
  stages_open: "ปิดงานไม่ได้ — ยังมีขั้นที่ยังไม่เสร็จ",
  stages_order: "ลำดับขั้นตอนไม่ถูกต้อง",
  stages_unknown: "มีขั้นตอนที่ไม่อยู่ในทะเบียน",
  start_gate_required: "ดีลนี้ยังไม่มีมัดจำ — ต้องระบุเหตุผลที่เริ่มผลิตก่อน",
  token_cap: "ใบงานนี้มี QR ใช้งานครบ 5 ใบแล้ว — เพิกถอนก่อนพิมพ์เพิ่ม",
  use_pin_set: "แก้ช่างเดิมไม่รับ PIN — ใช้ปุ่มรีเซ็ต PIN",
  weight_invalid: "น้ำหนักไม่ถูกต้อง",
  weight_required: "ต้องระบุน้ำหนัก",
  worker_name_taken: "มีช่างชื่อนี้อยู่แล้ว",
  worker_not_found: "ไม่พบช่างคนนี้",
  // 0175 — จำนวนสั่ง/เผื่อ/แผนโลหะ/ของเหลือ (ไม่มีตัวเลขน้ำหนักทอง — ข้อความนี้ออฟฟิศเห็นเท่านั้น)
  qty_planned_invalid: "จำนวนเริ่มผลิตต้องเป็นจำนวนเต็ม 1–100,000",
  target_invalid: "น้ำหนักเป้าหมายต่อชิ้นต้องมากกว่า 0 ไม่เกิน 10,000 กรัม (ทศนิยมไม่เกิน 3 ตำแหน่ง)",
  plan_target_required: "ตั้งแผนโลหะเองได้เมื่อมีน้ำหนักเป้าหมายต่อชิ้น",
  plan_override_missing: "ระบุน้ำหนักโลหะที่กำหนดเองก่อน หรือเอาเหตุผลออก",
  plan_override_invalid: "น้ำหนักโลหะที่กำหนดเองต้องมากกว่า 0 ไม่เกิน 100,000 กรัม",
  plan_reason_required: "ต้องระบุเหตุผลที่กำหนดน้ำหนักโลหะเอง",
  plan_too_large: "โลหะที่ต้องเตรียมเกิน 100,000 กรัม — ตรวจจำนวน/น้ำหนักต่อชิ้น",
  plan_drift: "แผนโลหะไม่ตรงกับจำนวน/น้ำหนักเป้าหมาย — รีเฟรชแล้วลองใหม่",
  plan_override_stale: "ใบนี้กำหนดน้ำหนักโลหะเองไว้ — กด “แก้แผน” แล้วเลือก “ใช้ค่าระบบ” ก่อน จึงแก้จำนวนได้",
  target_source_invalid: "ที่มาของน้ำหนักเป้าหมายไม่ถูกต้อง รีเฟรชแล้วลองใหม่",
  started: "ใบงานนี้เริ่มผลิตแล้ว แก้ไม่ได้",
  cast_started: "ขั้นหล่อถูกรับแล้ว แก้แผนโลหะไม่ได้",
  no_surplus: "ใบงานนี้ไม่มีของเหลือให้ตัดสิน",
  surplus_fixed: "ของเหลือของใบผลิตเข้าสต็อกตอนปิดใบผลิต เปลี่ยนที่นี่ไม่ได้",
  surplus_invalid: "เลือกการจัดการของเหลือ: ถือไว้ก่อน / อะไหล่-ตัวอย่าง / ส่งแถมลูกค้า",
  surplus_production_stock_only: "ใบงานของใบผลิต: ของเหลือเข้าสต็อกเสมอ",
  surplus_oem_no_stock: "งาน OEM: ของเหลือเป็นของลูกค้า เข้าสต็อกอัตโนมัติไม่ได้",
  surplus_unexpected: "ไม่มีของเหลือ (จำนวนดีไม่เกินจำนวนที่สั่ง) จึงไม่ต้องระบุการจัดการของเหลือ",
  stage_codes_invalid: "รายการขั้นตอนไม่ถูกต้อง",
  // 0176 — แบบการบันทึก (ข้อความสำรองเมื่อข้อความ DB ไม่สะอาด · ไม่มีน้ำหนัก/ราคา)
  name_dup: "มีแบบชื่อนี้อยู่แล้ว",
  name_required: "ต้องตั้งชื่อแบบ",
  default_cannot_close: "ปิดแบบที่เป็นค่าเริ่มไม่ได้ — ตั้งแบบอื่นเป็นค่าเริ่มก่อน",
  default_required: "ค่าเริ่มของงานทั่วไปล้างไม่ได้ — ตั้งแบบอื่นเป็นค่าเริ่มแทน",
  inactive: "แบบนี้ถูกปิดใช้งานอยู่ — เปิดใช้ก่อนจึงตั้งเป็นค่าเริ่มได้",
  profile_invalid: "แบบที่เลือกถูกปิดใช้หรือแก้ไปแล้ว — เลือกใหม่",
  profile_required: "ใบงานใหม่ต้องมีแบบการบันทึก",
  profile_not_found: "ไม่พบแบบการบันทึกนี้",
  no_default_profile: "ยังไม่มีค่าเริ่ม — ตั้งค่าที่หน้า แบบการบันทึก ก่อน",
  flag_not_applicable: "ขั้นที่ยังไม่มีโลหะ ชั่งหรือบันทึกเศษไม่ได้",
  scope_invalid: "ค่าเริ่มต้องเป็นงานทั่วไปหรืองานทอง",
  stage_invalid: "รายการขั้นของแบบไม่ถูกต้อง",
  stage_dup: "มีขั้นซ้ำในแบบ",
  seq_invalid: "ลำดับของแบบไม่ถูกต้อง",
  profile_no_delete: "ลบแบบการบันทึกไม่ได้ — ปิดใช้งานแทน",
  weigh_drift: "กติกาชั่งของใบไม่ตรงกับขั้น — เปลี่ยนแบบใหม่อีกครั้ง",
  // 0178 — เศษโลหะ (ออฟฟิศ) · ชื่อแบบการบันทึกไม่ผ่าน (ว่าง/ล่องหน/ขึ้นบรรทัดใหม่/ยาวเกิน)
  scrap_over: "น้ำหนักเศษมากกว่าส่วนที่หายไป — ชั่งใหม่",
  // 0181 — ส่วนย่อย/ส่วนต่าง/QR หลายใบ (ข้อความสำรองเมื่อข้อความ DB ไม่สะอาด)
  weight_move_required: "ทองที่ขั้นชั่ง: ต้องชั่งน้ำหนักส่วนที่แยกออกก่อน",
  weight_unexpected: "ขั้นนี้ไม่ต้องชั่งน้ำหนักตอนแยกส่วน (นับจำนวนอย่างเดียว)",
  weight_over: "น้ำหนักส่วนที่แยกมากเกินน้ำหนักที่ถืออยู่ — ต้องเหลือให้ผู้ถือ ชั่งใหม่",
  qty_hold_required: "ต้องระบุจำนวนที่ถืออยู่ — โหลดหน้าใหม่แล้วลองอีกครั้ง",
  parts_open: "ปิดใบงานไม่ได้ — ยังมีส่วนย่อยที่ยังไม่ปิด หรือส่วนต่างรอชี้แจง",
  has_parts: "ยกเลิกใบแม่ไม่ได้ — มีส่วนย่อยอยู่ (ยกเลิก/ปิดส่วนย่อยก่อน)",
  use_lot_cancel: "ส่วนย่อยยกเลิกด้วย \"ยกเลิกส่วน\" (ต้องเลือกที่ไปของชิ้น)",
  has_split: "ย้อนขั้นไม่ได้ — ขั้นนี้มีการแยกส่วน/ส่วนต่างอ้างอิงอยู่",
  lot_no_token: "ออก QR ให้ส่วนย่อยไม่ได้ — ออกให้ใบแม่ (QR ใบแม่เปิดหน้าเดียวกันทุกส่วน)",
  lot_invalid: "ส่วนย่อยที่ระบุไม่ถูกต้อง",
  purpose_invalid: "ชนิด QR ไม่ถูกต้อง",
  token_not_found: "ไม่พบ QR ใบที่ระบุ หรือถูกเพิกถอนไปแล้ว",
  stage_changed: "ข้อมูลงานเปลี่ยนไป กรุณารีเฟรชหน้าแล้วลองใหม่",
  qty_invalid: "จำนวนไม่ถูกต้อง",
  not_lot: "ไม่พบส่วนย่อยนี้",
  disposition_invalid: "ต้องเลือกที่ไปของชิ้น: คืนให้ผู้ถือเดิม หรือนับเป็นของเสีย",
  cannot_return: "ผู้ถือเดิมส่งส่วนที่เหลือไปแล้ว คืนชิ้นไม่ได้",
  scrap_recorded: "การแยกครั้งนี้มีของเสียที่บันทึกไว้ — ยกเลิกเป็นของเสียแทน",
  already_received: "มีคนรับส่วนนี้ไปแล้ว",
  discrepancy_open: "ส่วนนี้มีส่วนต่างรอชี้แจง — ชี้แจงก่อน",
  discrepancy_not_found: "ไม่พบส่วนต่างนี้",
  already_resolved: "ส่วนต่างนี้ชี้แจงแล้วหรือถูกยกเลิกแล้ว",
  voided: "ส่วนต่างนี้ถูกยกเลิกไปแล้ว",
  kind_invalid: "ต้องเลือกว่าเสียหาย (scrap) หรือหาย (lost)",
  reason_required: "ต้องระบุเหตุผล",
  name_invalid: "ชื่อแบบไม่ถูกต้อง — ห้ามเว้นว่าง ห้ามขึ้นบรรทัดใหม่/อักขระล่องหน และยาวไม่เกิน 60 ตัวอักษร",
};

export const GENERIC_JOB_ERROR = "ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง";
const NO_PERMISSION = "เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ใช้งานส่วนนี้ได้";

const THAI = /[฀-๿]/;
const TECHNICAL = /\b(select|insert|update\s+\w+\s+set|delete from|syntax error|violates|constraint|stack|traceback|permission denied|pg_)\b|ERROR:|analytics\.|[a-z]+_[a-z_]+|\bp_[a-z]/i;

function showable(text: unknown): text is string {
  return typeof text === "string" && text.length > 0 && text.length <= 300 && THAI.test(text) && !TECHNICAL.test(text);
}

/** ตัวเลขประกอบข้อความจาก RPC ฝั่งช่าง (0173) — ผู้เรียกกรองชนิดแล้ว (number จำกัดช่วง / string สั้น) */
export interface WorkerFailExtra {
  attemptsLeft?: number | null;
  attemptsUntilOffice?: number | null;
  tokenBudgetLeft?: number | null;
  retryAfterSeconds?: number | null;
  by?: string | null;
}

/** รอเป็นนาที ปัดขึ้น (เช่น 900 วิ = 15 นาที · 61 วิ = 2 นาที) */
export function waitMinutes(seconds: number): number {
  return Math.max(1, Math.ceil(seconds / 60));
}

/**
 * ข้อความของผลฝั่งช่าง {ok:false, code, message} → ไทยสั้น (ตารางก่อน · แล้ว message ของ DB ถ้าสะอาด · แล้วข้อความกลาง)
 * extra (0173): PIN ผิด -> เตือนจำนวนครั้งที่เหลือตั้งแต่ครั้งที่ 3 · locked -> รอกี่นาที · handoff_mismatch -> ข้อความตายตัว ไม่บอกส่วนต่าง/น้ำหนักขั้นก่อน (0174 N1 — ห้ามเติม gap_g กลับ) · รับขั้นแพ้ -> ชื่อผู้ชนะ
 */
export function workerFailMessage(code: unknown, dbMessage: unknown, extra?: WorkerFailExtra): string {
  const known = typeof code === "string" && Object.prototype.hasOwnProperty.call(WORKER_CODE_TH, code);
  const x = extra ?? {};
  if (code === "bad_credentials") {
    // เตือนทีละประโยค: เอาอันที่ "ใกล้ล็อกที่สุด" (เหลือครั้งน้อยสุด) · เท่ากัน = อันหนักกว่าก่อน (ล็อกทั้งใบ > ล็อกจนออฟฟิศปลด > ล็อกชั่วคราว)
    const warns: { left: number; severity: number; text: string }[] = [];
    if (typeof x.attemptsLeft === "number" && x.attemptsLeft >= 1 && x.attemptsLeft <= 2) warns.push({ left: x.attemptsLeft, severity: 1, text: `เหลืออีก ${x.attemptsLeft} ครั้งก่อนถูกล็อกชั่วคราว` });
    if (typeof x.attemptsUntilOffice === "number" && x.attemptsUntilOffice >= 1 && x.attemptsUntilOffice <= 3) warns.push({ left: x.attemptsUntilOffice, severity: 2, text: `เหลืออีก ${x.attemptsUntilOffice} ครั้งจะถูกล็อกจนกว่าออฟฟิศปลดล็อก` });
    if (typeof x.tokenBudgetLeft === "number" && x.tokenBudgetLeft >= 0 && x.tokenBudgetLeft <= 3) warns.push({ left: x.tokenBudgetLeft, severity: 3, text: `ใบนี้ใส่ PIN ผิดได้อีก ${x.tokenBudgetLeft} ครั้งวันนี้` });
    warns.sort((p, q) => p.left - q.left || q.severity - p.severity);
    return warns.length > 0 ? `${WORKER_CODE_TH.bad_credentials} · ${warns[0].text}` : WORKER_CODE_TH.bad_credentials;
  }
  if (code === "locked") {
    return typeof x.retryAfterSeconds === "number" && x.retryAfterSeconds > 0 ? `ใส่ PIN ผิดหลายครั้ง — ลองใหม่ใน ${waitMinutes(x.retryAfterSeconds)} นาที` : WORKER_CODE_TH.locked;
  }
  if (code === "already_received") {
    if (typeof x.by === "string" && x.by !== "") return `ช่าง ${x.by} รับขั้นนี้ไปแล้ว`;
    if (showable(dbMessage)) return dbMessage;
  }
  if (known) return WORKER_CODE_TH[code as string];
  return showable(dbMessage) ? dbMessage : GENERIC_JOB_ERROR;
}

/** ขั้นก่อนยังไม่ส่ง (prev_not_sent) — ใส่ชื่อขั้นที่ค้างให้ช่างรู้ว่าต้องไปตามใคร */
export function prevNotSentMessage(prevName: string | null): string {
  return prevName ? `ขั้นก่อน (${prevName}) ยังไม่กดส่งพร้อมน้ำหนัก — ให้เขากดส่งก่อน หรือแจ้งออฟฟิศ` : WORKER_CODE_TH.prev_not_sent;
}

/** error ของ RPC ออฟฟิศ (supabase error object) → ไทย · 42501 = ไม่มีสิทธิ์ · hint ที่รู้จัก → ข้อความ DB ถ้าสะอาด ไม่งั้นตาราง */
export function officeErrorMessage(err: unknown, fallback: string = GENERIC_JOB_ERROR): string {
  const e = (typeof err === "object" && err !== null ? err : {}) as { code?: unknown; message?: unknown; hint?: unknown };
  if (e.code === "42501") return NO_PERMISSION;
  const hint = typeof e.hint === "string" ? e.hint : null;
  if ((e.code === "22023" || e.code === "55000") && hint && Object.prototype.hasOwnProperty.call(OFFICE_HINT_TH, hint)) {
    const raw = typeof e.message === "string" ? e.message.replace(/^[a-z][a-z0-9_]*:\s*/i, "") : "";
    return showable(raw) ? raw : OFFICE_HINT_TH[hint];
  }
  if ((e.code === "22023" || e.code === "55000") && typeof e.message === "string") {
    const raw = e.message.replace(/^[a-z][a-z0-9_]*:\s*/i, "");
    if (showable(raw)) return raw;
  }
  return fallback;
}

/** ข้อความสำหรับ log (ห้ามมีข้อความดิบที่อาจมี token/PIN/UUID ผู้ใช้) — เฉพาะ code + ข้อความที่ผ่าน redact ตามที่เรียกใช้ */
export function safeLogShape(err: unknown): { code: string | null; hint: string | null } {
  const e = (typeof err === "object" && err !== null ? err : {}) as { code?: unknown; hint?: unknown };
  return { code: typeof e.code === "string" ? e.code : null, hint: typeof e.hint === "string" ? e.hint : null };
}
