"use client";

// JobGemsCard — การ์ด "พลอย" บน /jobs/[id] (ออฟฟิศ) · UX §5.2 — วางต่อจาก PlanCard ก่อน JobPhotosCard
// ข้อมูลหลักมากับ getJobDetail().gems (ฉลาก snapshot ของใบ · จำนวน · รวม = ต่อชิ้น × จำนวนเริ่มผลิต · state ที่ DB ตัดสิน) · รายละเอียดเสริม (หน้าต่างแก้ · ที่มา · ต่างจากแม่แบบ · ประวัติ) โหลดแยกจาก getJobGems
// ชื่ออ่านจาก snapshot ของใบ — ใบเก่าไม่เปลี่ยนเมื่อชื่อถูกรวม/เปลี่ยนทีหลัง
// 🔴 ไม่มีราคา/เผื่อแตก — การ์ดนี้ staff-safe โดยชนิดข้อมูล (JobGemsSummary/JobGems ไม่มีฟิลด์ราคา)
// state: loading (เฉพาะส่วนเสริม) · empty (ไม่ระบุ / ไม่มีขั้นฝัง) · error (อ่านพลอยไม่ได้ → ไม่ทำให้หน้าใบงานล้ม) · success (ตาราง + ป้าย)

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { GemTemplateDiffDialog } from "@/components/domain/jobs/GemTemplateDiffDialog";
import { JobGemsEditDialog } from "@/components/domain/jobs/JobGemsEditDialog";
import { getJobGems } from "@/lib/actions/gems";
import { thaiDateTime } from "@/lib/jobs/dates";
import { diffGemLines, gemDiffText } from "@/lib/jobs/gem-draft";
import type { JobGems, JobGemsSummary } from "@/lib/jobs/gems";

type Extra = { s: "loading" } | { s: "error" } | { s: "ready"; data: JobGems };
const fmt = (n: number) => n.toLocaleString("en-US");

export function JobGemsCard({ jobId, sku, closed, activeTokens, gems }: { jobId: string; sku: string | null; closed: boolean; activeTokens: number; gems: JobGemsSummary | null }) {
  const router = useRouter();
  const [extra, setExtra] = useState<Extra>({ s: "loading" });
  const [dlg, setDlg] = useState<"edit" | "template" | null>(null);

  // ส่วนเสริมโหลดใหม่ทุกครั้งที่พลอยของใบเปลี่ยน (หลังบันทึก → router.refresh ส่ง gems ใหม่มา)
  const sig = gems ? gems.gems.map((g) => `${g.label}:${g.qtyPerPiece}:${g.position ?? ""}`).join("|") + gems.state : "x";
  const seq = useRef(0);
  const fetchExtra = useCallback(async () => {
    // คำตอบเก่าที่มาช้ากว่าคำขอใหม่ถูกทิ้ง (พลอยเปลี่ยนติดกัน/ปิดกล่องแล้ว refresh)
    const my = ++seq.current;
    setExtra({ s: "loading" });
    try {
      const r = await getJobGems(jobId);
      if (my === seq.current) setExtra(r.ok ? { s: "ready", data: r.data } : { s: "error" });
    } catch {
      if (my === seq.current) setExtra({ s: "error" });
    }
  }, [jobId]);
  useEffect(() => {
    if (gems !== null) void fetchExtra();
  }, [fetchExtra, sig, gems]);

  if (gems === null) {
    return (
      <section aria-labelledby="gems-h" id="job-gems" className="space-y-2 rounded-lg border border-zinc-200 bg-white p-4">
        <h2 id="gems-h" className="text-lg font-bold text-zinc-900">
          พลอย
        </h2>
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-2.5 text-sm font-medium text-red-800">
          โหลดพลอยไม่ได้ — โหลดหน้าใหม่
        </p>
        <Button type="button" variant="secondary" onClick={() => router.refresh()}>
          โหลดหน้าใหม่
        </Button>
      </section>
    );
  }

  const ex = extra.s === "ready" ? extra.data : null;
  const total = gems.gems.reduce((s, g) => s + g.qtyTotal, 0);
  const win = ex?.window ?? null;
  const canEdit = !closed && win !== "closed";
  const differs = ex?.differsFromTemplate === true;
  const tplEmpty = ex !== null && ex.template !== null && ex.template.length === 0;
  const canTemplate = !closed && sku !== null && ex !== null && gems.gems.length > 0 && (differs || tplEmpty);
  const fromShop = ex?.lines.some((l) => l.via === "shopfloor") ?? false;
  const fromOffice = ex?.lines.some((l) => l.via === "office") ?? false;
  const fromTemplate = ex !== null && !differs && ex.template !== null && ex.template.length > 0 && ex.lines.some((l) => l.source === "product");

  return (
    <section aria-labelledby="gems-h" id="job-gems" className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4" data-testid="job-gems-card">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="gems-h" className="text-lg font-bold text-zinc-900">
          พลอย
        </h2>
        {gems.gems.length > 0 && (
          <span className="text-sm font-semibold text-zinc-900 tabular-nums" data-testid="job-gems-summary">
            {gems.gems.length} รายการ · {fmt(total)} เม็ด
          </span>
        )}
        {canEdit && (gems.gems.length > 0 || gems.state === "unspecified") && (
          <Button type="button" variant="secondary" size="sm" className="ml-auto min-h-11" onClick={() => setDlg("edit")}>
            {gems.gems.length > 0 ? "แก้พลอย" : "เพิ่มพลอย"}
          </Button>
        )}
      </div>

      {gems.gems.length > 0 && (
        <>
          <ul className="flex flex-wrap gap-1.5" aria-label="ที่มาของพลอย">
            {fromTemplate && <li className="rounded-sm bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-950">จากแม่แบบ</li>}
            {fromShop && <li className="rounded-sm bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-950">ใส่จากหน้างาน</li>}
            {fromOffice && <li className="rounded-sm bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-900">แก้โดยออฟฟิศ</li>}
            {differs && <li className="rounded-sm bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-950">ต่างจากแม่แบบ</li>}
            {extra.s === "loading" && (
              <li role="status" aria-label="กำลังโหลดรายละเอียดพลอย">
                <Skeleton className="h-5 w-24" />
              </li>
            )}
            {extra.s === "error" && <li className="text-xs text-zinc-700">โหลดรายละเอียดการแก้ไม่ได้ (ตารางด้านล่างยังถูกต้อง)</li>}
          </ul>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-left text-sm" data-testid="job-gems-table">
              <caption className="sr-only">พลอยที่ใช้ในใบงาน (ชื่อตามที่สั่ง ณ ตอนเปิดใบ)</caption>
              <thead>
                <tr className="border-b border-zinc-200 text-xs font-semibold text-zinc-700">
                  <th scope="col" className="py-1.5 pr-2">ชนิด · รูปทรง · ขนาด</th>
                  <th scope="col" className="py-1.5 pr-2 text-right">/ชิ้น</th>
                  <th scope="col" className="py-1.5 pr-2 text-right">รวม</th>
                  <th scope="col" className="py-1.5">ตำแหน่ง</th>
                </tr>
              </thead>
              <tbody>
                {gems.gems.map((g, i) => (
                  <tr key={`${g.label}-${i}`} className="border-b border-zinc-100 last:border-0">
                    <th scope="row" className="py-1.5 pr-2 font-medium text-zinc-900 break-words [overflow-wrap:anywhere]">
                      {g.label}
                    </th>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{fmt(g.qtyPerPiece)}</td>
                    <td className="py-1.5 pr-2 text-right font-semibold tabular-nums">{fmt(g.qtyTotal)}</td>
                    <td className="py-1.5 break-words [overflow-wrap:anywhere]">{g.position ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {gems.gems.length === 0 && gems.state === "unspecified" && (
        <div role="status" className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-sm font-medium text-amber-950" data-testid="job-gems-unspecified">
          ยังไม่ระบุพลอย — หน้าช่างจะเตือนให้ถามออฟฟิศก่อนฝัง (ไม่บล็อกการรับงาน)
          {canEdit && (
            <Button type="button" variant="secondary" size="sm" className="ml-2 min-h-11" onClick={() => setDlg("edit")}>
              เพิ่มพลอย
            </Button>
          )}
        </div>
      )}
      {gems.gems.length === 0 && gems.state === "not_needed" && (
        <p className="text-sm text-zinc-800" data-testid="job-gems-none">
          ใบนี้ไม่มีขั้นฝังพลอย — ถ้าต้องใส่พลอย ให้เพิ่มขั้น “ฝังพลอย” ในใบก่อน (ระบบไม่เพิ่มขั้นให้เอง)
        </p>
      )}

      {canTemplate && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" size="sm" className="min-h-11" onClick={() => setDlg("template")}>
            ตั้งเป็นแม่แบบ SKU {sku}
          </Button>
        </div>
      )}

      {ex && ex.history.length > 0 && (
        <details className="rounded-md border border-zinc-200 p-2">
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-zinc-900">ประวัติการแก้ ({ex.history.length})</summary>
          <ul className="space-y-2 text-sm text-zinc-900" data-testid="job-gems-history">
            {ex.history.map((h, i) => {
              const d = diffGemLines(h.before, h.after);
              return (
                <li key={`${h.at}-${i}`} className="break-words">
                  <span className="font-medium">{thaiDateTime(h.at)}</span>
                  {h.reason ? ` · เหตุผล: ${h.reason}` : ""}
                  {d.length === 0 ? <span className="block text-zinc-700">{h.before.length === 0 && h.after.length === 0 ? "ไม่มีพลอย" : "ไม่มีความต่าง"}</span> : <ul className="mt-0.5">{d.map((c, k) => <li key={k}>{gemDiffText(c)}</li>)}</ul>}
                </li>
              );
            })}
          </ul>
        </details>
      )}

      {activeTokens > 0 && !closed && (
        <p className="text-sm text-zinc-800" data-testid="job-gems-printed">
          ⓘ ใบงานถูกพิมพ์ไปแล้ว {activeTokens} ใบ — พลอยที่แก้จะไม่อยู่บนกระดาษที่พิมพ์ไปแล้ว
        </p>
      )}

      {dlg === "edit" && <JobGemsEditDialog jobId={jobId} onClose={() => setDlg(null)} />}
      {dlg === "template" && ex && sku && ex.template !== null && <GemTemplateDiffDialog jobId={jobId} sku={sku} template={ex.template} lines={ex.lines} onClose={() => setDlg(null)} />}
    </section>
  );
}
