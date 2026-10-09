"use client";

// useSyncedDraft — draft ของช่องแก้ที่ "ตามค่าจาก server" เมื่อ router.refresh() ส่งค่าใหม่มา (BUG-QA-1)
//
// เดิม useState(server) ครั้งเดียวตอน mount → ตอบ [ต้องยืนยัน] แล้วช่องแก้ยังเป็นข้อความเก่า ปุ่มบันทึกเปิด → เขียนทับคำตอบ
//  - ผู้ใช้ยังไม่ได้แก้ (draft = ค่าที่ใช้ตั้งต้น) → ตามค่าใหม่เงียบๆ
//  - ผู้ใช้กำลังแก้อยู่แล้ว server เปลี่ยน → conflict = true : ไม่เขียนทับเงียบ ปุ่มบันทึกต้องปิด + แจ้งให้ "โหลดค่าล่าสุด"
//  - dirty = draft ต่างจากค่าปัจจุบันจาก server (ปุ่มบันทึกเปิดเฉพาะ dirty && !conflict)

import { useState } from "react";

export function useSyncedDraft(server: string) {
  const [draft, setDraft] = useState(server);
  const [base, setBase] = useState(server);
  const [conflict, setConflict] = useState(false);

  if (server !== base) {
    // ปรับ state ระหว่าง render (รูปแบบมาตรฐานของ derived state จาก props)
    setBase(server);
    if (draft === base) {
      setDraft(server);
      setConflict(false);
    } else {
      setConflict(true);
    }
  }

  return {
    draft,
    setDraft,
    conflict,
    dirty: draft !== server,
    /** ทิ้ง draft แล้วใช้ค่าล่าสุดจาก server */
    reload: () => {
      setDraft(server);
      setConflict(false);
    },
  };
}
