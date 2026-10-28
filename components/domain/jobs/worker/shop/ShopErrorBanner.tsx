"use client";

// ShopErrorBanner — ข้อผิดพลาดตอนกด "เปิดงาน" (UX B.8): role="alert" · 18px · พื้น red-50 · ฟอร์ม/ค่าที่กรอกไม่หายทุกกรณี
// ข้อความผ่าน shopErrorView เท่านั้น (ไม่มีรหัสดิบ/ตัวเลขเงิน) · นับถอยหลัง (rate limit) ประกาศ "ครั้งเดียว" ตอนเริ่ม — ไม่ประกาศทุกวินาที (ตัวเลขใน aria-hidden)

import { BigButton } from "@/components/domain/jobs/worker/WorkerParts";
import type { ShopErrorView } from "@/lib/jobs/shop-open";

export function ShopErrorBanner({
  view,
  waitLeft,
  busy,
  onRetry,
  onBack,
}: {
  view: ShopErrorView;
  /** วินาทีที่เหลือ (action = wait) */
  waitLeft: number;
  busy: boolean;
  onRetry: () => void;
  /** กลับไปแก้ช่อง/ขั้นที่ผิด หรือกลับไปเลือกสินค้า */
  onBack: () => void;
}) {
  return (
    <div className="space-y-2">
      <p role="alert" className="rounded-xl border-2 border-red-200 bg-red-50 p-3 text-lg font-semibold text-red-800">
        {view.message}
        {view.action === "wait" && waitLeft > 0 && (
          <span aria-hidden="true" className="mt-1 block tabular-nums">
            รอ {waitLeft} วิ…
          </span>
        )}
      </p>
      {(view.action === "back" || view.action === "pick") && (
        <BigButton type="button" tone="secondary" onClick={onBack} disabled={busy}>
          {view.action === "pick" ? "กลับไปเลือกสินค้า" : "กลับไปแก้"}
        </BigButton>
      )}
      {view.retryButton && (
        <BigButton type="button" tone="secondary" onClick={onRetry} disabled={busy}>
          ลองอีกครั้ง
        </BigButton>
      )}
    </div>
  );
}
