"use client";

// PostedSheet — "โพสต์แล้ว": วางลิงก์ + เลือก hook ที่ใช้จริง + วัน-เวลาโพสต์ (บน Modal เดิม: มือถือ = bottom sheet / PC = dialog กลางจอ)
// ใช้ได้ทุกหน้า (inbox · หน้าชิ้นงาน) — content-ui-build-plan.md B17, brief 0.10
//
// - ชิ้นคลิป/โพสต์ FB-IG: content_piece_post ผ่าน postPiece (ฝั่ง server canonicalize ลิงก์ TikTok + ตรวจ host + ช่วงวัน)
// - ชิ้น LINE/สตอรี่: ไม่มีลิงก์ → กล่องยืนยันสั้น "บันทึกว่าส่งแล้ว (ไม่มีการวัดผลรายชิ้น)"
// - เลือก hook: ต้องเลือกก่อนบันทึก (รวม "ไม่ระบุ (ข้าม)") — ไม่ตั้งค่าเริ่มต้นให้ ไม่งั้นลืมแล้วข้อมูล hook หาย
// - placeholder = คำอธิบาย ("วางลิงก์โพสต์") ไม่ใช่ลิงก์/แฮนเดิลตัวอย่างที่ดูจริง (F9)

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { ReasonField } from "@/components/domain/marketing/workflow/ReasonField";
import { hookTypeLabel } from "@/lib/marketing/piece-labels";
import { inspectContentLink } from "@/lib/actions/content";
import { postPiece, postPieceNoUrl } from "@/lib/actions/content-pieces";
import { HOOK_TYPES, HOOK_TYPE_LABEL, PLATFORM_POST_LABEL, pieceKindHasPostUrl } from "@/lib/marketing/piece-labels";
import { availablePlatforms, nowBangkokLocalInput } from "@/lib/marketing/post-link";
import type { PostPlatform } from "@/lib/marketing/post-link";
import type { PieceHook, PiecePost } from "@/lib/marketing/piece-types";

type HookChoice = { kind: "none" } | { kind: "skip" } | { kind: "hook"; id: string } | { kind: "other" };

function toBangkokLocalInput(iso: string): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return nowBangkokLocalInput(ms);
}

export interface PostedSheetProps {
  open: boolean;
  onClose: () => void;
  stepId: string;
  title: string;
  pieceKind: string | null;
  posts: PiecePost[];
  hooks: PieceHook[];
}

export function PostedSheet(props: PostedSheetProps) {
  const dirty = useRef(false);
  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title="โพสต์แล้ว"
      confirmBeforeClose={() => !dirty.current || window.confirm("ทิ้งข้อมูลที่กรอกไว้?")}
    >
      {pieceKindHasPostUrl(props.pieceKind) ? (
        <LinkForm {...props} onDirty={(d) => (dirty.current = d)} />
      ) : (
        <NoUrlConfirm {...props} />
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// LINE / สตอรี่
// ---------------------------------------------------------------------------

function NoUrlConfirm({ stepId, title, onClose }: PostedSheetProps) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await postPieceNoUrl(stepId);
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
      toast.push("บันทึกว่าส่งแล้ว");
      onClose();
      router.refresh();
    } catch {
      setError("บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="break-words text-sm font-medium text-zinc-900">{title}</p>
      <p className="text-sm leading-relaxed text-zinc-700">บันทึกว่าส่งแล้ว — ชิ้นนี้ไม่มีลิงก์โพสต์ และไม่มีการวัดผลรายชิ้น</p>
      {error && (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-2 text-sm font-medium text-red-800">
          {error}
        </p>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
          ยกเลิก
        </Button>
        <Button type="button" loading={busy} onClick={() => void confirm()}>
          บันทึกว่าส่งแล้ว
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// คลิป / โพสต์ FB-IG
// ---------------------------------------------------------------------------

function LinkForm({ stepId, title, pieceKind, posts, hooks, onClose, onDirty }: PostedSheetProps & { onDirty: (d: boolean) => void }) {
  const router = useRouter();
  const toast = useToast();
  const platforms = availablePlatforms(pieceKind, posts);
  const labeledHooks = hooks.filter((h) => h.label === "A" || h.label === "B");

  const linkRef = useRef<HTMLInputElement>(null);
  const checkSeq = useRef(0); // ลำดับคำขอตรวจลิงก์ (ทิ้งผลที่กลับมาช้า)
  const [platform, setPlatform] = useState<PostPlatform | null>(platforms.length === 1 ? platforms[0] : null);
  const [url, setUrl] = useState("");
  const [canonical, setCanonical] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [postedAt, setPostedAt] = useState(() => nowBangkokLocalInput());
  const [postedAtTouched, setPostedAtTouched] = useState(false);
  const [hook, setHook] = useState<HookChoice>({ kind: "none" });
  const [otherText, setOtherText] = useState("");
  const [otherType, setOtherType] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => linkRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, []);

  if (platforms.length === 0) {
    return (
      <div className="space-y-3">
        <p className="flex items-start gap-2 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-900">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          ชิ้นนี้มีโพสต์ครบทุกช่องทางแล้ว — ถ้าจะวางลิงก์ใหม่ ให้ปลดโพสต์เดิมก่อน
        </p>
        <Button type="button" variant="secondary" onClick={onClose}>
          ปิด
        </Button>
      </div>
    );
  }

  // ผลตรวจลิงก์ที่กลับมาช้าไม่ใช่ลิงก์ที่กรอกอยู่แล้ว → ทิ้ง (ลำดับคำขอ: ทุกครั้งที่ตรวจใหม่/แก้ลิงก์/เปลี่ยนช่องทาง ลำดับเพิ่ม)

  async function checkLink() {
    const raw = url.trim();
    const my = ++checkSeq.current;
    setCanonical(null);
    setLinkError(null);
    if (!raw || platform !== "tiktok") {
      setInspecting(false);
      return;
    } // ตรวจเฉพาะ TikTok (ตามลิงก์สั้น + ถอดวันเวลาจาก id) — FB/IG ตรวจฝั่ง server ตอนบันทึก
    setInspecting(true);
    try {
      const res = await inspectContentLink(raw);
      if (my !== checkSeq.current) return;
      if (!res.ok) {
        setLinkError(res.error);
        return;
      }
      setCanonical(res.data.canonicalUrl);
      if (res.data.postedAt && !postedAtTouched) {
        const local = toBangkokLocalInput(res.data.postedAt);
        if (local) setPostedAt(local);
      }
    } catch {
      if (my === checkSeq.current) setLinkError("ตรวจลิงก์ไม่สำเร็จ ลองใหม่อีกครั้ง");
    } finally {
      if (my === checkSeq.current) setInspecting(false);
    }
  }

  const hookReady =
    hook.kind === "skip" ||
    hook.kind === "hook" ||
    (hook.kind === "other" && otherText.trim().length > 0 && otherText.length <= 500 && otherType !== "");
  const canSubmit = platform !== null && url.trim().length > 0 && postedAt !== "" && hookReady && !busy;

  async function submit() {
    if (!platform) return;
    setBusy(true);
    setError(null);
    try {
      const choice =
        hook.kind === "hook"
          ? ({ kind: "existing", hookId: hook.id } as const)
          : hook.kind === "other"
            ? ({ kind: "other", text: otherText, hookType: otherType } as const)
            : ({ kind: "skip" } as const);
      const res = await postPiece(stepId, { platform, url, postedAtLocal: postedAt, hook: choice });
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
      onDirty(false);
      toast.push("บันทึกโพสต์แล้ว");
      onClose();
      router.refresh();
    } catch {
      setError("บันทึกโพสต์ไม่สำเร็จ ลองใหม่อีกครั้ง");
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    "min-h-11 w-full rounded-md border border-zinc-300 bg-white px-2.5 text-base focus:border-primary-600 focus:outline-none focus:ring-1 focus:ring-primary-600";
  const optCls = "flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-zinc-300 bg-white p-2.5 has-[:checked]:border-primary-600 has-[:checked]:ring-1 has-[:checked]:ring-primary-600";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) void submit();
      }}
      className="mx-auto w-full max-w-[560px] space-y-4"
    >
      <p className="break-words text-sm font-medium text-zinc-900">{title}</p>

      {platforms.length > 1 && (
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium text-zinc-800">โพสต์ที่ช่องทางไหน</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {platforms.map((p) => (
              <label key={p} className={optCls}>
                <input
                  type="radio"
                  name="post-platform"
                  value={p}
                  checked={platform === p}
                  onChange={() => {
                    setPlatform(p);
                    checkSeq.current++;
                    setInspecting(false);
                    setCanonical(null);
                    setLinkError(null);
                    onDirty(true);
                  }}
                  className="mt-0.5 h-5 w-5 shrink-0 text-primary-600 focus:ring-primary-600"
                />
                <span className="text-sm font-medium text-zinc-900">{PLATFORM_POST_LABEL[p]}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <div className="space-y-1">
        <label htmlFor="posted-link" className="block text-sm font-medium text-zinc-800">
          วางลิงก์โพสต์
        </label>
        <input
          id="posted-link"
          ref={linkRef}
          type="url"
          inputMode="url"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            checkSeq.current++; // ลิงก์เปลี่ยน → ผลตรวจค้างของลิงก์เก่าต้องไม่ย้อนมาทับ
            setInspecting(false);
            setCanonical(null);
            setLinkError(null);
            onDirty(true);
          }}
          onBlur={() => void checkLink()}
          onPaste={() => setTimeout(() => void checkLink(), 0)}
          placeholder="วางลิงก์โพสต์"
          aria-describedby="posted-link-note"
          aria-invalid={linkError ? true : undefined}
          className={inputCls}
        />
        <div id="posted-link-note" className="text-xs">
          {inspecting && <p className="text-zinc-600">กำลังตรวจลิงก์…</p>}
          {canonical && (
            <p className="flex items-start gap-1 break-all text-green-800">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>ลิงก์ที่จะบันทึก: {canonical}</span>
            </p>
          )}
          {linkError && (
            <p role="alert" className="font-medium text-red-700">
              {linkError}
            </p>
          )}
          {!canonical && !linkError && !inspecting && platform === null && <p className="text-zinc-600">เลือกช่องทางก่อน แล้ววางลิงก์</p>}
        </div>
      </div>

      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium text-zinc-800">ใช้ hook ตัวไหนจริง</legend>
        {labeledHooks.map((h) => (
          <label key={h.id} className={optCls}>
            <input
              type="radio"
              name="post-hook"
              checked={hook.kind === "hook" && hook.id === h.id}
              onChange={() => {
                setHook({ kind: "hook", id: h.id });
                onDirty(true);
              }}
              className="mt-0.5 h-5 w-5 shrink-0 text-primary-600 focus:ring-primary-600"
            />
            <span className="min-w-0 text-sm">
              <span className="block font-semibold text-zinc-900">
                {h.label} · {hookTypeLabel(h.hookType)}
              </span>
              <span className="block break-words text-zinc-700">{h.text}</span>
            </span>
          </label>
        ))}
        <label className={optCls}>
          <input
            type="radio"
            name="post-hook"
            checked={hook.kind === "other"}
            onChange={() => {
              setHook({ kind: "other" });
              onDirty(true);
            }}
            className="mt-0.5 h-5 w-5 shrink-0 text-primary-600 focus:ring-primary-600"
          />
          <span className="text-sm font-medium text-zinc-900">อื่นๆ (พิมพ์เอง)</span>
        </label>
        {hook.kind === "other" && (
          <div className="space-y-2 rounded-md border border-zinc-200 bg-zinc-50 p-2.5">
            <ReasonField label="ข้อความ hook ที่ใช้จริง" value={otherText} onChange={setOtherText} max={500} rows={2} />
            <div className="space-y-1">
              <label htmlFor="other-type" className="block text-sm font-medium text-zinc-800">
                ประเภทของ hook นี้
              </label>
              <select id="other-type" value={otherType} onChange={(e) => setOtherType(e.target.value)} className={inputCls}>
                <option value="">เลือกประเภท</option>
                {HOOK_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {HOOK_TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
        <label className={optCls}>
          <input
            type="radio"
            name="post-hook"
            checked={hook.kind === "skip"}
            onChange={() => {
              setHook({ kind: "skip" });
              onDirty(true);
            }}
            className="mt-0.5 h-5 w-5 shrink-0 text-primary-600 focus:ring-primary-600"
          />
          <span className="text-sm font-medium text-zinc-900">ไม่ระบุ (ข้าม)</span>
        </label>
      </fieldset>

      <div className="space-y-1">
        <label htmlFor="posted-at" className="block text-sm font-medium text-zinc-800">
          วันและเวลาโพสต์ <span className="text-xs font-normal text-zinc-600">(เวลาไทย)</span>
        </label>
        <input
          id="posted-at"
          type="datetime-local"
          value={postedAt}
          onChange={(e) => {
            setPostedAt(e.target.value);
            setPostedAtTouched(true);
            onDirty(true);
          }}
          className={inputCls}
        />
        <p className="text-xs text-zinc-600">ค่าเริ่มต้นคือตอนนี้ — ถ้าโพสต์ไปก่อนหน้านี้ ให้แก้เป็นเวลาที่โพสต์จริง (ต้องไม่ก่อน 1 ม.ค. 2568)</p>
      </div>

      <p className="rounded-md bg-zinc-50 p-2.5 text-xs leading-relaxed text-zinc-700">
        กดบันทึกแล้วสถานะจะเป็น “โพสต์แล้ว” ในทุกหน้าทันที และเข้าคิวกรอกยอดตามรอบ
      </p>

      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-2.5 text-sm font-medium text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 break-words">{error}</span>
        </p>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
          ยกเลิก
        </Button>
        <Button type="submit" loading={busy} disabled={!canSubmit}>
          บันทึก · โพสต์แล้ว
        </Button>
      </div>
      {!canSubmit && !busy && (
        <p className="text-xs text-zinc-600">
          {platform === null
            ? "เลือกช่องทางก่อน"
            : url.trim().length === 0
              ? "วางลิงก์โพสต์ก่อน"
              : hook.kind === "none"
                ? "เลือก hook ที่ใช้จริง (หรือเลือก “ไม่ระบุ”) เพื่อกดบันทึก"
                : "กรอกข้อความและประเภทของ hook ที่พิมพ์เองให้ครบ"}
        </p>
      )}
    </form>
  );
}
