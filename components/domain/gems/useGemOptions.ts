"use client";

// useGemOptions — รายการชนิด/รูปทรง/ขนาด (ไม่มีราคา) สำหรับ GemPicker · loading / error(+ลองใหม่) / ready
// error ไม่บล็อกการกรอก: พิมพ์ชื่อเองได้ แต่ตัวดักชื่อซ้ำฝั่งจอทำงานไม่ได้ (DB ยังดักซ้ำเสมอ)

import { useCallback, useEffect, useRef, useState } from "react";
import { getGemOptions } from "@/lib/actions/gems";
import { GENERIC_JOB_ERROR } from "@/lib/jobs/messages";
import type { GemOptions } from "@/lib/jobs/gems";

export type GemOptionsState = { s: "loading" } | { s: "error"; message: string } | { s: "ready"; data: GemOptions };

export function useGemOptions(enabled = true) {
  const [state, setState] = useState<GemOptionsState>({ s: "loading" });
  const seq = useRef(0);
  const load = useCallback(async () => {
    const my = ++seq.current;
    setState({ s: "loading" });
    try {
      const r = await getGemOptions();
      if (my !== seq.current) return;
      setState(r.ok ? { s: "ready", data: r.data } : { s: "error", message: r.error });
    } catch {
      if (my === seq.current) setState({ s: "error", message: GENERIC_JOB_ERROR });
    }
  }, []);
  useEffect(() => {
    if (enabled) void load();
    return () => {
      seq.current++;
    };
  }, [enabled, load]);
  return { state, reload: load, options: state.s === "ready" ? state.data : null };
}
