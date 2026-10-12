"use client";

// PieceActionBar — ปุ่มหลัก 1 อัน + เมนู "⋯" ตามสถานะ (ตาราง "ปุ่มหลักตามสถานะ" §2.4) + กล่อง/ชีตที่ปุ่มเหล่านั้นเปิด
//
// 🔴 กติกา (QA ไล่จาก diff):
//  - ปุ่มอนุมัติ enabled ⇔ piece.canApprove (ค่าจาก DB) เท่านั้น — ไม่คำนวณซ้ำ (F1/F7)
//  - การถอยสถานะจาก approved มีทางเดียว: เมนู "⋯ → ถอนอนุมัติ…" (เหตุผลบังคับ) — ไม่มีปุ่มลอยอื่น (F11)
//  - ไม่ส่ง actor/shop จาก client — server action ใส่เอง (F2)
//  - ไม่มีปุ่ม "ย้อนเป็นไอเดีย": set_plan ล้างวันไม่ได้ (preflight D11: date:null → 22023) ย้อนแล้ววันค้าง ไอเดียจะโผล่ในปฏิทิน
//  - sticky ที่ท้ายหน้า (bottom-0) ทุกขนาดจอ: บนมือถือหน้านี้ซ่อน bottom nav (MarketingBottomNav) ให้ปุ่มหลักอยู่ติดล่าง

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Ellipsis } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { PostedSheet } from "@/components/domain/marketing/workflow/PostedSheet";
import { PlanForm } from "@/components/domain/marketing/workflow/PlanForm";
import { DeferDialog, TransitionDialog } from "@/components/domain/marketing/workflow/TransitionDialog";
import type { TransitionVariant } from "@/components/domain/marketing/workflow/TransitionDialog";
import { useReviewElapsed } from "@/components/domain/marketing/workflow/ReviewClock";
import { advancePiece, deferPiece, unlinkPost } from "@/lib/actions/content-pieces";
import { primaryActionFor, pieceKindHasPostUrl } from "@/lib/marketing/piece-labels";
import type { ContentTypeOption, HostOption, PieceResult, PieceRow } from "@/lib/marketing/piece-types";

interface MenuItem {
  key: string;
  label: string;
  danger?: boolean;
  run: () => void;
}

type Dialog =
  | { kind: "transition"; variant: TransitionVariant }
  | { kind: "defer" }
  | { kind: "plan" }
  | { kind: "posted" }
  | null;

function MoreMenu({ items, disabled }: { items: MenuItem[]; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  if (items.length === 0) return null;
  return (
    <div
      ref={wrapRef}
      className="relative"
      onKeyDown={(e) => {
        // Escape ขณะอยู่ในรายการ → ปิดเมนูแล้วคืนโฟกัสให้ปุ่มเปิด (ไม่ให้โฟกัสหายไปกับรายการที่ถูกถอดออก)
        if (e.key === "Escape" && open) {
          setOpen(false);
          triggerRef.current?.focus();
        }
      }}
      onBlur={(e) => {
        if (!wrapRef.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <Button
        ref={triggerRef}
        type="button"
        variant="secondary"
        // disclosure (ปุ่มเปิด/ปิดรายการปุ่ม) ไม่ใช้ role="menu": role นั้นสัญญาว่าจะมี arrow-key navigation ครบ ซึ่งไม่มี — รายการปุ่มธรรมดาเข้าถึงด้วย Tab ได้ถูกต้องกว่า
        aria-expanded={open}
        aria-label="เมนูเพิ่มเติม"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="w-11 px-0"
      >
        <Ellipsis className="h-5 w-5" aria-hidden="true" />
      </Button>
      {open && (
        <ul aria-label="การกระทำเพิ่มเติม" className="absolute bottom-full right-0 z-30 mb-2 w-60 overflow-hidden rounded-lg border border-zinc-200 bg-white py-1 shadow-lg">
          {items.map((it) => (
            <li key={it.key}>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  triggerRef.current?.focus(); // กล่องที่เปิดต่อจะคืนโฟกัสให้ปุ่มเปิดเมนูเมื่อปิด (ไม่ใช่รายการที่ถูกถอดแล้ว)
                  it.run();
                }}
                className={`flex min-h-11 w-full items-center px-3 text-left text-sm font-medium hover:bg-zinc-50 focus-visible:bg-zinc-50 ${
                  it.danger ? "text-red-700" : "text-zinc-800"
                }`}
              >
                {it.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PieceActionBar({
  piece,
  hosts,
  contentTypes,
  todayTh,
  restoreForcesReview,
}: {
  piece: PieceRow;
  hosts: HostOption[];
  contentTypes: ContentTypeOption[];
  todayTh: string;
  /** กู้คืนชิ้นที่เคยอนุมัติ/ผลิตแล้วจะกลับ "รอตรวจ" และต้องอนุมัติใหม่ (อ่านจาก event ล่าสุด ไม่เดา) */
  restoreForcesReview: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const elapsed = useReviewElapsed();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const raw = piece.pieceStatus;
  const effective = piece.effectiveStatus;
  const primary = primaryActionFor({ effective, pieceKind: piece.pieceKind, footageStatus: piece.footageStatus });

  async function run(label: string, fn: () => Promise<PieceResult<unknown>>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fn();
      if (!res.ok) {
        setError(res.error);
        if (res.stale) router.refresh();
        return;
      }
      toast.push(label);
      router.refresh();
    } catch {
      setError("ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง");
    } finally {
      setBusy(false);
    }
  }

  const advance = (to: string, label: string, opts?: { reviewSeconds?: number }) =>
    run(label, () => advancePiece(piece.stepId, to, opts));

  function onPrimary() {
    switch (primary.key) {
      case "plan":
        setDialog({ kind: "plan" });
        return;
      case "submit_review":
        void advance("in_review", "ส่งตรวจแล้ว");
        return;
      case "approve":
        void advance("approved", "อนุมัติแล้ว", { reviewSeconds: elapsed() });
        return;
      case "mark_produced":
        void advance("produced", "บันทึกว่าถ่ายแล้ว");
        return;
      case "mark_posted":
        setDialog({ kind: "posted" });
        return;
      case "resume":
        void advance("resume", "กลับมาทำต่อแล้ว");
        return;
      case "restore":
        setDialog({ kind: "transition", variant: "restore" });
        return;
      default:
        return;
    }
  }

  // ---- เมนู "⋯" ตามสถานะ (§2.4) ----
  const open = (variant: TransitionVariant): MenuItem["run"] => () => setDialog({ kind: "transition", variant });
  const items: MenuItem[] = [];
  const holdOrCancel = (): void => {
    items.push({ key: "hold", label: "พักรอเงื่อนไข…", run: open("hold") });
    items.push({ key: "cancel", label: "ยกเลิกชิ้นงาน…", danger: true, run: open("cancel") });
  };
  const defer = (): void => {
    if (piece.resolvedStart) items.push({ key: "defer", label: "เลื่อนวัน…", run: () => setDialog({ kind: "defer" }) });
  };

  if (effective === "on_hold") {
    items.push({ key: "cancel", label: "ยกเลิกชิ้นงาน…", danger: true, run: open("cancel") });
  } else if (effective !== "cancelled") {
    switch (raw) {
      case "idea":
        items.push({ key: "hold", label: "พักรอเงื่อนไข…", run: open("hold") });
        items.push({ key: "cancel", label: "ไม่ทำ (ยกเลิก)…", danger: true, run: open("cancel") });
        break;
      case "planned":
        items.push({ key: "start", label: "เริ่มร่างเอง", run: () => void advance("drafting", "เริ่มร่างแล้ว") });
        defer();
        holdOrCancel();
        break;
      case "drafting":
        items.push({ key: "back", label: "ย้อนเป็นวางแผน…", run: open("revertDrafting") });
        defer();
        holdOrCancel();
        break;
      case "in_review":
        items.push({ key: "sendback", label: "ส่งกลับแก้…", run: open("sendBack") });
        defer();
        holdOrCancel();
        break;
      case "approved":
        items.push({ key: "retract", label: "ถอนอนุมัติ…", run: open("retract") });
        defer();
        holdOrCancel();
        break;
      case "produced":
        items.push({ key: "revert", label: "ย้อนเป็นอนุมัติแล้ว…", run: open("revertProduced") });
        defer();
        holdOrCancel();
        break;
      case "posted":
        items.push({ key: "unpost", label: "ปลดโพสต์…", danger: true, run: open("unpost") });
        break;
      default:
        break;
    }
  }

  const activePosts = piece.posts.filter((p) => p.status === "active");
  const showPrimary = primary.key !== "none";
  const approveBlocked = primary.key === "approve" && !piece.canApprove;

  if (!showPrimary && items.length === 0) return null;

  async function submitTransition(variant: TransitionVariant, reason: string): Promise<PieceResult<unknown>> {
    switch (variant) {
      case "sendBack":
        return advancePiece(piece.stepId, "drafting", { reason });
      case "revertDrafting":
        return advancePiece(piece.stepId, "planned", { reason });
      case "retract":
        return advancePiece(piece.stepId, "in_review", { reason });
      case "revertProduced":
        return advancePiece(piece.stepId, "approved", { reason });
      case "hold":
        return advancePiece(piece.stepId, "hold", { reason });
      case "cancel":
        return advancePiece(piece.stepId, "cancelled", { reason });
      case "restore":
        return advancePiece(piece.stepId, "restore", { reason });
      case "unpost": {
        if (!pieceKindHasPostUrl(piece.pieceKind)) {
          // LINE / สตอรี่ ไม่มีแถวโพสต์ภายนอก → ย้อนสถานะตรง (posted → approved)
          return advancePiece(piece.stepId, "approved", { reason });
        }
        // หลายช่องทาง: ล้มกลางทางต้องบอกว่าปลดไปแล้วกี่ใบ (สถานะชิ้นเปลี่ยนไปแล้วบางส่วน) และสั่ง refresh — ไม่ใช่ error ธรรมดาที่ให้กดซ้ำ
        let done = 0;
        for (const p of activePosts) {
          const r = await unlinkPost(piece.stepId, p.postId, reason);
          if (!r.ok) {
            if (done > 0) return { ok: false, error: `ปลดไปแล้ว ${done} จาก ${activePosts.length} — รีเฟรชเพื่อดูล่าสุด`, stale: true };
            return r;
          }
          done++;
        }
        return { ok: true, data: undefined };
      }
      // หน้าคัดไอเดียมีกล่องเหตุผลของตัวเอง — แถบปุ่มชิ้นงานไม่ใช้ variant เหล่านี้
      case "skipIdea":
      case "holdIdea":
        return { ok: false, error: "เปลี่ยนสถานะแบบนี้ไม่ได้" };
    }
  }

  return (
    <div className="sticky bottom-0 z-20 -mx-4 border-t border-zinc-200 bg-white/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur">
      {error && (
        <p role="alert" className="mb-2 rounded-md border border-red-200 bg-red-50 p-2.5 text-sm font-medium text-red-800">
          {error}
        </p>
      )}
      {approveBlocked && (
        <p className="mb-2 text-xs text-zinc-700">อนุมัติได้เมื่อผ่านครบทุกอย่างในรายการ “ก่อนอนุมัติ”</p>
      )}
      <div className="mx-auto flex max-w-3xl items-center gap-3">
        {showPrimary ? (
          <Button
            type="button"
            loading={busy}
            disabled={busy || approveBlocked}
            onClick={onPrimary}
            className="min-h-12 flex-1"
          >
            {primary.label}
          </Button>
        ) : (
          <p className="flex-1 text-sm text-zinc-700">
            {effective === "planned" ? "รอ AI ร่าง — หรือกดเมนู ⋯ เพื่อเริ่มร่างเอง" : "ไม่มีขั้นถัดไปที่ต้องกดตอนนี้"}
          </p>
        )}
        <MoreMenu items={items} disabled={busy} />
      </div>

      {/* ---- กล่อง/ชีตที่เมนูเปิด ---- */}
      {dialog?.kind === "transition" && (
        <TransitionDialog
          open
          variant={dialog.variant}
          onClose={() => setDialog(null)}
          onSubmit={(reason) => submitTransition(dialog.variant, reason)}
          extra={
            dialog.variant === "restore" && restoreForcesReview ? (
              <p className="rounded-md border border-amber-200 bg-amber-50 p-2.5 text-sm text-amber-900">
                ชิ้นนี้เคยอนุมัติ/ผลิตแล้ว — หลังกู้คืนจะกลับไป “รอตรวจ” และต้องอนุมัติใหม่
              </p>
            ) : undefined
          }
        />
      )}
      {dialog?.kind === "defer" && (
        <DeferDialog
          open
          todayTh={todayTh}
          currentDate={piece.resolvedStart}
          onClose={() => setDialog(null)}
          onSubmit={(date, reason, time) => deferPiece(piece.stepId, date, reason, time)}
        />
      )}
      {dialog?.kind === "plan" && (
        <PlanForm open piece={piece} hosts={hosts} contentTypes={contentTypes} todayTh={todayTh} advanceToPlanned onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "posted" && (
        <PostedSheet
          open
          stepId={piece.stepId}
          title={piece.title}
          pieceKind={piece.pieceKind}
          posts={piece.posts}
          hooks={piece.hooks}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
