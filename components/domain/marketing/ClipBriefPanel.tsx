"use client";

// ClipBriefPanel — the heart of M4 (ux-content-calendar.md §5, §7:
// "render/edit idea, ... sections (accordion hook/body/close), ...
// shot list (checklist เพิ่ม/ลบ/ติ๊ก)"). Renders for step_artifact rows whose
// artifact_type is short_form_clip / live_highlight_clip (isClipArtifactType,
// lib/marketing/clip-brief.ts) — the page decides whether to mount this,
// this component assumes it always should once given a clipBrief.
//
// Three <details> accordions (mobile rule, design §4: "collapse ต่อ section
// เป็น default" — same pattern as CampaignCalendar's prep_note_th <details>).
// Segments save as one setArtifactContent({clipBrief}) call (whole-document
// write, per design §5's field table). Shots use the dedicated
// toggleClipShot RPC per-id (R6) so two quick taps never lose an update —
// optimistic locally, reverted on error.
//
// Tolerant of partial/missing fields everywhere (design §5: "AI ร่างมาไม่ครบ
// เป็นเรื่องปกติ ... renderer ต้องทน missing key ทุกจุด") — findSegment()
// synthesises a blank row for any role not present, shots without a `desc`
// fall back to a placeholder instead of rendering "undefined".

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { setArtifactContent, toggleClipShot } from "@/lib/actions/calendar";
import { CTA_TYPE_LABEL, PILLAR_LABEL, emptyClipBrief, nextShotId } from "@/lib/marketing/clip-brief";
import type { ClipBrief, ClipSegment, ClipSegmentRole } from "@/lib/marketing/clip-brief";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

const SEGMENT_ROLE_LABEL: Record<ClipSegmentRole, string> = {
  hook: "Hook (เปิด 3-5 วิ)",
  body: "Body (เนื้อหา)",
  close: "Close (ปิด + CTA)",
};
const SEGMENT_ORDER: ClipSegmentRole[] = ["hook", "body", "close"];

function findSegment(segments: ClipSegment[] | undefined, role: ClipSegmentRole): ClipSegment {
  return segments?.find((s) => s && s.role === role) ?? { role, line: "", duration_sec: undefined, shot: "" };
}

export function ClipBriefPanel({ artifactId, clipBrief }: { artifactId: string; clipBrief: ClipBrief | null }) {
  const toast = useToast();
  const router = useRouter();
  const [brief, setBrief] = useState<ClipBrief | null>(clipBrief);
  const [creating, startCreateTransition] = useTransition();
  const [savingSegments, startSaveSegmentsTransition] = useTransition();
  const [busyShotIds, setBusyShotIds] = useState<Set<string>>(() => new Set());
  const [addingShot, setAddingShot] = useState(false);
  const [newShotDesc, setNewShotDesc] = useState("");
  const [addShotPending, startAddShotTransition] = useTransition();
  // Rows 3 (fixed hook/body/close) edit buffer — seeded from `brief` once;
  // handleCreate() re-seeds it explicitly when a brand-new brief is created.
  const [editRows, setEditRows] = useState<Record<ClipSegmentRole, ClipSegment>>(() => ({
    hook: findSegment(clipBrief?.segments, "hook"),
    body: findSegment(clipBrief?.segments, "body"),
    close: findSegment(clipBrief?.segments, "close"),
  }));

  function handleCreate() {
    startCreateTransition(async () => {
      const fresh = emptyClipBrief();
      const result = await setArtifactContent(artifactId, { clipBrief: fresh });
      if (!result.ok) {
        toast.push(result.error, "error");
        return;
      }
      setBrief(fresh);
      setEditRows({
        hook: findSegment(fresh.segments, "hook"),
        body: findSegment(fresh.segments, "body"),
        close: findSegment(fresh.segments, "close"),
      });
      toast.push("สร้างโครงคลิปแล้ว");
      router.refresh();
    });
  }

  if (!brief) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-3.5 text-center">
        <p className="text-xs text-zinc-500">ยังไม่มีโครงคลิป (hook/body/close + shot list)</p>
        <Button size="sm" variant="secondary" className="mt-2" loading={creating} onClick={handleCreate}>
          สร้างโครงคลิป
        </Button>
      </div>
    );
  }

  function handleSaveSegments() {
    startSaveSegmentsTransition(async () => {
      const nextBrief: ClipBrief = { ...brief!, segments: SEGMENT_ORDER.map((role) => editRows[role]) };
      const result = await setArtifactContent(artifactId, { clipBrief: nextBrief });
      if (!result.ok) {
        toast.push(result.error, "error");
        return;
      }
      setBrief(nextBrief);
      toast.push("บันทึกสคริปต์แล้ว");
      router.refresh();
    });
  }

  const shots = brief.shots ?? [];
  const doneCount = shots.filter((s) => s?.done).length;

  function handleToggleShot(shotId: string, done: boolean) {
    const prevShots = shots;
    const nextShots = shots.map((s) => (s.id === shotId ? { ...s, done } : s));
    setBrief({ ...brief!, shots: nextShots });
    setBusyShotIds((prev) => new Set(prev).add(shotId));
    // Not wrapped in useTransition — this is a fire-and-forget per-id RPC,
    // busyShotIds already gives per-row loading feedback without a page-wide
    // pending flag.
    toggleClipShot(artifactId, shotId, done).then((result) => {
      setBusyShotIds((prev) => {
        const next = new Set(prev);
        next.delete(shotId);
        return next;
      });
      if (!result.ok) {
        setBrief({ ...brief!, shots: prevShots });
        toast.push(result.error, "error");
        return;
      }
      router.refresh();
    });
  }

  function handleAddShot() {
    const desc = newShotDesc.trim();
    if (!desc) return;
    const id = nextShotId(brief!);
    const nextBrief: ClipBrief = { ...brief!, shots: [...shots, { id, desc, done: false }] };
    startAddShotTransition(async () => {
      const result = await setArtifactContent(artifactId, { clipBrief: nextBrief });
      if (!result.ok) {
        toast.push(result.error, "error");
        return;
      }
      setBrief(nextBrief);
      setNewShotDesc("");
      setAddingShot(false);
      toast.push("เพิ่มช็อตแล้ว");
      router.refresh();
    });
  }

  /** Remove a shot typed by mistake. Rewrites the whole shots[] (unlike
   * ticking, which goes through the per-shot RPC to avoid clobbering a
   * concurrent tick) — deleting is deliberate and rare, so the simpler
   * whole-brief write is the right trade here. */
  function handleDeleteShot(shotId: string) {
    const nextBrief: ClipBrief = { ...brief!, shots: shots.filter((s) => s.id !== shotId) };
    startAddShotTransition(async () => {
      const result = await setArtifactContent(artifactId, { clipBrief: nextBrief });
      if (!result.ok) {
        toast.push(result.error, "error");
        return;
      }
      setBrief(nextBrief);
      toast.push("ลบช็อตแล้ว");
      router.refresh();
    });
  }

  const cta = brief.cta ?? { type: "none" as const };
  const meta = brief.meta ?? {};

  return (
    <div className="space-y-2 rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
      {brief.idea && <p className="text-xs text-zinc-500">💡 {brief.idea}</p>}

      <details className="rounded-md border border-zinc-100" open>
        <summary className="min-h-11 cursor-pointer select-none px-2.5 py-2.5 text-sm font-semibold text-zinc-800">
          สคริปต์ (hook → body → close)
        </summary>
        <div className="space-y-3 border-t border-zinc-100 p-2.5">
          {SEGMENT_ORDER.map((role) => (
            <div key={role} className="space-y-1">
              <label className="text-xs font-medium text-zinc-600">{SEGMENT_ROLE_LABEL[role]}</label>
              <textarea
                value={editRows[role].line ?? ""}
                onChange={(e) => setEditRows((prev) => ({ ...prev, [role]: { ...prev[role], line: e.target.value } }))}
                rows={2}
                placeholder="พูดอะไร..."
                className="w-full rounded-md border border-zinc-300 p-2 text-sm focus:border-primary-500 focus:outline-none"
              />
              <div className="flex gap-2">
                <input
                  type="text"
                  value={editRows[role].shot ?? ""}
                  onChange={(e) => setEditRows((prev) => ({ ...prev, [role]: { ...prev[role], shot: e.target.value } }))}
                  placeholder="มุมกล้อง/ท่า/ของประกอบฉาก"
                  className="min-h-9 flex-1 rounded-md border border-zinc-300 px-2 text-xs focus:border-primary-500 focus:outline-none"
                />
                <input
                  type="number"
                  min={0}
                  value={editRows[role].duration_sec ?? ""}
                  onChange={(e) =>
                    setEditRows((prev) => ({
                      ...prev,
                      [role]: { ...prev[role], duration_sec: e.target.value === "" ? undefined : Number(e.target.value) },
                    }))
                  }
                  placeholder="วิ"
                  aria-label={`${SEGMENT_ROLE_LABEL[role]} ความยาว (วินาที)`}
                  className="min-h-9 w-16 rounded-md border border-zinc-300 px-2 text-xs focus:border-primary-500 focus:outline-none"
                />
              </div>
            </div>
          ))}
          <div className="flex justify-end">
            <Button size="sm" loading={savingSegments} onClick={handleSaveSegments}>
              บันทึกสคริปต์
            </Button>
          </div>
        </div>
      </details>

      <details className="rounded-md border border-zinc-100" open>
        <summary className="min-h-11 cursor-pointer select-none px-2.5 py-2.5 text-sm font-semibold text-zinc-800">
          ช็อตที่ต้องถ่าย <span className="font-normal text-zinc-400">(ถ่ายแล้ว {doneCount}/{shots.length})</span>
        </summary>
        <div className="space-y-2 border-t border-zinc-100 p-2.5">
          {shots.length === 0 && <p className="text-xs text-zinc-400">ยังไม่มีช็อตในลิสต์</p>}
          <ul className="space-y-1">
            {shots.map((s) => {
              const busy = busyShotIds.has(s.id);
              return (
                <li key={s.id} className="flex items-center gap-1">
                  <label className="flex min-h-11 flex-1 cursor-pointer items-center gap-2.5 rounded-md px-1.5 hover:bg-zinc-50">
                    <input
                      type="checkbox"
                      checked={!!s.done}
                      disabled={busy}
                      onChange={(e) => handleToggleShot(s.id, e.target.checked)}
                      className="h-5 w-5 shrink-0 rounded border-zinc-300 text-primary-600 focus:ring-primary-500 disabled:opacity-50"
                    />
                    <span className={`text-sm ${s.done ? "text-zinc-400 line-through" : "text-zinc-700"}`}>
                      {s.desc || "(ไม่มีคำอธิบาย)"}
                      {s.ref_role && SEGMENT_ROLE_LABEL[s.ref_role] && (
                        <span className="text-zinc-400"> · {SEGMENT_ROLE_LABEL[s.ref_role]}</span>
                      )}
                    </span>
                  </label>
                  <button
                    type="button"
                    onClick={() => handleDeleteShot(s.id)}
                    disabled={busy || addShotPending}
                    aria-label={`ลบช็อต ${s.desc || ""}`}
                    className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md text-zinc-300 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>

          {addingShot ? (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <input
                type="text"
                value={newShotDesc}
                onChange={(e) => setNewShotDesc(e.target.value)}
                placeholder="เช่น ตาชั่งดิจิทัลชั่งแท่ง"
                className="min-h-9 flex-1 rounded-md border border-zinc-300 px-2 text-xs focus:border-primary-500 focus:outline-none"
              />
              <Button size="sm" loading={addShotPending} onClick={handleAddShot}>
                เพิ่ม
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setAddingShot(false);
                  setNewShotDesc("");
                }}
              >
                ยกเลิก
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAddingShot(true)}
              className="inline-flex min-h-9 items-center gap-1 text-xs font-semibold text-primary-600 hover:underline"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" /> เพิ่มช็อต
            </button>
          )}
        </div>
      </details>

      <details className="rounded-md border border-zinc-100">
        <summary className="min-h-11 cursor-pointer select-none px-2.5 py-2.5 text-sm font-semibold text-zinc-800">
          CTA + รายละเอียดเพิ่มเติม
        </summary>
        <div className="space-y-1.5 border-t border-zinc-100 p-2.5 text-xs text-zinc-600">
          <p>
            <span className="font-medium text-zinc-700">CTA:</span> {CTA_TYPE_LABEL[cta.type] ?? cta.type ?? "-"}
            {cta.label ? ` — "${cta.label}"` : ""}
            {cta.code ? ` (โค้ด: ${cta.code})` : ""}
          </p>
          {meta.pillar && (
            <p>
              <span className="font-medium text-zinc-700">Pillar:</span> {PILLAR_LABEL[meta.pillar] ?? meta.pillar}
            </p>
          )}
          {meta.hook_type && (
            <p>
              <span className="font-medium text-zinc-700">Hook type:</span> {meta.hook_type}
            </p>
          )}
          {!meta.pillar && !meta.hook_type && <p className="text-zinc-400">ยังไม่มี meta เพิ่มเติม</p>}
        </div>
      </details>
    </div>
  );
}
