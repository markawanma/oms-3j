"use client";

// GemsToBuyError — สถานะ error ของหน้า (server โหลดไม่สำเร็จ) · ข้อความคงที่ ไม่สะท้อนข้อความดิบของ DB (กฎ PII/formatError) · ลองใหม่ = router.refresh()

import { useRouter } from "next/navigation";
import { ErrorState } from "@/components/ui/ErrorState";

export function GemsToBuyError() {
  const router = useRouter();
  return <ErrorState message="โหลดรายการพลอยไม่สำเร็จ ลองใหม่อีกครั้ง" onRetry={() => router.refresh()} />;
}
