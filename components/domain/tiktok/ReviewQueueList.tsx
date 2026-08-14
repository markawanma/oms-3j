"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import type { BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import type { UploadReviewRow } from "@/lib/tiktok/types";

// amber = "ต้องตรวจสอบ" (not red — this is uncertain data, not an error;
// design §3: "ไม่ใช่ red เพราะไม่ใช่ error"). sku_unknown reuses the same
// "not-yet-classified" meaning as `slate` elsewhere in this module.
const ISSUE_BADGE_TONE: Record<UploadReviewRow["issueType"], BadgeTone> = {
  address_unclear: "amber",
  sku_unknown: "slate",
  recipient_name_error: "amber",
};

const ADDRESS_TYPE_OPTIONS = ["บ้าน", "คอนโด", "ที่ทำงาน"];
const PROVINCE_OPTIONS = ["กรุงเทพมหานคร", "นนทบุรี", "ชลบุรี"];
const SKU_ALIAS_OPTIONS = ["จี้ปี่เซียะ 13มม (SE-piu13)", "สร้อยเงินดิสโก้ (NC20-21)", "ต่างหูเงิน (ER-01)"];

function ReviewQueueRowItem({ row, onConfirm }: { row: UploadReviewRow; onConfirm: (id: string) => void }) {
  const [addressType, setAddressType] = useState(ADDRESS_TYPE_OPTIONS[0]);
  const [province, setProvince] = useState(PROVINCE_OPTIONS[0]);
  const [skuAlias, setSkuAlias] = useState("");
  const [recipientName, setRecipientName] = useState("");

  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm" role="listitem">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold text-zinc-800 tabular-nums">{row.externalOrderId}</span>
        <Badge tone={ISSUE_BADGE_TONE[row.issueType]}>{row.issueBadgeLabel}</Badge>
      </div>

      {row.issueType === "address_unclear" && (
        <div className="flex flex-wrap gap-2">
          <label className="flex min-w-[130px] flex-1 flex-col gap-1 text-xs font-semibold text-zinc-600">
            ประเภทที่อยู่
            <select
              value={addressType}
              onChange={(e) => setAddressType(e.target.value)}
              className="min-h-11 rounded-md border border-zinc-300 px-2 text-sm text-zinc-800"
            >
              {ADDRESS_TYPE_OPTIONS.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </label>
          <label className="flex min-w-[130px] flex-1 flex-col gap-1 text-xs font-semibold text-zinc-600">
            จังหวัด
            <select
              value={province}
              onChange={(e) => setProvince(e.target.value)}
              className="min-h-11 rounded-md border border-zinc-300 px-2 text-sm text-zinc-800"
            >
              {PROVINCE_OPTIONS.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </label>
        </div>
      )}

      {row.issueType === "sku_unknown" && (
        <label className="flex flex-col gap-1 text-xs font-semibold text-zinc-600">
          จับคู่สินค้า (sku alias)
          <select
            value={skuAlias}
            onChange={(e) => setSkuAlias(e.target.value)}
            className="min-h-11 rounded-md border border-zinc-300 px-2 text-sm text-zinc-800"
          >
            <option value="">— เลือกสินค้า —</option>
            {SKU_ALIAS_OPTIONS.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </label>
      )}

      {row.issueType === "recipient_name_error" && (
        <label className="flex flex-col gap-1 text-xs font-semibold text-zinc-600">
          ชื่อผู้รับ (แก้ให้ถูก)
          <input
            type="text"
            value={recipientName}
            onChange={(e) => setRecipientName(e.target.value)}
            placeholder="พิมพ์ชื่อที่ถูกต้อง"
            className="min-h-11 rounded-md border border-zinc-300 px-2.5 text-sm text-zinc-800"
          />
        </label>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="primary" size="sm" onClick={() => onConfirm(row.id)}>
          ยืนยัน
        </Button>
      </div>
    </div>
  );
}

// NOTE (a11y debt): design §6 asks for a real `<table>` for the review
// queue so screen readers get column headers. The approved mockup itself
// renders these as cards (`.rrow` divs) with a different field set per
// issueType (address needs 2 selects, sku needs 1, name needs a text
// input) — a literal <table> with heterogeneous per-row inputs would need
// awkward colspan gymnastics. Kept as a labeled list of cards to match the
// approved visual design; flagged for a follow-up a11y pass rather than
// silently diverging without a note.
export function ReviewQueueList({ rows, onConfirm }: { rows: UploadReviewRow[]; onConfirm: (id: string) => void }) {
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-col gap-2.5" role="list" aria-label="รายการรอตรวจสอบ">
      {rows.map((row) => (
        <ReviewQueueRowItem key={row.id} row={row} onConfirm={onConfirm} />
      ))}
    </div>
  );
}
