"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { NotebookPen, Pencil, Trash2 } from "lucide-react";
import { crmAddNote, crmDeleteNote, crmEditNote } from "@/lib/actions/crm";
import type { CrmNoteRow } from "@/lib/actions/crm";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatBangkokTime } from "@/lib/format";

/** Notes list is readable by any dev role (crm_customer_note SELECT policy =
 * tenant member, migration 0021 §4) — `canWrite` (owner/admin, decided
 * server-side via getDevRole()) only gates add/edit/delete, not the list
 * itself, unlike PII/audit which hide the whole section for staff. */
export function NotesSection({
  customerId,
  notes,
  canWrite,
}: {
  customerId: string;
  notes: CrmNoteRow[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleAdd() {
    const text = draft.trim();
    if (!text) {
      setAddError("กรุณากรอกข้อความโน้ต");
      return;
    }
    startTransition(async () => {
      const result = await crmAddNote(customerId, text);
      if (!result.ok) {
        setAddError(result.error);
        return;
      }
      setDraft("");
      setAddError(null);
      router.refresh();
    });
  }

  function startEdit(note: CrmNoteRow) {
    setEditingId(note.id);
    setEditValue(note.body);
    setEditError(null);
  }

  function handleEditSave(noteId: string) {
    const text = editValue.trim();
    if (!text) {
      setEditError("กรุณากรอกข้อความโน้ต");
      return;
    }
    startTransition(async () => {
      const result = await crmEditNote(noteId, customerId, text);
      if (!result.ok) {
        setEditError(result.error);
        return;
      }
      setEditingId(null);
      router.refresh();
    });
  }

  function handleDelete(noteId: string) {
    startTransition(async () => {
      const result = await crmDeleteNote(noteId, customerId);
      setConfirmDeleteId(null);
      if (!result.ok) {
        // No cached-data banner slot here (notes list has no separate error
        // state) — surface via the add-form error line, close enough for MVP.
        setAddError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
      <h3 className="text-sm font-bold text-zinc-800">โน้ต ({notes.length})</h3>

      {canWrite && (
        <div className="mt-2.5 flex flex-col gap-1.5">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="เพิ่มโน้ตเกี่ยวกับลูกค้ารายนี้..."
            rows={2}
            className="rounded-md border border-zinc-300 px-2.5 py-2 text-sm text-zinc-900 placeholder:text-zinc-400"
          />
          {addError && <p className="text-xs text-red-600">{addError}</p>}
          <Button variant="secondary" size="sm" className="self-end" loading={pending} onClick={handleAdd}>
            เพิ่มโน้ต
          </Button>
        </div>
      )}

      <div className="mt-3">
        {notes.length === 0 ? (
          <EmptyState icon={NotebookPen} title="ยังไม่มีโน้ต" description="เพิ่มโน้ตเพื่อบันทึกข้อมูลเกี่ยวกับลูกค้ารายนี้" />
        ) : (
          <ul className="flex flex-col gap-2.5">
            {notes.map((note) => (
              <li key={note.id} className="rounded-md border border-zinc-100 bg-zinc-50 p-2.5">
                {editingId === note.id ? (
                  <div className="flex flex-col gap-1.5">
                    <textarea
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      rows={2}
                      autoFocus
                      className="rounded-md border border-zinc-300 px-2.5 py-2 text-sm text-zinc-900"
                    />
                    {editError && <p className="text-xs text-red-600">{editError}</p>}
                    <div className="flex justify-end gap-1.5">
                      <Button variant="secondary" size="sm" onClick={() => setEditingId(null)} disabled={pending}>
                        ยกเลิก
                      </Button>
                      <Button variant="primary" size="sm" loading={pending} onClick={() => handleEditSave(note.id)}>
                        บันทึก
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="text-sm whitespace-pre-wrap text-zinc-800">{note.body}</p>
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      <p className="text-[0.68rem] text-zinc-400">
                        {formatBangkokTime(note.createdAt)}
                        {note.updatedAt !== note.createdAt ? " (แก้ไขแล้ว)" : ""}
                      </p>
                      {canWrite && (
                        <div className="flex shrink-0 items-center gap-1">
                          {confirmDeleteId === note.id ? (
                            <>
                              <span className="text-xs text-red-600">ลบโน้ตนี้?</span>
                              <Button variant="danger" size="sm" loading={pending} onClick={() => handleDelete(note.id)}>
                                ยืนยัน
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => setConfirmDeleteId(null)}>
                                ยกเลิก
                              </Button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => startEdit(note)}
                                aria-label="แก้ไขโน้ต"
                                className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
                              >
                                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(note.id)}
                                aria-label="ลบโน้ต"
                                className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 hover:bg-red-50 hover:text-red-600"
                              >
                                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
