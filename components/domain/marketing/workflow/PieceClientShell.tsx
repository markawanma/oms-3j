"use client";

// PieceClientShell — context ร่วมของหน้าชิ้นงาน (นาฬิกาเวลาอ่าน + สวิตช์ "โหมดแก้เนื้อหา")
// หน้า (server component) ห่อเนื้อหาด้วยตัวนี้ → GateCard "ต้องแก้ข้อความ" เปิดโหมดแก้ที่การ์ดเนื้อหาได้ โดยไม่ต้องลาก state ผ่าน server

import { createContext, useCallback, useContext, useState } from "react";
import type { ReactNode } from "react";
import { ReviewClockProvider } from "@/components/domain/marketing/workflow/ReviewClock";

interface EditModeValue {
  editing: boolean;
  setEditing: (v: boolean) => void;
  /** เปิดโหมดแก้ + เลื่อนไปที่การ์ดแก้เนื้อหา */
  openEditor: () => void;
}

const EditModeContext = createContext<EditModeValue | null>(null);

export const EDIT_CARD_ID = "piece-edit-card";

export function PieceClientShell({ children }: { children: ReactNode }) {
  const [editing, setEditing] = useState(false);
  const openEditor = useCallback(() => {
    setEditing(true);
    // รอให้การ์ด render ก่อนเลื่อน
    setTimeout(() => document.getElementById(EDIT_CARD_ID)?.scrollIntoView({ block: "start", behavior: "smooth" }), 50);
  }, []);
  return (
    <ReviewClockProvider>
      <EditModeContext.Provider value={{ editing, setEditing, openEditor }}>{children}</EditModeContext.Provider>
    </ReviewClockProvider>
  );
}

export function useEditMode(): EditModeValue {
  const ctx = useContext(EditModeContext);
  if (!ctx) return { editing: false, setEditing: () => {}, openEditor: () => {} };
  return ctx;
}
