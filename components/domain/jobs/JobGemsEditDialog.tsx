"use client";

// JobGemsEditDialog — แก้พลอยของใบ (ออฟฟิศ) · UX §5.3 · บันทึกทั้งชุดครั้งเดียว (all-or-nothing — job_gem_bom_set)
// หน้าต่างแก้ (DB เป็นด่านจริง — จอเป็นแค่ทางเลือกที่แสดง):
//   ก่อนช่างขั้นแรกรับ / ขั้นแรกรับแล้วแต่ก่อนขั้นฝังรับ = แก้ได้ไม่ต้องเหตุผล (มีประวัติ) · ขั้นฝังรับแล้ว = เหตุผลบังคับ (ต้องมีตัวอักษร/ตัวเลขจริง) + สรุป +/−/~ ก่อนบันทึก · ใบปิด/ยกเลิก = อ่านอย่างเดียว
// 🔴 ไม่มีราคา/เผื่อแตกในกล่องนี้ · แถวที่ไม่ได้แก้ชนิด/ขนาดส่งเป็น gemItemId (ฉลาก snapshot ของใบเดิมคงเดิม)

import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { GemRowsEditor } from "@/components/domain/gems/GemRowsEditor";
import { GemServerSimilar, useGemFail } from "@/components/domain/gems/useGemFail";
import { useGemOptions } from "@/components/domain/gems/useGemOptions";
import { GEM_FIELD, GemErrorLine } from "@/components/domain/gems/ui";
import { useOfficeRun } from "@/components/domain/jobs/useOfficeRun";
import { getJobGems, saveJobGems } from "@/lib/actions/gems";
import { diffGemLines, draftRowsToInputs, findDuplicateRows, gemRowIssues, rowFromBomLine, rowIncompleteReason, rowLabelPreview } from "@/lib/jobs/gem-draft";
import type { DiffEntry, GemDraftRow } from "@/lib/jobs/gem-draft";
import { reusedNotices } from "@/lib/jobs/gem-save";
import { GENERIC_JOB_ERROR } from "@/lib/jobs/messages";
import { oemNotePresent } from "@/lib/oem/display";
import { useToast } from "@/components/ui/Toast";
import type { JobGems } from "@/lib/jobs/gems";

type Load = { s: "loading" } | { s: "error"; message: string } | { s: "ready"; data: JobGems };

const WINDOW_BANNER: Record<string, { tone: "amber" | "sky"; text: string } | undefined> = {
  office_free: { tone: "amber", text: "ช่างเริ่มทำงานแล้ว — การแก้ครั้งนี้ผู้จัดการจะไม่เห็นว่าแก้ไว้จนกว่าสแกนใหม่" },
  reason_required: { tone: "amber", text: "ช่างฝังรับงานแล้ว — พลอยที่เปลี่ยนอาจไม่ตรงกับที่ฝังไปแล้ว" },
};

export function diffText(d: DiffEntry): string {
  const q = (n: number) => `${n}/ชิ้น`;
  if (d.op === "add") return `+ เพิ่ม ${d.to.label} · ${q(d.to.qtyPerPiece)}${d.to.position ? ` · ${d.to.position}` : ""}`;
  if (d.op === "remove") return `− ลบ ${d.from.label} · ${q(d.from.qtyPerPiece)}`;
  return `~ แก้ ${d.to.label} : ${q(d.from.qtyPerPiece)}${d.from.position ? ` (${d.from.position})` : ""} → ${q(d.to.qtyPerPiece)}${d.to.position ? ` (${d.to.position})` : ""}`;
}

export function JobGemsEditDialog({ jobId, onClose }: { jobId: string; onClose: () => void }) {
  const toast = useToast();
  const { run, busy, error, setError } = useOfficeRun();
  const opts = useGemOptions();
  const fail = useGemFail();
  const [load, setLoad] = useState<Load>({ s: "loading" });
  const [rows, setRows] = useState<GemDraftRow[]>([]);
  const [reason, setReason] = useState("");
  const [showIssues, setShowIssues] = useState(false);
  const [dirty, setDirty] = useState(false);

  const fetchJob = useCallback(async () => {
    setLoad({ s: "loading" });
    try {
      const r = await getJobGems(jobId);
      if (!r.ok) return setLoad({ s: "error", message: r.error });
      setRows(r.data.lines.map((l) => rowFromBomLine(l, "saved")));
      setDirty(false);
      setLoad({ s: "ready", data: r.data });
    } catch {
      setLoad({ s: "error", message: GENERIC_JOB_ERROR });
    }
  }, [jobId]);
  useEffect(() => {
    void fetchJob();
  }, [fetchJob]);

  const data = load.s === "ready" ? load.data : null;
  const win = data?.window ?? null;
  const needReason = win === "reason_required";
  const reasonOk = !needReason || oemNotePresent(reason);
  const closed = win === "closed";

  const beforeLines = data ? data.lines.map((l) => ({ label: l.label, qtyPerPiece: l.qtyPerPiece, position: l.position })) : [];
  const afterLines = useMemo(
    () =>
      rows.map((r) => ({
        label: r.itemId !== null ? (r.label ?? "") : (rowLabelPreview(r) ?? "(ยังไม่ครบ)"),
        qtyPerPiece: Number(r.qty.trim()) || 0,
        position: r.position.trim() === "" ? null : r.position.trim(),
      })),
    [rows],
  );
  const changes = useMemo(() => diffGemLines(beforeLines, afterLines), [beforeLines, afterLines]);

  const bad = rows.findIndex((r) => gemRowIssues(r).length > 0);
  const dup = [...findDuplicateRows(rows)][0];
  const blocking = bad >= 0 ? `พลอยแถว ${bad + 1} ยังไม่ครบ — ${rowIncompleteReason(rows[bad])}` : dup ? `พลอยแถว ${dup[0] + 1} ซ้ำกับแถว ${dup[1] + 1} — กด “รวมเข้าแถว ${dup[1] + 1}” หรือแก้ให้ต่างกัน` : null;
  const reasonWhy = !reasonOk ? "ใส่เหตุผลที่แก้ (ต้องมีตัวอักษรหรือตัวเลขจริง)" : null;
  const nothing = data !== null && !dirty;

  function onRows(next: GemDraftRow[]) {
    setRows(next);
    setDirty(true);
    fail.reset();
  }

  async function submit(o: { force?: boolean; rows?: GemDraftRow[] } = {}) {
    if (busy || !data || closed || (!dirty && !o.rows)) return;
    const rs = o.rows ?? rows;
    if (blocking && !o.rows) {
      setShowIssues(true);
      return;
    }
    if (!reasonOk) {
      setShowIssues(true);
      return;
    }
    setError(null);
    fail.reset();
    const r = await run(() => saveJobGems({ jobId, lines: draftRowsToInputs(rs), reason: reason.trim() || null, force: o.force === true || fail.force }), { success: "บันทึกพลอยแล้ว" });
    if (r.ok) {
      for (const m of reusedNotices(r.data.summary.reused)) toast.push(m);
      setDirty(false);
      onClose();
      return;
    }
    fail.fail(r, rs);
    setShowIssues(true);
  }

  return (
    <Modal open onClose={onClose} title="แก้พลอย" wide confirmBeforeClose={() => !dirty || window.confirm("ทิ้งการแก้พลอย? ค่าที่แก้ยังไม่ถูกบันทึก")}>
      <form noValidate className="space-y-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        {load.s === "loading" && (
          <div role="status" aria-label="กำลังโหลดพลอยของใบ" className="space-y-2">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        )}
        {load.s === "error" && (
          <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <p className="font-medium">โหลดพลอยไม่ได้ — เช็คสัญญาณแล้วลองอีกครั้ง</p>
            <p className="break-words">{load.message}</p>
            <Button type="button" variant="secondary" size="sm" className="mt-2" onClick={() => void fetchJob()}>
              ลองอีกครั้ง
            </Button>
          </div>
        )}
        {data && closed && (
          <p role="status" className="rounded-md border border-sky-300 bg-sky-50 p-2.5 text-sm font-medium text-sky-950">
            ใบนี้ปิดหรือยกเลิกแล้ว — แก้พลอยไม่ได้
          </p>
        )}
        {data && !closed && win && WINDOW_BANNER[win] && (
          <p role="status" className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-sm font-medium text-amber-950" data-testid="gem-edit-banner">
            {WINDOW_BANNER[win]!.text}
          </p>
        )}
        {data && (
          <GemRowsEditor
            idPrefix="jg"
            rows={rows}
            onChange={onRows}
            options={opts.options}
            optionsState={opts.state.s}
            optionsError={opts.state.s === "error" ? opts.state.message : null}
            onRetryOptions={() => void opts.reload()}
            qtyPlanned={data.qtyPlanned}
            showIssues={showIssues}
            serverErrors={fail.rowErrors}
            onForceSimilar={() => fail.setForce(true)}
            disabled={busy || closed}
            emptyText="ใบนี้ไม่มีพลอย — เพิ่มได้ถ้ายังอยู่ในหน้าต่างที่แก้ได้"
            layout="grid"
          />
        )}
        {data && needReason && (
          <div className="space-y-1">
            <label htmlFor="jg-reason" className="block text-sm font-medium text-zinc-800">
              เหตุผลที่แก้ * <span className="font-normal text-zinc-700">({reason.length}/300)</span>
            </label>
            <textarea id="jg-reason" rows={2} maxLength={300} value={reason} disabled={busy} onChange={(e) => setReason(e.target.value)} aria-invalid={showIssues && !reasonOk ? true : undefined} aria-describedby="jg-reason-hint" className={`${GEM_FIELD} py-2`} />
            <p id="jg-reason-hint" className="text-xs text-zinc-700">
              ต้องมีตัวอักษรหรือตัวเลขจริง (อีโมจิ/เครื่องหมายล้วนไม่ผ่าน) — บันทึกไว้ในประวัติการแก้
            </p>
          </div>
        )}
        {data && needReason && changes.length > 0 && (
          <section aria-labelledby="jg-sum" className="rounded-md border border-zinc-200 bg-zinc-50 p-2.5">
            <h3 id="jg-sum" className="text-sm font-semibold text-zinc-900">
              สรุปการเปลี่ยน
            </h3>
            <ul className="mt-1 space-y-0.5 text-sm text-zinc-900" data-testid="gem-edit-summary">
              {changes.map((c, i) => (
                <li key={i} className="break-words">
                  {diffText(c)}
                </li>
              ))}
            </ul>
          </section>
        )}
        {showIssues && blocking && (
          <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-2 text-sm font-medium text-red-800 break-words">
            {blocking}
          </p>
        )}
        <GemErrorLine message={fail.similar ? null : (error ?? fail.generalError)} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={() => { if (!dirty || window.confirm("ทิ้งการแก้พลอย? ค่าที่แก้ยังไม่ถูกบันทึก")) onClose(); }} disabled={busy}>
            {closed ? "ปิด" : "ยกเลิก"}
          </Button>
          {!closed && (
            <Button type="submit" loading={busy} aria-disabled={!data || nothing || !!reasonWhy ? true : undefined} aria-describedby={reasonWhy ? "jg-why" : undefined} className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50">
              บันทึกพลอย
            </Button>
          )}
        </div>
        {(reasonWhy || (nothing && data)) && (
          <p id="jg-why" role="status" className="text-xs text-zinc-800">
            {reasonWhy ?? "ยังไม่ได้แก้อะไร"}
          </p>
        )}
      </form>
      <GemServerSimilar
        hit={fail.similar}
        rows={rows}
        options={opts.options}
        onRows={(rs) => {
          setRows(rs);
          setDirty(true);
        }}
        onClose={fail.clearSimilar}
        onResubmit={(o) => {
          if (o.force) fail.setForce(true);
          void submit({ force: o.force, rows: o.rows });
        }}
      />
    </Modal>
  );
}
