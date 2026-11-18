"use client";

// หลังบ้านออกแบบแหวน (/catalog/ring-builder) — 3 แท็บ: พลอย (ราคาขาย) · แบบแหวน · ตรวจรหัสสั่งทำ · แท็บเก็บใน ?tab=
// ข้อมูลแคตตาล็อกโหลดจาก server ครั้งแรก · หลังแก้ทุกครั้งเรียก getRingBuilderAdmin ใหม่ (ไม่มีสูตรเงินฝั่ง client)
// แท็บ "ตรวจรหัส" ไม่พึ่งแคตตาล็อก — ใช้ได้แม้โหลดแคตตาล็อกไม่สำเร็จ
import { useCallback, useState } from "react";
import type { KeyboardEvent } from "react";
import { ErrorBanner, ErrorState } from "@/components/ui/ErrorState";
import { getRingBuilderAdmin } from "@/lib/actions/ring-builder";
import type { AdminCatalog } from "@/lib/ring-builder/admin-types";
import { RING_ADMIN_TABS, ringErrorText } from "@/lib/ring-builder/admin-ui";
import type { RingAdminTab } from "@/lib/ring-builder/admin-ui";
import { Skeleton } from "@/components/ui/Skeleton";
import { DesignsTab } from "./DesignsTab";
import { GemsTab } from "./GemsTab";
import { VerifyTab } from "./VerifyTab";

export function RingBuilderAdminClient({ initial, initialError, initialTab }: { initial: AdminCatalog | null; initialError: string | null; initialTab: RingAdminTab }) {
  const [tab, setTab] = useState<RingAdminTab>(initialTab);
  const [catalog, setCatalog] = useState<AdminCatalog | null>(initial);
  const [error, setError] = useState<string | null>(initialError);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getRingBuilderAdmin();
      if (res.ok) {
        setCatalog(res.data);
        setError(null);
      } else setError(ringErrorText(res));
    } catch {
      setError("โหลดข้อมูลไม่สำเร็จ ลองใหม่อีกครั้ง");
    } finally {
      setLoading(false);
    }
  }, []);

  function select(t: RingAdminTab) {
    setTab(t);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (t === "gems") url.searchParams.delete("tab");
      else url.searchParams.set("tab", t);
      window.history.replaceState(window.history.state, "", url);
    }
  }
  function onTabKey(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const last = RING_ADMIN_TABS.length - 1;
    const next = e.key === "ArrowRight" ? (i === last ? 0 : i + 1) : e.key === "ArrowLeft" ? (i === 0 ? last : i - 1) : e.key === "Home" ? 0 : e.key === "End" ? last : null;
    if (next === null) return;
    e.preventDefault();
    select(RING_ADMIN_TABS[next].key);
    document.getElementById(`rb-tab-${RING_ADMIN_TABS[next].key}`)?.focus();
  }

  return (
      <div className="space-y-4">
        <div>
          <h1 className="text-lg font-bold text-zinc-900">ออกแบบแหวน</h1>
          <p className="mt-0.5 text-sm text-zinc-700">พลอย แบบแหวน และราคาขายของหน้าออกแบบแหวนที่ลูกค้าใช้ · เจ้าของร้าน/แอดมินเท่านั้น</p>
        </div>

        <div role="tablist" aria-label="หมวดออกแบบแหวน" className="flex gap-1 overflow-x-auto border-b border-zinc-200">
          {RING_ADMIN_TABS.map((t, i) => (
            <button
              key={t.key}
              id={`rb-tab-${t.key}`}
              role="tab"
              type="button"
              aria-selected={tab === t.key}
              aria-controls={`rb-panel-${t.key}`}
              tabIndex={tab === t.key ? 0 : -1}
              onClick={() => select(t.key)}
              onKeyDown={(e) => onTabKey(e, i)}
              className={`-mb-px min-h-11 whitespace-nowrap border-b-2 px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 ${tab === t.key ? "border-primary-600 text-primary-800" : "border-transparent text-zinc-600 hover:text-zinc-900"}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div role="tabpanel" id={`rb-panel-${tab}`} aria-labelledby={`rb-tab-${tab}`} aria-busy={loading}>
          {tab === "verify" ? (
            <VerifyTab />
          ) : catalog === null ? (
            error === null || loading ? (
              <div role="status" aria-label="กำลังโหลด" className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : (
              <ErrorState message={error} onRetry={() => void reload()} />
            )
          ) : (
            <div className="space-y-3">
              {error && <ErrorBanner message={`${error} (ข้อมูลที่เห็นอาจไม่ใช่ล่าสุด)`} onRetry={() => void reload()} />}
              {loading && <p role="status" className="text-xs text-zinc-600">กำลังอัปเดตข้อมูล…</p>}
              {tab === "gems" ? <GemsTab catalog={catalog} onChanged={reload} /> : <DesignsTab catalog={catalog} onChanged={reload} />}
            </div>
          )}
        </div>
      </div>
  );
}
