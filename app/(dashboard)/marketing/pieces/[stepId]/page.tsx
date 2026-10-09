import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, FileX, Lock } from "lucide-react";
import { getEffectiveRole } from "@/lib/auth/role";
import { getPieceDetail } from "@/lib/actions/content-pieces";
import { EmptyState } from "@/components/ui/EmptyState";
import { ContentTypeChip } from "@/components/domain/marketing/ContentTypeChip";
import { AuthorBadge, PieceStatusBadge } from "@/components/domain/marketing/workflow/badges";
import { CopyButton } from "@/components/domain/marketing/workflow/CopyButton";
import { ConfirmMarkerText } from "@/components/domain/marketing/workflow/ConfirmMarkerText";
import { HookPair } from "@/components/domain/marketing/workflow/HookPair";
import { MovedNotice } from "@/components/domain/marketing/workflow/MovedNotice";
import { PageError } from "@/components/domain/marketing/workflow/PageError";
import { PieceActionBar } from "@/components/domain/marketing/workflow/PieceActionBar";
import { PieceClientShell } from "@/components/domain/marketing/workflow/PieceClientShell";
import { PieceEditCard } from "@/components/domain/marketing/workflow/PieceEditCard";
import { PieceStatusStepper } from "@/components/domain/marketing/workflow/PieceStatusStepper";
import { PlanCard } from "@/components/domain/marketing/workflow/PlanCard";
import { ReviewPanel } from "@/components/domain/marketing/workflow/ReviewPanel";
import { StoryboardView } from "@/components/domain/marketing/workflow/StoryboardView";
import { PieceBanners, PieceHistory, PieceOrigin, PiecePosts } from "@/components/domain/marketing/workflow/PieceSections";
import { buildApprovalChecklist, countUndone } from "@/lib/marketing/approval-checklist";
import { formatThaiDay } from "@/lib/marketing/format";
import { isClipArtifactType } from "@/lib/marketing/clip-brief";
import { derivePieceBanners, restoreForcesReview } from "@/lib/marketing/piece-events";
import { buildFullCopy, readCaption } from "@/lib/marketing/piece-copy";
import {
  CHANNEL_LABEL,
  CUSTOMER_GROUP_LABEL,
  PIECE_KIND_LABEL,
  TIME_SLOT_LABEL,
  isContentLocked,
} from "@/lib/marketing/piece-labels";
import { effectiveDateBangkok } from "@/lib/tiktok/format";

export const dynamic = "force-dynamic";

/** `?from=` → ปุ่มย้อนกลับ (allowlist เท่านั้น — ไม่ใช้ค่าจาก URL เป็นปลายทางตรง ไม่เปิดช่อง open redirect) */
const BACK_LINKS: Record<string, { href: string; label: string }> = {
  inbox: { href: "/marketing", label: "งานที่รอฉัน" },
  calendar: { href: "/marketing/calendar", label: "ปฏิทิน" },
  questions: { href: "/marketing/questions", label: "คำถามจาก AI" },
};
const DEFAULT_BACK = BACK_LINKS.inbox;

function labelOf(map: Record<string, string>, v: string | null): string | null {
  return v ? (map[v] ?? null) : null;
}

export default async function PieceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ stepId: string }>;
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  if ((await getEffectiveRole()) === "staff") {
    return <EmptyState icon={Lock} title="หน้านี้จำกัดสิทธิ์" description="เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ดูชิ้นงานได้" />;
  }

  const { stepId } = await params;
  const sp = await searchParams;
  const fromRaw = Array.isArray(sp.from) ? sp.from[0] : sp.from;
  const fromLegacy = fromRaw === "legacy";
  const back = (fromRaw && BACK_LINKS[fromRaw]) || DEFAULT_BACK;

  let res;
  try {
    res = await getPieceDetail(stepId);
  } catch (err) {
    console.error("PieceDetailPage failed", { message: err instanceof Error ? err.message : "unknown" });
    return <PageError message="โหลดชิ้นงานไม่สำเร็จ ลองใหม่อีกครั้ง" />;
  }
  if (!res.ok) return <PageError message={res.error} />;

  if (res.data.kind === "legacy") {
    // step ที่อยู่นอก workflow ใหม่ → หน้าเดิม (ไม่ลูป: หน้าเดิมจะ redirect กลับมาเฉพาะ step ที่ piece_status ไม่ null)
    redirect(`/marketing/calendar/${stepId}`);
  }
  if (res.data.kind === "missing") {
    return (
      <EmptyState
        icon={FileX}
        title="ไม่พบชิ้นงานนี้"
        description="อาจถูกลบไปแล้ว หรือลิงก์ไม่ถูกต้อง"
        action={
          <Link href={back.href} className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-primary-600 px-4 text-sm font-semibold text-white hover:bg-primary-700">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            กลับ{back.label}
          </Link>
        }
      />
    );
  }

  const { piece, events, confirmItems, sourceSignal, hookStats, hosts, contentTypes } = res.data.detail;
  const todayTh = effectiveDateBangkok(new Date().toISOString());
  const contentType = piece.contentTypeCode ? contentTypes.find((c) => c.code === piece.contentTypeCode) : undefined;
  const banners = derivePieceBanners(piece, events);
  const isClip = piece.pieceKind === "short_clip" || piece.pieceKind === "live_cut" || (piece.artifactType !== null && isClipArtifactType(piece.artifactType));
  const showHooks = piece.pieceKind === "short_clip" || piece.pieceKind === "live_cut";
  const editable = !isContentLocked(piece.pieceStatus);
  const caption = readCaption(piece.contentBody);
  const copyAll = buildFullCopy({ isClip, clipBrief: piece.clipBrief, contentBody: piece.contentBody });
  const undone = piece.pieceStatus === "in_review" && !piece.canApprove ? countUndone(buildApprovalChecklist(piece)) : 0;

  const when = [
    piece.resolvedStart ? formatThaiDay(piece.resolvedStart) : null,
    labelOf(TIME_SLOT_LABEL, piece.timeSlot),
    piece.startTime ? `${piece.startTime} น.` : null,
  ]
    .filter(Boolean)
    .join(" ");
  const meta = [
    labelOf(PIECE_KIND_LABEL, piece.pieceKind),
    labelOf(CHANNEL_LABEL, piece.channel),
    when || null,
    labelOf(CUSTOMER_GROUP_LABEL, piece.customerGroup),
    piece.campaignType && piece.campaignType !== "content_task" ? piece.campaignName : null,
  ].filter(Boolean);

  return (
    <PieceClientShell>
      <div className="space-y-4">
        <Link href={back.href} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-zinc-700 hover:text-zinc-900">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          กลับ{back.label}
        </Link>

        {fromLegacy && <MovedNotice />}

        {undone > 0 && (
          <div role="status" className="sticky top-16 z-10 -mx-4 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900 md:top-[calc(4rem+3.5rem)]">
            เหลือ {undone} อย่างก่อนอนุมัติ
          </div>
        )}

        <header className="space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {contentType && <ContentTypeChip contentType={contentType} />}
            <PieceStatusBadge status={piece.effectiveStatus} />
            {piece.draftedByAi && <AuthorBadge kind="ai" />}
            {piece.humanEdited && <AuthorBadge kind="human" />}
          </div>
          <h1 className="break-words text-xl font-bold text-zinc-900">{piece.title}</h1>
          {meta.length > 0 && <p className="break-words text-sm text-zinc-700">{meta.join(" · ")}</p>}
        </header>

        <PieceBanners banners={banners} />

        <PieceStatusStepper rawStatus={piece.pieceStatus} effectiveStatus={piece.effectiveStatus} pieceKind={piece.pieceKind} />

        <PieceOrigin signal={sourceSignal} hypothesis={piece.hypothesis} />

        {showHooks && (
          <section aria-label="Hook 2 แบบ" className="space-y-2">
            <h2 className="text-base font-semibold text-zinc-900">Hook 2 แบบ</h2>
            <HookPair hooks={piece.hooks} hookStats={hookStats} />
            <p className="text-xs text-zinc-600">เลือกตัวที่ใช้จริงตอนกด “โพสต์แล้ว”</p>
          </section>
        )}

        {/* [ช่องว่างสงวนไว้: แม่แบบคลิป] — ตั้งใจเว้นตำแหน่งนี้ไว้ ไม่มี DOM (brief 0.14: ห้ามทำเป็นปุ่มที่ไม่ทำงาน) */}

        <section aria-label={isClip ? "Storyboard" : "เนื้อหา"} className="space-y-3 rounded-lg border border-zinc-200 bg-white p-3.5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-zinc-900">{isClip ? "Storyboard" : "เนื้อหา"}</h2>
            <CopyButton text={copyAll} label="คัดลอกทั้งก้อน" />
          </div>
          {isClip ? (
            <StoryboardView stepId={piece.stepId} artifactId={piece.artifactId} clipBrief={piece.clipBrief} />
          ) : caption ? (
            <p className="text-sm leading-relaxed text-zinc-900">
              <ConfirmMarkerText text={piece.contentBody} />
            </p>
          ) : (
            <p className="text-sm text-zinc-600">ยังไม่มีเนื้อหา — รอ AI ร่าง</p>
          )}
        </section>

        {isClip && (
          <section aria-label="แคปชัน" className="space-y-2 rounded-lg border border-zinc-200 bg-white p-3.5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-zinc-900">แคปชัน</h2>
              <CopyButton text={caption ?? ""} label="คัดลอกแคปชัน" />
            </div>
            {caption ? (
              <p className="text-sm leading-relaxed text-zinc-900">
                <ConfirmMarkerText text={caption} />
              </p>
            ) : (
              <p className="text-sm text-zinc-600">ยังไม่มีแคปชัน</p>
            )}
          </section>
        )}

        {editable ? (
          <PieceEditCard piece={piece} />
        ) : (
          (piece.pieceStatus === "approved" || piece.pieceStatus === "produced" || piece.pieceStatus === "posted") && (
            <p className="rounded-md bg-zinc-50 p-3 text-sm text-zinc-700">
              ล็อกหลังอนุมัติ — เนื้อหาและ hook แก้ไม่ได้ (ติ๊กช็อต วัน และข้อมูลถ่ายทำยังแก้ได้) · ถ้าต้องแก้เนื้อหา ใช้เมนู “⋯ → ถอนอนุมัติ…” ก่อน
            </p>
          )
        )}

        <PlanCard piece={piece} hosts={hosts} contentTypes={contentTypes} todayTh={todayTh} hideEdit={piece.pieceStatus === "idea"} />

        <ReviewPanel piece={piece} confirmItems={confirmItems} />

        <PiecePosts piece={piece} />

        <PieceHistory events={events} />

        <PieceActionBar piece={piece} hosts={hosts} contentTypes={contentTypes} todayTh={todayTh} restoreForcesReview={restoreForcesReview(events)} />
      </div>
    </PieceClientShell>
  );
}
