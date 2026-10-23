"use client";

// PrintFileTitle — ตั้ง document.title เป็นชื่อไฟล์ตอนบันทึกหน้าพิมพ์เป็น PDF (Chrome/Edge ใช้ title เป็นชื่อไฟล์ · root layout ตั้งเป็น "3J Insight" ทุกหน้า)
// ไม่ render อะไรเลย (null) → markup ที่พิมพ์ไม่เปลี่ยน · ไม่แตะหน้าอื่น
//
// ทำไมไม่ใช้ generateMetadata: ข้อมูลใบ (เลข/วันที่/ชื่อ) โหลดอยู่ใน page.tsx แล้ว — generateMetadata จะต้อง query ซ้ำ (getJobDetail/getQuote ไม่ได้ cache) · ที่นี่ใช้ข้อมูลชุดเดียวกัน
//
// สองโหมด:
//  · whileMounted (ค่าเริ่ม · หน้าพิมพ์ที่เป็น route) — ตั้งทันทีที่ mount คงไว้จน unmount (ครอบคลุม share/print จากมือถือที่ไม่ยิง beforeprint) + ตั้งซ้ำตอน beforeprint กันมีใครทับ
//  · printOnly (โปสเตอร์ใน modal — title ของหน้าอื่นต้องไม่เปลี่ยนตอนแค่เปิด modal) — ตั้งใน beforeprint คืนใน afterprint · unmount ระหว่างพิมพ์ก็คืน
// คืนค่าเดิมเฉพาะเมื่อ title ยังเป็นของเรา — ถ้า Next เปลี่ยนหน้าแล้วตั้ง title ใหม่ไปก่อน จะไม่เขียนทับ
// title ว่าง = ไม่ทำอะไร (ข้อมูลไม่พอ → คง "3J Insight" เดิม)

import { useEffect } from "react";

export function PrintFileTitle({ title, printOnly = false }: { title: string; printOnly?: boolean }) {
  useEffect(() => {
    if (title === "") return;
    let saved: string | null = null;

    const apply = () => {
      if (document.title === title) return;
      if (saved === null) saved = document.title;
      document.title = title;
    };
    const restore = () => {
      if (saved !== null && document.title === title) document.title = saved;
      saved = null;
    };

    if (!printOnly) apply();
    window.addEventListener("beforeprint", apply);
    if (printOnly) window.addEventListener("afterprint", restore);
    return () => {
      window.removeEventListener("beforeprint", apply);
      window.removeEventListener("afterprint", restore);
      restore();
    };
  }, [title, printOnly]);

  return null;
}
