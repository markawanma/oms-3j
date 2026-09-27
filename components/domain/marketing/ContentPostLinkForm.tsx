"use client";

// ContentPostLinkForm — the "วางลิงก์โพสต์" widget shared by both entry
// points the design doc calls out (§2.1): (a) in-plan, appended after
// ArtifactEditor on /marketing/calendar/[stepId] with `artifactId` set, and
// (b) out-of-plan, the "+ เพิ่มโพสต์ใหม่วันนี้" section on
// /marketing/content/entry with no `artifactId` (content_post_upsert's
// p_artifact_id is nullable by design — see 0148's header comment).
//
// 🔄 เจ้าของกลับมติ 27 ก.ย. 69 (design doc §2.2/§2.2b — see docs/3j-jewelry/
// analytics/ux-content-measurement.md): this now DOES fetch a preview, but
// only through channels TikTok itself opened up for exactly this purpose —
// canonicalizeTikTokLink() (already run at submit time, see below) plus
// lib/actions/content.ts's inspectContentLink(), which decodes the posted-
// at timestamp straight from the TikTok video/photo id (no network) and
// fetches caption/channel name via TikTok's public oEmbed endpoint. Fired
// on blur or paste of the URL field ONLY (never on every keystroke) —
// lib/actions/content.ts's own header explains why: this is PURELY a UX
// aid, never a trust boundary. The real canonicalize-and-validate step
// still runs server-side inside upsertContentPost() on submit, exactly as
// before this change; nothing inspectContentLink() returns is trusted
// blindly at write time. A failed inspect (not TikTok, oEmbed down, link
// rejected) must never block filling in the form by hand — see
// runInspect()'s comment below.
//
// Edit-after-save is narrow on purpose (design §2.3): only content_type_code
// can change once a post exists. The URL field is read-only after the first
// save — content_post is unique on (shop_id, platform, external_id), so
// "editing" the URL would silently create a second post and orphan the
// first one's metric history instead of fixing it in place.

import { useRef, useState, useTransition } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Link2, Loader2, Pencil } from "lucide-react";
import { inspectContentLink, upsertContentPost, updateContentPostType } from "@/lib/actions/content";
import type { InspectContentLinkResult } from "@/lib/actions/content";
import { autoFilledDateMismatch, shouldApplyInspectResult } from "@/lib/marketing/content-post-inspect-guards";
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
  const [inspectPending, startInspectTransition] = useTransition();
  const [inspectPreview, setInspectPreview] = useState<InspectContentLinkResult | null>(null);

  // Mirrors `postUrl` on every render so handleUrlPaste's deferred callback
  // (below) can read the value AFTER the browser applies the paste, without
  // closing over a stale value captured at the time the paste event fired —
  // a plain closure over `postUrl` here would still see the pre-paste text.
  const postUrlRef = useRef(postUrl);
  postUrlRef.current = postUrl;

  // Guards against re-inspecting a URL that hasn't changed — without this, a
  // second blur on the SAME text (e.g. tabbing through the form, or
  // clicking "บันทึก" which blurs the field first) would re-fetch and
  // silently overwrite a posted-at time the owner had already corrected by
  // hand after the first auto-fill. Only a genuinely NEW url re-triggers.
  const lastInspectedUrlRef = useRef<string | null>(null);

  // 🔴 H-1 fix (security รอบ 4, 27 ก.ย. 69): which URL the "วันที่โพสต์"
  // field's CURRENT value was auto-filled for — null means "not tied to any
  // auto-fill" (owner typed it by hand, or auto-fill never fired).
  // handleSubmit checks this against the URL actually being submitted
  // (autoFilledDateMismatch, imported above) and BLOCKS if they differ —
  // this is what closes the "edit URL from clip A to clip B, click บันทึก
  // immediately, B silently gets saved with A's date" hole. See
  // lib/marketing/content-post-inspect-guards.ts's header for the full bug
  // writeup. Deliberately NOT cleared by the URL field's onChange below —
  // clearing it there would make this exact mismatch impossible to detect.
  const dateAutoFilledForRef = useRef<string | null>(null);

  function reset() {
    setPlatform("tiktok");
    setPostUrl("");
    setContentTypeCode(contentTypeDefault ?? "");
    setPostedAtInput(nowBangkokInputValue());
    setInspectPreview(null);
    lastInspectedUrlRef.current = null;
    dateAutoFilledForRef.current = null;
  }

  /** ContentPostLinkForm's UX pre-fill (design §2.2 — see this file's header
   * for the full context). Fired on blur/paste of the URL field only (never
   * onChange) so it never fires more than once per pause in typing.
   *
   * 🔴 H-1 fix (security รอบ 4, 27 ก.ย. 69): the owner may have already
   * edited the URL field again while THIS request was in flight —
   * shouldApplyInspectResult() re-checks `trimmed` (what was requested)
   * against `postUrlRef.current` (what's on screen right now) before
   * touching any state. A mismatch discards the ENTIRE result (date AND
   * caption/authorName) — never apply half of a stale answer.
   *
   * 🔴 On failure — not a TikTok post, canonicalize rejects it (live/profile
   * link), oEmbed down, network hiccup — this MUST NOT block anything: the
   * owner can still type/paste the URL, pick a date by hand, and submit
   * exactly as if this function didn't exist. No toast, no error state; the
   * only visible effect of a failure is that no preview/pre-fill appears.
   * The real rejection (e.g. "ลิงก์นี้เป็นลิงก์ไลฟ์") still surfaces at
   * submit time via upsertContentPost's own canonicalize call — this
   * function is not where that error belongs. */
  function runInspect(urlToInspect: string) {
    const trimmed = urlToInspect.trim();
    if (!trimmed || trimmed === lastInspectedUrlRef.current) return;
    lastInspectedUrlRef.current = trimmed;
    startInspectTransition(async () => {
      // 🔴 N-1 fix (security รอบ 5, 27 ก.ย. 69): inspectContentLink() เองจับ
      // error ครบแล้วและคืน {ok:false} เสมอ — แต่ถ้าการเรียก server action
      // เองล้มระดับ transport (เน็ตมือถือหลุด, action id ใช้ไม่ได้หลัง
      // deploy ใหม่) promise นี้ reject ตรงๆ และ React 19's async transition
      // จะโยน error นั้นขึ้น error boundary — (dashboard) ไม่มี error.tsx
      // ⇒ ทั้งหน้าพังเป็น "Application error" พร้อมข้อความที่เพิ่งพิมพ์หายหมด
      // ทั้งที่ inspect เป็นแค่ UX เสริมที่ยิงอัตโนมัติตอน blur/paste เจ้าของ
      // ไม่ได้ตั้งใจกดอะไรเลย ขัดกับกติกา "inspect ล้มเหลวห้ามบล็อกอะไร"
      let result: Awaited<ReturnType<typeof inspectContentLink>>;
      try {
        result = await inspectContentLink(trimmed);
      } catch {
        if (lastInspectedUrlRef.current === trimmed) lastInspectedUrlRef.current = null;
        return;
      }
      if (!shouldApplyInspectResult(trimmed, postUrlRef.current)) return;
      if (!result.ok) {
        setInspectPreview(null);
        return;
      }
      setInspectPreview(result.data);
      // ผู้ใช้แก้วันที่ทับได้เสมอ — เติมให้ครั้งนี้เท่านั้น ไม่ล็อกช่อง
      // (input ด้านล่างเป็น controlled ปกติ, onChange ของมันไม่ถูกแตะที่นี่)
      if (result.data.postedAt) {
        setPostedAtInput(isoToBangkokInputValue(result.data.postedAt));
        dateAutoFilledForRef.current = trimmed;
      }
    });
  }

  function handleUrlPaste() {
    // paste event ยิงก่อน browser จะใส่ค่าใหม่ลง input จริง — ต้องรอรอบ
    // ถัดไป (setTimeout 0) แล้วอ่านจาก ref ไม่ใช่ปิด closure ทับ postUrl ตรงๆ
    setTimeout(() => runInspect(postUrlRef.current), 0);
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
    // 🔴 H-1 fix (security รอบ 4, 27 ก.ย. 69): วันที่ในช่องอาจถูกเติมมาจาก
    // ลิงก์คลิปอื่น (แก้ข้อความ URL หลัง auto-fill โดยไม่ได้ blur/paste ซ้ำ
    // ให้ inspect ใหม่ทัน) — บล็อกแล้วให้ผู้ใช้ตรวจ/แก้วันที่เอง ดีกว่าปล่อย
    // ให้บันทึกวันที่ของคลิปอื่นทับเข้าไปเงียบๆ
    if (autoFilledDateMismatch(dateAutoFilledForRef.current, trimmedUrl)) {
      toast.push("วันที่โพสต์นี้ถูกเติมมาจากลิงก์อื่น — ตรวจวันที่ให้ตรงกับลิงก์นี้ก่อนบันทึก", "error");
      return;
    }
    startTransition(async () => {
      // inspectPreview.caption is only ever non-null when it matches the URL
      // currently shown — the URL field's onChange clears inspectPreview on
      // every edit (below), so there is no stale-caption-for-a-different-
      // link case to guard against separately here.
      const result = await upsertContentPost({
        platform,
        postUrl: trimmedUrl,
        postedAt: iso,
        contentTypeCode: contentTypeCode || null,
        artifactId: artifactId || null,
        caption: inspectPreview?.caption ?? null,
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
      // 0151 fix (26 ก.ย. 69, security รอบ 2, H1): updateContentPostType now
      // updates content_post by primary key — it no longer needs (or
      // accepts) platform/postUrl/postedAt/externalId at all.
      const result = await updateContentPostType(existingPost.id, editTypeValue);
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
            {/* H3 fix (26 ก.ย. 69, security ตรวจย้อนหลัง — comment updated
                26 ก.ย. 69 after 0151/H1 replaced the write path below): NO
                "ไม่ระบุ" option here, unlike the create form below (§2.4)
                where it's correct. updateContentPostType now calls
                content_post_update_type (0151), which RAISES on a null
                content_type_code instead of silently keeping the old value
                — but the UX reasoning for keeping this gate is unchanged:
                the RPC call already never fires with an empty selection
                (disabled `Button` below + this component's own guard in
                handleSaveType), and there's still no confirm step for
                "actually clear this post's type", so offering "ไม่ระบุ" here
                would just be a control that either does nothing useful or
                triggers a server error the owner didn't ask for. If this
                post has never had a type set, editTypeValue starts at ""
                and matches nothing below — the select shows no option
                highlighted, which is fine: "บันทึก" stays disabled until the
                owner actually picks a real type (same gate as
                StepContentTypeSelector's Rule 1). Clearing a type for real
                needs its own explicit action with a confirm step — same
                shape as StepContentTypeSelector's "ล้างประเภท" — not built
                here; don't add "ไม่ระบุ" back as a shortcut for it. */}
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
          onChange={(e) => {
            setPostUrl(e.target.value);
            // ล้าง preview ทันทีที่แก้ข้อความ — กันบรรทัดยืนยัน/แคปชั่นเก่า
            // ค้างแสดงคู่กับลิงก์ใหม่ที่ยังไม่ได้ตรวจ
            setInspectPreview(null);
            // 🔴 H-1 fix: ล้าง lastInspectedUrlRef ด้วย (ไม่ใช่แค่ preview) —
            // ข้อความเปลี่ยนแล้ว ของเดิมไม่ valid อีกต่อไป ให้ blur/paste
            // ครั้งหน้า inspect ใหม่จริง ไม่ใช่ถูก guard ว่า "ยังเป็น url เดิม"
            // 🔴 ตั้งใจ "ไม่" ล้าง dateAutoFilledForRef ที่นี่ — ต้องปล่อยให้
            // ค้างชี้ไปที่ URL เก่า เพื่อให้ autoFilledDateMismatch ที่
            // handleSubmit ตรวจพบความไม่ตรงกันได้ (ดูคอมเมนต์ตรง ref นั้น)
            lastInspectedUrlRef.current = null;
          }}
          onBlur={() => runInspect(postUrl)}
          onPaste={handleUrlPaste}
          placeholder="https://www.tiktok.com/@3jjewelry/video/..."
          required
          className="min-h-11 w-full rounded-md border border-zinc-300 px-3 text-sm focus:border-primary-500 focus:outline-none"
        />
        {inspectPending && (
          <p className="mt-1 flex items-center gap-1 text-xs text-zinc-400">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            กำลังตรวจลิงก์...
          </p>
        )}
        {!inspectPending && inspectPreview && (inspectPreview.caption || inspectPreview.authorName) && (
          <div className="mt-1.5 rounded-md border border-primary-100 bg-primary-50 p-2 text-xs">
            <p className="font-medium text-primary-700">ใช่คลิปนี้ไหม?</p>
            {inspectPreview.authorName && (
              <p className="mt-0.5 text-zinc-600">ช่อง: {inspectPreview.authorName}</p>
            )}
            {inspectPreview.caption && (
              <p className="mt-0.5 truncate text-zinc-600" title={inspectPreview.caption}>
                {inspectPreview.caption}
              </p>
            )}
          </div>
        )}
      </div>

      <div>
        <label htmlFor={`cplf-postedat-${artifactId ?? "new"}`} className="mb-1 block text-xs font-medium text-zinc-600">
          วันที่โพสต์
        </label>
        <input
          id={`cplf-postedat-${artifactId ?? "new"}`}
          type="datetime-local"
          value={postedAtInput}
          onChange={(e) => {
            setPostedAtInput(e.target.value);
            // ผู้ใช้แก้เอง — ไม่ผูกกับ auto-fill ของ url ไหนอีกต่อไป
            dateAutoFilledForRef.current = null;
          }}
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
        {/* disabled ระหว่าง inspectPending ด้วย (security รอบ 4, M-related) —
            กันกดบันทึกขณะกำลังรอผล inspect อยู่ ซึ่งเป็นช่วงที่ dateAutoFilledForRef
            ยังไม่นิ่ง */}
        <Button type="submit" size="sm" loading={pending} disabled={inspectPending}>
          บันทึก
        </Button>
      </div>
    </form>
  );
}

// Exported for tests / future callers that need to convert an existing
// post's posted_at (ISO) back into the same input format this form uses.
export { isoToBangkokInputValue };
