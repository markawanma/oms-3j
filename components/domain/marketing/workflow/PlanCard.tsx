// PlanCard — การ์ด "แผนและสมมติฐาน" ของหน้าชิ้นงาน (อ่านอย่างเดียว + ปุ่มแก้แผน)
// ตัวเลขฐาน/เกณฑ์แสดงดิบ ไม่ใส่ "%" (Q1a: ยังไม่ยืนยันหน่วย) · ห้ามเทียบเกณฑ์เองใน client
// ธง "เกณฑ์ผ่านแคบ" มาจาก threshold_too_narrow ของ DB · โฮสต์ที่คาด = public_label เท่านั้น

import { AlertTriangle } from "lucide-react";
import { PlanEditButton } from "@/components/domain/marketing/workflow/PlanEditButton";
import {
  CHANNEL_LABEL,
  CUSTOMER_GROUP_LABEL,
  FOOTAGE_STATUS_LABEL,
  LINE_AUDIENCE_LABEL,
  METRIC_CODE_LABEL,
  PASS_OP_LABEL,
  PIECE_KIND_LABEL,
  SHOOT_LOCATION_LABEL,
  TIME_SLOT_LABEL,
} from "@/lib/marketing/piece-labels";
import { formatThaiDay } from "@/lib/marketing/format";
import type { ContentTypeOption, HostOption, PieceRow } from "@/lib/marketing/piece-types";

function labelOf<T extends string>(map: Record<T, string>, v: string | null): string | null {
  if (!v) return null;
  return (map as Record<string, string>)[v] ?? null;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-x-3 py-1.5 text-sm sm:grid-cols-[9rem_1fr]">
      <dt className="text-zinc-600">{label}</dt>
      <dd className="min-w-0 break-words text-zinc-900">{children}</dd>
    </div>
  );
}

const NONE = <span className="text-zinc-600">ยังไม่ระบุ</span>;

export function PlanCard({
  piece,
  hosts,
  contentTypes,
  todayTh,
  hideEdit = false,
}: {
  piece: PieceRow;
  hosts: HostOption[];
  contentTypes: ContentTypeOption[];
  todayTh: string;
  hideEdit?: boolean;
}) {
  const metric = labelOf(METRIC_CODE_LABEL, piece.metricCode);
  const isNone = piece.metricCode === "none";
  const when = [
    piece.resolvedStart ? formatThaiDay(piece.resolvedStart, true) : null,
    labelOf(TIME_SLOT_LABEL, piece.timeSlot),
    piece.startTime ? `${piece.startTime} น.` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section aria-label="แผนและสมมติฐาน" className="rounded-lg border border-zinc-200 bg-white p-3.5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-zinc-900">แผนและสมมติฐาน</h2>
        {!hideEdit && <PlanEditButton piece={piece} hosts={hosts} contentTypes={contentTypes} todayTh={todayTh} />}
      </div>
      <dl className="mt-2 divide-y divide-zinc-100">
        <Row label="ชนิด / ช่องทาง">
          {labelOf(PIECE_KIND_LABEL, piece.pieceKind) ?? NONE} · {labelOf(CHANNEL_LABEL, piece.channel) ?? "ยังไม่ระบุช่องทาง"}
        </Row>
        <Row label="กลุ่มลูกค้า">{labelOf(CUSTOMER_GROUP_LABEL, piece.customerGroup) ?? NONE}</Row>
        <Row label="วัน / เวลา">{when || NONE}</Row>
        {piece.expectedHostLabel && <Row label="โฮสต์ที่คาด">{piece.expectedHostLabel}</Row>}

        <Row label="ตัวชี้วัด">{metric ?? NONE}</Row>
        {piece.metricCode && !isNone && (
          <>
            <Row label="สมมติฐาน">{piece.hypothesis ? <span className="whitespace-pre-wrap">{piece.hypothesis}</span> : NONE}</Row>
            <Row label="ค่าฐาน">
              {piece.baselineValue !== null ? (
                <span className="tabular-nums">
                  {piece.baselineValue}
                  {piece.baselineAsOf && <span className="text-zinc-600"> ณ {formatThaiDay(piece.baselineAsOf, true)}</span>}
                  {piece.baselineSpread !== null && <span className="text-zinc-600"> · ช่วงแกว่ง {piece.baselineSpread}</span>}
                </span>
              ) : (
                NONE
              )}
            </Row>
            <Row label="เกณฑ์ผ่าน">
              {piece.passThreshold !== null ? (
                <span className="tabular-nums">
                  {piece.passOp ? `${PASS_OP_LABEL[piece.passOp] ?? ""} ` : ""}
                  {piece.passThreshold}
                </span>
              ) : (
                NONE
              )}
            </Row>
          </>
        )}
        {isNone && <Row label="การวัดผล">ไม่วัดผล (evergreen)</Row>}

        <Row label="ถ่ายทำ">
          {piece.footageStatus ? (
            <>
              {labelOf(FOOTAGE_STATUS_LABEL, piece.footageStatus)}
              {piece.shootLocation && <span> · {labelOf(SHOOT_LOCATION_LABEL, piece.shootLocation)}</span>}
              {piece.shootMinutesEst !== null && <span className="tabular-nums"> · ประมาณ {piece.shootMinutesEst} นาที</span>}
              {piece.shootDate && <span> · วันถ่าย {formatThaiDay(piece.shootDate)}</span>}
            </>
          ) : (
            NONE
          )}
        </Row>
        {piece.footageUrl && <Row label="ลิงก์ไฟล์ภาพ">{piece.footageUrl}</Row>}
        {piece.shootNote && <Row label="หมายเหตุถ่ายทำ">{piece.shootNote}</Row>}
        {piece.pieceKind === "line_message" && (
          <Row label="ผู้รับ LINE">
            {labelOf(LINE_AUDIENCE_LABEL, piece.lineAudience) ?? NONE}
            {piece.lineAudienceReason && <span className="text-zinc-600"> · {piece.lineAudienceReason}</span>}
          </Row>
        )}
      </dl>
      {piece.thresholdTooNarrow && (
        <p className="mt-2 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          เกณฑ์ผ่านห่างจากค่าฐานน้อยกว่าช่วงแกว่ง — แยกผลจากความบังเอิญไม่ได้
        </p>
      )}
      {piece.metricCode === "peak_viewers" && (
        <p className="mt-2 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          คลิปเดียวพิสูจน์ยอดไลฟ์ทั้งคืนไม่ได้
        </p>
      )}
    </section>
  );
}
