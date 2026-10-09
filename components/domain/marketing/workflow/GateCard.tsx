"use client";

// GateCard — ด่านตรวจ 3 ด่าน (ข้อเท็จจริง · กฎแบรนด์ · ความเสี่ยง) ของหน้าชิ้นงาน (§2.4 ตาราง "GateCard — พฤติกรรม")
//
// - แก้ได้เฉพาะ drafting/in_review (editable) · หลังอนุมัติเป็นอ่านอย่างเดียว + ป้าย "ล็อกหลังอนุมัติ"
// - content_gate_record เขียนทับ detail ทั้งก้อน → ที่นี่ส่ง "ทั้งชุด" เสมอ (sources / flagged / rules_hit) ผ่าน recordGate
// - risk_owner: คำถามเดิมของ AI อ่านจาก DB ฝั่ง server (ไม่ส่งจาก client) · ไม่ส่ง actor_role
// - ผ่านด่านข้อเท็จจริงโดยไม่มีแหล่ง: ข้อความจาก DB/pre-check แสดงใต้ปุ่ม (ไม่ใช่ toast ที่หาย)
// - ลิงก์ภายนอกทุกตัว rel="noopener noreferrer" และไม่ fetch ปลายทาง

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { GateBadge } from "@/components/domain/marketing/workflow/badges";
import { ReasonField } from "@/components/domain/marketing/workflow/ReasonField";
import { recordGate } from "@/lib/actions/content-pieces";
import { safeHttpUrl } from "@/lib/marketing/safe-url";
import { useSyncedDraft } from "@/components/domain/marketing/workflow/useSyncedDraft";
import { GATE_KIND_LABEL } from "@/lib/marketing/piece-labels";
import type { GateKind } from "@/lib/marketing/piece-labels";
import type { PieceGate } from "@/lib/marketing/piece-types";

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function SourceLink({ url }: { url: string }) {
  // security L1: ไม่ใช่ http/https = ไม่เป็นลิงก์ (แสดงเป็นข้อความธรรมดา)
  const safe = safeHttpUrl(url);
  if (!safe) return <span className="inline-flex min-h-11 items-center break-all text-sm text-zinc-700">{url} (ลิงก์ไม่ปลอดภัย — ไม่เปิดให้กด)</span>;
  return (
    <a
      href={safe}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-11 min-w-0 items-center gap-1 break-all text-sm text-primary-700 underline underline-offset-2"
    >
      <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0">{hostOf(url)}</span>
      <span className="sr-only"> ({url})</span>
    </a>
  );
}

interface GateCardProps {
  stepId: string;
  kind: GateKind;
  gate: PieceGate | null;
  /** drafting / in_review เท่านั้น */
  editable: boolean;
  /** ชิ้นอยู่ approved/produced/posted → ป้าย "ล็อกหลังอนุมัติ" */
  lockedAfterApproval: boolean;
  /** risk_owner → "ต้องแก้ข้อความ" เปิดโหมดแก้ในหน้าชิ้นงาน */
  onRequestEdit?: () => void;
}

export function GateCard(props: GateCardProps) {
  const { kind, gate } = props;
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="rounded-lg border border-zinc-200 bg-white p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={headingId} className="text-sm font-semibold text-zinc-900">
          {GATE_KIND_LABEL[kind]}
        </h3>
        <GateBadge status={gate?.status ?? null} />
      </div>
      {props.lockedAfterApproval && <p className="mt-1 text-xs text-zinc-600">ล็อกหลังอนุมัติ — ส่งกลับก่อนถ้าต้องแก้</p>}
      {kind === "fact_check" && <FactBody {...props} />}
      {kind === "brand_rule" && <BrandBody {...props} />}
      {kind === "risk_owner" && <RiskBody {...props} />}
    </section>
  );
}

// ---------------------------------------------------------------------------
// ตัวช่วยร่วม: เรียก recordGate + แจ้งผล + refresh
// ---------------------------------------------------------------------------

function useGateSubmit(stepId: string) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(input: Parameters<typeof recordGate>[1], okMessage: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await recordGate(stepId, input);
      if (!res.ok) {
        setError(res.error);
        if (res.stale) router.refresh();
        return false;
      }
      toast.push(okMessage);
      router.refresh();
      return true;
    } catch {
      setError("บันทึกผลตรวจไม่สำเร็จ ลองใหม่อีกครั้ง");
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, setError, submit };
}

function ErrorLine({ id, message }: { id?: string; message: string | null }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-sm font-medium text-red-800">
      {message}
    </p>
  );
}

// ---------------------------------------------------------------------------
// ข้อเท็จจริง
// ---------------------------------------------------------------------------

function FactBody({ stepId, gate, editable }: GateCardProps) {
  const sources = strList(gate?.detail?.sources);
  const flagged = strList(gate?.detail?.flagged);
  const stale = strList(gate?.detail?.stale_sources);
  const status = gate?.status ?? "pending";
  const { busy, error, setError, submit } = useGateSubmit(stepId);
  const [url, setUrl] = useState("");
  const [blocking, setBlocking] = useState(false);
  const [note, setNote] = useState("");
  const urlId = useId();
  const errId = useId();

  async function addSource() {
    const next = url.trim();
    if (!next) {
      setError("วางลิงก์แหล่งอ้างอิงก่อน");
      return;
    }
    // คงสถานะเดิม (ถ้าเคยผ่านแล้ว เพิ่มแหล่งไม่ทำให้หลุดผ่าน)
    const keep = status === "passed" || status === "blocked" ? status : "pending";
    const ok = await submit(
      { gateKind: "fact_check", status: keep, sources: [...sources, next], flagged, note: gate?.note ?? null }, // คง note เดิม (RPC เขียนทับ detail/note ทั้งก้อน)
      "เพิ่มแหล่งอ้างอิงแล้ว"
    );
    if (ok) setUrl("");
  }

  async function removeSource(target: string) {
    const rest = sources.filter((s) => s !== target);
    // ผ่านแล้วแต่ลบแหล่งจนหมด → ผ่านต่อไม่ได้ ต้องลดเป็นรอตรวจ
    const keep = status === "passed" && rest.length === 0 ? "pending" : status === "passed" || status === "blocked" ? status : "pending";
    await submit({ gateKind: "fact_check", status: keep, sources: rest, flagged, note: gate?.note ?? null }, "ลบแหล่งอ้างอิงแล้ว");
  }

  return (
    <div className="mt-2 space-y-3">
      <div>
        <p className="text-xs font-medium text-zinc-700">แหล่งอ้างอิง ({sources.length})</p>
        {sources.length === 0 ? (
          <p className="text-sm text-zinc-600">ยังไม่มีแหล่งอ้างอิง — ผ่านด่านนี้ได้ต้องมีลิงก์อย่างน้อย 1 ลิงก์</p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {sources.map((s) => (
              <li key={s} className="flex items-center justify-between gap-2">
                <SourceLink url={s} />
                {editable && (
                  <Button type="button" variant="ghost" size="sm" className="max-md:min-h-11" disabled={busy} onClick={() => void removeSource(s)}>
                    ลบ
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {flagged.length > 0 && (
        <div>
          <p className="text-xs font-medium text-red-800">รายการที่ติด</p>
          <ul className="list-disc pl-5 text-sm text-zinc-800">
            {flagged.map((f) => (
              <li key={f} className="break-words">
                {f}
              </li>
            ))}
          </ul>
        </div>
      )}
      {gate?.note && status === "blocked" && <p className="break-words text-sm text-zinc-800">หมายเหตุ: {gate.note}</p>}

      {stale.length > 0 && (
        <details className="rounded-md border border-zinc-200 bg-zinc-50 p-2">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-zinc-700">
            แหล่งของเนื้อหาเวอร์ชันเก่า ({stale.length})
          </summary>
          <p className="text-xs text-zinc-600">เป็นประวัติเท่านั้น — ใช้ติ๊กผ่านซ้ำไม่ได้ เพราะเนื้อหาเปลี่ยนไปแล้ว</p>
          <ul className="mt-1">
            {stale.map((s) => (
              <li key={s}>
                <SourceLink url={s} />
              </li>
            ))}
          </ul>
        </details>
      )}

      {editable && (
        <div className="space-y-2">
          <div className="space-y-1">
            <label htmlFor={urlId} className="block text-sm font-medium text-zinc-800">
              เพิ่มลิงก์แหล่งอ้างอิง
            </label>
            <div className="flex gap-2">
              <input
                id={urlId}
                type="url"
                inputMode="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="วางลิงก์แหล่งอ้างอิง"
                aria-describedby={error ? errId : undefined}
                className="min-h-11 min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-2.5 text-base focus:border-primary-600 focus:outline-none focus:ring-1 focus:ring-primary-600"
              />
              <Button type="button" variant="secondary" disabled={busy || !url.trim()} onClick={() => void addSource()}>
                เพิ่ม
              </Button>
            </div>
          </div>

          {blocking ? (
            <div className="space-y-2 rounded-md border border-red-200 bg-red-50/50 p-2.5">
              <ReasonField label="ติดตรงไหน (หมายเหตุ)" value={note} onChange={setNote} max={500} rows={2} required min={3} />
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button type="button" variant="secondary" disabled={busy} onClick={() => setBlocking(false)}>
                  ยกเลิก
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  loading={busy}
                  disabled={note.trim().length < 3 || note.length > 500}
                  onClick={async () => {
                    const ok = await submit({ gateKind: "fact_check", status: "blocked", sources, flagged, note: note.trim() }, "ทำเครื่องหมายว่าติดแล้ว");
                    if (ok) {
                      setBlocking(false);
                      setNote("");
                    }
                  }}
                >
                  ทำเครื่องหมายว่าติด
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                loading={busy}
                disabled={status === "passed"}
                onClick={() => void submit({ gateKind: "fact_check", status: "passed", sources, flagged: [] }, "ผ่านด่านข้อเท็จจริงแล้ว")}
              >
                ติ๊กผ่าน
              </Button>
              <Button type="button" variant="secondary" disabled={busy || status === "blocked"} onClick={() => setBlocking(true)}>
                ทำเครื่องหมายว่าติด…
              </Button>
            </div>
          )}
          <ErrorLine id={errId} message={error} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// กฎแบรนด์
// ---------------------------------------------------------------------------

function BrandBody({ stepId, gate, editable }: GateCardProps) {
  const rulesHit = strList(gate?.detail?.rules_hit);
  const status = gate?.status ?? "pending";
  const { busy, error, submit } = useGateSubmit(stepId);
  const [blocking, setBlocking] = useState(false);
  const [rules, setRules] = useState("");
  const [note, setNote] = useState("");

  return (
    <div className="mt-2 space-y-3">
      {rulesHit.length > 0 && (
        <div>
          <p className="text-xs font-medium text-red-800">กฎที่ชน</p>
          <ul className="list-disc pl-5 text-sm text-zinc-800">
            {rulesHit.map((r) => (
              <li key={r} className="break-words">
                {r}
              </li>
            ))}
          </ul>
        </div>
      )}
      {gate?.note && <p className="break-words text-sm text-zinc-800">หมายเหตุ: {gate.note}</p>}
      {status === "pending" && rulesHit.length === 0 && <p className="text-sm text-zinc-600">ยังไม่ได้ตรวจกฎแบรนด์ — อ่านข้อความแล้วกด “ผ่าน” หรือ “ติด”</p>}

      {editable &&
        (blocking ? (
          <div className="space-y-2 rounded-md border border-red-200 bg-red-50/50 p-2.5">
            <ReasonField label="กฎที่ชน (บรรทัดละข้อ)" value={rules} onChange={setRules} max={500} rows={3} />
            <ReasonField label="หมายเหตุ" value={note} onChange={setNote} max={500} rows={2} />
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="secondary" disabled={busy} onClick={() => setBlocking(false)}>
                ยกเลิก
              </Button>
              <Button
                type="button"
                variant="danger"
                loading={busy}
                disabled={(rules.trim().length === 0 && note.trim().length === 0) || rules.length > 500 || note.length > 500}
                onClick={async () => {
                  const ok = await submit(
                    {
                      gateKind: "brand_rule",
                      status: "blocked",
                      rulesHit: rules.split("\n").map((l) => l.trim()).filter(Boolean),
                      note: note.trim() || null,
                    },
                    "ทำเครื่องหมายว่าติดแล้ว"
                  );
                  if (ok) {
                    setBlocking(false);
                    setRules("");
                    setNote("");
                  }
                }}
              >
                ทำเครื่องหมายว่าติด
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              loading={busy}
              disabled={status === "passed"}
              onClick={() => void submit({ gateKind: "brand_rule", status: "passed", rulesHit: [] }, "ผ่านด่านกฎแบรนด์แล้ว")}
            >
              ผ่าน
            </Button>
            <Button type="button" variant="secondary" disabled={busy || status === "blocked"} onClick={() => setBlocking(true)}>
              ติด…
            </Button>
          </div>
        ))}
      <ErrorLine message={error} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// ความเสี่ยง
// ---------------------------------------------------------------------------

function RiskBody({ stepId, gate, editable, onRequestEdit }: GateCardProps) {
  const question = str(gate?.detail?.question);
  const prevAnswer = str(gate?.detail?.answer);
  const status = gate?.status ?? "pending";
  const { busy, error, submit } = useGateSubmit(stepId);
  // คำตอบตามค่าจาก server หลัง refresh (ตอบจากหน้าอื่น/แท็บอื่นแล้วไม่ค้างค่าเก่า) — เหมือนช่องแก้เนื้อหา
  const ad = useSyncedDraft(prevAnswer);
  const answer = ad.draft;
  const setAnswer = ad.setDraft;
  async function saveRisk(status: "passed" | "na", okMessage: string) {
    const ok = await submit({ gateKind: "risk_owner", status, answer: answer.trim() }, okMessage);
    if (ok) ad.markSaved(answer.trim());
  }

  return (
    <div className="mt-2 space-y-3">
      {question ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-2.5">
          <p className="text-xs font-medium text-amber-900">คำถามจาก AI</p>
          <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-zinc-900">{question}</p>
        </div>
      ) : (
        <p className="text-sm text-zinc-600">{status === "pending" ? "ยังไม่ได้ตรวจความเสี่ยง (ภาษี/สุขภาพ/การลงทุน)" : "ไม่มีคำถามค้าง"}</p>
      )}
      {prevAnswer && status !== "pending" && <p className="break-words text-sm text-zinc-800">คำตอบของคุณ: {prevAnswer}</p>}

      {editable && (
        <div className="space-y-2">
          <ReasonField
            label="คำตอบ (ไม่บังคับ)"
            value={answer}
            onChange={setAnswer}
            max={1000}
            rows={2}
            hint="ตอบสั้นๆ ว่าตรวจแล้วเป็นอย่างไร"
          />
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              loading={busy}
              disabled={status === "passed" || answer.length > 1000}
              onClick={() => void saveRisk("passed", "ผ่านด่านความเสี่ยงแล้ว")}
            >
              ใช้ได้ (ผ่านด่านนี้)
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={busy || status === "na" || answer.length > 1000}
              onClick={() => void saveRisk("na", "ทำเครื่องหมายว่าไม่เกี่ยวข้องแล้ว")}
            >
              ไม่เกี่ยวข้อง
            </Button>
            {onRequestEdit && (
              <Button type="button" variant="secondary" disabled={busy} onClick={onRequestEdit}>
                ต้องแก้ข้อความ
              </Button>
            )}
          </div>
          <p className="text-xs text-zinc-600">“ต้องแก้ข้อความ” จะพาไปโหมดแก้ — แก้เนื้อหาแล้วผลตรวจทั้ง 3 ด่านจะถูกล้าง</p>
        </div>
      )}
      <ErrorLine message={error} />
    </div>
  );
}
