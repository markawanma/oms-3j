"use client";

// GemItemDetailDialog — รายละเอียดรายการพลอย: ชื่อเต็ม · ประวัติราคา + ประวัติแก้ (audit) · ใช้ใน · ปิด/เปิดใช้งาน · ลบ (เฉพาะที่ไม่ถูกใช้เลย) — UX §7.2
// 🔴 ราคา/ผู้ขาย/audit อยู่ที่จอนี้เท่านั้น (owner/admin) · ลบ = กล่องยืนยัน · ถูกใช้ = ปุ่มลบหาย + ข้อความ "ลบไม่ได้ — ถูกใช้ใน n ใบงาน/แม่แบบ · ปิดใช้งานแทนได้"

import { useCallback, useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { useOfficeRun } from "@/components/domain/jobs/useOfficeRun";
import { GemConfirm } from "@/components/domain/gems/GemConfirm";
import { GemErrorLine } from "@/components/domain/gems/ui";
import { fmtGemPrice } from "@/components/domain/gems/GemItemsTable";
import { getGemPriceHistory, removeGem, setGemActive } from "@/lib/actions/gems";
import { thaiDate, thaiDateTime } from "@/lib/jobs/dates";
import { GENERIC_JOB_ERROR } from "@/lib/jobs/messages";
import type { GemCatalogItem, GemPriceHistory } from "@/lib/jobs/gems";

type Load = { s: "loading" } | { s: "error"; message: string } | { s: "ready"; data: GemPriceHistory };

export function GemItemDetailDialog({ item, onClose }: { item: GemCatalogItem; onClose: () => void }) {
  const [load, setLoad] = useState<Load>({ s: "loading" });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { run, busy, error } = useOfficeRun();

  const fetchHistory = useCallback(async () => {
    setLoad({ s: "loading" });
    try {
      const r = await getGemPriceHistory(item.gemItemId);
      setLoad(r.ok ? { s: "ready", data: r.data } : { s: "error", message: r.error });
    } catch {
      setLoad({ s: "error", message: GENERIC_JOB_ERROR });
    }
  }, [item.gemItemId]);
  useEffect(() => {
    void fetchHistory();
  }, [fetchHistory]);

  const unused = item.usedJobsTotal === 0 && item.usedTemplates === 0;
  const inactive = !item.isActive || item.mergedInto !== null;

  async function toggle() {
    const r = await run(() => setGemActive({ kind: "item", id: item.gemItemId, active: !item.isActive }), { success: item.isActive ? `ปิดใช้งาน ${item.label} แล้ว` : `เปิดใช้งาน ${item.label} แล้ว` });
    if (r.ok) onClose();
  }
  async function remove() {
    const r = await run(() => removeGem({ kind: "item", id: item.gemItemId }), { success: `ลบ ${item.label} แล้ว` });
    if (r.ok) onClose();
    else setConfirmDelete(false);
  }

  return (
    <>
      <Modal open onClose={onClose} title={`รายละเอียด — ${item.label}`}>
        <div className="space-y-4">
          <p className="text-sm text-zinc-900 break-words" data-testid="gem-detail-usage">
            ใช้ใน {item.usedJobsOpen} ใบงานที่ยังเปิด · {item.usedJobsTotal} ใบงานทั้งหมด · {item.usedTemplates} แม่แบบ SKU
          </p>

          <section aria-labelledby="gd-hist" className="space-y-1">
            <h3 id="gd-hist" className="text-sm font-semibold text-zinc-900">
              ประวัติราคา
            </h3>
            {load.s === "loading" && (
              <div role="status" aria-label="กำลังโหลดประวัติราคา" className="space-y-1.5">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            )}
            {load.s === "error" && (
              <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-2.5 text-sm text-red-800">
                <p className="font-medium">{load.message}</p>
                <button type="button" onClick={() => void fetchHistory()} className="mt-1 min-h-11 font-semibold underline">
                  ลองอีกครั้ง
                </button>
              </div>
            )}
            {load.s === "ready" &&
              (load.data.rows.length === 0 ? (
                <p className="text-sm text-zinc-800">ยังไม่เคยตั้งราคา</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[360px] text-left text-sm" data-testid="gem-price-history">
                    <thead>
                      <tr className="text-xs font-semibold text-zinc-700">
                        <th scope="col" className="py-1 pr-2">มีผลตั้งแต่</th>
                        <th scope="col" className="py-1 pr-2 text-right">ราคา/เม็ด (บาท)</th>
                        <th scope="col" className="py-1 pr-2">ผู้ขาย</th>
                        <th scope="col" className="py-1">หมายเหตุ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {load.data.rows.map((r) => (
                        <tr key={r.effectiveFrom} className="border-t border-zinc-100">
                          <td className="py-1 pr-2">{thaiDate(r.effectiveFrom)}</td>
                          <td className="py-1 pr-2 text-right tabular-nums">{fmtGemPrice(r.price)}</td>
                          <td className="py-1 pr-2 break-words">{r.supplier ?? "—"}</td>
                          <td className="py-1 break-words">{r.note ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
          </section>

          {load.s === "ready" && load.data.audit.length > 0 && (
            <details className="rounded-md border border-zinc-200 p-2">
              <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-zinc-900">ประวัติการแก้ราคา ({load.data.audit.length})</summary>
              <ul className="space-y-1 text-sm text-zinc-900" data-testid="gem-price-audit">
                {load.data.audit.map((a, i) => (
                  <li key={`${a.recordedAt}-${i}`} className="break-words">
                    {thaiDateTime(a.recordedAt)} · {a.action === "insert" ? "ตั้งราคา" : "แก้ราคา"} (มีผล {thaiDate(a.effectiveFrom)}):{" "}
                    {a.oldPrice !== null ? `${fmtGemPrice(a.oldPrice)} → ` : ""}
                    {fmtGemPrice(a.newPrice)} บาท{a.note ? ` · ${a.note}` : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <GemErrorLine message={error} />

          <div className="flex flex-col gap-2 border-t border-zinc-200 pt-3 sm:flex-row sm:flex-wrap">
            {item.mergedInto === null && (
              <Button type="button" variant="secondary" onClick={() => void toggle()} loading={busy && !confirmDelete} disabled={busy}>
                {item.isActive ? "ปิดใช้งาน" : "เปิดใช้งาน"}
              </Button>
            )}
            {unused ? (
              <Button type="button" variant="secondary" className="border-red-300 text-red-700 hover:bg-red-50" onClick={() => setConfirmDelete(true)} disabled={busy}>
                ลบรายการ
              </Button>
            ) : (
              <p className="text-sm text-zinc-800" data-testid="gem-no-delete">
                ลบไม่ได้ — ถูกใช้ใน {item.usedJobsTotal} ใบงาน{item.usedTemplates > 0 ? ` และ ${item.usedTemplates} แม่แบบ` : ""}
                {inactive ? "" : " · ปิดใช้งานแทนได้"}
              </p>
            )}
            <Button type="button" variant="ghost" onClick={onClose} className="sm:ml-auto">
              ปิด
            </Button>
          </div>
        </div>
      </Modal>
      {confirmDelete && (
        <GemConfirm
          title="ลบรายการพลอย"
          message={`ลบ “${item.label}” ออกจากแคตตาล็อกใช่ไหม? ลบแล้วกู้คืนไม่ได้ (ราคาที่เคยตั้งไว้ของรายการนี้จะหายไปด้วย)`}
          confirmLabel="ลบรายการ"
          busy={busy}
          error={error}
          onConfirm={() => void remove()}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </>
  );
}
