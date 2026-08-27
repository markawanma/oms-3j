import { Badge } from "@/components/ui/Badge";
import type { BadgeTone } from "@/components/ui/Badge";
import type { LabelReviewRow } from "@/lib/labels/types";

// P1 review is READ-ONLY (design §5/§8, backend/§ "ให้เจ้าของเคาะ" — the
// province-picker UI for `conflict`/`needs_review` rows is explicitly P2's
// job, not P1's). This intentionally replaced the old editable
// address/sku/name-fixing form that used to live here — that form matched a
// different UploadReviewRow shape (address_unclear/sku_unknown/
// recipient_name_error) from the pre-real-backend mock, which no longer
// applies now that "review" means "province match was ambiguous", not "a
// field on the order needs a human edit".
const STATUS_TONE: Record<LabelReviewRow["status"], BadgeTone> = {
  needs_review: "amber",
  conflict: "red",
  order_not_found: "amber",
  undetected: "slate",
  parse_failed: "red",
};

const STATUS_LABEL: Record<LabelReviewRow["status"], string> = {
  needs_review: "รอตรวจ (จังหวัดไม่ชัด)",
  conflict: "ขัดแย้งกับข้อมูลเดิม",
  order_not_found: "หาออเดอร์ไม่เจอ",
  undetected: "รูปแบบไม่รู้จัก",
  parse_failed: "อ่านหน้าไม่ได้",
};

export function ReviewQueueList({ rows }: { rows: LabelReviewRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
      <table className="w-full min-w-[560px] text-left text-sm">
        <caption className="sr-only">รายการรอตรวจสอบ — อ่านอย่างเดียว เลือกจังหวัดเองได้ในเฟสถัดไป</caption>
        <thead className="border-b border-zinc-200 bg-zinc-50 text-xs font-bold tracking-wide text-zinc-500 uppercase">
          <tr>
            <th scope="col" className="px-3 py-2 tabular-nums">
              หน้า
            </th>
            <th scope="col" className="px-3 py-2">
              เลขพัสดุ
            </th>
            <th scope="col" className="px-3 py-2">
              รหัสไปรษณีย์
            </th>
            <th scope="col" className="px-3 py-2">
              สถานะ
            </th>
            <th scope="col" className="px-3 py-2">
              จังหวัดที่เป็นไปได้
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {rows.map((row) => (
            <tr key={row.pageId}>
              <td className="px-3 py-2 tabular-nums text-zinc-600">{row.pageNo}</td>
              <td className="px-3 py-2 font-mono text-xs text-zinc-700">{row.trackingNo ?? "—"}</td>
              <td className="px-3 py-2 tabular-nums text-zinc-600">{row.zipcode ?? "—"}</td>
              <td className="px-3 py-2">
                <Badge tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Badge>
              </td>
              <td className="px-3 py-2 text-zinc-600">
                {row.candidates.length > 0 ? row.candidates.map((c) => c.nameTh).join(", ") : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-zinc-200 px-3 py-2 text-xs text-zinc-400">
        อ่านอย่างเดียวในเฟสนี้ — เลือกจังหวัดเองรายแถวได้ในเฟสถัดไป
      </p>
    </div>
  );
}
