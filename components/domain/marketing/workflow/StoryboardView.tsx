"use client";

// StoryboardView — บทพูด + ช็อตที่ต้องถ่ายของคลิป (โหมดอ่าน + ติ๊ก "ถ่ายแล้ว")
// - ติ๊กช็อตทำได้ทุกสถานะ (แม้ล็อกเนื้อหาหลังอนุมัติ) ผ่าน toggleShot → RPC เดิม (campaign_toggle_clip_shot)
// - checkbox เป็น <input> จริง พื้นที่แตะ 44×44 · aria-label="ช็อต n ถ่ายแล้ว"
// - ข้อความ [ต้องยืนยัน: …] ไฮไลต์ด้วย ConfirmMarkerText
// - ไม่แสดง clip_brief.hooks (แหล่ง hook คือ content_hook เท่านั้น)

import { useState } from "react";
import { toggleShot } from "@/lib/actions/content-pieces";
import { useToast } from "@/components/ui/Toast";
import { ConfirmMarkerText } from "@/components/domain/marketing/workflow/ConfirmMarkerText";
import { SEGMENT_ROLE_TH, readCta, readSegments, readShots } from "@/lib/marketing/piece-copy";
import type { ClipBrief } from "@/lib/marketing/clip-brief";

export function StoryboardView({
  stepId,
  artifactId,
  clipBrief,
}: {
  stepId: string;
  artifactId: string | null;
  clipBrief: ClipBrief | null;
}) {
  const toast = useToast();
  const segments = readSegments(clipBrief);
  const shots = readShots(clipBrief);
  const cta = readCta(clipBrief);
  const idea = typeof clipBrief?.idea === "string" ? clipBrief.idea.trim() : "";

  const [done, setDone] = useState<Record<string, boolean>>(() => Object.fromEntries(shots.map((s) => [s.id, s.done])));
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  async function onToggle(shotId: string, next: boolean) {
    if (!artifactId) return;
    setBusy((b) => ({ ...b, [shotId]: true }));
    setDone((d) => ({ ...d, [shotId]: next })); // optimistic
    try {
      const res = await toggleShot(stepId, artifactId, shotId, next);
      if (!res.ok) {
        setDone((d) => ({ ...d, [shotId]: !next }));
        toast.push(res.error, "error");
      }
    } catch {
      setDone((d) => ({ ...d, [shotId]: !next }));
      toast.push("ติ๊กช็อตไม่สำเร็จ ลองใหม่อีกครั้ง", "error");
    } finally {
      setBusy((b) => ({ ...b, [shotId]: false }));
    }
  }

  if (!clipBrief || (segments.length === 0 && shots.length === 0)) {
    return <p className="rounded-md border border-dashed border-zinc-300 bg-white p-3 text-sm text-zinc-600">ยังไม่มี storyboard — AI ยังไม่ได้ร่างบทพูดและช็อต</p>;
  }

  const doneCount = shots.filter((s) => done[s.id]).length;

  return (
    <div className="space-y-4">
      {idea && <p className="break-words text-sm text-zinc-700">{idea}</p>}

      {segments.length > 0 && (
        <section aria-label="บทพูด">
          <h3 className="mb-1.5 text-sm font-semibold text-zinc-900">บทพูด</h3>
          <ul className="space-y-2">
            {segments.map((s) => (
              <li key={s.role} className="rounded-md border border-zinc-200 bg-white p-2.5">
                <p className="text-xs font-medium text-zinc-600">
                  {SEGMENT_ROLE_TH[s.role]}
                  {s.durationSec !== null && <span className="tabular-nums"> · {s.durationSec} วินาที</span>}
                </p>
                <p className="mt-0.5 text-sm leading-relaxed text-zinc-900">
                  <ConfirmMarkerText text={s.line} />
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {shots.length > 0 && (
        <section aria-label="ช็อตที่ต้องถ่าย">
          <h3 className="mb-1.5 text-sm font-semibold text-zinc-900">
            ช็อตที่ต้องถ่าย <span className="font-normal text-zinc-600 tabular-nums">(ถ่ายแล้ว {doneCount}/{shots.length})</span>
          </h3>
          <ul className="space-y-1.5">
            {shots.map((s, i) => {
              const checked = done[s.id] === true;
              return (
                <li key={s.id} className="flex items-start gap-1 rounded-md border border-zinc-200 bg-white pr-2.5">
                  <label className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={busy[s.id] === true || !artifactId}
                      onChange={(e) => void onToggle(s.id, e.target.checked)}
                      aria-label={`ช็อต ${i + 1} ถ่ายแล้ว`}
                      className="h-5 w-5 rounded border-zinc-400 text-primary-600 focus:ring-primary-600 disabled:opacity-50"
                    />
                  </label>
                  <div className={`min-w-0 flex-1 py-2.5 text-sm leading-relaxed ${checked ? "text-zinc-600" : "text-zinc-900"}`}>
                    <span className="mr-1 font-medium text-zinc-600">ช็อต {i + 1}</span>
                    {s.refRole && <span className="mr-1 text-xs text-zinc-600">· {SEGMENT_ROLE_TH[s.refRole]}</span>}
                    {checked && <span className="mr-1 text-xs font-medium text-green-800">· ถ่ายแล้ว</span>}
                    <div className={checked ? "line-through decoration-zinc-400" : ""}>
                      <ConfirmMarkerText text={s.desc || "(ไม่มีคำอธิบาย)"} />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {cta && (
        <p className="text-sm text-zinc-800">
          <span className="font-medium">CTA:</span> {cta.typeLabel}
          {cta.label && <span> — {cta.label}</span>}
        </p>
      )}
    </div>
  );
}
