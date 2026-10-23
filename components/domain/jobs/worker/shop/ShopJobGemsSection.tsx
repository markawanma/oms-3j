"use client";

// ShopJobGemsSection — ส่วน "พลอย" ของจอ "แก้ JB-xxxx" (W-10 · UX §4.4) · อยู่บนส่วนรูป (ของ W2)
//  แก้ได้เฉพาะใบที่ตัวเองเปิด จนช่างเริ่มรับงาน (ขั้นแรกรับ) — DB ตัดสิน (editable/lockCode) ทุกครั้งที่โหลด · บันทึกจริง DB ตรวจซ้ำใต้ล็อกแถวใบ
//  4 state: loading (skeleton 2 แถว) · empty (แก้ได้: "เพิ่มได้จนช่างเริ่มรับงาน" + ปุ่ม / ล็อก: "ใบนี้ไม่มีพลอย" / ไม่มีขั้นฝัง: แจ้งออฟฟิศเพิ่มขั้นฝังพลอย) · error (ลองอีกครั้ง) · success (แถวสรุป + ปุ่มแก้ หรือข้อความล็อก)
//  ใบไม่มีขั้นฝังพลอย: ผู้จัดการเพิ่มขั้นเองไม่ได้ → "แจ้งออฟฟิศเพิ่มขั้นฝังพลอย" · 🔴 ไม่มีราคา/ตัวเลขเงิน · session หมดเวลา → onSessionLost (แผ่น PIN) จอนี้ไม่ unmount

import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { Lock } from "lucide-react";
import { intakeJobGems } from "@/lib/actions/job-worker";
import { BigButton } from "@/components/domain/jobs/worker/WorkerParts";
import { ShopGemEditSheet } from "@/components/domain/jobs/worker/shop/ShopGemEditSheet";
import type { GemSheetClose } from "@/components/domain/jobs/worker/shop/ShopGemEditSheet";
import { SHOP_GEM_TH, gemLineText, gemLockMessage, gemSummaryNotices } from "@/lib/jobs/shop-gem-flow";
import type { IntakeJobGems } from "@/lib/jobs/worker-server";
import type { MyIntakeJob } from "@/lib/jobs/shop-photo-server";

type Load = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; data: IntakeJobGems };

export function ShopJobGemsSection({ token, job, onSessionLost }: { token: string; job: MyIntakeJob; onSessionLost: () => void }) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [sheet, setSheet] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);
  /** ล็อกที่เพิ่งรู้ตอนบันทึก (ก่อนโหลดใหม่เสร็จ) — โหลดใหม่แล้วใช้ค่าจาก DB */
  const [lockNow, setLockNow] = useState<string | null>(null);
  const seq = useRef(0);
  const alive = useRef(true);
  const openBtn = useRef<HTMLButtonElement>(null);
  const lost = useRef(onSessionLost);
  useEffect(() => {
    lost.current = onSessionLost;
  });

  const loadGems = useCallback(
    async (silent: boolean) => {
      const n = ++seq.current;
      if (!silent) setLoad({ kind: "loading" });
      let r: Awaited<ReturnType<typeof intakeJobGems>> | null = null;
      try {
        r = await intakeJobGems(token, job.jobId);
      } catch {
        r = null;
      }
      if (!alive.current || n !== seq.current) return;
      if (r && r.ok) {
        const { ok: _ok, ...data } = r;
        void _ok;
        setLoad({ kind: "ready", data });
        setLockNow(null);
        return;
      }
      if (silent) return; // โหลดซ้ำเงียบๆ ล้ม — ข้อมูลเดิมยังอยู่ (บันทึกจริง DB ตรวจซ้ำ)
      if (r !== null && r.code === "session_required") lost.current();
      setLoad({ kind: "error", message: SHOP_GEM_TH.w10LoadError });
    },
    [token, job.jobId],
  );

  useEffect(() => {
    alive.current = true;
    void loadGems(false);
    return () => {
      alive.current = false;
    };
  }, [loadGems]);

  function closeSheet(r: GemSheetClose) {
    setSheet(false);
    setTimeout(() => openBtn.current?.focus(), 0);
    if (r.kind === "saved") {
      setNotes([SHOP_GEM_TH.w10Saved, ...gemSummaryNotices(r.summary)]);
      void loadGems(true);
    } else if (r.kind === "locked") {
      setNotes([]);
      setLockNow(r.code);
      void loadGems(true);
    } else if (r.kind === "reload") {
      setNotes([SHOP_GEM_TH.conflict]);
      void loadGems(true);
    }
  }

  return (
    <section aria-labelledby="shop-jobgems-h" className="space-y-3" data-testid="shop-jobgems">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="shop-jobgems-h" className="text-xl font-bold text-zinc-900">
          {SHOP_GEM_TH.title}
        </h2>
        {load.kind === "ready" && load.data.lines.length > 0 && (
          <p className="text-lg font-bold tabular-nums text-zinc-900">รวม {load.data.lines.reduce((s, l) => s + l.qtyTotal, 0).toLocaleString("en-US")} เม็ด</p>
        )}
      </div>

      {load.kind === "loading" && (
        <div role="status" aria-busy="true" aria-label="กำลังโหลดพลอย" className="animate-pulse space-y-2">
          <div className="h-14 rounded-xl bg-zinc-200" />
          <div className="h-14 rounded-xl bg-zinc-200" />
        </div>
      )}

      {load.kind === "error" && (
        <div role="status" className="space-y-2 rounded-xl bg-red-50 p-3 text-red-900">
          <p className="text-lg font-semibold">{load.message}</p>
          <BigButton type="button" tone="secondary" onClick={() => void loadGems(false)}>
            {SHOP_GEM_TH.retry}
          </BigButton>
        </div>
      )}

      {load.kind === "ready" && <Body data={load.data} lockNow={lockNow} openBtn={openBtn} onEdit={() => setSheet(true)} />}

      {notes.length > 0 && (
        <div role="status" className="space-y-1" data-testid="shop-jobgems-notes">
          {notes.map((m, i) => (
            <p key={m} className={i === 0 ? "text-lg font-semibold text-green-800" : "rounded-xl border-2 border-sky-300 bg-sky-50 p-3 text-base text-sky-950"}>
              {i === 0 ? "✓ " : "ⓘ "}
              {m}
            </p>
          ))}
        </div>
      )}

      {sheet && load.kind === "ready" && <ShopGemEditSheet token={token} data={load.data} onClose={closeSheet} onSessionLost={onSessionLost} />}
    </section>
  );
}

function Body({ data, lockNow, openBtn, onEdit }: { data: IntakeJobGems; lockNow: string | null; openBtn: RefObject<HTMLButtonElement>; onEdit: () => void }) {
  const lock = lockNow !== null ? gemLockMessage(lockNow, data.hasGemStage) : gemLockMessage(data.lockCode, data.hasGemStage);
  const editable = data.editable && lockNow === null && lock === null;
  return (
    <>
      {data.lines.length > 0 ? (
        <ul className="space-y-1.5">
          {data.lines.map((l) => (
            <li key={l.gemItemId} className="flex items-start justify-between gap-3 rounded-xl border-2 border-zinc-200 bg-white p-3">
              <span className="min-w-0 text-lg font-bold break-words [overflow-wrap:anywhere] text-zinc-900">
                {l.label}
                {l.position && <span className="block text-base font-normal text-zinc-700">{l.position}</span>}
              </span>
              <span className="shrink-0 text-base tabular-nums text-zinc-900">{gemLineText({ perPiece: l.qtyPerPiece, total: l.qtyTotal })}</span>
            </li>
          ))}
        </ul>
      ) : data.state === "unspecified" ? (
        <p className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3 text-lg font-semibold text-amber-950">⚑ {SHOP_GEM_TH.w10Unspecified}</p>
      ) : (
        <p className="text-lg text-zinc-900" data-testid="shop-jobgems-empty">
          {editable ? SHOP_GEM_TH.w10EmptyEditable : SHOP_GEM_TH.w10EmptyLocked}
        </p>
      )}

      {lock && (
        <p role="note" className="flex items-start gap-2 rounded-xl border-2 border-sky-300 bg-sky-50 p-3 text-lg font-semibold text-sky-950" data-testid="shop-jobgems-lock">
          <Lock className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <span>{lock}</span>
        </p>
      )}

      {editable && (
        <button
          ref={openBtn}
          type="button"
          onClick={onEdit}
          className="inline-flex min-h-14 w-full items-center justify-center rounded-xl border-2 border-zinc-400 bg-white px-5 text-xl font-bold text-zinc-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-300"
        >
          {data.lines.length > 0 ? SHOP_GEM_TH.w10Edit : SHOP_GEM_TH.w10Add}
        </button>
      )}
    </>
  );
}
