"use client";

// AddMenu — ปุ่มเพิ่มของปฏิทิน (มติเจ้าของ 10 ต.ค.: คง "เพิ่มแผนเดิม" คู่กับ "เพิ่มชิ้นงาน" จนกว่า P2 เสร็จ)
//  - เพิ่มชิ้นงาน = ทางสร้างชิ้นใน workflow ใหม่ (content_piece_create) → มีขั้นตรวจ/อนุมัติ
//  - เพิ่มแผนเดิม = AddPlanForm เดิม (createManualTask → campaign_create_task) → โผล่ในส่วน "แผนเดิม" ของปฏิทิน
// PC (sm+): ปุ่มสองปุ่มคู่กัน · มือถือ: ปุ่มเดียว "เพิ่ม" เปิดรายการเลือก (disclosure ธรรมดา ไม่ใช้ role=menu)

import { useRef, useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { AddPlanForm } from "@/components/domain/marketing/AddPlanForm";
import { CreatePieceButton, CreatePieceDialog } from "@/components/domain/marketing/calendar/CreatePieceButton";

export function AddMenu({ defaultDate, todayTh }: { defaultDate: string; todayTh: string }) {
  const [menu, setMenu] = useState(false);
  const [piece, setPiece] = useState(false);
  const [legacy, setLegacy] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <div className="hidden items-center gap-2 sm:flex">
        <CreatePieceButton defaultDate={defaultDate} todayTh={todayTh} />
        <AddPlanForm defaultDate={defaultDate} variant="button" triggerLabel="เพิ่มแผนเดิม" triggerTone="secondary" />
      </div>

      <div
        className="relative sm:hidden"
        onKeyDown={(e) => {
          if (e.key === "Escape" && menu) {
            setMenu(false);
            triggerRef.current?.focus();
          }
        }}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setMenu(false);
        }}
      >
        <Button ref={triggerRef} type="button" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          เพิ่ม
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
        </Button>
        {menu && (
          <ul aria-label="เลือกสิ่งที่จะเพิ่ม" className="absolute right-0 top-full z-30 mt-2 w-72 overflow-hidden rounded-lg border border-zinc-200 bg-white py-1 shadow-lg">
            <li>
              <button
                type="button"
                onClick={() => {
                  setMenu(false);
                  triggerRef.current?.focus();
                  setPiece(true);
                }}
                className="block min-h-11 w-full px-3 py-2 text-left hover:bg-zinc-50"
              >
                <span className="block text-sm font-semibold text-zinc-900">เพิ่มชิ้นงาน</span>
                <span className="block text-xs text-zinc-700">ชิ้นคอนเทนต์ในระบบใหม่ — มีขั้นตรวจและอนุมัติ</span>
              </button>
            </li>
            <li>
              <button
                type="button"
                onClick={() => {
                  setMenu(false);
                  triggerRef.current?.focus();
                  setLegacy(true);
                }}
                className="block min-h-11 w-full px-3 py-2 text-left hover:bg-zinc-50"
              >
                <span className="block text-sm font-semibold text-zinc-900">เพิ่มแผนเดิม</span>
                <span className="block text-xs text-zinc-700">งานแบบเก่า (ไม่มีขั้นตรวจ) — ไปอยู่ในส่วน “แผนเดิม”</span>
              </button>
            </li>
          </ul>
        )}
      </div>
      <CreatePieceDialog open={piece} onClose={() => setPiece(false)} defaultDate={defaultDate} todayTh={todayTh} />
      <AddPlanForm defaultDate={defaultDate} open={legacy} onOpenChange={setLegacy} hideTrigger />
    </>
  );
}
