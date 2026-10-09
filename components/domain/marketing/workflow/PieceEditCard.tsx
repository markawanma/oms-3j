"use client";

// PieceEditCard — โหมดแก้เนื้อหา/hook (เฉพาะ drafting/in_review — ที่ล็อกหลังอนุมัติไม่แสดงปุ่มนี้เลย · brief 0.8)
// - แก้ได้: hook A/B (ประเภท + ข้อความ) · ข้อความหลัก/แคปชัน (content_body) · บทพูดและช็อต (ClipBriefPanel เดิม โหมดแก้ — ไม่มีส่วนสถานะ legacy/ hooks)
// - ก่อนบันทึกถ้ามีผลตรวจที่ตรวจไปแล้ว → เตือนว่าจะถูกล้างทั้ง 3 ด่าน (confirm) · หลังบันทึก DB ล้างและ event 'gate' reset ทำให้แถบแจ้งขึ้นเอง

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { ClipBriefPanel } from "@/components/domain/marketing/ClipBriefPanel";
import { ReasonField } from "@/components/domain/marketing/workflow/ReasonField";
import { EDIT_CARD_ID, useEditMode } from "@/components/domain/marketing/workflow/PieceClientShell";
import { useSyncedDraft } from "@/components/domain/marketing/workflow/useSyncedDraft";
import { savePieceBody, upsertHook } from "@/lib/actions/content-pieces";
import { HOOK_TYPES, HOOK_TYPE_LABEL } from "@/lib/marketing/piece-labels";
import { isClipArtifactType } from "@/lib/marketing/clip-brief";
import type { PieceHook, PieceRow } from "@/lib/marketing/piece-types";

const SELECT =
  "min-h-11 w-full rounded-md border border-zinc-300 bg-white px-2.5 text-base focus:border-primary-600 focus:outline-none focus:ring-1 focus:ring-primary-600";

/** ผลตรวจที่ "มีอะไรให้เสีย" (ตรวจไปแล้ว ไม่ใช่ pending) */
function hasCheckedGates(p: PieceRow): boolean {
  return [p.gates.factCheck, p.gates.brandRule, p.gates.riskOwner].some((g) => g !== null && g.status !== "pending");
}

function HookEditor({ stepId, label, hook, resetsGates }: { stepId: string; label: "A" | "B"; hook: PieceHook | null; resetsGates: boolean }) {
  const router = useRouter();
  const toast = useToast();
  // draft ตามค่าจาก server หลัง refresh (BUG-QA-1) · แก้อยู่แล้ว server เปลี่ยน = conflict ไม่เขียนทับเงียบ
  const t = useSyncedDraft(hook?.text ?? "");
  const ty = useSyncedDraft(hook?.hookType ?? "");
  const text = t.draft;
  const type = ty.draft;
  const setText = t.setDraft;
  const setType = ty.setDraft;
  const conflict = t.conflict || ty.conflict;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = (text.trim() !== (hook?.text ?? "").trim() || type !== (hook?.hookType ?? "")) && !conflict;

  async function save() {
    if (resetsGates && !window.confirm("แก้ hook แล้วผลตรวจทั้ง 3 ด่านจะถูกล้าง ต้องตรวจใหม่ — ดำเนินการต่อ?")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await upsertHook(stepId, { id: hook?.id ?? null, label, text, hookType: type });
      if (!res.ok) {
        setError(res.error);
        if (res.stale) router.refresh();
        return;
      }
      toast.push(`บันทึก hook ${label} แล้ว`);
      router.refresh();
    } catch {
      setError("บันทึก hook ไม่สำเร็จ ลองใหม่อีกครั้ง");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-zinc-200 p-2.5">
      <p className="text-sm font-semibold text-zinc-900">Hook {label}</p>
      <div className="space-y-1">
        <label htmlFor={`hook-type-${label}`} className="block text-sm font-medium text-zinc-800">
          ประเภท
        </label>
        <select id={`hook-type-${label}`} value={type} onChange={(e) => setType(e.target.value)} className={SELECT}>
          <option value="">เลือกประเภท</option>
          {HOOK_TYPES.map((t) => (
            <option key={t} value={t}>
              {HOOK_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </div>
      {conflict && (
        <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900">
          hook นี้ถูกแก้จากที่อื่นระหว่างที่คุณพิมพ์ — บันทึกไม่ได้จนกว่าจะโหลดค่าล่าสุด
          <button
            type="button"
            onClick={() => {
              t.reload();
              ty.reload();
            }}
            className="ml-1 min-h-11 font-medium underline underline-offset-2"
          >
            โหลดค่าล่าสุด (ทิ้งที่พิมพ์)
          </button>
        </p>
      )}
      <ReasonField label="ข้อความ hook" value={text} onChange={setText} max={500} rows={2} error={error} />
      <Button type="button" variant="secondary" loading={busy} disabled={!changed || text.trim() === "" || type === ""} onClick={() => void save()}>
        บันทึก hook {label}
      </Button>
    </div>
  );
}

export function PieceEditCard({ piece }: { piece: PieceRow }) {
  const router = useRouter();
  const toast = useToast();
  const { editing, setEditing } = useEditMode();
  // BUG-QA-1: ช่องแก้ตามเนื้อหาล่าสุดจาก server (ตอบ [ต้องยืนยัน] แล้ว refresh ส่งข้อความใหม่มา) ไม่ใช่ค่าตอน mount
  const bodyDraft = useSyncedDraft(piece.contentBody ?? "");
  const body = bodyDraft.draft;
  const setBody = bodyDraft.setDraft;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isClip = piece.artifactType !== null && isClipArtifactType(piece.artifactType);
  const resets = hasCheckedGates(piece);
  const a = piece.hooks.find((h) => h.label === "A") ?? null;
  const b = piece.hooks.find((h) => h.label === "B") ?? null;

  async function saveBody() {
    if (!piece.artifactId) return;
    if (resets && !window.confirm("แก้เนื้อหาแล้วผลตรวจทั้ง 3 ด่านจะถูกล้าง ต้องตรวจใหม่ — ดำเนินการต่อ?")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await savePieceBody(piece.stepId, piece.artifactId, body);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast.push("บันทึกเนื้อหาแล้ว");
      router.refresh();
    } catch {
      setError("บันทึกเนื้อหาไม่สำเร็จ ลองใหม่อีกครั้ง");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id={EDIT_CARD_ID} aria-label="แก้เนื้อหา" className="rounded-lg border border-zinc-200 bg-white p-3.5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-zinc-900">แก้เนื้อหา</h2>
        <Button type="button" variant={editing ? "secondary" : "primary"} size="sm" className="max-md:min-h-11" aria-expanded={editing} onClick={() => setEditing(!editing)}>
          <Pencil className="h-4 w-4" aria-hidden="true" />
          {editing ? "ปิดโหมดแก้" : "เปิดโหมดแก้"}
        </Button>
      </div>
      {!editing ? (
        <p className="mt-1 text-sm text-zinc-700">แก้ข้อความ hook แคปชัน บทพูด และช็อตได้ตอนนี้ (หลังอนุมัติจะล็อก)</p>
      ) : (
        <div className="mt-3 space-y-4">
          {resets && (
            <p className="rounded-md border border-amber-200 bg-amber-50 p-2.5 text-sm text-amber-900">
              ตอนนี้มีผลตรวจที่ตรวจไปแล้ว — แก้เนื้อหาหรือ hook แล้วผลตรวจทั้ง 3 ด่านจะถูกล้าง ต้องตรวจใหม่
            </p>
          )}

          {isClip && (
            <div className="grid gap-3 sm:grid-cols-2">
              <HookEditor stepId={piece.stepId} label="A" hook={a} resetsGates={resets} />
              <HookEditor stepId={piece.stepId} label="B" hook={b} resetsGates={resets} />
            </div>
          )}

          {piece.artifactId ? (
            <div className="space-y-2">
              <ReasonField
                label={isClip ? "แคปชัน" : "ข้อความ"}
                value={body}
                onChange={setBody}
                max={20000}
                rows={6}
                error={error}
                hint="ข้อความที่มี [ต้องยืนยัน: …] ให้ตอบในส่วน “ข้อที่ต้องยืนยัน” — ไม่ต้องพิมพ์ทับเอง"
              />
              {bodyDraft.conflict && (
                <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 p-2.5 text-sm text-amber-900">
                  เนื้อหาถูกแก้จากที่อื่น (เช่น ตอบข้อที่ต้องยืนยัน) ระหว่างที่คุณพิมพ์ — บันทึกไม่ได้จนกว่าจะโหลดค่าล่าสุด
                  <button type="button" onClick={bodyDraft.reload} className="ml-1 min-h-11 font-medium underline underline-offset-2">
                    โหลดค่าล่าสุด (ทิ้งที่พิมพ์)
                  </button>
                </p>
              )}
              <Button type="button" loading={busy} disabled={!bodyDraft.dirty || bodyDraft.conflict} onClick={() => void saveBody()}>
                บันทึกเนื้อหา
              </Button>
            </div>
          ) : (
            <p className="text-sm text-zinc-700">ชิ้นนี้ยังไม่มีเอกสารเนื้อหา — รอ AI ร่าง</p>
          )}

          {isClip && piece.artifactId && (
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-zinc-900">บทพูดและช็อต</h3>
              <ClipBriefPanel artifactId={piece.artifactId} clipBrief={piece.clipBrief} />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
