"use client";

// JobLotsParts — ชิ้นส่วนแสดงผลของใบแม่ที่แยกส่วน (0181): แถบสีสะสมทั้งใบ + "รวม N ครบ" · การ์ดส่วน
// แสดงผลอย่างเดียว (ไม่มี action/ไม่เรียก DB) · ตัวเลขทุกตัวมาจาก lots.ts (DB) · ทุกแถบมีเลข/คำกำกับ ไม่พึ่งสีอย่างเดียว · สีตาม token map (ไม่เพิ่มสีนอกชุด)

import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { segmentsTotal } from "@/lib/jobs/lots";
import type { LotPart, LotSegment, SegmentTone } from "@/lib/jobs/lots";

export const SEGMENT_BAR: Record<SegmentTone, string> = {
  done: "bg-green-700 text-white",
  qc: "bg-amber-500 text-zinc-900",
  shop: "bg-zinc-400 text-zinc-900",
  scrap: "bg-red-700 text-white",
  pending: "bg-amber-200 text-zinc-900 ring-1 ring-inset ring-amber-500",
  resolved: "bg-zinc-600 text-white",
};

/**
 * แถบหลายส่วน + คำอธิบายใต้แถบ (เลข+คำ) + "รวม N ครบ" (ตาม sum_check ของ DB) — role="img" พร้อม aria-label อ่านครบทุกถัง
 * ความกว้างแต่ละช่วงเป็นแค่เรขาคณิตของการแสดงผล (เลขจริงอยู่ในคำอธิบาย)
 */
export function PartsStackBar({ segments, total, sumOk }: { segments: readonly LotSegment[]; total: number; sumOk: boolean }) {
  const shown = segmentsTotal(segments);
  const base = Math.max(total, shown, 1);
  const label = `รวม ${total} ชิ้น: ${segments.map((s) => `${s.label} ${s.qty}`).join(" · ")}`;
  return (
    <div className="space-y-2">
      <div role="img" aria-label={label} className="flex h-8 w-full overflow-hidden rounded-md bg-zinc-100">
        {segments.map((s) => (
          <span key={s.key} className={`flex min-w-6 items-center justify-center text-xs font-bold tabular-nums ${SEGMENT_BAR[s.tone]}`} style={{ width: `${(s.qty / base) * 100}%` }}>
            {s.qty}
          </span>
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-800" aria-label="ความหมายของแถบ">
        {segments.map((s) => (
          <li key={s.key} className="inline-flex items-center gap-1.5">
            <span className={`inline-block h-3 w-3 rounded-sm ${SEGMENT_BAR[s.tone].split(" ")[0]}`} aria-hidden="true" />
            {s.label} <strong className="tabular-nums">{s.qty}</strong>
          </li>
        ))}
      </ul>
      {sumOk ? (
        <p className="inline-flex items-center gap-1 text-sm font-semibold text-green-900">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          รวม {total} ครบ
        </p>
      ) : (
        <p role="alert" className="inline-flex items-center gap-1 text-sm font-semibold text-amber-900">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          ตัวเลขรวมไม่ครบ {total} ชิ้น — แจ้งผู้ดูแลระบบตรวจ
        </p>
      )}
    </div>
  );
}

/** "ส่วนหลัก" = ส่วนที่ยังไม่เคยแยก · "ส่วนที่ k" */
export const partTitle = (p: Pick<LotPart, "lotSeq">): string => (p.lotSeq === 0 ? "ส่วนหลัก" : `ส่วนที่ ${p.lotSeq}`);

const days = (d: number | null): string | null => (d === null || d < 0 ? null : d === 0 ? "วันนี้" : `${d} วัน`);

/** บรรทัดสถานะของส่วน: ขั้น · อยู่กับใคร · กี่วัน (ปิด/ยกเลิก = ข้อความสถานะ) */
export function partStatusText(p: LotPart): string {
  if (p.status === "cancelled") return "ยกเลิกแล้ว";
  if (p.status === "done") return "ปิดแล้ว";
  if (!p.stageName) return "ยังไม่มีขั้นที่ทำอยู่";
  const age = days(p.daysInStage);
  const where = p.stageStatus === "received" ? `ถืออยู่ที่ ${p.stageName}${p.holderName ? ` · ${p.holderName}` : ""}` : `รอรับที่ ${p.stageName}`;
  return age ? `${where} · ${age}` : where;
}

/** การ์ดส่วน (ส่วนที่ k · ขั้น · อยู่กับใคร · กี่วัน · จำนวนตัวใหญ่) — actions ส่งเข้ามาเป็น children (ปุ่ม/ลิงก์) */
export function PartCard({ part, children }: { part: LotPart; children?: ReactNode }) {
  const dim = part.status === "cancelled";
  const qty = part.status === "done" ? (part.qtyGood ?? part.qtyPlanned) : (part.qtyLive ?? part.qtyPlanned);
  return (
    <li id={`part-${part.jobId}`} className={`scroll-mt-24 rounded-lg border p-3 target:ring-2 target:ring-primary-600 ${dim ? "border-zinc-200 bg-zinc-50 text-zinc-600" : "border-zinc-200 bg-white"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={`text-base font-semibold ${dim ? "line-through" : "text-zinc-900"}`}>{partTitle(part)}</p>
          <p className="text-sm text-zinc-700">{partStatusText(part)}</p>
        </div>
        <strong className="shrink-0 text-2xl tabular-nums text-zinc-900" aria-label={`${qty} ชิ้น`}>
          {qty}
        </strong>
      </div>
      {children && <div className="mt-2 flex flex-wrap gap-2 print:hidden">{children}</div>}
    </li>
  );
}
