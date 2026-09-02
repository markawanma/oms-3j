"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";

/**
 * Responsive modal: renders as a centered dialog on md+ screens and a
 * bottom sheet on mobile (per ux-ui design — "Modal/BottomSheet
 * (responsive)"). Traps focus is intentionally kept simple (focus the panel
 * on open, restore on close) rather than a full focus-trap loop — adequate
 * for this MVP's short forms; upgrade if a11y audit flags it.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  confirmBeforeClose,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /**
   * Optional guard invoked right before ESC / backdrop-click / the X button
   * would close the dialog (NOT invoked when a caller inside `children`
   * calls its own `onDone`/`onClose` prop directly — that path is assumed
   * intentional, e.g. "save succeeded, now close"). Return `true` to let the
   * close proceed as normal, `false` to block it — typical use is running
   * your own `window.confirm()` inside and returning its result (added for
   * the SKU product-image upload flow: don't drop an in-flight upload from
   * an accidental ESC/backdrop click). Omitted = always closes immediately,
   * i.e. every existing call site keeps its old behavior unchanged.
   */
  confirmBeforeClose?: () => boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  // Keep the latest onClose in a ref instead of an effect dependency.
  // Callers commonly pass an inline/closure onClose (e.g. `onClose={handleClose}`
  // declared in the component body) whose identity changes on every render.
  // If `onClose` were in the deps array below, typing a single character into
  // any input inside the dialog re-renders the parent -> new onClose identity
  // -> this effect's cleanup fires (stealing focus back via
  // `previouslyFocused.current?.focus()`) then the effect body fires again
  // (moving focus to the panel) -> focus jumps out of the input after every
  // keystroke. Do NOT add onClose back to the deps array. Same reasoning
  // applies to confirmBeforeClose below.
  const onCloseRef = useRef(onClose);
  const confirmBeforeCloseRef = useRef(confirmBeforeClose);
  useEffect(() => {
    onCloseRef.current = onClose;
    confirmBeforeCloseRef.current = confirmBeforeClose;
  });

  function requestClose() {
    const guard = confirmBeforeCloseRef.current;
    if (guard && !guard()) return;
    onCloseRef.current();
  }

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement;
    panelRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") requestClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused.current?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: see onCloseRef comment above
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center" role="presentation">
      <div className="absolute inset-0 bg-zinc-900/40" onClick={requestClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
        className="relative z-10 w-full max-w-lg rounded-t-lg bg-white p-5 shadow-xl md:rounded-lg focus:outline-none max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between">
          <h2 id="modal-title" className="text-lg font-semibold text-zinc-900">
            {title}
          </h2>
          <button
            onClick={requestClose}
            aria-label="ปิด"
            className="flex h-11 w-11 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}
