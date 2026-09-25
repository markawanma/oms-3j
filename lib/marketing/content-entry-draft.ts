"use client";

// lib/marketing/content-entry-draft.ts — localStorage draft for the content
// entry form (design doc §1.4). NOT save-as-you-type to the DB: content_
// post_metric_upsert computes is_regression from the "merged" value for
// today (0148 §H1), so firing it mid-type with incomplete numbers would
// create a real DB row that doesn't match intent, and burns mobile data at
// night when the connection may be flaky. This hook only ever touches
// localStorage, debounced ~300ms, and is the single seam the design doc
// requires be wrapped defensively: "อ่านไม่ได้ก็ต้องไม่พัง" — every
// localStorage call here is try/catch'd, private-mode/quota-exceeded/SSR
// (no `window`) all degrade to "no draft" rather than throwing.

import { useCallback, useEffect, useRef, useState } from "react";
import type { MetricDraft, MetricField } from "./content-types";

const DEBOUNCE_MS = 300;
const DRAFT_PREFIX = "content-entry-draft";

function draftKey(shopId: string, postId: string, todayTH: string): string {
  return `${DRAFT_PREFIX}:${shopId}:${postId}:${todayTH}`;
}

function safeGetItem(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Private browsing mode, storage disabled, or any other access error —
    // treat exactly like "no draft found", never let this throw upward.
    return null;
  }
}

function safeSetItem(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Quota exceeded / storage disabled — draft is best-effort only, losing
    // it is acceptable (design §6 trade-off 3), throwing is not.
  }
}

function safeRemoveItem(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore — see safeSetItem
  }
}

function readDraft(key: string): MetricDraft {
  if (typeof window === "undefined") return {};
  const raw = safeGetItem(key);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as MetricDraft;
    }
    return {};
  } catch {
    // Corrupt/foreign JSON under this key — treat as no draft rather than
    // crashing the form.
    return {};
  }
}

/**
 * Per-card draft: restores whatever was typed for (shopId, postId, todayTH)
 * synchronously on first render (design §1.4: "restore ค่าก่อน render ฟอร์ม
 * เปล่า ไม่ flash ค่าว่างแล้วเด้งมา") — reading localStorage inside the
 * useState initializer runs during the client's first render pass, before
 * paint. Known trade-off: because the server-rendered HTML has no draft
 * (no `window` there), React may log a hydration mismatch warning on inputs
 * that had a draft — accepted per the design goal (no visible flash beats a
 * console warning); see delivery report for what to visually verify.
 */
export function useContentEntryDraft(shopId: string, postId: string, todayTH: string) {
  const key = draftKey(shopId, postId, todayTH);
  const [draft, setDraftState] = useState<MetricDraft>(() => readDraft(key));
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setField = useCallback(
    (field: MetricField, value: string) => {
      setDraftState((prev) => {
        const next: MetricDraft = { ...prev, [field]: value };
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          safeSetItem(key, JSON.stringify(next));
        }, DEBOUNCE_MS);
        return next;
      });
    },
    [key]
  );

  /** Called immediately after a successful confirm — clears both the timer
   * (so a stale debounced write can't resurrect the draft after it's gone)
   * and the stored key. */
  const clearDraft = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    safeRemoveItem(key);
    setDraftState({});
  }, [key]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { draft, setField, clearDraft };
}

/**
 * Best-effort cleanup of drafts from previous days (design §1.4: "cleanup
 * draft ของวันเก่า ... ตอน mount แบบ passive กัน localStorage บวมสะสม").
 * Call once from the queue container on mount. Never throws — an
 * unavailable/restricted localStorage just means nothing gets cleaned up
 * this session, not a crash.
 */
export function cleanupStaleContentDrafts(shopId: string, todayTH: string): void {
  if (typeof window === "undefined") return;
  try {
    const prefix = `${DRAFT_PREFIX}:${shopId}:`;
    const suffix = `:${todayTH}`;
    const staleKeys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(prefix) && !k.endsWith(suffix)) {
        staleKeys.push(k);
      }
    }
    for (const k of staleKeys) safeRemoveItem(k);
  } catch {
    // Cleanup is passive housekeeping — never let it block rendering.
  }
}
