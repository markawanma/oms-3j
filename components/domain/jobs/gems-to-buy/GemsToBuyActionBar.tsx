"use client";

// GemsToBuyActionBar — แถบคำสั่งที่รู้ scope เสมอ (ux-gems-to-buy.md §4.4): ทำกับ "ที่เลือก ∩ ที่เห็น" ถ้ามี ไม่งั้น "ทั้งหมดที่เห็นตามตัวกรอง" · ตัวเลขใน "ปุ่ม" บอกขอบเขต
//  - "สั่งแล้ว (n)" มีเฉพาะเมื่อเลือก (ห้ามมีปุ่ม "สั่งแล้วทั้งหมด" — กดผิดทั้งหน้า) · แท็บ "สั่งแล้ว" ไม่มีคัดลอก (กันส่งรายการที่สั่งไปแล้วซ้ำ)
//  - ไม่มีปุ่มพิมพ์ (มติเจ้าของ 24 ต.ค.: ตัดใบพิมพ์ทั้งก้อน)
//  - sticky top-16 เมื่อมีที่เลือก (ไม่ใช่ล่าง: toast ย้อนกลับอยู่ล่างจอบนมือถือ)

import { Button } from "@/components/ui/Button";
import { copyButtonLabel } from "@/lib/jobs/gems-to-buy";
import type { GtbScope, GtbTab } from "@/lib/jobs/gems-to-buy";

export function GemsToBuyActionBar({
  tab,
  scope,
  selectedCount,
  busy,
  onCopy,
  onMarkSelected,
  onClearSelection,
}: {
  tab: GtbTab;
  scope: GtbScope;
  selectedCount: number;
  busy: boolean;
  onCopy: () => void;
  onMarkSelected: () => void;
  onClearSelection: () => void;
}) {
  const hasSelection = selectedCount > 0;
  if (tab === "ordered" && !hasSelection) return null;
  const nothingToCopy = scope.rows.length === 0;
  return (
    <div className={`flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 bg-white p-2 ${hasSelection ? "sticky top-16 z-10 shadow-sm" : ""}`} role="toolbar" aria-label="คำสั่งกับรายการพลอย">
      {tab === "pending" && (
        <>
          <Button
            type="button"
            className={nothingToCopy ? "cursor-not-allowed opacity-60" : ""}
            aria-disabled={nothingToCopy || undefined}
            aria-describedby={nothingToCopy ? "gtb-copy-reason" : undefined}
            onClick={() => {
              if (!nothingToCopy) onCopy();
            }}
          >
            {copyButtonLabel(scope)}
          </Button>
          {nothingToCopy && (
            <span id="gtb-copy-reason" className="text-sm text-zinc-700">
              ไม่มีรายการให้คัดลอก
            </span>
          )}
        </>
      )}
      {hasSelection && (
        <>
          <Button type="button" variant="secondary" loading={busy} onClick={onMarkSelected}>
            {tab === "pending" ? `สั่งแล้ว (${selectedCount})` : `ยกเลิกสั่งแล้ว (${selectedCount})`}
          </Button>
          <Button type="button" variant="ghost" onClick={onClearSelection}>
            ล้างที่เลือก
          </Button>
        </>
      )}
    </div>
  );
}

/** แถบถามหลังคัดลอก — ไม่ติ๊กให้อัตโนมัติ (คัดลอก ≠ ส่งแล้ว) · ปุ่มติ๊กใช้ชุดรายการเดียวกับที่เพิ่งคัดลอก · ไม่หายเอง */
export function CopiedNudge({ count, busy, onMark, onDismiss }: { count: number; busy: boolean; onMark: () => void; onDismiss: () => void }) {
  return (
    <div role="status" className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">
      <span className="font-medium">คัดลอก {count} รายการแล้ว — ส่งร้านพลอยแล้วใช่ไหม?</span>
      <Button type="button" variant="secondary" loading={busy} onClick={onMark}>
        ทำเครื่องหมายว่าสั่งแล้ว ({count})
      </Button>
      <Button type="button" variant="ghost" onClick={onDismiss}>
        ยังไม่ได้ส่ง
      </Button>
    </div>
  );
}
