"use client";

import { useEffect, useState } from "react";
import type { LabelReviewRow } from "@/lib/labels/types";
import type { CrmProvinceOption } from "@/lib/crm/order-override";
import { LabelReviewQueueRow } from "./LabelReviewQueueRow";

/**
 * ReviewQueueList — แถวรอตรวจของ "รอบอัปโหลดนี้" (LabelParseSummary.reviewRows,
 * แสดงใต้สรุปผลอ่านไฟล์ใน UploadPageClient ทันทีหลัง parse เสร็จ). ต่างจาก
 * PendingReviewQueue (คิวทั้งร้านอ่านจาก DB ตรง) ตรงที่ชุดนี้เป็น state ของรอบ
 * อัปโหลดรอบเดียว — ไม่มี fileId/fileName/orderSources ติดมาด้วย (ดู
 * LabelReviewRow ใน lib/labels/types.ts) เพราะเรียกไม่มี fileId/fileName/
 * orderSources ก็เดาที่มาออเดอร์เองไม่ได้ — LabelReviewQueueRow เลย fetch
 * orderSources เองต่อแถว (prop orderSources ไม่ส่งมา = undefined).
 *
 * Phase A (owner 11 ก.ย. 69): เดิมเป็นตาราง "อ่านอย่างเดียว" — ตอนนี้กดได้
 * เหมือน PendingReviewQueue ทุกอย่าง (คนละที่มาข้อมูล คนละ action call แต่ผล
 * ลัพธ์บนจอต้องเหมือนกัน — ใช้ LabelReviewQueueRow ตัวเดียวกัน). แถวที่ resolve/
 * ignore แล้วหายจาก list นี้ทันที (local state, ไม่ใช่ prop เดิมที่ parent ไม่รู้
 * ว่าเปลี่ยน) — ไฟล์นี้ไม่ได้ sync กลับไป UploadPageClient เพราะ
 * `summary.reviewRows` ของรอบอัปโหลดนั้นไม่มีผลต่อ flow อื่นอีกแล้วหลัง resolve
 * (PendingReviewQueue คือ source of truth ถาวร ไม่ใช่ตัวนี้).
 */
export function ReviewQueueList({
  rows,
  provinces,
  canEdit,
}: {
  rows: LabelReviewRow[];
  provinces: CrmProvinceOption[];
  canEdit: boolean;
}) {
  const [localRows, setLocalRows] = useState(rows);

  // sync เมื่อ parent ส่ง rows ชุดใหม่มาจริง (เช่น item อื่นเพิ่งอัปโหลดเสร็จ) —
  // identity ของ rows คงที่ตลอดอายุ item เดียวกัน เทียบด้วย reference พอ
  useEffect(() => {
    setLocalRows(rows);
  }, [rows]);

  if (localRows.length === 0) return null;

  return (
    <div className="flex flex-col gap-2" role="list">
      {localRows.map((row) => (
        <LabelReviewQueueRow
          key={row.pageId}
          row={row}
          provinces={provinces}
          canEdit={canEdit}
          onResolved={(pageId) => setLocalRows((prev) => prev.filter((r) => r.pageId !== pageId))}
        />
      ))}
    </div>
  );
}
