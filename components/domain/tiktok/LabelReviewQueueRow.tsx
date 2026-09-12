"use client";

import { useEffect, useState } from "react";
import { Eye, ScrollText } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import type { BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import {
  findOrdersByTracking,
  getLabelPageSnippet,
  getLabelPageViewUrl,
  ignoreLabelPage,
  resolveLabelPage,
} from "@/lib/actions/labels";
import type { LabelReasonCode, LabelReviewRow, OrderSourceRef } from "@/lib/labels/types";
import type { CrmProvinceOption } from "@/lib/crm/order-override";
import {
  TAUGHT_SNIPPET_MAX_LENGTH,
  isRealProvinceCode,
  orderSourceLine,
  provinceNameByCode,
  validateTaughtSnippet,
} from "@/lib/labels/ui-format";
import { ProvinceSelect } from "./ProvinceSelect";
import { LabelReasonSelect } from "./LabelReasonSelect";

// Exported so PendingReviewQueue.tsx (and this file's own render below) share
// ONE status->tone/label mapping instead of two copies drifting apart —
// moved here (was in ReviewQueueList.tsx) now that both queue UIs render
// through this shared row component.
export const REVIEW_STATUS_TONE: Record<LabelReviewRow["status"], BadgeTone> = {
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

// UAT 29 ส.ค. 69: 'undetected' ที่มี reason='packing_slip_only' คือหน้า
// "ใบสรุปสินค้า" ท้ายออเดอร์ของ TikTok (ไม่มีเลขพัสดุ/ที่อยู่ให้จับคู่ได้ —
// ดู lib/labels/formats/tiktok.ts looksLikePackingSlipOnly()) — ไม่ใช่ปัญหา
// ที่ต้องแก้ ข้อความจึงต้องบอกตรงว่า "ไม่ใช่ใบปะหน้า" ไม่ใช่ "อ่านไม่ได้"
export function reviewRowStatusLabel(row: LabelReviewRow): string {
  if (row.status === "undetected" && row.reason === "packing_slip_only") {
    return "ไม่ใช่ใบปะหน้า (หน้าใบสรุปสินค้า) — ไม่ต้องตรวจ";
  }
  return STATUS_LABEL[row.status];
}

function messageFromError(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

export interface LabelReviewQueueRowProps {
  row: LabelReviewRow;
  /** โชว์เฉพาะเมื่อคิวรวมหลายไฟล์ (PendingReviewQueue) — ตอนอยู่ใต้หัวข้อ
   * "สรุป — {fileName}" ของ ReviewQueueList ไม่ต้องส่งมา (ซ้ำซ้อน). */
  fileName?: string;
  /** PendingReviewQueue ได้ค่านี้มาจาก getPendingLabelReviews() อยู่แล้ว
   * (อาจเป็น [] จริงๆ ก็ได้ — ไม่ใช่ "ยังไม่รู้"). ReviewQueueList (แถวสดหลัง
   * อัปโหลด) ไม่มีค่านี้ติดมา — ส่ง undefined แล้ว component นี้ไปค้นเองผ่าน
   * findOrdersByTracking() (decision #3: "ทุกแถวต้องบอกที่มาให้เปิดอ่านเองได้"
   * ใช้ได้กับทุกที่ที่มี trackingNo ไม่ใช่แค่ ProvinceFixPanel). */
  orderSources?: OrderSourceRef[];
  provinces: CrmProvinceOption[];
  canEdit: boolean;
  onResolved: (pageId: string) => void;
}

export function LabelReviewQueueRow({
  row,
  fileName,
  orderSources: orderSourcesProp,
  provinces,
  canEdit,
  onResolved,
}: LabelReviewQueueRowProps) {
  const toast = useToast();

  const [sources, setSources] = useState<OrderSourceRef[] | null>(orderSourcesProp ?? null);
  const [sourcesError, setSourcesError] = useState<string | null>(null);
  const sourcesLoading = orderSourcesProp === undefined && sources === null && !sourcesError;

  const [selectedProvince, setSelectedProvince] = useState(row.candidates.length === 1 ? row.candidates[0].code : "");
  const [reason, setReason] = useState<LabelReasonCode | "">("");
  const [note, setNote] = useState("");
  const [taughtSnippet, setTaughtSnippet] = useState("");

  const [viewLoading, setViewLoading] = useState(false);
  const [snippetLoading, setSnippetLoading] = useState(false);
  const [snippetResult, setSnippetResult] = useState<{ snippet: string | null; zipcodeFound: boolean } | null>(null);

  const [submitting, setSubmitting] = useState<"resolve" | "ignore" | "keep" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Lazy-fetch order sources only when the parent didn't already supply them
  // (ReviewQueueList's fresh post-upload rows — see prop doc above). Skipped
  // entirely for pages with no trackingNo (nothing to look up). retryTick
  // lets the "ลองใหม่" button below re-run this without needing row.pageId
  // to change.
  const [retryTick, setRetryTick] = useState(0);
  useEffect(() => {
    if (orderSourcesProp !== undefined) return;
    if (!row.trackingNo) {
      setSources([]);
      return;
    }
    let cancelled = false;
    setSourcesError(null);
    findOrdersByTracking(row.trackingNo)
      .then((result) => {
        if (cancelled) return;
        if (result.ok) setSources(result.data);
        else setSourcesError(result.error);
      })
      .catch((err) => {
        if (!cancelled) setSourcesError(messageFromError(err, "ค้นหาออเดอร์ไม่สำเร็จ"));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pageId/trackingNo identify this row; retryTick is a manual re-run trigger only
  }, [row.pageId, retryTick]);

  const reasonRequired = (sources ?? []).some((o) => isRealProvinceCode(o.provinceCode));
  const noOrderFound = sources !== null && sources.length === 0 && !!row.trackingNo;
  const canResolve = canEdit && submitting === null && !!row.trackingNo && sources !== null && sources.length > 0;

  async function handleViewLabel() {
    setActionError(null);
    setViewLoading(true);
    try {
      const result = await getLabelPageViewUrl(row.pageId);
      if (!result.ok) {
        setActionError(result.error);
        return;
      }
      window.open(result.data.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setActionError(messageFromError(err, "เปิดดูใบไม่สำเร็จ"));
    } finally {
      setViewLoading(false);
    }
  }

  async function handleViewSnippet() {
    setActionError(null);
    setSnippetLoading(true);
    setSnippetResult(null); // ไม่ cache ของเก่า — โหลดสดทุกครั้ง (contract §8)
    try {
      const result = await getLabelPageSnippet(row.pageId);
      if (!result.ok) {
        setActionError(result.error);
        return;
      }
      setSnippetResult(result.data);
    } catch (err) {
      setActionError(messageFromError(err, "ดูข้อความไม่สำเร็จ"));
    } finally {
      setSnippetLoading(false);
    }
  }

  async function handleResolve() {
    setActionError(null);
    if (!row.trackingNo) {
      setActionError("หน้านี้ไม่มีเลขพัสดุ — ใช้ปุ่ม 'ไม่ใช่ใบปะหน้า/ข้าม' แทน");
      return;
    }
    if (noOrderFound) {
      setActionError("ไม่พบออเดอร์ที่ตรงกับเลขพัสดุนี้ในระบบ — นำเข้าออเดอร์ก่อนจึงยืนยันจังหวัดได้");
      return;
    }
    if (!selectedProvince) {
      setActionError("กรุณาเลือกจังหวัดก่อนยืนยัน");
      return;
    }
    if (reasonRequired && !reason) {
      setActionError("ออเดอร์นี้มีจังหวัดอยู่แล้ว กรุณาเลือกเหตุผลก่อนยืนยัน");
      return;
    }
    const snippetErr = validateTaughtSnippet(taughtSnippet);
    if (snippetErr) {
      setActionError(snippetErr);
      return;
    }

    setSubmitting("resolve");
    try {
      const result = await resolveLabelPage({
        pageId: row.pageId,
        provinceCode: selectedProvince,
        reason: reason || null,
        note: note.trim() ? note.trim() : null,
        taughtSnippet: taughtSnippet.trim() ? taughtSnippet.trim() : null,
      });
      if (!result.ok) {
        setActionError(result.error);
        return;
      }
      toast.push(`ยืนยันจังหวัดแล้ว — เติม ${result.data.appliedOrders} ออเดอร์`);
      onResolved(row.pageId);
    } catch (err) {
      setActionError(messageFromError(err, "ยืนยันจังหวัดไม่สำเร็จ"));
    } finally {
      setSubmitting(null);
    }
  }

  async function handleIgnore(kind: "ignore" | "keep") {
    setActionError(null);
    setSubmitting(kind);
    try {
      const result = await ignoreLabelPage({
        pageId: row.pageId,
        reason: reason || null,
        note: note.trim() ? note.trim() : null,
      });
      if (!result.ok) {
        setActionError(result.error);
        return;
      }
      toast.push(kind === "keep" ? "คงจังหวัดเดิมของออเดอร์ไว้ — เอาหน้านี้ออกจากคิวแล้ว" : "ทำเครื่องหมาย 'ไม่ใช่ใบปะหน้า' แล้ว");
      onResolved(row.pageId);
    } catch (err) {
      setActionError(messageFromError(err, "ทำรายการไม่สำเร็จ"));
    } finally {
      setSubmitting(null);
    }
  }

  const labelSuggestedProvince = row.candidates.length > 0 ? row.candidates[0] : null;
  const orderCurrentProvinceName =
    sources && sources.length > 0 ? provinceNameByCode(provinces, sources[0].provinceCode) : null;

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3 shadow-sm" role="listitem">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-zinc-500">
            {fileName ? `${fileName} · หน้า ${row.pageNo}` : `หน้า ${row.pageNo}`}
          </p>
          <p className="mt-0.5 font-mono text-sm text-zinc-800">{row.trackingNo ?? "ไม่พบเลขพัสดุในหน้านี้"}</p>
          <p className="text-xs text-zinc-400">รหัสไปรษณีย์: {row.zipcode ?? "—"}</p>
        </div>
        <Badge tone={REVIEW_STATUS_TONE[row.status]}>{reviewRowStatusLabel(row)}</Badge>
      </div>

      {/* ที่มาฝั่งออเดอร์ — decision #3: ทุกแถวเปิดอ่านที่มาเองได้ */}
      <div className="mt-2 text-xs text-zinc-500">
        {sourcesLoading && "กำลังค้นออเดอร์ที่ตรงเลขพัสดุนี้…"}
        {sourcesError && (
          <span className="text-red-600">
            {sourcesError}{" "}
            <button
              type="button"
              className="underline underline-offset-2"
              onClick={() => {
                setSourcesError(null);
                setSources(null);
                setRetryTick((n) => n + 1);
              }}
            >
              ลองใหม่
            </button>
          </span>
        )}
        {!sourcesLoading && !sourcesError && noOrderFound && (
          <span className="text-amber-700">ยังไม่พบออเดอร์ที่ตรงเลขพัสดุนี้ในระบบ — นำเข้าออเดอร์ก่อนจึงยืนยันจังหวัดได้</span>
        )}
        {!sourcesLoading && !sourcesError && sources && sources.length > 0 && (
          <ul className="space-y-0.5">
            {sources.map((o) => (
              <li key={o.factOrderId}>{orderSourceLine(o, provinces)}</li>
            ))}
          </ul>
        )}
      </div>

      {row.status === "conflict" && labelSuggestedProvince && (
        <div className="mt-2 rounded-md bg-red-50 px-2.5 py-2 text-xs text-red-800">
          <p>
            ออเดอร์มี {orderCurrentProvinceName ?? "—"} · ใบบอก {labelSuggestedProvince.nameTh}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!canEdit}
              onClick={() => setSelectedProvince(labelSuggestedProvince.code)}
            >
              ใช้ตามใบ
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!canEdit || submitting !== null}
              loading={submitting === "keep"}
              onClick={() => void handleIgnore("keep")}
            >
              คงค่าเดิม
            </Button>
          </div>
        </div>
      )}

      {row.candidates.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {row.candidates.map((c) => (
            <button
              key={c.code}
              type="button"
              disabled={!canEdit}
              onClick={() => setSelectedProvince(c.code)}
              className={`min-h-9 rounded-full border px-2.5 text-xs ${
                selectedProvince === c.code
                  ? "border-primary-600 bg-primary-50 text-primary-700"
                  : "border-zinc-300 text-zinc-600 hover:bg-zinc-50"
              }`}
            >
              {c.nameTh}
            </button>
          ))}
        </div>
      )}

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <ProvinceSelect
          ariaLabel={`เลือกจังหวัด — หน้า ${row.pageNo}`}
          value={selectedProvince}
          onChange={setSelectedProvince}
          provinces={provinces}
          disabled={!canEdit}
        />
        <LabelReasonSelect
          ariaLabel={`เหตุผล — หน้า ${row.pageNo}`}
          value={reason}
          onChange={setReason}
          required={reasonRequired}
          disabled={!canEdit}
        />
      </div>
      <input
        type="text"
        aria-label={`หมายเหตุ — หน้า ${row.pageNo}`}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        disabled={!canEdit}
        placeholder="หมายเหตุเพิ่มเติม (ไม่บังคับ)"
        className="mt-2 min-h-11 w-full rounded-md border border-zinc-300 px-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 disabled:bg-zinc-50"
      />

      <label className="mt-2 flex flex-col gap-1">
        <span className="text-xs font-medium text-zinc-600">จังหวัดอยู่ตรงข้อความนี้ (ไม่บังคับ)</span>
        <textarea
          value={taughtSnippet}
          onChange={(e) => setTaughtSnippet(e.target.value)}
          disabled={!canEdit}
          rows={2}
          maxLength={TAUGHT_SNIPPET_MAX_LENGTH}
          placeholder="พิมพ์ข้อความสั้นๆ ที่เห็นจังหวัดในใบ (ไม่เกิน 25 ตัว)"
          className="rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs text-zinc-900 placeholder:text-zinc-400 disabled:bg-zinc-50"
        />
        <span className="text-[0.65rem] text-zinc-400">ระบบเก็บข้อความนี้ไว้เรียนรู้เท่านั้น ยังไม่ได้เอาไปใช้อ่านใบอัตโนมัติ</span>
      </label>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <Button type="button" variant="secondary" size="sm" loading={viewLoading} onClick={() => void handleViewLabel()}>
          <Eye className="h-3.5 w-3.5" aria-hidden="true" /> ดูใบ
        </Button>
        <Button type="button" variant="secondary" size="sm" loading={snippetLoading} onClick={() => void handleViewSnippet()}>
          <ScrollText className="h-3.5 w-3.5" aria-hidden="true" /> ดูข้อความที่อ่านได้
        </Button>
      </div>
      {snippetResult && (
        <p className="mt-1.5 rounded-md bg-zinc-50 px-2.5 py-1.5 text-xs text-zinc-600">
          {snippetResult.snippet ?? "ไม่มีตัวอย่างข้อความให้ดู"}
        </p>
      )}

      {actionError && <p className="mt-2 text-xs text-red-600">{actionError}</p>}

      <div className="mt-2.5 flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!canEdit || submitting !== null}
          loading={submitting === "ignore"}
          onClick={() => void handleIgnore("ignore")}
        >
          ไม่ใช่ใบปะหน้า/ข้าม
        </Button>
        <Button type="button" variant="primary" size="sm" disabled={!canResolve} loading={submitting === "resolve"} onClick={() => void handleResolve()}>
          ยืนยันจังหวัด
        </Button>
      </div>
      {!canEdit && <p className="mt-1 text-right text-xs text-zinc-400">เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่จัดการได้</p>}
    </div>
  );
}
