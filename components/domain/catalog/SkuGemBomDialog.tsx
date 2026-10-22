"use client";

// SkuGemBomDialog — แม่แบบพลอยต่อชิ้นของ SKU (เปิดจากแถวใน /catalog — ไม่ยัดใน ProductForm) · UX §6
// แม่แบบใช้เป็นค่าเริ่มของใบงานที่เปิดใหม่ — ใบที่เปิดแล้วไม่เปลี่ยน · บันทึกทั้งชุดครั้งเดียว (all-or-nothing) · ล้างทั้งหมด = กล่องยืนยัน
// ทางหลักที่แม่แบบถูกเติมคือจากใบงาน ("ตั้งเป็นแม่แบบ SKU") ไม่ใช่นั่งกรอกที่นี่ · 🔴 ไม่มีราคา/เผื่อแตก · แก้ราคาแคตตาล็อก/ต้นทุน SKU ไม่เกี่ยว
// state: loading (skeleton) · empty ("SKU นี้ยังไม่มีแม่แบบพลอย") · error (โหลด/บันทึกล้ม ค่าที่กรอกอยู่) · success (toast)

import { useCallback, useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { GemConfirm } from "@/components/domain/gems/GemConfirm";
import { GemRowsEditor } from "@/components/domain/gems/GemRowsEditor";
import { GemServerSimilar, useGemFail } from "@/components/domain/gems/useGemFail";
import { useGemOptions } from "@/components/domain/gems/useGemOptions";
import { GemErrorLine } from "@/components/domain/gems/ui";
import { useOfficeRun } from "@/components/domain/jobs/useOfficeRun";
import { getSkuGemTemplate, saveSkuGemTemplate } from "@/lib/actions/gems";
import { draftRowsToInputs, gemRowsBlocking, rowFromBomLine } from "@/lib/jobs/gem-draft";
import type { GemDraftRow } from "@/lib/jobs/gem-draft";
import { saveNotices } from "@/lib/jobs/gem-save";
import { GENERIC_JOB_ERROR } from "@/lib/jobs/messages";
import { useToast } from "@/components/ui/Toast";

type Load = { s: "loading" } | { s: "error"; message: string } | { s: "ready"; before: number };

export function SkuGemBomDialog({ productId, sku, name, onClose }: { productId: string; sku: string; name: string; onClose: () => void }) {
  const toast = useToast();
  const { run, busy, error, setError } = useOfficeRun();
  const opts = useGemOptions();
  const fail = useGemFail();
  const [load, setLoad] = useState<Load>({ s: "loading" });
  const [rows, setRows] = useState<GemDraftRow[]>([]);
  const [dirty, setDirty] = useState(false);
  const [showIssues, setShowIssues] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const fetchTemplate = useCallback(async () => {
    setLoad({ s: "loading" });
    try {
      const r = await getSkuGemTemplate(productId);
      if (!r.ok) return setLoad({ s: "error", message: r.error });
      setRows(r.data.map((l) => rowFromBomLine(l, "saved")));
      setDirty(false);
      setLoad({ s: "ready", before: r.data.length });
    } catch {
      setLoad({ s: "error", message: GENERIC_JOB_ERROR });
    }
  }, [productId]);
  useEffect(() => {
    void fetchTemplate();
  }, [fetchTemplate]);

  const ready = load.s === "ready" ? load : null;
  const blocking = gemRowsBlocking(rows, opts.options);

  function onRows(next: GemDraftRow[]) {
    setRows(next);
    setDirty(true);
    fail.reset();
  }

  async function save(o: { force?: boolean; rows?: GemDraftRow[]; confirmed?: boolean } = {}) {
    if (busy || !ready || (!dirty && !o.rows)) return;
    const rs = o.rows ?? rows;
    // คำนวณจากแถวที่จะส่งจริงทุกครั้ง (รวมตอนส่งซ้ำหลังแก้แถวจาก "ใช้ตัวที่มี")
    if (gemRowsBlocking(rs, opts.options)) {
      setShowIssues(true);
      return;
    }
    // ล้างทั้งหมด (บันทึกแม่แบบว่างทั้งที่เคยมี) = ต้องยืนยัน
    if (rs.length === 0 && ready.before > 0 && !o.confirmed) {
      setConfirmClear(true);
      return;
    }
    setError(null);
    fail.reset();
    const r = await run(() => saveSkuGemTemplate({ productId, lines: draftRowsToInputs(rs), force: o.force === true }), { success: `บันทึกแม่แบบพลอย ${sku} แล้ว`, refresh: false });
    if (r.ok) {
      for (const m of saveNotices(r.data.summary)) toast.push(m);
      setDirty(false);
      onClose();
      return;
    }
    setConfirmClear(false);
    fail.fail(r, rs);
    setShowIssues(true);
  }

  const guardClose = () => !dirty || window.confirm("ทิ้งการแก้แม่แบบพลอย? ค่าที่แก้ยังไม่ถูกบันทึก");

  return (
    <Modal open onClose={onClose} title={`พลอยต่อชิ้น — ${sku} ${name}`} wide confirmBeforeClose={guardClose}>
      <form noValidate className="space-y-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <p className="rounded-md border border-sky-200 bg-sky-50 p-2 text-sm text-sky-950">ⓘ แม่แบบใช้เป็นค่าเริ่มของใบงานที่เปิดใหม่ — ใบที่เปิดแล้วไม่เปลี่ยน</p>
        {load.s === "loading" && (
          <div role="status" aria-label="กำลังโหลดแม่แบบพลอย" className="space-y-2">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        )}
        {load.s === "error" && (
          <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <p className="font-medium">โหลดแม่แบบพลอยไม่ได้ — ลองอีกครั้ง</p>
            <p className="break-words">{load.message}</p>
            <Button type="button" variant="secondary" size="sm" className="mt-2" onClick={() => void fetchTemplate()}>
              ลองอีกครั้ง
            </Button>
          </div>
        )}
        {ready && (
          <>
            <GemRowsEditor
              idPrefix="sg"
              rows={rows}
              onChange={onRows}
              options={opts.options}
              optionsState={opts.state.s}
              optionsError={opts.state.s === "error" ? opts.state.message : null}
              onRetryOptions={() => void opts.reload()}
              qtyPlanned={null}
              showTotals={false}
              showIssues={showIssues}
              serverErrors={fail.rowErrors}
              disabled={busy}
              emptyText="SKU นี้ยังไม่มีแม่แบบพลอย"
              layout="grid"
            />
            {rows.length === 0 && ready.before === 0 && <p className="text-xs text-zinc-700">หรือกรอกที่ใบงานแล้วกด “ตั้งเป็นแม่แบบ SKU” ก็ได้</p>}
          </>
        )}
        {showIssues && blocking && (
          <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-2 text-sm font-medium text-red-800 break-words">
            {blocking}
          </p>
        )}
        {(error || fail.generalError) && !fail.similar && (
          <GemErrorLine message={`บันทึกแม่แบบไม่สำเร็จ — ลองอีกครั้ง (ค่าที่กรอกยังอยู่) · ${error ?? fail.generalError}`} />
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={() => { if (guardClose()) onClose(); }} disabled={busy}>
            ยกเลิก
          </Button>
          <Button type="submit" loading={busy} aria-disabled={!ready || !dirty ? true : undefined} aria-describedby={ready && !dirty ? "sg-why" : undefined} className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50">
            บันทึกแม่แบบ
          </Button>
        </div>
        {ready && !dirty && (
          <p id="sg-why" role="status" className="text-xs text-zinc-800">
            ยังไม่ได้แก้อะไร
          </p>
        )}
      </form>
      {confirmClear && (
        <GemConfirm
          title="ล้างแม่แบบพลอย"
          message={`ล้างแม่แบบพลอยของ ${sku}? ใบที่เปิดใหม่จะไม่มีพลอยมาให้`}
          confirmLabel="ล้างแม่แบบ"
          cancelLabel="ไม่ล้าง"
          busy={busy}
          onConfirm={() => void save({ confirmed: true })}
          onCancel={() => setConfirmClear(false)}
        />
      )}
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
          void save({ force: o.force, rows: o.rows });
        }}
      />
    </Modal>
  );
}
