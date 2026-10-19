"use client";

// useOfficeRun — pattern เดียวของปุ่มฝั่งออฟฟิศ: busy · error ไทย · toast · router.refresh (ล้มกลางทาง = ไม่ refresh · ค่าที่กรอกค้างในกล่อง)
// ผลที่ไม่ใช่ {ok} (throw) → ข้อความกลาง ไม่รั่วข้อความดิบ · กันกดซ้ำแบบเร็วกว่า render ด้วย ref

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { GENERIC_JOB_ERROR } from "@/lib/jobs/messages";

type Res<T> = { ok: true; data: T } | { ok: false; error: string; code?: string };

export function useOfficeRun() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setErrorText] = useState<string | null>(null);
  /** hint ของ RPC ที่ล้มครั้งล่าสุด (แยกเคสโดยไม่เทียบข้อความไทย) — ล้างพร้อม error */
  const [code, setCode] = useState<string | null>(null);
  const setError = useCallback((m: string | null) => {
    setErrorText(m);
    if (m === null) setCode(null);
  }, []);
  const inFlight = useRef(false);

  const run = useCallback(
    async <T,>(fn: () => Promise<Res<T>>, opts: { success?: string; refresh?: boolean } = {}): Promise<Res<T>> => {
      if (inFlight.current) return { ok: false, error: "กำลังทำรายการก่อนหน้า รอสักครู่" };
      inFlight.current = true;
      setBusy(true);
      setError(null);
      try {
        const res = await fn();
        if (!res.ok) {
          setError(res.error);
          setCode(res.code ?? null);
          return res;
        }
        if (opts.success) toast.push(opts.success);
        if (opts.refresh !== false) router.refresh();
        return res;
      } catch {
        setError(GENERIC_JOB_ERROR);
        return { ok: false, error: GENERIC_JOB_ERROR };
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [router, toast]
  );

  return { run, busy, error, code, setError };
}
