"use client";

// ConfirmItemList — รายการ [ต้องยืนยัน] ของชิ้นงาน: คำถาม + ช่องคำตอบ + "บันทึกคำตอบ" → resolveConfirm (แทน marker ในข้อความจริง)
// UI ห้ามแต่งคำตอบแทนเจ้าของ — ช่องว่างเสมอ placeholder เป็นคำอธิบายช่อง (ไม่ใช่ตัวอย่างคำตอบที่ดูจริง)
// ปุ่มอนุมัติอยู่ที่ PieceActionBar และ enabled ⇔ can_approve จาก DB เท่านั้น — ที่นี่แค่ช่วยให้ตอบครบ

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { ReasonField } from "@/components/domain/marketing/workflow/ReasonField";
import { resolveConfirm } from "@/lib/actions/content-pieces";
import type { ConfirmItem } from "@/lib/marketing/piece-types";

function ConfirmItemRow({ stepId, item, editable }: { stepId: string; item: ConfirmItem; editable: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await resolveConfirm(stepId, item.id, answer);
      if (!res.ok) {
        setError(res.error);
        if (res.stale) router.refresh();
        return;
      }
      toast.push(res.data.remaining > 0 ? `บันทึกคำตอบแล้ว · เหลืออีก ${res.data.remaining} ข้อ` : "ตอบครบทุกข้อแล้ว");
      router.refresh();
    } catch {
      setError("บันทึกคำตอบไม่สำเร็จ ลองใหม่อีกครั้ง");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-md border border-amber-200 bg-amber-50/60 p-2.5">
      <p className="text-sm font-medium text-zinc-900">
        <span className="mr-1 inline-block rounded-sm bg-amber-100 px-1 text-xs font-semibold text-amber-900 ring-1 ring-amber-500">ต้องยืนยัน</span>
        <span className="break-words">{item.question}</span>
      </p>
      {editable ? (
        <div className="mt-2 space-y-2">
          <ReasonField
            label="คำตอบของคุณ"
            value={answer}
            onChange={setAnswer}
            max={1000}
            rows={2}
            error={error}
            hint="คำตอบจะถูกใส่แทนข้อความ [ต้องยืนยัน] ในเนื้อหาจริง"
          />
          <Button type="button" loading={busy} disabled={answer.trim().length === 0 || answer.length > 1000} onClick={() => void save()}>
            บันทึกคำตอบ
          </Button>
        </div>
      ) : (
        <p className="mt-1 text-sm text-zinc-700">ยังไม่ได้ตอบ — แก้ได้เฉพาะตอน “AI ร่าง” หรือ “รอตรวจ”</p>
      )}
    </li>
  );
}

export function ConfirmItemList({
  stepId,
  items,
  editable,
  markerInText,
}: {
  stepId: string;
  items: ConfirmItem[];
  editable: boolean;
  /** v_content_piece.confirm_marker_in_text — มี [ต้องยืนยัน ค้างในข้อความ (DB เป็นผู้ตัดสิน) */
  markerInText: boolean;
}) {
  const pending = items.filter((i) => !i.resolvedAt);
  const done = items.filter((i) => i.resolvedAt);

  if (items.length === 0 && !markerInText) return null;

  return (
    <section aria-label="ข้อที่ต้องยืนยัน" className="rounded-lg border border-zinc-200 bg-white p-3.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-900">ข้อที่ต้องยืนยัน</h3>
        <span className={`text-sm font-medium tabular-nums ${pending.length > 0 ? "text-amber-900" : "text-green-800"}`}>
          {pending.length > 0 ? `เหลือ ${pending.length} ข้อ` : "ตอบครบแล้ว"}
        </span>
      </div>

      {pending.length > 0 && (
        <ul className="mt-2 space-y-2">
          {pending.map((item) => (
            <ConfirmItemRow key={item.id} stepId={stepId} item={item} editable={editable} />
          ))}
        </ul>
      )}

      {pending.length === 0 && markerInText && (
        <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900">
          ยังมี [ต้องยืนยัน] ค้างอยู่ในข้อความของชิ้นงาน (อาจอยู่ใน hook หรือเนื้อหา) — ตอบ/แก้ข้อความให้หมดก่อนอนุมัติ
        </p>
      )}

      {done.length > 0 && (
        <details className="mt-2">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-zinc-700">ตอบแล้ว ({done.length})</summary>
          <ul className="space-y-1.5">
            {done.map((i) => (
              <li key={i.id} className="rounded-md bg-zinc-50 p-2 text-sm">
                <p className="flex items-start gap-1.5 text-zinc-800">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-700" aria-hidden="true" />
                  <span className="min-w-0 break-words">{i.question}</span>
                </p>
                {i.answer && <p className="mt-0.5 break-words pl-5 text-zinc-700">คำตอบ: {i.answer}</p>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
