"use client";

import { useEffect, useState } from "react";
import { getLastMeasuredSize } from "@/lib/ring-builder/last-size";
import { TOOLS_HUB_COPY } from "@/lib/tools-hub/config";

// LastSizeChip — "ผลวัดล่าสุด: เบอร์ N" บนการ์ดวัดไซซ์ · อ่าน localStorage หลัง mount เท่านั้น (hydration)
// ใช้ getLastMeasuredSize() เดิม (ไม่เขียนสูตรเบอร์ซ้ำ · ทน storage ถูกบล็อก) · ไม่มีผล/ถูกบล็อก/ค่าเสีย/นอกช่วงร้าน = ไม่แสดงอะไร
// (ไม่มี error · ไม่มี "ยังไม่มีผล") · แสดงเลขเบอร์อย่างเดียว ไม่แสดง circ/savedAt
// localStorage ผูก origin: ผลวัดที่เคยบันทึกบน app. จะไม่เห็นบน tools. (ลูกค้าวัดใหม่ 1 ครั้ง · ไม่เสียหาย)
export function LastSizeChip() {
  const [size, setSize] = useState<number | null>(null);
  useEffect(() => {
    try {
      const last = getLastMeasuredSize();
      setSize(last && last.inShopRange ? last.size : null);
    } catch {
      setSize(null);
    }
  }, []);
  if (size === null) return null;
  return <p className="mt-2 text-[13px] font-medium text-[var(--gq-burgundy-dark)]">{TOOLS_HUB_COPY.lastMeasured(size)}</p>;
}
