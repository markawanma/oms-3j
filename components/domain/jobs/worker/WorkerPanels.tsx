"use client";

// WorkerPanels — 3 หน้าจอหลักของช่าง: ระบุตัว (ชื่อ + PIN) · รับงาน · ส่งต่อ
// ทุกปุ่มกันกดซ้ำ (busy) · error ใต้ช่อง/ปุ่ม เป็นไทยสั้นๆ · ไม่มีช่องพิมพ์ข้อความ · ผลสำเร็จเรียก onDone(ข้อความ, tone) ให้ WorkerApp แสดงเครื่องหมายถูก/เตือนเต็มจอ
// ตรวจรูปแบบน้ำหนักฝั่งช่างก่อนส่ง (parseWeight ชุดเดียวกับ server) — "95,5" = 95.5, "1,234.5" = กำกวม ปฏิเสธ · DB ยังเป็นด่านจริง

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { workerLogin, workerReceiveStage, workerSendStage } from "@/lib/actions/job-worker";
import type { WorkerActionResult } from "@/lib/actions/job-worker";
import { BigButton, PinPad, ScrapStepper, WeightField } from "@/components/domain/jobs/worker/WorkerParts";
import { parseWeight } from "@/lib/jobs/input";
import { GENERIC_JOB_ERROR, prevNotSentMessage } from "@/lib/jobs/messages";
import { prevStageName } from "@/lib/jobs/worker-view";
import type { WorkerView } from "@/lib/jobs/worker-view";

export type DoneTone = "ok" | "warn";
/** น้ำหนักที่รับต่างจากที่ขั้นก่อนส่งเกินนี้ = ขอให้ยืนยันก่อน (เตือน ไม่บล็อก) */
export const WEIGHT_DEVIATION_WARN = 0.2;
/** code ที่ลองใหม่ด้วย PIN ไม่ได้อีกจนกว่าออฟฟิศช่วย */
const PERMANENT_BLOCK = new Set(["locked_office", "token_budget_exhausted", "invalid_token"]);
/** การล็อกที่ผูกกับ "ใบ/QR" ไม่ใช่ตัวช่าง — เปลี่ยนชื่อแล้วก็ยังใช้ไม่ได้ · ที่เหลือ (locked, locked_office) ล็อกรายช่าง: เปลี่ยนคนแล้วแป้นต้องกลับมากดได้ */
const TOKEN_WIDE_BLOCK = new Set(["token_budget_exhausted", "invalid_token"]);
/** code ที่แปลว่า "ข้อมูลบนจอเก่าแล้ว" — แก้ได้ด้วยการโหลดใหม่ (ช่างไม่ต้องรู้ว่า "รีเฟรช" คืออะไร) */
const RELOAD_CODES = new Set(["stage_changed", "out_of_order", "not_holder", "not_received", "already_sent", "weight_required"]);

async function safely(fn: () => Promise<WorkerActionResult>): Promise<WorkerActionResult> {
  try {
    return await fn();
  } catch {
    return { ok: false, error: GENERIC_JOB_ERROR };
  }
}

/** ปุ่มหลักติดล่างจอ (N2): จอ 390x740 ที่ส่งต่อ+ของเสีย+เหตุผลยาวเกินจอ ปุ่มต้องยังกดได้โดยไม่ต้องเลื่อนหา — sticky ตามหน้าต่าง ไม่ใช่ fixed (ไม่บังเนื้อหาท้ายหน้า) */
function StickyAction({ children }: { children: ReactNode }) {
  return <div className="sticky bottom-0 z-10 -mx-4 border-t border-zinc-200 bg-white/95 px-4 pt-2 pb-3 backdrop-blur">{children}</div>;
}

const ERR_BOX = "rounded-xl border-2 border-red-200 bg-red-50 p-3 text-lg font-semibold text-red-800";

/** ข้อผิดพลาดใต้ฟอร์ม · ถ้าเป็น code "ข้อมูลเก่า" แสดงปุ่ม "โหลดใหม่" ต่อท้าย (ช่างไม่มีปุ่มรีเฟรชของเบราว์เซอร์ให้ใช้) */
function ActionError({ message, code, onReload, busy = false }: { message: string; code: string | null; onReload: () => void; busy?: boolean }) {
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
type Ack = { holder: boolean; weight: boolean };
type Confirm = { kind: "holder"; text: string } | { kind: "weight"; text: string } | null;

function ConfirmBox({ text, onYes, onNo, busy }: { text: string; onYes: () => void; onNo: () => void; busy: boolean }) {
  return (
    <div role="alertdialog" aria-label="ยืนยันก่อนรับงาน" className="space-y-3 rounded-xl border-2 border-amber-400 bg-amber-50 p-4">
      <p className="text-xl font-semibold text-amber-950">{text}</p>
      <BigButton type="button" onClick={onYes} loading={busy}>
        ยืนยัน รับงาน
      </BigButton>
      <BigButton type="button" tone="secondary" onClick={onNo} disabled={busy}>
        กลับไปแก้
      </BigButton>
    </div>
  );
}

export function ReceivePanel({ token, view, onDone, onReload }: { token: string; view: WorkerView; onDone: (msg: string, tone?: DoneTone) => void; onReload: () => void }) {
  const st = view.actionStage!;
  const me = view.viewer?.displayName ?? "";
  const [w, setW] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [errCode, setErrCode] = useState<string | null>(null);
  const [wErr, setWErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [ack, setAck] = useState<Ack>({ holder: false, weight: false });
  // 0176: ใบที่มีแบบการบันทึก = ช่องตาม flag ของขั้น · ใบเดิม (has_profile ไม่ใช่ true) = ช่องน้ำหนักเหมือนเดิมทุกประการ
  const legacy = view.job.hasProfile !== true;
  const showWeight = legacy || st.weightRequired;
  const noteLine = legacy ? null : !st.weightRequired && st.scrapQtyAsk === false && st.scrapWeightAsk !== true ? "ขั้นนี้ไม่ต้องบันทึกอะไร — กดรับงานได้เลย" : !st.weightRequired ? "ขั้นนี้ไม่ต้องชั่งน้ำหนัก" : null;

  // ขั้นก่อนยังถืออยู่โดยคนอื่น (ขั้นไม่บังคับชั่ง: การรับงานจะปิดขั้นของเขาให้) → ถามก่อนเสมอ
  const holderOther = view.heldBy !== null && view.heldBy !== me ? view.heldBy : null;

  async function go(a: Ack = ack) {
    if (busy) return;
    setWErr(null);
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
    if (holderOther && !a.holder) {
      setConfirm({ kind: "holder", text: `ขั้นก่อนยังอยู่กับ ${holderOther} — การรับงานนี้จะปิดขั้นของ ${holderOther} ให้ (ไม่มีน้ำหนักออก) ยืนยันไหม` });
      return;
    }
    const prev = view.prevWeightOutG;
    if (parsed.value !== null && prev !== null && prev > 0 && !a.weight && Math.abs(parsed.value - prev) / prev > WEIGHT_DEVIATION_WARN) {
      const pct = Math.round((Math.abs(parsed.value - prev) / prev) * 100);
      setConfirm({ kind: "weight", text: `น้ำหนักที่ใส่ ${parsed.value} กรัม ต่างจากที่ขั้นก่อนส่งมา (${prev} กรัม) ประมาณ ${pct}% — ใส่ถูกไหม` });
      return;
    }
    setConfirm(null);
    setBusy(true);
    const r = await safely(() => workerReceiveStage(token, st.seq, parsed.value === null ? null : w));
    setBusy(false);
    if (r.ok) {
      // already:true = มีคนรับไปก่อน · ถ้าเป็นชื่อเราเอง (กดซ้ำ) ถือว่าสำเร็จ · ถ้าเป็นคนอื่น = เตือนสีเหลือง ไม่ใช่เครื่องหมายถูก
      if (r.already && !(r.by && r.by === me)) onDone(r.message ?? (r.by ? `ช่าง ${r.by} รับขั้นนี้ไปแล้ว` : "มีคนรับขั้นนี้ไปแล้ว"), "warn");
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
      {err && <ActionError message={err} code={errCode} onReload={onReload} busy={busy} />}
      {confirm ? (
        <ConfirmBox text={confirm.text} busy={busy} onYes={() => answer(confirm.kind === "holder" ? { holder: true } : { weight: true })} onNo={() => setConfirm(null)} />
      ) : (
        <StickyAction>
          <BigButton type="button" onClick={() => void go()} loading={busy}>
            รับงาน
          </BigButton>
        </StickyAction>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
export function SendPanel({ token, view, onDone, onReload }: { token: string; view: WorkerView; onDone: (msg: string, tone?: DoneTone) => void; onReload: () => void }) {
  const st = view.actionStage!;
  const next = view.job.stages.find((s) => s.seq > st.seq && s.status === "pending");
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
  // 0176: ใบที่มีแบบการบันทึก = ช่อง/ปุ่มตาม flag ของขั้น · ใบเดิม = UI เดิมทุกประการ (ช่องน้ำหนัก + ชิ้นเสีย + เติมโลหะ ทุกขั้น)
  const legacy = view.job.hasProfile !== true;
  const showWeight = legacy || st.weightRequired;
  const askScrap = legacy || st.scrapQtyAsk !== false;
  const askScrapWeight = !legacy && st.scrapWeightAsk === true;
  const showAdd = legacy || st.weightRequired;
  const [scrapOpen, setScrapOpen] = useState(false); // ขั้นที่ไม่ถามชิ้นเสีย: เปิดเองได้ด้วยปุ่ม "+ แจ้งของเสียในขั้นนี้"
  const [scrapW, setScrapW] = useState("");
  const [swErr, setSwErr] = useState<string | null>(null);
  const noteLine = legacy
    ? null
    : !st.weightRequired && !askScrap && !askScrapWeight
      ? "ขั้นนี้ไม่ต้องชั่งหรือแจ้งของเสีย — กดส่งต่อได้เลย"
      : !st.weightRequired
        ? "ขั้นนี้ไม่ต้องชั่งน้ำหนัก"
        : null;

  async function go() {
    if (busy) return;
    setErr(null);
    setErrCode(null);
    setWErr(null);
    setSErr(null);
    setSwErr(null);
    const out = parseWeight(showWeight ? w : "", "น้ำหนักออก");
    if (!out.ok) {
      setWErr(out.error);
      return;
    }
    if (st.weightRequired && out.value === null) {
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
    setBusy(true);
    const r = await safely(() =>
      workerSendStage(token, {
        expectedSeq: st.seq,
        weightOut: out.value === null ? null : w,
        qtyScrap: scrap,
        scrapReason: scrap > 0 ? reason : null,
        metalAdded: showAdd && addOpen && added.trim() !== "" ? added : null,
        ...(askScrapWeight && sw.value !== null ? { scrapWeight: scrapW } : {}),
      })
    );
    setBusy(false);
    if (r.ok) onDone(r.already ? (r.message ?? "ส่งขั้นนี้ไปแล้ว") : next ? `ส่งต่อแล้ว — ถัดไป ${next.name}` : "ส่งต่อแล้ว", "ok");
    else {
      setErr(r.error);
      setErrCode(r.code ?? null);
    }
  }

  return (
    <section aria-labelledby="send-h" className="space-y-3">
      <h2 id="send-h" className="text-2xl font-bold text-zinc-900">
        ส่งต่อ: {st.name}
      </h2>
      {noteLine && <p className="text-lg text-zinc-700">{noteLine}</p>}
      {showWeight && <WeightField id="w-out" label="น้ำหนักออก" value={w} onChange={(v) => { setW(v); setWErr(null); }} required={st.weightRequired} error={wErr} />}
      {askScrap || scrapOpen ? (
        <ScrapStepper qty={scrap} onQty={(n) => { setScrap(n); setSErr(null); if (n === 0) setReason(null); }} reason={reason} onReason={(r) => { setReason(r); setSErr(null); }} reasons={view.scrapReasons} error={sErr} />
      ) : (
        <button type="button" className="min-h-14 w-full rounded-xl border-2 border-dashed border-zinc-400 text-lg font-semibold text-zinc-800" onClick={() => setScrapOpen(true)}>
          + แจ้งของเสียในขั้นนี้
        </button>
      )}
      {askScrapWeight && <WeightField id="w-scrap" label="เศษโลหะ (กรัม) — ถ้าชั่งได้" value={scrapW} onChange={(v) => { setScrapW(v); setSwErr(null); }} required={false} hint="เศษ/ก้านต้นที่เก็บได้ ไม่ใช่น้ำหนักงาน" error={swErr} />}
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
          {next ? `ส่งต่อ → ${next.name}` : "ส่งต่อ"}
        </BigButton>
      </StickyAction>
    </section>
  );
}
