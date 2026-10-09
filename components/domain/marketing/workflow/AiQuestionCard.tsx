"use client";

// AiQuestionCard — คำถาม/ข้อเสนอจาก AI (กอง 4 ในหน้าแรก + หน้า /marketing/questions) §2.3
//
// แยกตาม item_kind:
//  - reco/question  : ตอบ (ข้อความ ≤1000) · ปฏิเสธ… (เหตุผล ≥3)        → recommendation_respond(done|rejected, token)
//  - reco/proposal  : ตกลงทำ (หมายเหตุไม่บังคับ) · ไม่ทำ… (เหตุผล ≥3)   → เหมือนกัน
//  - risk_gate      : ใช้ได้ (ผ่านด่านนี้) หรือไปแก้ข้อความที่ชิ้นงาน     → content_gate_record ผ่าน recordGate (คำถามเดิมอ่านจาก DB)
//  - campaign_verdict: อ่านอย่างเดียว — ยืนยันได้ที่หน้าแคมเปญ (P2) ไม่ทำปุ่มหลอก
//
// - token CAS (content_token) = ค่าที่ view ให้ตอนโหลดหน้า ส่งกลับตามที่เห็น — ไม่สร้างเอง (F4)
// - 55000 "ข้อมูลเปลี่ยน" → router.refresh() แต่คงข้อความที่พิมพ์ไว้ (การ์ดคง key เดิม state จึงอยู่)
// - ไม่มีอัปโหลดภาพ (B5): ช่องข้อความ + คำแนะนำ "วางตัวเลข/ข้อความที่อ่านได้จากภาพ"
// - เนื้อหา detail เป็นข้อความธรรมดา (ไม่ render markdown — D24) ตัดที่ 6 บรรทัดมี "ดูเพิ่ม"
// - หลังตอบสำเร็จ: ยุบเป็นบรรทัดสรุปในที่เดิม (ไม่หายทันทีจนผู้ใช้ไม่มั่นใจ) แล้วหายไปเมื่อรีเฟรชครั้งถัดไป

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Clock, MessageCircleQuestion } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { ReasonField } from "@/components/domain/marketing/workflow/ReasonField";
import { respondReco } from "@/lib/actions/content-inbox";
import { recordGate } from "@/lib/actions/content-pieces";
import { formatThaiDateTime, formatThaiDay } from "@/lib/marketing/format";
import { RECO_ACTION_LABEL, RECO_KIND_LABEL } from "@/lib/marketing/piece-labels";
import type { RecoInboxRow } from "@/lib/marketing/piece-types";

type Mode = "idle" | "answer" | "reject";

function headLabel(row: RecoInboxRow): string {
  if (row.itemKind === "risk_gate") return "ด่านความเสี่ยง";
  if (row.itemKind === "campaign_verdict") return "ยืนยันคำตัดสินแคมเปญ";
  return RECO_KIND_LABEL[row.kind ?? ""] ?? "ข้อเสนอ";
}

function Detail({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.split("\n").length > 6 || text.length > 360;
  return (
    <div>
      <p className={`whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-800 ${long && !open ? "line-clamp-6" : ""}`}>{text}</p>
      {long && (
        <button type="button" onClick={() => setOpen((o) => !o)} className="min-h-11 text-sm font-medium text-primary-700 underline underline-offset-2">
          {open ? "ย่อ" : "ดูเพิ่ม"}
        </button>
      )}
    </div>
  );
}

export function AiQuestionCard({ row }: { row: RecoInboxRow }) {
  const router = useRouter();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>("idle");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneNote, setDoneNote] = useState<string | null>(null);

  const isReco = row.itemKind === "reco";
  const isRisk = row.itemKind === "risk_gate";
  const isVerdict = row.itemKind === "campaign_verdict";
  const isProposal = isReco && row.kind === "proposal";
  const answered = row.effectiveAction === "done" || row.effectiveAction === "rejected";
  const expired = row.effectiveAction === "expired";
  const pending = row.effectiveAction === "pending";
  const canRespond = (pending || expired) && (isReco || isRisk);

  async function send(action: "done" | "rejected") {
    setBusy(true);
    setError(null);
    try {
      if (isRisk) {
        if (!row.relatedStepId) {
          setError("ไม่พบชิ้นงานของด่านนี้ — เปิดหน้าชิ้นงานเพื่อตอบ");
          return;
        }
        const res = await recordGate(row.relatedStepId, { gateKind: "risk_owner", status: "passed", answer: text });
        if (!res.ok) {
          setError(res.error);
          if (res.stale) router.refresh();
          return;
        }
        setDoneNote("ผ่านด่านความเสี่ยงแล้ว");
      } else {
        const res = await respondReco({ recoId: row.itemId, action, response: text, token: row.contentToken });
        if (!res.ok) {
          setError(res.error);
          if (res.stale) router.refresh(); // โหลดใหม่ แต่คงข้อความที่พิมพ์ไว้ (state ของการ์ดอยู่)
          return;
        }
        setDoneNote(action === "done" ? (isProposal ? "ตกลงทำแล้ว" : "ตอบแล้ว") : "ปฏิเสธแล้ว");
      }
      toast.push("บันทึกแล้ว");
      setMode("idle");
    } catch {
      setError("ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง");
    } finally {
      setBusy(false);
    }
  }

  // ---- ตอบสำเร็จ: ยุบเป็นบรรทัดสรุป ----
  if (doneNote) {
    return (
      <li className="rounded-lg border border-green-200 bg-green-50 p-3.5">
        <p className="flex items-start gap-2 text-sm font-medium text-green-900">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 break-words">
            {doneNote} · {row.title}
          </span>
        </p>
      </li>
    );
  }

  const defaultLine =
    row.respondBy && row.defaultAction && pending
      ? `ถ้าไม่ตอบภายใน ${formatThaiDay(row.respondBy)} → ${row.defaultAction}${
          row.daysLeft !== null ? (row.daysLeft > 0 ? ` (เหลือ ${row.daysLeft} วัน)` : row.daysLeft === 0 ? " (วันนี้เป็นวันสุดท้าย)" : "") : ""
        }`
      : null;

  return (
    <li className="rounded-lg border border-zinc-200 bg-white p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="blue">
          <MessageCircleQuestion className="h-3.5 w-3.5" aria-hidden="true" />
          {headLabel(row)}
        </Badge>
        {row.effortMinutesEst !== null && <span className="text-xs text-zinc-600 tabular-nums">ใช้เวลา ~{row.effortMinutesEst} นาที</span>}
        {expired && <Badge tone="slate">หมดเวลา{row.defaultAction ? ` · ใช้ค่าเริ่มต้น: ${row.defaultAction}` : ""}</Badge>}
        {answered && <Badge tone="slate">{RECO_ACTION_LABEL[row.effectiveAction] ?? "ตอบแล้ว"}</Badge>}
        {row.isLate && <Badge tone="amber">ตอบช้ากว่ากำหนด</Badge>}
      </div>

      <p className="mt-2 break-words text-base font-semibold text-zinc-900">{row.title}</p>
      {row.detail && <div className="mt-1"><Detail text={row.detail} /></div>}

      {defaultLine && (
        <p className="mt-2 flex items-start gap-1.5 rounded-md bg-amber-50 p-2 text-sm text-amber-900">
          <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 break-words">{defaultLine}</span>
        </p>
      )}

      {answered && (
        <div className="mt-2 space-y-0.5 text-sm text-zinc-700">
          {row.ownerResponse && <p className="whitespace-pre-wrap break-words">คำตอบ: {row.ownerResponse}</p>}
          {row.actedAt && <p className="text-xs text-zinc-600">เมื่อ {formatThaiDateTime(row.actedAt)}</p>}
        </div>
      )}

      {isVerdict && (
        <p className="mt-2 rounded-md bg-zinc-50 p-2.5 text-sm text-zinc-700">ยืนยันได้ในหน้าแคมเปญ — เปิดใช้เร็วๆ นี้ (ต้องใช้บทเรียนและข้อมูลล่าสุดของแคมเปญประกอบ)</p>
      )}

      {canRespond && (
        <div className="mt-3 space-y-2">
          {mode === "idle" && (
            <div className="flex flex-col gap-2 sm:flex-row">
              {isRisk ? (
                <>
                  <Button type="button" onClick={() => setMode("answer")} className="sm:flex-1">
                    ใช้ได้ (ผ่านด่านนี้)
                  </Button>
                  {row.relatedStepId && (
                    <Link
                      href={`/marketing/pieces/${row.relatedStepId}?from=questions`}
                      className="inline-flex min-h-11 items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-base font-medium text-zinc-700 hover:bg-zinc-50 sm:flex-1"
                    >
                      ไปแก้ข้อความที่ชิ้นงาน
                    </Link>
                  )}
                </>
              ) : (
                <>
                  <Button type="button" onClick={() => setMode("answer")} className="sm:flex-1">
                    {expired ? "ตอบย้อนหลัง" : isProposal ? "ตกลงทำ" : "ตอบ"}
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => setMode("reject")} className="sm:flex-1">
                    {isProposal ? "ไม่ทำ…" : "ปฏิเสธ…"}
                  </Button>
                </>
              )}
            </div>
          )}

          {mode !== "idle" && (
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                void send(mode === "reject" ? "rejected" : "done");
              }}
            >
              <ReasonField
                label={mode === "reject" ? "เหตุผลที่ปฏิเสธ" : isRisk ? "คำตอบ (ไม่บังคับ)" : isProposal ? "หมายเหตุ (ไม่บังคับ)" : "คำตอบของคุณ"}
                value={text}
                onChange={setText}
                max={1000}
                min={mode === "reject" ? 3 : 0}
                required={mode === "reject"}
                rows={3}
                error={error}
                hint={mode === "answer" && !isRisk ? "วางตัวเลข/ข้อความที่อ่านได้จากภาพ — ยังแนบภาพตรงๆ ไม่ได้" : undefined}
                autoFocus
              />
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    setMode("idle");
                    setError(null);
                  }}
                >
                  ยกเลิก
                </Button>
                <Button
                  type="submit"
                  loading={busy}
                  variant={mode === "reject" ? "danger" : "primary"}
                  disabled={mode === "reject" ? text.trim().length < 3 : isReco && !isProposal && text.trim().length === 0}
                >
                  {mode === "reject" ? (isProposal ? "ยืนยันไม่ทำ" : "ยืนยันปฏิเสธ") : isRisk ? "ผ่านด่านนี้" : isProposal ? "ยืนยันตกลงทำ" : "ส่งคำตอบ"}
                </Button>
              </div>
            </form>
          )}
        </div>
      )}
    </li>
  );
}
