"use client";

// useSyncedDraft — draft ของช่องแก้ที่ "ตามค่าจาก server" เมื่อ router.refresh() ส่งค่าใหม่มา (BUG-QA-1 + code review blocker)
//
// เมื่อค่าจาก server เปลี่ยน:
//  1. ผู้ใช้ยังไม่ได้แก้ (draft = ค่าตั้งต้น) หรือ draft ตรงกับ server หลัง normalize (trim + ตัดอักขระล่องหน แบบที่ server ทำ) → ตามค่าใหม่เงียบๆ
//  2. server ส่งกลับ "ค่าที่เรา save ไปเอง" (markSaved) → ไม่ใช่การแก้จากที่อื่น: อัปเดตฐาน คง draft ที่พิมพ์ต่อไว้ ไม่เตือน
//  3. นอกนั้น = มีคนอื่นแก้ระหว่างที่พิมพ์ → conflict: ไม่เขียนทับเงียบ ปุ่มบันทึกต้องปิด + แจ้งให้ "โหลดค่าล่าสุด"
// dirty = draft ต่างจากค่าปัจจุบันจาก server (ปุ่มบันทึกเปิดเฉพาะ dirty && !conflict)

import { useRef, useState } from "react";
import { cleanText } from "@/lib/marketing/piece-input";

export function useSyncedDraft(server: string) {
  const [draft, setDraft] = useState(server);
  const [base, setBase] = useState(server);
  const [conflict, setConflict] = useState(false);
  const lastSaved = useRef<string | null>(null);

  if (server !== base) {
    // ปรับ state ระหว่าง render (รูปแบบมาตรฐานของ derived state จาก props)
    setBase(server);
    const saved = lastSaved.current;
    if (draft === base || cleanText(draft) === cleanText(server)) {
      setDraft(server);
      setConflict(false);
    } else if (saved !== null && cleanText(server) === cleanText(saved)) {
      setConflict(false); // ค่าที่เรา save เอง (server อาจ trim/ตัดอักขระล่องหน) — คง draft ที่พิมพ์ต่อ
    } else {
      setConflict(true);
    }
  }

  return {
    draft,
    setDraft,
    conflict,
    dirty: draft !== server,
    /** เรียกหลังบันทึกสำเร็จ (ก่อน router.refresh) — บอกว่าค่าที่ server ส่งกลับมาเป็นของเราเอง */
    markSaved: (value: string) => {
      lastSaved.current = value;
    },
    /** ทิ้ง draft แล้วใช้ค่าล่าสุดจาก server */
    reload: () => {
      setDraft(server);
      setConflict(false);
    },
  };
}
