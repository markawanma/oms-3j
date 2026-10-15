"use client";

// PlanCard — การ์ด "จำนวนและแผน" บนหน้าใบงาน (0175): สั่ง · เริ่มผลิต [แก้] · น้ำหนักเป้าหมาย/ชิ้น · โลหะที่ต้องเตรียม [แก้แผน] · ของเหลือ
// 🔴 แสดงค่าที่ DB เก็บไว้ (job.* / metal_plan_basis) เท่านั้น — ห้ามคูณ/คำนวณใหม่ · สูตร "คำนวณ: …" ประกอบจาก basis ที่ DB บันทึกตอนสร้าง
// ปุ่มแก้ที่ใช้ไม่ได้ต้องมี "ข้อความ" อ่านได้ข้างปุ่ม (ไม่ใช่ tooltip อย่างเดียว) · DB เป็นด่านจริง (started / cast_started)
// state: ข้อมูลมากับหน้า (loading/error อยู่ที่ page) · empty = "ไม่ได้วางแผนโลหะ" + ปุ่มตั้งแผน · success = แสดงค่า

import { Button } from "@/components/ui/Button";
import { fmtG, TARGET_SOURCE_LABEL } from "@/components/domain/jobs/PlanFields";
import { SURPLUS_DONE_LABEL } from "@/components/domain/jobs/SurplusChoice";
import type { BoardRow, JobDetail, StageRow } from "@/lib/jobs/types";

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

interface Props {
  job: JobDetail;
  board: BoardRow | null;
  stages: readonly StageRow[];
  onEditQty: () => void;
  onEditPlan: () => void;
  onDecideSurplus: () => void;
}

export function PlanCard({ job, board, stages, onEditQty, onEditPlan, onDecideSurplus }: Props) {
  const closed = job.status === "done" || job.status === "cancelled";
  // เงื่อนไขเดียวกับ DB: แก้จำนวน = ยังไม่มีขั้นถูกรับ/ส่ง · แก้แผน = ขั้นหล่อยังไม่ถูกรับ/ส่ง
  const firstTaken = stages.some((s) => s.status === "received" || s.status === "sent");
  const castTaken = stages.some((s) => s.code === "cast" && (s.status === "received" || s.status === "sent"));
  const basis = job.metalPlanBasis;
  const hasTarget = job.targetPieceG !== null;
  const overrideG = num(basis?.override_g);
  const overrideWhy = typeof basis?.override_reason === "string" ? basis.override_reason : null;
  const sprue = num(basis?.sprue_loss_pct);
  const bQty = num(basis?.qty_planned);
  const bTarget = num(basis?.target_piece_g);
  const srcKey = typeof basis?.target_source === "string" ? basis.target_source : null;
  const planMissingRate = hasTarget && job.metalPlanG === null && overrideG === null;
  const surplus = board?.qtySurplus ?? null;
  const showSurplus = job.status === "done" && surplus !== null && surplus > 0;
  const pending = board?.surplusPending === true;

  return (
    <section aria-labelledby="plan-card-h" className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4">
      <h2 id="plan-card-h" className="text-lg font-bold text-zinc-900">
        จำนวนและแผน
      </h2>
      <dl className="space-y-3 text-sm">
        <div>
          <dt className="font-medium text-zinc-700">{job.sourceKind === "oem" ? "จำนวนที่สั่ง" : "จำนวนที่ต้องการเข้าสต็อก"}</dt>
          <dd className="text-base font-semibold text-zinc-900">{job.qtyOrder} ชิ้น</dd>
        </div>

        <div>
          <dt className="font-medium text-zinc-700">เริ่มผลิต</dt>
          <dd className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-base font-semibold text-zinc-900">{job.qtyPlanned} ชิ้น</span>
            {!closed &&
              (firstTaken ? (
                <span className="text-xs font-medium text-zinc-700">ขั้นแรกถูกรับแล้ว แก้ไม่ได้</span>
              ) : (
                <Button type="button" size="sm" variant="secondary" onClick={onEditQty}>
                  แก้จำนวน
                </Button>
              ))}
          </dd>
        </div>

        <div>
          <dt className="font-medium text-zinc-700">น้ำหนักเป้าหมาย/ชิ้น</dt>
          <dd className="text-base font-semibold text-zinc-900">
            {hasTarget ? (
              <>
                {fmtG(job.targetPieceG as number)} g{srcKey && TARGET_SOURCE_LABEL[srcKey] ? <span className="ml-2 text-xs font-medium text-zinc-700">ที่มา: {TARGET_SOURCE_LABEL[srcKey]}</span> : null}
              </>
            ) : (
              "—"
            )}
          </dd>
        </div>

        <div>
          <dt className="font-medium text-zinc-700">โลหะที่ต้องเตรียม</dt>
          <dd className="space-y-1">
            {job.metalPlanG !== null ? (
              <p className="text-base font-semibold text-zinc-900">{fmtG(job.metalPlanG)} g</p>
            ) : hasTarget ? (
              <p className="text-base font-semibold text-zinc-500">—</p>
            ) : (
              <p className="text-base text-zinc-800">ไม่ได้วางแผนโลหะ</p>
            )}
            {overrideG !== null ? (
              <p className="text-xs text-zinc-700">กำหนดเอง{overrideWhy ? `: ${overrideWhy}` : ""}</p>
            ) : job.metalPlanG !== null && bQty !== null && bTarget !== null && sprue !== null ? (
              <p className="text-xs text-zinc-700">
                คำนวณ: {bQty.toLocaleString("en-US")} ชิ้น × {fmtG(bTarget)} g × (1 + ก้านต้น {Number(sprue.toFixed(2))}%)
              </p>
            ) : null}
            {planMissingRate && <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs font-medium text-amber-900">ยังไม่มีอัตราก้านต้น — กด “แก้แผน” เพื่อกำหนดเอง หรือไปตั้งที่ จัดการต้นทุน</p>}
            {!closed &&
              (castTaken ? (
                <p className="text-xs font-medium text-zinc-700">ขั้นหล่อถูกรับแล้ว แก้แผนไม่ได้</p>
              ) : (
                <Button type="button" size="sm" variant="secondary" onClick={onEditPlan}>
                  {hasTarget ? "แก้แผน" : "ตั้งแผนโลหะ"}
                </Button>
              ))}
          </dd>
        </div>

        {showSurplus && (
          <div>
            <dt className="font-medium text-zinc-700">ของเหลือ</dt>
            <dd className="space-y-1">
              <p className={`rounded-md border p-2 text-sm font-medium ${pending ? "border-amber-300 bg-amber-50 text-amber-900" : "border-zinc-200 bg-zinc-50 text-zinc-800"}`}>
                ของเหลือ {surplus} ชิ้น — {pending ? "ถือไว้ยังไม่ตัดสิน" : (SURPLUS_DONE_LABEL[job.surplusDisposition ?? ""] ?? "ตัดสินแล้ว")}
                {job.surplusNote ? ` · ${job.surplusNote}` : ""}
              </p>
              {pending && job.sourceKind === "oem" && (
                <Button type="button" size="sm" variant="secondary" onClick={onDecideSurplus}>
                  ตัดสินของเหลือ
                </Button>
              )}
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}
