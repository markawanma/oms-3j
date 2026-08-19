"use client";

// QuoteDetailClient — /oem/quotes/[id] (T6): view a saved quote's snapshot
// (`calc` = oem_price_calc's return AT THE TIME it was quoted — reprint-safe
// even if today's rates have since changed) + won/lost actions.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { setQuoteStatus } from "@/lib/actions/oem";
import type { OemQuoteRow } from "@/lib/oem/types";
import { OEM_METAL_LABEL_TH, OEM_QUOTE_STATUS_LABEL_TH } from "@/lib/oem/types";
import { formatBangkokTime } from "@/lib/format";
import { formatThaiDateOnly } from "@/lib/tiktok/format";
import { Badge } from "@/components/ui/Badge";
import type { BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { OemCalcBreakdown } from "./OemCalcBreakdown";
import { LostQuoteDialog } from "./LostQuoteDialog";

const STATUS_TONE: Record<OemQuoteRow["status"], BadgeTone> = {
  draft: "slate",
  quoted: "blue",
  won: "green",
  lost: "red",
  expired: "orange",
  rejected: "slate",
};

export function QuoteDetailClient({ quote }: { quote: OemQuoteRow }) {
  const router = useRouter();
  const toast = useToast();
  const [lostOpen, setLostOpen] = useState(false);
  const [wonPending, startWon] = useTransition();

  function markWon() {
    startWon(async () => {
      const result = await setQuoteStatus({ quoteId: quote.id, status: "won" });
      if (!result.ok) {
        toast.push(result.error, "error");
        return;
      }
      toast.push("ปิดงานแล้ว");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <Link href="/oem/quotes" className="inline-flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-700">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          กลับไปทะเบียนใบเสนอราคา
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-bold text-zinc-900">{quote.quoteNo}</h1>
          <Badge tone={STATUS_TONE[quote.status]}>{OEM_QUOTE_STATUS_LABEL_TH[quote.status]}</Badge>
          {quote.isExpired && <Badge tone="red">หมดอายุแล้ว</Badge>}
        </div>
        <p className="mt-0.5 text-xs text-zinc-400">
          ใช้เรตต้นทุน ณ วันที่ {formatThaiDateOnly(quote.createdAt.slice(0, 10))} · บันทึกเมื่อ {formatBangkokTime(quote.createdAt)}
        </p>
      </div>

      <section className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
        <h2 className="text-sm font-bold text-zinc-800">ลูกค้า &amp; งาน</h2>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-zinc-500">ลูกค้า</dt>
            <dd className="text-zinc-800">{quote.customerName || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">ช่องทางติดต่อ</dt>
            <dd className="text-zinc-800">{quote.customerContact || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">วัสดุ</dt>
            <dd className="text-zinc-800">{OEM_METAL_LABEL_TH[quote.input.metal]}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">ประเภทชิ้นงาน</dt>
            <dd className="text-zinc-800">{quote.input.itemKind}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">น้ำหนัก/ชิ้น</dt>
            <dd className="text-zinc-800">{quote.input.weightG} ก.</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">จำนวน</dt>
            <dd className="text-zinc-800">{quote.input.qty} ชิ้น</dd>
          </div>
        </dl>
        {quote.quoteValidUntil && (
          <p className="mt-2 text-xs text-zinc-500">
            ยืนราคาถึง {formatThaiDateOnly(quote.quoteValidUntil)}
            {quote.daysLeft != null && !quote.isExpired && ` (เหลือ ${quote.daysLeft} วัน)`}
          </p>
        )}
        {quote.approvalNote && (
          <p className="mt-2 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">เหตุผลที่ต่ำกว่า floor: {quote.approvalNote}</p>
        )}
        {quote.status === "lost" && (
          <p className="mt-2 rounded-md bg-red-50 px-2.5 py-1.5 text-xs text-red-700">
            แพ้งาน: {quote.lostReason}
            {quote.lostTo && ` · ได้ไปที่ ${quote.lostTo}`}
          </p>
        )}
      </section>

      <OemCalcBreakdown calc={quote.calc} metal={quote.input.metal} />

      {quote.status === "quoted" && (
        <div className="flex gap-2">
          <Button type="button" variant="secondary" className="flex-1" loading={wonPending} onClick={markWon}>
            ปิดงาน (ชนะ)
          </Button>
          <Button type="button" variant="danger" className="flex-1" onClick={() => setLostOpen(true)}>
            แพ้งาน
          </Button>
        </div>
      )}

      {lostOpen && (
        <LostQuoteDialog
          quote={quote}
          onClose={() => setLostOpen(false)}
          onConfirmed={() => {
            setLostOpen(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
