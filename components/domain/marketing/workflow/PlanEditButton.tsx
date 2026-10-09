"use client";

// PlanEditButton — ปุ่ม "แก้แผน" ในการ์ดแผน (เปิด PlanForm) · ซ่อนเมื่อสถานะไม่มีช่องไหนแก้ได้ (cancelled) หรือบนไอเดียที่ปุ่มหลักทำหน้าที่นี้แล้ว

import { useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { PlanForm } from "@/components/domain/marketing/workflow/PlanForm";
import type { ContentTypeOption, HostOption, PieceRow } from "@/lib/marketing/piece-types";

export function PlanEditButton({
  piece,
  hosts,
  contentTypes,
  todayTh,
}: {
  piece: PieceRow;
  hosts: HostOption[];
  contentTypes: ContentTypeOption[];
  todayTh: string;
}) {
  const [open, setOpen] = useState(false);
  if (piece.pieceStatus === "cancelled") return null;
  return (
    <>
      <Button type="button" variant="secondary" size="sm" className="max-md:min-h-11" onClick={() => setOpen(true)}>
        <Pencil className="h-4 w-4" aria-hidden="true" />
        แก้แผน
      </Button>
      {open && <PlanForm open piece={piece} hosts={hosts} contentTypes={contentTypes} todayTh={todayTh} onClose={() => setOpen(false)} />}
    </>
  );
}
