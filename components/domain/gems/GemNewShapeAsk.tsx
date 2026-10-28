"use client";

// GemNewShapeAsk — รูปทรงใหม่: ถามจำนวนค่าขนาด 1 / 2 ค่า (ถามตอนสร้างรูปทรง ไม่ถามต่อแถว — กัน 4×4 ของทรงกลม · UX D5)
// เลือกแล้ว "แก้ไม่ได้หลังมีคนใช้" (DB has_length_locked) · ปุ่มตกลง aria-disabled จนเลือก

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

export function GemNewShapeAsk({ name, onConfirm, onCancel }: { name: string; onConfirm: (hasLength: boolean) => void; onCancel: () => void }) {
  const [v, setV] = useState<"one" | "two" | null>(null);
  const ready = v !== null;
  return (
    <Modal open onClose={onCancel} title={`รูปทรงใหม่: “${name}”`}>
      {/* ไม่ใช้ <form>: กล่องนี้ถูกเปิดจาก GemPicker ที่อยู่ใน <form> ของจอแม่ (สร้างใบงาน/แก้พลอย/แม่แบบ) — form ซ้อน = HTML ผิด และ submit ลอยขึ้นไปบันทึกฟอร์มแม่ทั้งที่ผู้ใช้แค่เลือกจำนวนค่าขนาด */}
      <div className="space-y-3" data-testid="gem-new-shape-ask">
        <fieldset className="space-y-2">
          <legend className="text-base font-medium text-zinc-900">ใส่ขนาดกี่ค่า?</legend>
          <label className="flex min-h-14 cursor-pointer items-start gap-2 rounded-md border-2 border-zinc-300 p-3 has-[:checked]:border-primary-600">
            <input type="radio" name="gem-has-length" className="mt-1 h-5 w-5 accent-primary-600" checked={v === "one"} onChange={() => setV("one")} />
            <span className="text-base text-zinc-900">
              1 ค่า <span className="text-zinc-700">เช่น กลม · ช่อง [ 4 ] มม.</span>
            </span>
          </label>
          <label className="flex min-h-14 cursor-pointer items-start gap-2 rounded-md border-2 border-zinc-300 p-3 has-[:checked]:border-primary-600">
            <input type="radio" name="gem-has-length" className="mt-1 h-5 w-5 accent-primary-600" checked={v === "two"} onChange={() => setV("two")} />
            <span className="text-base text-zinc-900">
              2 ค่า กว้าง × ยาว <span className="text-zinc-700">เช่น ไข่ · ช่อง [ 4 ] × [ 6 ] มม.</span>
            </span>
          </label>
        </fieldset>
        <p className="text-sm font-medium text-amber-900">⚠ เลือกแล้วแก้ไม่ได้หลังมีคนใช้</p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onCancel}>
            ยกเลิก
          </Button>
          <Button
            type="button"
            onClick={() => {
              if (v) onConfirm(v === "two");
            }}
            aria-disabled={!ready ? true : undefined}
            aria-describedby={!ready ? "gem-shape-ask-why" : undefined}
            className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
          >
            ตกลง
          </Button>
        </div>
        {!ready && (
          <p id="gem-shape-ask-why" className="text-xs text-zinc-700">
            เลือก 1 ค่า หรือ 2 ค่าก่อน
          </p>
        )}
      </div>
    </Modal>
  );
}
