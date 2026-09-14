"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Pencil, RotateCcw } from "lucide-react";
import { crmClearOrderOverride, crmSetOrderOverride } from "@/lib/actions/crm";
import type { CrmCustomerOrderRow } from "@/lib/actions/crm";
import type { CrmChannelOption, CrmProvinceOption } from "@/lib/crm/order-override";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

/**
 * Edit button + modal for one order row (channel/revenue/discount/
 * order_date/bank/tags), plus — when the row is already edited — a "revert"
 * action. Owner/admin only (`canEdit`, decided server-side in page.tsx via
 * getDevRole()); crmSetOrderOverride/crmClearOrderOverride re-check the same
 * gate server-side regardless.
 *
 * IMPORTANT re: what gets sent — crm_set_order_override's RPC REPLACES the
 * whole overrides jsonb blob on every call (not a merge, see migration 0021
 * §7 comment). `order` here is already the OVERRIDE-AWARE row (v_fact_order
 * coalesces override -> raw), so every field below is prefilled with the
 * current effective value. On save this form sends the full 6-field object
 * back (not just the one field the user touched) so a previous override on
 * some other field is never silently dropped.
 *
 * province_code — REMOVED from this form (owner 11 ก.ย. 69, "ถอดเลย" —
 * design-label-teach-loop-yoda-11sep.md §4: two sources of truth for the
 * same order's province, this override layer + the raw fact_order.
 * province_code that ProvinceFixPanel/label resolve now write directly,
 * could silently disagree). Not just dropped from this form's UI — migration
 * 0116 also removed `province_code` from `OrderOverrideInput` and from the
 * RPC's write whitelist entirely, and backfilled any pre-existing override
 * value into the raw fact_order.province_code column. So there is no
 * pass-through to send here anymore: the overrides jsonb blob never carries
 * province at all post-0116, REPLACE-not-merge semantics or not. Editing
 * province now happens exclusively at /tiktok/upload → ProvinceFixPanel
 * (writes the raw column directly, no override layer involved).
 */
export function OrderOverrideForm({
  order,
  customerId,
  channels,
  provinces: _provinces,
  canEdit,
}: {
  order: CrmCustomerOrderRow;
  customerId: string;
  channels: CrmChannelOption[];
  provinces: CrmProvinceOption[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [channelId, setChannelId] = useState(order.channelId);
  const [revenue, setRevenue] = useState(String(order.revenue));
  const [discount, setDiscount] = useState(String(order.discount));
  const [orderDate, setOrderDate] = useState(order.orderDate);
  const [bank, setBank] = useState(order.bank ?? "");
  const [tagsText, setTagsText] = useState((order.tags ?? []).join(", "));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmRevert, setConfirmRevert] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!canEdit) return null;

  function openModal() {
    setChannelId(order.channelId);
    setRevenue(String(order.revenue));
    setDiscount(String(order.discount));
    setOrderDate(order.orderDate);
    setBank(order.bank ?? "");
    setTagsText((order.tags ?? []).join(", "));
    setReason("");
    setError(null);
    setOpen(true);
  }

  function handleSave() {
    const revenueNum = Number(revenue);
    const discountNum = Number(discount);
    if (!Number.isFinite(revenueNum) || revenueNum < 0) {
      setError("ยอดขายต้องเป็นตัวเลขไม่ติดลบ");
      return;
    }
    if (!Number.isFinite(discountNum) || discountNum < 0) {
      setError("ส่วนลดต้องเป็นตัวเลขไม่ติดลบ");
      return;
    }
    if (!orderDate) {
      setError("กรุณาเลือกวันที่");
      return;
    }
    const tags = tagsText
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    startTransition(async () => {
      const result = await crmSetOrderOverride(
        order.id,
        customerId,
        {
          channel_id: channelId,
          // province_code ไม่มีในทั้ง OrderOverrideInput และ RPC whitelist
          // อีกแล้ว (migration 0116) — ไม่ต้อง pass-through ค่านี้ (ดูคอมเมนต์
          // หัวไฟล์). แก้จังหวัดจริงย้ายไป /tiktok/upload → แผงแก้จังหวัดแล้ว
          revenue: revenueNum,
          discount: discountNum,
          order_date: orderDate,
          bank: bank.trim(),
          tags,
        },
        reason
      );
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  function handleRevert() {
    startTransition(async () => {
      const result = await crmClearOrderOverride(order.id, customerId);
      setConfirmRevert(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <>
      <div className="flex items-center justify-end gap-1">
        {order.isEdited &&
          (confirmRevert ? (
            <div className="flex items-center gap-1">
              <span className="text-[0.68rem] text-zinc-500">คืนค่าเดิม?</span>
              <Button variant="danger" size="sm" loading={pending} onClick={handleRevert}>
                ยืนยัน
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmRevert(false)} disabled={pending}>
                ยกเลิก
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmRevert(true)}
              aria-label="คืนค่าออเดอร์เดิม"
              title="คืนค่าออเดอร์เดิม"
              className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ))}
        <button
          type="button"
          onClick={openModal}
          aria-label="แก้ไขออเดอร์"
          title="แก้ไขออเดอร์"
          className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={`แก้ไขออเดอร์ ${order.sourceOrderNo}`}>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-600">ช่องทาง</span>
            <select
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
              className="min-h-11 rounded-md border border-zinc-300 px-2.5 text-sm text-zinc-900"
            >
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <p className="rounded-md bg-zinc-50 px-2.5 py-2 text-xs text-zinc-500">
            แก้จังหวัดได้ที่{" "}
            <Link href="/tiktok/upload" className="font-medium text-primary-700 underline underline-offset-2">
              /tiktok/upload → แผงแก้จังหวัด
            </Link>{" "}
            (ค้นด้วยเลขพัสดุ/เลขที่ออเดอร์)
          </p>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-zinc-600">ยอดขาย (บาท)</span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={revenue}
                onChange={(e) => setRevenue(e.target.value)}
                className="min-h-11 rounded-md border border-zinc-300 px-2.5 text-sm text-zinc-900"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-zinc-600">ส่วนลด (บาท)</span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
                className="min-h-11 rounded-md border border-zinc-300 px-2.5 text-sm text-zinc-900"
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-zinc-600">วันที่</span>
              <input
                type="date"
                value={orderDate}
                onChange={(e) => setOrderDate(e.target.value)}
                className="min-h-11 rounded-md border border-zinc-300 px-2.5 text-sm text-zinc-900"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-zinc-600">ธนาคาร</span>
              <input
                type="text"
                value={bank}
                onChange={(e) => setBank(e.target.value)}
                className="min-h-11 rounded-md border border-zinc-300 px-2.5 text-sm text-zinc-900"
              />
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-600">แท็ก (คั่นด้วยจุลภาค)</span>
            <input
              type="text"
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              placeholder="เช่น vip, ส่งด่วน"
              className="min-h-11 rounded-md border border-zinc-300 px-2.5 text-sm text-zinc-900"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-600">เหตุผลการแก้ไข (แนะนำ)</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="เช่น พนักงานกรอกยอดขายผิด แก้ตามใบเสร็จจริง"
              className="rounded-md border border-zinc-300 px-2.5 py-2 text-sm text-zinc-900 placeholder:text-zinc-400"
            />
          </label>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2 pt-1">
            <Button variant="secondary" className="flex-1" onClick={() => setOpen(false)} disabled={pending}>
              ยกเลิก
            </Button>
            <Button variant="primary" className="flex-1" loading={pending} onClick={handleSave}>
              บันทึก
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
