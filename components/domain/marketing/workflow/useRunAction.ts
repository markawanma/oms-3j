"use client";

// useRunAction — pattern เดียวของ "กดปุ่ม → เรียก server action → แสดงผล" (หนี้ §11 ข้อ 1)
//   busy: ปุ่มกันกดซ้ำ · error: ข้อความไทยจาก action (ไม่ใช่ข้อความดิบ) · stale → refresh (ข้อมูลที่เห็นเก่ากว่า DB)
//   สำเร็จ → toast (ถ้าส่ง success) + router.refresh() · exception ที่ไม่คาดคิด → ข้อความกลาง (ไม่โชว์ error ดิบ)
// ใช้แล้วใน: PostCard · การ์ดคัดไอเดีย (IdeaCard/HeldIdeaRow/ChosenRow) · ShootPieceCard · SignalCard · PickIdeaDialog · OrphanPostCard
// ที่ยังซ้ำ pattern เดิม 7 จุด (PieceActionBar · ApprovalCard · GateCard · ConfirmItemList · PostedSheet · PlanForm · AiQuestionCard) — จดหนี้ plan §11 ข้อ 1 / §12ตามทีหลัง

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import type { PieceResult } from "@/lib/marketing/piece-types";

export const GENERIC_ACTION_ERROR = "ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง";

export interface RunOptions {
  /** ข้อความ toast เมื่อสำเร็จ (ไม่ส่ง = ไม่แสดง toast) */
  success?: string;
  /** router.refresh() เมื่อสำเร็จ (ค่าเริ่มต้น true) */
  refresh?: boolean;
}

export function useRunAction() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // กันกดซ้ำแบบเร็วกว่า render (state busy อัปเดตหลังคลิกที่สอง)
  const inFlight = useRef(false);

  const run = useCallback(
    async <T,>(fn: () => Promise<PieceResult<T>>, opts: RunOptions = {}): Promise<PieceResult<T>> => {
      if (inFlight.current) return { ok: false, error: "กำลังทำรายการก่อนหน้า รอสักครู่" };
      inFlight.current = true;
      setBusy(true);
      setError(null);
      try {
        const res = await fn();
        if (!res.ok) {
          setError(res.error);
          if (res.stale) router.refresh();
          return res;
        }
        if (opts.success) toast.push(opts.success);
        if (opts.refresh !== false) router.refresh();
        return res;
      } catch {
        setError(GENERIC_ACTION_ERROR);
        return { ok: false, error: GENERIC_ACTION_ERROR };
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [router, toast]
  );

  return { run, busy, error, setError };
}
