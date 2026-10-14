"use client";

// JobBoard v2 — บอร์ดใบงาน /jobs: บน = tile (ปุ่มกรอง) + "งานที่วิ่งอยู่" เรียงเร่งด่วน · ล่าง = ตามขั้นตอนการผลิต (คอลัมน์ PC · chip+รายการ มือถือ)
// 🔴 หลักใหญ่: ชุดข้อมูลที่กรองแล้วชุดเดียว (`filtered`) ป้อนทั้งส่วนบนและบอร์ด — ใบที่เห็นข้างบนมีการ์ดในบอร์ดเสมอ
// ข้อมูลจาก getJobBoard (server action) · polling 30 วินาที (ไม่ใช้ Realtime — สคีมา analytics ปิด REST) · ล้มระหว่าง polling = เก็บของเดิมไว้ + บอกว่าอัปเดตไม่สำเร็จ
// state ทั้งหมด (signal/ตัวกรอง/ขั้น/แสดงทั้งหมด/focus/highlight) อยู่ที่นี่ — polling เปลี่ยนแค่ data ไม่แตะ state เหล่านี้

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, LayoutGrid, List, RefreshCw, SlidersHorizontal } from "lucide-react";
import { ActiveJobs } from "@/components/domain/jobs/ActiveJobs";
import { JobCard } from "@/components/domain/jobs/JobCard";
import { StageChips } from "@/components/domain/jobs/StageChips";
import { StageRail } from "@/components/domain/jobs/StageRail";
import { SummaryTiles } from "@/components/domain/jobs/SummaryTiles";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { getJobBoard } from "@/lib/actions/job-office";
import type { BoardData } from "@/lib/actions/job-office";
import { EMPTY_FILTERS, applyFilters, applySignal, boardColumns, columnOf, describeFilters, groupByStage, hasFilters, holderOptions, summarize } from "@/lib/jobs/board";
import type { BoardFilters, Signal } from "@/lib/jobs/board";
import { METAL_LABEL, SOURCE_LABEL } from "@/lib/jobs/types";
import type { BoardRow } from "@/lib/jobs/types";
import { thaiDateTime } from "@/lib/jobs/dates";

export const BOARD_POLL_MS = 30_000;
/** วงแหวนไฮไลต์การ์ดที่เลื่อนมาหา */
export const HIGHLIGHT_MS = 3_000;

const SELECT =
  "min-h-11 rounded-md border border-zinc-300 bg-white px-2.5 text-sm text-zinc-900 focus:border-primary-600 focus:outline-none focus:ring-1 focus:ring-primary-600";

const matchMediaOk = (q: string): boolean => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(q).matches;
const prefersReducedMotion = () => matchMediaOk("(prefers-reduced-motion: reduce)");
const isDesktop = () => matchMediaOk("(min-width: 1024px)");

interface FocusReq {
  id: string;
  nonce: number;
  jobNo: string;
  stageName: string;
}

export function JobBoard({ initial }: { initial: BoardData }) {
  const [data, setData] = useState(initial);
  const [filters, setFilters] = useState<BoardFilters>(EMPTY_FILTERS);
  const [signal, setSignal] = useState<Signal | null>(null);
  const [mode, setMode] = useState<"board" | "list">("board");
  const [stage, setStage] = useState<string>("all");
  const [updatedAt, setUpdatedAt] = useState<string>(new Date().toISOString());
  const [pollError, setPollError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showAllActive, setShowAllActive] = useState(false);
  const [showEmptyStages, setShowEmptyStages] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [focusReq, setFocusReq] = useState<FocusReq | null>(null);
  const [highlight, setHighlight] = useState<{ id: string; nonce: number } | null>(null);
  const [announce, setAnnounce] = useState("");
  const activeHeadingRef = useRef<HTMLHeadingElement>(null);
  const lastFocusedRowId = useRef<string | null>(null);

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

  const todayTh = data.todayTh;
  // tile นับจากใบหลังกรอง dropdown แต่ก่อนกรอง signal → ตัวเลขเท่าผลที่เห็นเมื่อกด
  const afterDropdown = useMemo(() => applyFilters(data.rows, filters), [data.rows, filters]);
  const summary = useMemo(() => summarize(afterDropdown, todayTh), [afterDropdown, todayTh]);
  const filtered = useMemo(() => applySignal(afterDropdown, signal, todayTh), [afterDropdown, signal, todayTh]);
  const columns = useMemo(() => groupByStage(filtered, data.stages), [filtered, data.stages]);
  const holders = useMemo(() => holderOptions(data.rows), [data.rows]);
  const known = useMemo(() => new Set(data.stages.map((s) => s.code)), [data.stages]);
  const stageNames = useMemo(() => new Map(columns.map((c) => [c.code, c.name])), [columns]);

  const shownColumns = useMemo(() => boardColumns(columns), [columns]);
  const emptyColumnCount = shownColumns.filter((c) => c.rows.length === 0).length;
  const visibleColumns = showEmptyStages ? shownColumns : shownColumns.filter((c) => c.rows.length > 0);
  // ขั้นที่เลือกกลายเป็นว่างหลังรีเฟรช/กรอง → ถอยเป็น "ทุกขั้น" ตอนคำนวณ (ไม่ทิ้ง state ไว้ชี้ขั้นว่าง)
  const effStage = stage !== "all" && columns.some((c) => c.code === stage && c.rows.length > 0) ? stage : "all";
  const listRows = effStage === "all" ? columns.flatMap((c) => c.rows) : (columns.find((c) => c.code === effStage)?.rows ?? []);

  const set = (p: Partial<BoardFilters>) => setFilters((f) => ({ ...f, ...p }));
  const clearAll = () => {
    setFilters(EMPTY_FILTERS);
    setSignal(null);
  };
  const dropdownCount = [filters.metal, filters.source, filters.holder].filter(Boolean).length;
  const filtering = hasFilters(filters, signal);
  const highlightId = highlight?.id ?? null;

  const scrollOpts = (inline: ScrollLogicalPosition, block: ScrollLogicalPosition): ScrollIntoViewOptions => ({ behavior: prefersReducedMotion() ? "auto" : "smooth", block, inline });

  /** กดแถวในส่วนบน → เลื่อนไปการ์ดของใบนั้นในบอร์ด (มือถือ/โหมดรายการ: ตั้งตัวกรองขั้นก่อน) */
  const focusJob = useCallback(
    (row: BoardRow) => {
      const col = columnOf(row, known);
      if (mode === "list" || !isDesktop()) setStage(col);
      lastFocusedRowId.current = row.id;
      setFocusReq((p) => ({ id: row.id, nonce: (p?.nonce ?? 0) + 1, jobNo: row.jobNo, stageName: stageNames.get(col) ?? row.stageName ?? "ยังไม่เริ่ม" }));
    },
    [known, mode, stageNames]
  );

  // ตั้งใจ depend เฉพาะ focusReq (ไม่ depend data → polling ไม่สั่งเลื่อนซ้ำ) · การ์ดมี 2 ชุด (board/list) เลือกชุดที่มองเห็นอยู่
  useEffect(() => {
    if (!focusReq) return;
    const el = (["board", "list"] as const)
      .map((p) => document.getElementById(`${p}-job-${focusReq.id}`))
      .find((e): e is HTMLElement => !!e && e.getClientRects().length > 0);
    if (!el) return;
    el.scrollIntoView?.(scrollOpts("center", "center"));
    el.querySelector<HTMLElement>("a")?.focus({ preventScroll: true });
    setHighlight({ id: focusReq.id, nonce: focusReq.nonce });
    setAnnounce(`เลื่อนไปที่ ${focusReq.jobNo} ในขั้น ${focusReq.stageName}`);
  }, [focusReq]);

  useEffect(() => {
    if (!highlight) return;
    const t = setTimeout(() => setHighlight(null), HIGHLIGHT_MS);
    return () => clearTimeout(t);
  }, [highlight]);

  function backToActive() {
    const h = activeHeadingRef.current;
    h?.scrollIntoView?.(scrollOpts("nearest", "start"));
    const id = lastFocusedRowId.current;
    const btn = id ? document.querySelector<HTMLElement>(`li[data-job-id="${id}"] > button`) : null;
    (btn ?? h)?.focus({ preventScroll: true });
  }

  function jumpToColumn(code: string) {
    const h = document.getElementById(`board-col-${code}`);
    h?.scrollIntoView?.(scrollOpts("center", "nearest"));
    h?.focus({ preventScroll: true });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h1 className="text-2xl font-bold text-zinc-900">ใบงานผลิต</h1>
        <div className="flex items-center gap-2">
          <p className="text-xs text-zinc-700 max-sm:hidden">
            ข้อมูล ณ {thaiDateTime(updatedAt)} <span className="text-zinc-600">(อัตโนมัติทุก 30 วิ)</span>
          </p>
          <Button type="button" variant="secondary" onClick={() => void refresh()} loading={busy} aria-label="รีเฟรชบอร์ด">
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            <span className="max-sm:hidden">รีเฟรช</span>
          </Button>
        </div>
      </div>
      <p className="-mt-2 text-xs text-zinc-700 sm:hidden">ข้อมูล ณ {thaiDateTime(updatedAt)} (อัตโนมัติทุก 30 วิ)</p>

      {pollError && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-sm font-medium text-amber-900">
          <span>อัปเดตไม่สำเร็จ แสดงข้อมูลเดิม ณ {thaiDateTime(updatedAt)}</span>
          <Button type="button" variant="secondary" size="sm" onClick={() => void refresh()} loading={busy}>
            ลองใหม่
          </Button>
        </div>
      )}
      {data.truncated && <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 p-2.5 text-sm font-medium text-amber-900">แสดงใบงานไม่ครบ — ใช้ตัวกรองให้แคบลง</p>}

      {data.rows.length === 0 ? (
        <EmptyState title="ยังไม่มีใบงานที่เปิดอยู่" description="สร้างใบงานจากใบเสนอราคา OEM ที่ได้งานแล้ว หรือจากใบผลิตเข้าสต็อก" />
      ) : (
        <>
          <SummaryTiles summary={summary} signal={signal} onSelect={setSignal} />

          <div>
            <button
              type="button"
              aria-expanded={filtersOpen}
              aria-controls="job-board-filters"
              onClick={() => setFiltersOpen((o) => !o)}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-900 lg:hidden"
            >
              <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
              ตัวกรอง{dropdownCount > 0 ? ` (${dropdownCount})` : ""}
            </button>
            <div id="job-board-filters" className={`${filtersOpen ? "flex" : "hidden lg:flex"} mt-2 flex-wrap items-end gap-2 lg:mt-0`}>
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
            </div>
          </div>

          {filtering && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-1.5">
              <p role="status" className="text-sm text-zinc-900">
                กำลังกรอง: <span className="font-semibold">{describeFilters(filters, signal, { metal: METAL_LABEL, source: SOURCE_LABEL })}</span> — แสดง {filtered.length} จาก {data.rows.length} ใบ
              </p>
              <Button type="button" variant="ghost" onClick={clearAll}>
                ล้างตัวกรอง
              </Button>
            </div>
          )}

          {filtered.length === 0 ? (
            <EmptyState
              title="ไม่มีใบงานที่ตรงตัวกรอง"
              description="ลองล้างตัวกรอง"
              action={
                <Button type="button" variant="secondary" onClick={clearAll}>
                  ล้างตัวกรอง
                </Button>
              }
            />
          ) : (
            <>
              <ActiveJobs rows={filtered} todayTh={todayTh} stageNames={stageNames} known={known} showAll={showAllActive} onToggleAll={() => setShowAllActive((v) => !v)} onFocus={focusJob} headingRef={activeHeadingRef} />

              <section aria-labelledby="stage-board-heading" className="space-y-3 border-t border-zinc-200 pt-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 id="stage-board-heading" className="text-lg font-bold text-zinc-900">
                    ตามขั้นตอนการผลิต
                  </h2>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" variant="secondary" onClick={backToActive}>
                      <ArrowUp className="h-4 w-4" aria-hidden="true" />
                      กลับไปงานที่วิ่งอยู่
                    </Button>
                    <div role="group" aria-label="มุมมอง" className="hidden rounded-md border border-zinc-300 bg-white p-0.5 lg:flex">
                      {([["board", "บอร์ด", LayoutGrid], ["list", "รายการ", List]] as const).map(([k, label, Icon]) => (
                        <button key={k} type="button" aria-pressed={mode === k} onClick={() => setMode(k)} className={`inline-flex min-h-11 items-center gap-1.5 rounded px-3 text-sm font-medium ${mode === k ? "bg-primary-100 text-primary-800" : "text-zinc-800 hover:bg-zinc-100"}`}>
                          <Icon className="h-4 w-4" aria-hidden="true" />
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* มือถือ/แท็บเล็ต + มุมมองรายการบน PC: chip กรองตามขั้น + รายการ (ไม่มีแถบเลื่อนแนวนอนของบอร์ด) */}
                <div className={mode === "board" ? "space-y-3 lg:hidden" : "space-y-3"}>
                  <StageChips columns={shownColumns} total={filtered.length} stage={effStage} onSelect={setStage} emptyCount={emptyColumnCount} />
                  {listRows.length === 0 ? <p className="text-sm text-zinc-700">ไม่มีใบงานในขั้นนี้</p> : <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{listRows.map((r) => <JobCard key={r.id} row={r} todayTh={todayTh} idPrefix="list" highlighted={highlightId === r.id} />)}</ul>}
                </div>

                {mode === "board" && (
                  <div className="hidden space-y-3 lg:block">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <StageRail columns={shownColumns} onJump={jumpToColumn} />
                      {emptyColumnCount > 0 && (
                        <label className="flex min-h-11 items-center gap-2 text-sm font-medium text-zinc-900">
                          <input type="checkbox" className="h-5 w-5 accent-primary-600" checked={showEmptyStages} onChange={(e) => setShowEmptyStages(e.target.checked)} />
                          แสดงขั้นที่ไม่มีงาน ({emptyColumnCount})
                        </label>
                      )}
                    </div>
                    <div className="flex gap-3 overflow-x-auto pb-2">
                      {visibleColumns.map((c) => (
                        <div key={c.code} className="w-72 min-w-72 shrink-0 rounded-lg bg-zinc-100 p-2">
                          <h3 id={`board-col-${c.code}`} tabIndex={-1} className="mb-2 flex scroll-mt-24 items-center justify-between gap-2 px-1 text-sm font-bold text-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600">
                            <span className="min-w-0 break-words">{c.name}</span>
                            <span className="rounded-full bg-white px-2 text-xs tabular-nums">{c.rows.length}</span>
                          </h3>
                          <ul className="space-y-2">{c.rows.map((r) => <JobCard key={r.id} row={r} todayTh={todayTh} idPrefix="board" highlighted={highlightId === r.id} />)}</ul>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            </>
          )}
        </>
      )}

      <p role="status" className="sr-only">
        {announce}
      </p>
    </div>
  );
}
