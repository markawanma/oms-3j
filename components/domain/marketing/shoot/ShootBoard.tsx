"use client";

// ShootBoard — รอบถ่ายสัปดาห์: หัวสรุป · กลุ่มตามสถานที่ · "ถ่ายครบแล้ว = ผลิตแล้ว" · จบรอบถ่าย (แผน §4 P1b ข้อ 3)
// จบรอบ = finishShootRound (ทีละชิ้น) · ชิ้นที่ติ๊ก "ถ่ายครบ" แต่ยังมีช็อตไม่ติ๊ก → กล่องยืนยันก่อน (3.8) · ล้มรายชิ้นแสดงรายชิ้น ไม่ย้อนชิ้นที่สำเร็จ
// state ติ๊กช็อต = local ทับค่า server (ไม่ใช่ global store) · พิมพ์ = window.print() (ซ่อนปุ่มด้วย print:hidden)

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { CopyButton } from "@/components/domain/marketing/workflow/CopyButton";
import { ShootPieceCard } from "@/components/domain/marketing/shoot/ShootPieceCard";
import { finishShootRound } from "@/lib/actions/content-shoot";
import type { ShootFinishResult } from "@/lib/actions/content-shoot";
import { GENERIC_ACTION_ERROR } from "@/components/domain/marketing/workflow/useRunAction";
import { doneKey, groupByLocation, locationLabel, needsShotConfirm, remainingShots, summarize } from "@/lib/marketing/shoot";
import type { DoneMap, ShootItem } from "@/lib/marketing/shoot";
import type { ContentTypeOption } from "@/lib/marketing/piece-types";

const FIELD =
  "min-h-11 w-full rounded-md border border-zinc-300 bg-white px-2.5 text-base text-zinc-900 focus:border-primary-600 focus:outline-none focus:ring-1 focus:ring-primary-600";

export function ShootBoard({ items, contentTypes, todayTh, shareUrlPath }: { items: ShootItem[]; contentTypes: ContentTypeOption[]; todayTh: string; shareUrlPath: string }) {
  const router = useRouter();
  const toast = useToast();
  const [local, setLocal] = useState<DoneMap>({});
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [folder, setFolder] = useState("");
  const [confirm, setConfirm] = useState<{ stepId: string; title: string; remaining: number }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ title: string; error: string }[]>([]);
  const [warnings, setWarnings] = useState<{ title: string; warning: string }[]>([]);

  const groups = useMemo(() => groupByLocation(items), [items]);
  // ชิ้นที่ติ๊ก "ถ่ายครบ" แต่ไม่อยู่ในรายการปัจจุบันแล้ว (refresh/สลับสัปดาห์/ชิ้นเปลี่ยนสถานะ) ไม่นับและไม่ส่ง
  const liveCompleted = useMemo(() => new Set(items.map((i) => i.piece.stepId).filter((id) => completed.has(id))), [items, completed]);
  const total = summarize(items, local);
  const typeOf = (code: string | null) => (code ? contentTypes.find((t) => t.code === code) : undefined);

  function onLocal(stepId: string, shotId: string, done: boolean | undefined) {
    setLocal((m) => {
      const k = doneKey(stepId, shotId);
      const next = { ...m };
      if (done === undefined) delete next[k];
      else next[k] = done;
      return next;
    });
  }

  function toggleCompleted(stepId: string, on: boolean) {
    setCompleted((s) => {
      const n = new Set(s);
      if (on) n.add(stepId);
      else n.delete(stepId);
      return n;
    });
  }

  function requestFinish() {
    setError(null);
    setFailed([]);
    setWarnings([]);
    if (liveCompleted.size === 0) {
      setError("ติ๊ก “ถ่ายครบ” อย่างน้อยหนึ่งชิ้นก่อนจบรอบ");
      return;
    }
    const unfinished = needsShotConfirm(items, liveCompleted, local);
    if (unfinished.length > 0) setConfirm(unfinished);
    else void finish();
  }

  async function finish() {
    setConfirm(null);
    setBusy(true);
    setError(null);
    try {
      const res = await finishShootRound({ stepIds: [...liveCompleted], note, folderUrl: folder });
      if (!res.ok) {
        setError(res.error);
        if (res.stale) router.refresh();
        return;
      }
      const r: ShootFinishResult = res.data;
      const bad = r.results.filter((x) => !x.ok);
      const titleOf = (id: string) => items.find((i) => i.piece.stepId === id)?.piece.title ?? "ชิ้นงาน";
      setFailed(bad.map((b) => ({ title: titleOf(b.stepId), error: b.error ?? GENERIC_ACTION_ERROR })));
      setWarnings(r.results.filter((x) => x.ok && x.warning).map((x) => ({ title: titleOf(x.stepId), warning: x.warning as string })));
      const okIds = r.results.filter((x) => x.ok).map((x) => x.stepId);
      if (okIds.length > 0) {
        toast.push(`จบรอบถ่าย ${okIds.length} ชิ้น — เปลี่ยนเป็น “ผลิตแล้ว”`);
        setCompleted((s) => new Set([...s].filter((id) => !okIds.includes(id))));
        // หมายเหตุ/ลิงก์ถูกใช้กับชิ้นที่สำเร็จไปแล้ว — ล้างช่อง กันกดจบรอบซ้ำแล้วต่อท้ายซ้ำ
        setNote("");
        setFolder("");
        router.refresh();
      }
    } catch {
      setError(GENERIC_ACTION_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <section aria-label="สรุปรอบถ่าย" className="rounded-lg border border-zinc-200 bg-white p-3">
        <p className="text-base font-semibold text-zinc-900 tabular-nums">
          {total.pieces} ชิ้น · {total.shots} ช็อต
          {total.minutes !== null ? ` · ประเมิน ${total.minutes} นาที` : " · ยังไม่ระบุเวลาประเมิน"}
          {total.minutes !== null && total.unknownMinutesPieces > 0 ? ` (${total.unknownMinutesPieces} ชิ้นยังไม่ระบุ)` : ""}
        </p>
        <p className="text-sm text-zinc-700 tabular-nums" role="status">
          ติ๊กแล้ว {total.shotsDone}/{total.shots} ช็อต
        </p>
        <div className="mt-2 flex flex-wrap gap-2 print:hidden">
          <Button type="button" variant="secondary" onClick={() => window.print()}>
            <Printer className="h-4 w-4" aria-hidden="true" />
            พิมพ์
          </Button>
          <CopyButton text={typeof window === "undefined" ? shareUrlPath : `${window.location.origin}${shareUrlPath}`} label="คัดลอกลิงก์หน้านี้" />
        </div>
      </section>

      {groups.map((g) => {
        const s = summarize(g.items, local);
        return (
          <section key={g.key} aria-labelledby={`loc-${g.key}`} className="space-y-2">
            <h3 id={`loc-${g.key}`} className="text-base font-bold text-zinc-900 tabular-nums">
              {locationLabel(g.key)}{" "}
              <span className="text-sm font-medium text-zinc-700">
                {s.shotsDone}/{s.shots} ช็อต{s.minutes !== null ? ` · ≈${s.minutes} นาที` : ""}
              </span>
            </h3>
            <ul className="space-y-2">
              {g.items.map((it) => (
                <ShootPieceCard key={it.piece.stepId} item={it} contentType={typeOf(it.piece.contentTypeCode)} local={local} onLocal={onLocal} todayTh={todayTh} />
              ))}
            </ul>
          </section>
        );
      })}

      <section aria-labelledby="wrap-h" className="space-y-3 rounded-lg border border-zinc-200 bg-white p-3 print:hidden">
        <h3 id="wrap-h" className="text-base font-bold text-zinc-900">
          ถ่ายครบแล้ว = ผลิตแล้ว
        </h3>
        <ul className="space-y-1">
          {items.map((it) => {
            const left = remainingShots(it, local);
            const id = `done-${it.piece.stepId}`;
            return (
              <li key={it.piece.stepId}>
                <label htmlFor={id} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md px-1 py-2 hover:bg-zinc-50">
                  <input id={id} type="checkbox" checked={completed.has(it.piece.stepId)} onChange={(e) => toggleCompleted(it.piece.stepId, e.target.checked)} className="mt-0.5 h-6 w-6 shrink-0 accent-green-700" />
                  <span className="min-w-0 text-sm text-zinc-900">
                    <span className="font-medium break-words">{it.piece.title}</span>
                    {left > 0 && <span className="ml-1 text-amber-900">· เหลือ {left} ช็อต</span>}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        <div>
          <label htmlFor="shoot-folder" className="mb-1 block text-sm font-medium text-zinc-800">
            ลิงก์โฟลเดอร์ไฟล์ (ไม่บังคับ · ใช้กับทุกชิ้นที่ติ๊ก)
          </label>
          <input id="shoot-folder" type="url" inputMode="url" value={folder} onChange={(e) => setFolder(e.target.value)} maxLength={500} placeholder="วางลิงก์ที่ขึ้นต้นด้วย https://" className={FIELD} />
        </div>
        <div>
          <label htmlFor="shoot-note" className="mb-1 block text-sm font-medium text-zinc-800">
            ต่างจาก storyboard ตรงไหน (ไม่บังคับ · ต่อท้ายหมายเหตุเดิมของทุกชิ้นที่ติ๊ก)
          </label>
          <textarea id="shoot-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={3} className={`${FIELD} py-2`} />
        </div>
        {error && (
          <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-2.5 text-sm font-medium text-red-800">
            {error}
          </p>
        )}
        {warnings.length > 0 && (
          <div role="status" className="rounded-md border border-amber-200 bg-amber-50 p-2.5 text-sm text-amber-900">
            <p className="font-semibold">เปลี่ยนเป็นผลิตแล้ว แต่หมายเหตุมีข้อสังเกต:</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {warnings.map((w) => (
                <li key={w.title + w.warning}>
                  {w.title} — {w.warning}
                </li>
              ))}
            </ul>
          </div>
        )}
        {failed.length > 0 && (
          <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-2.5 text-sm text-red-900">
            <p className="font-semibold">บางชิ้นยังไม่เปลี่ยนเป็นผลิตแล้ว (ชิ้นอื่นสำเร็จแล้ว):</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {failed.map((f) => (
                <li key={f.title + f.error}>
                  {f.title} — {f.error}
                </li>
              ))}
            </ul>
          </div>
        )}
        <Button type="button" onClick={requestFinish} loading={busy} disabled={busy}>
          จบรอบถ่าย ({liveCompleted.size} ชิ้น)
        </Button>
      </section>

      <Modal open={confirm !== null} onClose={() => setConfirm(null)} title="ยังเหลือช็อตที่ไม่ได้ติ๊ก">
        <div className="space-y-3">
          <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-900">
            {confirm?.map((c) => (
              <li key={c.stepId}>
                {c.title} — ยังเหลือ {c.remaining} ช็อต
              </li>
            ))}
          </ul>
          <p className="text-sm text-zinc-800">ยืนยันว่าถ่ายครบแล้ว และเปลี่ยนเป็น “ผลิตแล้ว”?</p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={() => setConfirm(null)}>
              กลับไปติ๊กช็อต
            </Button>
            <Button type="button" onClick={() => void finish()}>
              ยืนยัน ถ่ายครบแล้ว
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
