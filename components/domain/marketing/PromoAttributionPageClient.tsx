"use client";

// PromoAttributionPageClient — /marketing/attribution: TWO independent
// sections, deliberately never merged into one total (design docs/
// 3j-jewelry/analytics/phase-auto-attribution-design.md §D4):
//   1. "auto" — read-only, derived from fact_order.discount_code (the Excel
//      order-report voucher column, LINE/หน้าร้าน orders). No form/delete —
//      it comes from re-importing the file, not user input.
//   2. "manual" (original 0036 behavior, untouched) — owner-logged ledger for
//      TikTok/Shopee codes the file doesn't carry, entered by hand. Summary +
//      entries are server-fetched once; delete calls the server action then
//      router.refresh() to re-pull both (mirrors AdSpendForm/AudiencePageClient).
// Overlap badge: same code appearing in both sources (case/space-insensitive)
// gets a warning badge in both places — the system only warns, it never
// auto-merges (manual entries have no source_order_no, so we can't prove a
// manual row and a file row are the same order or different ones).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, FileSpreadsheet, Ticket, Trash2 } from "lucide-react";
import { deletePromoAttribution } from "@/lib/actions/marketing";
import type { PromoAttributionAuto, PromoAttributionEntry, PromoAttributionSummary } from "@/lib/marketing/types";
import type { CrmChannelOption } from "@/lib/crm/order-override";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { PromoAttributionForm } from "./PromoAttributionForm";

function fmtBaht(n: number): string {
  return `฿${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function normalizeCode(code: string): string {
  return code.trim().toLowerCase();
}

const OVERLAP_TITLE = "โค้ดนี้มีข้อมูลทั้งจากไฟล์และคีย์มือ — ยอดอาจนับซ้ำ ตรวจรายการคีย์มือ";

function OverlapBadge() {
  return (
    <span title={OVERLAP_TITLE}>
      <Badge tone="amber" className="shrink-0">
        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
        อาจนับซ้ำ
      </Badge>
    </span>
  );
}

export function PromoAttributionPageClient({
  summary,
  entries,
  auto,
  channels,
}: {
  summary: PromoAttributionSummary[];
  entries: PromoAttributionEntry[];
  auto: PromoAttributionAuto[];
  channels: CrmChannelOption[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [deleteTarget, setDeleteTarget] = useState<PromoAttributionEntry | null>(null);

  // D4 overlap: compare code sets case/space-insensitive, warn only — never
  // auto-merge (manual entries have no source_order_no to prove sameness).
  const autoCodes = new Set(auto.map((a) => normalizeCode(a.code)));
  const manualCodes = new Set(summary.map((s) => normalizeCode(s.code)));
  const isOverlap = (code: string) => autoCodes.has(normalizeCode(code)) && manualCodes.has(normalizeCode(code));

  function confirmDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    startTransition(async () => {
      const result = await deletePromoAttribution(target.id);
      if (!result.ok) {
        toast.push(result.error, "error");
        return;
      }
      toast.push("ลบรายการแล้ว");
      setDeleteTarget(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <Header />

      <AutoSection auto={auto} isOverlap={isOverlap} />

      <div>
        <SectionHeading
          title="คีย์มือ (โค้ด TikTok / Shopee)"
          description='ไฟล์นำเข้าไม่เก็บโค้ดของช่องทางนี้ — บันทึกด้วยมือเมื่อลูกค้าพิมพ์โค้ด (เช่น "รับสิทธิ์99") ในแชท'
        />

        <div className="mt-3 space-y-4">
          <PromoAttributionForm channels={channels} />

          {summary.length === 0 ? (
            <EmptyState
              icon={Ticket}
              title="ยังไม่มีรายการบันทึก"
              description='เมื่อลูกค้าพิมพ์โค้ด (เช่น "รับสิทธิ์99") ในแชทหลังดู LINE broadcast ให้บันทึกยอดขายที่นี่ — จะรวมยอดเป็นการ์ดสรุปต่อโค้ดให้อัตโนมัติ'
            />
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                {summary.map((s) => (
                  <div key={s.code} className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate text-sm font-semibold text-zinc-700" title={s.code}>
                        {s.code}
                      </p>
                      {isOverlap(s.code) && <OverlapBadge />}
                    </div>
                    <p className="mt-1 text-2xl font-bold tabular-nums text-primary-700">{fmtBaht(s.totalAmount)}</p>
                    <p className="mt-1 text-xs text-zinc-500">
                      {s.entries.toLocaleString("en-US")} รายการ · เฉลี่ย {fmtBaht(s.avgAmount)}/รายการ
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-400">
                      {s.firstOn === s.lastOn ? s.firstOn : `${s.firstOn} – ${s.lastOn}`}
                    </p>
                  </div>
                ))}
              </div>

              <div className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
                <h2 className="mb-3 text-sm font-bold text-zinc-800">รายการล่าสุด</h2>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[680px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-zinc-200 text-xs font-semibold text-zinc-500">
                        <th className="py-2 pr-3">วันที่</th>
                        <th className="py-2 pr-3">โค้ด</th>
                        <th className="py-2 pr-3 text-right">ยอด</th>
                        <th className="py-2 pr-3">ช่องทาง</th>
                        <th className="py-2 pr-3">ลูกค้า</th>
                        <th className="py-2 pr-3">หมายเหตุ</th>
                        <th className="py-2 text-right">&nbsp;</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((e) => (
                        <tr key={e.id} className="border-b border-zinc-100 last:border-0">
                          <td className="py-2 pr-3 whitespace-nowrap text-zinc-600">{e.occurredOn}</td>
                          <td className="py-2 pr-3 font-medium text-zinc-800">{e.code}</td>
                          <td className="py-2 pr-3 text-right tabular-nums text-zinc-700">{fmtBaht(e.amount)}</td>
                          <td className="py-2 pr-3 text-zinc-600">{e.channelName ?? "—"}</td>
                          <td className="py-2 pr-3 text-zinc-600">{e.customerRef ?? "—"}</td>
                          <td className="max-w-[160px] truncate py-2 pr-3 text-zinc-500" title={e.note ?? undefined}>
                            {e.note ?? "—"}
                          </td>
                          <td className="py-2 text-right">
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(e)}
                              aria-label={`ลบรายการ ${e.code} วันที่ ${e.occurredOn}`}
                              className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-md text-zinc-400 hover:bg-red-50 hover:text-red-600"
                            >
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <Modal open={deleteTarget !== null} onClose={() => setDeleteTarget(null)} title="ลบรายการนี้?">
        {deleteTarget && (
          <div className="space-y-4">
            <p className="text-sm text-zinc-600">
              ลบรายการโค้ด <span className="font-semibold text-zinc-800">{deleteTarget.code}</span> ยอด{" "}
              <span className="font-semibold text-zinc-800">{fmtBaht(deleteTarget.amount)}</span> วันที่{" "}
              {deleteTarget.occurredOn} — ยกเลิกไม่ได้
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeleteTarget(null)} disabled={pending}>
                ยกเลิก
              </Button>
              <Button variant="danger" onClick={confirmDelete} loading={pending}>
                ลบรายการ
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function Header() {
  return (
    <div>
      <h1 className="text-lg font-bold text-zinc-900">วัดผลโค้ด (Attribution)</h1>
      <p className="mt-0.5 text-sm text-zinc-500">
        มี 2 แหล่งข้อมูลแยกกัน อย่าบวกรวมยอดเอง — ด้านล่างเป็นโค้ดจากไฟล์ที่นำเข้า (อัตโนมัติ) ตามด้วยโค้ดที่บันทึกด้วยมือ
      </p>
    </div>
  );
}

function SectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h2 className="text-base font-bold text-zinc-900">{title}</h2>
      <p className="mt-0.5 text-sm text-zinc-500">{description}</p>
    </div>
  );
}

function AutoSection({
  auto,
  isOverlap,
}: {
  auto: PromoAttributionAuto[];
  isOverlap: (code: string) => boolean;
}) {
  return (
    <div>
      <SectionHeading
        title="จากไฟล์นำเข้า (อัตโนมัติ)"
        description="โค้ดจากออเดอร์ LINE / หน้าร้าน (บันทึกจากไฟล์อัตโนมัติ) — อ่านอย่างเดียว อัปเดตเองทุกครั้งที่นำเข้าไฟล์ใหม่"
      />

      <div className="mt-3">
        {auto.length === 0 ? (
          <EmptyState
            icon={FileSpreadsheet}
            title="ยังไม่มีออเดอร์ที่ใช้โค้ดในไฟล์ที่นำเข้า"
            description="จะแสดงเมื่อมีออเดอร์ที่ใช้โค้ดส่วนลด (ฝั่ง LINE/หน้าร้าน) ในไฟล์ที่นำเข้า เช่น ไฟล์เดือนที่จัดโปร 9.9"
          />
        ) : (
          <div className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-xs font-semibold text-zinc-500">
                    <th className="py-2 pr-3">โค้ด</th>
                    <th className="py-2 pr-3 text-right">ออเดอร์</th>
                    <th className="py-2 pr-3 text-right">ยอดขายรวม</th>
                    <th className="py-2 pr-3 text-right">เฉลี่ย/ออเดอร์</th>
                    <th className="py-2 pr-3">ช่วงวันที่</th>
                    <th className="py-2">ช่องทาง</th>
                  </tr>
                </thead>
                <tbody>
                  {auto.map((a) => (
                    <tr key={a.code} className="border-b border-zinc-100 last:border-0 align-top">
                      <td className="py-2 pr-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium text-zinc-800">{a.code}</span>
                          {isOverlap(a.code) && <OverlapBadge />}
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-zinc-700">
                        {a.orders.toLocaleString("en-US")}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-zinc-700">{fmtBaht(a.totalRevenue)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-zinc-700">{fmtBaht(a.avgRevenue)}</td>
                      <td className="py-2 pr-3 whitespace-nowrap text-zinc-600">
                        {a.firstOn === a.lastOn ? a.firstOn : `${a.firstOn} – ${a.lastOn}`}
                      </td>
                      <td className="py-2">
                        <div className="flex flex-wrap gap-1">
                          {a.channelBreakdown.map((c) => (
                            <Badge key={c.channelName} tone="slate">
                              {c.channelName} {c.orders.toLocaleString("en-US")} · {fmtBaht(c.revenue)}
                            </Badge>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
