"use client";

// WorkerPanels — 3 หน้าจอหลักของช่าง: ระบุตัว (ชื่อ + PIN) · รับงาน · ส่งต่อ
// ทุกปุ่มกันกดซ้ำ (busy) · error ใต้ช่อง/ปุ่ม เป็นไทยสั้นๆ · ไม่มีช่องพิมพ์ข้อความ · ผลสำเร็จเรียก onDone(ข้อความ, tone) ให้ WorkerApp แสดงเครื่องหมายถูก/เตือนเต็มจอ
// ตรวจรูปแบบน้ำหนักฝั่งช่างก่อนส่ง (parseWeight ชุดเดียวกับ server) — "95,5" = 95.5, "1,234.5" = กำกวม ปฏิเสธ · DB ยังเป็นด่านจริง

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { workerLogin, workerReceiveStage, workerSendStage } from "@/lib/actions/job-worker";
import type { WorkerActionResult } from "@/lib/actions/job-worker";
import { BigButton, PinPad, QtyStepper, ScrapStepper, WeightField } from "@/components/domain/jobs/worker/WorkerParts";
import { parseQtyText, parseWeight } from "@/lib/jobs/input";
import { GENERIC_JOB_ERROR, prevNotSentMessage } from "@/lib/jobs/messages";
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
const RELOAD_CODES = new Set(["stage_changed", "out_of_order", "not_holder", "not_received", "already_sent", "weight_required", "scrap_weight_not_asked", "invalid_part", "qty_hold_required", "weight_unexpected", "discrepancy_open"]);

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
}: {
  token: string;
  view: WorkerView;
  onDone: (msg: string, tone?: DoneTone) => void;
  onReload: () => void;
  /** 0181: ส่วนที่จะรับ (จาก my_actions) — ไม่ส่ง = ใบเดี่ยว หน้าจอ/การเรียกเดิมทุกประการ */
  action?: WorkerAction;
}) {
  const st = stageOf(view, action);
  const me = view.viewer?.displayName ?? "";
  const expected = action?.qtyExpected ?? null;
  // จำนวนรับเข้าต้องเห็นทุกครั้ง ทุกใบ (เจ้าของ UAT 19 ต.ค.): มีข้อมูลจำนวนที่ส่งมา = แสดงบล็อก "รับเข้า n จาก N ชิ้น" เสมอ
  // ≥ 2 ชิ้น = ตัวเพิ่ม/ลดค่าเริ่ม = ที่ส่งมา (น้อยกว่า = ส่วนต่างรอผู้ส่งชี้แจง · มติ Q5) · 1 ชิ้น = ตัวเลขอ่านอย่างเดียว · ไม่มีข้อมูล (view เก่า) = ไม่แสดง
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

  // ขั้นก่อนยังถืออยู่โดยคนอื่น (ขั้นไม่บังคับชั่ง: การรับงานจะปิดขั้นของเขาให้) → ถามก่อนเสมอ · หลายส่วน: DB กรอง prev_not_sent ให้แล้ว (held_by เป็นของใบแม่ ไม่ใช่ของส่วนนี้)
  const holderOther = !isMultiView(view) && view.heldBy !== null && view.heldBy !== me ? view.heldBy : null;

  async function go(a: Ack = ack) {
    if (busy || inflight.current) return;
    setWErr(null);
    setQErr(null);
    setErr(null);
    setErrCode(null);
    const parsed = parseWeight(w, "น้ำหนักเข้า");
    if (!parsed.ok) {
      setWErr(parsed.error);
      return;
    }
    if (st.weightRequired && parsed.value === null) {
      setWErr("ขั้นนี้ต้องชั่งน้ำหนักก่อนรับงาน");
      return;
    }
    // จำนวนที่รับเข้า — ตรวจรูปแบบเท่านั้น: จำนวนเต็ม 1..ที่ส่งมา · เท่าที่ส่งมา = เรียกแบบเดิม (ไม่ส่ง qtyReceived) · DB ตัดสินจริง
    let received: number | null = null;
    if (canShort) {
      const q = parseQtyText(qtyText);
      if (!q.ok) {
        setQErr(q.error);
        return;
      }
      if (q.value > (expected as number)) {
        setQErr(`รับได้ไม่เกินที่ส่งมา (${expected} ชิ้น)`);
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
      setConfirm({ kind: "short", yes: `ยืนยัน รับ ${received} ชิ้น`, text: `รับ ${received} จาก ${expected} ชิ้น — ส่วนต่าง ${gap} ชิ้น จะแจ้งกลับไปให้ขั้นก่อนชี้แจง (เสียหาย หรือ หาย)` });
      return;
    }
    setConfirm(null);
    inflight.current = true;
    setBusy(true);
    // หลายส่วน: ระบุส่วนเสมอ · ใบเดี่ยว: ส่ง opts เฉพาะเมื่อรับไม่ครบ (ไม่งั้นเรียกแบบเดิมเป๊ะ)
    const opts = action && isMultiView(view) ? { lotJobId: action.lotJobId, ...(received !== null ? { qtyReceived: received } : {}) } : received !== null ? { qtyReceived: received } : undefined;
    const r = await safely(() => (opts ? workerReceiveStage(token, st.seq, parsed.value === null ? null : w, opts) : workerReceiveStage(token, st.seq, parsed.value === null ? null : w)));
    setBusy(false);
    inflight.current = false;
    if (r.ok) {
      // already:true = มีคนรับไปก่อน · ถ้าเป็นชื่อเราเอง (กดซ้ำ) ถือว่าสำเร็จ · ถ้าเป็นคนอื่น = เตือนสีเหลือง ไม่ใช่เครื่องหมายถูก
      if (r.already && !(r.by && r.by === me)) onDone(r.message ?? (r.by ? `ช่าง ${r.by} รับขั้นนี้ไปแล้ว` : "มีคนรับขั้นนี้ไปแล้ว"), "warn");
      else if (r.discrepancyQty && received !== null) onDone(`รับ ${received} ชิ้นแล้ว — ส่วนต่าง ${r.discrepancyQty} ชิ้น แจ้งกลับขั้นก่อนแล้ว`, "ok");
      else onDone(`รับงานแล้ว — ${st.name}`, "ok");
    } else {
      setErr(r.code === "prev_not_sent" ? prevNotSentMessage(prevStageName(view)) : r.error);
      setErrCode(r.code ?? null);
    }
  }

  const answer = (patch: Partial<Ack>) => {
    const next = { ...ack, ...patch };
    setAck(next);
    void go(next);
  };
  const confirmPatch = (c: NonNullable<Confirm>): Partial<Ack> => (c.kind === "holder" ? { holder: true } : c.kind === "weight" ? { weight: true } : { short: true });
  // เปลี่ยนจำนวนที่ได้จริง = ต้องยืนยันใหม่
  const resetShort = () => setAck((a) => ({ ...a, short: false }));

  // ปุ่มหลักบอกจำนวนที่จะรับ "รับ n ชิ้น" เมื่อรู้จำนวน · ไม่รู้ = "รับงาน" (เดิม)
  const shownQty = canShort ? (parseQtyText(qtyText).ok ? Number(qtyText.trim()) : null) : expected;
  const mainLabel = showQty && shownQty !== null ? `รับ ${shownQty} ชิ้น` : "รับงาน";

  return (
    <section aria-labelledby="recv-h" className="space-y-3">
      <h2 id="recv-h" className="text-2xl font-bold text-zinc-900">
        ขั้นถัดไป: {st.name}
      </h2>
      {noteLine && <p className="text-lg text-zinc-700">{noteLine}</p>}
      {showWeight && (
        <WeightField
          id="w-in"
          label="น้ำหนักเข้า"
          value={w}
          onChange={(v) => { setW(v); setWErr(null); setConfirm(null); setAck((a) => ({ ...a, weight: false })); }}
          required={st.weightRequired}
          hint={view.prevWeightOutG !== null ? `ครั้งก่อนส่งออก ${view.prevWeightOutG} กรัม` : null}
          error={wErr}
        />
      )}
      {showQty &&
        (canShort ? (
          <div className="space-y-2 rounded-xl border border-zinc-300 p-3">
            <p className="text-lg font-semibold text-zinc-900">
              รับเข้า <span className="text-4xl font-extrabold tabular-nums">{shownQty ?? "—"}</span> จาก {expected} ชิ้น
            </p>
            <QtyStepper
              id="q-recv"
              label="จำนวนที่รับเข้า"
              value={qtyText}
              onChange={(v) => { setQtyText(v); setQErr(null); setConfirm(null); resetShort(); }}
              max={expected as number}
              hint="ได้น้อยกว่าที่ส่งมา = ลดตัวเลขลง ส่วนต่างจะแจ้งกลับไปให้ขั้นก่อนชี้แจง"
              error={qErr}
              disabled={busy}
            />
          </div>
        ) : (
          <p className="rounded-xl border border-zinc-300 p-3 text-lg font-semibold text-zinc-900">
            รับเข้า <span className="text-4xl font-extrabold tabular-nums">{expected}</span> ชิ้น
          </p>
        ))}
      {err && <ActionError message={err} code={errCode} onReload={onReload} busy={busy} />}
      {confirm ? (
        <ConfirmBox text={confirm.text} yes={confirm.kind === "short" ? confirm.yes : undefined} busy={busy} onYes={() => answer(confirmPatch(confirm))} onNo={() => setConfirm(null)} />
      ) : (
        <StickyAction>
          <BigButton type="button" onClick={() => void go()} loading={busy}>
            {mainLabel}
          </BigButton>
        </StickyAction>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
export interface SplitResultInfo {
  lot: NonNullable<Extract<WorkerActionResult, { ok: true }>["lot"]>;
  /** ส่วนที่ผู้ส่งถืออยู่ (เพื่อบอกว่า "ค้างกับคุณ" คือส่วนไหน) */
  fromLotJobId: string | null;
}

export function SendPanel({
  token,
  view,
  onDone,
  onReload,
  action,
  onSplit,
}: {
  token: string;
  view: WorkerView;
  onDone: (msg: string, tone?: DoneTone) => void;
  onReload: () => void;
  /** 0181: ส่วนที่ถืออยู่ (จาก my_actions) — มีจำนวนที่ถือ = แสดงบล็อก "ส่งต่อ n จาก N" เสมอ · ไม่ส่ง (view เก่า) = หน้าจอ/การเรียกเดิม */
  action?: WorkerAction;
  /** ส่งไม่ครบ → แยกส่วนสำเร็จ: ให้ผู้เรียกแสดงจอ "แบ่งส่วนแล้ว" (QR ใบเดิม + ยกเลิกการแยก) */
  onSplit?: (r: SplitResultInfo) => void;
}) {
  const st = stageOf(view, action);
  const next = view.job.stages.find((s) => s.seq > st.seq && s.status === "pending");
  const hold = action?.qtyHold ?? null;
  // 🔴 มติเจ้าของ 19 ต.ค. (H2): งานทองที่ขั้นสั่งชั่ง — แยกส่วนต้องชั่ง "ส่วนที่แยกออก" (เงิน/ขั้นไม่ชั่ง = นับจำนวนอย่างเดียว ไม่มีช่อง)
  // ไม่โชว์น้ำหนักขั้นก่อน/น้ำหนักที่ถือ (N1: ทองชั่งแบบไม่รู้คำตอบ) · ส่งทั้งหมด = ชั่งน้ำหนักออกตามปกติ ห้ามส่ง weightMoveG
  const goldWeigh = view.job.metal === "gold" && st.weightRequired;
  // จำนวนส่งออกต้องเห็นทุกครั้ง ทุกใบ (เจ้าของ UAT 19 ต.ค.): รู้จำนวนที่ถือ = บล็อก "ส่งต่อ n จาก N ชิ้น" + กล่องสรุป เสีย/ส่งไป/ค้างกับคุณ เสมอ
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
  // null = ส่งทั้งหมดที่ถือ (หักของเสียที่กรอก — เลขตามสด) · มีค่า = ช่างพิมพ์/กด ± เอง
  const [qtyText, setQtyText] = useState<string | null>(null);
  const [qErr, setQErr] = useState<string | null>(null);
  const [moveW, setMoveW] = useState("");
  const [mErr, setMErr] = useState<string | null>(null);
  const inflight = useRef(false);
  // 0176: ใบที่มีแบบการบันทึก = ช่อง/ปุ่มตาม flag ของขั้น · ใบเดิม = UI เดิมทุกประการ (ช่องน้ำหนัก + ชิ้นเสีย + เติมโลหะ ทุกขั้น)
  const [scrapOpen, setScrapOpen] = useState(false); // ขั้นที่ไม่ถามชิ้นเสีย: เปิดเองได้ด้วยปุ่ม "+ แจ้งของเสียในขั้นนี้"
  const [scrapW, setScrapW] = useState("");
  const [swErr, setSwErr] = useState<string | null>(null);

  // ส่งทั้งหมด = ที่ถือ − ของเสียที่กรอก (DB: job_core_send หักของเสียเอง → ไม่ส่ง qtySend) · น้อยกว่านั้น = แยกส่วน (qtySend + qtyHold) · มากกว่า = ผิด
  const allCount = hold === null ? 0 : Math.max(0, hold - scrap);
  const qtyParsed = canSplit && qtyText !== null ? parseQtyText(qtyText) : null;
  const n: number | null = !canSplit ? null : qtyText === null ? allCount : qtyParsed && qtyParsed.ok ? qtyParsed.value : null;
  const overAll = n !== null && n > allCount;
  const partial = canSplit && n !== null && n < allCount;
  const plan = stageFieldPlan({ hasProfile: view.job.hasProfile, weightRequired: st.weightRequired, scrapQtyAsk: st.scrapQtyAsk, scrapWeightAsk: st.scrapWeightAsk, scrapOpen: scrapOpen || partial });
  // แยกส่วนนับจำนวนอย่างเดียว (มติ ค1): ไม่ถามน้ำหนัก/เติมโลหะ/เศษ · ของเสียเปิดเสมอ (ชิ้นที่หายต้องมีที่ลง)
  const showWeight = plan.showWeight && !partial;
  const askScrapWeight = plan.showScrapWeight && !partial;
  const showAdd = plan.showAddMetal && !partial;
  const noteLine = partial ? (goldWeigh ? "แยกส่วนงานทอง — ชั่งเฉพาะส่วนที่ส่งออก" : "แยกส่วนนับจำนวนอย่างเดียว — ไม่ต้องชั่งน้ำหนัก") : plan.sendNote;

  async function go() {
    if (busy || inflight.current) return;
    setErr(null);
    setErrCode(null);
    setWErr(null);
    setSErr(null);
    setSwErr(null);
    setQErr(null);
    setMErr(null);
    if (canSplit && qtyText !== null) {
      if (!qtyParsed || !qtyParsed.ok) {
        setQErr(qtyParsed && !qtyParsed.ok ? qtyParsed.error : "ใส่จำนวนที่ส่ง");
        return;
      }
      if (qtyParsed.value > allCount) {
        setQErr(`ส่งได้ไม่เกิน ${allCount} ชิ้น (ถืออยู่ ${hold} − ของเสีย ${scrap})`);
        return;
      }
    }
    const out = parseWeight(showWeight ? w : "", "น้ำหนักออก");
    if (!out.ok) {
      setWErr(out.error);
      return;
    }
    if (!partial && st.weightRequired && out.value === null) {
      setWErr("ขั้นนี้ต้องชั่งน้ำหนักออกก่อนส่งต่อ");
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
        return;
      }
      if (mv.value === null || mv.value <= 0) {
        setMErr("ต้องชั่งน้ำหนักส่วนที่ส่งก่อน (ใส่ตัวเลขมากกว่า 0)");
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
        ...(action && isMultiView(view) ? { lotJobId: action.lotJobId } : {}),
        ...(showQty ? { qtyHold: hold as number } : {}),
        // ส่งไม่ครบ = qtySend (p_qty_send) · ส่งครบ = ไม่ส่ง qtySend (DB ใช้ทางเดิม job_core_send)
        ...(partial && n !== null ? { qtySend: n } : {}),
        // น้ำหนักส่วนที่แยกออก: เฉพาะทอง + ขั้นชั่ง + แยกส่วน (ส่งทั้งหมด/เงิน = ไม่ส่ง → DB จะตอบ weight_unexpected ถ้าส่งผิดที่)
        ...(partial && goldWeigh ? { weightMoveG: moveW } : {}),
      })
    );
    setBusy(false);
    inflight.current = false;
    if (r.ok) {
      if (r.lot && onSplit) onSplit({ lot: r.lot, fromLotJobId: action?.lotJobId ?? null });
      else onDone(r.already ? (r.message ?? "ส่งขั้นนี้ไปแล้ว") : next && !isMultiView(view) ? `ส่งต่อแล้ว — ถัดไป ${next.name}` : "ส่งต่อแล้ว", "ok");
    } else {
      setErr(r.error);
      setErrCode(r.code ?? null);
    }
  }

  const mainLabel = partial && n !== null ? `ส่งต่อ ${n} จาก ${hold} ชิ้น` : next && !isMultiView(view) ? `ส่งต่อ → ${next.name}` : "ส่งต่อ";
  // 3 ช่องสรุป: เสีย / ส่งไป / ค้างกับคุณ (แสดงผลสด — DB ตรวจจริง) · ส่งทั้งหมด: ส่งไป = ถือ − เสีย · ค้าง 0
  const sendNow = n === null ? 0 : n;
  const keepNow = n === null || overAll ? 0 : Math.max(0, allCount - n);

  return (
    <section aria-labelledby="send-h" className="space-y-3">
      <h2 id="send-h" className="text-2xl font-bold text-zinc-900">
        ส่งต่อ: {st.name}
      </h2>
      {noteLine && <p className="text-lg text-zinc-700">{noteLine}</p>}
      {showQty &&
        (canSplit ? (
          <div className="space-y-2 rounded-xl border border-zinc-300 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-lg font-semibold text-zinc-900">ส่งต่อกี่ชิ้น จาก {hold}</span>
              <button type="button" className="min-h-12 rounded-xl border-2 border-zinc-400 bg-white px-4 text-lg font-semibold text-zinc-900" onClick={() => { setQtyText(null); setQErr(null); }}>
                ทั้งหมด {allCount}
              </button>
            </div>
            <QtyStepper
              id="q-send"
              label="จำนวนที่ส่ง"
              value={qtyText ?? String(allCount)}
              onChange={(v) => { setQtyText(v); setQErr(null); }}
              max={allCount}
              error={qErr ?? (overAll ? `ส่งได้ไม่เกิน ${allCount} ชิ้น (ถืออยู่ ${hold} − ของเสีย ${scrap})` : null)}
              disabled={busy}
            />
            <div role="status" aria-live="polite" className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-zinc-100 p-2"><div className="text-base text-zinc-700">เสีย</div><div className="text-2xl font-bold tabular-nums">{scrap}</div></div>
              <div className="rounded-xl bg-sky-50 p-2"><div className="text-base text-sky-900">ส่งไป</div><div className="text-2xl font-bold tabular-nums">{sendNow}</div></div>
              <div className="rounded-xl bg-zinc-100 p-2"><div className="text-base text-zinc-700">ค้างกับคุณ</div><div className="text-2xl font-bold tabular-nums">{keepNow}</div></div>
            </div>
            {partial && <p className="text-lg text-zinc-800">{n} ชิ้นที่ส่งจะแยกเป็นส่วนใหม่ · QR เดิมใบเดียว</p>}
          </div>
        ) : (
          <p className="rounded-xl border border-zinc-300 p-3 text-lg font-semibold text-zinc-900">
            ส่งต่อ <span className="text-4xl font-extrabold tabular-nums">{hold}</span> ชิ้น (ถืออยู่ {hold} ชิ้น)
          </p>
        ))}
      {partial && goldWeigh && (
        <WeightField id="w-move" label="น้ำหนักส่วนที่ส่ง" value={moveW} onChange={(v) => { setMoveW(v); setMErr(null); }} required hint={`ชั่งเฉพาะ ${n} ชิ้นที่ส่งออก (ไม่ต้องชั่งส่วนที่ค้างกับคุณ)`} error={mErr} />
      )}
      {showWeight && <WeightField id="w-out" label="น้ำหนักออก" value={w} onChange={(v) => { setW(v); setWErr(null); }} required={st.weightRequired} error={wErr} />}
      {plan.showScrapStepper ? (
        <ScrapStepper qty={scrap} onQty={(c) => { setScrap(c); setSErr(null); if (c === 0) setReason(null); }} reason={reason} onReason={(r) => { setReason(r); setSErr(null); }} reasons={view.scrapReasons} error={sErr} />
      ) : (
        <button type="button" className="min-h-14 w-full rounded-xl border-2 border-dashed border-zinc-400 text-lg font-semibold text-zinc-800" onClick={() => setScrapOpen(true)}>
          + แจ้งของเสียในขั้นนี้
        </button>
      )}
      {askScrapWeight && <WeightField id="w-scrap" label="เศษโลหะ" value={scrapW} onChange={(v) => { setScrapW(v); setSwErr(null); }} required={false} hint="เศษ/ก้านต้นที่เก็บได้ ไม่ใช่น้ำหนักงาน" error={swErr} />}
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
          {mainLabel}
        </BigButton>
      </StickyAction>
    </section>
  );
}
