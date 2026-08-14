"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import type { ReactNode } from "react";
import { CheckCircle2, XCircle, X } from "lucide-react";

interface ToastItem {
  id: number;
  message: string;
  tone: "success" | "error";
}

interface ToastContextValue {
  push: (message: string, tone?: "success" | "error") => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

const BATCH_WINDOW_MS = 5000;
const BATCH_THRESHOLD = 3;

/**
 * ToastProvider — per ux-ui design: ARIA live region + batches >3 toasts
 * within a 5s window into a single summary toast ("มี N การแจ้งเตือนใหม่")
 * instead of stacking many individual toasts (avoids spam when e.g. several
 * webhook-driven updates land at once).
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const recentTimestamps = useRef<number[]>([]);
  const idCounter = useRef(0);

  const push = useCallback((message: string, tone: "success" | "error" = "success") => {
    const now = Date.now();
    recentTimestamps.current = recentTimestamps.current.filter((t) => now - t < BATCH_WINDOW_MS);
    recentTimestamps.current.push(now);

    const id = ++idCounter.current;

    if (recentTimestamps.current.length > BATCH_THRESHOLD) {
      setToasts((prev) => {
        const withoutBatch = prev.filter((t) => !t.message.startsWith("มีการแจ้งเตือนใหม่"));
        return [...withoutBatch, { id, message: `มีการแจ้งเตือนใหม่ ${recentTimestamps.current.length} รายการ`, tone: "success" }];
      });
    } else {
      setToasts((prev) => [...prev, { id, message, tone }]);
    }

    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const dismiss = (id: number) => setToasts((prev) => prev.filter((t) => t.id !== id));

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4 md:items-end md:right-4 md:left-auto"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-center gap-2 rounded-md px-4 py-3 text-sm shadow-lg ${
              t.tone === "success" ? "bg-zinc-900 text-white" : "bg-red-600 text-white"
            }`}
          >
            {t.tone === "success" ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            ) : (
              <XCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            )}
            <span>{t.message}</span>
            <button onClick={() => dismiss(t.id)} aria-label="ปิดการแจ้งเตือน" className="ml-1">
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
