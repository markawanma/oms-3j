"use client";

// WorkerPanels — 3 หน้าจอหลักของช่าง: ระบุตัว (ชื่อ + PIN) · รับงาน · ส่งต่อ
// ทุกปุ่มกันกดซ้ำ (busy) · error ใต้ช่อง/ปุ่ม เป็นไทยสั้นๆ · ไม่มีช่องพิมพ์ข้อความ · ผลสำเร็จเรียก onDone(ข้อความ, tone) ให้ WorkerApp แสดงเครื่องหมายถูก/เตือนเต็มจอ
// ตรวจรูปแบบน้ำหนักฝั่งช่างก่อนส่ง (parseWeight ชุดเดียวกับ server) — "95,5" = 95.5, "1,234.5" = กำกวม ปฏิเสธ · DB ยังเป็นด่านจริง

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { workerLogin, workerReceiveStage, workerSendStage } from "@/lib/actions/job-worker";
import type { WorkerActionResult } from "@/lib/actions/job-worker";
import { BigButton, PinPad, QtyAllChip, QtyBar, QtyLegend, QtyStepper, ScrapStepper, WeightField } from "@/components/domain/jobs/worker/WorkerParts";
import { parseQtyText, parseWeight } from "@/lib/jobs/input";
import { GENERIC_JOB_ERROR, prevNotSentMessage } from "@/lib/jobs/messages";
import { clampSendText, RECEIVE_NONE_MESSAGE, receiveButtonLabel, receiveDisabled, receiveView, sendButtonLabel, sendDisabled, splitView } from "@/lib/jobs/qty-split";
import { stageFieldPlan } from "@/lib/jobs/stage-fields";
import { isMultiView, prevStageName } from "@/lib/jobs/worker-view";
import type { WorkerAction, WorkerView } from "@/lib/jobs/worker-view";

export type DoneTone = "ok" | "warn";
/** น้ำหนักที่รับต่างจากที่ขั้นก่อนส่งเกินนี้ = ขอให้ยืนยันก่อน (เตือน ไม่บล็อก) */
export const WEIGHT_DEVIATION_WARN = 0.2;
/** code ที่ลองใหม่ด้วย PIN ไม่ได้อีกจนกว่าออฟฟิศช่วย */
const PERMANENT_BLOCK = new Set(["locked_office", "token_budget_exhausted", "invalid_token"]);
/** การล็อกที่ผูกกับ "ใบ/QR" ไม่ใช่ตัวช่าง — เปลี่ยนชื่อแล้วก็ยังใช้ไม่ได้ · ที่เหลือ (locked, locked_office) ล็อกรายช่าง: เปลี่ยนคนแล้วแป้นต้องกลับมากดได้ */
const TOKEN_WIDE_BLOCK = new Set(["token_budget_exhausted", "invalid_token"]);
/** code ที่แปลว่า "ข้อมูลบนจอเก่าแล้ว" — แก้ได้ด้วยการโหลดใหม่ (ช่างไม่ต้องรู้ว่า "รีเฟรช" คืออะไร) */
const RELOAD_CODES = new Set(["stage_changed", "out_of_order", "not_holder", "not_received", "already_sent", "weight_required", "scrap_weight_not_asked", "invalid_part", "qty_hold_required", "weight_unexpected", "discrepancy_open", "already_resolved"]);

export async function safely(fn: () => Promise<WorkerActionResult>): Promise<WorkerActionResult> {
  try {
    return await fn();
  } catch {
    return { ok: false, error: GENERIC_JOB_ERROR };
  }
}

/** ปุ่มหลักติดล่างจอ (N2): จอ 390x740 ที่ส่งต่อ+ของเสีย+เหตุผลยาวเกินจอ ปุ่มต้องยังกดได้โดยไม่ต้องเลื่อนหา — sticky ตามหน้าต่าง ไม่ใช่ fixed (ไม่บังเนื้อหาท้ายหน้า) */
export function StickyAction({ children }: { children: ReactNode }) {
  return <div className="sticky bottom-0 z-10 -mx-4 border-t border-zinc-200 bg-white/95 px-4 pt-2 pb-3 backdrop-blur">{children}</div>;
}

const ERR_BOX ="rounded-xl border-2 border-red-200 bg-red-50 p-3 text-lg font-semibold text-red-800";

/** ข้อผิดพลาดใต้ฟอร์ม · ถ้าเป็น code "ข้อมูลเก่า" แสดงปุ่ม "โหลดใหม่" ต่อท้าย (ช่างไม่มีปุ่มรีเฟรชของเบราว์เซอร์ให้ใช้) */
export function ActionError({ message, code, onReload, busy = false }: { message: string; code: string | null; onReload: () => void; busy?: boolean }) {
  return (
    <div className="space-y-2">
      <p role="alert" className={ERR_BOX}>
        {message}
      </p>
      {code && RELOAD_CODES.has(code) && (
        <BigButton type="button" tone="secondary" onClick={onReload} disabled={busy}>
          โหลดใหม่
        </BigButton>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
export function IdentifyPanel({ token, workers, onDone }: { token: string; workers: WorkerView["workers"]; onDone: () => void }) {
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // blockCode: ไม่ null = แป้นล็อก (ผิดหลายครั้ง) · locked/ชั่วคราวปลดเองเมื่อครบเวลา · locked_office/งบ token หมดต้องให้ออฟฟิศ
  // เก็บ code ไว้เพราะ "ไม่ใช่ฉัน" ต้องปลดเฉพาะการล็อกรายช่าง (locked/locked_office) — การล็อกระดับใบ (TOKEN_WIDE_BLOCK) อยู่ต่อข้ามคน
  const [blockCode, setBlockCode] = useState<string | null>(null);
  const [unblockMs, setUnblockMs] = useState<number | null>(null);
  const blocked = blockCode !== null;

  useEffect(() => {
    if (unblockMs === null) return;
    const t = setTimeout(() => {
      setBlockCode(null);
      setUnblockMs(null);
    }, unblockMs);
    return () => clearTimeout(t);
  }, [unblockMs]);

  function notMe() {
    setPicked(null);
    setPin("");
    if (blockCode !== null && TOKEN_WIDE_BLOCK.has(blockCode)) return; // ยังล็อกอยู่ทั้งใบ — คงข้อความไว้ให้คนถัดไปเห็นว่าทำไมแป้นกดไม่ได้
    setBlockCode(null);
    setUnblockMs(null);
    setError(null);
  }

  async function submit(code: string) {
    if (!picked || busy || blocked) return;
    setBusy(true);
    setError(null);
    const r = await safely(() => workerLogin(token, picked.id, code));
    setBusy(false);
    if (r.ok) {
      onDone();
      return;
    }
    setPin("");
    setError(r.error);
    if (r.code && PERMANENT_BLOCK.has(r.code)) setBlockCode(r.code);
    else if (r.code === "locked" && r.retryAfterSeconds) {
      setBlockCode(r.code);
      setUnblockMs(Math.min(r.retryAfterSeconds, 3600) * 1000);
    }
  }

  if (!picked) {
    return (
      <section aria-labelledby="who-h" className="space-y-3">
        <h2 id="who-h" className="text-2xl font-bold text-zinc-900">
          คุณคือใคร
        </h2>
        {workers.length === 0 ? (
          <p className="rounded-xl bg-amber-50 p-4 text-lg text-amber-900">ยังไม่มีชื่อช่างที่ทำขั้นนี้ได้ — บอกออฟฟิศให้เพิ่มชื่อ</p>
        ) : (
          <ul className="space-y-2">
            {workers.map((w) => (
              <li key={w.id}>
                <button type="button" onClick={() => setPicked({ id: w.id, name: w.displayName })} className="min-h-16 w-full rounded-xl border-2 border-zinc-300 bg-white px-5 text-left text-2xl font-bold text-zinc-900 active:bg-zinc-100">
                  {w.displayName}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  return (
    <section aria-labelledby="pin-h" className="space-y-3">
      <h2 id="pin-h" className="text-2xl font-bold text-zinc-900">
        {picked.name} — ใส่ PIN 4 หลัก
      </h2>
      <PinPad
        value={pin}
        disabled={busy || blocked}
        onChange={(v) => {
          setPin(v);
          setError(null);
          if (v.length === 4) void submit(v);
        }}
      />
      {error && (
        <p role="alert" className={`${ERR_BOX} text-center`}>
          {error}
        </p>
      )}
      {busy && <p className="text-center text-lg text-zinc-700">กำลังตรวจ…</p>}
      <BigButton type="button" tone="secondary" disabled={busy} onClick={notMe}>
        ไม่ใช่ฉัน — เลือกชื่อใหม่
      </BigButton>
    </section>
  );
}

// ---------------------------------------------------------------------------
type Ack = { holder: boolean; weight: boolean; short: boolean };
type Confirm = { kind: "holder"; text: string } | { kind: "weight"; text: string } | { kind: "short"; text: string; yes: string } | null;

function ConfirmBox({ text, onYes, onNo, busy, yes = "ยืนยัน รับงาน" }: { text: string; onYes: () => void; onNo: () => void; busy: boolean; yes?: string }) {
  return (
    <div role="alertdialog" aria-label="ยืนยันก่อนรับงาน" className="space-y-3 rounded-xl border-2 border-amber-400 bg-amber-50 p-4">
      <p className="text-xl font-semibold text-amber-950">{text}</p>
      <BigButton type="button" onClick={onYes} loading={busy}>
        {yes}
      </BigButton>
      <BigButton type="button" tone="secondary" onClick={onNo} disabled={busy}>
        กลับไปแก้
      </BigButton>
    </div>
  );
}

/** ข้อมูลขั้นที่จะทำ: ใบเดี่ยว = actionStage ของ view (เดิม) · หลายส่วน = my_actions (ส่วนที่เลือก) */
function stageOf(view: WorkerView, action: WorkerAction | undefined) {
  if (action) return { seq: action.stageSeq, code: action.stageCode, name: action.stageName, weightRequired: action.weightRequired, scrapQtyAsk: action.scrapQtyAsk, scrapWeightAsk: action.scrapWeightAsk };
  return view.actionStage!;
}

export function ReceivePanel({
  token,
  view,
  onDone,
  onReload,
  action,
  embedded = false,
}: {
  token: string;
  view: WorkerView;
  onDone: (msg: string, tone?: DoneTone) => void;
  onReload: () => void;
  /** 0181: ส่วนที่จะรับ (จาก my_actions) — ไม่รู้จำนวนที่ส่งมา = หน้าจอ/การเรียกเดิม (ปุ่ม "รับงาน") */
  action?: WorkerAction;
  /** อยู่ในการ์ดของ MultiPanel (หัวการ์ดมีเลขและชื่อขั้นแล้ว): ไม่แสดง h2 */
  embedded?: boolean;
}) {
  const st = stageOf(view, action);
  const me = view.viewer?.displayName ?? "";
  const expected = action?.qtyExpected ?? null;
  // v2 (ux-worker-send-receive-v2 §5): เลขตัดสินใจตัวเดียว = ได้รับกี่ชิ้น · แถบ ได้รับ/ขาด · ชิป "ครบ N" · ขาด → ConfirmBox (ส่วนต่างรอผู้ส่งชี้แจง · มติ Q5)
  // ≥ 2 ชิ้น = ตัวเพิ่ม/ลด (ค่าเริ่ม = ที่ส่งมา · ขั้นต่ำ 1) · 1 ชิ้น = ตัวเลขอ่านอย่างเดียว · ไม่รู้จำนวน (view เก่า) = ไม่แสดงการ์ด
  const showQty = action !== undefined && expected !== null;
  const canShort = showQty && (expected as number) >= 2;
  const [w, setW] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [errCode, setErrCode] = useState<string | null>(null);
  const [wErr, setWErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [ack, setAck] = useState<Ack>({ holder: false, weight: false, short: false });
  const [qtyText, setQtyText] = useState(expected !== null ? String(expected) : "");
  const [qErr, setQErr] = useState<string | null>(null);
  const inflight = useRef(false);
  // 0176: ใบที่มีแบบการบันทึก = ช่องตาม flag ของขั้น · ใบเดิม (has_profile ไม่ใช่ true) = ช่องน้ำหนักเหมือนเดิมทุกประการ
  const plan = stageFieldPlan({ hasProfile: view.job.hasProfile, weightRequired: st.weightRequired, scrapQtyAsk: st.scrapQtyAsk, scrapWeightAsk: st.scrapWeightAsk });
  const showWeight = plan.showWeight;
  const noteLine = plan.receiveNote;

  const qParsed = canShort ? parseQtyText(qtyText) : null;
  const r: number | null = !showQty ? null : canShort ? (qParsed && qParsed.ok ? qParsed.value : null) : (expected as number);
  const rv = showQty ? receiveView({ expected: expected as number, r }) : null;
  const mainLabel = receiveButtonLabel(showQty ? expected : null, rv);
  const mainDisabled = rv !== null && receiveDisabled(rv.state);

  // ขั้นก่อนยังถืออยู่โดยคนอื่น (ขั้นไม่บังคับชั่ง: การรับงานจะปิดขั้นของเขาให้) → ถามก่อนเสมอ · หลายส่วน: DB กรอง prev_not_sent ให้แล้ว (held_by เป็นของใบแม่ ไม่ใช่ของส่วนนี้)
  const holderOther = !isMultiView(view) && view.heldBy !== null && view.heldBy !== me ? view.heldBy : null;

  async function go(a: Ack = ack) {
    if (busy || inflight.current) return;
    if (rv?.state === "none") return; // ขั้นก่อนเสียหมด (ส่งมา 0 ชิ้น) — ไม่เรียก server
    setWErr(null);
    setQErr(null);
    setErr(null);
    setErrCode(null);
    const parsed = parseWeight(w, "น้ำหนักเข้า");
    if (!parsed.ok) {
      setWErr(parsed.error);
      focusField("w-in");
      return;
    }
    if (st.weightRequired && parsed.value === null) {
      setWErr("ขั้นนี้ต้องชั่งน้ำหนักก่อนรับงาน");
      focusField("w-in");
      return;
    }
    // จำนวนที่ได้รับ — ตรวจรูปแบบเท่านั้น: จำนวนเต็ม 1..ที่ส่งมา · เท่าที่ส่งมา = เรียกแบบเดิม (ไม่ส่ง qtyReceived) · DB ตัดสินจริง
    let received: number | null = null;
    if (canShort) {
      const q = parseQtyText(qtyText);
      if (!q.ok) {
        setQErr(q.error);
        return;
      }
      if (q.value > (expected as number)) {
        setQErr(`รับได้ไม่เกิน ${expected} ชิ้น`);
        return;
      }
      if (q.value < (expected as number)) received = q.value;
    }
    if (holderOther && !a.holder) {
      setConfirm({ kind: "holder", text: `ขั้นก่อนยังอยู่กับ ${holderOther} — การรับงานนี้จะปิดขั้นของ ${holderOther} ให้ (ไม่มีน้ำหนักออก) ยืนยันไหม` });
      return;
    }
    const prev = view.prevWeightOutG;
    // รับไม่ครบ (received != null): จำนวนชิ้นต่างกัน น้ำหนักเทียบกับที่ขั้นก่อนส่งทั้งก้อนไม่ได้ — ข้ามเตือนน้ำหนัก (ทองไม่มี prev อยู่แล้ว · เงินใบเดี่ยวมี)
    if (received === null && parsed.value !== null && prev !== null && prev > 0 && !a.weight && Math.abs(parsed.value - prev) / prev > WEIGHT_DEVIATION_WARN) {
      const pct = Math.round((Math.abs(parsed.value - prev) / prev) * 100);
      setConfirm({ kind: "weight", text: `น้ำหนักที่ใส่ ${parsed.value} กรัม ต่างจากที่ขั้นก่อนส่งมา (${prev} กรัม) ประมาณ ${pct}% — ใส่ถูกไหม` });
      return;
    }
    if (received !== null && !a.short) {
      const gap = (expected as number) - received;
      setConfirm({ kind: "short", yes: `ถูก รับ ${received} ชิ้น`, text: `รับ ${received} จาก ${expected} ชิ้น — ขาด ${gap} ชิ้น ขั้นก่อนจะถูกถามว่าเสียหายหรือหาย ถูกไหม` });
      return;
    }
    setConfirm(null);
    inflight.current = true;
    setBusy(true);
    // หลายส่วน: ระบุส่วนเสมอ · ใบเดี่ยว: ส่ง opts เฉพาะเมื่อรับไม่ครบ (ไม่งั้นเรียกแบบเดิมเป๊ะ)
    const opts = action && isMultiView(view) ? { lotJobId: action.lotJobId, ...(received !== null ? { qtyReceived: received } : {}) } : received !== null ? { qtyReceived: received } : undefined;
    const res = await safely(() => (opts ? workerReceiveStage(token, st.seq, parsed.value === null ? null : w, opts) : workerReceiveStage(token, st.seq, parsed.value === null ? null : w)));
    setBusy(false);
    inflight.current = false;
    if (res.ok) {
      // already:true = มีคนรับไปก่อน · ถ้าเป็นชื่อเราเอง (กดซ้ำ) ถือว่าสำเร็จ · ถ้าเป็นคนอื่น = เตือนสีเหลือง ไม่ใช่เครื่องหมายถูก
      if (res.already && !(res.by && res.by === me)) onDone(res.message ?? (res.by ? `ช่าง ${res.by} รับขั้นนี้ไปแล้ว` : "มีคนรับขั้นนี้ไปแล้ว"), "warn");
      else if (res.discrepancyQty && received !== null) onDone(`รับ ${received} ชิ้นแล้ว — ขาด ${res.discrepancyQty} ชิ้น แจ้งขั้นก่อนแล้ว`, "ok");
      else onDone(showQty ? `รับงานแล้ว — ${expected} ชิ้น` : `รับงานแล้ว — ${st.name}`, "ok");
    } else {
      setErr(res.code === "prev_not_sent" ? prevNotSentMessage(prevStageName(view)) : res.error);
      setErrCode(res.code ?? null);
    }
  }

  const answer = (patch: Partial<Ack>) => {
    const next = { ...ack, ...patch };
    setAck(next);
    void go(next);
  };
  const confirmPatch = (c: NonNullable<Confirm>): Partial<Ack> => (c.kind === "holder" ? { holder: true } : c.kind === "weight" ? { weight: true } : { short: true });
  // เปลี่ยนจำนวนที่ได้รับ = ต้องยืนยันใหม่
  const resetShort = () => setAck((a) => ({ ...a, short: false }));
  const setQty = (v: string) => {
    setQtyText(v);
    setQErr(null);
    setConfirm(null);
    resetShort();
  };

  const qtyBlock =
    showQty && rv ? (
      <div className="space-y-3 rounded-2xl border border-zinc-300 p-4">
        {canShort ? (
          <>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xl font-bold text-zinc-900">ได้รับกี่ชิ้น</span>
              <QtyAllChip label={`ครบ ${expected}`} pressed={rv.state === "all"} onClick={() => setQty(String(expected))} disabled={busy} />
            </div>
            <QtyStepper id="q-recv" label="จำนวนที่ได้รับ" hideLabel size="hero" value={qtyText} onChange={setQty} max={expected as number} error={qErr ?? (rv.state === "over" ? `รับได้ไม่เกิน ${expected} ชิ้น` : null)} disabled={busy} />
            <p className="text-lg text-zinc-700">ขั้นก่อนส่งมา {expected} ชิ้น</p>
          </>
        ) : (
          <p className="text-lg font-semibold text-zinc-900">
            ได้รับ <span className="text-5xl font-extrabold tabular-nums">{expected}</span> ชิ้น
          </p>
        )}
        {canShort && (
          <>
            <QtyBar
              empty={rv.state === "empty" || rv.state === "over"}
              total={expected as number}
              label={`ขั้นก่อนส่งมา ${expected} ชิ้น ได้รับ ${rv.got} ขาด ${rv.missing}`}
              segments={[
                { key: "got", qty: rv.got, tone: "mine" },
                { key: "miss", qty: rv.missing, tone: "bad" },
              ]}
            />
            {rv.state === "all" ? (
              <p role="status" aria-live="polite" className="rounded-xl bg-amber-50 p-2 text-xl font-bold text-amber-950">
                <span aria-hidden="true" className="text-amber-700">
                  ✓
                </span>{" "}
                ครบ {expected} ชิ้น
              </p>
            ) : (
              <QtyLegend
                items={[
                  { key: "got", label: "ได้รับ", qty: rv.state === "short" ? rv.got : null, tone: "mine" },
                  { key: "miss", label: "ขาด", qty: rv.state === "short" ? rv.missing : null, tone: "bad" },
                ]}
              />
            )}
            {rv.state === "short" && <p className="text-lg text-zinc-800">ขาด {rv.missing} ชิ้น — ระบบจะถามขั้นก่อนว่าเสียหายหรือหาย</p>}
          </>
        )}
      </div>
    ) : null;

  return (
    <section aria-labelledby={embedded ? undefined : "recv-h"} aria-label={embedded ? `รับงาน: ${st.name}` : undefined} className="space-y-3">
      {!embedded && (
        <h2 id="recv-h" className="text-2xl font-bold text-zinc-900">
          {showQty ? `รับงาน: ${st.name}` : `ขั้นถัดไป: ${st.name}`}
        </h2>
      )}
      {noteLine && <p className="text-lg text-zinc-700">{noteLine}</p>}
      {rv?.state === "none" ? (
        <p role="status" className="rounded-2xl border-2 border-red-300 bg-red-50 p-4 text-xl font-bold text-red-950">
          {RECEIVE_NONE_MESSAGE}
        </p>
      ) : (
        qtyBlock
      )}
      {showWeight && rv?.state !== "none" && (
        <WeightField
          id="w-in"
          label="น้ำหนักเข้า"
          size={showQty ? "md" : "lg"}
          value={w}
          onChange={(v) => { setW(v); setWErr(null); setConfirm(null); setAck((a) => ({ ...a, weight: false })); }}
          required={st.weightRequired}
          hint={view.prevWeightOutG !== null ? `ครั้งก่อนส่งออก ${view.prevWeightOutG} กรัม` : null}
          error={wErr}
        />
      )}
      {err && <ActionError message={err} code={errCode} onReload={onReload} busy={busy} />}
      {rv?.state === "none" ? null : confirm ? (
        <ConfirmBox text={confirm.text} yes={confirm.kind === "short" ? confirm.yes : undefined} busy={busy} onYes={() => answer(confirmPatch(confirm))} onNo={() => setConfirm(null)} />
      ) : (
        <StickyAction>
          <BigButton type="button" onClick={() => void go()} loading={busy} disabled={mainDisabled}>
            {mainLabel}
          </BigButton>
        </StickyAction>
      )}
    </section>
  );
}

/** โฟกัส + เลื่อนมาช่องที่ผิด (ปุ่มหลักติดล่างทำให้ข้อความใต้ช่องหลุดจอได้) */
export function focusField(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.focus();
  el.scrollIntoView?.({ block: "center" });
}

// ---------------------------------------------------------------------------
export interface SplitResultInfo {
  lot: NonNullable<Extract<WorkerActionResult, { ok: true }>["lot"]>;
  /** ส่วนที่ผู้ส่งถืออยู่ (เพื่อบอกว่า "เหลือกับคุณ" คือส่วนไหน) */
  fromLotJobId: string | null;
  /** v2: ของเสียที่ผู้ส่งแจ้งในครั้งนี้ + ชื่อขั้นถัดไป (ไม่รู้ = null) — ให้จอหลังส่งวาดแถบเดิม */
  scrap: number;
  nextName: string | null;
}

/** แถวของเสียที่พับ (v2 §4.3): ไม่แย่งสายตา · เปิดค้างเมื่อ > 0 (เหตุผลบังคับต้องเห็น) · ปิดได้เมื่อ 0 */
function ScrapRow({
  asks,
  scrap,
  open,
  onOpen,
  onClose,
  onQty,
  reason,
  onReason,
  reasons,
  error,
  disabled,
}: {
  asks: boolean;
  scrap: number;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onQty: (n: number) => void;
  reason: string | null;
  onReason: (r: string) => void;
  reasons: string[];
  error: string | null;
  disabled: boolean;
}) {
  if (!(open || scrap > 0)) {
    return (
      <button type="button" disabled={disabled} className="flex min-h-14 w-full items-center justify-between gap-2 rounded-xl border-2 border-dashed border-zinc-400 px-4 text-lg font-semibold text-zinc-800 disabled:opacity-50" onClick={onOpen}>
        {asks ? (
          <>
            <span>
              ของเสียขั้นนี้ · <strong>ไม่มี</strong>
            </span>
            <span>+ แจ้ง</span>
          </>
        ) : (
          <span>+ แจ้งของเสียในขั้นนี้</span>
        )}
      </button>
    );
  }
  return (
    <div className="space-y-2 rounded-xl border-2 border-zinc-300 p-3">
      <ScrapStepper compact qty={scrap} onQty={onQty} reason={reason} onReason={onReason} reasons={reasons} error={error} />
      {scrap === 0 && (
        <button type="button" disabled={disabled} className="min-h-12 w-full rounded-xl border-2 border-zinc-400 bg-white text-lg font-semibold text-zinc-900 disabled:opacity-50" onClick={onClose}>
          เก็บแถวของเสีย
        </button>
      )}
    </div>
  );
}

export function SendPanel({
  token,
  view,
  onDone,
  onReload,
  action,
  onSplit,
  embedded = false,
}: {
  token: string;
  view: WorkerView;
  onDone: (msg: string, tone?: DoneTone) => void;
  onReload: () => void;
  /** 0181: ส่วนที่ถืออยู่ (จาก my_actions) — มีจำนวนที่ถือ = จอส่ง v2 (การ์ดตัดสินใจ + แถบ) · ไม่ส่ง (view เก่า) = หน้าจอ/การเรียกเดิม */
  action?: WorkerAction;
  /** ส่งไม่หมด → แยกส่วนสำเร็จ: ให้ผู้เรียกแสดงจอหลังส่ง (QR ใบเดิม + ยกเลิกการส่ง) */
  onSplit?: (r: SplitResultInfo) => void;
  /** อยู่ในการ์ดของ MultiPanel (หัวการ์ดมีเลขจำนวนและชื่อขั้นแล้ว): ไม่แสดง h2 / "ในมือฉัน" */
  embedded?: boolean;
}) {
  const st = stageOf(view, action);
  const multi = isMultiView(view);
  const next = view.job.stages.find((s) => s.seq > st.seq && s.status === "pending");
  const hold = action?.qtyHold ?? null;
  // 🔴 มติเจ้าของ 19 ต.ค. (H2): งานทองที่ขั้นสั่งชั่ง — แยกส่วนต้องชั่ง "ส่วนที่แยกออก" (เงิน/ขั้นไม่ชั่ง = นับจำนวนอย่างเดียว ไม่มีช่อง)
  // ไม่โชว์น้ำหนักขั้นก่อน/น้ำหนักที่ถือ (N1: ทองชั่งแบบไม่รู้คำตอบ) · แถบมีแต่จำนวนชิ้น · ส่งทั้งหมด = ชั่งน้ำหนักออกตามปกติ ห้ามส่ง weightMoveG
  const goldWeigh = view.job.metal === "gold" && st.weightRequired;
  // จอส่ง v2 (ux-worker-send-receive-v2 §4): รู้จำนวนที่ถือ = การ์ดตัดสินใจ (เลขตัวเดียว + แถบ ส่งไป/เหลือกับฉัน) เสมอ
  const showQty = action !== undefined && hold !== null;
  const canSplit = showQty && (hold as number) >= 2;
  const [w, setW] = useState("");
  const [scrap, setScrap] = useState(0);
  const [reason, setReason] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [added, setAdded] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [errCode, setErrCode] = useState<string | null>(null);
  const [wErr, setWErr] = useState<string | null>(null);
  const [sErr, setSErr] = useState<string | null>(null);
  // null = ส่งหมด (ถือ − เสีย · ตามสด) · มีค่า = ช่างพิมพ์/กด ± เอง
  const [qtyText, setQtyText] = useState<string | null>(null);
  const [moveW, setMoveW] = useState("");
  const [mErr, setMErr] = useState<string | null>(null);
  const inflight = useRef(false);
  const [scrapOpen, setScrapOpen] = useState(false); // ขั้นที่ไม่ถามชิ้นเสีย: เปิดเองได้ด้วยแถว "+ แจ้งของเสียในขั้นนี้"
  const [scrapW, setScrapW] = useState("");
  const [swErr, setSwErr] = useState<string | null>(null);

  // สูตรอยู่ lib/jobs/qty-split.ts (pure + test): ส่งหมด = ถือ − เสีย (DB หักเสียเอง → ไม่ส่ง qtySend) · น้อยกว่า = แยกส่วน · มากกว่า = ปิดปุ่ม
  const holdN = hold ?? 0;
  const allCount = Math.max(0, holdN - scrap);
  const qtyParsed = canSplit && qtyText !== null ? parseQtyText(qtyText) : null;
  const n: number | null = !showQty ? null : !canSplit || qtyText === null ? allCount : qtyParsed && qtyParsed.ok ? qtyParsed.value : null;
  const v = splitView({ hold: holdN, scrap, n });
  const partial = showQty && v.state === "partial";
  // ขั้นที่ "ถามชิ้นเสีย" ตามแบบ (ไม่นับที่ช่างเปิดเอง) — ใช้เลือกข้อความแถวของเสีย
  const asksScrap = stageFieldPlan({ hasProfile: view.job.hasProfile, weightRequired: st.weightRequired, scrapQtyAsk: st.scrapQtyAsk, scrapWeightAsk: st.scrapWeightAsk }).showScrapStepper;
  const plan = stageFieldPlan({ hasProfile: view.job.hasProfile, weightRequired: st.weightRequired, scrapQtyAsk: st.scrapQtyAsk, scrapWeightAsk: st.scrapWeightAsk, scrapOpen: scrapOpen || partial });
  // แยกส่วนนับจำนวนอย่างเดียว (มติ ค1): ไม่ถามน้ำหนัก/เติมโลหะ/เศษ · ของเสียเปิดได้เสมอ (ชิ้นที่หายต้องมีที่ลง)
  const showWeight = plan.showWeight && !partial;
  const askScrapWeight = plan.showScrapWeight && !partial;
  const showAdd = plan.showAddMetal && !partial;
  const noteLine = partial ? null : plan.sendNote;

  function changeScrap(raw: number) {
    // เพดานของเสีย = จำนวนที่ถือ (ถึงเท่าที่ถือได้ → ขึ้นข้อความ "เสียหมดทั้ง N ชิ้น — แจ้งออฟฟิศ") · ไม่ลดเพดานลงเหลือ ถือ − 1
    const c = showQty ? Math.min(raw, holdN) : raw;
    setScrap(c);
    setSErr(null);
    if (c === 0) setReason(null);
    // เพิ่มเสียจน n เกินที่ส่งได้ → ลด n ลงให้เอง (ช่างไม่ได้ผิด) · ลดเสีย n ไม่ขยับเอง (ยกเว้นโหมดส่งหมดที่ตามสดอยู่แล้ว)
    if (showQty) setQtyText((t) => clampSendText(t, holdN, c));
  }

  async function go() {
    if (busy || inflight.current) return;
    setErr(null);
    setErrCode(null);
    setWErr(null);
    setSErr(null);
    setSwErr(null);
    setMErr(null);
    if (showQty && sendDisabled(v.state)) return; // ปุ่มปิดอยู่แล้ว (ว่าง/เกิน) — กันไว้ซ้ำ
    const out = parseWeight(showWeight ? w : "", "น้ำหนักออก");
    if (!out.ok) {
      setWErr(out.error);
      focusField("w-out");
      return;
    }
    if (!partial && st.weightRequired && out.value === null) {
      setWErr("ขั้นนี้ต้องชั่งน้ำหนักออกก่อนส่งต่อ");
      focusField("w-out");
      return;
    }
    if (scrap > 0 && !reason) {
      setSErr("เลือกเหตุผลของเสีย");
      return;
    }
    const sw = parseWeight(askScrapWeight ? scrapW : "", "น้ำหนักเศษโลหะ");
    if (!sw.ok) {
      setSwErr(sw.error);
      return;
    }
    // ทองที่ขั้นชั่ง + แยกส่วน: ต้องชั่งส่วนที่แยกออก (> 0 · ทศนิยม ≤ 3 · "1,5" = 1.5 ผ่าน parseWeight ชุดเดียวกับ server) — DB ตรวจซ้ำ (weight_move_required / weight_over)
    if (partial && goldWeigh) {
      const mv = parseWeight(moveW, "น้ำหนักส่วนที่ส่ง");
      if (!mv.ok) {
        setMErr(mv.error);
        focusField("w-move");
        return;
      }
      if (mv.value === null || mv.value <= 0) {
        setMErr("ต้องชั่งน้ำหนักส่วนที่ส่งก่อน (ใส่ตัวเลขมากกว่า 0)");
        focusField("w-move");
        return;
      }
    }
    inflight.current = true;
    setBusy(true);
    const r = await safely(() =>
      workerSendStage(token, {
        expectedSeq: st.seq,
        weightOut: out.value === null ? null : w,
        qtyScrap: scrap,
        scrapReason: scrap > 0 ? reason : null,
        metalAdded: showAdd && addOpen && added.trim() !== "" ? added : null,
        ...(askScrapWeight && sw.value !== null ? { scrapWeight: scrapW } : {}),
        // 0181: ส่วนที่ถือ (หลายส่วน) + จำนวนที่ถืออยู่ที่เห็นบนจอ (กันกดซ้ำ/2 มือถือ → stage_changed) — ส่งทุกครั้งที่รู้จำนวนที่ถือ
        ...(action && multi ? { lotJobId: action.lotJobId } : {}),
        ...(showQty ? { qtyHold: holdN } : {}),
        // ส่งไม่หมด = qtySend (p_qty_send) · ส่งหมด = ไม่ส่ง qtySend (DB ใช้ทางเดิม job_core_send)
        ...(partial && n !== null ? { qtySend: n } : {}),
        // น้ำหนักส่วนที่แยกออก: เฉพาะทอง + ขั้นชั่ง + แยกส่วน (ส่งทั้งหมด/เงิน = ไม่ส่ง → DB จะตอบ weight_unexpected ถ้าส่งผิดที่)
        ...(partial && goldWeigh ? { weightMoveG: moveW } : {}),
      })
    );
    setBusy(false);
    inflight.current = false;
    if (r.ok) {
      const nextName = next && !multi ? next.name : null;
      if (r.lot && onSplit) onSplit({ lot: r.lot, fromLotJobId: action?.lotJobId ?? null, scrap, nextName });
      else if (r.already) onDone(r.message ?? "ส่งขั้นนี้ไปแล้ว", "ok");
      else if (showQty) onDone(nextName ? `ส่งแล้ว ${v.send} ชิ้น — ถัดไป ${nextName}` : `ส่งแล้ว ${v.send} ชิ้น`, "ok");
      else onDone(next && !multi ? `ส่งต่อแล้ว — ถัดไป ${next.name}` : "ส่งต่อแล้ว", "ok");
    } else {
      setErr(r.error);
      setErrCode(r.code ?? null);
    }
  }

  // ---------------- จอส่ง v2 (รู้จำนวนที่ถือ) ----------------
  if (showQty) {
    const label = sendButtonLabel({ ...v, hold: holdN });
    const legend = [
      { key: "sent", label: "ส่งไป", qty: v.state === "empty" || v.state === "over" ? null : v.send, tone: "sent" as const },
      { key: "mine", label: "เหลือกับฉัน", qty: v.state === "empty" || v.state === "over" ? null : v.keep, tone: "mine" as const },
      ...(scrap > 0 ? [{ key: "bad", label: "เสีย", qty: scrap, tone: "bad" as const }] : []),
    ];
    return (
      <section aria-labelledby={embedded ? undefined : "send-h"} aria-label={embedded ? `ส่งงาน: ${st.name}` : undefined} className="space-y-3">
        {!embedded && (
          <div>
            <h2 id="send-h" className="text-2xl font-bold text-zinc-900">
              ส่งงาน: {st.name}
            </h2>
            {next && !multi && <p className="text-lg text-zinc-700">ถัดไป: {next.name}</p>}
          </div>
        )}
        {noteLine && <p className="text-lg text-zinc-700">{noteLine}</p>}
        <div className="space-y-3 rounded-2xl border border-zinc-300 p-4">
          {canSplit ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xl font-bold text-zinc-900">ส่งกี่ชิ้น</span>
                <QtyAllChip label={`ส่งหมด ${allCount}`} pressed={qtyText === null || v.state === "all"} onClick={() => setQtyText(null)} disabled={busy || allCount === 0} />
              </div>
              <QtyStepper
                id="q-send"
                label="จำนวนที่ส่ง"
                hideLabel
                size="hero"
                value={qtyText ?? String(allCount)}
                onChange={(t) => setQtyText(t)}
                max={allCount}
                error={v.state === "over" ? `ส่งได้ไม่เกิน ${allCount} ชิ้น` : qtyParsed && !qtyParsed.ok && qtyText !== "" ? qtyParsed.error : null}
                disabled={busy || allCount === 0}
              />
              {!embedded && <p className="text-lg text-zinc-700">ในมือฉัน {holdN} ชิ้น</p>}
            </>
          ) : (
            <p className="text-lg font-semibold text-zinc-900">
              ส่ง <span className="text-5xl font-extrabold tabular-nums">{holdN}</span> ชิ้น
            </p>
          )}
          {canSplit && (
            <>
              <QtyBar
                empty={v.state === "empty" || v.state === "over"}
                total={holdN}
                label={`ในมือ ${holdN} ชิ้น ส่งไป ${v.send} เหลือกับฉัน ${v.keep}${scrap > 0 ? ` เสีย ${scrap}` : ""}`}
                segments={[
                  { key: "sent", qty: v.send, tone: "sent" },
                  { key: "mine", qty: v.keep, tone: "mine" },
                  { key: "bad", qty: scrap, tone: "bad" },
                ]}
              />
              <QtyLegend items={legend} />
              {v.keep > 0 && <p className="text-lg text-zinc-800">ที่เหลือส่งทีหลังได้</p>}
              {partial && !goldWeigh && <p className="text-lg text-zinc-700">ส่งบางส่วนนับจำนวนอย่างเดียว ไม่ต้องชั่ง</p>}
            </>
          )}
          {v.state === "scrapAll" && (
            <p role="status" className="rounded-xl border-2 border-red-300 bg-red-50 p-3 text-lg font-bold text-red-950">
              ขั้นถัดไปรับงานที่ไม่มีชิ้นไม่ได้ — ให้ออฟฟิศเป็นคนปิดใบ
            </p>
          )}
        </div>
        {partial && goldWeigh && (
          <WeightField id="w-move" size="md" label={`น้ำหนัก ${n} ชิ้นที่ส่ง`} value={moveW} onChange={(t) => { setMoveW(t); setMErr(null); }} required hint={`ชั่งเฉพาะ ${n} ชิ้นที่ส่ง ไม่ต้องชั่งที่เหลือ`} error={mErr} />
        )}
        {showWeight && <WeightField id="w-out" size="md" label="น้ำหนักออก" value={w} onChange={(t) => { setW(t); setWErr(null); }} required={st.weightRequired} error={wErr} />}
        <ScrapRow
          asks={asksScrap}
          scrap={scrap}
          open={scrapOpen}
          onOpen={() => setScrapOpen(true)}
          onClose={() => setScrapOpen(false)}
          onQty={changeScrap}
          reason={reason}
          onReason={(rr) => { setReason(rr); setSErr(null); }}
          reasons={view.scrapReasons}
          error={sErr}
          disabled={busy}
        />
        {askScrapWeight && <WeightField id="w-scrap" size="md" label="เศษโลหะ" value={scrapW} onChange={(t) => { setScrapW(t); setSwErr(null); }} required={false} hint="เศษ/ก้านต้นที่เก็บได้ ไม่ใช่น้ำหนักงาน" error={swErr} />}
        {showAdd &&
          (!addOpen ? (
            <button type="button" className="min-h-14 w-full rounded-xl border-2 border-dashed border-zinc-400 text-lg font-semibold text-zinc-800" onClick={() => setAddOpen(true)}>
              + เติมโลหะ
            </button>
          ) : (
            <WeightField id="w-add" size="md" label="เติมโลหะ" value={added} onChange={setAdded} required={false} hint="ใส่เฉพาะถ้าเติมโลหะเพิ่มระหว่างขั้นนี้" />
          ))}
        {err && <ActionError message={err} code={errCode} onReload={onReload} busy={busy} />}
        <StickyAction>
          <BigButton type="button" onClick={() => void go()} loading={busy} disabled={sendDisabled(v.state)}>
            {label}
          </BigButton>
        </StickyAction>
      </section>
    );
  }

  // ---------------- ไม่รู้จำนวนที่ถือ (view เก่า): หน้าจอ/การเรียกเดิมทุกประการ ----------------
  return (
    <section aria-labelledby="send-h" className="space-y-3">
      <h2 id="send-h" className="text-2xl font-bold text-zinc-900">
        ส่งต่อ: {st.name}
      </h2>
      {plan.sendNote && <p className="text-lg text-zinc-700">{plan.sendNote}</p>}
      {showWeight && <WeightField id="w-out" label="น้ำหนักออก" value={w} onChange={(t) => { setW(t); setWErr(null); }} required={st.weightRequired} error={wErr} />}
      {plan.showScrapStepper ? (
        <ScrapStepper qty={scrap} onQty={changeScrap} reason={reason} onReason={(rr) => { setReason(rr); setSErr(null); }} reasons={view.scrapReasons} error={sErr} />
      ) : (
        <button type="button" className="min-h-14 w-full rounded-xl border-2 border-dashed border-zinc-400 text-lg font-semibold text-zinc-800" onClick={() => setScrapOpen(true)}>
          + แจ้งของเสียในขั้นนี้
        </button>
      )}
      {askScrapWeight && <WeightField id="w-scrap" label="เศษโลหะ" value={scrapW} onChange={(t) => { setScrapW(t); setSwErr(null); }} required={false} hint="เศษ/ก้านต้นที่เก็บได้ ไม่ใช่น้ำหนักงาน" error={swErr} />}
      {showAdd &&
        (!addOpen ? (
          <button type="button" className="min-h-14 w-full rounded-xl border-2 border-dashed border-zinc-400 text-lg font-semibold text-zinc-800" onClick={() => setAddOpen(true)}>
            + เติมโลหะ
          </button>
        ) : (
          <WeightField id="w-add" label="เติมโลหะ" value={added} onChange={setAdded} required={false} hint="ใส่เฉพาะถ้าเติมโลหะเพิ่มระหว่างขั้นนี้" />
        ))}
      {err && <ActionError message={err} code={errCode} onReload={onReload} busy={busy} />}
      <StickyAction>
        <BigButton type="button" onClick={() => void go()} loading={busy}>
          {next && !multi ? `ส่งต่อ → ${next.name}` : "ส่งต่อ"}
        </BigButton>
      </StickyAction>
    </section>
  );
}
