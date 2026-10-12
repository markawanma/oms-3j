"use client";

// JobCreatePanel — ส่วน "ใบงานผลิต" ท้ายหน้าใบเสนอราคา OEM (won) และใบผลิต: รายการละหนึ่งแถว → มีใบงานแล้วลิงก์ไป / ยังไม่มีให้กดสร้าง
// แยกเป็นส่วนของตัวเอง (ไม่แตะ logic ของหน้าเดิม) · 4 state: loading / error (+ลองใหม่) / empty / success

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { JobCreateDialog } from "@/components/domain/jobs/JobCreateDialog";
import { getJobsForSourceItems } from "@/lib/actions/job-office";
import type { SourceJob } from "@/lib/actions/job-office";
import { GENERIC_JOB_ERROR } from "@/lib/jobs/messages";
import { JOB_STATUS_LABEL } from "@/lib/jobs/types";

export interface JobCreateItem {
  id: string;
  label: string;
}

type Load = { s: "loading" } | { s: "error"; message: string } | { s: "ready"; jobs: SourceJob[] };

export function JobCreatePanel({ kind, items }: { kind: "oem" | "production"; items: JobCreateItem[] }) {
  const [load, setLoad] = useState<Load>({ s: "loading" });
  const [target, setTarget] = useState<JobCreateItem | null>(null);
  const idsKey = items.map((i) => i.id).join(",");

  const fetchJobs = useCallback(async () => {
    try {
      const r = await getJobsForSourceItems(kind, idsKey === "" ? [] : idsKey.split(","));
      setLoad(r.ok ? { s: "ready", jobs: r.data } : { s: "error", message: r.error });
    } catch {
      setLoad({ s: "error", message: GENERIC_JOB_ERROR });
    }
  }, [kind, idsKey]);

  useEffect(() => {
    setLoad({ s: "loading" });
    void fetchJobs();
  }, [fetchJobs]);

  return (
    <section aria-labelledby="jobs-panel-h" className="mt-6 space-y-2 rounded-lg border border-zinc-200 bg-white p-4 print:hidden">
      <h2 id="jobs-panel-h" className="flex items-center gap-2 text-lg font-bold text-zinc-900">
        <ClipboardList className="h-5 w-5" aria-hidden="true" />
        ใบงานผลิต
      </h2>
      {load.s === "loading" && <p role="status" className="text-sm text-zinc-700">กำลังโหลดใบงาน…</p>}
      {load.s === "error" && (
        <div className="flex flex-wrap items-center gap-2">
          <p role="alert" className="text-sm font-medium text-red-800">
            {load.message}
          </p>
          <Button type="button" variant="secondary" onClick={() => { setLoad({ s: "loading" }); void fetchJobs(); }}>
            ลองใหม่
          </Button>
        </div>
      )}
      {load.s === "ready" && items.length === 0 && <p className="text-sm text-zinc-700">ยังไม่มีรายการให้สร้างใบงาน</p>}
      {load.s === "ready" && items.length > 0 && (
        <ul className="divide-y divide-zinc-100">
          {items.map((it) => {
            const job = load.jobs.find((j) => j.itemId === it.id);
            return (
              <li key={it.id} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="min-w-0 text-base break-words text-zinc-900">{it.label}</p>
                {job ? (
                  <Link href={`/jobs/${job.jobId}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-primary-700 underline">
                    ใบงาน {job.jobNo} · {JOB_STATUS_LABEL[job.status] ?? job.status}
                  </Link>
                ) : (
                  <Button type="button" variant="secondary" onClick={() => setTarget(it)}>
                    สร้างใบงาน
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {target && <JobCreateDialog kind={kind} itemId={target.id} itemLabel={target.label} onClose={() => setTarget(null)} onCreated={() => void fetchJobs()} />}
    </section>
  );
}
