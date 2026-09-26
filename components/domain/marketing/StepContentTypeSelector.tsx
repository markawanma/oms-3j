"use client";

// StepContentTypeSelector — /marketing/calendar/[stepId] header widget that
// calls analytics.campaign_step_set_content_type (0150) via
// lib/actions/calendar.ts's setStepContentType.
//
// 🔴 This is the ONLY caller of setStepContentType in the app — read that
// action's header comment before touching this file. The two rules it
// exists to enforce, mechanically (not just by convention):
//   1. The "บันทึก" button is disabled whenever the dropdown has no
//      selection — it can NEVER fire with value="" (which would otherwise
//      become `null`, silently clearing an existing tag the owner didn't
//      mean to touch).
//   2. Clearing an existing tag is a separate, explicit action
//      ("ล้างประเภท") gated behind its own inline confirm step
//      ("ล้างประเภทที่ตั้งไว้จริงไหม?") before it ever calls the action
//      with null — no single tap can wipe a tag by accident.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { setStepContentType } from "@/lib/actions/calendar";
import type { ContentTypeRow } from "@/lib/marketing/content-types";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { ContentTypeChip } from "@/components/domain/marketing/ContentTypeChip";

export function StepContentTypeSelector({
  stepId,
  current,
  contentTypes,
}: {
  stepId: string;
  current: string | null;
  contentTypes: ContentTypeRow[];
}) {
  const toast = useToast();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(current ?? "");
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [pending, startTransition] = useTransition();

  const currentType = current ? contentTypes.find((ct) => ct.code === current) : undefined;

  function handleSave() {
    // Rule 1 (see file header): an empty selection never reaches the
    // action — block here with a message instead of sending null.
    if (!value) {
      toast.push("กรุณาเลือกประเภทก่อนบันทึก", "error");
      return;
    }
    startTransition(async () => {
      const result = await setStepContentType(stepId, value);
      if (!result.ok) {
        toast.push(result.error, "error");
        return;
      }
      toast.push("ตั้งประเภทแล้ว");
      setEditing(false);
      router.refresh();
    });
  }

  function handleClear() {
    // Rule 2: only reachable after the inline confirm below — this is the
    // one intentional path that sends null.
    startTransition(async () => {
      const result = await setStepContentType(stepId, null);
      if (!result.ok) {
        toast.push(result.error, "error");
        return;
      }
      toast.push("ล้างประเภทแล้ว");
      setConfirmingClear(false);
      setEditing(false);
      setValue("");
      router.refresh();
    });
  }

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {currentType ? (
          <ContentTypeChip contentType={currentType} />
        ) : (
          <span className="text-xs text-zinc-400">ยังไม่ระบุประเภท</span>
        )}
        <button
          type="button"
          onClick={() => {
            setValue(current ?? "");
            setEditing(true);
          }}
          className="inline-flex min-h-8 items-center gap-1 text-xs font-semibold text-primary-600 hover:underline"
        >
          <Pencil className="h-3 w-3" aria-hidden="true" />
          {currentType ? "แก้ประเภท" : "ตั้งประเภท"}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="min-h-9 rounded-md border border-zinc-300 bg-white px-2 text-xs focus:border-primary-500 focus:outline-none"
      >
        <option value="">เลือกประเภท</option>
        {contentTypes.map((ct) => (
          <option key={ct.code} value={ct.code}>
            {ct.labelTh}
          </option>
        ))}
      </select>
      <Button size="sm" loading={pending} onClick={handleSave}>
        บันทึก
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => {
          setEditing(false);
          setConfirmingClear(false);
        }}
      >
        ยกเลิก
      </Button>

      {current && !confirmingClear && (
        <button
          type="button"
          onClick={() => setConfirmingClear(true)}
          className="min-h-8 text-xs font-medium text-red-600 hover:underline"
        >
          ล้างประเภท
        </button>
      )}
      {confirmingClear && (
        <span className="flex items-center gap-1.5 text-xs text-zinc-600">
          ล้างประเภทที่ตั้งไว้จริงไหม?
          <button
            type="button"
            disabled={pending}
            onClick={handleClear}
            className="font-semibold text-red-600 hover:underline disabled:opacity-50"
          >
            ยืนยันล้าง
          </button>
          <button type="button" onClick={() => setConfirmingClear(false)} className="text-zinc-500 hover:underline">
            ไม่ล้าง
          </button>
        </span>
      )}
    </div>
  );
}
