"use client";

// HeroStockClient — /stock/hero live stock counter (ops-plan-99 §1). The
// admin opens this on a phone next to the live-stream screen; the whole point
// is a huge, color-coded "available" number per hero SKU that's readable at
// arm's length, auto-refreshing while quick-order writes deplete stock.
// Owner/admin only (page gates before rendering). Reads are server-fetched;
// this component re-pulls via router.refresh() on a timer + manual button +
// after every add/remove mutation.

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Gauge, Pencil, PlusCircle, RefreshCw, Trash2 } from "lucide-react";
import type { ProductRow } from "@/lib/catalog/types";
import type { HeroStockRow } from "@/lib/stock/types";
import { removeHeroWatch } from "@/lib/actions/hero-stock";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { EmptyState } from "@/components/ui/EmptyState";
import { useToast } from "@/components/ui/Toast";
import { HeroWatchForm } from "./HeroWatchForm";

const AUTO_REFRESH_MS = 10_000;

type StockState = "out" | "low" | "ok";

function stockState(row: HeroStockRow): StockState {
  if (row.isOut) return "out";
  if (row.isLow) return "low";
  return "ok";
}

const STATE_CARD_CLASSES: Record<StockState, string> = {
  out: "border-red-400 bg-red-50",
  low: "border-amber-400 bg-amber-50",
  ok: "border-green-300 bg-white",
};
const STATE_NUMBER_CLASSES: Record<StockState, string> = {
  out: "text-red-600",
  low: "text-amber-600",
  ok: "text-green-700",
};
const STATE_LABEL_TH: Record<StockState, string> = {
  out: "หมดสต็อก",
  low: "ใกล้หมด",
  ok: "ปกติ",
};
const STATE_BADGE_TONE = { out: "red", low: "amber", ok: "green" } as const;

function fmtTime(d: Date): string {
  return d.toLocaleTimeString("th-TH", { hour12: false });
}

export function HeroStockClient({ rows, products }: { rows: HeroStockRow[]; products: ProductRow[] }) {
  const router = useRouter();
  const toast = useToast();

  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [refreshPending, startRefresh] = useTransition();

  const [formOpen, setFormOpen] = useState(false);
  const [formProductId, setFormProductId] = useState<string | undefined>(undefined);

  const [removing, setRemoving] = useState<HeroStockRow | undefined>(undefined);
  const [removePending, startRemove] = useTransition();

  // rows is a fresh array every time the server re-renders this page (initial
  // load, manual refresh, or the auto-refresh timer below) — mark "now" as
  // the last-updated time whenever that happens.
  useEffect(() => {
    setLastUpdated(new Date());
  }, [rows]);

  const doRefresh = useCallback(() => {
    startRefresh(() => {
      router.refresh();
    });
  }, [router]);

  // Auto-refresh: only runs while the toggle is on; interval is created and
  // torn down inside the same effect run, so flipping the toggle off (or
  // unmounting, e.g. navigating away) always clears the pending timer —
  // no leaked interval, no refresh calls after the toggle is off.
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => {
      router.refresh();
    }, AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, [autoRefresh, router]);

  function openAdd() {
    setFormProductId(undefined);
    setFormOpen(true);
  }
  function openEdit(row: HeroStockRow) {
    setFormProductId(row.productId);
    setFormOpen(true);
  }
  function closeForm() {
    setFormOpen(false);
    setFormProductId(undefined);
  }
  function handleFormDone() {
    closeForm();
    router.refresh();
  }

  function confirmRemove() {
    if (!removing) return;
    const productId = removing.productId;
    const sku = removing.sku;
    startRemove(async () => {
      const result = await removeHeroWatch(productId);
      if (!result.ok) {
        toast.push(result.error, "error");
        setRemoving(undefined);
        return;
      }
      toast.push(`เอา ${sku} ออกจากจอเฝ้าดูแล้ว`);
      setRemoving(undefined);
      router.refresh();
    });
  }

  const alertCount = rows.filter((r) => r.isLow || r.isOut).length;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-1.5 text-lg font-bold text-zinc-900">
            <Gauge className="h-5 w-5 text-primary-600" aria-hidden="true" />
            จอสต็อก Hero SKU
          </h1>
          <p className="mt-0.5 text-sm text-zinc-500">เปิดข้างจอไลฟ์ — เช็คของเหลือแบบเรียลไทม์ กันขายเกินสต็อก</p>
        </div>
        <Button type="button" variant="primary" size="sm" onClick={openAdd} className="shrink-0">
          <PlusCircle className="h-4 w-4" aria-hidden="true" />
          เพิ่ม SKU
        </Button>
      </div>

      {alertCount > 0 && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2.5 text-sm font-semibold text-red-800"
        >
          <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />
          {alertCount} SKU ใกล้หมด/หมดสต็อก — ระวังตอนไลฟ์
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-500">
        <span>
          อัปเดตล่าสุด {lastUpdated ? fmtTime(lastUpdated) : "—"}
          {refreshPending && <span className="ml-1.5 font-medium text-primary-600">กำลังอัปเดต…</span>}
        </span>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 font-medium text-zinc-600">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            รีเฟรชอัตโนมัติทุก 10 วิ
          </label>
          <button
            type="button"
            onClick={doRefresh}
            disabled={refreshPending}
            aria-label="รีเฟรชตอนนี้"
            className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${refreshPending ? "animate-spin" : ""}`} aria-hidden="true" />
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={Gauge}
          title="ยังไม่มี SKU ที่เฝ้าดู"
          description="เพิ่ม SKU 3-5 ตัวที่จะดันในไลฟ์ครั้งนี้ เพื่อดูสต็อกเหลือแบบเรียลไทม์ระหว่างไลฟ์"
          action={
            <Button type="button" variant="primary" size="sm" onClick={openAdd}>
              <PlusCircle className="h-4 w-4" aria-hidden="true" />
              เพิ่ม SKU
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {rows.map((row) => {
            const state = stockState(row);
            return (
              <div
                key={row.productId}
                className={`rounded-lg border-2 p-4 shadow-sm ${STATE_CARD_CLASSES[state]}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-zinc-800">{row.name}</p>
                    <p className="font-mono text-xs text-zinc-500">{row.sku}</p>
                  </div>
                  <Badge tone={STATE_BADGE_TONE[state]}>{STATE_LABEL_TH[state]}</Badge>
                </div>

                <p
                  className={`mt-2 text-6xl leading-none font-black tabular-nums ${STATE_NUMBER_CLASSES[state]}`}
                  aria-label={`เหลือขายได้ ${row.available} ชิ้น`}
                >
                  {row.available}
                </p>
                <p className="mt-1 text-xs text-zinc-500">ชิ้นที่ขายได้ตอนนี้</p>

                <dl className="mt-3 grid grid-cols-3 gap-1 text-xs text-zinc-500">
                  <div>
                    <dt>ในคลัง</dt>
                    <dd className="font-medium tabular-nums text-zinc-700">{row.qtyOnHand}</dd>
                  </div>
                  <div>
                    <dt>กันไว้</dt>
                    <dd className="font-medium tabular-nums text-zinc-700">{row.qtyReserved}</dd>
                  </div>
                  <div>
                    <dt>เกณฑ์เตือน</dt>
                    <dd className="font-medium tabular-nums text-zinc-700">{row.lowStockThreshold}</dd>
                  </div>
                </dl>

                {row.note && (
                  <p className="mt-2 rounded-sm bg-white/70 px-2 py-1 text-xs text-zinc-600">{row.note}</p>
                )}
                {!row.isActive && (
                  <p className="mt-2 text-xs font-medium text-red-600">SKU นี้ปิดการใช้งานอยู่ในระบบสินค้า</p>
                )}

                <div className="mt-3 flex justify-end gap-1">
                  <button
                    type="button"
                    onClick={() => openEdit(row)}
                    aria-label={`แก้ไขเกณฑ์เตือน ${row.sku}`}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                    แก้เกณฑ์
                  </button>
                  <button
                    type="button"
                    onClick={() => setRemoving(row)}
                    aria-label={`เลิกเฝ้าดู ${row.sku}`}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-zinc-400 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    เลิกเฝ้าดู
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal open={formOpen} onClose={closeForm} title={formProductId ? "แก้ไขเกณฑ์เตือน" : "เพิ่ม SKU เฝ้าดู"}>
        <HeroWatchForm
          products={products}
          existingRows={rows}
          initialProductId={formProductId}
          onDone={handleFormDone}
          onCancel={closeForm}
        />
      </Modal>

      <Modal open={Boolean(removing)} onClose={() => setRemoving(undefined)} title="เลิกเฝ้าดู SKU">
        <div className="flex flex-col gap-3">
          <p className="text-sm text-zinc-700">
            เลิกเฝ้าดู <span className="font-mono font-semibold">{removing?.sku}</span> ({removing?.name}) ใช่ไหม?
          </p>
          <p className="rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-500">
            สต็อกจริงในระบบไม่หายไป แค่เอาการ์ดนี้ออกจากจอเฝ้าดู เพิ่มกลับมาดูได้ทุกเมื่อ
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setRemoving(undefined)} disabled={removePending}>
              ยกเลิก
            </Button>
            <Button type="button" variant="danger" onClick={confirmRemove} loading={removePending}>
              เลิกเฝ้าดู
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
