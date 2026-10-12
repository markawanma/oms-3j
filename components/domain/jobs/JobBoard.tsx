"use client";

// JobBoard — บอร์ดใบงาน /jobs: คอลัมน์ตามขั้น (PC) · รายการกรองตามขั้น (มือถือ) · ตัวกรอง · polling 30 วินาที (ไม่ใช้ Realtime — สคีมา analytics ปิด REST)
// ข้อมูลจาก getJobBoard (server action) · ล้มระหว่าง polling = เก็บของเดิมไว้ + บอกว่าอัปเดตไม่สำเร็จ (ไม่เคลียร์บอร์ด)

import { useCallback, useEffect, useMemo, useState } from "react";
import { LayoutGrid, List, RefreshCw } from "lucide-react";
import { JobCard } from "@/components/domain/jobs/JobCard";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { getJobBoard } from "@/lib/actions/job-office";
import type { BoardData } from "@/lib/actions/job-office";
import { EMPTY_FILTERS, NO_STAGE, applyFilters, groupByStage, holderOptions, summarize } from "@/lib/jobs/board";
import type { BoardFilters } from "@/lib/jobs/board";
import { METAL_LABEL, SOURCE_LABEL } from "@/lib/jobs/types";
import { thaiDateTime } from "@/lib/jobs/dates";

export const BOARD_POLL_MS = 30_000;

const SELECT =
  "min-h-11 rounded-md border border-zinc-300 bg-white px-2.5 text-sm text-zinc-900 focus:border-primary-600 focus:outline-none focus:ring-1 focus:ring-primary-600";

function Tile({ label, n, tone }: { label: string; n: number; tone?: "red" | "amber" }) {
  const cls = n > 0 && tone === "red" ? "border-red-300 bg-red-50 text-red-900" : n > 0 && tone === "amber" ? "border-amber-300 bg-amber-50 text-amber-900" : "border-zinc-200 bg-white text-zinc-900";
  return (
    <div className={`rounded-lg border px-3 py-2 ${cls}`}>
      <p className="text-xs font-semibold">{label}</p>
      <p className="text-2xl font-bold tabular-nums">{n}</p>
    </div>
  );
}

export function JobBoard({ initial }: { initial: BoardData }) {
  const [data, setData] = useState(initial);
  const [filters, setFilters] = useState<BoardFilters>(EMPTY_FILTERS);
  const [mode, setMode] = useState<"board" | "list">("board");
  const [stage, setStage] = useState<string>("all");
  const [updatedAt, setUpdatedAt] = useState<string>(new Date().toISOString());
  const [pollError, setPollError] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const r = await getJobBoard();
      if (r.ok) {
        setData(r.data);
        setUpdatedAt(new Date().toISOString());
        setPollError(false);
      } else setPollError(true);
    } catch {
      setPollError(true);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible") void refresh();
    }, BOARD_POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const filtered = useMemo(() => applyFilters(data.rows, filters), [data.rows, filters]);
  const columns = useMemo(() => groupByStage(filtered, data.stages), [filtered, data.stages]);
  const summary = useMemo(() => summarize(data.rows, data.todayTh), [data.rows, data.todayTh]);
  const holders = useMemo(() => holderOptions(data.rows), [data.rows]);
  const listRows = stage === "all" ? columns.flatMap((c) => c.rows) : (columns.find((c) => c.code === stage)?.rows ?? []);
  const set = (p: Partial<BoardFilters>) => setFilters((f) => ({ ...f, ...p }));

  return (
    <div className="space-y-4">
      <section aria-label="สรุป" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label="ใบงานที่เปิดอยู่" n={summary.active} />
        <Tile label="เลยกำหนด" n={summary.overdue} tone="red" />
        <Tile label="ครบใน 3 วัน" n={summary.dueSoon} tone="amber" />
        <Tile label="ไม่มีความเคลื่อนไหวเกิน 3 วัน" n={summary.stale} tone="amber" />
      </section>

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm font-medium text-zinc-800">
          <span className="mb-1 block">โลหะ</span>
          <select className={SELECT} value={filters.metal} onChange={(e) => set({ metal: e.target.value })}>
            <option value="">ทั้งหมด</option>
            {Object.entries(METAL_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium text-zinc-800">
          <span className="mb-1 block">แหล่ง</span>
          <select className={SELECT} value={filters.source} onChange={(e) => set({ source: e.target.value })}>
            <option value="">ทั้งหมด</option>
            {Object.entries(SOURCE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium text-zinc-800">
          <span className="mb-1 block">ผู้ถือ</span>
          <select className={SELECT} value={filters.holder} onChange={(e) => set({ holder: e.target.value })}>
            <option value="">ทั้งหมด</option>
            {holders.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm font-medium text-zinc-900">
          <input type="checkbox" className="h-5 w-5 accent-primary-600" checked={filters.overdueOnly} onChange={(e) => set({ overdueOnly: e.target.checked })} />
          เฉพาะเลยกำหนด
        </label>
        <div className="ml-auto flex items-center gap-2">
          <div role="group" aria-label="มุมมอง" className="hidden rounded-md border border-zinc-300 bg-white p-0.5 lg:flex">
            {([["board", "บอร์ด", LayoutGrid], ["list", "รายการ", List]] as const).map(([k, label, Icon]) => (
              <button key={k} type="button" aria-pressed={mode === k} onClick={() => setMode(k)} className={`inline-flex min-h-10 items-center gap-1.5 rounded px-3 text-sm font-medium ${mode === k ? "bg-primary-100 text-primary-800" : "text-zinc-800 hover:bg-zinc-100"}`}>
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
          <Button type="button" variant="secondary" onClick={() => void refresh()} loading={busy} aria-label="รีเฟรชบอร์ด">
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            <span className="max-sm:hidden">รีเฟรช</span>
          </Button>
        </div>
      </div>
      <p className={`text-xs ${pollError ? "font-semibold text-amber-900" : "text-zinc-700"}`} role="status">
        {pollError ? "อัปเดตล่าสุดไม่สำเร็จ — แสดงข้อมูลเดิม · " : "รีเฟรชเองทุก 30 วินาที · "}
        ข้อมูล ณ {thaiDateTime(updatedAt)}
      </p>
      {data.truncated && <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 p-2.5 text-sm font-medium text-amber-900">แสดงใบงานไม่ครบ — ใช้ตัวกรองให้แคบลง</p>}

      {filtered.length === 0 ? (
        <EmptyState title={data.rows.length === 0 ? "ยังไม่มีใบงานที่เปิดอยู่" : "ไม่มีใบงานที่ตรงตัวกรอง"} description={data.rows.length === 0 ? "สร้างใบงานจากใบเสนอราคา OEM ที่ได้งานแล้ว หรือจากใบผลิตเข้าสต็อก" : "ลองล้างตัวกรอง"} />
      ) : (
        <>
          {/* มือถือ/แท็บเล็ต + มุมมองรายการบน PC: รายการกรองตามขั้น (ไม่มีแถบเลื่อนแนวนอน) */}
          <section aria-label="รายการใบงาน" className={mode === "board" ? "space-y-3 lg:hidden" : "space-y-3"}>
            <label className="block text-sm font-medium text-zinc-800">
              <span className="mb-1 block">ขั้น</span>
              <select className={`${SELECT} w-full sm:w-72`} value={stage} onChange={(e) => setStage(e.target.value)}>
                <option value="all">ทุกขั้น ({filtered.length})</option>
                {columns.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name} ({c.rows.length})
                  </option>
                ))}
              </select>
            </label>
            {listRows.length === 0 ? <p className="text-sm text-zinc-700">ไม่มีใบงานในขั้นนี้</p> : <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{listRows.map((r) => <JobCard key={r.id} row={r} />)}</ul>}
          </section>

          {mode === "board" && (
            <section aria-label="บอร์ดตามขั้น" className="hidden gap-3 overflow-x-auto pb-2 lg:flex">
              {columns
                .filter((c) => c.code !== NO_STAGE || c.rows.length > 0)
                .map((c) => (
                  <div key={c.code} className="w-64 shrink-0 rounded-lg bg-zinc-100 p-2">
                    <h3 className="mb-2 flex items-center justify-between px-1 text-sm font-bold text-zinc-900">
                      {c.name}
                      <span className="rounded-full bg-white px-2 text-xs tabular-nums">{c.rows.length}</span>
                    </h3>
                    <ul className="space-y-2">{c.rows.map((r) => <JobCard key={r.id} row={r} />)}</ul>
                  </div>
                ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}
