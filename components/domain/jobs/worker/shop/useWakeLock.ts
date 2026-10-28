"use client";

// useWakeLock — กันจอดับระหว่างส่งรูป (มติ Q7 · iOS ระงับ fetch เมื่อจอล็อก) · ทำเฉพาะช่วงที่ active=true · ไม่รองรับ = ไม่ทำอะไร (ข้อความ "อย่าล็อกจอ" บนจอยังเป็นด่านหลัก)
// ขอใหม่เมื่อแท็บกลับมามองเห็น (เบราว์เซอร์ปล่อย lock เองตอนซ่อนแท็บ) · ล้มเงียบ (ไม่ใช่ error ของผู้ใช้)

import { useEffect } from "react";

interface WakeLockSentinelLike {
  release: () => Promise<void>;
}
interface WakeLockApi {
  request: (type: "screen") => Promise<WakeLockSentinelLike>;
}

export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof navigator === "undefined") return;
    const api = (navigator as unknown as { wakeLock?: WakeLockApi }).wakeLock;
    if (!api || typeof api.request !== "function") return;
    let sentinel: WakeLockSentinelLike | null = null;
    let cancelled = false;

    const acquire = () => {
      if (cancelled || sentinel) return;
      api
        .request("screen")
        .then((s) => {
          if (cancelled) {
            void s.release().catch(() => undefined);
            return;
          }
          sentinel = s;
        })
        .catch(() => undefined);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        sentinel = null; // เบราว์เซอร์ปล่อยตอนซ่อนแท็บ — ขอใหม่
        acquire();
      }
    };

    acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      const s = sentinel;
      sentinel = null;
      if (s) void s.release().catch(() => undefined);
    };
  }, [active]);
}
