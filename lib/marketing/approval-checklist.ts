// lib/marketing/approval-checklist.ts — รายการ "ก่อนอนุมัติ" (คำอธิบาย) ประกอบจากฟิลด์ที่ v_content_piece ให้
// 🔴 เป็นคำอธิบายเท่านั้น ไม่ตัดสิน: ปุ่มอนุมัติ enabled ⇔ can_approve จาก DB (ApprovalBox / PieceActionBar)

import { GATE_KINDS, GATE_KIND_LABEL } from "@/lib/marketing/piece-labels";
import type { PieceRow } from "@/lib/marketing/piece-types";

export interface ApprovalChecklistItem {
  label: string;
  done: boolean;
}

export function buildApprovalChecklist(
  p: Pick<PieceRow, "gates" | "confirmPending" | "confirmMarkerInText" | "pieceKind" | "lineAudience">
): ApprovalChecklistItem[] {
  const gateOf = { fact_check: p.gates.factCheck, brand_rule: p.gates.brandRule, risk_owner: p.gates.riskOwner };
  const items: ApprovalChecklistItem[] = GATE_KINDS.map((k) => {
    const s = gateOf[k]?.status ?? "pending";
    return { label: `ด่าน${GATE_KIND_LABEL[k]}ผ่าน`, done: s === "passed" || s === "na" };
  });
  items.push({
    label: p.confirmPending > 0 ? `ตอบข้อที่ต้องยืนยันให้ครบ (เหลือ ${p.confirmPending} ข้อ)` : "ไม่มีข้อที่ต้องยืนยันค้าง",
    done: p.confirmPending === 0 && !p.confirmMarkerInText,
  });
  if (p.pieceKind === null) items.push({ label: "ระบุชนิดชิ้นงาน", done: false });
  if (p.pieceKind === "line_message" && p.lineAudience === null) items.push({ label: "เลือกผู้รับข้อความ LINE", done: false });
  return items;
}

/** จำนวนข้อที่ยังไม่เรียบร้อย (แสดงบนแถบ "เหลือ k อย่างก่อนอนุมัติ") */
export function countUndone(items: readonly ApprovalChecklistItem[]): number {
  return items.filter((i) => !i.done).length;
}
