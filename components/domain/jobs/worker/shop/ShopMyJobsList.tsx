"use client";

// ShopMyJobsList — W-9 "ใบที่ฉันเปิด" บน hub หลัง PIN (UX §5A.1 · มติ Q1=B) · มือถือ 360
// เฉพาะใบที่ผู้จัดการคนนี้เปิดและยังไม่ปิด (server กรองที่ DB — เราแค่แสดง) · ล่าสุดก่อน · แสดง 5 ใบแรก + "ดูทั้งหมด (n)" ขยายในหน้าเดิม (5 = ค่าตั้งต้นของ UX ไม่ใช่มติเจ้าของ)
// การ์ดมีแค่: ชื่อแบบ · JB · ป้ายโลหะ · จำนวน · รูป n/3 · ป้ายสถานะ (✎ แก้ได้ / 🔒 ช่างรับงานแล้ว — ไอคอน+คำ ไม่พึ่งสี) — ไม่มีเนื้อ%/น้ำหนัก/เงิน/เวลาเปิด/ชื่อลูกค้า (type ก็ไม่มี field พวกนี้)
// ป้ายสถานะ: "✎ แก้ได้" / "🔒 แก้รูปไม่ได้ตอนนี้" (คำกลาง — editable=false อาจเป็นช่างรับงาน หรือใบไม่อยู่สถานะที่แก้ได้ ไม่เหมารวมว่า "ช่างรับงานแล้ว") · ป้ายเป็นค่า ณ ตอนโหลดรายการ (อาจเก่า) — W-10 โหลดซ้ำเสมอ และ server เป็นด่านจริง · การ์ดล็อกยังแตะได้ (ดูรูป/ยืนยันว่าใบไหน)
// 4 state: loading (skeleton 2 การ์ด — ไม่บล็อกปุ่ม "เปิดงานใหม่") · empty (บรรทัดเดียว) · error (ลองอีกครั้ง — ปุ่มเปิดงานใหม่ใช้ได้ตามเดิม) · success
// session หมดเวลา → onSessionLost (แผ่น PIN เดิม) · โหลดใหม่เมื่อ mount (เข้า hub/กลับจาก W-8/W-10) หรือกด รีเฟรช · ไม่ poll

import { useCallback, useEffect, useRef, useState } from "react";
import { Lock, Pencil, RefreshCw } from "lucide-react";
import { intakeMyJobs } from "@/lib/actions/job-worker";
import { ShopMetalTag } from "@/components/domain/jobs/worker/shop/ShopMetalTag";
import { SHOP_PHOTO_MAX, SHOP_PHOTO_TH } from "@/lib/jobs/shop-photos";
import type { MyIntakeJob } from "@/lib/jobs/shop-photo-server";

export const MSG_MYJOBS_ERROR = "โหลดรายการใบไม่ได้ — เช็คสัญญาณแล้วลองอีกครั้ง";
export const MSG_MYJOBS_EMPTY = "ยังไม่มีใบที่เปิดไว้";
export const MSG_MYJOBS_EMPTY_HINT = "ใบที่เปิดจากมือถือและยังไม่ปิดจะมาอยู่ตรงนี้";
const SHOW_FIRST = 5;

function Card({ job, onOpen }: { job: MyIntakeJob; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="flex min-h-[88px] w-full flex-col gap-1 rounded-2xl border-2 border-zinc-300 bg-white p-3 text-left focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-300 active:bg-zinc-50">
      <span className="flex items-start justify-between gap-2">
        <span className="line-clamp-2 min-w-0 flex-1 text-lg font-bold break-words text-zinc-900">{job.designLabel}</span>
        {job.editable ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-sky-300 bg-sky-100 px-2 py-0.5 text-base font-semibold text-sky-950">
            <Pencil className="h-4 w-4" aria-hidden="true" />
            แก้ได้
          </span>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-zinc-200 px-2 py-0.5 text-base font-semibold text-zinc-900">
            <Lock className="h-4 w-4" aria-hidden="true" />
            {SHOP_PHOTO_TH.cardNotEditable}
          </span>
        )}
      </span>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base text-zinc-800">
        <span className="font-semibold tabular-nums">{job.jobNo}</span>
        {job.metal && <ShopMetalTag metal={job.metal} size="sm" />}
        <span className="tabular-nums">· {job.qty.toLocaleString("en-US")} ชิ้น</span>
      </span>
      <span className="flex items-center justify-between text-base text-zinc-800">
        <span className="tabular-nums">{job.myPhotosCount > 0 ? `รูป ${job.myPhotosCount}/${SHOP_PHOTO_MAX}` : "ไม่มีรูป"}</span>
        <span aria-hidden="true" className="text-xl text-zinc-600">
          ›
        </span>
      </span>
    </button>
  );
}

export function ShopMyJobsList({ token, onOpenJob, onSessionLost }: { token: string; onOpenJob: (job: MyIntakeJob) => void; onSessionLost: () => void }) {
  const [state, setState] = useState<{ kind: "loading" } | { kind: "error" } | { kind: "ok"; jobs: MyIntakeJob[] }>({ kind: "loading" });
  const [all, setAll] = useState(false);
  const seq = useRef(0);
  const alive = useRef(true);
  const lost = useRef(onSessionLost);
  useEffect(() => {
    lost.current = onSessionLost;
  });

  const load = useCallback(async () => {
    const n = ++seq.current;
    setState({ kind: "loading" });
    let r: Awaited<ReturnType<typeof intakeMyJobs>> | null = null;
    try {
      r = await intakeMyJobs(token);
    } catch {
      r = null;
    }
    if (!alive.current || n !== seq.current) return; // ผลเก่าที่มาช้ากว่าไม่ทับผลใหม่
    if (r === null) {
      setState({ kind: "error" });
      return;
    }
    if (r.ok) {
      setState({ kind: "ok", jobs: r.jobs });
      return;
    }
    if (r.code === "session_required") lost.current();
    setState({ kind: "error" });
  }, [token]);

  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
    };
  }, [load]);

  const jobs = state.kind === "ok" ? state.jobs : [];
  const shown = all ? jobs : jobs.slice(0, SHOW_FIRST);

  return (
    <section aria-labelledby="shop-myjobs-h" className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 id="shop-myjobs-h" className="text-xl font-bold text-zinc-900">
          ใบที่ฉันเปิด
        </h2>
        <button type="button" onClick={() => void load()} disabled={state.kind === "loading"} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-lg font-semibold text-primary-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-300 disabled:opacity-50">
          <RefreshCw className={`h-5 w-5 ${state.kind === "loading" ? "motion-safe:animate-spin" : ""}`} aria-hidden="true" />
          รีเฟรช
        </button>
      </div>

      {state.kind === "loading" && (
        <div role="status" aria-busy="true" aria-label="กำลังโหลดรายการใบ" className="space-y-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-[88px] animate-pulse rounded-2xl bg-zinc-200" />
          ))}
        </div>
      )}

      {state.kind === "error" && (
        <div role="status" className="space-y-2 rounded-xl bg-red-50 p-3 text-red-900">
          <p className="text-lg font-semibold">{MSG_MYJOBS_ERROR}</p>
          <button type="button" onClick={() => void load()} className="inline-flex min-h-12 items-center justify-center rounded-xl border-2 border-red-700 bg-white px-5 text-lg font-bold text-red-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-300">
            ลองอีกครั้ง
          </button>
        </div>
      )}

      {state.kind === "ok" && jobs.length === 0 && (
        <div className="space-y-0.5">
          <p className="text-lg font-semibold text-zinc-900">{MSG_MYJOBS_EMPTY}</p>
          <p className="text-base text-zinc-700">{MSG_MYJOBS_EMPTY_HINT}</p>
        </div>
      )}

      {state.kind === "ok" && jobs.length > 0 && (
        <>
          <ul className="space-y-2">
            {shown.map((j) => (
              <li key={j.jobId}>
                <Card job={j} onOpen={() => onOpenJob(j)} />
              </li>
            ))}
          </ul>
          {jobs.length > SHOW_FIRST && (
            <button type="button" onClick={() => setAll((v) => !v)} aria-expanded={all} className="min-h-12 w-full rounded-lg text-lg font-semibold text-primary-800 underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-300">
              {all ? "ย่อรายการ" : `ดูทั้งหมด (${jobs.length})`}
            </button>
          )}
        </>
      )}
    </section>
  );
}
