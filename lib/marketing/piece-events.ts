// lib/marketing/piece-events.ts — อ่าน content_piece_event เป็น "แถบแจ้ง" ของหน้าชิ้นงาน (§2.4 ข้อ 2)
// brief 0.6 (กู้คืน → ต้องอนุมัติใหม่) · 0.7 (แก้เนื้อหา → ผลตรวจถูกล้าง) · ยกเลิก/รอเงื่อนไข
//
// Pure — รับ event ที่เรียง seq แล้วหรือยังไม่เรียงก็ได้ (เรียงใหม่ด้วย seq เสมอ — trap #22: ห้ามเรียงด้วย created_at)

import { GATE_KIND_LABEL } from "@/lib/marketing/piece-labels";
import type { GateKind } from "@/lib/marketing/piece-labels";
import type { PieceEvent } from "@/lib/marketing/piece-types";

export type BannerKey = "cancelled" | "on_hold" | "needs_reapproval" | "gates_reset";
export type BannerTone = "red" | "amber" | "orange";

export interface PieceBanner {
  key: BannerKey;
  tone: BannerTone;
  title: string;
  detail: string | null;
  /** เวลาของ event ที่เป็นที่มา (ISO) */
  at: string | null;
}

/** MAX แถบที่แสดงพร้อมกัน (§2.4: สูงสุด 3 เรียงตามความสำคัญ) */
export const MAX_BANNERS = 3;

function bySeqAsc(events: readonly PieceEvent[]): PieceEvent[] {
  return [...events].sort((a, b) => a.seq - b.seq);
}

function lastOf(events: readonly PieceEvent[], pred: (e: PieceEvent) => boolean): PieceEvent | null {
  for (let i = events.length - 1; i >= 0; i--) if (pred(events[i])) return events[i];
  return null;
}

/** สถานะก่อนถูกยกเลิกล่าสุด (อ่านจาก event ไม่เดา) — ใช้ในกล่องกู้คืน */
export function lastCancelFromStatus(events: readonly PieceEvent[]): string | null {
  const ordered = bySeqAsc(events);
  const cancel = lastOf(ordered, (e) => e.eventKind === "cancel");
  if (!cancel) return null;
  const fromPayload = typeof cancel.payload.from_status === "string" ? cancel.payload.from_status : null;
  return cancel.fromStatus ?? fromPayload;
}

/** กู้คืนชิ้นที่เคย approved/produced จะถูกส่งกลับ "รอตรวจ" และต้องอนุมัติใหม่ (DB บังคับ) */
export function restoreForcesReview(events: readonly PieceEvent[]): boolean {
  const from = lastCancelFromStatus(events);
  return from === "approved" || from === "produced";
}

function gateKindNames(payload: Record<string, unknown>): string {
  const kinds = Array.isArray(payload.gate_kinds) ? payload.gate_kinds : [];
  const names = kinds
    .filter((k): k is string => typeof k === "string")
    .map((k) => GATE_KIND_LABEL[k as GateKind])
    .filter((n): n is string => Boolean(n));
  return names.length > 0 ? names.join(" · ") : "ทุกด่าน";
}

export function derivePieceBanners(
  piece: { pieceStatus: string; holdReason: string | null },
  events: readonly PieceEvent[]
): PieceBanner[] {
  const ordered = bySeqAsc(events);
  const banners: PieceBanner[] = [];

  // (ก) ยกเลิกแล้ว / รอเงื่อนไข
  if (piece.pieceStatus === "cancelled") {
    const cancel = lastOf(ordered, (e) => e.eventKind === "cancel");
    banners.push({
      key: "cancelled",
      tone: "red",
      title: "ชิ้นนี้ถูกยกเลิกแล้ว",
      detail: cancel?.reason ?? null,
      at: cancel?.createdAt ?? null,
    });
  } else if (piece.holdReason) {
    const hold = lastOf(ordered, (e) => e.eventKind === "hold");
    banners.push({
      key: "on_hold",
      tone: "orange",
      title: "รอเงื่อนไข",
      detail: piece.holdReason,
      at: hold?.createdAt ?? null,
    });
  }

  // (ข) ต้องอนุมัติใหม่ — กู้คืนจาก approved/produced แล้วยังไม่เคยอนุมัติหลังจากนั้น
  if (piece.pieceStatus === "in_review") {
    const restore = lastOf(ordered, (e) => e.eventKind === "restore" && e.payload.forced_review === true);
    if (restore) {
      const approvedAfter = ordered.some((e) => e.seq > restore.seq && e.eventKind === "advance" && e.toStatus === "approved");
      if (!approvedAfter) {
        banners.push({
          key: "needs_reapproval",
          tone: "amber",
          title: "ต้องอนุมัติใหม่",
          detail: "ชิ้นนี้ถูกกู้คืนจากการยกเลิก — เนื้อหาอาจเปลี่ยนไปตอนที่ถูกยกเลิก จึงต้องผ่านการตรวจอีกรอบ",
          at: restore.createdAt,
        });
      }
    }
  }

  // (ค) ผลตรวจถูกล้างเพราะเนื้อหาเปลี่ยน — event gate ล่าสุดที่ reset=true หลังการส่งตรวจ/อนุมัติครั้งล่าสุด
  if (piece.pieceStatus === "drafting" || piece.pieceStatus === "in_review") {
    const resetEvt = lastOf(ordered, (e) => e.eventKind === "gate" && e.payload.reset === true);
    if (resetEvt) {
      const anchor = lastOf(
        ordered,
        (e) => (e.eventKind === "advance" || e.eventKind === "revert") && (e.toStatus === "in_review" || e.toStatus === "approved")
      );
      if (!anchor || resetEvt.seq > anchor.seq) {
        banners.push({
          key: "gates_reset",
          tone: "amber",
          title: `ผลตรวจถูกล้างเพราะเนื้อหาเปลี่ยน: ${gateKindNames(resetEvt.payload)}`,
          detail: "ต้องตรวจด่านที่ถูกล้างใหม่ก่อนอนุมัติ",
          at: resetEvt.createdAt,
        });
      }
    }
  }

  return banners.slice(0, MAX_BANNERS);
}

/** เวลาอ่านที่บันทึกตอนอนุมัติครั้งล่าสุด (วินาที) — แสดงใน "ประวัติ" */
export function lastApprovalReviewSeconds(events: readonly PieceEvent[]): number | null {
  const e = lastOf(bySeqAsc(events), (x) => x.eventKind === "advance" && x.toStatus === "approved" && x.reviewSeconds !== null);
  return e?.reviewSeconds ?? null;
}
