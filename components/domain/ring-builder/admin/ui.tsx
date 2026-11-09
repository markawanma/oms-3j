"use client";

// ชิ้นส่วนหน้าตาที่ใช้ร่วมในจอหลังบ้านออกแบบแหวน — ไม่ import อะไรจาก components/domain/gems (นั่นคือจอ "ต้นทุน" คนละตาราง)
import { useId, useState } from "react";
import type { ReactNode } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { MM100_MAX, MM100_MIN } from "@/lib/ring-builder/mm";

export const RB_FIELD =
  "min-h-11 w-full rounded-md border border-zinc-300 bg-white px-2.5 text-base text-zinc-900 focus:border-primary-600 focus:outline-none focus:ring-1 focus:ring-primary-600 aria-[invalid=true]:border-red-500 disabled:bg-zinc-100 disabled:text-zinc-500";

export function Field({ label, hint, error, children, className = "" }: { label: string; hint?: string; error?: string | null; children: (p: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => ReactNode; className?: string }) {
  const id = useId();
  const msgId = `${id}-m`;
  const described = error || hint ? msgId : undefined;
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label htmlFor={id} className="text-sm font-semibold text-zinc-800">
        {label}
      </label>
      {children({ id, "aria-describedby": described, "aria-invalid": error ? true : undefined })}
      {error ? (
        <p id={msgId} role="alert" className="text-xs font-medium text-red-700">
          ⚠ {error}
        </p>
      ) : hint ? (
        <p id={msgId} className="text-xs text-zinc-600">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function ErrorLine({ message }: { message: string | null | undefined }) {
  return message ? (
    <p role="alert" className="break-words rounded-md border border-red-200 bg-red-50 p-2.5 text-sm font-medium text-red-800">
      {message}
    </p>
  ) : null;
}

export function Note({ tone = "amber", children }: { tone?: "amber" | "zinc"; children: ReactNode }) {
  const c = tone === "amber" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-zinc-200 bg-zinc-50 text-zinc-700";
  return <div className={`rounded-md border p-2.5 text-xs ${c}`}>{children}</div>;
}

export function Swatch({ hex }: { hex: string }) {
  return <span aria-hidden="true" className="mr-2 inline-block h-4 w-4 shrink-0 rounded-full border border-zinc-300 align-[-3px]" style={{ backgroundColor: hex }} />;
}

/** ขนาดพลอย 2 ช่อง กว้าง · ยาว (ข้อ 10) — ทรงกลมล็อกให้ยาว = กว้าง · ค่าเป็นสตริงมม. ("2" · "2.5") ไม่แปลงเป็น float */
export function SizeFields({
  w, h, onChange, round, disabled, error,
}: { w: string; h: string; onChange: (w: string, h: string) => void; round: boolean; disabled?: boolean; error?: string | null }) {
  const minMm = `${MM100_MIN / 100}`;
  const maxMm = `${MM100_MAX / 100}`;
  return (
    <div className="grid grid-cols-2 gap-2">
      <Field label="กว้าง (มม.)" error={error} hint={`${minMm}–${maxMm} มม. · ทศนิยมไม่เกิน 2 ตำแหน่ง`}>
        {(p) => (
          <input {...p} inputMode="decimal" className={RB_FIELD} value={w} disabled={disabled} onChange={(e) => onChange(e.target.value, round ? e.target.value : h)} />
        )}
      </Field>
      <Field label="ยาว (มม.)" hint={round ? "ทรงกลม: ยาว = กว้าง" : "ระบบเรียงค่าที่มากกว่าไว้หน้า (4×3 = 3×4)"}>
        {(p) => (
          <input {...p} inputMode="decimal" className={RB_FIELD} value={round ? w : h} disabled={disabled || round} onChange={(e) => onChange(w, e.target.value)} />
        )}
      </Field>
    </div>
  );
}

/** กล่องยืนยันก่อนปิด/แก้ราคา — onConfirm คืนข้อความผิดพลาด (หรือ null = สำเร็จ แล้วปิดเอง) */
export function ConfirmDialog({
  open, title, children, confirmLabel, danger, onConfirm, onClose,
}: { open: boolean; title: string; children: ReactNode; confirmLabel: string; danger?: boolean; onConfirm: () => Promise<string | null>; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <ConfirmBody confirmLabel={confirmLabel} danger={danger} onConfirm={onConfirm} onClose={onClose}>
        {children}
      </ConfirmBody>
    </Modal>
  );
}

function ConfirmBody({ children, confirmLabel, danger, onConfirm, onClose }: { children: ReactNode; confirmLabel: string; danger?: boolean; onConfirm: () => Promise<string | null>; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function go() {
    setBusy(true);
    setErr(null);
    const e = await onConfirm();
    setBusy(false);
    if (e) setErr(e);
    else onClose();
  }
  return (
    <div className="space-y-3">
      <div className="text-sm text-zinc-800">{children}</div>
      <ErrorLine message={err} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
          ยกเลิก
        </Button>
        <Button type="button" variant={danger ? "danger" : "primary"} loading={busy} onClick={go}>
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}

/** สวิตช์รูปร่าง (กลม/ไข่) ขนาดเล็กหน้าชื่อทรง */
export function ShapeGlyph({ kind }: { kind: "round" | "oval" }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
      {kind === "round" ? <circle cx="8" cy="8" r="6.5" fill="#fff" stroke="#5C5456" strokeWidth="1.5" /> : <ellipse cx="8" cy="8" rx="4.8" ry="7" fill="#fff" stroke="#5C5456" strokeWidth="1.5" />}
    </svg>
  );
}
