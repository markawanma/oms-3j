"use client";

// GemsToBuyClient — หน้า /jobs/gems-to-buy (G1b · ux-gems-to-buy.md + §14.1 มติเจ้าของ 24 ต.ค. 69) — owner/admin เท่านั้น (page.tsx guard + DB ตรวจ actor ซ้ำ)
//  - แท็บ "ยังไม่สั่ง / สั่งแล้ว" · หัวคอลัมน์ "ต้องใช้" (ยอดคือที่ใบงานต้องใช้ — ไม่หักพลอยที่มีในร้าน ไม่เผื่อแตก ไม่ใช่ "ยอดที่ควรสั่ง")
//  - ไม่มีใบพิมพ์ · ไม่มีสถานะ "ได้รับของ" · ไม่มี "ควรสั่งภายใน" (มติเจ้าของ)
//  - ข้อมูลทั้งหมดมาจาก props (server) — ไม่ optimistic: ติ๊ก → รอ server → router.refresh() · ตัวเลขไม่ถูกแก้ใน client
//  - ติ๊กด้วย line_ids · all-or-nothing: ล้ม = แจ้ง + โหลดใหม่ ไม่ข้ามแถวแล้วติ๊กที่เหลือ · เกิน 200 แถว = ไม่ยิง (ห้ามแบ่งหลายรอบ — จะไม่ all-or-nothing)
//  - undo = คำสั่งตรงข้ามด้วย lineIds เดิม · เสนอเฉพาะเมื่อผล server บอกว่าย้อนแล้วกลับสภาพเดิมจริง (undoPlanFromResult · prevOrderedQty) · มีแท็บฝั่งตรงข้ามเป็นทางสำรองเสมอ
//  - 🔴 ต้นทุนโหลดแยกเฉพาะเมื่อเปิดสวิตช์ (useGemCost) · ข้อความคัดลอกสร้างจาก GemOrderLine ที่ไม่มีฟิลด์ราคา

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Diamond, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorBanner } from "@/components/ui/ErrorState";
import { useToast } from "@/components/ui/Toast";
import { SwitchField } from "@/components/domain/jobs/SwitchField";
import { markGemPurchase } from "@/lib/actions/gems";
import { buildGemOrderText, gemOrderDateLabel, toGemOrderLines } from "@/lib/jobs/gem-order-text";
import {
  GTB_EMPTY_FILTERS,
  GTB_MAX_LINES_PER_MARK,
  MARK_FAILED_MESSAGE,
  MARK_MULTI_LINE_MESSAGE,
  MARK_NOTHING_MESSAGE,
  MARK_TOO_MANY_BULK_MESSAGE,
  MARK_TOO_MANY_GROUP_MESSAGE,
  applyFilters,
  buildGtbQuery,

  countUrgent,
  distinctJobCount,

  hasActiveFilter,
  markTargetForJobs,

  markFailureMessage,
  resolveScope,
  removedQtyByJobItem,
  removedWithPendingLine,
  rowsForTab,
  serverClock,
  sortRows,
  undoPlanFromResult,
  visibleSelected,
} from "@/lib/jobs/gems-to-buy";
import type { GemsToBuyView, GtbFilters, GtbJob, GtbRow, GtbTab } from "@/lib/jobs/gems-to-buy";
import { CopiedNudge, GemsToBuyActionBar } from "@/components/domain/jobs/gems-to-buy/GemsToBuyActionBar";
import { GemCostTotals } from "@/components/domain/jobs/gems-to-buy/GemCostCell";
import { GemsToBuyCard } from "@/components/domain/jobs/gems-to-buy/GemsToBuyCard";
import { GemsToBuyFilters } from "@/components/domain/jobs/gems-to-buy/GemsToBuyFilters";
import { RemovedAfterOrderNotice, UnspecifiedJobsNotice } from "@/components/domain/jobs/gems-to-buy/GemsToBuyNotices";
import { GemsToBuyTable } from "@/components/domain/jobs/gems-to-buy/GemsToBuyTable";
import { ManualCopyDialog, useCopyText } from "@/components/domain/jobs/gems-to-buy/useCopyText";
import { useGemCost } from "@/components/domain/jobs/gems-to-buy/useGemCost";

export const COST_SWITCH_STORAGE_KEY = "gems-to-buy:cost-on";

const TABS: ReadonlyArray<{ key: GtbTab; label: string }> = [
  { key: "pending", label: "ยังไม่สั่ง" },
  { key: "ordered", label: "สั่งแล้ว" },
];

interface MarkOpts {
  lineIds: string[];
  ordered: boolean;
  /** key ที่ขึ้น loading/aria-busy ("*" = ทั้งหน้า) */
  busy: string[];
  /** ข้อความหลังทำสำเร็จ (ขึ้น toast + aria-live) — ข้อความตรงข้ามของ undo ประกอบจาก subject */
  subject: string;
  tooMany: string;
  clearKeys?: string[];
  /** แถวที่ focus ไปหลังข้อมูลโหลดใหม่ (prefer ถ้ายังอยู่ · ไม่งั้น fallback · ไม่มี = แท็บ) */
  focus?: { prefer: string | null; fallback: string | null };
  /**
   * 🔴 ยอดที่จอเห็น/ส่งร้าน ต่อ line (qty_needed_now) — บังคับเมื่อ ordered=true (DB ล้ม qty_changed ถ้ายอดในระบบเปลี่ยน)
   * null = สร้างไม่ได้ (ใบมีหลาย line ของรายการเดียวกัน — ไม่มียอดต่อ line ให้ตรวจ) → ไม่ยิง · ยกเลิกติ๊ก (ordered=false) ไม่ใช้
   */
  expected?: Record<string, number> | null;
  /** ติ๊กจากแถบหลังคัดลอก: ยอดเปลี่ยน = ยอดที่ส่งร้านไม่ตรงระบบ → ข้อความให้คัดลอกใหม่ */
  afterCopy?: boolean;
}

interface CopiedSnapshot {
  lineIds: string[];
  /** ยอดต่อ line ณ ตอนคัดลอก (= ยอดที่ส่งร้านจริง) — ไม่ใช้ยอดสดตอนกดติ๊ก */
  expected: Record<string, number> | null;
  count: number;
}

const addAll = (s: ReadonlySet<string>, keys: string[]): Set<string> => new Set([...s, ...keys]);
const removeAll = (s: ReadonlySet<string>, keys: string[]): Set<string> => new Set([...s].filter((k) => !keys.includes(k)));
const toggleIn = (s: ReadonlySet<string>, k: string): Set<string> => (s.has(k) ? removeAll(s, [k]) : addAll(s, [k]));

export function GemsToBuyClient({ view, initialTab, initialFilters }: { view: GemsToBuyView; initialTab: GtbTab; initialFilters: GtbFilters }) {
  const router = useRouter();
  const { push } = useToast();
  const [tab, setTab] = useState<GtbTab>(initialTab);
  const [filters, setFilters] = useState<GtbFilters>(initialFilters);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [moreJobs, setMoreJobs] = useState<ReadonlySet<string>>(new Set());
  const [busyKeys, setBusyKeys] = useState<ReadonlySet<string>>(new Set());
  const [copied, setCopied] = useState<CopiedSnapshot | null>(null);
  const [announce, setAnnounce] = useState("");
  const [costOn, setCostOn] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const focusTarget = useRef<{ prefer: string | null; fallback: string | null } | null>(null);
  const manualSnapshot = useRef<CopiedSnapshot | null>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const { copy, manualText, closeManual } = useCopyText();

  // สวิตช์ต้นทุน: ค่าเริ่มปิด · จำค่าต่อเบราว์เซอร์ (localStorage ใช้ไม่ได้ = ปิดเสมอ ไม่พัง) · อ่านใน effect (SSR/hydration ไม่เห็นค่า → payload ไม่มีต้นทุน)
  useEffect(() => {
    try {
      if (window.localStorage.getItem(COST_SWITCH_STORAGE_KEY) === "1") setCostOn(true);
    } catch {
      /* localStorage ถูกบล็อก — ปิดไว้ */
    }
  }, []);
  function toggleCost(next: boolean) {
    setCostOn(next);
    try {
      window.localStorage.setItem(COST_SWITCH_STORAGE_KEY, next ? "1" : "0");
    } catch {
      /* จำค่าไม่ได้ — ใช้ได้ตามปกติ */
    }
  }
  const { state: cost, retry: retryCost } = useGemCost(costOn && tab === "pending", view.serverNow);

  const refresh = useCallback(() => startRefresh(() => router.refresh()), [router]);

  const rowsByTab = useMemo(() => ({ pending: rowsForTab(view.groups, "pending"), ordered: rowsForTab(view.groups, "ordered") }), [view.groups]);
  const tabRows = rowsByTab[tab];
  const visible = useMemo(() => sortRows(applyFilters(tabRows, filters, view.todayBkk), filters.sort), [tabRows, filters, view.todayBkk]);
  const urgentCount = useMemo(() => countUrgent(tabRows, filters, view.todayBkk), [tabRows, filters, view.todayBkk]);
  const filtered = hasActiveFilter(filters);
  const scope = resolveScope(visible, selected, tabRows.length, filtered);
  const selectedVisible = visibleSelected(selected, visible);
  const removedQty = useMemo(() => removedQtyByJobItem(view.removedAfterOrder), [view.removedAfterOrder]);
  const removedForce = useMemo(() => removedWithPendingLine(view.removedAfterOrder, rowsByTab.pending), [view.removedAfterOrder, rowsByTab.pending]);
  const typeOptions = useMemo(() => [...new Map(view.groups.map((g) => [g.typeId, g.typeName] as const)).entries()].sort((a, b) => a[1].localeCompare(b[1], "th")), [view.groups]);
  const shapeOptions = useMemo(() => [...new Map(view.groups.map((g) => [g.shapeId, g.shapeName] as const)).entries()].sort((a, b) => a[1].localeCompare(b[1], "th")), [view.groups]);

  // URL = tab + ตัวกรอง (replaceState ไม่ navigate · กด Back จาก /jobs/[id] แล้วตัวกรองคืน) · selection/กาง ไม่คืนโดยตั้งใจ
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.search = buildGtbQuery(tab, filters);
    window.history.replaceState(window.history.state, "", url);
  }, [tab, filters]);

  // ข้อมูลใหม่: ตัดรายการที่เลือกแต่หายไปจากแท็บนี้แล้ว (กัน "ติ๊กของที่ไม่ได้ตั้งใจหลังข้อมูลเปลี่ยน")
  useEffect(() => {
    setSelected((prev) => {
      const valid = new Set(tabRows.map((r) => r.key));
      const next = [...prev].filter((k) => valid.has(k));
      return next.length === prev.size ? prev : new Set(next);
    });
  }, [tabRows]);

  // หลังข้อมูลโหลดใหม่: focus ไปปุ่ม "▾ ดูใบ" ของแถวถัดไป (ไม่มี → แท็บที่เลือกอยู่)
  useEffect(() => {
    const f = focusTarget.current;
    if (!f) return;
    focusTarget.current = null;
    const find = (key: string | null): HTMLElement | null => {
      if (key === null) return null;
      const els = [`gtb-t-expand-${key}`, `gtb-c-expand-${key}`].map((id) => document.getElementById(id)).filter((e): e is HTMLElement => e !== null);
      return els.find((e) => e.offsetParent !== null) ?? els[0] ?? null;
    };
    (find(f.prefer) ?? find(f.fallback) ?? document.getElementById(`gtb-tab-${tab}`))?.focus();
  }, [view, tab]);

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = selectedVisible.length > 0 && selectedVisible.length < visible.length;
  }, [selectedVisible.length, visible.length]);

  // ---------------------------------------------------------------------------
  // ติ๊ก / ยกเลิก / ย้อนกลับ
  // ---------------------------------------------------------------------------
  async function runMark(o: MarkOpts): Promise<void> {
    if (o.lineIds.length === 0) {
      // ไม่มี line เข้าเงื่อนไข: expected = null แปลว่าข้อมูลยอดต่อ line ไม่ครบ · ไม่ใช่ = ไม่มีอะไรต้องทำแล้ว (ข้อมูลบนจอเก่า) → โหลดใหม่
      push(o.expected === null ? MARK_MULTI_LINE_MESSAGE : MARK_NOTHING_MESSAGE, "error");
      refresh();
      return;
    }
    if (o.lineIds.length > GTB_MAX_LINES_PER_MARK) {
      push(o.tooMany, "error");
      return;
    }
    // ติ๊กต้องมี expected ครบทุก line — สร้างไม่ได้ (ใบหลาย line) = ไม่ยิง (ไม่แบ่งยอดเดา)
    if (o.ordered && !o.expected) {
      push(MARK_MULTI_LINE_MESSAGE, "error");
      return;
    }
    setBusyKeys((p) => addAll(p, o.busy));
    let res: Awaited<ReturnType<typeof markGemPurchase>> | null;
    try {
      res = await markGemPurchase(o.ordered ? { lineIds: o.lineIds, ordered: true, expected: o.expected as Record<string, number> } : { lineIds: o.lineIds, ordered: false });
    } catch {
      res = null;
    }
    setBusyKeys((p) => removeAll(p, o.busy));
    if (!res || !res.ok) {
      // all-or-nothing ล้ม (ใบปิด/ขั้นฝังรับแล้ว/ไม่พบ/ยอดเปลี่ยน): ไม่มีแถวไหนถูกทำเครื่องหมาย → แจ้ง + โหลดข้อมูลใหม่ (ไม่ข้ามแถวแล้วทำที่เหลือ)
      focusTarget.current = null;
      push(res ? markFailureMessage(res.code, o.afterCopy === true) : MARK_FAILED_MESSAGE, "error");
      refresh();
      return;
    }
    const d = res.data;
    focusTarget.current = o.focus ?? { prefer: null, fallback: null };
    // แถบหลังคัดลอกอยู่ต่อจนผู้ใช้กด/ปิดเอง/คัดลอกใหม่ (snapshot + expected + qty_changed กันยอดเก่าเองแล้ว) — หายเมื่อกดติ๊กจากแถบนั้นสำเร็จเท่านั้น
    if (o.afterCopy) setCopied(null);
    if (o.clearKeys) setSelected((p) => removeAll(p, o.clearKeys as string[]));
    refresh();
    const verb = o.ordered ? "ทำเครื่องหมายสั่งแล้ว" : "ยกเลิกสั่งแล้ว";
    // 🔴 ปุ่มย้อนตัดสินจาก "ผลของ server" (prevOrderedQty ต่อแถว + เปลี่ยนครบ) — ไม่ใช้ isOrdered ระดับใบของ summary (ใบผสมตัดสินผิด)
    const plan = undoPlanFromResult(o.ordered, d);
    let message = `${verb}: ${o.subject}`;
    if (d.changed === 0) message += " — มีคนทำไว้แล้ว ไม่มีอะไรเปลี่ยน";
    else if (!plan) message += ` — ย้อนกลับด้วยปุ่มไม่ได้ ใช้แท็บ${o.ordered ? "สั่งแล้ว" : "ยังไม่สั่ง"}แทน`;
    push(message, "success", plan ? { action: { label: "ย้อนกลับ", onClick: () => void runMark({ ...o, ordered: plan.ordered, expected: plan.expected, clearKeys: undefined, focus: undefined, afterCopy: false }) } } : undefined);
  }

  const nextKeyAfter = (key: string): string | null => {
    const i = visible.findIndex((r) => r.key === key);
    return i >= 0 && i + 1 < visible.length ? visible[i + 1].key : null;
  };
  const markTo = tab === "pending";

  // 🔴 ทุกทางเรียก markTargetForJobs ตัวเดียว → { lineIds, expected } ชุดเดียวกันเป๊ะ (เฉพาะ line ที่เข้าเงื่อนไขของแท็บนั้น)
  function actRow(row: GtbRow) {
    const t = markTargetForJobs(row.jobs, markTo);
    void runMark({
      lineIds: t.lineIds,
      ordered: markTo,
      busy: [row.key],
      subject: `${row.group.label} (${row.jobs.length} ใบ)`,
      tooMany: MARK_TOO_MANY_GROUP_MESSAGE,
      clearKeys: [row.key],
      focus: { prefer: row.key, fallback: nextKeyAfter(row.key) },
      expected: t.expected,
    });
  }
  function actJob(row: GtbRow, job: GtbJob) {
    const t = markTargetForJobs([job], markTo);
    void runMark({
      lineIds: t.lineIds,
      ordered: markTo,
      busy: [`${row.key}:${job.jobId}`],
      subject: `${job.jobNo} · ${row.group.label}`,
      tooMany: MARK_TOO_MANY_GROUP_MESSAGE,
      focus: { prefer: row.key, fallback: nextKeyAfter(row.key) },
      expected: t.expected,
    });
  }
  function actSelected() {
    const rows = selectedVisible;
    const t = markTargetForJobs(rows.flatMap((r) => r.jobs), markTo);
    void runMark({
      lineIds: t.lineIds,
      ordered: markTo,
      busy: ["*"],
      subject: `${rows.length} รายการ (${distinctJobCount(rows)} ใบ)`,
      tooMany: MARK_TOO_MANY_BULK_MESSAGE,
      clearKeys: rows.map((r) => r.key),
      focus: { prefer: null, fallback: null },
      expected: t.expected,
    });
  }

  // ---------------------------------------------------------------------------
  // คัดลอก
  // ---------------------------------------------------------------------------
  async function onCopy() {
    const rows = scope.rows;
    const text = buildGemOrderText(toGemOrderLines(rows), { dateLabel: gemOrderDateLabel(view.todayBkk) });
    if (text === "") return;
    // snapshot ยอดต่อ line ณ ตอนคัดลอก (= ยอดที่ส่งร้านจริง) — ปุ่มติ๊กในแถบถามใช้ยอดนี้ ไม่ใช่ยอดสดตอนกด
    const target = markTargetForJobs(rows.flatMap((r) => r.jobs), true);
    const snapshot: CopiedSnapshot = { lineIds: target.lineIds, expected: target.expected ?? null, count: rows.length };
    const ok = await copy(text);
    if (!ok) {
      // modal "คัดลอกเอง" เปิดแล้ว — ถามว่าส่งแล้วหรือยังตอนผู้ใช้ปิด modal (ถือว่าคัดลอกเองแล้ว)
      manualSnapshot.current = snapshot;
      return;
    }
    setCopied(snapshot);
    const msg = scope.kind === "filtered" ? `คัดลอก ${rows.length} จาก ${scope.total} รายการ (ตามตัวกรอง)` : scope.kind === "selected" ? `คัดลอกที่เลือก ${rows.length} รายการแล้ว` : `คัดลอก ${rows.length} รายการแล้ว`;
    push(msg);
  }
  function markCopied() {
    if (!copied) return;
    void runMark({
      lineIds: copied.lineIds,
      ordered: true,
      busy: ["*"],
      subject: `${copied.count} รายการ`,
      tooMany: MARK_TOO_MANY_BULK_MESSAGE,
      clearKeys: undefined,
      focus: { prefer: null, fallback: null },
      expected: copied.expected,
      afterCopy: true,
    });
  }
  function closeManualCopy() {
    closeManual();
    if (manualSnapshot.current) {
      setCopied(manualSnapshot.current);
      manualSnapshot.current = null;
    }
  }

  // ---------------------------------------------------------------------------
  // แท็บ / ตัวกรอง / เลือก
  // ---------------------------------------------------------------------------
  function selectTab(t: GtbTab) {
    setTab(t);
    setSelected(new Set());
    setCopied(null);
  }
  function onTabKey(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const last = TABS.length - 1;
    const next = e.key === "ArrowRight" ? (i === last ? 0 : i + 1) : e.key === "ArrowLeft" ? (i === 0 ? last : i - 1) : e.key === "Home" ? 0 : e.key === "End" ? last : null;
    if (next === null) return;
    e.preventDefault();
    selectTab(TABS[next].key);
    document.getElementById(`gtb-tab-${TABS[next].key}`)?.focus();
  }
  function changeFilters(patch: Partial<GtbFilters>) {
    setFilters((f) => ({ ...f, ...patch }));
    setCopied(null);
  }
  function clearFilters() {
    setFilters(GTB_EMPTY_FILTERS);
    setCopied(null);
  }
  function toggleSelect(key: string) {
    const next = toggleIn(selected, key);
    setSelected(next);
    setAnnounce(`เลือกอยู่ ${visible.filter((r) => next.has(r.key)).length} รายการ`);
  }
  function toggleAll(on: boolean) {
    const next = on ? addAll(selected, visible.map((r) => r.key)) : removeAll(selected, visible.map((r) => r.key));
    setSelected(next);
    setAnnounce(`เลือกอยู่ ${visible.filter((r) => next.has(r.key)).length} รายการ`);
  }

  const clock = serverClock(view.serverNow);
  const listProps = {
    rows: visible,
    tab,
    sort: filters.sort,
    todayBkk: view.todayBkk,
    selected,
    expanded,
    moreJobs,
    busyKeys,
    removedQty,
    cost,
    onToggleSelect: toggleSelect,
    onToggleExpand: (k: string) => setExpanded((p) => toggleIn(p, k)),
    onShowAllJobs: (k: string) => setMoreJobs((p) => addAll(p, [k])),
    onActRow: actRow,
    onActJob: actJob,
  };

  function emptyBody() {
    if (tabRows.length > 0) {
      return (
        <EmptyState
          icon={Diamond}
          title="ไม่พบรายการที่ตรงกับตัวกรอง"
          action={
            <Button type="button" variant="secondary" onClick={clearFilters}>
              ล้างตัวกรอง
            </Button>
          }
        />
      );
    }
    if (tab === "ordered") {
      return <EmptyState icon={Diamond} title="ยังไม่มีรายการที่ทำเครื่องหมายว่าสั่งแล้ว" description="จะแสดงเฉพาะใบที่ยังเปิดและยังไม่รับพลอย — ใบที่รับพลอยแล้วจะหายไปเอง" />;
    }
    if (view.unspecifiedJobs.length > 0) {
      // ว่างแต่มีใบไม่ระบุพลอย: ห้ามบอกว่า "ไม่ต้องสั่งอะไร"
      return <EmptyState icon={Diamond} title="ยังไม่มีรายการพลอยให้สั่ง" description={`แต่มี ${view.unspecifiedJobs.length} ใบที่ยังไม่ได้ใส่พลอย (ดูด้านบน)`} />;
    }
    if (rowsByTab.ordered.length > 0) {
      return (
        <EmptyState
          icon={CheckCircle2}
          title="สั่งครบแล้ว"
          description="ทุกรายการที่ต้องใช้ถูกทำเครื่องหมายว่าสั่งแล้ว"
          action={
            <Button type="button" variant="secondary" onClick={() => selectTab("ordered")}>
              ดูรายการที่สั่งแล้ว
            </Button>
          }
        />
      );
    }
    return <EmptyState icon={Diamond} title="ไม่มีพลอยที่ต้องใช้ตอนนี้" description="ใบงานที่เปิดอยู่ไม่มีพลอยที่ยังไม่สั่ง" />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-zinc-900">พลอยที่ต้องสั่งซื้อ</h1>
          <p className="mt-0.5 text-sm text-zinc-700" data-testid="gtb-asof">
            ข้อมูล ณ {clock === "" ? "—" : `${clock} น.`}
          </p>
        </div>
        <Button type="button" variant="secondary" loading={refreshing} onClick={refresh}>
          {!refreshing && <RefreshCw className="h-4 w-4" aria-hidden="true" />}
          รีเฟรช
        </Button>
      </div>

      {/* บรรทัดคงที่ — ปิดไม่ได้ (G1: ยอดคือ "ต้องใช้" ไม่ใช่ "ต้องสั่ง") */}
      <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-800">
        <p>
          <span aria-hidden="true">ⓘ </span>
          ยอดที่ใบงานต้องใช้ — ยังไม่หักพลอยที่มีในร้าน เทียบของที่มีก่อนสั่ง · ไม่เผื่อแตก
          <button type="button" aria-expanded={detailsOpen} aria-controls="gtb-details" onClick={() => setDetailsOpen((v) => !v)} className="ml-2 min-h-11 rounded-md px-2 font-semibold text-primary-700 underline underline-offset-2">
            รายละเอียด {detailsOpen ? "▴" : "▾"}
          </button>
        </p>
        {detailsOpen && (
          <ul id="gtb-details" className="mt-1 list-disc space-y-1 pl-5">
            <li>ยอดคิดจากจำนวนเริ่มผลิตของแต่ละใบ × จำนวนพลอยต่อชิ้น (ใบที่เปิดสวิตช์ &quot;เผื่อของเสีย&quot; มีเผื่อชิ้นอยู่ในจำนวนเริ่มผลิตแล้ว)</li>
            <li>ไม่หักพลอยที่มีในร้าน และไม่เผื่อพลอยแตกเพิ่ม</li>
            <li>รายการหายเองเมื่อช่างรับขั้นฝังพลอยของใบนั้น</li>
            <li>ต้นทุนประมาณใช้ราคาล่าสุด ณ วันนี้ — ยอดไม่หักของในร้าน ไม่เผื่อแตก</li>
          </ul>
        )}
      </div>

      <RemovedAfterOrderNotice items={view.removedAfterOrder} forceShowKeys={removedForce} />

      <div role="tablist" aria-label="สถานะการสั่งพลอย" className="flex gap-1 border-b border-zinc-200">
        {TABS.map((t, i) => (
          <button
            key={t.key}
            id={`gtb-tab-${t.key}`}
            role="tab"
            type="button"
            aria-selected={tab === t.key}
            aria-controls={`gtb-panel-${t.key}`}
            tabIndex={tab === t.key ? 0 : -1}
            onClick={() => selectTab(t.key)}
            onKeyDown={(e) => onTabKey(e, i)}
            className={`min-h-11 rounded-t-md px-4 text-sm font-semibold ${tab === t.key ? "border-b-2 border-primary-600 bg-primary-50 text-primary-700" : "text-zinc-700 hover:bg-zinc-100"}`}
          >
            {t.label} <span className="tabular-nums">{rowsByTab[t.key].length}</span>
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`gtb-panel-${tab}`} aria-labelledby={`gtb-tab-${tab}`} aria-busy={refreshing || undefined} className="space-y-3">
        {tab === "pending" && <UnspecifiedJobsNotice jobs={view.unspecifiedJobs} />}

        <GemsToBuyFilters
          filters={filters}
          typeOptions={typeOptions}
          shapeOptions={shapeOptions}
          urgentCount={urgentCount}
          onChange={changeFilters}
          onClear={clearFilters}
          costSwitch={tab === "pending" ? <SwitchField id="gtb-cost" checked={costOn} onChange={toggleCost} label="ต้นทุนประมาณ" /> : undefined}
        />

        {cost.status === "error" && <ErrorBanner message="โหลดต้นทุนไม่ได้" onRetry={retryCost} />}

        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-zinc-800">
          <p className="tabular-nums" data-testid="gtb-count">
            {visible.length} รายการ · จาก {distinctJobCount(visible)} ใบ
          </p>
          {visible.length > 0 && (
            <label className="flex min-h-11 cursor-pointer items-center gap-2 font-medium">
              <input ref={selectAllRef} type="checkbox" className="h-5 w-5 accent-primary-600" checked={selectedVisible.length === visible.length} onChange={(e) => toggleAll(e.target.checked)} />
              เลือกที่เห็นทั้งหมด
            </label>
          )}
        </div>

        <GemsToBuyActionBar tab={tab} scope={scope} selectedCount={selectedVisible.length} busy={busyKeys.has("*")} onCopy={() => void onCopy()} onMarkSelected={actSelected} onClearSelection={() => setSelected(new Set())} />

        {tab === "pending" && copied && <CopiedNudge count={copied.count} busy={busyKeys.has("*")} onMark={markCopied} onDismiss={() => setCopied(null)} />}

        {visible.length === 0 ? (
          emptyBody()
        ) : (
          <>
            <GemsToBuyTable {...listProps} />
            <GemsToBuyCard {...listProps} />
            {tab === "pending" && <GemCostTotals cost={cost} rowCount={tabRows.length} filtered={filtered} />}
            <p aria-live="polite" className="text-sm text-zinc-700 tabular-nums">
              แสดง {visible.length} จาก {tabRows.length} รายการ
            </p>
          </>
        )}
      </div>

      <p role="status" className="sr-only">
        {announce}
      </p>
      <ManualCopyDialog text={manualText} onClose={closeManualCopy} />
    </div>
  );
}
