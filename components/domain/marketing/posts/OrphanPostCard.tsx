"use client";

// OrphanPostCard — โพสต์ที่วางลิงก์แล้วแต่ยังไม่ผูกชิ้นงาน + dialog "ผูกกับชิ้นงาน" (content_post_link_step)
// ตัวเลือกชิ้นที่ผูกไม่ได้ถูก disable พร้อมเหตุผล (ไม่ให้เลือกแล้วฟ้อง) · hook เลือกได้/ข้าม · DB ตัดสินจริงทุกด่าน แสดงข้อความไทยที่ได้กลับมา
// ลิงก์โพสต์เปิดแท็บใหม่ผ่าน safeHttpUrl (http/https เท่านั้น) · ไม่แสดงชื่อโฮสต์/URL ดิบบนจอ

import { useId, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useRunAction } from "@/components/domain/marketing/workflow/useRunAction";
import { linkOrphanPost } from "@/lib/actions/content-posts";
import { formatThaiDateTime, formatThaiDay } from "@/lib/marketing/format";
import { PLATFORM_LABEL } from "@/lib/marketing/content-types";
import { CHANNEL_LABEL, HOOK_TYPE_LABEL, PIECE_KIND_LABEL } from "@/lib/marketing/piece-labels";
import { sortLinkCandidates } from "@/lib/marketing/post-orphans";
import type { OrphanPost } from "@/lib/marketing/post-orphans";
import { safeHttpUrl } from "@/lib/marketing/safe-url";
import type { PieceRow } from "@/lib/marketing/piece-types";

const SELECT =
  "min-h-11 w-full rounded-md border border-zinc-300 bg-white px-2.5 text-base text-zinc-900 focus:border-primary-600 focus:outline-none focus:ring-1 focus:ring-primary-600";

function LinkDialog({ post, candidates, onClose }: { post: OrphanPost; candidates: PieceRow[]; onClose: () => void }) {
  const { run, busy, error } = useRunAction();
  const groupId = useId();
  const [stepId, setStepId] = useState("");
  const [hookId, setHookId] = useState("");
  const list = sortLinkCandidates(candidates, post);
  const chosen = list.find((c) => c.piece.stepId === stepId)?.piece;
  const hooks = chosen?.hooks.filter((h) => h.label !== null) ?? [];
  const anyOk = list.some((c) => c.choice.ok);

  async function submit() {
    if (!stepId) return;
    const res = await run(() => linkOrphanPost(post.postId, stepId, hookId || null), { success: "ผูกโพสต์กับชิ้นงานแล้ว" });
    if (res.ok) onClose();
  }

  return (
    <Modal open onClose={onClose} title="ผูกกับชิ้นงาน">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <p className="text-sm text-zinc-700">
          โพสต์ {(PLATFORM_LABEL as Record<string, string>)[post.platform] ?? post.platform} · {formatThaiDateTime(post.postedAt)} — เลือกชิ้นงานที่โพสต์นี้เป็นของ
        </p>

        {list.length === 0 ? (
          <p className="rounded-md bg-zinc-50 p-3 text-sm text-zinc-800">ยังไม่มีชิ้นงานที่อนุมัติแล้ว/ถ่ายแล้วให้ผูก</p>
        ) : (
          <fieldset className="space-y-2">
            <legend className="sr-only">เลือกชิ้นงาน</legend>
            {!anyOk && <p className="rounded-md bg-amber-50 p-2.5 text-sm text-amber-900">ตอนนี้ไม่มีชิ้นไหนผูกกับโพสต์นี้ได้ — ดูเหตุผลใต้แต่ละชิ้น</p>}
            <ul className="max-h-72 space-y-2 overflow-y-auto">
              {list.map(({ piece, choice }) => {
                const id = `${groupId}-${piece.stepId}`;
                return (
                  <li key={piece.stepId}>
                    <label
                      htmlFor={id}
                      className={`flex min-h-11 items-start gap-2.5 rounded-md border p-2.5 ${
                        choice.ok ? "cursor-pointer border-zinc-300 bg-white has-[:checked]:border-primary-600 has-[:checked]:bg-primary-50" : "border-zinc-200 bg-zinc-50 text-zinc-600"
                      }`}
                    >
                      <input
                        id={id}
                        type="radio"
                        name="step"
                        value={piece.stepId}
                        disabled={!choice.ok || busy}
                        checked={stepId === piece.stepId}
                        onChange={() => {
                          setStepId(piece.stepId);
                          setHookId("");
                        }}
                        aria-describedby={choice.ok ? undefined : `${id}-why`}
                        className="mt-1 h-5 w-5 shrink-0 accent-primary-600"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold break-words">{piece.title}</span>
                        <span className="block text-xs">
                          {[(PIECE_KIND_LABEL as Record<string, string>)[piece.pieceKind ?? ""], (CHANNEL_LABEL as Record<string, string>)[piece.channel ?? ""], piece.resolvedStart ? formatThaiDay(piece.resolvedStart) : null]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                        {!choice.ok && (
                          <span id={`${id}-why`} className="block text-xs font-medium text-amber-900">
                            ผูกไม่ได้: {choice.reason}
                          </span>
                        )}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        )}

        {chosen && hooks.length > 0 && (
          <div>
            <label htmlFor={`${groupId}-hook`} className="mb-1 block text-sm font-medium text-zinc-800">
              โพสต์นี้ใช้ hook ไหน (ไม่บังคับ)
            </label>
            <select id={`${groupId}-hook`} className={SELECT} value={hookId} onChange={(e) => setHookId(e.target.value)} disabled={busy}>
              <option value="">ข้าม — ไม่ระบุ</option>
              {hooks.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.label} · {h.hookType ? ((HOOK_TYPE_LABEL as Record<string, string>)[h.hookType] ?? h.hookType) : "ยังไม่ติดประเภท"} · {h.text.length > 60 ? `${h.text.slice(0, 60)}…` : h.text}
                </option>
              ))}
            </select>
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-2.5 text-sm font-medium text-red-800">
            {error}
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            ยกเลิก
          </Button>
          <Button type="submit" loading={busy} disabled={!stepId || busy}>
            ผูกโพสต์
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function OrphanPostCard({ post, candidates }: { post: OrphanPost; candidates: PieceRow[] }) {
  const [open, setOpen] = useState(false);
  const href = safeHttpUrl(post.postUrl);
  const platform = (PLATFORM_LABEL as Record<string, string>)[post.platform] ?? post.platform;
  return (
    <li className="rounded-lg border border-zinc-200 bg-white p-3.5">
      <p className="text-sm font-semibold text-zinc-900">
        {platform} · {formatThaiDateTime(post.postedAt)}
      </p>
      {post.caption && <p className="mt-1 line-clamp-3 text-sm break-words text-zinc-700">{post.caption}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
          >
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            เปิดโพสต์ใน {platform}
            <span className="sr-only"> (แท็บใหม่)</span>
          </a>
        ) : (
          <span className="inline-flex min-h-11 items-center text-sm text-zinc-700">ลิงก์โพสต์ไม่ถูกต้อง — เปิดไม่ได้</span>
        )}
        <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
          ผูกกับชิ้นงาน
        </Button>
      </div>
      {open && <LinkDialog post={post} candidates={candidates} onClose={() => setOpen(false)} />}
    </li>
  );
}

/** รายการโพสต์ค้างผูก — ส่ง candidates ครั้งเดียวทั้งรายการ (ไม่ serialize ซ้ำต่อใบ) */
export function OrphanPostList({ posts, candidates }: { posts: OrphanPost[]; candidates: PieceRow[] }) {
  return (
    <ul className="space-y-3">
      {posts.map((p) => (
        <OrphanPostCard key={p.postId} post={p} candidates={candidates} />
      ))}
    </ul>
  );
}
