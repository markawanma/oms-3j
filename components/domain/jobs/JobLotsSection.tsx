"use client";

// JobLotsSection — แผงส่วนย่อยบนหน้าใบงานแม่ (ออฟฟิศ · 0181 L1): แถบสะสม · การ์ดส่วน · ส่วนต่างรอชี้แจง · QR ที่ใช้งานอยู่ · dialog แยก/ยกเลิกส่วน/ชี้แจง/void/เพิกถอน QR
// โหลดแบบ lazy จาก JobDetailClient (ใบเดี่ยวที่ไม่เคยแยกไม่โหลดไฟล์นี้) · ทุกกติกาตัดสินที่ DB — ที่นี่ตรวจรูปแบบ input + ปิดปุ่มที่รู้ว่าจะถูกปฏิเสธ
// 🔴 ไม่มีตัวเลขเงิน/ต้นทุน/ชื่อผู้เปิดใบ · ไม่มี token ดิบ (รายการ QR ได้แต่เลขใบ/ชนิด/วันที่)

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Printer, Scissors } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { DialogButtons, ErrorLine, FIELD, Field } from "@/components/domain/jobs/JobDialogs";
import { PartCard, PartsStackBar, partTitle } from "@/components/domain/jobs/JobLotsParts";
import { useOfficeRun } from "@/components/domain/jobs/useOfficeRun";
import { cancelJobLot, listJobQr, resolveDiscrepancyOffice, splitJobLot, voidDiscrepancy } from "@/lib/actions/job-lots";
import type { JobQrRow } from "@/lib/actions/job-lots";
import { officeReceiveStage, revokeJobQr } from "@/lib/actions/job-office-write";
import { GENERIC_JOB_ERROR } from "@/lib/jobs/messages";
import { parseQtyText, parseWeight } from "@/lib/jobs/input";
import { DISCREPANCY_KIND_LABEL, lotSegments, noteRequired, openDiscrepancies, splittableParts } from "@/lib/jobs/lots";
import type { JobLotsData, LotDiscrepancy, LotPart, TreeStageLoss } from "@/lib/jobs/lots";
import { addDays, thaiDateTime } from "@/lib/jobs/dates";
import { SCRAP_REASONS, SCRAP_REASON_LABEL } from "@/lib/jobs/types";

/** เพดาน QR ที่ใช้งานพร้อมกันต่อใบ (มติ Q8: คง 5) — DB ตัดสินจริง (token_cap) · ที่นี่ไว้ปิดปุ่ม/อธิบายก่อนกด */
export const QR_CAP = 5;

/** event ในหน้าต่าง: รายการ QR เปลี่ยน (เพิกถอน/ออกใหม่) */
export const QR_CHANGED = "job-qr-changed";

export type LotDialogSpec =
  | { t: "split"; partId?: string }
  | { t: "cancelLot"; partId: string }
  | { t: "resolve"; discId: string }
  | { t: "void"; discId: string }
  | { t: "receive"; partId: string }
  | { t: "revoke"; printNo: number; label: string }
  | null;

const RADIO = (on: boolean) => `min-h-11 rounded-md border px-3 text-base font-medium ${on ? "border-primary-600 bg-primary-50 text-primary-900" : "border-zinc-300 bg-white text-zinc-900"}`;

// ---------------------------------------------------------------------------
// รายการ QR ที่ใช้งานอยู่ (job_token_list) — โหลด/ว่าง/ผิดพลาด/สำเร็จ ครบ
// ---------------------------------------------------------------------------
type QrState = { s: "loading" } | { s: "error"; message: string } | { s: "ok"; rows: JobQrRow[] };

export function useQrList(jobId: string) {
  const [state, setState] = useState<QrState>({ s: "loading" });
  const load = useCallback(async () => {
    setState({ s: "loading" });
    try {
      const r = await listJobQr(jobId);
      setState(r.ok ? { s: "ok", rows: r.data } : { s: "error", message: r.error });
    } catch {
      setState({ s: "error", message: GENERIC_JOB_ERROR });
    }
  }, [jobId]);
  useEffect(() => {
    void load();
  }, [load]);
  // เพิกถอน/ออก QR จากที่อื่นในหน้า (dialog) แล้วรายการต้องโหลดใหม่
  useEffect(() => {
    const h = () => void load();
    window.addEventListener(QR_CHANGED, h);
    return () => window.removeEventListener(QR_CHANGED, h);
  }, [load]);
  const active = state.s === "ok" ? state.rows.filter((r) => r.active) : [];
  return { state, load, active, capReached: active.length >= QR_CAP };
}

const PURPOSE_LABEL: Record<JobQrRow["purpose"], string> = { traveler: "ใบงานหลัก", sublot: "ใบย่อย", delivery_note: "ใบส่งของ" };

function QrList({ qr, closed, onRevoke }: { qr: ReturnType<typeof useQrList>; closed: boolean; onRevoke: (r: JobQrRow) => void }) {
  const st = qr.state;
  return (
    <section aria-labelledby="qr-h" className="space-y-2">
      <h3 id="qr-h" className="text-base font-bold text-zinc-900">
        QR ที่ใช้งานอยู่ {st.s === "ok" ? `(${qr.active.length}/${QR_CAP} ใบ)` : ""}
      </h3>
      {st.s === "loading" && (
        <p role="status" aria-busy="true" className="text-sm text-zinc-700">
          กำลังโหลดรายการ QR…
        </p>
      )}
      {st.s === "error" && (
        <div className="space-y-2">
          <ErrorLine message={st.message} />
          <Button type="button" variant="secondary" onClick={() => void qr.load()}>
            โหลดใหม่
          </Button>
        </div>
      )}
      {st.s === "ok" && qr.active.length === 0 && <p className="text-sm text-zinc-700">ยังไม่มี QR ที่ใช้งาน — ยังไม่ได้พิมพ์ใบงาน</p>}
      {st.s === "ok" && qr.active.length > 0 && (
        <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white">
          {qr.active.map((r) => (
            <li key={r.printNo} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="text-zinc-900">
                <strong>ใบที่ {r.printNo}</strong> · {PURPOSE_LABEL[r.purpose]}
                {r.label ? ` · ${r.label}` : ""}
                <span className="block text-xs text-zinc-700">ออก {thaiDateTime(r.issuedAt)}</span>
              </span>
              {!closed && (
                <Button type="button" variant="secondary" size="sm" aria-label={`เพิกถอน QR ใบที่ ${r.printNo}`} onClick={() => onRevoke(r)}>
                  เพิกถอน
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {st.s === "ok" && qr.capReached && !closed && (
        <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-sm font-medium text-amber-900">
          QR ใช้งานครบ {QR_CAP} ใบแล้ว — จะพิมพ์ใบย่อยเพิ่มต้องเพิกถอนใบที่หายหรือไม่ใช้ก่อน (ระบบไม่เพิกถอนให้เอง)
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// แผงหลัก
// ---------------------------------------------------------------------------
export function LotsPanel({ jobId, lots, closed, openDialog, gold = false, stageNames = {} }: { jobId: string; lots: JobLotsData; closed: boolean; openDialog: (d: LotDialogSpec) => void; /** งานทอง — ออฟฟิศเห็นส่วนต่างน้ำหนักเทียบ (หน้าช่างไม่เห็น) */ gold?: boolean; /** รหัสขั้น → ชื่อไทย (ตารางน้ำหนักตามส่วน) */ stageNames?: Record<string, string> }) {
  const qr = useQrList(jobId);
  const segs = lotSegments(lots);
  const total = lots.summary?.qtyPlanned ?? 0;
  const pending = openDiscrepancies(lots.discrepancies);
  const settled = lots.discrepancies.filter((d) => d.status === "resolved");
  const parts = lots.parts;
  const canSplit = !closed && splittableParts(lots).length > 0;
  const activeCount = lots.summary?.partsCount ?? parts.filter((p) => p.status !== "cancelled").length;
  return (
    <section aria-labelledby="lots-h" className="space-y-4 rounded-lg border border-zinc-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="lots-h" className="text-lg font-bold text-zinc-900">
          ส่วนของใบนี้ ({activeCount} ส่วน)
        </h2>
        {canSplit && (
          <Button type="button" variant="secondary" onClick={() => openDialog({ t: "split" })}>
            <Scissors className="h-4 w-4" aria-hidden="true" />
            แยกส่วน
          </Button>
        )}
      </div>

      {lots.summary ? <PartsStackBar segments={segs} total={total} sumOk={lots.summary.sumCheck} /> : <p className="text-sm text-zinc-700">ยังไม่มีสรุปยอดรวมของใบนี้</p>}

      <ul className="space-y-2" aria-label="รายการส่วน">
        {parts.map((p) => {
          const open = p.status !== "done" && p.status !== "cancelled";
          return (
            <PartCard key={p.jobId} part={p}>
              {!closed && open && p.lotSeq > 0 && p.pendingSeq !== null && p.holdSeq === null && (
                <>
                  {p.receiveLocked && (
                    <span role="status" className="w-full rounded-md border border-amber-300 bg-amber-50 p-2 text-sm font-medium text-amber-900">
                      ล็อก: ช่างชั่งรับ {p.pendingStageName ?? "ขั้นนี้"} ไม่ตรงหลายครั้ง — ให้ออฟฟิศรับแทน
                    </span>
                  )}
                  <Button type="button" variant={p.receiveLocked ? "primary" : "secondary"} aria-label={`กรอกแทน: รับงาน ${partTitle(p)}`} onClick={() => openDialog({ t: "receive", partId: p.jobId })}>
                    กรอกแทน: รับงาน
                  </Button>
                </>
              )}
              {!closed && open && p.lotSeq > 0 && (
                <>
                  {qr.capReached ? (
                    <span className="inline-flex min-h-11 items-center rounded-md border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-700">พิมพ์ใบย่อยไม่ได้ — QR ครบ {QR_CAP} ใบ (เพิกถอนก่อน)</span>
                  ) : (
                    <Link href={`/jobs/${jobId}/print?lot=${p.jobId}`} className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 hover:bg-zinc-50">
                      <Printer className="h-4 w-4" aria-hidden="true" />
                      พิมพ์ใบย่อย {partTitle(p)}
                    </Link>
                  )}
                  <Button type="button" variant="secondary" aria-label={`ยกเลิก ${partTitle(p)}`} onClick={() => openDialog({ t: "cancelLot", partId: p.jobId })}>
                    ยกเลิกส่วน
                  </Button>
                </>
              )}
            </PartCard>
          );
        })}
      </ul>

      {pending.length > 0 && (
        <section aria-labelledby="disc-h" className="space-y-2">
          <h3 id="disc-h" className="text-base font-bold text-amber-950">
            ส่วนต่างรอชี้แจง ({pending.reduce((n, d) => n + d.qty, 0)} ชิ้น)
          </h3>
          <ul className="space-y-2">
            {pending.map((d) => (
              <li key={d.id} className="rounded-lg border border-amber-300 bg-amber-50 p-3">
                <p className="text-sm font-semibold text-amber-950">
                  {d.qty} ชิ้น · {d.lotLabel || "ส่วนนี้"}
                </p>
                <p className="text-sm text-amber-950">
                  {d.fromStageName} ส่งไป {d.toStageName} — ผู้รับได้น้อยกว่าที่ส่ง · รอผู้ส่งชี้แจง (เสียหาย / หาย)
                </p>
                {gold && d.weightSentG !== null && d.qtySent !== null && (
                  <p className="text-sm text-amber-950">
                    ขั้นก่อนส่ง <strong className="tabular-nums">{d.qtySent} ชิ้น</strong> หนัก <span className="tabular-nums">{d.weightSentG.toLocaleString("th-TH", { maximumFractionDigits: 3 })} g</span>
                  </p>
                )}
                {gold && d.weightGapExcessG !== null && (
                  <p className={`text-sm font-medium ${noteRequired(d, true) ? "text-red-800" : "text-amber-950"}`}>
                    น้ำหนักหายเกินสัดส่วนชิ้นที่ขาด: <span className="tabular-nums">{d.weightGapExcessG < 0 ? "−" : d.weightGapExcessG > 0 ? "+" : ""}{Math.abs(d.weightGapExcessG).toLocaleString("th-TH", { maximumFractionDigits: 3 })} g</span>
                    {noteRequired(d, true) ? " · ต้องเขียนคำอธิบายตอนชี้แจง" : ""}
                  </p>
                )}
                {gold && d.weightGapG !== null && (
                  <p className="text-sm font-medium text-amber-950">
                    ส่วนต่างน้ำหนักเทียบ (รับ − ส่ง): <span className="tabular-nums">{d.weightGapG > 0 ? "+" : d.weightGapG < 0 ? "−" : ""}{Math.abs(d.weightGapG).toLocaleString("th-TH", { maximumFractionDigits: 3 })} g</span> · งานทอง ออฟฟิศเป็นผู้ชี้แจง (ช่างชี้แจงเองไม่ได้)
                  </p>
                )}
                {!closed && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button type="button" onClick={() => openDialog({ t: "resolve", discId: d.id })}>
                      ชี้แจงแทน
                    </Button>
                    <Button type="button" variant="secondary" onClick={() => openDialog({ t: "void", discId: d.id })}>
                      ยกเลิกส่วนต่าง
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {settled.length > 0 && (
        <ul className="space-y-1 text-sm text-zinc-800" aria-label="ส่วนต่างที่ชี้แจงแล้ว">
          {settled.map((d) => (
            <li key={d.id}>
              ชี้แจงแล้ว: {d.qty} ชิ้น {DISCREPANCY_KIND_LABEL[d.resolvedKind ?? ""] ?? ""} ({SCRAP_REASON_LABEL[d.resolvedReason ?? ""] ?? d.resolvedReason ?? "—"}) · {d.fromStageName} → {d.toStageName}
            </li>
          ))}
        </ul>
      )}

      {lots.treeLoss && <TreeLossList tree={lots.treeLoss} parts={lots.parts} stageNames={stageNames} />}

      <QrList qr={qr} closed={closed} onRevoke={(r) => openDialog({ t: "revoke", printNo: r.printNo, label: `ใบที่ ${r.printNo} · ${PURPOSE_LABEL[r.purpose]}${r.label ? ` · ${r.label}` : ""}` })} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// dialogs
// ---------------------------------------------------------------------------
export function LotDialogs({ jobId, lots, spec, onClose, gold = false, workers = [], todayTh = "" }: { jobId: string; lots: JobLotsData; spec: LotDialogSpec; onClose: () => void; gold?: boolean; workers?: { id: string; displayName: string }[]; todayTh?: string }) {
  if (!spec) return null;
  if (spec.t === "split") return <SplitLotDialog parts={splittableParts(lots)} initial={spec.partId} gold={gold} onClose={onClose} />;
  if (spec.t === "cancelLot") {
    const p = lots.parts.find((x) => x.jobId === spec.partId);
    return p ? <CancelLotDialog part={p} gold={gold} onClose={onClose} /> : null;
  }
  if (spec.t === "receive") {
    const p = lots.parts.find((x) => x.jobId === spec.partId);
    return p && p.pendingSeq !== null ? <PartReceiveDialog part={p} workers={workers} todayTh={todayTh} onClose={onClose} /> : null;
  }
  if (spec.t === "resolve" || spec.t === "void") {
    const d = lots.discrepancies.find((x) => x.id === spec.discId);
    if (!d) return null;
    return spec.t === "resolve" ? <ResolveDiscrepancyDialog disc={d} gold={gold} onClose={onClose} /> : <VoidDiscrepancyDialog disc={d} onClose={onClose} />;
  }
  return <RevokeQrDialog jobId={jobId} printNo={spec.printNo} label={spec.label} onClose={onClose} />;
}

/** แยกส่วน (ออฟฟิศ): เลือกส่วนที่ผู้ถือถืออยู่ + จำนวนที่แยก (ผู้ถือเดิมเหลือ ≥ 1) · ไม่ชั่ง (ค1) */
export function SplitLotDialog({ parts, initial, onClose, gold = false }: { parts: LotPart[]; initial?: string; onClose: () => void; /** งานทอง: ขั้นที่ตั้งชั่ง = ต้องชั่งส่วนที่แยก (มติ 19 ต.ค.) — เงิน/ขั้นไม่ชั่ง = ไม่มีช่อง */ gold?: boolean }) {
  const { run, busy, error, setError } = useOfficeRun();
  const [pickId, setPickId] = useState(initial ?? parts[0]?.jobId ?? "");
  const part = parts.find((p) => p.jobId === pickId) ?? parts[0];
  const [text, setText] = useState("");
  const hold = part?.qtyLive ?? 0;
  const parsed = parseQtyText(text);
  const n = parsed.ok ? parsed.value : null;
  const tooMany = n !== null && n > hold - 1;
  const needWeight = gold && !!part?.holdWeighRequired;
  const [moveText, setMoveText] = useState("");
  const move = needWeight ? parseWeight(moveText, "น้ำหนักส่วนที่แยกออก") : null;
  const moveBad = needWeight && (!move || !move.ok || move.value === null || move.value <= 0);
  const ready = !!part && part.holdSeq !== null && n !== null && !tooMany && !moveBad;

  async function submit() {
    if (!part || part.holdSeq === null || n === null) return;
    const r = await run(() => splitJobLot({ jobId: part.jobId, expectedSeq: part.holdSeq as number, qty: n, qtyHold: hold, ...(needWeight ? { weightMoveG: moveText } : {}) }), { success: "แยกส่วนแล้ว" });
    if (r.ok) onClose();
  }

  return (
    <Modal open onClose={onClose} title="แยกส่วน (ส่งต่อ n จาก N)">
      {!part ? (
        <p className="text-sm text-zinc-700">ตอนนี้ไม่มีส่วนที่แยกได้ (ต้องมีผู้ถือและถืออยู่ตั้งแต่ 2 ชิ้น)</p>
      ) : (
        <form noValidate className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (ready) void submit(); }}>
          {parts.length > 1 && (
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium text-zinc-800">แยกจากส่วนไหน</legend>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="ส่วนที่จะแยก">
                {parts.map((p) => (
                  <button key={p.jobId} type="button" role="radio" aria-checked={p.jobId === part.jobId} className={RADIO(p.jobId === part.jobId)} onClick={() => { setPickId(p.jobId); setError(null); }}>
                    {partTitle(p)} · {p.qtyLive} ชิ้น
                  </button>
                ))}
              </div>
            </fieldset>
          )}
          <p className="text-sm text-zinc-800">
            {partTitle(part)} ถืออยู่ที่ {part.stageName ?? "—"}
            {part.holderName ? ` · ${part.holderName}` : ""} · <strong>{hold} ชิ้น</strong>
          </p>
          <Field id="split-qty" label="แยกออกกี่ชิ้น" hint={`ผู้ถือเดิมต้องเหลืออย่างน้อย 1 ชิ้น (แยกได้ 1–${hold - 1}) · ${needWeight ? "งานทองที่ขั้นชั่ง: ต้องชั่งส่วนที่แยกออกด้วย" : "แยกส่วนนับจำนวนอย่างเดียว ไม่ต้องชั่ง"}`}>
            <input id="split-qty" inputMode="numeric" value={text} onChange={(e) => { setText(e.target.value); setError(null); }} className={FIELD} aria-invalid={text !== "" && (!parsed.ok || tooMany)} />
          </Field>
          {needWeight && (
            <>
              <Field id="split-weight" label="น้ำหนักส่วนที่แยกออก (กรัม)" hint="ชั่งเฉพาะส่วนที่แยกออก · ทศนิยมไม่เกิน 3 ตำแหน่ง · ต้องมากกว่า 0">
                <input id="split-weight" inputMode="decimal" value={moveText} onChange={(e) => { setMoveText(e.target.value); setError(null); }} className={FIELD} aria-invalid={moveText !== "" && !!moveBad} />
              </Field>
              {moveText !== "" && move && !move.ok && <ErrorLine message={move.error} />}
            </>
          )}
          {text !== "" && !parsed.ok && <ErrorLine message={parsed.error} />}
          {tooMany && <ErrorLine message={`แยกได้ไม่เกิน ${hold - 1} ชิ้น (ผู้ถือเดิมต้องเหลืออย่างน้อย 1 ชิ้น)`} />}
          {ready && n !== null && (
            <p role="status" aria-live="polite" className="rounded-md bg-zinc-50 p-2.5 text-sm text-zinc-900">
              ส่วนใหม่ <strong>{n}</strong> · ค้างกับผู้ถือเดิม <strong>{hold - n}</strong> · รวม {hold} ครบ
            </p>
          )}
          <ErrorLine message={error} />
          <DialogButtons busy={busy} ready={ready} confirm="แยกส่วน" onClose={onClose} />
        </form>
      )}
    </Modal>
  );
}

/** ยกเลิกส่วน: เหตุผลบังคับ + ที่ไปของชิ้น (คืนผู้ถือเดิม / นับเป็นของเสีย + เหตุผลของเสีย) */
export function CancelLotDialog({ part, onClose, gold = false }: { part: LotPart; onClose: () => void; /** งานทอง */ gold?: boolean }) {
  const { run, busy, error } = useOfficeRun();
  const [reason, setReason] = useState("");
  const [disp, setDisp] = useState<"return_to_parent" | "scrap">("return_to_parent");
  const [scrapReason, setScrapReason] = useState<string | null>(null);
  // M-C: ทอง + ส่วนมีขั้นชั่ง + นับเป็นของเสีย = ต้องชั่งน้ำหนักของเสียที่เลิกใช้ (> 0 · ทศนิยม ≤ 3) — DB ตรวจซ้ำ (scrap_weight_required / weight_over / weight_unexpected)
  const needWeight = gold && part.hasWeighStage && disp === "scrap";
  const [wText, setWText] = useState("");
  const wParsed = needWeight ? parseWeight(wText, "น้ำหนักเศษที่คืน") : null;
  const wBad = needWeight && (!wParsed || !wParsed.ok || wParsed.value === null || wParsed.value <= 0);
  const ready = reason.trim() !== "" && (disp === "return_to_parent" || scrapReason !== null) && !wBad;

  async function submit() {
    const r = await run(() => cancelJobLot({ lotJobId: part.jobId, reason, disposition: disp, scrapReason: disp === "scrap" ? scrapReason : null, ...(needWeight ? { scrapWeightG: wText } : {}) }), { success: `ยกเลิก${partTitle(part)}แล้ว` });
    if (r.ok) onClose();
  }

  return (
    <Modal open onClose={onClose} title={`ยกเลิก ${partTitle(part)}`}>
      <form noValidate className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (ready) void submit(); }}>
        <p className="text-sm text-zinc-800">
          {partTitle(part)} มี <strong>{part.qtyLive ?? part.qtyPlanned} ชิ้น</strong> — ยกเลิกแล้วชิ้นเหล่านี้ต้องมีที่ไป (ไม่มี “หายเฉยๆ”)
        </p>
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium text-zinc-800">ชิ้นที่ค้างไปไหน</legend>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="ที่ไปของชิ้น">
            <button type="button" role="radio" aria-checked={disp === "return_to_parent"} className={RADIO(disp === "return_to_parent")} onClick={() => setDisp("return_to_parent")}>
              คืนให้ผู้ถือเดิม
            </button>
            <button type="button" role="radio" aria-checked={disp === "scrap"} className={RADIO(disp === "scrap")} onClick={() => setDisp("scrap")}>
              นับเป็นของเสีย
            </button>
          </div>
        </fieldset>
        {disp === "scrap" && (
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium text-zinc-800">เสียเพราะอะไร</legend>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="เหตุผลของเสีย">
              {SCRAP_REASONS.map((r) => (
                <button key={r} type="button" role="radio" aria-checked={scrapReason === r} className={RADIO(scrapReason === r)} onClick={() => setScrapReason(r)}>
                  {SCRAP_REASON_LABEL[r]}
                </button>
              ))}
            </div>
          </fieldset>
        )}
        {needWeight && (
          <>
            <Field id="cancel-lot-weight" label="น้ำหนักเศษที่คืน (กรัม)" hint="งานทอง: ชั่งน้ำหนักของเสียที่เลิกใช้ของส่วนนี้ · ต้องมากกว่า 0 · ทศนิยมไม่เกิน 3 ตำแหน่ง">
              <input id="cancel-lot-weight" inputMode="decimal" value={wText} onChange={(e) => setWText(e.target.value)} className={FIELD} aria-invalid={wText !== "" && wBad} />
            </Field>
            {wText !== "" && wParsed && !wParsed.ok && <ErrorLine message={wParsed.error} />}
          </>
        )}
        <Field id="cancel-lot-reason" label="เหตุผลที่ยกเลิกส่วน">
          <textarea id="cancel-lot-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={200} className={`${FIELD} py-2`} />
        </Field>
        <ErrorLine message={error} />
        <DialogButtons busy={busy} ready={ready} confirm="ยกเลิกส่วน" onClose={onClose} danger />
      </form>
    </Modal>
  );
}

/** ชี้แจงส่วนต่างแทนผู้ส่ง: เสียหาย/หาย + เหตุผล (ครั้งเดียว แก้ไม่ได้ — ผิดให้ยกเลิกส่วนต่าง) */
export function ResolveDiscrepancyDialog({ disc, onClose, gold = false }: { disc: LotDiscrepancy; onClose: () => void; gold?: boolean }) {
  const { run, busy, error } = useOfficeRun();
  const [kind, setKind] = useState<"scrap" | "lost" | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  // M-B: ทองที่น้ำหนักหายเกินสัดส่วนชิ้นที่ขาด (excess < −0.05) → ต้องเขียนคำอธิบายเป็นข้อความ (รหัสเหตุผลอย่างเดียวไม่พอ) · DB ตอบ note_required ซ้ำ
  const needNote = noteRequired(disc, gold);
  const [note, setNote] = useState("");
  const ready = kind !== null && reason !== null && (!needNote || note.trim() !== "");

  async function submit() {
    if (!kind || !reason) return;
    const r = await run(() => resolveDiscrepancyOffice({ discrepancyId: disc.id, kind, reason, ...(needNote ? { note } : {}) }), { success: "ชี้แจงส่วนต่างแล้ว" });
    if (r.ok) onClose();
  }

  return (
    <Modal open onClose={onClose} title="ชี้แจงส่วนต่าง">
      <form noValidate className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (ready) void submit(); }}>
        <p className="text-sm text-zinc-800">
          {disc.qty} ชิ้น · {disc.lotLabel} · {disc.fromStageName} ส่งไป {disc.toStageName} (ผู้รับได้น้อยกว่าที่ส่ง)
        </p>
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium text-zinc-800">เกิดอะไรขึ้น</legend>
          <div className="flex gap-2" role="radiogroup" aria-label="เกิดอะไรขึ้น">
            {(["scrap", "lost"] as const).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={kind === k} className={RADIO(kind === k)} onClick={() => { setKind(k); if (k === "lost" && reason === null) setReason("missing"); }}>
                {DISCREPANCY_KIND_LABEL[k]}
              </button>
            ))}
          </div>
        </fieldset>
        {kind && (
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium text-zinc-800">เพราะอะไร</legend>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="เหตุผล">
              {SCRAP_REASONS.map((r) => (
                <button key={r} type="button" role="radio" aria-checked={reason === r} className={RADIO(reason === r)} onClick={() => setReason(r)}>
                  {SCRAP_REASON_LABEL[r]}
                </button>
              ))}
            </div>
          </fieldset>
        )}
        {needNote && (
          <Field id="resolve-note" label="คำอธิบาย (บังคับ — น้ำหนักทองหายเกินสัดส่วนชิ้นที่ขาด)" hint="เขียนเป็นข้อความ เช่น เศษผงขัดที่เก็บไม่ได้ · ไม่เกิน 200 ตัวอักษร">
            <textarea id="resolve-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={200} className={`${FIELD} py-2`} />
          </Field>
        )}
        <ErrorLine message={error} />
        <DialogButtons busy={busy} ready={ready} confirm="ยืนยันชี้แจง" onClose={onClose} />
      </form>
    </Modal>
  );
}

/** ยกเลิกส่วนต่าง (ของไม่ได้หายจริง/บันทึกผิด): DB ต้องให้ขั้นผู้รับย้อนเป็นยังไม่รับก่อน แล้วผู้รับรับใหม่เต็มจำนวน */
export function VoidDiscrepancyDialog({ disc, onClose }: { disc: LotDiscrepancy; onClose: () => void }) {
  const { run, busy, error } = useOfficeRun();
  const [reason, setReason] = useState("");
  const ready = reason.trim() !== "";
  async function submit() {
    const r = await run(() => voidDiscrepancy(disc.id, reason), { success: "ยกเลิกส่วนต่างแล้ว" });
    if (r.ok) onClose();
  }
  return (
    <Modal open onClose={onClose} title="ยกเลิกส่วนต่าง">
      <form noValidate className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (ready) void submit(); }}>
        <p className="text-sm text-zinc-800">
          ส่วนต่าง {disc.qty} ชิ้น ({disc.lotLabel}) — ใช้เมื่อของไม่ได้หายจริงหรือบันทึกผิด · ต้องย้อนขั้นของผู้รับ ({disc.toStageName}) ให้เป็น “ยังไม่รับ” ก่อน แล้วให้ผู้รับรับใหม่เต็มจำนวน (ถ้ายังไม่ได้ย้อน ระบบจะแจ้ง)
        </p>
        <Field id="void-reason" label="เหตุผลที่ยกเลิกส่วนต่าง">
          <textarea id="void-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={200} className={`${FIELD} py-2`} />
        </Field>
        <ErrorLine message={error} />
        <DialogButtons busy={busy} ready={ready} confirm="ยกเลิกส่วนต่าง" onClose={onClose} danger />
      </form>
    </Modal>
  );
}

/** เพิกถอน QR รายใบ ("QR ที่หาย") — ไม่เพิกถอนใบอื่น · ต้องมีเหตุผล */
export function RevokeQrDialog({ jobId, printNo, label, onClose }: { jobId: string; printNo: number; label: string; onClose: () => void }) {
  const { run, busy, error } = useOfficeRun();
  const [reason, setReason] = useState("");
  const ready = reason.trim() !== "";
  async function submit() {
    const r = await run(() => revokeJobQr(jobId, reason, printNo), { success: "เพิกถอน QR แล้ว" });
    if (r.ok) {
      window.dispatchEvent(new Event(QR_CHANGED));
      onClose();
    }
  }
  return (
    <Modal open onClose={onClose} title={`เพิกถอน QR ${label}`}>
      <form noValidate className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (ready) void submit(); }}>
        <p className="text-sm text-zinc-800">เพิกถอนเฉพาะใบนี้ — กระดาษใบนี้สแกนไม่ได้ทันที · QR ใบอื่นของงานนี้ยังใช้ได้</p>
        <Field id="revoke-reason" label="เหตุผล (เช่น กระดาษหาย)">
          <textarea id="revoke-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={200} className={`${FIELD} py-2`} />
        </Field>
        <ErrorLine message={error} />
        <DialogButtons busy={busy} ready={ready} confirm="เพิกถอน QR" onClose={onClose} danger />
      </form>
    </Modal>
  );
}

/** รายการ QR + เพิกถอนรายใบ ใช้ซ้ำนอกแผงส่วน (หน้าพิมพ์ใบย่อย: ครบเพดานแล้วให้เลือกเพิกถอนเอง — ไม่เพิกถอนเงียบ) */
export function QrManager({ jobId, qr, closed = false }: { jobId: string; qr: ReturnType<typeof useQrList>; closed?: boolean }) {
  const [rev, setRev] = useState<{ printNo: number; label: string } | null>(null);
  return (
    <>
      <QrList qr={qr} closed={closed} onRevoke={(r) => setRev({ printNo: r.printNo, label: `ใบที่ ${r.printNo} · ${PURPOSE_LABEL[r.purpose]}${r.label ? ` · ${r.label}` : ""}` })} />
      {rev && <RevokeQrDialog jobId={jobId} printNo={rev.printNo} label={rev.label} onClose={() => setRev(null)} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// M-A: น้ำหนักสูญเสีย/ส่วนต่างส่งมอบของทุกส่วนในต้นไม้ (เฉพาะหน้าออฟฟิศ) — ตัวเลขทุกตัวมาจาก v_job_tree_stage_loss ที่ DB คำนวณ
// ---------------------------------------------------------------------------
const gFmt = (n: number) => `${n.toLocaleString("th-TH", { maximumFractionDigits: 3 })} g`;
const gSigned = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${gFmt(Math.abs(n))}`;

function treeLossCells(t: TreeStageLoss): string[] {
  const out: string[] = [];
  if (t.lossG !== null) out.push(`หาย ${gFmt(t.lossG)}${t.lossPct !== null ? ` (${t.lossPct}%)` : ""}`);
  else if (t.notComparable) out.push("เทียบไม่ได้ (แยกส่วนออกจากขั้นนี้)");
  if (t.handoffGapG !== null && t.handoffGapG !== 0) out.push(`ส่วนต่างส่งมอบ ${gSigned(t.handoffGapG)}`);
  if (t.handoffGapPartialG !== null && t.handoffGapPartialG !== 0) out.push(`ส่วนต่างน้ำหนัก (รับไม่ครบ) ${gSigned(t.handoffGapPartialG)}`);
  if (t.cancelScrapWeightG !== null && t.cancelScrapWeightG > 0) out.push(`เศษที่เลิกใช้ ${gFmt(t.cancelScrapWeightG)}`);
  return out;
}

export function TreeLossList({ tree, parts, stageNames }: { tree: readonly TreeStageLoss[]; parts: readonly LotPart[]; stageNames: Record<string, string> }) {
  const titleOf = new Map(parts.map((p) => [p.jobId, partTitle(p)]));
  const rowsWithInfo = tree.map((t) => ({ t, cells: treeLossCells(t) })).filter((x) => x.cells.length > 0);
  if (rowsWithInfo.length === 0) return null;
  const jobs = [...new Set(rowsWithInfo.map((x) => x.t.jobId))];
  return (
    <section aria-labelledby="tl-h" className="space-y-2">
      <h3 id="tl-h" className="text-base font-bold text-zinc-900">
        น้ำหนักตามส่วน (ออฟฟิศเท่านั้น)
      </h3>
      <ul className="space-y-2">
        {jobs.map((jid) => (
          <li key={jid} className="rounded-lg border border-zinc-200 bg-white p-3">
            <p className="text-sm font-semibold text-zinc-900">{titleOf.get(jid) ?? "ส่วน"}</p>
            <ul className="mt-1 space-y-0.5 text-sm text-zinc-800">
              {rowsWithInfo
                .filter((x) => x.t.jobId === jid)
                .map(({ t, cells }) => (
                  <li key={t.jobStageId} className={t.warn ? "font-semibold text-red-800" : undefined}>
                    {stageNames[t.stageCode ?? ""] ?? t.stageCode ?? "ขั้น"}: <span className="tabular-nums">{cells.join(" · ")}</span>
                  </li>
                ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// ออฟฟิศรับแทนของส่วนย่อย (ขั้นรอรับ) — ปลดล็อก L-2 (ทอง รับไม่ครบ ชั่งไม่ตรงครบ 3 ครั้ง) ได้ด้วยทางนี้
// ---------------------------------------------------------------------------
export function PartReceiveDialog({ part, workers, todayTh, onClose }: { part: LotPart; workers: { id: string; displayName: string }[]; todayTh: string; onClose: () => void }) {
  const { run, busy, error } = useOfficeRun();
  const [on, setOn] = useState(todayTh);
  const [w, setW] = useState("");
  const [workerId, setWorkerId] = useState("");
  const [name, setName] = useState("");
  const weighReq = part.pendingWeighRequired;
  const wParsed = parseWeight(w, "น้ำหนักเข้า");
  const ready = part.pendingSeq !== null && on !== "" && (workerId !== "" || name.trim() !== "") && wParsed.ok && (!weighReq || wParsed.value !== null);

  async function submit() {
    if (part.pendingSeq === null) return;
    const r = await run(() => officeReceiveStage({ jobId: part.jobId, expectedSeq: part.pendingSeq as number, occurredOn: on, weightIn: w.trim() || null, workerId: workerId || null, assigneeName: workerId ? null : name.trim() || null }), {
      success: `รับงานแล้ว — ${part.pendingStageName ?? "ขั้นนี้"}`,
    });
    if (r.ok) onClose();
  }

  return (
    <Modal open onClose={onClose} title={`รับงานแทน: ${partTitle(part)} · ${part.pendingStageName ?? ""}`}>
      <form noValidate className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (ready) void submit(); }}>
        {part.receiveLocked && <p className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-sm font-medium text-amber-900">ขั้นนี้ถูกล็อกเพราะช่างชั่งรับไม่ตรงหลายครั้ง — ออฟฟิศชั่งและรับแทนได้ (ปลดล็อก)</p>}
        <Field id="prc-on" label="วันที่ (ตามกระดาษ)" hint="ย้อนหลังได้ไม่เกิน 14 วัน · ไม่เป็นอนาคต">
          <input id="prc-on" type="date" min={addDays(todayTh, -14)} max={todayTh} value={on} onChange={(e) => setOn(e.target.value)} className={FIELD} />
        </Field>
        <Field id="prc-w" label={`น้ำหนักเข้า (กรัม)${weighReq ? " — ขั้นนี้ต้องใส่" : " — ไม่บังคับ"}`}>
          <input id="prc-w" inputMode="decimal" value={w} onChange={(e) => setW(e.target.value.replace(/[^0-9.,]/g, ""))} className={FIELD} />
        </Field>
        <Field id="prc-worker" label="ผู้รับงาน">
          <select id="prc-worker" value={workerId} onChange={(e) => setWorkerId(e.target.value)} className={FIELD}>
            <option value="">เลือกช่างในทะเบียน…</option>
            {workers.map((x) => (
              <option key={x.id} value={x.id}>
                {x.displayName}
              </option>
            ))}
          </select>
        </Field>
        {!workerId && (
          <Field id="prc-name" label="หรือพิมพ์ชื่อ (ช่างนอกทะเบียน)">
            <input id="prc-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className={FIELD} />
          </Field>
        )}
        <ErrorLine message={error} />
        <DialogButtons busy={busy} ready={ready} confirm="บันทึกรับงาน" onClose={onClose} />
      </form>
    </Modal>
  );
}
