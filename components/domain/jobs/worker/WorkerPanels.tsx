"use client";

// WorkerPanels — 3 หน้าจอหลักของช่าง: ระบุตัว (ชื่อ + PIN) · รับงาน · ส่งต่อ
// ทุกปุ่มกันกดซ้ำ (busy) · error ใต้ช่อง/ปุ่ม เป็นไทยสั้นๆ · ไม่มีช่องพิมพ์ข้อความ · ผลสำเร็จเรียก onDone(ข้อความ) ให้ WorkerApp แสดงเครื่องหมายถูกเต็มจอ

import { useState } from "react";
import { workerLogin, workerReceiveStage, workerSendStage } from "@/lib/actions/job-worker";
import type { WorkerActionResult } from "@/lib/actions/job-worker";
import { BigButton, PinPad, ScrapStepper, WeightField } from "@/components/domain/jobs/worker/WorkerParts";
import { GENERIC_JOB_ERROR } from "@/lib/jobs/messages";
import type { WorkerView } from "@/lib/jobs/worker-view";

async function safely(fn: () => Promise<WorkerActionResult>): Promise<WorkerActionResult> {
  try {
    return await fn();
  } catch {
    return { ok: false, error: GENERIC_JOB_ERROR };
  }
}

// ---------------------------------------------------------------------------
export function IdentifyPanel({ token, workers, onDone }: { token: string; workers: WorkerView["workers"]; onDone: () => void }) {
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(code: string) {
    if (!picked || busy) return;
    setBusy(true);
    setError(null);
    const r = await safely(() => workerLogin(token, picked.id, code));
    setBusy(false);
    if (r.ok) {
      onDone();
      return;
    }
    setPin("");
    setError(r.error + (r.retryAfterSeconds ? ` (รอประมาณ ${Math.ceil(r.retryAfterSeconds / 60)} นาที)` : ""));
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
    <section aria-labelledby="pin-h" className="space-y-4">
      <h2 id="pin-h" className="text-2xl font-bold text-zinc-900">
        {picked.name} — ใส่ PIN 4 หลัก
      </h2>
      <PinPad
        value={pin}
        disabled={busy}
        onChange={(v) => {
          setPin(v);
          setError(null);
          if (v.length === 4) void submit(v);
        }}
      />
      {error && (
        <p role="alert" className="rounded-xl border-2 border-red-200 bg-red-50 p-3 text-center text-lg font-semibold text-red-800">
          {error}
        </p>
      )}
      {busy && <p className="text-center text-lg text-zinc-700">กำลังตรวจ…</p>}
      <BigButton type="button" tone="secondary" disabled={busy} onClick={() => { setPicked(null); setPin(""); setError(null); }}>
        ไม่ใช่ฉัน — เลือกชื่อใหม่
      </BigButton>
    </section>
  );
}

// ---------------------------------------------------------------------------
export function ReceivePanel({ token, view, onDone }: { token: string; view: WorkerView; onDone: (msg: string) => void }) {
  const st = view.actionStage!;
  const [w, setW] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [wErr, setWErr] = useState<string | null>(null);

  async function go() {
    if (busy) return;
    setWErr(null);
    setErr(null);
    if (st.weightRequired && w.trim() === "") {
      setWErr("ขั้นนี้ต้องชั่งน้ำหนักก่อนรับงาน");
      return;
    }
    setBusy(true);
    const r = await safely(() => workerReceiveStage(token, st.seq, w.trim() === "" ? null : w));
    setBusy(false);
    if (r.ok) onDone(r.already ? (r.message ?? "มีคนรับขั้นนี้ไปแล้ว") : `รับงานแล้ว — ${st.name}`);
    else setErr(r.error);
  }

  return (
    <section aria-labelledby="recv-h" className="space-y-4">
      <h2 id="recv-h" className="text-2xl font-bold text-zinc-900">
        ขั้นถัดไป: {st.name}
      </h2>
      <WeightField
        id="w-in"
        label="น้ำหนักเข้า"
        value={w}
        onChange={(v) => { setW(v); setWErr(null); }}
        required={st.weightRequired}
        hint={view.prevWeightOutG !== null ? `ครั้งก่อนส่งออก ${view.prevWeightOutG} กรัม` : null}
        error={wErr}
      />
      {err && (
        <p role="alert" className="rounded-xl border-2 border-red-200 bg-red-50 p-3 text-lg font-semibold text-red-800">
          {err}
        </p>
      )}
      <BigButton type="button" onClick={() => void go()} loading={busy}>
        รับงาน
      </BigButton>
    </section>
  );
}

// ---------------------------------------------------------------------------
export function SendPanel({ token, view, onDone }: { token: string; view: WorkerView; onDone: (msg: string) => void }) {
  const st = view.actionStage!;
  const next = view.job.stages.find((s) => s.seq > st.seq && s.status === "pending");
  const [w, setW] = useState("");
  const [scrap, setScrap] = useState(0);
  const [reason, setReason] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [added, setAdded] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [wErr, setWErr] = useState<string | null>(null);
  const [sErr, setSErr] = useState<string | null>(null);

  async function go() {
    if (busy) return;
    setErr(null);
    setWErr(null);
    setSErr(null);
    if (st.weightRequired && w.trim() === "") {
      setWErr("ขั้นนี้ต้องชั่งน้ำหนักออกก่อนส่งต่อ");
      return;
    }
    if (scrap > 0 && !reason) {
      setSErr("เลือกเหตุผลของเสีย");
      return;
    }
    setBusy(true);
    const r = await safely(() =>
      workerSendStage(token, { expectedSeq: st.seq, weightOut: w.trim() === "" ? null : w, qtyScrap: scrap, scrapReason: scrap > 0 ? reason : null, metalAdded: addOpen && added.trim() !== "" ? added : null })
    );
    setBusy(false);
    if (r.ok) onDone(r.already ? (r.message ?? "ส่งขั้นนี้ไปแล้ว") : next ? `ส่งต่อแล้ว — ถัดไป ${next.name}` : "ส่งต่อแล้ว");
    else setErr(r.error);
  }

  return (
    <section aria-labelledby="send-h" className="space-y-5">
      <h2 id="send-h" className="text-2xl font-bold text-zinc-900">
        ส่งต่อ: {st.name}
      </h2>
      <WeightField id="w-out" label="น้ำหนักออก" value={w} onChange={(v) => { setW(v); setWErr(null); }} required={st.weightRequired} error={wErr} />
      <ScrapStepper qty={scrap} onQty={(n) => { setScrap(n); setSErr(null); if (n === 0) setReason(null); }} reason={reason} onReason={(r) => { setReason(r); setSErr(null); }} reasons={view.scrapReasons} error={sErr} />
      {!addOpen ? (
        <button type="button" className="min-h-14 w-full rounded-xl border-2 border-dashed border-zinc-400 text-lg font-semibold text-zinc-800" onClick={() => setAddOpen(true)}>
          + เติมโลหะ
        </button>
      ) : (
        <WeightField id="w-add" label="เติมโลหะ" value={added} onChange={setAdded} required={false} hint="ใส่เฉพาะถ้าเติมโลหะเพิ่มระหว่างขั้นนี้" />
      )}
      {err && (
        <p role="alert" className="rounded-xl border-2 border-red-200 bg-red-50 p-3 text-lg font-semibold text-red-800">
          {err}
        </p>
      )}
      <BigButton type="button" onClick={() => void go()} loading={busy}>
        {next ? `ส่งต่อ → ${next.name}` : "ส่งต่อ"}
      </BigButton>
    </section>
  );
}
