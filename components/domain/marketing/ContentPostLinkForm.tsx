"use client";

// ContentPostLinkForm — the "วางลิงก์โพสต์" widget shared by both entry
// points the design doc calls out (§2.1): (a) in-plan, appended after
// ArtifactEditor on /marketing/calendar/[stepId] with `artifactId` set, and
// (b) out-of-plan, the "+ เพิ่มโพสต์ใหม่วันนี้" section on
// /marketing/content/entry with no `artifactId` (content_post_upsert's
// p_artifact_id is nullable by design — see 0148's header comment).
//
// Deliberately does NOT fetch any preview/metadata from the pasted URL
// (design §2.2: "เข้าข่าย 'ดึงข้อมูลอัตโนมัติจากลิงก์' ที่โจทย์ห้าม") —
// confirmation that the right link was saved is a clickable
// target="_blank" link to the URL just saved, nothing fetched from it.
//
// Edit-after-save is narrow on purpose (design §2.3): only content_type_code
// can change once a post exists. The URL field is read-only after the first
// save — content_post is unique on (shop_id, platform, external_id), so
// "editing" the URL would silently create a second post and orphan the
// first one's metric history instead of fixing it in place.

import { useState, useTransition } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Link2, Pencil } from "lucide-react";
import { upsertContentPost, updateContentPostType } from "@/lib/actions/content";
import { PLATFORMS, PLATFORM_LABEL } from "@/lib/marketing/content-types";
import type { ContentPlatform, ContentPostStatus, ContentPostSummary, ContentTypeRow } from "@/lib/marketing/content-types";
import { CONTENT_POST_STATUS_LABEL } from "@/lib/marketing/content-types";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { ContentTypeChip } from "@/components/domain/marketing/ContentTypeChip";

// Bangkok has no DST — a fixed +07:00 offset is safe and matches every
// other "เขตเวลาไทย" spot in this codebase (server side uses `at time zone
// 'Asia/Bangkok'`; this is the client-side mirror for a plain <input
// type="datetime-local">, which carries no timezone info of its own and
// would otherwise be interpreted in whatever timezone the device is set
// to — explicit +07:00 keeps this correct even if that's ever not Bangkok).
function nowBangkokInputValue(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

function bangkokInputToIso(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  return `${y}-${mo}-${d}T${h}:${mi}:00+07:00`;
}

function isoToBangkokInputValue(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export function ContentPostLinkForm({
  artifactId,
  contentTypeDefault,
  existingPost,
  contentTypes,
}: {
  /** Omitted/undefined for the out-of-plan (§2.1(b)) entry point. */
  artifactId?: string;
  /** Pre-fill from campaign_step.content_type_code, if the step already has
   * one set (§2.1(a) — always null today per §0.3, harmless when it is). */
  contentTypeDefault?: string | null;
  existingPost: ContentPostSummary | null;
  contentTypes: ContentTypeRow[];
}) {
  const toast = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editingType, setEditingType] = useState(false);
  const [platform, setPlatform] = useState<ContentPlatform>("tiktok");
  const [postUrl, setPostUrl] = useState("");
  const [contentTypeCode, setContentTypeCode] = useState(contentTypeDefault ?? "");
  const [postedAtInput, setPostedAtInput] = useState(nowBangkokInputValue);
  const [editTypeValue, setEditTypeValue] = useState(existingPost?.contentTypeCode ?? "");
  const [pending, startTransition] = useTransition();
  const [editPending, startEditTransition] = useTransition();

  function reset() {
    setPlatform("tiktok");
    setPostUrl("");
    setContentTypeCode(contentTypeDefault ?? "");
    setPostedAtInput(nowBangkokInputValue());
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmedUrl = postUrl.trim();
    if (!trimmedUrl) {
      toast.push("กรุณาวางลิงก์โพสต์ก่อนบันทึก", "error");
      return;
    }
    const iso = bangkokInputToIso(postedAtInput);
    if (!iso) {
      toast.push("รูปแบบวันที่ไม่ถูกต้อง", "error");
      return;
    }
    startTransition(async () => {
      const result = await upsertContentPost({
        platform,
        postUrl: trimmedUrl,
        postedAt: iso,
        contentTypeCode: contentTypeCode || null,
        artifactId: artifactId || null,
      });
      if (!result.ok) {
        toast.push(result.error, "error");
        return;
      }
      toast.push("บันทึกลิงก์โพสต์แล้ว");
      setOpen(false);
      reset();
      router.refresh();
    });
  }

  function handleSaveType() {
    if (!existingPost) return;
    // H3 fix (26 ก.ย. 69): never let this fire with an empty selection —
    // same rule as StepContentTypeSelector's Rule 1 (see that file's
    // header). The edit-mode <select> below no longer offers an "ไม่ระบุ"
    // option and the "บันทึก" button is disabled while editTypeValue is
    // empty, so this is belt-and-suspenders, not the only gate.
    if (!editTypeValue) {
      toast.push("กรุณาเลือกประเภทก่อนบันทึก", "error");
      return;
    }
    startEditTransition(async () => {
      const result = await updateContentPostType(existingPost.id, {
        platform: existingPost.platform,
        postUrl: existingPost.postUrl,
        postedAt: existingPost.postedAt,
        externalId: existingPost.externalId,
        contentTypeCode: editTypeValue,
      });
      if (!result.ok) {
        toast.push(result.error, "error");
        return;
      }
      toast.push("บันทึกประเภทแล้ว");
      setEditingType(false);
      router.refresh();
    });
  }

  // ---- Success state (§2.4): read-only card, URL locked -----------------
  if (existingPost) {
    const matchedType = contentTypes.find((ct) => ct.code === existingPost.contentTypeCode);
    const isActive: boolean = existingPost.status === "active";
    return (
      <div className="rounded-lg border border-zinc-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <a
            href={existingPost.postUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-9 items-center gap-1.5 text-sm font-medium text-primary-700 hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{PLATFORM_LABEL[existingPost.platform]} — เปิดดูโพสต์</span>
          </a>
          {!isActive && (
            <span className="text-xs font-medium text-amber-700">
              ({CONTENT_POST_STATUS_LABEL[existingPost.status as ContentPostStatus]})
            </span>
          )}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          {matchedType ? (
            <ContentTypeChip contentType={matchedType} />
          ) : (
            <span className="text-xs text-zinc-400">ยังไม่ระบุประเภท</span>
          )}
          {isActive && !editingType && (
            <button
              type="button"
              onClick={() => {
                setEditTypeValue(existingPost.contentTypeCode ?? "");
                setEditingType(true);
              }}
              className="inline-flex min-h-8 items-center gap-1 text-xs font-semibold text-primary-600 hover:underline"
            >
              <Pencil className="h-3 w-3" aria-hidden="true" />
              แก้ประเภท
            </button>
          )}
        </div>

        {editingType && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {/* H3 fix (26 ก.ย. 69, security ตรวจย้อนหลัง): NO "ไม่ระบุ" option
                here, unlike the create form below (§2.4) where it's correct.
                updateContentPostType's write is null-preserving (0148 §H3) —
                picking "ไม่ระบุ" here looked like "clear this post's type"
                but silently no-op'd and kept the old value: toast said
                "บันทึกประเภทแล้ว", refresh showed the same chip, no error,
                no explanation. If this post has never had a type set,
                editTypeValue starts at "" and matches nothing below — the
                select shows no option highlighted, which is fine: "บันทึก"
                stays disabled until the owner actually picks a real type
                (same gate as StepContentTypeSelector's Rule 1). Actually
                clearing a type for real needs its own explicit action with
                a confirm step — same shape as StepContentTypeSelector's
                "ล้างประเภท" — not built here; don't add "ไม่ระบุ" back as a
                shortcut for it. */}
            <select
              value={editTypeValue}
              onChange={(e) => setEditTypeValue(e.target.value)}
              className="min-h-9 rounded-md border border-zinc-300 bg-white px-2 text-xs focus:border-primary-500 focus:outline-none"
            >
              {/* 🔴 N2 fix (26 ก.ย. 69): a `disabled` placeholder, NOT "no
                  empty option at all". Removing it outright (the first H3
                  attempt) dead-ended every post that has no type yet:
                  editTypeValue starts at "" (line ~206), nothing matched,
                  so React fell back to rendering option[0] — "พาเข้าไลฟ์",
                  the type this shop uses most — as the visible selection
                  while state stayed "". Picking the option already shown
                  fires no `change`, so the disabled "บันทึก" never woke up
                  and there was no way out except selecting some other type
                  and switching back. The comment there even asserted "the
                  select shows no option highlighted, which is fine" — that
                  assertion was the bug.
                  `disabled` keeps H3 closed (can't select back into "" ⇒
                  can't send null ⇒ can't hit 0148's null-preserving no-op)
                  while value="" still MATCHES this option, so an untyped
                  post shows this placeholder instead of a wrong type. */}
              <option value="" disabled>
                — เลือกประเภท —
              </option>
              {contentTypes.map((ct) => (
                <option key={ct.code} value={ct.code}>
                  {ct.labelTh}
                </option>
              ))}
            </select>
            {!editTypeValue && (
              <span className="text-[0.7rem] text-zinc-500">เลือกประเภทก่อนจึงจะกดบันทึกได้</span>
            )}
            <Button size="sm" loading={editPending} disabled={!editTypeValue} onClick={handleSaveType}>
              บันทึก
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditingType(false)}>
              ยกเลิก
            </Button>
          </div>
        )}
      </div>
    );
  }

  // ---- Empty state (§2.4): dashed trigger --------------------------------
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-zinc-300 bg-white p-3 text-sm font-medium text-zinc-500 hover:border-primary-300 hover:text-primary-600"
      >
        <Link2 className="h-4 w-4" aria-hidden="true" />
        วางลิงก์โพสต์
      </button>
    );
  }

  // ---- Form ---------------------------------------------------------------
  return (
    <form onSubmit={handleSubmit} className="space-y-2.5 rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
      <div className="flex gap-2">
        <div className="flex-1">
          <label htmlFor={`cplf-platform-${artifactId ?? "new"}`} className="mb-1 block text-xs font-medium text-zinc-600">
            แพลตฟอร์ม
          </label>
          <select
            id={`cplf-platform-${artifactId ?? "new"}`}
            value={platform}
            onChange={(e) => setPlatform(e.target.value as ContentPlatform)}
            className="min-h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm focus:border-primary-500 focus:outline-none"
          >
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {PLATFORM_LABEL[p]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label htmlFor={`cplf-type-${artifactId ?? "new"}`} className="mb-1 block text-xs font-medium text-zinc-600">
            ประเภท (ไม่บังคับ)
          </label>
          <select
            id={`cplf-type-${artifactId ?? "new"}`}
            value={contentTypeCode}
            onChange={(e) => setContentTypeCode(e.target.value)}
            className="min-h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm focus:border-primary-500 focus:outline-none"
          >
            <option value="">ไม่ระบุ</option>
            {contentTypes.map((ct) => (
              <option key={ct.code} value={ct.code}>
                {ct.labelTh}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor={`cplf-url-${artifactId ?? "new"}`} className="mb-1 block text-xs font-medium text-zinc-600">
          ลิงก์โพสต์
        </label>
        <input
          id={`cplf-url-${artifactId ?? "new"}`}
          type="url"
          inputMode="url"
          autoComplete="off"
          value={postUrl}
          onChange={(e) => setPostUrl(e.target.value)}
          placeholder="https://www.tiktok.com/@3jjewelry/video/..."
          required
          className="min-h-11 w-full rounded-md border border-zinc-300 px-3 text-sm focus:border-primary-500 focus:outline-none"
        />
      </div>

      <div>
        <label htmlFor={`cplf-postedat-${artifactId ?? "new"}`} className="mb-1 block text-xs font-medium text-zinc-600">
          วันที่โพสต์
        </label>
        <input
          id={`cplf-postedat-${artifactId ?? "new"}`}
          type="datetime-local"
          value={postedAtInput}
          onChange={(e) => setPostedAtInput(e.target.value)}
          required
          className="min-h-11 w-full rounded-md border border-zinc-300 px-3 text-sm focus:border-primary-500 focus:outline-none"
        />
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => {
            setOpen(false);
            reset();
          }}
        >
          ยกเลิก
        </Button>
        <Button type="submit" size="sm" loading={pending}>
          บันทึก
        </Button>
      </div>
    </form>
  );
}

// Exported for tests / future callers that need to convert an existing
// post's posted_at (ISO) back into the same input format this form uses.
export { isoToBangkokInputValue };
