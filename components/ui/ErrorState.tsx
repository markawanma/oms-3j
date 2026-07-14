"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "./Button";

/** Full-block error state — use when there is no cached data to fall back to. */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center rounded-lg border border-red-200 bg-red-50 px-6 py-12 text-center"
    >
      <AlertTriangle className="h-10 w-10 text-red-500" aria-hidden="true" />
      <p className="mt-3 text-base font-medium text-red-800">เกิดข้อผิดพลาด</p>
      <p className="mt-1 text-sm text-red-700">{message}</p>
      {onRetry && (
        <Button variant="danger" size="sm" onClick={onRetry} className="mt-4">
          ลองใหม่
        </Button>
      )}
    </div>
  );
}

/** Inline, non-blocking error banner — use when stale/cached data is still shown. */
export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-center justify-between gap-3 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{message}</span>
      </div>
      {onRetry && (
        <button onClick={onRetry} className="shrink-0 font-medium underline underline-offset-2 min-h-11 px-2">
          ลองใหม่
        </button>
      )}
    </div>
  );
}
