"use client";

// OversoldQueueClient — /orders/oversold follow-up tracker (COO 9.9 ops-plan-99
// §6). Lists orders currently held as 'oversold_hold' (longest-held first) and
// lets owner/admin log the human follow-up (contacted? what was offered?
// resolved?) against the 48h SLA. Annotation only — the actual cancel/refund/
// fulfil stays on the order flow at /orders/[id] (linked per card).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, ExternalLink, PackageX } from "lucide-react";
import {
  oversoldContactStatusLabel,
  oversoldContactStatusTone,
  oversoldResolutionLabel,
  oversoldSlaState,
  OVERSOLD_SLA_LABEL_TH,
  OVERSOLD_SLA_TONE,
  type OversoldContactStatus,
  type OversoldHoldRow,
  type OversoldResolution,
} from "@/lib/oversold/types";
import { updateOversoldFollowup } from "@/lib/actions/oversold";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { useToast } from "@/components/ui/Toast";

const CONTACT_OPTIONS: OversoldContactStatus[] = ["pending", "contacted", "resolved"];
const RESOLUTION_OPTIONS: OversoldResolution[] = ["restock", "swap", "refund", "other"];

function fmtBaht(n: number): string {
  return `฿${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtHeld(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)} นาที`;
  if (hours < 24) return `${hours.toFixed(1)} ชม.`;
  return `${Math.floor(hours / 24)} วัน ${Math.round(hours % 24)} ชม.`;
}

function fmtPlaced(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
}

const selectCls = "min-h-11 rounded-md border border-zinc-300 px-2.5 text-sm text-zinc-900";

function OversoldCard({ row }: { row: OversoldHoldRow }) {
  const router = useRouter();
  const toast = useToast();
  const [contactStatus, setContactStatus] = useState<OversoldContactStatus>(row.contactStatus);
  const [resolution, setResolution] = useState<OversoldResolution | "">(row.resolution ?? "");
  const [note, setNote] = useState(row.note ?? "");
  const [pending, startTransition] = useTransition();

  const sla = oversoldSlaState(row.hoursHeld);

  function save() {
    startTransition(async () => {
      const result = await updateOversoldFollowup({
        orderId: row.orderId,
        contactStatus,
        resolution: resolution === "" ? null : resolution,
        note: note.trim() || null,
      });
      if (!result.ok) {
        toast.push(result.error, "error");
        return;
      }
      toast.push(`บันทึกการติดตาม ${row.externalOrderId} แล้ว`);
      router.refresh();
    });
  }

  return (
    <li
      className={`rounded-lg border bg-white p-3.5 shadow-sm ${
        sla === "breached" ? "border-red-400" : sla === "warning" ? "border-amber-300" : "border-zinc-200"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-sm font-semibold text-zinc-800">{row.externalOrderId}</span>
            <Badge tone={OVERSOLD_SLA_TONE[sla]}>ค้าง {fmtHeld(row.hoursHeld)} · {OVERSOLD_SLA_LABEL_TH[sla]}</Badge>
            <Badge tone={oversoldContactStatusTone(row.contactStatus)}>
              {oversoldContactStatusLabel(row.contactStatus)}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-zinc-700">
            {row.buyerName ?? "—"}
            {row.buyerPhone && <span className="text-zinc-500"> · {row.buyerPhone}</span>}
          </p>
          <p className="mt-0.5 text-xs text-zinc-400">
            {row.itemCount} ชิ้น · {fmtBaht(row.totalAmount)} · สั่งเมื่อ {fmtPlaced(row.placedAt)}
            {row.resolution && <> · ทางออก: {oversoldResolutionLabel(row.resolution)}</>}
          </p>
        </div>
        <Link
          href={`/orders/${row.orderId}`}
          className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary-700 hover:underline"
        >
          จัดการออเดอร์ (cancel/refund)
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </Link>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs font-semibold text-zinc-600">
          สถานะติดต่อ
          <select value={contactStatus} onChange={(e) => setContactStatus(e.target.value as OversoldContactStatus)} className={selectCls}>
            {CONTACT_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {oversoldContactStatusLabel(s)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-zinc-600">
          ทางออก
          <select value={resolution} onChange={(e) => setResolution(e.target.value as OversoldResolution | "")} className={selectCls}>
            <option value="">— ยังไม่เลือก —</option>
            {RESOLUTION_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {oversoldResolutionLabel(r)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="mt-2 flex flex-col gap-1 text-xs font-semibold text-zinc-600">
        หมายเหตุ
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="เช่น ลูกค้าโอเครอผลิตรอบหน้า / ขอคืนเงินแล้ว"
          className="rounded-md border border-zinc-300 px-2.5 py-1.5 text-sm text-zinc-900"
        />
      </label>
      <div className="mt-2 flex items-center justify-end gap-2">
        {row.followupUpdatedAt && (
          <span className="text-xs text-zinc-400">อัปเดตล่าสุด {fmtPlaced(row.followupUpdatedAt)}</span>
        )}
        <Button type="button" variant="primary" size="sm" onClick={save} loading={pending}>
          บันทึกการติดตาม
        </Button>
      </div>
    </li>
  );
}

export function OversoldQueueClient({ rows }: { rows: OversoldHoldRow[] }) {
  const breached = rows.filter((r) => oversoldSlaState(r.hoursHeld) === "breached").length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-zinc-900">คิวของไม่พอ (oversold hold)</h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          ออเดอร์ที่ขายเกินสต็อกตอนไลฟ์ — ติดตามให้เคลียร์ภายใน 48 ชม. (โทรหาลูกค้า/เสนอทางออก) · การ cancel/refund จริงทำที่หน้าออเดอร์
        </p>
      </div>

      {rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold text-zinc-800">ค้างอยู่ {rows.length} เคส</span>
          {breached > 0 && (
            <span className="inline-flex items-center gap-1 rounded-md bg-red-50 px-2 py-1 text-xs font-semibold text-red-700">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
              เกิน SLA 48 ชม. {breached} เคส
            </span>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon={PackageX}
          title="ไม่มีออเดอร์ค้างของไม่พอ 🎉"
          description="เคสจะโผล่ที่นี่เมื่อมีการขายเกินสต็อกตอนไลฟ์ (quick-order จับเป็น oversold_hold ให้อัตโนมัติ)"
        />
      ) : (
        <ul className="space-y-2.5">
          {rows.map((row) => (
            <OversoldCard key={row.orderId} row={row} />
          ))}
        </ul>
      )}
    </div>
  );
}
