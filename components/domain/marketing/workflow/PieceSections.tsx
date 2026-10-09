// PieceSections — ส่วนอ่านอย่างเดียวของหน้าชิ้นงาน (server-safe): แถบแจ้ง · ที่มา · ผลลัพธ์/โพสต์ · ประวัติ
// - ข้อความเหตุผล/คำถามเป็น text node ของ React (escape ให้เอง) · ไม่มี dangerouslySetInnerHTML (F12)
// - ลิงก์โพสต์ภายนอก: rel="noopener noreferrer" target=_blank · ไม่ fetch ปลายทาง
// - ไม่มีโฮสต์ต่อโพสต์ (มติ Q11: ไม่ผูกโฮสต์กับผลโพสต์)

import Link from "next/link";
import { AlertTriangle, ExternalLink, Info, Link2Off } from "lucide-react";
import { formatThaiDateTime } from "@/lib/marketing/format";
import { safeHttpUrl } from "@/lib/marketing/safe-url";
import { actorRoleLabel, eventKindLabel, pieceKindHasPostUrl, pieceStatusLabel, PLATFORM_POST_LABEL, signalKindLabel } from "@/lib/marketing/piece-labels";
import { lastApprovalReviewSeconds } from "@/lib/marketing/piece-events";
import type { PieceBanner } from "@/lib/marketing/piece-events";
import type { PieceEvent, PieceRow, SignalOrigin } from "@/lib/marketing/piece-types";

const BANNER_TONE: Record<PieceBanner["tone"], string> = {
  red: "border-red-200 bg-red-50 text-red-900",
  amber: "border-amber-200 bg-amber-50 text-amber-900",
  orange: "border-orange-200 bg-orange-50 text-orange-900",
};

export function PieceBanners({ banners }: { banners: PieceBanner[] }) {
  if (banners.length === 0) return null;
  return (
    <div className="space-y-2">
      {banners.map((b) => (
        <div key={b.key} role="status" className={`flex items-start gap-2 rounded-md border p-3 text-sm ${BANNER_TONE[b.tone]}`}>
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-semibold">{b.title}</p>
            {b.detail && <p className="mt-0.5 whitespace-pre-wrap break-words">{b.detail}</p>}
            {b.at && <p className="mt-0.5 text-xs opacity-80">เมื่อ {formatThaiDateTime(b.at)}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

/** ที่มา: สัญญาณต้นทาง (1 อัน) › สมมติฐาน — ชิ้นที่ไม่มีสัญญาณต้นทางซ่อนทั้งส่วน (B12) */
export function PieceOrigin({ signal, hypothesis }: { signal: SignalOrigin | null; hypothesis: string | null }) {
  if (!signal) return null;
  return (
    <section aria-label="ที่มา" className="rounded-lg border border-zinc-200 bg-white p-3.5">
      <h2 className="text-base font-semibold text-zinc-900">ที่มา</h2>
      <ol className="mt-2 space-y-2 text-sm">
        <li className="rounded-md bg-zinc-50 p-2.5">
          <p className="text-xs font-medium text-zinc-600">
            สัญญาณต้นทาง · {signalKindLabel(signal.kind)}
            {signal.seenOn && <span> · เจอเมื่อ {signal.seenOn}</span>}
          </p>
          <p className="mt-0.5 line-clamp-3 break-words text-zinc-900">{signal.summary || "(ไม่มีสรุป)"}</p>
        </li>
        {hypothesis && (
          <li>
            <details className="rounded-md bg-zinc-50 p-2.5">
              <summary className="flex min-h-9 cursor-pointer items-center text-sm font-medium text-zinc-800">สมมติฐาน</summary>
              <p className="mt-1 whitespace-pre-wrap break-words text-zinc-800">{hypothesis}</p>
            </details>
          </li>
        )}
      </ol>
    </section>
  );
}

/** ผลลัพธ์ (posted ขึ้นไป) — P1a: รายการโพสต์ + ลิงก์ไปกรอกยอด · P3 จะเพิ่มยอด/ป้ายผล */
export function PiecePosts({ piece }: { piece: PieceRow }) {
  const reached = ["posted", "measuring", "measured", "missed_measure"].includes(piece.effectiveStatus);
  if (!reached && piece.posts.length === 0) return null;
  const hasUrl = pieceKindHasPostUrl(piece.pieceKind);

  return (
    <section aria-label="ผลลัพธ์" className="rounded-lg border border-zinc-200 bg-white p-3.5">
      <h2 className="text-base font-semibold text-zinc-900">โพสต์และผลลัพธ์</h2>
      {!hasUrl ? (
        <p className="mt-1 flex items-start gap-2 text-sm text-zinc-700">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          ชิ้นนี้ไม่มีการวัดผลรายชิ้น{piece.postedOn ? ` · ส่งเมื่อ ${piece.postedOn}` : ""}
        </p>
      ) : piece.posts.length === 0 ? (
        <p className="mt-1 flex items-start gap-2 text-sm text-zinc-700">
          <Link2Off className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          ยังไม่มีลิงก์โพสต์
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-zinc-100">
          {piece.posts.map((p) => {
            const safe = safeHttpUrl(p.postUrl);
            return (
            <li key={p.postId} className="py-2 text-sm">
              <p className="font-medium text-zinc-900">
                {PLATFORM_POST_LABEL[p.platform] ?? "โพสต์"}
                {p.status !== "active" && <span className="ml-1 text-xs font-normal text-zinc-600">(ไม่ได้ใช้งานแล้ว)</span>}
              </p>
              {safe ? (
                <a
                  href={safe}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 max-w-full items-center gap-1 break-all text-primary-700 underline underline-offset-2"
                >
                  <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="min-w-0">เปิดโพสต์</span>
                  <span className="sr-only"> ({p.postUrl})</span>
                </a>
              ) : (
                <p className="break-all text-sm text-zinc-700">{p.postUrl} (ลิงก์ไม่ปลอดภัย — ไม่เปิดให้กด)</p>
              )}
              <p className="text-xs text-zinc-600">โพสต์เมื่อ {formatThaiDateTime(p.postedAt)}</p>
            </li>
            );
          })}
        </ul>
      )}
      {hasUrl && piece.posts.some((p) => p.status === "active") && (
        <Link
          href="/marketing/content/entry"
          className="mt-1 inline-flex min-h-11 items-center text-sm font-medium text-primary-700 underline underline-offset-2"
        >
          ไปกรอกยอดโพสต์
        </Link>
      )}
    </section>
  );
}

function eventLine(e: PieceEvent): string {
  const move =
    e.fromStatus && e.toStatus && e.fromStatus !== e.toStatus
      ? ` · ${pieceStatusLabel(e.fromStatus)} → ${pieceStatusLabel(e.toStatus)}`
      : "";
  return `${eventKindLabel(e.eventKind)}${move}`;
}

/** ประวัติ (พับ) — เหตุผลส่งกลับ/ยกเลิก/พัก/ล้างด่านเป็นข้อมูล ไม่ใช่ขยะ · event เรียงล่าสุดก่อน (seq มาก→น้อย) */
export function PieceHistory({ events }: { events: PieceEvent[] }) {
  if (events.length === 0) return null;
  const review = lastApprovalReviewSeconds(events);
  return (
    <section aria-label="ประวัติ" className="rounded-lg border border-zinc-200 bg-white p-3.5">
      <details>
        <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2 text-base font-semibold text-zinc-900">
          <span>ประวัติ ({events.length})</span>
        </summary>
        {review !== null && (
          <p className="text-xs text-zinc-600 tabular-nums">
            อนุมัติครั้งล่าสุดใช้เวลาอ่าน {Math.floor(review / 60)} นาที {review % 60} วินาที
          </p>
        )}
        <ol className="mt-2 space-y-2">
          {events.map((e) => (
            <li key={e.id} className="rounded-md bg-zinc-50 p-2.5 text-sm">
              <p className="text-zinc-900">
                <span className="font-medium">{eventLine(e)}</span>
                <span className="text-zinc-600"> · {actorRoleLabel(e.actorRole)}</span>
              </p>
              <p className="text-xs text-zinc-600">{formatThaiDateTime(e.createdAt)}</p>
              {e.reason && <p className="mt-0.5 whitespace-pre-wrap break-words text-zinc-800">เหตุผล: {e.reason}</p>}
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}
