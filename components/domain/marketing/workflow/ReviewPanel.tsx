"use client";

// ReviewPanel — ตรวจ 3 ด่าน + ข้อที่ต้องยืนยัน + ก่อนอนุมัติ (หัวข้อ 9 ของหน้าชิ้นงาน §2.4)
// - drafting/in_review: แก้ได้ · approved ขึ้นไป: อ่านอย่างเดียว + ป้ายล็อก · idea/planned: ยังไม่ถึงขั้นตรวจ
// - ApprovalBox แสดงเฉพาะ in_review (ตอนยังเป็น AI ร่าง ยังไม่ถึงคิวอนุมัติ)

import { ApprovalBox } from "@/components/domain/marketing/workflow/ApprovalBox";
import { ConfirmItemList } from "@/components/domain/marketing/workflow/ConfirmItemList";
import { GateCard } from "@/components/domain/marketing/workflow/GateCard";
import { useEditMode } from "@/components/domain/marketing/workflow/PieceClientShell";
import { GATE_KINDS } from "@/lib/marketing/piece-labels";
import type { ConfirmItem, PieceRow } from "@/lib/marketing/piece-types";

export function ReviewPanel({ piece, confirmItems }: { piece: PieceRow; confirmItems: ConfirmItem[] }) {
  const { openEditor } = useEditMode();
  const raw = piece.pieceStatus;
  const editable = raw === "drafting" || raw === "in_review";
  const locked = raw === "approved" || raw === "produced" || raw === "posted";
  const gateOf = { fact_check: piece.gates.factCheck, brand_rule: piece.gates.brandRule, risk_owner: piece.gates.riskOwner };

  if (raw === "idea" || raw === "planned") {
    return (
      <section aria-label="ตรวจและอนุมัติ" className="rounded-lg border border-dashed border-zinc-300 bg-white p-3.5">
        <h2 className="text-base font-semibold text-zinc-900">ตรวจและอนุมัติ</h2>
        <p className="mt-1 text-sm text-zinc-700">
          {raw === "idea" ? "ยังเป็นไอเดีย — วางแผนก่อน แล้ว AI จะร่างและส่งตรวจ" : "วางแผนแล้ว — รอ AI ร่างเนื้อหา แล้วถึงขั้นตรวจ 3 ด่าน"}
        </p>
      </section>
    );
  }
  if (raw === "cancelled") return null;

  return (
    <section aria-label="ตรวจและอนุมัติ" className="space-y-3">
      <h2 className="text-base font-semibold text-zinc-900">ตรวจและอนุมัติ</h2>
      {GATE_KINDS.map((k) => (
        <GateCard
          key={k}
          stepId={piece.stepId}
          kind={k}
          gate={gateOf[k]}
          editable={editable}
          lockedAfterApproval={locked}
          onRequestEdit={editable ? openEditor : undefined}
        />
      ))}
      <ConfirmItemList stepId={piece.stepId} items={confirmItems} editable={editable} markerInText={piece.confirmMarkerInText} />
      {raw === "in_review" && <ApprovalBox piece={piece} />}
    </section>
  );
}
