"use client";

// usePlanPreview — ดึง "ตัวอย่างแผน" (จำนวนแนะนำ · โลหะที่ต้องเตรียม) จาก DB ด้วย debounce
// 🔴 ห้ามคำนวณใน client: ทุกตัวเลขมาจาก getJobPlanSuggest (job_plan_suggest) · เปลี่ยนค่า → รอ ~400ms แล้วเรียกซ้ำ · คำตอบเก่าที่มาช้าทิ้ง
// state: idle (ยังไม่ควรถาม เช่นช่องกรอกยังผิด) · loading · error (+retry) · ready

import { useCallback, useEffect, useRef, useState } from "react";
import { getJobPlanSuggest } from "@/lib/actions/job-office";
import type { JobPlanSuggestion } from "@/lib/actions/job-office";
import { GENERIC_JOB_ERROR } from "@/lib/jobs/messages";

export const PLAN_DEBOUNCE_MS = 400;

export type PlanPreviewState = { s: "idle" } | { s: "loading"; prev?: JobPlanSuggestion } | { s: "error"; message: string } | { s: "ready"; data: JobPlanSuggestion };

export interface PlanPreviewArgs {
  kind: "oem" | "production";
  itemId: string | null;
  /** false = ไม่ยิง (idle) */
  enabled: boolean;
  /** null = ไม่ส่ง (ให้ DB ใช้ค่าเริ่ม) */
  qtyPlanned: number | null;
  targetPieceG: string | null;
  stageCodes: string[] | null;
}

export function usePlanPreview(a: PlanPreviewArgs) {
  const [state, setState] = useState<PlanPreviewState>({ s: "idle" });
  const [nonce, setNonce] = useState(0);
  const seq = useRef(0);
  const immediate = useRef(true); // ครั้งแรก/กดลองใหม่ = ยิงทันที ไม่รอ debounce
  const stageKey = a.stageCodes === null ? "-" : a.stageCodes.join(",");
  const stages = useRef(a.stageCodes);
  stages.current = a.stageCodes;

  useEffect(() => {
    const my = ++seq.current;
    if (!a.enabled || a.itemId === null) {
      setState({ s: "idle" });
      return;
    }
    const itemId = a.itemId;
    // เก็บคำตอบล่าสุดไว้ระหว่างรอ (ให้กล่องแนะนำจำนวนไม่กระพริบหาย) — การ์ดโลหะยังขึ้น skeleton และปุ่มสร้างปิด
    setState((p) => ({ s: "loading", prev: p.s === "ready" ? p.data : p.s === "loading" ? p.prev : undefined }));
    const delay = immediate.current ? 0 : PLAN_DEBOUNCE_MS;
    immediate.current = false;
    const timer = setTimeout(async () => {
      try {
        const r = await getJobPlanSuggest(a.kind, itemId, { qtyPlanned: a.qtyPlanned, targetPieceG: a.targetPieceG, stageCodes: stages.current });
        if (my !== seq.current) return;
        setState(r.ok ? { s: "ready", data: r.data } : { s: "error", message: r.error });
      } catch {
        if (my === seq.current) setState({ s: "error", message: GENERIC_JOB_ERROR });
      }
    }, delay);
    return () => clearTimeout(timer);
    // stageKey แทน a.stageCodes (array ใหม่ทุก render) · nonce = กด "ลองใหม่"
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.kind, a.itemId, a.enabled, a.qtyPlanned, a.targetPieceG, stageKey, nonce]);

  const retry = useCallback(() => {
    immediate.current = true;
    setNonce((n) => n + 1);
  }, []);
  return { state, retry };
}
