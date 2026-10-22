"use client";

// GemSimilarPrompt — ตัวดักชื่อคล้าย (UX §3.4): "มี X อยู่แล้ว ใช้ตัวนี้ไหม?" · ปุ่มหลัก = ใช้ตัวที่มี · "เพิ่มใหม่จริงๆ" ทำได้เสมอ (ตัวดัก ไม่ใช่ตัวบล็อก — มติเจ้าของ)
// โฟกัสเริ่มที่ปุ่มหลัก · คล้ายหลายตัว = radio (สูงสุด 3)

import { useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useFocusAfterOpen } from "@/components/domain/gems/ui";

export interface SimilarMatch {
  id: string | null;
  name: string;
}

export function GemSimilarPrompt({
  typed,
  kindLabel,
  matches,
  onUse,
  onForce,
  onCancel,
}: {
  typed: string;
  /** "ชนิดพลอย" | "รูปทรง" */
  kindLabel: string;
  matches: readonly SimilarMatch[];
  onUse: (m: SimilarMatch) => void;
  onForce: () => void;
  onCancel: () => void;
}) {
  const list = matches.slice(0, 3);
  const [picked, setPicked] = useState(0);
  const primary = useRef<HTMLButtonElement>(null);
  useFocusAfterOpen(primary);
  const chosen = list[picked] ?? list[0];
  if (!chosen) return null;
  return (
    <Modal open onClose={onCancel} title={list.length === 1 ? `มี “${chosen.name}” อยู่แล้ว` : `มี${kindLabel}ที่คล้ายกันอยู่แล้ว`}>
      <div className="space-y-3" data-testid="gem-similar-prompt">
        <p className="text-base text-zinc-900 break-words">
          ที่พิมพ์คือ “{typed}” — ใช่ตัวเดียวกันไหม? ถ้าใช่ ให้ใช้ตัวที่มี จะได้ไม่เกิดชื่อซ้ำ
        </p>
        {list.length > 1 && (
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium text-zinc-800">เลือกตัวที่ใช่</legend>
            {list.map((m, i) => (
              <label key={`${m.id ?? "new"}-${m.name}`} className="flex min-h-11 items-center gap-2 text-base text-zinc-900">
                <input type="radio" name="gem-similar" className="h-5 w-5 accent-primary-600" checked={picked === i} onChange={() => setPicked(i)} />
                <span className="break-words">{m.name}</span>
              </label>
            ))}
          </fieldset>
        )}
        <div className="flex flex-col gap-2">
          <Button ref={primary} type="button" onClick={() => onUse(chosen)}>
            ใช้ “{chosen.name}”
          </Button>
          <Button type="button" variant="secondary" onClick={onForce}>
            ไม่ใช่ — เพิ่ม “{typed}” ใหม่
          </Button>
        </div>
      </div>
    </Modal>
  );
}
