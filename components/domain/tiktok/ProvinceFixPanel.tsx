"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorBanner } from "@/components/ui/ErrorState";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { findOrdersByTracking, revertOrderProvince, setOrderProvince } from "@/lib/actions/labels";
import type { LabelReasonCode, OrderSourceRef } from "@/lib/labels/types";
import type { CrmProvinceOption } from "@/lib/crm/order-override";
import { PROVINCE_SOURCE_LABEL, isRealProvinceCode, provinceNameByCode } from "@/lib/labels/ui-format";
import { ProvinceSelect } from "./ProvinceSelect";
import { LabelReasonSelect } from "./LabelReasonSelect";

function messageFromError(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/**
 * ProvinceFixRow — หนึ่งออเดอร์ในผลค้นหาของ ProvinceFixPanel ด้านล่าง
 *
 * ⚠️ Contract gap (flagged, ไม่ได้เดาเติม): backend brief ข้อ 2 อยากได้คอลัมน์
 * "วันที่ · ช่องทาง" และ "แก้ล่าสุด (audit)" ด้วย — แต่ `OrderSourceRef`
 * (lib/labels/types.ts, สัญญาจาก findOrdersByTracking) ไม่มีทั้งสองอย่างนี้
 * (มีแค่ factOrderId/sourceOrderNo/trackingNo/provinceCode/provinceSource/
 * importFileName/sourceRowNo) และไม่มี action ไหนคืน audit trail ของการแก้
 * province เป็นรายการให้ query ต่อ — จึงข้ามสองส่วนนี้ไปทั้งคู่แทนที่จะเดาว่า
 * ควรมาจากไหน (อาจเป็นคนละ tenant/join กับที่ actions อื่นกรองไว้แล้ว)
 *
 * "ย้อนกลับ" ก็ไม่มีวิธีเช็คล่วงหน้าว่ามีประวัติให้ย้อนจริงไหม (revertOrderProvince
 * คืน error ทั่วไปถ้าไม่มี) — ใช้ heuristic แสดงปุ่มเมื่อ provinceSource !==
 * 'import' (แปลว่าเคยถูกแก้มาจาก label/manual แล้วอย่างน้อยหนึ่งครั้ง) แล้วให้
 * RPC เป็นด่านจริงถ้ากดแล้วไม่มีประวัติจริง (error fail-soft ต่อแถว).
 */
function ProvinceFixRow({
  order,
  provinces,
  canEdit,
  onChanged,
}: {
  order: OrderSourceRef;
  provinces: CrmProvinceOption[];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [provinceCode, setProvinceCode] = useState(order.provinceCode);
  const [reason, setReason] = useState<LabelReasonCode | "">("");
  const [note, setNote] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmingRevert, setConfirmingRevert] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reverting, setReverting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reasonRequired = isRealProvinceCode(order.provinceCode);
  const canRevert = order.provinceSource !== "import";

  // resync เมื่อ onChanged() ด้านล่างค้นใหม่แล้วได้ order.provinceCode สดกลับมา
  // (setState ตอน useState init ทำงานแค่ mount ครั้งแรก — ไม่งั้น dropdown จะค้าง
  // ค่าที่เพิ่งกดไปแทนที่จะโชว์ค่าจริงล่าสุดหลังบันทึก/ย้อนสำเร็จ)
  useEffect(() => {
    setProvinceCode(order.provinceCode);
    setReason("");
    setNote("");
  }, [order.factOrderId, order.provinceCode]);

  function validateAndOpen() {
    setError(null);
    if (!provinceCode) {
      setError("กรุณาเลือกจังหวัดก่อนบันทึก");
      return;
    }
    if (reasonRequired && !reason) {
      setError("ออเดอร์นี้มีจังหวัดอยู่แล้ว กรุณาเลือกเหตุผลก่อนบันทึก");
      return;
    }
    if (reasonRequired) {
      setConfirmOpen(true);
    } else {
      void doSave();
    }
  }

  async function doSave() {
    setConfirmOpen(false);
    setSaving(true);
    setError(null);
    try {
      const result = await setOrderProvince(order.factOrderId, provinceCode, reason || null, note.trim() ? note.trim() : null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.push(`บันทึกจังหวัดออเดอร์ ${order.sourceOrderNo} แล้ว`);
      onChanged();
    } catch (err) {
      setError(messageFromError(err, "ตั้งค่าจังหวัดไม่สำเร็จ"));
    } finally {
      setSaving(false);
    }
  }

  async function doRevert() {
    setConfirmingRevert(false);
    setReverting(true);
    setError(null);
    try {
      const result = await revertOrderProvince(order.factOrderId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.push(`ย้อนจังหวัดออเดอร์ ${order.sourceOrderNo} แล้ว`);
      onChanged();
    } catch (err) {
      setError(messageFromError(err, "ย้อนค่าจังหวัดไม่สำเร็จ"));
    } finally {
      setReverting(false);
    }
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3 shadow-sm" role="listitem">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-zinc-800">ออเดอร์ {order.sourceOrderNo}</p>
          <p className="font-mono text-xs text-zinc-500">{order.trackingNo ?? "ไม่มีเลขพัสดุ"}</p>
        </div>
        <p className="text-xs text-zinc-500">
          จังหวัดปัจจุบัน: <span className="font-medium text-zinc-700">{provinceNameByCode(provinces, order.provinceCode)}</span>{" "}
          <span className="text-zinc-400">({PROVINCE_SOURCE_LABEL[order.provinceSource]})</span>
        </p>
      </div>
      <p className="mt-1 text-xs text-zinc-400">
        {order.importFileName
          ? `นำเข้าจาก ${order.importFileName}${order.sourceRowNo != null ? ` แถว ${order.sourceRowNo}` : ""}`
          : "ไม่มีข้อมูลไฟล์นำเข้า"}
      </p>

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <ProvinceSelect
          ariaLabel={`เปลี่ยนจังหวัด — ออเดอร์ ${order.sourceOrderNo}`}
          value={provinceCode}
          onChange={setProvinceCode}
          provinces={provinces}
          disabled={!canEdit}
        />
        <LabelReasonSelect
          ariaLabel={`เหตุผล — ออเดอร์ ${order.sourceOrderNo}`}
          value={reason}
          onChange={setReason}
          required={reasonRequired}
          disabled={!canEdit}
        />
      </div>
      <input
        type="text"
        aria-label={`หมายเหตุ — ออเดอร์ ${order.sourceOrderNo}`}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        disabled={!canEdit}
        placeholder="หมายเหตุเพิ่มเติม (ไม่บังคับ)"
        className="mt-2 min-h-11 w-full rounded-md border border-zinc-300 px-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 disabled:bg-zinc-50"
      />

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      <div className="mt-2.5 flex flex-wrap justify-end gap-2">
        {canRevert &&
          (confirmingRevert ? (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-zinc-500">ย้อนกลับเป็นค่าก่อนหน้า?</span>
              <Button type="button" variant="danger" size="sm" loading={reverting} onClick={() => void doRevert()}>
                ยืนยัน
              </Button>
              <Button type="button" variant="ghost" size="sm" disabled={reverting} onClick={() => setConfirmingRevert(false)}>
                ยกเลิก
              </Button>
            </div>
          ) : (
            <Button type="button" variant="secondary" size="sm" disabled={!canEdit || saving} onClick={() => setConfirmingRevert(true)}>
              ย้อนกลับ
            </Button>
          ))}
        <Button type="button" variant="primary" size="sm" disabled={!canEdit || saving} loading={saving} onClick={validateAndOpen}>
          บันทึก
        </Button>
      </div>

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title="ยืนยันการทับค่าจังหวัด">
        <div className="flex flex-col gap-3">
          <p className="text-sm text-zinc-700">
            ออเดอร์ {order.sourceOrderNo} มีจังหวัด <span className="font-semibold">{provinceNameByCode(provinces, order.provinceCode)}</span> อยู่แล้ว
            — จะเปลี่ยนเป็น <span className="font-semibold">{provinceNameByCode(provinces, provinceCode)}</span> ยืนยันหรือไม่?
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" className="flex-1" onClick={() => setConfirmOpen(false)} disabled={saving}>
              ยกเลิก
            </Button>
            <Button type="button" variant="primary" className="flex-1" loading={saving} onClick={() => void doSave()}>
              ยืนยัน
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/**
 * ProvinceFixPanel — /tiktok/upload ใต้คิวรอตรวจ (design §4/§5 Phase A, owner
 * 11 ก.ย. คำถาม #2: "แผงแก้จังหวัดที่ /tiktok/upload (ค้นเลขพัสดุ) พอไหม" →
 * ตอบรับ). ค้นด้วยเลขพัสดุหรือเลขที่ออเดอร์ (exact match — findOrdersByTracking)
 * แล้วแก้/ย้อนจังหวัดตรงจากออเดอร์ ไม่ผูกกับ stg_label_page ใดๆ.
 */
export function ProvinceFixPanel({ provinces, canEdit }: { provinces: CrmProvinceOption[]; canEdit: boolean }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<OrderSourceRef[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runSearch(q: string) {
    const clean = q.trim();
    if (!clean) {
      setError("กรอกเลขพัสดุหรือเลขที่ออเดอร์ก่อนค้นหา");
      return;
    }
    setSearching(true);
    setError(null);
    try {
      const result = await findOrdersByTracking(clean);
      if (!result.ok) {
        setError(result.error);
        setResults([]);
        return;
      }
      setResults(result.data);
      setHasSearched(true);
    } catch (err) {
      setError(messageFromError(err, "ค้นหาออเดอร์ไม่สำเร็จ"));
    } finally {
      setSearching(false);
    }
  }

  return (
    <section aria-label="แก้ไขจังหวัดตามเลขพัสดุ/เลขที่ออเดอร์">
      <p className="mb-2 text-xs font-bold tracking-wide text-zinc-400 uppercase">แก้ไขจังหวัด (ค้นด้วยเลขพัสดุ/เลขที่ออเดอร์)</p>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void runSearch(query);
        }}
      >
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="เลขพัสดุ หรือ เลขที่ออเดอร์"
          aria-label="ค้นหาเลขพัสดุหรือเลขที่ออเดอร์"
          className="min-h-11 flex-1 rounded-md border border-zinc-300 px-3 text-sm text-zinc-900 placeholder:text-zinc-400"
        />
        <Button type="submit" variant="primary" loading={searching} disabled={searching}>
          <Search className="h-4 w-4" aria-hidden="true" /> ค้นหา
        </Button>
      </form>

      <div className="mt-2">
        {!hasSearched && !error && !searching && <p className="text-xs text-zinc-400">พิมพ์เลขพัสดุหรือเลขที่ออเดอร์แล้วกดค้นหา</p>}

        {error && <ErrorBanner message={error} onRetry={() => void runSearch(query)} />}

        {!error && hasSearched && !searching && results.length === 0 && (
          <EmptyState icon={Search} title="ไม่พบออเดอร์" description="ตรวจสอบเลขพัสดุ/เลขที่ออเดอร์อีกครั้ง" />
        )}

        {!error && results.length > 0 && (
          <div className="flex flex-col gap-2" role="list">
            {results.map((o) => (
              <ProvinceFixRow key={o.factOrderId} order={o} provinces={provinces} canEdit={canEdit} onChanged={() => void runSearch(query)} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
