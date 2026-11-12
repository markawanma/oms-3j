// _components/radio-keys.ts — คีย์ลูกศรของ role=radiogroup (roving tabindex) ใช้ร่วม GemSetPicker/SizePicker
import type { KeyboardEvent } from "react";

/** คืน index ถัดไปตามคีย์ (วนรอบ) · null = ไม่ใช่คีย์ของ radiogroup */
export function nextRadioIndex(key: string, current: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (current + 1) % count;
    case "ArrowLeft":
    case "ArrowUp":
      return (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

export function handleRadioKeyDown(e: KeyboardEvent, current: number, count: number, move: (next: number) => void) {
  const next = nextRadioIndex(e.key, current, count);
  if (next === null) return;
  e.preventDefault();
  move(next);
}
