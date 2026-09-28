import Link from "next/link";
import { BarChart3, ExternalLink } from "lucide-react";
import type { ContentPostHistoryRow, ContentTypeRow } from "@/lib/marketing/content-types";
import { PLATFORM_LABEL } from "@/lib/marketing/content-types";
import { formatCount, formatThaiDateOnly } from "@/lib/tiktok/format";
import { ContentTypeChip } from "@/components/domain/marketing/ContentTypeChip";

// ContentPostHistoryTable — plain read-only HTML table for
// /marketing/content/history, mirrors components/domain/marketing/AdSpendTable.tsx
// (overflow-x-auto wrapper, `formatCount`, "—" for a null count). No client
// state, no filters/sort — Tech Lead brief 27 ก.ย. 69 says "ง่ายๆ", so this
// is intentionally just a table.

/** "—" for a null field — matches AdSpendTable's null-count convention
 * exactly (a null count here means "never entered", not zero — see
 * content_post_metric's own comment: null ≠ 0). */
function fmtMetric(n: number | null): string {
  return n === null ? "—" : formatCount(n);
}

export function ContentPostHistoryTable({
  rows,
  contentTypes,
}: {
  rows: ContentPostHistoryRow[];
  contentTypes: ContentTypeRow[];
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-xs font-semibold text-zinc-500">
              <th scope="col" className="py-2 pr-3">
                วันที่โพสต์
              </th>
              <th scope="col" className="py-2 pr-3">
                แคปชั่น
              </th>
              <th scope="col" className="py-2 pr-3">
                ประเภท
              </th>
              <th scope="col" className="py-2 pr-3 text-center">
                ลิงก์
              </th>
              <th scope="col" className="py-2">
                ตัวเลขล่าสุดที่กรอก
              </th>
              <th scope="col" className="py-2 pl-3 text-center">
                ดู KPI
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const matchedType = contentTypes.find((ct) => ct.code === row.contentTypeCode);
              return (
                <tr key={row.postId} className="border-b border-zinc-100 last:border-0 align-top">
                  <td className="py-2 pr-3 whitespace-nowrap text-zinc-600">
                    {formatThaiDateOnly(row.postedDateTh)}
                  </td>
                  <td className="max-w-xs py-2 pr-3">
                    {row.captionSnapshot ? (
                      <p className="truncate text-zinc-700" title={row.captionSnapshot}>
                        {row.captionSnapshot}
                      </p>
                    ) : (
                      <span className="text-zinc-400">—</span>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    {matchedType ? (
                      <ContentTypeChip contentType={matchedType} />
                    ) : (
                      <span className="text-xs text-zinc-400">ยังไม่ระบุ</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-center">
                    <a
                      href={row.postUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={`เปิดลิงก์ ${PLATFORM_LABEL[row.platform]}`}
                      aria-label={`เปิดลิงก์โพสต์ ${PLATFORM_LABEL[row.platform]}`}
                      className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-md text-primary-700 hover:bg-primary-50 hover:text-primary-800"
                    >
                      <ExternalLink className="h-4 w-4" aria-hidden="true" />
                    </a>
                  </td>
                  <td className="py-2">
                    {row.latestMetric ? (
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-zinc-600">
                        <span>วิว {fmtMetric(row.latestMetric.view)}</span>
                        <span>ถูกใจ {fmtMetric(row.latestMetric.like)}</span>
                        <span>คอมเมนต์ {fmtMetric(row.latestMetric.comment)}</span>
                        <span>บันทึก {fmtMetric(row.latestMetric.save)}</span>
                        <span>แชร์ {fmtMetric(row.latestMetric.share)}</span>
                      </div>
                    ) : (
                      <span className="text-xs text-zinc-400">ยังไม่มีตัวเลข</span>
                    )}
                  </td>
                  <td className="py-2 pl-3 text-center">
                    <Link
                      href={`/marketing/content/history/${row.postId}`}
                      title="ดู KPI ของคลิปนี้"
                      aria-label="ดู KPI ของคลิปนี้"
                      className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-md text-primary-700 hover:bg-primary-50 hover:text-primary-800"
                    >
                      <BarChart3 className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
