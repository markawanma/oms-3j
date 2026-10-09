// HookPair — การ์ด hook A/B (แหล่งข้อมูล = content_hook ผ่าน v_content_piece.hooks เท่านั้น ห้ามอ่าน clip_brief.hooks)
// สถิติประเภท = ข้อความ verdict_detail ของ v_content_piece rollup ตรงๆ (ตัวหาร n/4 มาจาก DB) · ไม่มีแถว = "ยังไม่มีผล"
// ห้ามคำว่า ดี/ชนะ (B6) · hook ที่ยังไม่ติดประเภท (ค่าดิบเก่านอก 8 ประเภท) แสดง "ยังไม่ระบุประเภท" ไม่แสดงค่าดิบ

import { ConfirmMarkerText } from "@/components/domain/marketing/workflow/ConfirmMarkerText";
import { hookTypeLabel } from "@/lib/marketing/piece-labels";
import type { PieceHook } from "@/lib/marketing/piece-types";

export function HookPair({
  hooks,
  hookStats,
  derivedFromLabel,
}: {
  hooks: PieceHook[];
  hookStats: Record<string, string>;
  /** ป้ายคลิปอ้างอิงที่ hook ถอดโครงมา (P4 จะเป็นลิงก์) */
  derivedFromLabel?: (hook: PieceHook) => string | null;
}) {
  const labeled = hooks.filter((h) => h.label === "A" || h.label === "B");
  if (labeled.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-zinc-300 bg-white p-3 text-sm text-zinc-600">
        ยังไม่มี hook ของชิ้นนี้ — AI ยังไม่ได้ร่าง hook A/B
      </p>
    );
  }
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {labeled.map((h) => {
        const stat = h.hookType ? (hookStats[h.hookType] ?? "ยังไม่มีผล") : null;
        const from = derivedFromLabel?.(h) ?? null;
        return (
          <li key={h.id} className="min-w-0 rounded-md border border-zinc-200 bg-white p-2.5">
            <p className="text-xs font-semibold text-zinc-700">
              {h.label} · <span className="font-medium">{hookTypeLabel(h.hookType)}</span>
            </p>
            <p className="mt-1 break-words text-sm leading-relaxed text-zinc-900">
              <ConfirmMarkerText text={h.text} />
            </p>
            {from && <p className="mt-1 text-xs text-zinc-600">ถอดโครงจาก {from}</p>}
            {stat && <p className="mt-1.5 text-xs text-zinc-600">ผลของประเภทนี้: {stat}</p>}
          </li>
        );
      })}
    </ul>
  );
}
