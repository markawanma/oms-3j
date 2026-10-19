"use client";

// WorkerLots — หน้าช่างเมื่อใบมีหลายส่วน (next_action = 'multi') + จอ "แบ่งส่วนแล้ว" + การ์ดชี้แจงส่วนต่าง (0181 · L1)
// อ่านจาก parts[] / my_actions[] ที่ DB ส่งมา (ผ่าน sanitizeWorkerView แล้ว) — ไม่คำนวณจำนวน/ผลรวมเอง แสดงตามที่ DB ตอบ
// 🔴 ไม่มีตัวเลขเงิน/ต้นทุน/ชื่อลูกค้า/ชื่อผู้เปิดใบ · ตัวพื้น ≥ 18px · ปุ่ม ≥ 56px · ไม่มีลิงก์ออกนอกหน้า
// ใบเดี่ยวที่ไม่แบ่ง ไม่ผ่านไฟล์นี้ (WorkerApp ใช้แผงเดิม)

import { useMemo, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { workerCancelLotAction, workerResolveDiscrepancyAction } from "@/lib/actions/job-worker";
import { ReceivePanel, SendPanel, ActionError, safely } from "@/components/domain/jobs/worker/WorkerPanels";
import type { DoneTone, SplitResultInfo } from "@/components/domain/jobs/worker/WorkerPanels";
import { BigButton } from "@/components/domain/jobs/worker/WorkerParts";
import { renderQrSvgClient, workerPageUrl } from "@/lib/jobs/qr-client";
import { WORKER_CODE_TH } from "@/lib/jobs/messages";
import { SCRAP_REASONS, SCRAP_REASON_LABEL } from "@/lib/jobs/types";
import type { WorkerAction, WorkerPart, WorkerView } from "@/lib/jobs/worker-view";

/** "ส่วนหลัก" = ส่วนที่ยังไม่เคยแยก (lotSeq 0) · "ส่วนที่ k" — ป้ายสั้นสำหรับช่าง (ไม่ซ้ำเลขใบ) */
export function partName(p: Pick<WorkerPart, "lotSeq"> | undefined | null): string {
  if (!p) return "ส่วนนี้";
  return p.lotSeq === 0 ? "ส่วนหลัก" : `ส่วนที่ ${p.lotSeq}`;
}

const CARD = "space-y-3 rounded-xl border border-zinc-300 bg-white p-4";
const keyOf = (a: WorkerAction) => `${a.action}:${a.lotJobId}:${a.stageSeq}:${a.discrepancyId ?? ""}`;

// ---------------------------------------------------------------------------
/** ยืนยัน 2 ขั้นก่อนยกเลิกการแยกส่วน — ชิ้นกลับมาอยู่กับผู้ถือเดิม (ยกเลิกได้เฉพาะยังไม่มีใครรับ — DB ตัดสิน) */
export function CancelSplitButton({ token, lotJobId, qty, onDone, label = "แบ่งผิด? ยกเลิกการแยก" }: { token: string; lotJobId: string; qty: number | null; onDone: (msg: string) => void; label?: string }) {
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function cancel() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    const r = await safely(() => workerCancelLotAction(token, lotJobId, null));
    setBusy(false);
    if (r.ok) onDone(qty !== null ? `ยกเลิกการแยกแล้ว — ${qty} ชิ้นกลับมาอยู่กับคุณ` : "ยกเลิกการแยกแล้ว");
    else {
      // มีคนรับไปแล้ว = ช่างยกเลิกเองไม่ได้ (ข3) → บอกให้แจ้งออฟฟิศ
      setErr(r.code === "already_received" ? "ส่วนนี้มีคนรับไปแล้ว ยกเลิกเองไม่ได้ — แจ้งออฟฟิศ" : r.error);
      setAsk(false);
    }
  }

  return (
    <div className="space-y-2">
      {err && (
        <p role="alert" className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3 text-lg font-semibold text-amber-900">
          {err}
        </p>
      )}
      {ask ? (
        <div role="alertdialog" aria-label="ยืนยันยกเลิกการแยกส่วน" className="space-y-3 rounded-xl border-2 border-amber-400 bg-amber-50 p-4">
          <p className="text-xl font-semibold text-amber-950">{qty !== null ? `${qty} ชิ้น` : "ชิ้นที่ส่ง"}จะกลับมาอยู่กับคุณ — ยกเลิกการแยกใช่ไหม</p>
          <BigButton type="button" onClick={() => void cancel()} loading={busy}>
            ยืนยัน ยกเลิกการแยก
          </BigButton>
          <BigButton type="button" tone="secondary" onClick={() => setAsk(false)} disabled={busy}>
            ไม่ยกเลิก
          </BigButton>
        </div>
      ) : (
        <BigButton type="button" tone="secondary" onClick={() => setAsk(true)}>
          {label}
        </BigButton>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
/** จอสำเร็จหลังแยกส่วน: ส่วนที่ส่งไป + ส่วนที่ค้างกับผู้ส่ง + QR ใบเดิมให้คนรับสแกน + ยกเลิกการแยก (L-3) — ไม่ปิดเอง (QR ต้องอยู่บนจอจนกว่าจะกดเสร็จ) */
export function SplitDone({ token, view, info, onFinish, onCancelled }: { token: string; view: WorkerView; info: SplitResultInfo; onFinish: () => void; onCancelled: (msg: string) => void }) {
  const from = view.parts?.find((p) => p.lotJobId === info.fromLotJobId) ?? view.parts?.find((p) => p.lotSeq === 0);
  // QR = URL ของหน้านี้เอง (QR ใบเดิม) — render ในเบราว์เซอร์ · ไม่ออก token ใหม่
  const svg = useMemo(() => {
    try {
      return renderQrSvgClient(workerPageUrl(window.location.origin, token));
    } catch {
      return null;
    }
  }, [token]);
  const lotName = `ส่วนที่ ${info.lot.lotSeq}`;
  return (
    <div className="space-y-4">
      <div role="status" aria-live="polite" className="flex items-center gap-3">
        <CheckCircle2 data-testid="done-ok" className="h-14 w-14 shrink-0 text-green-700" aria-hidden="true" />
        <div>
          <p className="text-3xl font-bold text-zinc-900">แบ่งส่วนแล้ว</p>
          <p className="text-lg text-zinc-700">{view.job.jobNo}</p>
        </div>
      </div>
      <ul className="space-y-2">
        <li className="flex items-center justify-between gap-3 rounded-xl bg-sky-50 p-4 text-sky-950">
          <span>
            <span className="block text-xl font-bold">{lotName}</span>
            <span className="block text-lg">ส่งต่อแล้ว</span>
          </span>
          <strong className="text-3xl tabular-nums">{info.lot.qty}</strong>
        </li>
        <li className="flex items-center justify-between gap-3 rounded-xl bg-zinc-100 p-4 text-zinc-900">
          <span>
            <span className="block text-xl font-bold">{partName(from)}</span>
            <span className="block text-lg">ค้างกับคุณ</span>
          </span>
          <strong className="text-3xl tabular-nums">{info.lot.parentRemaining}</strong>
        </li>
      </ul>
      {svg && (
        <div className="flex items-center gap-4 rounded-xl border border-zinc-300 p-3">
          {/* SVG สร้างในเบราว์เซอร์จากไลบรารี vendored (ดำบนขาว ไม่มีสคริปต์) จาก URL ของหน้านี้ — ไม่ใช่ข้อมูลจากผู้ใช้ */}
          <div className="h-40 w-40 shrink-0" role="img" aria-label={`QR ใบงาน ${view.job.jobNo}`} dangerouslySetInnerHTML={{ __html: svg }} />
          <p className="text-lg text-zinc-800">
            <strong>QR เดิมของใบนี้</strong>
            <br />
            ให้คนรับสแกนจากจอนี้
          </p>
        </div>
      )}
      <BigButton type="button" onClick={onFinish}>
        เสร็จแล้ว
      </BigButton>
      <CancelSplitButton token={token} lotJobId={info.lot.lotJobId} qty={info.lot.qty} onDone={onCancelled} />
    </div>
  );
}

// ---------------------------------------------------------------------------
/** การ์ดชี้แจงส่วนต่าง (มติ Q5): ผู้ส่งบอกว่าชิ้นที่ผู้รับได้น้อยกว่าเกิดอะไรขึ้น — เสียหาย หรือ หาย + เหตุผล */
export function ExplainCard({ token, action, onDone, onReload }: { token: string; action: WorkerAction; onDone: (msg: string, tone?: DoneTone) => void; onReload: () => void }) {
  const [kind, setKind] = useState<"scrap" | "lost" | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [errCode, setErrCode] = useState<string | null>(null);
  const [vErr, setVErr] = useState<string | null>(null);
  const qty = action.qty ?? 0;

  async function submit() {
    if (busy || !action.discrepancyId) return;
    setVErr(null);
    setErr(null);
    setErrCode(null);
    if (!kind) return setVErr("เลือกว่าเสียหายหรือหาย");
    if (!reason) return setVErr("เลือกเหตุผล");
    setBusy(true);
    const r = await safely(() => workerResolveDiscrepancyAction(token, { discrepancyId: action.discrepancyId as string, kind, reason }));
    setBusy(false);
    if (r.ok) onDone(`ชี้แจงแล้ว — ${kind === "lost" ? "หาย" : "เสียหาย"} ${qty} ชิ้น`, "ok");
    else {
      setErr(r.error);
      setErrCode(r.code ?? null);
    }
  }

  // H1: ส่วนต่างงานทองที่มีน้ำหนักเทียบ — ออฟฟิศชี้แจงเท่านั้น (ช่างกดแล้ว DB ตอบ office_required) → ไม่ให้ปุ่ม แสดงข้อความ · ไม่แสดงน้ำหนักใดๆ
  if (action.officeOnly) {
    return (
      <section aria-labelledby={`ex-h-${action.discrepancyId}`} className="space-y-2 rounded-xl border-2 border-amber-300 bg-amber-50 p-4">
        <h3 id={`ex-h-${action.discrepancyId}`} className="text-2xl font-bold text-amber-950">
          ส่วนต่าง {qty} ชิ้น — รอออฟฟิศชี้แจง
        </h3>
        <p className="text-lg text-amber-950">{WORKER_CODE_TH.office_required}</p>
      </section>
    );
  }
  const CHIP = (on: boolean) => `min-h-14 rounded-xl border-2 px-4 text-xl font-semibold ${on ? "border-primary-600 bg-primary-50 text-primary-900" : "border-zinc-400 bg-white text-zinc-900"}`;
  return (
    <section aria-labelledby={`ex-h-${action.discrepancyId}`} className="space-y-3 rounded-xl border-2 border-amber-300 bg-amber-50 p-4">
      <h3 id={`ex-h-${action.discrepancyId}`} className="text-2xl font-bold text-amber-950">
        ส่วนต่าง {qty} ชิ้น — รอคุณชี้แจง
      </h3>
      <p className="text-lg text-amber-950">
        {partName({ lotSeq: lotSeqOf(action.label) })} · ผู้รับขั้นถัดไปได้น้อยกว่าที่คุณส่ง {qty} ชิ้น (ขั้น {action.stageName}) — ชิ้นเหล่านี้เกิดอะไรขึ้น
      </p>
      <div role="radiogroup" aria-label="เกิดอะไรขึ้น" className="grid grid-cols-2 gap-2">
        {([["scrap", "เสียหาย"], ["lost", "หาย"]] as const).map(([k, t]) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            onClick={() => {
              setKind(k);
              setVErr(null);
              if (k === "lost" && reason === null) setReason("missing"); // หาย → เหตุผลที่ตรงที่สุด (เปลี่ยนได้)
            }}
            className={CHIP(kind === k)}
          >
            {t}
          </button>
        ))}
      </div>
      {kind && (
        <div className="space-y-1.5">
          <p className="text-lg font-semibold text-zinc-900">เพราะอะไร</p>
          <div role="radiogroup" aria-label="เหตุผล" className="flex flex-wrap gap-2">
            {SCRAP_REASONS.map((r) => (
              <button key={r} type="button" role="radio" aria-checked={reason === r} onClick={() => { setReason(r); setVErr(null); }} className={CHIP(reason === r)}>
                {SCRAP_REASON_LABEL[r] ?? r}
              </button>
            ))}
          </div>
        </div>
      )}
      {vErr && (
        <p role="alert" className="text-lg font-semibold text-red-700">
          {vErr}
        </p>
      )}
      {err && <ActionError message={err} code={errCode} onReload={onReload} busy={busy} />}
      <BigButton type="button" onClick={() => void submit()} loading={busy}>
        ยืนยันชี้แจง
      </BigButton>
    </section>
  );
}

/** "JB-0020 · ส่วนที่ 2" → 2 · "JB-0020" → 0 */
function lotSeqOf(label: string): number {
  const m = /ส่วนที่\s+(\d+)\s*$/.exec(label);
  return m ? Number(m[1]) : 0;
}

// ---------------------------------------------------------------------------
/** จอหลักเมื่อใบมีหลายส่วน: รอคุณรับ · คุณถืออยู่ · รอคุณชี้แจง · ส่วนอื่น (พับ) — แต่ละการ์ดกดแล้วเปิดแบบฟอร์มของส่วนนั้น (ถ้ามีแค่อันเดียว เปิดให้เลย) */
export function MultiPanel({
  token,
  view,
  onDone,
  onReload,
  onSplit,
  onCancelled,
}: {
  token: string;
  view: WorkerView;
  onDone: (msg: string, tone?: DoneTone) => void;
  onReload: () => void;
  onSplit: (r: SplitResultInfo) => void;
  onCancelled: (msg: string) => void;
}) {
  const acts = view.myActions ?? [];
  const parts = view.parts ?? [];
  const byId = useMemo(() => new Map(parts.map((p) => [p.lotJobId, p])), [parts]);
  const receive = acts.filter((a) => a.action === "receive");
  const send = acts.filter((a) => a.action === "send");
  const explain = acts.filter((a) => a.action === "explain");
  const [open, setOpen] = useState<string | null>(acts.length === 1 ? keyOf(acts[0]) : null);
  const mine = new Set(acts.map((a) => a.lotJobId));
  const others = parts.filter((p) => p.status !== "done" && p.status !== "cancelled" && !mine.has(p.lotJobId));

  if (acts.length === 0 && others.length === 0) {
    return <p className="rounded-xl bg-zinc-100 p-4 text-xl text-zinc-900">ตอนนี้ไม่มีส่วนของคุณในใบนี้</p>;
  }

  const head = (a: WorkerAction, qty: number | null, sub: string) => (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xl font-bold text-zinc-900">{partName(byId.get(a.lotJobId) ?? { lotSeq: lotSeqOf(a.label) })}</p>
        <p className="text-lg text-zinc-700">{sub}</p>
      </div>
      {qty !== null && <strong className="shrink-0 text-4xl tabular-nums text-zinc-900">{qty}</strong>}
    </div>
  );
  const toggle = (a: WorkerAction, label: string) => (
    <BigButton type="button" tone="secondary" aria-expanded={open === keyOf(a)} onClick={() => setOpen(open === keyOf(a) ? null : keyOf(a))}>
      {open === keyOf(a) ? "ย่อ" : label}
    </BigButton>
  );

  return (
    <div className="space-y-4">
      {explain.length > 0 && (
        <section aria-label="รอคุณชี้แจง" className="space-y-2">
          {explain.map((a) => (
            <ExplainCard key={keyOf(a)} token={token} action={a} onDone={onDone} onReload={onReload} />
          ))}
        </section>
      )}

      {receive.length > 0 && (
        <section aria-labelledby="mp-recv" className="space-y-2">
          <h2 id="mp-recv" className="text-base font-bold text-zinc-700">
            รอคุณรับ
          </h2>
          {receive.map((a) => (
            <div key={keyOf(a)} className={CARD}>
              {head(a, a.qtyExpected, `ขั้นถัดไป: ${a.stageName}`)}
              {open === keyOf(a) ? <ReceivePanel token={token} view={view} action={a} onDone={onDone} onReload={onReload} /> : null}
              {toggle(a, `รับ ${a.qtyExpected ?? ""} ชิ้น`.trim())}
            </div>
          ))}
        </section>
      )}

      {send.length > 0 && (
        <section aria-labelledby="mp-send" className="space-y-2">
          <h2 id="mp-send" className="text-base font-bold text-zinc-700">
            คุณถืออยู่ในใบนี้
          </h2>
          {send.map((a) => {
            const p = byId.get(a.lotJobId);
            return (
              <div key={keyOf(a)} className={CARD}>
                {head(a, a.qtyHold, `ถืออยู่ที่ ${a.stageName}${p?.days != null ? ` · ${p.days === 0 ? "วันนี้" : `${p.days} วัน`}` : ""}`)}
                {open === keyOf(a) ? <SendPanel token={token} view={view} action={a} qtyOpenByDefault onDone={onDone} onReload={onReload} onSplit={onSplit} /> : null}
                {toggle(a, "ส่งต่อ")}
              </div>
            );
          })}
        </section>
      )}

      {others.length > 0 && (
        <details className="rounded-xl border border-zinc-300 p-3">
          <summary className="min-h-12 cursor-pointer text-lg font-semibold text-zinc-800">
            ส่วนอื่นในใบนี้ (ไม่ใช่ของคุณ) · {others.length}
          </summary>
          <ul className="mt-2 space-y-2">
            {others.map((p) => (
              <li key={p.lotJobId} className="space-y-2 rounded-lg bg-zinc-50 p-3">
                <div className="flex items-center justify-between gap-3 text-lg text-zinc-900">
                  <span>
                    {partName(p)} · {p.stageName ? `ที่ ${p.stageName}` : "รอรับ"}
                    {p.holderName ? ` · ${p.holderName}` : ""}
                    {p.days != null ? ` (${p.days === 0 ? "วันนี้" : `${p.days} วัน`})` : ""}
                  </span>
                  {p.qtyLive !== null && <strong className="text-2xl tabular-nums">{p.qtyLive}</strong>}
                </div>
                {p.canCancelSplit && <CancelSplitButton token={token} lotJobId={p.lotJobId} qty={p.qtyLive} onDone={onCancelled} label="ยกเลิกการแยกส่วนนี้" />}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
