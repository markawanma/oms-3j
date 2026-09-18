"use client";

// ProductionOrderNewClient — /production/new. Creates the header row
// immediately (analytics.production_order_save with p_id=null) and redirects
// to /production/[id] to add line items — unlike OEM's quote calculator,
// 0131's item_set RPC needs a real production_order_id to attach to, so
// there is no client-side "draft, then batch-save everything at once" mode
// possible here (see 0131 §9). Note/spot-override are both optional and
// editable again later on the detail page while the order stays open.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveProductionOrder } from "@/lib/actions/production";
import { PRODUCTION_SPOT_OVERRIDE_MAX, PRODUCTION_SPOT_OVERRIDE_MIN } from "@/lib/production/types";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

const inputCls = "mt-1 min-h-11 w-full rounded-md border border-zinc-300 px-2.5 text-base text-zinc-900";
const labelCls = "block text-sm font-medium text-zinc-700";

export function ProductionOrderNewClient() {
  const router = useRouter();
  const toast = useToast();
  const [note, setNote] = useState("");
  const [spotOverride, setSpotOverride] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);

    let spotOverrideThbPerGram: number | null = null;
    if (spotOverride.trim() !== "") {
      const n = Number(spotOverride);
      if (!Number.isFinite(n) || n < PRODUCTION_SPOT_OVERRIDE_MIN || n > PRODUCTION_SPOT_OVERRIDE_MAX) {
        setError(
          `ราคาเงินเฉพาะใบนี้ต้องอยู่ระหว่าง ${PRODUCTION_SPOT_OVERRIDE_MIN}-${PRODUCTION_SPOT_OVERRIDE_MAX} บาท/กรัม (ต่อกรัม ไม่ใช่ต่อบาท)`
        );
        return;
      }
      spotOverrideThbPerGram = n;
    }

    startTransition(async () => {
      const result = await saveProductionOrder({ note: note.trim() || null, spotOverrideThbPerGram });
      if (!result.ok) {
        setError(result.error);
        toast.push(result.error, "error");
        return;
      }
      toast.push(`สร้างใบผลิต ${result.data.poNo} แล้ว — เพิ่มรายการ SKU ต่อได้เลย`);
      router.push(`/production/${result.data.id}`);
    });
  }

  return (
    <div className="max-w-lg space-y-4">
      <div>
        <h1 className="text-lg font-bold text-zinc-900">สร้างใบผลิตใหม่</h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          สร้างหัวใบก่อน แล้วค่อยเพิ่มรายการ SKU ที่จะผลิตในหน้าถัดไป
        </p>
      </div>

      <div>
        <label className={labelCls} htmlFor="po-note">
          หมายเหตุ (ไม่บังคับ)
        </label>
        <textarea
          id="po-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          className="mt-1 w-full rounded-md border border-zinc-300 p-2.5 text-base text-zinc-900"
          placeholder="เช่น ล็อตผลิตประจำเดือน ต.ค."
        />
      </div>

      <div>
        <label className={labelCls} htmlFor="po-spot-override">
          ราคาเงินเฉพาะใบนี้ บาท/กรัม (ไม่บังคับ)
        </label>
        <input
          id="po-spot-override"
          type="number"
          inputMode="decimal"
          min={PRODUCTION_SPOT_OVERRIDE_MIN}
          max={PRODUCTION_SPOT_OVERRIDE_MAX}
          step="0.01"
          value={spotOverride}
          onChange={(e) => setSpotOverride(e.target.value)}
          className={inputCls}
          placeholder={`ไม่กรอก = ใช้ราคาเงินของวันนี้อัตโนมัติ (${PRODUCTION_SPOT_OVERRIDE_MIN}-${PRODUCTION_SPOT_OVERRIDE_MAX})`}
        />
        <p className="mt-1 text-xs text-zinc-400">
          ใช้เฉพาะใบนี้เท่านั้น — ไม่กระทบราคาที่ใช้คิดใบเสนอราคา OEM
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-2.5 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="button" variant="primary" loading={pending} onClick={submit}>
          สร้างใบผลิต
        </Button>
      </div>
    </div>
  );
}
