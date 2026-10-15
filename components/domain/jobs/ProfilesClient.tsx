"use client";

// ProfilesClient — หน้า "แบบการบันทึก" (/jobs/profiles · owner/admin): รายการ + ตัวแก้ไข (ไม่มี route [id] — state editing)
// PC ≥ 1024: 2 คอลัมน์ (รายการ 360px | ตัวแก้ไข) · ต่ำกว่า: ตัวแก้ไขแทนรายการ + "← กลับรายการ"
// state ครบ 4: loading (skeleton role=status) · error (ลองใหม่) · empty (ยังไม่มีแบบ) · success (รายการ)
// ไม่ตัดสินกติกาเอง — ค่าเริ่ม/ปิดแบบ/ขั้นไม่มีโลหะ DB เป็นด่านจริง · ไม่มีน้ำหนัก/ราคาในหน้านี้

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ListChecks, Plus } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { DiscardDialog } from "@/components/domain/jobs/ProfileDialogs";
import { ProfileEditor } from "@/components/domain/jobs/ProfileEditor";
import type { EditorSeed } from "@/components/domain/jobs/ProfileEditor";
import { ProfileSummary } from "@/components/domain/jobs/ProfileSummary";
import { listProfiles } from "@/lib/actions/job-profiles";
import { GENERIC_JOB_ERROR } from "@/lib/jobs/messages";
import type { ProfilesData, RecordProfile } from "@/lib/jobs/profile";

type Load = { s: "loading" } | { s: "error"; message: string } | { s: "ready"; data: ProfilesData };
type Target = { id: string | "new" | null; seed: EditorSeed | null };

export function ProfilesClient() {
  const [load, setLoad] = useState<Load>({ s: "loading" });
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [seed, setSeed] = useState<EditorSeed | null>(null);
  const [version, setVersion] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState<Target | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const fetchData = useCallback(async (): Promise<Load> => {
    try {
      const r = await listProfiles();
      return r.ok ? { s: "ready", data: r.data } : { s: "error", message: r.error };
    } catch {
      return { s: "error", message: GENERIC_JOB_ERROR };
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchData().then((l) => {
      if (!cancelled) setLoad(l);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchData]);

  /** โหลดใหม่หลังบันทึก/ตั้งค่าเริ่ม — ล้ม = คงรายการเดิม + แจ้ง (ไม่ทิ้งหน้า) */
  const reload = useCallback(async () => {
    const l = await fetchData();
    if (l.s === "ready") {
      setLoad(l);
      setRefreshFailed(false);
    } else setRefreshFailed(true);
  }, [fetchData]);

  const retry = () => {
    setLoad({ s: "loading" });
    void fetchData().then(setLoad);
  };

  const apply = (t: Target) => {
    setEditing(t.id);
    setSeed(t.seed);
    setVersion((v) => v + 1);
    setDirty(false);
    setPending(null);
  };
  const request = (t: Target) => {
    // กดแถวเดิมซ้ำ = ไม่ทำอะไร (ไม่ล้างสิ่งที่แก้ค้าง)
    if (t.id !== null && t.id !== "new" && t.id === editing && t.seed === null) return;
    if (dirty) setPending(t);
    else apply(t);
  };
  const onDirtyChange = useCallback((d: boolean) => setDirty(d), []);

  const data = load.s === "ready" ? load.data : null;
  const defs = useMemo(() => (data ? data.stageDefs : []), [data]);
  const inactive = data ? data.profiles.filter((p) => !p.isActive) : [];
  const shown = data ? data.profiles.filter((p) => p.isActive || showInactive) : [];
  const nameById = (id: string | null) => data?.profiles.find((p) => p.id === id)?.name ?? null;
  const current: RecordProfile | null = data && editing && editing !== "new" ? (data.profiles.find((p) => p.id === editing) ?? null) : null;

  return (
    <div className="space-y-4 pb-24 lg:pb-0">
      <header className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-bold text-zinc-900">แบบการบันทึก</h1>
          <Button type="button" onClick={() => request({ id: "new", seed: null })} disabled={load.s !== "ready"}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            สร้างแบบใหม่
          </Button>
        </div>
        <p className="text-sm text-zinc-700">กำหนดว่าแต่ละขั้นช่างต้องชั่ง/บันทึกอะไร — เลือกตอนสร้างใบงาน</p>
      </header>

      {load.s === "loading" && (
        <div role="status" aria-label="กำลังโหลดแบบการบันทึก" className="space-y-2">
          <p className="text-sm text-zinc-700">กำลังโหลดแบบการบันทึก…</p>
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      )}
      {load.s === "error" && <ErrorState message={load.message} onRetry={retry} />}

      {data && (
        <>
          <section aria-label="ค่าเริ่มตอนสร้างใบงาน" className="rounded-lg border border-zinc-200 bg-white p-3 text-sm text-zinc-800">
            <p className="font-semibold text-zinc-900">ค่าเริ่มตอนสร้างใบงาน</p>
            <p>งานทั่วไป (ไม่ใช่ทอง): {nameById(data.defaultProfileId) ?? "—"}</p>
            <p>งานทอง: {nameById(data.defaultGoldProfileId) ?? "ใช้ตามงานทั่วไป"}</p>
          </section>
          {data.defaultProfileId === null && (
            <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-sm font-medium text-amber-900">
              ยังไม่ได้ตั้งค่าเริ่มของงานทั่วไป — สร้างใบงานไม่ได้
            </p>
          )}
          {refreshFailed && (
            <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-2.5 text-sm font-medium text-red-800">
              โหลดรายการใหม่ไม่สำเร็จ — ที่เห็นอาจไม่ล่าสุด{" "}
              <button type="button" className="underline" onClick={() => void reload()}>
                ลองใหม่
              </button>
            </p>
          )}

          {data.profiles.length === 0 ? (
            <EmptyState
              icon={ListChecks}
              title="ยังไม่มีแบบการบันทึก"
              description="สร้างแบบแรกเพื่อกำหนดว่าขั้นไหนช่างต้องชั่งหรือแจ้งของเสีย"
              action={
                <Button type="button" onClick={() => request({ id: "new", seed: null })}>
                  สร้างแบบใหม่
                </Button>
              }
            />
          ) : (
            <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
              <section aria-label="รายการแบบการบันทึก" className={editing !== null ? "hidden lg:block" : "block"}>
                <ul className="space-y-2">
                  {shown.map((p) => {
                    const on = editing === p.id;
                    return (
                      <li key={p.id}>
                        <button
                          type="button"
                          aria-current={on ? "true" : undefined}
                          onClick={() => request({ id: p.id, seed: null })}
                          className={`block min-h-11 w-full rounded-lg border p-3 text-left ${on ? "border-primary-600 bg-primary-50" : "border-zinc-200 bg-white hover:bg-zinc-50"} ${p.isActive ? "" : "opacity-70"}`}
                        >
                          <span className="block text-base font-semibold break-words text-zinc-900">{p.name}</span>
                          <span className="mt-1 flex flex-wrap gap-1">
                            {p.isDefault && <Badge tone="green">ค่าเริ่ม · งานทั่วไป</Badge>}
                            {p.isDefaultGold && <Badge tone="amber">ค่าเริ่ม · งานทอง</Badge>}
                            {!p.isActive && <Badge tone="slate">ปิดใช้งาน</Badge>}
                          </span>
                          <ProfileSummary defs={defs} flags={p.stages} className="mt-1" />
                          {p.jobsOpen > 0 && <span className="mt-0.5 block text-xs text-zinc-700">ใช้กับใบที่เปิดอยู่ {p.jobsOpen}</span>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {inactive.length > 0 && (
                  <button type="button" aria-expanded={showInactive} onClick={() => setShowInactive((v) => !v)} className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-primary-700 underline">
                    {showInactive ? "ซ่อน" : "แสดง"}แบบที่ปิดใช้ ({inactive.length})
                  </button>
                )}
              </section>

              <section aria-label="ตัวแก้ไขแบบการบันทึก" className={editing === null ? "hidden lg:block" : "block"}>
                {editing === null ? (
                  <p className="rounded-lg border border-dashed border-zinc-300 bg-white p-6 text-center text-sm text-zinc-700">เลือกแบบทางซ้ายเพื่อแก้ หรือกด “สร้างแบบใหม่”</p>
                ) : editing !== "new" && current === null ? (
                  <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-2.5 text-sm font-medium text-red-800">
                    ไม่พบแบบนี้แล้ว — เลือกจากรายการ
                  </p>
                ) : (
                  <div className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4">
                    <Button type="button" variant="ghost" size="sm" className="lg:hidden" onClick={() => request({ id: null, seed: null })}>
                      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                      กลับรายการ
                    </Button>
                    <ProfileEditor
                      key={`${editing}:${version}`}
                      profile={current}
                      seed={editing === "new" ? seed : null}
                      defs={defs}
                      onDirtyChange={onDirtyChange}
                      onSaved={(p) => {
                        void reload().then(() => {
                          setEditing(p.id);
                          setSeed(null);
                          setVersion((v) => v + 1);
                          setDirty(false);
                        });
                      }}
                      onChanged={() => {
                        void reload().then(() => setVersion((v) => v + 1));
                      }}
                      onClone={(s) => apply({ id: "new", seed: s })}
                      onCancel={() => request({ id: null, seed: null })}
                    />
                  </div>
                )}
              </section>
            </div>
          )}
        </>
      )}

      {pending && <DiscardDialog onStay={() => setPending(null)} onDiscard={() => apply(pending)} />}
    </div>
  );
}
