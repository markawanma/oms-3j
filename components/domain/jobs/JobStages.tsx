"use client";

// JobStages — ตารางขั้นตอน (รับ/ส่ง/ช่าง/น้ำหนัก/หาย g และ %/ของเสีย) + ประวัติ event ของใบงาน
// ตัวเลขน้ำหนักหายมาจาก v_job_stage_loss (DB คำนวณ) — ที่นี่แสดงอย่างเดียว · ชั่งไม่ครบ = บอกชัด (ไม่ซ่อน)

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { StageFlagChips } from "@/components/domain/jobs/StageFlagChips";
import { thaiDate, thaiDateTime } from "@/lib/jobs/dates";
import { CHANNEL_LABEL, EVENT_TYPE_LABEL, SCRAP_REASON_LABEL, STAGE_STATUS_LABEL } from "@/lib/jobs/types";
import type { EventRow, StageLoss, StageRow } from "@/lib/jobs/types";

const g = (n: number | null) => (n === null ? "—" : `${n.toLocaleString("th-TH", { maximumFractionDigits: 3 })} g`);

function LossCell({ s, loss }: { s: StageRow; loss: StageLoss | undefined }) {
  if (s.status !== "sent") return <span className="text-zinc-600">—</span>;
  if (!loss || loss.notWeighed || loss.lossG === null) {
    // ขั้นที่ไม่บังคับชั่งไม่ได้ชั่ง = ปกติ ไม่ใช่ความผิดพลาด (เตือน "ชั่งไม่ครบ" เฉพาะขั้นที่บังคับชั่ง)
    return s.weighRequired ? <span className="font-medium text-amber-900">ชั่งไม่ครบ</span> : <span className="text-zinc-600">ไม่ได้ชั่ง (ไม่บังคับ)</span>;
  }
  return (
    <span className={`inline-flex items-center gap-1 tabular-nums ${loss.warn ? "font-bold text-red-800" : "text-zinc-900"}`}>
      {loss.warn && <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />}
      หาย {g(loss.lossG)}
      {loss.lossPct !== null ? ` (${loss.lossPct}%)` : ""}
    </span>
  );
}

export function StageTable({
  stages,
  loss,
  closed,
  firstOpenId,
  onReceive,
  onSend,
  onSkip,
  profiled = false,
  gold = false,
}: {
  /** 0176: ใบนี้มีแบบการบันทึก → ป้ายต่อขั้นตาม flag (ใบเดิมคงป้าย "ต้องชั่ง" เดิม) · gold = ใบทอง (ขั้นโลหะไม่ชั่งขึ้นป้ายแดง) */
  profiled?: boolean;
  gold?: boolean;
  stages: StageRow[];
  loss: Record<string, StageLoss>;
  closed: boolean;
  firstOpenId: string | null;
  onReceive: (s: StageRow) => void;
  onSend: (s: StageRow) => void;
  onSkip: (s: StageRow) => void;
}) {
  if (stages.length === 0) return <p className="text-sm text-zinc-700">ใบงานนี้ยังไม่มีขั้นตอน</p>;
  return (
    <ol className="space-y-2">
      {stages.map((s) => {
        const actionable = !closed && s.id === firstOpenId;
        return (
          <li key={s.id} className={`rounded-lg border bg-white p-3 ${actionable ? "border-primary-600 ring-1 ring-primary-600" : "border-zinc-200"}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-base font-semibold text-zinc-900">
                {s.seq}. {s.name}{" "}
                {profiled ? <StageFlagChips stage={s} gold={gold} /> : s.weighRequired && <span className="ml-1 rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-medium text-zinc-800">ต้องชั่ง</span>}
              </p>
              <span className="text-sm font-medium text-zinc-800">{STAGE_STATUS_LABEL[s.status] ?? s.status}</span>
            </div>
            {(s.status === "received" || s.status === "sent") && (
              <dl className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-0.5 text-sm text-zinc-800 sm:grid-cols-4">
                <div><dt className="text-xs text-zinc-600">ผู้ถือ</dt><dd>{s.holderName ?? "—"}</dd></div>
                <div><dt className="text-xs text-zinc-600">รับ / ส่ง</dt><dd>{thaiDate(s.receivedOn, false)} / {thaiDate(s.sentOn, false)}</dd></div>
                <div><dt className="text-xs text-zinc-600">น้ำหนักเข้า / ออก</dt><dd className="tabular-nums">{g(s.weightInG)} / {g(s.weightOutG)}</dd></div>
                <div><dt className="text-xs text-zinc-600">จำนวน เข้า / ออก / เสีย</dt><dd className="tabular-nums">{s.qtyIn ?? "—"} / {s.qtyOut ?? "—"} / {s.qtyScrap}</dd></div>
                {s.metalAddedG > 0 && <div><dt className="text-xs text-zinc-600">เติมโลหะ</dt><dd className="tabular-nums">{g(s.metalAddedG)}{s.weightNote ? ` · ${s.weightNote}` : ""}</dd></div>}
                {s.qtyScrap > 0 && <div><dt className="text-xs text-zinc-600">เหตุผลของเสีย</dt><dd>{SCRAP_REASON_LABEL[s.scrapReason ?? ""] ?? s.scrapReason ?? "—"}</dd></div>}
                <div><dt className="text-xs text-zinc-600">น้ำหนักหาย</dt><dd><LossCell s={s} loss={loss[s.id]} /></dd></div>
                {loss[s.id]?.handoffGapG != null && loss[s.id].handoffGapG !== 0 && (
                  <div>
                    <dt className="text-xs text-zinc-600">ส่วนต่างส่งมอบจากขั้นก่อน</dt>
                    <dd className="font-medium text-amber-900 tabular-nums">{loss[s.id].handoffGapG! > 0 ? "+" : "−"}{Math.abs(loss[s.id].handoffGapG!).toLocaleString("th-TH", { maximumFractionDigits: 3 })} g</dd>
                  </div>
                )}
              </dl>
            )}
            {s.autoClosed && <p className="mt-1 text-xs font-medium text-zinc-700">ขั้นนี้ถูกปิดให้อัตโนมัติ (คนส่งไม่ได้กดส่งต่อ) — น้ำหนักออกอาจว่าง</p>}
            {s.status === "skipped" && s.skipReason && <p className="mt-1 text-sm text-zinc-800">ข้ามเพราะ: {s.skipReason}</p>}
            {actionable && (
              <div className="mt-2 flex flex-wrap gap-2 print:hidden">
                {s.status === "pending" && (
                  <>
                    <Button type="button" onClick={() => onReceive(s)}>กรอกแทน: รับงาน</Button>
                    <Button type="button" variant="secondary" onClick={() => onSkip(s)}>ข้ามขั้นนี้</Button>
                  </>
                )}
                {s.status === "received" && <Button type="button" onClick={() => onSend(s)}>กรอกแทน: ส่งต่อ</Button>}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function JobEvents({ events, truncated, stageNames }: { events: EventRow[]; truncated: boolean; stageNames: Record<string, string> }) {
  return (
    <section aria-labelledby="events-h" className="space-y-2">
      <h2 id="events-h" className="text-lg font-bold text-zinc-900">
        ประวัติ
      </h2>
      {events.length === 0 ? (
        <p className="text-sm text-zinc-700">ยังไม่มีประวัติ</p>
      ) : (
        <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white">
          {events.map((e) => (
            <li key={e.id} className="px-3 py-2 text-sm">
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-semibold text-zinc-900">{EVENT_TYPE_LABEL[e.type] ?? e.type}</span>
                {e.stageCode && <span className="text-zinc-800">{stageNames[e.stageCode] ?? e.stageCode}</span>}
                {e.summary && <span className="text-zinc-800">· {e.summary}</span>}
              </p>
              <p className="text-xs text-zinc-700">
                วันที่ของงาน {thaiDate(e.occurredOn, false)} · บันทึก {thaiDateTime(e.recordedAt)} · {CHANNEL_LABEL[e.channel] ?? e.channel}
                {e.workerName ? ` · ${e.workerName}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
      {truncated && <p className="text-xs text-zinc-700">แสดง 150 รายการล่าสุด</p>}
    </section>
  );
}
