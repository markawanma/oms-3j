"use client";

// GemAddItemDialog — "＋ เพิ่มรายการ" บนหน้าแคตตาล็อก (ทางรอง — เจ้าของสั่ง "อย่านั่งสร้างก่อน": รายการส่วนใหญ่มาจากหน้างาน)
// ชนิด/รูปทรง/ขนาด แบบเดียวกับฟอร์มใบงาน (GemPicker + GemSizeFields) · ตั้งราคาทำที่แถวในตารางหลังเพิ่ม (ราคาไม่อยู่ในฟอร์มนี้)

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useOfficeRun } from "@/components/domain/jobs/useOfficeRun";
import { GemPicker } from "@/components/domain/gems/GemPicker";
import { GemSizeFields } from "@/components/domain/gems/GemSizeFields";
import { GemServerSimilar, useGemFail } from "@/components/domain/gems/useGemFail";
import { useGemOptions } from "@/components/domain/gems/useGemOptions";
import { FieldMsg, GemErrorLine } from "@/components/domain/gems/ui";
import { createGemItem } from "@/lib/actions/gems";
import { draftRowToInput, emptyGemRow, gemRowIssues, pendingNewNames } from "@/lib/jobs/gem-draft";
import type { GemDraftRow } from "@/lib/jobs/gem-draft";

export function GemAddItemDialog({ onClose }: { onClose: () => void }) {
  const { state, reload, options } = useGemOptions();
  const { run, busy, error, setError } = useOfficeRun();
  const fail = useGemFail();
  const [row, setRow] = useState<GemDraftRow>(() => ({ ...emptyGemRow("manual"), qty: "1" }));
  const [touched, setTouched] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const issues = gemRowIssues(row).filter((i) => i.field !== "qty_per_piece" && i.field !== "position");
  const shown = touched ? issues : [];
  const err = (f: string) => shown.find((i) => i.field === f);
  const reason = issues[0]?.message ?? null;
  const typeOptions = options ? options.types.map((t) => ({ id: t.id, name: t.name })) : [];
  const shapeOptions = options ? options.shapes.map((s) => ({ id: s.id, name: s.name, hasLength: s.hasLength })) : [];
  const chips =
    options && row.type?.kind === "existing" && row.shape?.kind === "existing"
      ? options.items.filter((i) => i.typeId === (row.type as { id: string }).id && i.shapeId === (row.shape as { id: string }).id).slice(0, 6).map((i) => ({ sizeA: i.sizeA, sizeB: i.sizeB, label: i.sizeLabel }))
      : [];

  async function submit(opts: { force?: boolean; row?: GemDraftRow } = {}) {
    setTouched(true);
    const r = opts.row ?? row;
    if (busy || gemRowIssues(r).some((i) => i.field !== "qty_per_piece" && i.field !== "position")) return;
    fail.reset();
    setError(null);
    const res = await run(() => createGemItem(draftRowToInput(r), opts.force === true), { refresh: true });
    if (res.ok) {
      onClose();
      return;
    }
    fail.fail(res, [r]);
  }

  return (
    <Modal open onClose={onClose} title="เพิ่มรายการพลอย">
      <form noValidate className="space-y-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        {state.s === "loading" && <p role="status" className="text-sm text-zinc-800">กำลังโหลดรายการชนิด/รูปทรง…</p>}
        {state.s === "error" && (
          <p role="status" className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-sm font-medium text-amber-950">
            โหลดรายการพลอยไม่ได้ — พิมพ์ชื่อเองได้ แต่ระบบยังเช็คชื่อซ้ำให้ไม่ได้
            <button type="button" onClick={() => void reload()} className="ml-2 min-h-11 px-2 font-semibold underline">
              ลองอีกครั้ง
            </button>
          </p>
        )}
        <div className="space-y-1">
          <p className="text-sm font-medium text-zinc-800">ชนิด *</p>
          <GemPicker
            kind="type"
            id="ga-type"
            label="ชนิดพลอย"
            options={typeOptions}
            pending={pendingNewNames([row], "type").filter((p) => !(row.type?.kind === "new" && row.type.name === p.name))}
            loading={state.s === "loading"}
            loadError={state.s === "error" ? state.message : null}
            onRetry={() => void reload()}
            disabled={busy}
            invalid={!!err("type")}
            describedBy={err("type") ? "ga-type-err" : undefined}
            value={row.type}
            onSelect={(v) => setRow({ ...row, type: v })}
            onNotice={setNotice}
          />
          {err("type") && <FieldMsg id="ga-type-err">{err("type")!.message}</FieldMsg>}
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium text-zinc-800">รูปทรง *</p>
          <GemPicker
            kind="shape"
            id="ga-shape"
            label="รูปทรง"
            options={shapeOptions}
            pending={[]}
            loading={state.s === "loading"}
            loadError={state.s === "error" ? state.message : null}
            onRetry={() => void reload()}
            disabled={busy}
            invalid={!!err("shape")}
            describedBy={err("shape") ? "ga-shape-err" : undefined}
            value={row.shape}
            onSelect={(v) => setRow({ ...row, shape: v, sizeB: v.hasLength ? row.sizeB : "", bigConfirmed: false })}
            onNotice={setNotice}
          />
          {err("shape") && <FieldMsg id="ga-shape-err">{err("shape")!.message}</FieldMsg>}
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium text-zinc-800">ขนาด (มม.) *</p>
          <GemSizeFields idBase="ga-size" row={row} issues={shown} disabled={busy} chips={chips} onSize={(a, b) => setRow({ ...row, sizeA: a, sizeB: b, bigConfirmed: false })} onConfirmBig={(v) => setRow({ ...row, bigConfirmed: v })} />
        </div>
        <p aria-live="polite" className="min-h-4 text-xs font-medium text-zinc-800">
          {notice}
        </p>
        <GemErrorLine message={error && !fail.similar ? error : null} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            ยกเลิก
          </Button>
          <Button type="submit" loading={busy} aria-disabled={reason ? true : undefined} aria-describedby={reason ? "ga-why" : undefined} className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50">
            เพิ่มรายการ
          </Button>
        </div>
        {reason && touched && (
          <p id="ga-why" role="status" className="text-xs text-zinc-800">
            {reason}
          </p>
        )}
        <p className="text-xs text-zinc-700">ตั้งราคาได้ที่แถวในตารางหลังเพิ่มรายการ</p>
      </form>
      <GemServerSimilar
        hit={fail.similar}
        rows={[row]}
        options={options}
        onRows={(rs) => setRow(rs[0])}
        onClose={fail.clearSimilar}
        onResubmit={(o) => {
          void submit({ force: o.force, row: o.rows?.[0] });
        }}
      />
    </Modal>
  );
}
