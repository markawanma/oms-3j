"use client";

// PlanForm — แก้แผน/สมมติฐาน/ถ่ายทำของชิ้นงาน (content_piece_set_plan) บน Modal เดิม
// - ส่งเฉพาะ key ที่เปลี่ยน (diffPlanValues) · ล้างค่า = null · ตัวเลข 0 เป็นค่าจริง
// - ช่องที่แก้ไม่ได้ตามสถานะ (editablePlanKeys — ตรง DB) ไม่แสดงเป็น input
// - ตัวเลขใช้ inputMode="decimal" · ช่องทางตัดตัวเลือกที่ไม่เข้าคู่กับชนิด (ไม่ใช่ให้เลือกแล้วฟ้อง)
// - Q1a: เลือกตัวชี้วัด save_rate/share_rate ใหม่ผ่านจอนี้ไม่ได้ (ยังไม่รู้หน่วยฐาน/เกณฑ์) · ไม่ใส่ "%" ที่ตัวเลขใดๆ
// - เตือนเกณฑ์แคบ = ธง threshold_too_narrow จาก DB ของแถวที่โหลด (หลังบันทึกจึงอัปเดต — ไม่คำนวณสดตอนพิมพ์)
// - กลุ่มลูกค้าเป้าหมายของ LINE "เฉพาะกลุ่ม" ตั้งจากจอนี้ไม่ได้ (set_plan ไม่เปิด key) → ข้อความชี้ไปหน้ากลุ่มลูกค้าเดิม

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { advancePiece, setPlan } from "@/lib/actions/content-pieces";
import {
  CHANNEL_LABEL,
  CUSTOMER_GROUPS,
  CUSTOMER_GROUP_LABEL,
  FOOTAGE_STATUSES,
  FOOTAGE_STATUS_LABEL,
  METRIC_CODES,
  METRIC_CODE_LABEL,
  PIECE_KINDS,
  PIECE_KIND_LABEL,
  SHOOT_LOCATIONS,
  SHOOT_LOCATION_LABEL,
  TIME_SLOTS,
  TIME_SLOT_LABEL,
} from "@/lib/marketing/piece-labels";
import type { Channel } from "@/lib/marketing/piece-labels";
import {
  channelsForKind,
  diffPlanValues,
  editablePlanKeys,
  isMetricSelectable,
  metricNeedsHypothesis,
  valuesFromPiece,
} from "@/lib/marketing/plan-form";
import type { PlanFormValues } from "@/lib/marketing/plan-form";
import type { ContentTypeOption, HostOption, PieceRow } from "@/lib/marketing/piece-types";

const INPUT =
  "min-h-11 w-full rounded-md border border-zinc-300 bg-white px-2.5 text-base text-zinc-900 focus:border-primary-600 focus:outline-none focus:ring-1 focus:ring-primary-600 disabled:bg-zinc-100";

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string | null; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium text-zinc-800">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-zinc-600">{hint}</p>}
      {error && (
        <p role="alert" className="text-xs font-medium text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-3 rounded-lg border border-zinc-200 p-3">
      <legend className="px-1 text-sm font-semibold text-zinc-900">{title}</legend>
      {children}
    </fieldset>
  );
}

function PlanFormBody({
  piece,
  hosts,
  contentTypes,
  todayTh,
  advanceToPlanned,
  onClose,
  onDirty,
}: {
  piece: PieceRow;
  hosts: HostOption[];
  contentTypes: ContentTypeOption[];
  todayTh: string;
  advanceToPlanned: boolean;
  onClose: () => void;
  onDirty: (d: boolean) => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const editable = useMemo(() => editablePlanKeys(piece.pieceStatus), [piece.pieceStatus]);
  const orig = useMemo(() => valuesFromPiece(piece), [piece]);
  const [v, setV] = useState<PlanFormValues>(orig);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof PlanFormValues, string>>>({});
  const firstRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    const t = setTimeout(() => firstRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, []);

  function upd<K extends keyof PlanFormValues>(key: K, value: PlanFormValues[K]) {
    setV((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((e) => ({ ...e, [key]: undefined }));
    onDirty(true);
  }

  const can = (key: string) => editable.has(key);
  const channels = channelsForKind(v.pieceKind);
  const needsHypo = metricNeedsHypothesis(v.metricCode);
  const rateMetric = v.metricCode === "save_rate" || v.metricCode === "share_rate";

  const isLine = v.pieceKind === "line_message";

  async function submit() {
    const diff = diffPlanValues(orig, v, editable);
    if (!diff.ok) {
      setFieldErrors({ [diff.field]: diff.error });
      return;
    }
    const hasChanges = Object.keys(diff.set).length > 0;
    if (!hasChanges && !advanceToPlanned) {
      setError("ไม่มีค่าที่เปลี่ยน");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (hasChanges) {
        const res = await setPlan(piece.stepId, diff.set);
        if (!res.ok) {
          setError(res.error);
          if (res.stale) router.refresh();
          return;
        }
      }
      if (advanceToPlanned) {
        // วางแผน = บันทึกแผน แล้วส่ง planned (DB ตรวจว่าแผนครบไหม — ข้อความที่ขาดแสดงตรงนี้ ค่าที่บันทึกแล้วไม่หาย)
        const adv = await advancePiece(piece.stepId, "planned");
        if (!adv.ok) {
          setError(adv.error);
          router.refresh();
          return;
        }
      }
      onDirty(false);
      toast.push(advanceToPlanned ? "วางแผนแล้ว" : "บันทึกแผนแล้ว");
      onClose();
      router.refresh();
    } catch {
      setError("บันทึกแผนไม่สำเร็จ ลองใหม่อีกครั้ง");
    } finally {
      setBusy(false);
    }
  }

  const readOnlyNote =
    piece.pieceStatus === "approved" || piece.pieceStatus === "produced"
      ? "อนุมัติแล้ว — แก้ได้เฉพาะเวลา โฮสต์ และข้อมูลถ่ายทำ (ส่วนอื่นต้องส่งกลับก่อน)"
      : piece.pieceStatus === "posted" || piece.pieceStatus === "cancelled"
        ? "แก้ได้เฉพาะลิงก์ไฟล์และหมายเหตุถ่ายทำ"
        : null;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="space-y-4"
    >
      {readOnlyNote && <p className="rounded-md bg-zinc-50 p-2.5 text-sm text-zinc-700">{readOnlyNote}</p>}

      {(can("piece_kind") || can("channel") || can("customer_group") || can("date") || can("start_time") || can("time_slot") || can("content_type_code")) && (
        <Group title="พื้นฐาน">
          {can("piece_kind") && (
            <Field id="pf-kind" label="ชนิดชิ้นงาน">
              <select
                id="pf-kind"
                ref={firstRef}
                value={v.pieceKind}
                onChange={(e) => {
                  const kind = e.target.value;
                  setV((prev) => ({ ...prev, pieceKind: kind, channel: channelsForKind(kind).includes(prev.channel) ? prev.channel : "" }));
                  onDirty(true);
                }}
                className={INPUT}
              >
                <option value="">ยังไม่เลือก</option>
                {PIECE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {PIECE_KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {can("channel") && (
            <Field id="pf-channel" label="ช่องทาง" hint={v.pieceKind ? undefined : "เลือกชนิดชิ้นงานก่อน"}>
              <select id="pf-channel" value={v.channel} onChange={(e) => upd("channel", e.target.value)} disabled={channels.length === 0} className={INPUT}>
                <option value="">ยังไม่เลือก</option>
                {channels.map((c) => (
                  <option key={c} value={c}>
                    {CHANNEL_LABEL[c as Channel]}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {can("customer_group") && (
            <fieldset className="space-y-1">
              <legend className="text-sm font-medium text-zinc-800">กลุ่มลูกค้า (เลือกอย่างใดอย่างหนึ่ง)</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {CUSTOMER_GROUPS.map((g) => (
                  <label
                    key={g}
                    className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-zinc-300 bg-white px-2.5 has-[:checked]:border-primary-600 has-[:checked]:ring-1 has-[:checked]:ring-primary-600"
                  >
                    <input
                      type="radio"
                      name="pf-group"
                      checked={v.customerGroup === g}
                      onChange={() => upd("customerGroup", g)}
                      className="h-5 w-5 text-primary-600 focus:ring-primary-600"
                    />
                    <span className="text-sm font-medium">{CUSTOMER_GROUP_LABEL[g]}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {can("date") && (
            <Field id="pf-date" label="วันที่" hint="หลังวางแผนแล้ว เปลี่ยนวันด้วยปุ่ม “เลื่อน” (ต้องบอกเหตุผล)" error={fieldErrors.date}>
              <input id="pf-date" type="date" min={todayTh} value={v.date} onChange={(e) => upd("date", e.target.value)} className={INPUT} />
            </Field>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {can("time_slot") && (
              <Field id="pf-slot" label="ช่วงเวลา">
                <select id="pf-slot" value={v.timeSlot} onChange={(e) => upd("timeSlot", e.target.value)} className={INPUT}>
                  <option value="">ไม่ระบุ</option>
                  {TIME_SLOTS.map((t) => (
                    <option key={t} value={t}>
                      {TIME_SLOT_LABEL[t]}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {can("start_time") && (
              <Field id="pf-time" label="เวลา (ไม่บังคับ)">
                <input id="pf-time" type="time" value={v.startTime} onChange={(e) => upd("startTime", e.target.value)} className={INPUT} />
              </Field>
            )}
          </div>
          {can("content_type_code") && contentTypes.length > 0 && (
            <Field id="pf-ctype" label="ประเภทเนื้อหา">
              <select id="pf-ctype" value={v.contentTypeCode} onChange={(e) => upd("contentTypeCode", e.target.value)} className={INPUT}>
                <option value="">ยังไม่ระบุ</option>
                {contentTypes.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.labelTh}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {can("expected_host_id") && hosts.length > 0 && (
            <Field id="pf-host" label="โฮสต์ที่คาด (ไม่บังคับ)">
              <select id="pf-host" value={v.expectedHostId} onChange={(e) => upd("expectedHostId", e.target.value)} className={INPUT}>
                <option value="">ไม่ระบุ</option>
                {hosts.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.publicLabel}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </Group>
      )}

      {!(can("piece_kind") || can("channel")) && can("expected_host_id") && hosts.length > 0 && (
        <Group title="โฮสต์">
          <Field id="pf-host2" label="โฮสต์ที่คาด (ไม่บังคับ)">
            <select id="pf-host2" value={v.expectedHostId} onChange={(e) => upd("expectedHostId", e.target.value)} className={INPUT}>
              <option value="">ไม่ระบุ</option>
              {hosts.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.publicLabel}
                </option>
              ))}
            </select>
          </Field>
        </Group>
      )}

      {can("metric_code") && (
        <Group title="ทดสอบสมมติฐาน">
          <Field id="pf-metric" label="ตัวชี้วัด">
            <select id="pf-metric" value={v.metricCode} onChange={(e) => upd("metricCode", e.target.value)} className={INPUT}>
              <option value="">ยังไม่เลือก</option>
              {METRIC_CODES.map((m) => (
                <option key={m} value={m} disabled={!isMetricSelectable(m, v.metricCode)}>
                  {METRIC_CODE_LABEL[m]}
                  {!isMetricSelectable(m, v.metricCode) ? " (ยังตั้งผ่านจอนี้ไม่ได้)" : ""}
                </option>
              ))}
            </select>
          </Field>
          {v.metricCode === "peak_viewers" && (
            <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              คลิปเดียวพิสูจน์ยอดไลฟ์ทั้งคืนไม่ได้
            </p>
          )}
          {piece.thresholdTooNarrow && (
            <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              เกณฑ์ผ่านห่างจากค่าฐานน้อยกว่าช่วงแกว่ง — แยกผลจากความบังเอิญไม่ได้ (ระบบตรวจจากค่าที่บันทึกไว้ล่าสุด)
            </p>
          )}
          {needsHypo && (
            <>
              {rateMetric && (
                <p className="rounded-md bg-zinc-50 p-2.5 text-sm text-zinc-700">
                  ตัวชี้วัดนี้ยังไม่ยืนยันหน่วยของค่าฐาน/เกณฑ์ (เศษส่วนหรือเปอร์เซ็นต์) จึงแสดงเป็นตัวเลขดิบ ไม่ใส่ “%”
                </p>
              )}
              <Field id="pf-hypo" label="สมมติฐาน" error={fieldErrors.hypothesis}>
                <textarea
                  id="pf-hypo"
                  value={v.hypothesis}
                  onChange={(e) => upd("hypothesis", e.target.value)}
                  rows={3}
                  maxLength={1200}
                  className="w-full rounded-md border border-zinc-300 bg-white p-2.5 text-base focus:border-primary-600 focus:outline-none focus:ring-1 focus:ring-primary-600"
                />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field id="pf-base" label="ค่าฐาน" error={fieldErrors.baselineValue}>
                  <input id="pf-base" inputMode="decimal" value={v.baselineValue} onChange={(e) => upd("baselineValue", e.target.value)} className={INPUT} />
                </Field>
                <Field id="pf-base-asof" label="ค่าฐาน ณ วันที่">
                  <input id="pf-base-asof" type="date" value={v.baselineAsOf} onChange={(e) => upd("baselineAsOf", e.target.value)} className={INPUT} />
                </Field>
                <Field id="pf-op" label="ทิศของเกณฑ์">
                  <select id="pf-op" value={v.passOp} onChange={(e) => upd("passOp", e.target.value)} className={INPUT}>
                    <option value="">ยังไม่เลือก</option>
                    <option value=">=">ไม่น้อยกว่า</option>
                    <option value="<=">ไม่เกิน</option>
                  </select>
                </Field>
                <Field id="pf-thr" label="เกณฑ์ผ่าน" error={fieldErrors.passThreshold}>
                  <input id="pf-thr" inputMode="decimal" value={v.passThreshold} onChange={(e) => upd("passThreshold", e.target.value)} className={INPUT} />
                </Field>
                <Field id="pf-spread" label="ช่วงแกว่งของค่าฐาน" error={fieldErrors.baselineSpread}>
                  <input id="pf-spread" inputMode="decimal" value={v.baselineSpread} onChange={(e) => upd("baselineSpread", e.target.value)} className={INPUT} />
                </Field>
                <Field id="pf-base-note" label="หมายเหตุค่าฐาน (ไม่บังคับ)">
                  <input id="pf-base-note" value={v.baselineNote} onChange={(e) => upd("baselineNote", e.target.value)} className={INPUT} />
                </Field>
              </div>
            </>
          )}
        </Group>
      )}

      {(can("footage_status") || can("shoot_location") || can("footage_url") || can("shoot_note")) && (
        <Group title="ถ่ายทำ">
          <div className="grid gap-3 sm:grid-cols-2">
            {can("footage_status") && (
              <Field id="pf-foot" label="สถานะภาพ">
                <select id="pf-foot" value={v.footageStatus} onChange={(e) => upd("footageStatus", e.target.value)} className={INPUT}>
                  <option value="">ยังไม่ระบุ</option>
                  {FOOTAGE_STATUSES.map((f) => (
                    <option key={f} value={f}>
                      {FOOTAGE_STATUS_LABEL[f]}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {can("shoot_location") && (
              <Field id="pf-loc" label="สถานที่ถ่าย">
                <select id="pf-loc" value={v.shootLocation} onChange={(e) => upd("shootLocation", e.target.value)} className={INPUT}>
                  <option value="">ยังไม่ระบุ</option>
                  {SHOOT_LOCATIONS.map((l) => (
                    <option key={l} value={l}>
                      {SHOOT_LOCATION_LABEL[l]}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {can("shoot_minutes_est") && (
              <Field id="pf-min" label="เวลาประเมิน (นาที)" error={fieldErrors.shootMinutesEst}>
                <input id="pf-min" inputMode="numeric" value={v.shootMinutesEst} onChange={(e) => upd("shootMinutesEst", e.target.value)} className={INPUT} />
              </Field>
            )}
            {can("shoot_date") && (
              <Field id="pf-sdate" label="วันถ่าย" hint="เก็บเป็นวันเท่านั้น (ไม่มีเวลา)">
                <input id="pf-sdate" type="date" value={v.shootDate} onChange={(e) => upd("shootDate", e.target.value)} className={INPUT} />
              </Field>
            )}
          </div>
          {can("footage_url") && (
            <Field id="pf-furl" label="ลิงก์ไฟล์ภาพ" hint="ข้อความ/ลิงก์โฟลเดอร์ที่เก็บภาพ — ไม่ตรวจปลายทาง">
              <input id="pf-furl" value={v.footageUrl} onChange={(e) => upd("footageUrl", e.target.value)} maxLength={500} className={INPUT} />
            </Field>
          )}
          {can("shoot_note") && (
            <Field id="pf-snote" label="หมายเหตุถ่ายทำ">
              <textarea
                id="pf-snote"
                value={v.shootNote}
                onChange={(e) => upd("shootNote", e.target.value)}
                rows={2}
                maxLength={600}
                className="w-full rounded-md border border-zinc-300 bg-white p-2.5 text-base focus:border-primary-600 focus:outline-none focus:ring-1 focus:ring-primary-600"
              />
            </Field>
          )}
        </Group>
      )}

      {isLine && can("line_audience") && (
        <Group title="ผู้รับข้อความ LINE">
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium text-zinc-800">ส่งให้ใคร</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  ["all", "ทุกคน"],
                  ["segment", "เฉพาะกลุ่ม"],
                ] as const
              ).map(([val, label]) => (
                <label
                  key={val}
                  className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-zinc-300 bg-white px-2.5 has-[:checked]:border-primary-600 has-[:checked]:ring-1 has-[:checked]:ring-primary-600"
                >
                  <input type="radio" name="pf-aud" checked={v.lineAudience === val} onChange={() => upd("lineAudience", val)} className="h-5 w-5 text-primary-600 focus:ring-primary-600" />
                  <span className="text-sm font-medium">{label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {v.lineAudience === "segment" && (
            <>
              <Field id="pf-aud-reason" label="เหตุผลที่ส่งเฉพาะกลุ่ม" hint="ส่งเฉพาะกลุ่มได้เมื่อเป็นส่วนลดหรือสินค้า exclusive">
                <input id="pf-aud-reason" value={v.lineAudienceReason} onChange={(e) => upd("lineAudienceReason", e.target.value)} maxLength={500} className={INPUT} />
              </Field>
              <p className="rounded-md bg-zinc-50 p-2.5 text-sm text-zinc-700">กลุ่มที่เลือกตั้งผ่านหน้ากลุ่มลูกค้าเดิม — จอนี้ตั้งกลุ่มไม่ได้ ถ้ายังไม่มีกลุ่ม ระบบจะไม่ให้บันทึก</p>
            </>
          )}
        </Group>
      )}

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
        <Button type="submit" loading={busy}>
          {advanceToPlanned ? "บันทึกและวางแผน" : "บันทึกแผน"}
        </Button>
      </div>
    </form>
  );
}

export function PlanForm({
  open,
  onClose,
  piece,
  hosts,
  contentTypes,
  todayTh,
  advanceToPlanned = false,
}: {
  open: boolean;
  onClose: () => void;
  piece: PieceRow;
  hosts: HostOption[];
  contentTypes: ContentTypeOption[];
  todayTh: string;
  /** ชิ้น "ไอเดีย": บันทึกแผนแล้วส่ง planned ต่อทันที (ปุ่มหลัก "วางแผน…") */
  advanceToPlanned?: boolean;
}) {
  const dirty = useRef(false);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={advanceToPlanned ? "วางแผนชิ้นงาน" : "แก้แผน"}
      confirmBeforeClose={() => !dirty.current || window.confirm("ทิ้งข้อมูลที่แก้ไว้?")}
    >
      <PlanFormBody
        piece={piece}
        hosts={hosts}
        contentTypes={contentTypes}
        todayTh={todayTh}
        advanceToPlanned={advanceToPlanned}
        onClose={onClose}
        onDirty={(d) => {
          dirty.current = d;
        }}
      />
    </Modal>
  );
}
