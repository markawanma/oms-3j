"use client";

// TransitionDialog — กล่องเหตุผลชุดเดียวของการเปลี่ยนสถานะที่ย้อนยาก/มีผลข้างเคียง (§2.5)
// variants: ส่งกลับแก้ · ถอนอนุมัติ · ย้อนเป็นอนุมัติแล้ว · รอเงื่อนไข · ยกเลิก · กู้คืน · ปลดโพสต์ (config ด้านล่าง) + DeferDialog (เลื่อนวัน)
//
// - เหตุผลเก็บ state ไว้เมื่อ error (ห้าม reset) · error แสดงในกล่อง (role="alert") ไม่ใช่ toast ที่หาย
// - 55000 stale (หน้าเก่ากว่า DB) → แสดงข้อความ + router.refresh() ให้หน้าตามทัน
// - ปิดด้วย ESC/พื้นหลังขณะมีข้อความค้าง → ถามยืนยันก่อน (confirmBeforeClose ของ Modal)

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { ReasonField } from "@/components/domain/marketing/workflow/ReasonField";
import { REASON_MAX, REASON_MIN } from "@/lib/marketing/piece-input";
import type { PieceResult } from "@/lib/marketing/piece-types";

export type TransitionVariant =
  | "sendBack"
  | "revertDrafting"
  | "retract"
  | "revertProduced"
  | "hold"
  | "cancel"
  | "restore"
  | "unpost"
  | "skipIdea"
  | "holdIdea";

export interface TransitionConfig {
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  reasonLabel: string;
  successMessage: string;
  /** เหตุผลตั้งต้น (แก้ได้) — ไม่ถือว่าเป็นข้อความที่พิมพ์ค้าง */
  defaultReason?: string;
}

/** ข้อความของแต่ละ variant — ตรงกับตาราง §2.5 (เหตุผลบังคับทุกอัน) */
export const TRANSITION_CONFIG: Record<TransitionVariant, TransitionConfig> = {
  sendBack: {
    title: "ส่งกลับแก้",
    description: 'ชิ้นนี้จะกลับเป็น "AI ร่าง" เพื่อให้แก้เนื้อหา แล้วส่งตรวจใหม่',
    confirmLabel: "ส่งกลับ",
    reasonLabel: "บอกว่าให้แก้อะไร",
    successMessage: "ส่งกลับแก้แล้ว",
  },
  revertDrafting: {
    title: "ย้อนเป็นวางแผน",
    description: 'ชิ้นนี้จะกลับเป็น "วางแผนแล้ว" เพื่อรอร่างใหม่',
    confirmLabel: "ย้อนสถานะ",
    reasonLabel: "เหตุผลที่ย้อน",
    successMessage: "ย้อนเป็นวางแผนแล้ว",
  },
  retract: {
    title: "ถอนอนุมัติ",
    description: 'ชิ้นนี้จะกลับเป็น "รอตรวจ" และต้องอนุมัติใหม่ก่อนใช้งาน',
    confirmLabel: "ถอนอนุมัติ",
    reasonLabel: "เหตุผลที่ถอนอนุมัติ",
    successMessage: "ถอนอนุมัติแล้ว",
  },
  revertProduced: {
    title: "ย้อนเป็นอนุมัติแล้ว",
    description: 'ชิ้นนี้จะกลับเป็น "อนุมัติแล้ว" (ยังไม่ถ่าย/ยังไม่มีภาพ)',
    confirmLabel: "ย้อนสถานะ",
    reasonLabel: "เหตุผลที่ย้อน",
    successMessage: "ย้อนสถานะแล้ว",
  },
  hold: {
    title: "พักรอเงื่อนไข",
    description: "พักชิ้นนี้ไว้ก่อน แล้วกด “กลับมาทำต่อ” ได้เมื่อเงื่อนไขพร้อม",
    confirmLabel: "พักไว้",
    reasonLabel: "รออะไรอยู่",
    successMessage: "พักรอเงื่อนไขแล้ว",
  },
  cancel: {
    title: "ยกเลิกชิ้นงาน",
    description: "ชิ้นนี้จะออกจากปฏิทิน ถ้าหยิบมาจากสัญญาณ สัญญาณจะกลับไปรอในกล่อง กู้คืนได้ภายหลัง",
    confirmLabel: "ยกเลิกชิ้นงาน",
    danger: true,
    reasonLabel: "เหตุผลที่ยกเลิก",
    successMessage: "ยกเลิกชิ้นงานแล้ว",
  },
  restore: {
    title: "กู้คืนชิ้นงาน",
    description: "ชิ้นนี้จะกลับมาอยู่ในปฏิทิน",
    confirmLabel: "กู้คืน",
    reasonLabel: "เหตุผลที่กู้คืน",
    successMessage: "กู้คืนชิ้นงานแล้ว",
  },
  unpost: {
    title: "ปลดโพสต์",
    description: "ชิ้นนี้จะกลับไปก่อนโพสต์ และต้องวางลิงก์/กด “โพสต์แล้ว” ใหม่",
    confirmLabel: "ปลดโพสต์",
    danger: true,
    reasonLabel: "เหตุผลที่ปลดโพสต์",
    successMessage: "ปลดโพสต์แล้ว",
  },
  // หน้าคัดไอเดีย (/marketing/triage) — เหตุผลบังคับเหมือนกัน (≥3) แต่ถ้อยคำเป็นของการคัด ไม่ใช่ "ยกเลิกชิ้นงาน"
  skipIdea: {
    title: "ไม่ทำไอเดียนี้",
    description: "ไอเดียนี้จะออกจากรายการคัด เก็บเหตุผลไว้เป็นข้อมูล และกู้คืนได้ภายหลังที่หน้า “ชิ้นงานทั้งหมด”",
    confirmLabel: "ไม่ทำ",
    danger: true,
    reasonLabel: "เหตุผลที่ไม่ทำ",
    successMessage: "ไม่ทำไอเดียนี้แล้ว",
  },
  holdIdea: {
    title: "เลื่อนไอเดียไปรอบหน้า",
    description: "ไอเดียนี้จะย้ายไปแท็บ “เลื่อนไว้” แล้วกด “กลับมาคัด” ได้เมื่อพร้อม",
    confirmLabel: "เลื่อน",
    reasonLabel: "เหตุผลที่เลื่อน (แก้ได้)",
    successMessage: "เลื่อนไอเดียไปรอบหน้าแล้ว",
    defaultReason: "เลื่อนไปรอบหน้า",
  },
};

function useFocusOnOpen<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    // Modal โฟกัส panel หลัง child mount — รอหนึ่งจังหวะแล้วดึงโฟกัสเข้าช่องแรกของฟอร์ม
    const t = setTimeout(() => ref.current?.focus(), 60);
    return () => clearTimeout(t);
  }, []);
  return ref;
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 break-words">{message}</span>
    </div>
  );
}

interface ReasonBodyProps {
  config: TransitionConfig;
  /** ข้อความเพิ่มเติม เช่น "ชิ้นนี้ต้องอนุมัติใหม่" */
  extra?: ReactNode;
  onSubmit: (reason: string) => Promise<PieceResult<unknown>>;
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
}

function ReasonBody({ config, extra, onSubmit, onClose, onDirtyChange }: ReasonBodyProps) {
  const router = useRouter();
  const toast = useToast();
  const taRef = useFocusOnOpen<HTMLTextAreaElement>();
  const [reason, setReason] = useState(config.defaultReason ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const trimmed = reason.trim();
  const canSubmit = trimmed.length >= REASON_MIN && reason.length <= REASON_MAX && !busy;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await onSubmit(trimmed);
      if (!res.ok) {
        if (res.stale) {
          // แท็บเก่ากว่า DB: ปิดกล่อง แจ้งข้อความ แล้วโหลดหน้าใหม่ (ไม่ค้างกล่องที่กดซ้ำไม่ได้แล้ว)
          toast.push(res.error, "error");
          onClose();
          router.refresh();
          return;
        }
        setError(res.error);
        return;
      }
      onDirtyChange(false);
      toast.push(config.successMessage);
      onClose();
      router.refresh();
    } catch {
      setError("ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) void submit();
      }}
      className="space-y-3"
    >
      <p className="text-sm leading-relaxed text-zinc-700">{config.description}</p>
      {extra}
      <ReasonField
        label={config.reasonLabel}
        value={reason}
        onChange={(v) => {
          setReason(v);
          onDirtyChange(v.trim().length > 0);
        }}
        min={REASON_MIN}
        max={REASON_MAX}
        required
        inputRef={taRef}
      />
      {error && <ErrorBox message={error} />}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
          ยกเลิก
        </Button>
        <Button type="submit" variant={config.danger ? "danger" : "primary"} loading={busy} disabled={!canSubmit}>
          {config.confirmLabel}
        </Button>
      </div>
      {!canSubmit && !busy && <p className="text-xs text-zinc-600">กรอกเหตุผลอย่างน้อย {REASON_MIN} ตัวอักษรเพื่อกดยืนยันได้</p>}
    </form>
  );
}

export function TransitionDialog({
  open,
  onClose,
  variant,
  extra,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  variant: TransitionVariant;
  extra?: ReactNode;
  onSubmit: (reason: string) => Promise<PieceResult<unknown>>;
}) {
  const config = TRANSITION_CONFIG[variant];
  const dirty = useRef(false);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={config.title}
      confirmBeforeClose={() => !dirty.current || window.confirm("ทิ้งข้อความที่พิมพ์ไว้?")}
    >
      <ReasonBody
        config={config}
        extra={extra}
        onSubmit={onSubmit}
        onClose={onClose}
        onDirtyChange={(d) => {
          dirty.current = d;
        }}
      />
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// เลื่อนวัน (content_piece_defer) — วันใหม่ + เวลา (ไม่บังคับ) + เหตุผลบังคับ 3–500
// ---------------------------------------------------------------------------

function DeferBody({
  todayTh,
  currentDate,
  onSubmit,
  onClose,
  onDirtyChange,
}: {
  todayTh: string;
  currentDate: string | null;
  onSubmit: (date: string, reason: string, time: string | null) => Promise<PieceResult<unknown>>;
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const dateRef = useFocusOnOpen<HTMLInputElement>();
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const trimmed = reason.trim();
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= todayTh && date !== currentDate;
  const canSubmit = dateOk && trimmed.length >= REASON_MIN && reason.length <= REASON_MAX && !busy;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await onSubmit(date, trimmed, time || null);
      if (!res.ok) {
        if (res.stale) {
          // แท็บเก่ากว่า DB: ปิดกล่อง แจ้งข้อความ แล้วโหลดหน้าใหม่ (ไม่ค้างกล่องที่กดซ้ำไม่ได้แล้ว)
          toast.push(res.error, "error");
          onClose();
          router.refresh();
          return;
        }
        setError(res.error);
        return;
      }
      onDirtyChange(false);
      toast.push("เลื่อนวันแล้ว");
      onClose();
      router.refresh();
    } catch {
      setError("เลื่อนวันไม่สำเร็จ ลองใหม่อีกครั้ง");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) void submit();
      }}
      className="space-y-3"
    >
      <p className="text-sm leading-relaxed text-zinc-700">เลือกวันใหม่ของชิ้นนี้ — ต้องบอกเหตุผล เพื่อให้ย้อนดูได้ทีหลัง</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="defer-date" className="block text-sm font-medium text-zinc-800">
            วันใหม่
          </label>
          <input
            id="defer-date"
            ref={dateRef}
            type="date"
            min={todayTh}
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              onDirtyChange(true);
            }}
            className="min-h-11 w-full rounded-md border border-zinc-300 bg-white px-2.5 text-base focus:border-primary-600 focus:outline-none focus:ring-1 focus:ring-primary-600"
          />
          {currentDate && date === currentDate && <p className="text-xs text-amber-800">เป็นวันเดิมอยู่แล้ว เลือกวันอื่น</p>}
        </div>
        <div className="space-y-1">
          <label htmlFor="defer-time" className="block text-sm font-medium text-zinc-800">
            เวลา <span className="text-xs font-normal text-zinc-600">(ไม่บังคับ)</span>
          </label>
          <input
            id="defer-time"
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="min-h-11 w-full rounded-md border border-zinc-300 bg-white px-2.5 text-base focus:border-primary-600 focus:outline-none focus:ring-1 focus:ring-primary-600"
          />
        </div>
      </div>
      <ReasonField
        label="เหตุผลที่เลื่อน"
        value={reason}
        onChange={(v) => {
          setReason(v);
          onDirtyChange(true);
        }}
        min={REASON_MIN}
        max={REASON_MAX}
        required
      />
      {error && <ErrorBox message={error} />}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
          ยกเลิก
        </Button>
        <Button type="submit" loading={busy} disabled={!canSubmit}>
          เลื่อนวัน
        </Button>
      </div>
      {!canSubmit && !busy && <p className="text-xs text-zinc-600">เลือกวันใหม่และกรอกเหตุผลอย่างน้อย {REASON_MIN} ตัวอักษรเพื่อกดยืนยันได้</p>}
    </form>
  );
}

export function DeferDialog({
  open,
  onClose,
  todayTh,
  currentDate,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  todayTh: string;
  currentDate: string | null;
  onSubmit: (date: string, reason: string, time: string | null) => Promise<PieceResult<unknown>>;
}) {
  const dirty = useRef(false);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="เลื่อนวัน"
      confirmBeforeClose={() => !dirty.current || window.confirm("ทิ้งข้อมูลที่กรอกไว้?")}
    >
      <DeferBody
        todayTh={todayTh}
        currentDate={currentDate}
        onSubmit={onSubmit}
        onClose={onClose}
        onDirtyChange={(d) => {
          dirty.current = d;
        }}
      />
    </Modal>
  );
}
