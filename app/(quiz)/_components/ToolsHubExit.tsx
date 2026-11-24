"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { LeaveSheet } from "./LeaveSheet";
import { ToolsHubLink, type ToolsHubLinkVariant } from "./ToolsHubLink";

// ToolsHubExit — ลิงก์ไป hub ที่ "ถามก่อนออกเมื่อมีงานค้าง" (ux-tools-navigation §5 · มติเจ้าของ 24 พ.ย. 69)
//   dirty=false → เป็น <a href> ปกติทุกประการ (ไม่ถาม — N6)
//   dirty=true  → คลิกซ้ายธรรมดา: preventDefault + เปิด LeaveSheet · "อยู่ต่อ"/Esc/พื้นหลัง = ปิดแล้วคืนโฟกัสมาที่ลิงก์ · "ออก" = ลิงก์ hub ใน sheet
//   คลิกที่ตั้งใจเปิดแท็บ/หน้าต่างใหม่ (Ctrl/Cmd/Shift/Alt · ปุ่มกลาง) ไม่ดัก — หน้านี้ในแท็บเดิมไม่เสียอะไร
//   JS ไม่ทำงาน/sheet พัง = ลิงก์ยังพาไป hub ได้โดยไม่ถาม (ยอมรับ — spec §5.1)
// ไม่มี state ของงาน — ผู้เรียกบอก dirty ผ่าน prop (คำนวณจาก state ที่มีอยู่แล้ว)

export function ToolsHubExit({
  variant = "nav",
  dirty,
  leaveBody,
  className,
}: {
  variant?: ToolsHubLinkVariant;
  dirty: boolean;
  leaveBody: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const openerRef = useRef<HTMLElement | null>(null);

  // งานค้างหายระหว่างที่ sheet เปิด (เช่น popstate เปลี่ยนจอ) → ปิดและ "ล้าง open" จริง — ไม่งั้น open ค้าง true แล้ว sheet เด้งเองตอน dirty กลับมา
  useEffect(() => {
    if (!dirty) setOpen(false);
  }, [dirty]);

  // Back ของเครื่องตอน sheet เปิด: จอข้างหลังเปลี่ยน → ปิด sheet (ไม่ค้างทับจอใหม่)
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("popstate", close);
    return () => window.removeEventListener("popstate", close);
  }, [open]);

  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!dirty) return;
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    openerRef.current = e.currentTarget;
    setOpen(true);
  };

  const stay = () => {
    setOpen(false);
    const opener = openerRef.current;
    // คืนโฟกัสหลัง sheet ถอด (portal unmount) — กัน focus ตกไป body
    if (opener) queueMicrotask(() => opener.isConnected && opener.focus());
  };

  return (
    <>
      <ToolsHubLink variant={variant} className={className} onClick={onClick} />
      {open ? <LeaveSheet body={leaveBody} onStay={stay} /> : null}
    </>
  );
}
