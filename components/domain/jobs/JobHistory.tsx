"use client";

// JobHistory — แท็บ "ประวัติงาน" /jobs/history: ใบงานแม่ที่ปิดแล้ว/ยกเลิก · ค้นหา (เลขใบ/ชื่อแบบ/SKU) + สถานะ + เดือนที่ปิด + โลหะ + แหล่ง
// กรองฝั่ง client จากข้อมูลที่โหลดมาครั้งเดียว (≤ 500 ใบ) · ตัวกรองเก็บใน URL (router.replace · ค้นหา debounce 300ms) · แสดงครั้งละ 25
// 🔴 ไม่มีราคา/ต้นทุน/ชื่อลูกค้า (ข้อมูลมาจาก getJobHistory whitelist) · ไม่คำนวณยอดเอง — ดี/เสียมาจาก DB (ทั้งต้นไม้)
// state ครบ: A ยังไม่มีใบปิด · B กรองไม่เจอ (+ล้างตัวกรอง) · ส่วนที่เหลือ = รายการ · loading = loading.tsx · error = ErrorState ที่หน้า

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Ban, CheckCircle2, ClipboardList, PackageX, Search, SearchX } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { STATUS_BAR, STATUS_TONE } from "@/components/domain/jobs/StatusChip";
import type { HistoryData } from "@/lib/actions/job-office";
import { thaiDate } from "@/lib/jobs/dates";
import { EMPTY_FILTERS, HISTORY_LIMIT, HISTORY_PAGE, SOURCE_FILTERS, applyHistoryFilters, closedDateOf, historyQuery, isFiltered, isSurplusPending, monthOptions, parseHistoryFilters, surplusQty } from "@/lib/jobs/history";
import type { HistoryFilters, HistoryRow as HistoryRowData, StatusFilter } from "@/lib/jobs/history";
import { JOB_METALS } from "@/lib/jobs/source";
import { METAL_LABEL, SOURCE_LABEL } from "@/lib/jobs/types";

export const SEARCH_DEBOUNCE_MS = 300;

const STATUS_SEGMENTS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "ทั้งหมด" },
  { key: "done", label: "เสร็จ" },
  { key: "cancelled", label: "ยกเลิก" },
];

const SELECT = "min-h-11 rounded-md border border-zinc-300 bg-white px-2.5 text-sm text-zinc-900 focus:border-primary-600 focus:outline-none focus:ring-1 focus:ring-primary-600";

/** ป้ายสถานะของใบที่ปิดแล้ว — ข้อความ + ไอคอน + สี (เขียว = เสร็จ · เทา = ยกเลิก) ใช้ tone ชุดเดิมของบอร์ด */
export function ClosedStatusChip({ status }: { status: "done" | "cancelled" }) {
  const done = status === "done";
  const Icon = done ? CheckCircle2 : Ban;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm font-bold ${STATUS_TONE[done ? "green" : "gray"]}`}>
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      {done ? "เสร็จ" : "ยกเลิก"}
    </span>
  );
}

function HistoryItem({ row, todayTh }: { row: HistoryRowData; todayTh: string }) {
  const done = row.status === "done";
  const date = closedDateOf(row);
  // ปีเดียวกับวันนี้ไม่ต้องใส่ปี · ปีอื่นใส่ (พ.ศ.)
  const dateText = date ? thaiDate(date, !date.startsWith(todayTh.slice(0, 4))) : "—";
  const meta = [METAL_LABEL[row.metal] ?? row.metal, SOURCE_LABEL[row.sourceKind] ?? row.sourceKind, `${done ? "ปิด" : "ยกเลิก"} ${dateText}`].filter((x) => x !== "");
  const stats = done ? `สั่ง ${row.qtyOrder} · ดี ${row.qtyGood ?? "—"} · เสีย ${row.qtyScrap ?? "—"} ชิ้น` : `สั่ง ${row.qtyOrder} ชิ้น`;
  const surplus = isSurplusPending(row);
  return (
    <li className="min-w-0">
      <Link
        href={`/jobs/${row.id}`}
        className={`block min-h-11 min-w-0 rounded-lg border border-l-4 border-zinc-200 bg-white p-3 hover:border-y-zinc-500 hover:border-r-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 ${STATUS_BAR[done ? "green" : "gray"]}`}
      >
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
          <ClosedStatusChip status={row.status} />
          {surplus && (
            <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-semibold ${STATUS_TONE.amber}`}>
              <PackageX className="h-3 w-3 shrink-0" aria-hidden="true" />
              เหลือ {surplusQty(row)} ชิ้น ยังไม่ตัดสิน
            </span>
          )}
        </div>
        <p className="flex min-w-0 items-baseline gap-2">
          <span className="shrink-0 text-base font-bold tabular-nums text-zinc-900">{row.jobNo}</span>
          <span className="min-w-0 truncate text-sm font-medium text-zinc-900">{row.designLabel}</span>
        </p>
        <p className="mt-0.5 text-sm text-zinc-800 [overflow-wrap:anywhere]">
          <span className="tabular-nums">{stats}</span> · {meta.join(" · ")}
        </p>
        {!done && row.cancelReason && <p className="mt-0.5 truncate text-sm text-zinc-700">เหตุผล: {row.cancelReason}</p>}
      </Link>
    </li>
  );
}

export function JobHistory({ data }: { data: HistoryData }) {
  const router = useRouter();
  const params = useSearchParams();
  const initial = useMemo(() => parseHistoryFilters((k) => params?.get(k)), []); // eslint-disable-line react-hooks/exhaustive-deps -- อ่านจาก URL ครั้งเดียวตอนเปิดหน้า
  const [filters, setFilters] = useState<HistoryFilters>(initial);
  const [qText, setQText] = useState(initial.q);
  const [shown, setShown] = useState(HISTORY_PAGE);
  const synced = useRef(historyQuery(initial));

  // ค้นหา: debounce แล้วค่อยกรอง (พิมพ์รัวไม่กระตุก/ไม่ยิง URL ทุกตัวอักษร)
  useEffect(() => {
    if (qText === filters.q) return;
    const t = setTimeout(() => setFilters((f) => ({ ...f, q: qText })), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [qText, filters.q]);

  // เปลี่ยนตัวกรอง = กลับไปแสดง 25 ใบแรก (แยกจาก effect ของ URL — router เปลี่ยนอ้างอิงห้ามรีเซ็ตรายการที่กด "แสดงเพิ่ม" ไว้)
  useEffect(() => {
    setShown(HISTORY_PAGE);
  }, [filters]);

  // ตัวกรอง → URL (แชร์/รีเฟรชแล้วยังอยู่)
  useEffect(() => {
    const qs = historyQuery(filters);
    if (qs === synced.current) return;
    synced.current = qs;
    router.replace(qs ? `/jobs/history?${qs}` : "/jobs/history", { scroll: false });
  }, [filters, router]);

  const all = data.rows;
  const filtered = useMemo(() => applyHistoryFilters(all, filters), [all, filters]);
  const months = useMemo(() => monthOptions(all), [all]);
  const visible = filtered.slice(0, shown);
  const set = (patch: Partial<HistoryFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const clear = () => {
    setQText("");
    setFilters(EMPTY_FILTERS);
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-zinc-900">ประวัติงาน</h1>

      {all.length === 0 ? (
        // A: ยังไม่มีใบที่ปิด/ยกเลิก
        <EmptyState
          icon={ClipboardList}
          title="ยังไม่มีใบงานที่ปิดแล้ว"
          description="ใบงานที่ปิดงานหรือยกเลิกแล้วจะมาอยู่ที่นี่ — ใบที่ยังวิ่งอยู่ดูที่บอร์ด"
          action={
            <Link href="/jobs" className="inline-flex min-h-11 items-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-800 hover:bg-zinc-50">
              กลับไปบอร์ดใบงาน
            </Link>
          }
        />
      ) : (
        <>
          <section aria-label="ตัวกรองประวัติงาน" className="space-y-3 rounded-lg border border-zinc-200 bg-white p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-500" aria-hidden="true" />
              <input
                type="search"
                value={qText}
                onChange={(e) => setQText(e.target.value)}
                maxLength={80}
                aria-label="ค้นหาใบงาน"
                placeholder="ค้นหา เลขใบ · ชื่อแบบ · SKU"
                className="min-h-11 w-full rounded-md border border-zinc-300 bg-white py-2 pr-3 pl-9 text-base text-zinc-900 focus:border-primary-600 focus:outline-none focus:ring-1 focus:ring-primary-600"
              />
            </div>
            <div role="group" aria-label="สถานะใบงาน" className="inline-flex flex-wrap gap-1 rounded-md border border-zinc-200 p-1">
              {STATUS_SEGMENTS.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={filters.status === key}
                  onClick={() => set({ status: key })}
                  className={`inline-flex min-h-11 items-center rounded px-3 text-sm font-medium ${filters.status === key ? "bg-primary-100 text-primary-800" : "text-zinc-800 hover:bg-zinc-100"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <label className="space-y-1 text-sm font-medium text-zinc-800">
                เดือนที่ปิด
                <select value={filters.month} onChange={(e) => set({ month: e.target.value })} className={`${SELECT} w-full`}>
                  <option value="">ทุกเดือน</option>
                  {months.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm font-medium text-zinc-800">
                โลหะ
                <select value={filters.metal} onChange={(e) => set({ metal: e.target.value })} className={`${SELECT} w-full`}>
                  <option value="">ทุกโลหะ</option>
                  {JOB_METALS.map((m) => (
                    <option key={m} value={m}>
                      {METAL_LABEL[m] ?? m}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm font-medium text-zinc-800">
                แหล่งงาน
                <select value={filters.source} onChange={(e) => set({ source: e.target.value })} className={`${SELECT} w-full`}>
                  <option value="">ทุกแหล่ง</option>
                  {SOURCE_FILTERS.map((s) => (
                    <option key={s} value={s}>
                      {SOURCE_LABEL[s] ?? s}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          {data.truncated && (
            <p role="status" className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-sm font-medium text-amber-900">
              แสดงเฉพาะ {HISTORY_LIMIT} ใบล่าสุด — ใบที่เก่ากว่านั้นยังไม่แสดงในหน้านี้
            </p>
          )}

          <p role="status" aria-live="polite" className="text-sm text-zinc-800">
            แสดง <strong className="tabular-nums">{visible.length}</strong> จาก <strong className="tabular-nums">{filtered.length}</strong> ใบ
          </p>

          {filtered.length === 0 ? (
            // B: มีใบปิดอยู่ แต่ตัวกรองไม่เจอ
            <EmptyState
              icon={SearchX}
              title="ไม่พบใบงานที่ตรงกับตัวกรอง"
              description={isFiltered(filters) ? "ลองเปลี่ยนคำค้นหา หรือล้างตัวกรองเพื่อดูทุกใบ" : undefined}
              action={
                <Button type="button" variant="secondary" onClick={clear}>
                  ล้างตัวกรอง
                </Button>
              }
            />
          ) : (
            <>
              <ul aria-label="รายการใบงานที่ปิดแล้ว" className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                {visible.map((r) => (
                  <HistoryItem key={r.id} row={r} todayTh={data.todayTh} />
                ))}
              </ul>
              {filtered.length > visible.length && (
                <Button type="button" variant="secondary" onClick={() => setShown((n) => n + HISTORY_PAGE)}>
                  แสดงเพิ่ม (เหลือ {filtered.length - visible.length})
                </Button>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
