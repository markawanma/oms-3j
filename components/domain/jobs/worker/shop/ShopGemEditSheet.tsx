"use client";

// ShopGemEditSheet — แผ่นเต็มจอ "แก้พลอย" ของใบที่ฉันเปิด (W-10 · UX §4.4) — ตัวแก้ชุดเดียวกับ W-4 (ShopGemEditor) โหมดบันทึกแล้ว
//  - บันทึกทั้งชุดครั้งเดียว (all-or-nothing เหมือน RPC job_worker_gem_set) ไม่บันทึกทีละแถว · expectedRev (CAS) กัน 2 เครื่องทับกัน
//  - ผล: ok → ปิดแผ่น + ผู้เรียกโหลดพลอยใหม่ · ถูกล็อก (ช่างรับงาน/ปิด/ยกเลิก/ไม่มีขั้นฝัง) → ปิดแผ่นพร้อมข้อความ (ค่าที่พิมพ์ไม่ถูกบันทึก) · gem_conflict → โหลดใหม่ ·
//    แถวผิด → กล่องแดงที่แถวนั้น · ชื่อคล้าย → ถาม (ใช้ตัวที่มี / เพิ่มใหม่จริงๆ ส่งซ้ำพร้อม force เฉพาะชื่อที่ DB ถาม) · ไม่มีสัญญาณ/session หมด → ข้อความ ฟอร์มคงอยู่
//  - เหลือ 0 แถวได้ แต่เตือนก่อนบันทึก (ขั้นฝังพลอยยังอยู่ ใบจะขึ้นเตือนยังไม่ระบุพลอยจนออฟฟิศถอดขั้น) · ออกขณะมีแก้ยังไม่บันทึก → กล่องยืนยัน "ทิ้งการแก้พลอย?"
//  - 🔴 ไม่มีราคา/ตัวเลขเงิน · เรียกได้เฉพาะ action ใน lib/actions/job-worker.ts (ด่านจริงอยู่ที่ DB)

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { intakeSetJobGems } from "@/lib/actions/job-worker";
import { Modal } from "@/components/ui/Modal";
import { BigButton } from "@/components/domain/jobs/worker/WorkerParts";
import { GemServerSimilar } from "@/components/domain/gems/useGemFail";
import { useFocusAfterOpen } from "@/components/domain/gems/ui";
import { ShopGemEditor } from "@/components/domain/jobs/worker/shop/ShopGemEditor";
import type { ShopGemFocusRequest } from "@/components/domain/jobs/worker/shop/ShopGemEditor";
import { useShopGemCatalog } from "@/components/domain/jobs/worker/shop/useShopGemCatalog";
import { draftRowsToInputs } from "@/lib/jobs/gem-draft";
import type { GemDraftRow } from "@/lib/jobs/gem-draft";
import type { GemForceItem } from "@/lib/jobs/gem-wire";
import { GEM_LOCK_CODES, SHOP_GEM_TH, addForce, gemOptionsOf, gemStepIssue, interpretIntakeGemFail, isGemConflict, pruneForce, rowFromIntakeLine } from "@/lib/jobs/shop-gem-flow";
import type { GemRowErrors } from "@/lib/jobs/shop-gem-flow";
import type { GemSimilar, IntakeGemSummary, IntakeJobGems } from "@/lib/jobs/worker-server";

const MSG_NET = "ส่งไม่สำเร็จ — เช็คสัญญาณแล้วกด “บันทึกพลอย” อีกครั้ง";
const ID_PREFIX = "shop-jobgem";
const sig = (rows: readonly GemDraftRow[]): string => JSON.stringify(rows.map((r) => [r.itemId, r.type?.name ?? null, r.shape?.name ?? null, r.sizeA, r.sizeB, r.qty, r.position]));

export type GemSheetClose =
  | { kind: "cancel" }
  | { kind: "saved"; summary: Pick<IntakeGemSummary, "createdTypes" | "createdShapes" | "reused" | "mergedRows"> }
  | { kind: "locked"; code: string }
  | { kind: "reload" };

export function ShopGemEditSheet({ token, data, onClose, onSessionLost }: { token: string; data: IntakeJobGems; onClose: (r: GemSheetClose) => void; onSessionLost: () => void }) {
  const initial = useMemo(() => data.lines.map((l) => rowFromIntakeLine(l, "saved")), [data.lines]);
  const [rows, setRows] = useState<GemDraftRow[]>(initial);
  const [force, setForce] = useState<GemForceItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [rowErrors, setRowErrors] = useState<GemRowErrors>({});
  const [focusReq, setFocusReq] = useState<ShopGemFocusRequest | null>(null);
  const [similar, setSimilar] = useState<GemSimilar | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [zeroWarn, setZeroWarn] = useState(false);
  const [discard, setDiscard] = useState(false);
  const inflight = useRef(false);
  const nonce = useRef(0);
  const headRef = useRef<HTMLHeadingElement>(null);
  const baseSig = useRef(sig(initial));
  const catalog = useShopGemCatalog({ token, productId: null, enabled: true, onSessionLost });
  const ready = catalog.state.s === "ready" ? catalog.state.data : null;
  const options = useMemo(() => (ready ? gemOptionsOf(ready.types, ready.shapes, data.lines) : null), [ready, data.lines]);
  const optionsState: "loading" | "error" | "ready" = catalog.state.s === "ready" ? "ready" : catalog.state.s === "error" ? "error" : "loading";
  const dirty = sig(rows) !== baseSig.current;

  useEffect(() => {
    headRef.current?.focus();
  }, []);

  const tryClose = useCallback(() => {
    if (busy) return;
    if (dirty) setDiscard(true);
    else onClose({ kind: "cancel" });
  }, [busy, dirty, onClose]);

  // Esc = ยกเลิก (ผ่านด่านยืนยันถ้ามีแก้) — Modal/GemPicker ที่เปิดซ้อนอยู่รับ Esc ของตัวเองก่อน (preventDefault)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !e.defaultPrevented && !zeroWarn && !discard && similar === null) tryClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [tryClose, zeroWarn, discard, similar]);

  function edited(next: GemDraftRow[]) {
    setRows(next);
    setForce((f) => pruneForce(f, next));
    setRowErrors({});
    setError(null);
  }

  async function save(o?: { rows?: GemDraftRow[]; addForce?: GemForceItem; confirmedZero?: boolean }) {
    if (inflight.current) return;
    const cur = o?.rows ?? rows;
    if (o?.rows) setRows(cur);
    const nextForce = pruneForce(o?.addForce ? addForce(force, o.addForce) : force, cur);
    if (o?.addForce) setForce(nextForce);
    if (cur.length === 0 && !o?.confirmedZero) {
      setZeroWarn(true);
      return;
    }
    const issue = cur.length > 0 ? gemStepIssue({ answer: "has", rows: cur }, options) : null;
    if (issue) {
      setAttempted(true);
      setError(issue.message);
      if (issue.rowKey) setFocusReq({ rowKey: issue.rowKey, field: null, nonce: ++nonce.current });
      return;
    }
    inflight.current = true;
    setBusy(true);
    setError(null);
    setRowErrors({});
    let r: Awaited<ReturnType<typeof intakeSetJobGems>> | null = null;
    try {
      r = await intakeSetJobGems(token, { jobId: data.job.jobId, lines: draftRowsToInputs(cur), expectedRev: data.rev, force: nextForce.length > 0 ? nextForce : null });
    } catch {
      r = null;
    } finally {
      inflight.current = false;
      setBusy(false);
    }
    if (r === null) {
      setError(MSG_NET);
      return;
    }
    if (r.ok) {
      onClose({ kind: "saved", summary: r.summary });
      return;
    }
    if (r.similar && r.similar.length > 0) {
      setSimilar(r.similar[0]);
      return;
    }
    const code = r.code ?? "";
    if (GEM_LOCK_CODES.has(code)) {
      onClose({ kind: "locked", code });
      return;
    }
    if (isGemConflict(code)) {
      setConflict(true);
      setError(r.error);
      return;
    }
    if (code === "session_required") onSessionLost();
    const fv = interpretIntakeGemFail(r, cur);
    setRowErrors(fv.rowErrors);
    setError(fv.generalError);
    if (fv.focusRowKey) setFocusReq({ rowKey: fv.focusRowKey, field: fv.focusField, nonce: ++nonce.current });
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="shop-gemsheet-h" className="fixed inset-0 z-40 overflow-y-auto bg-white" data-testid="shop-gem-sheet">
      <div className="mx-auto flex min-h-full max-w-md flex-col px-4 pt-3">
        <header className="space-y-2">
          <div className="flex items-center gap-2">
            <button type="button" onClick={tryClose} disabled={busy} aria-label="ยกเลิกการแก้พลอย" className="-ml-2 flex h-14 w-14 shrink-0 items-center justify-center rounded-xl text-zinc-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-300 disabled:opacity-40">
              <ChevronLeft className="h-8 w-8" aria-hidden="true" />
            </button>
            <p className="min-w-0 flex-1 truncate text-base font-semibold text-zinc-700">{data.job.designLabel}</p>
          </div>
          <h2 id="shop-gemsheet-h" ref={headRef} tabIndex={-1} className="text-2xl font-bold text-zinc-900 focus:outline-none">
            {SHOP_GEM_TH.w10Edit} {data.job.jobNo}
          </h2>
          <p className="text-base text-zinc-800">
            คูณด้วยจำนวนที่จะผลิต {data.job.qtyPlanned.toLocaleString("en-US")} ชิ้น · {SHOP_GEM_TH.onlyThisJob} แก้ได้จนช่างเริ่มรับงาน
          </p>
        </header>

        <div className="mt-3 flex-1 space-y-3 pb-4">
          <ShopGemEditor
            idPrefix={ID_PREFIX}
            rows={rows}
            onChange={edited}
            options={options}
            sizes={ready ? ready.sizes : []}
            optionsState={optionsState}
            onRetryOptions={catalog.reload}
            qtyPlanned={data.job.qtyPlanned}
            showIssues={attempted}
            serverErrors={rowErrors}
            focusRequest={focusReq}
            disabled={busy}
            onForceSimilar={(info) => setForce((f) => addForce(f, info))}
            emptyText="ใบนี้ยังไม่มีพลอย — กด “เพิ่มพลอย” หรือบันทึกโดยไม่มีพลอย"
          />
          {error && (
            <div className="space-y-2" data-testid="shop-gemsheet-error">
              <p role="alert" className="rounded-xl border-2 border-red-200 bg-red-50 p-3 text-lg font-semibold break-words text-red-800">
                {error}
              </p>
              {conflict && (
                <BigButton type="button" tone="secondary" onClick={() => onClose({ kind: "reload" })}>
                  {SHOP_GEM_TH.conflictReload}
                </BigButton>
              )}
            </div>
          )}
        </div>

        <div className="sticky bottom-0 z-10 -mx-4 space-y-2 border-t border-zinc-200 bg-white/95 px-4 pt-2 pb-3 backdrop-blur">
          <BigButton type="button" loading={busy} aria-disabled={conflict ? true : undefined} onClick={() => { if (!conflict) void save(); }}>
            {busy ? SHOP_GEM_TH.w10Saving : SHOP_GEM_TH.w10Save}
          </BigButton>
          <BigButton type="button" tone="secondary" disabled={busy} onClick={tryClose}>
            {SHOP_GEM_TH.w10Cancel}
          </BigButton>
        </div>
      </div>

      {zeroWarn && <ConfirmBox title={SHOP_GEM_TH.zeroWarnTitle} body={SHOP_GEM_TH.zeroWarnBody} safe={SHOP_GEM_TH.zeroWarnBack} risky={SHOP_GEM_TH.zeroWarnSave} onSafe={() => setZeroWarn(false)} onRisky={() => { setZeroWarn(false); void save({ confirmedZero: true }); }} testId="shop-gem-zero-warn" />}
      {discard && <ConfirmBox title={SHOP_GEM_TH.w10DiscardTitle} body={SHOP_GEM_TH.w10DiscardBody} safe={SHOP_GEM_TH.w10KeepEditing} risky={SHOP_GEM_TH.w10Discard} onSafe={() => setDiscard(false)} onRisky={() => { setDiscard(false); onClose({ kind: "cancel" }); }} testId="shop-gem-discard" />}
      {similar && (
        <GemServerSimilar
          hit={similar}
          rows={rows}
          options={options}
          onRows={edited}
          onClose={() => setSimilar(null)}
          onResubmit={({ force: f, rows: nextRows }) => void save({ rows: nextRows, addForce: f ? { kind: similar.kind, name: similar.name } : undefined })}
        />
      )}
    </div>
  );
}

/** กล่องยืนยัน 2 ปุ่ม — focus เริ่มที่ปุ่มปลอดภัย (ปุ่มหลักสี primary = ทางปลอดภัย · อีกปุ่มเป็นรอง) */
function ConfirmBox({ title, body, safe, risky, onSafe, onRisky, testId }: { title: string; body: string; safe: string; risky: string; onSafe: () => void; onRisky: () => void; testId: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  useFocusAfterOpen(ref);
  return (
    <Modal open onClose={onSafe} title={title}>
      <div className="space-y-3" data-testid={testId}>
        <p className="text-lg text-zinc-900">{body}</p>
        <div className="flex flex-col gap-2">
          <button ref={ref} type="button" onClick={onSafe} className="inline-flex min-h-14 w-full items-center justify-center rounded-xl bg-primary-600 px-5 text-xl font-bold text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-300">
            {safe}
          </button>
          <BigButton type="button" tone="secondary" onClick={onRisky}>
            {risky}
          </BigButton>
        </div>
      </div>
    </Modal>
  );
}
