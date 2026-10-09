"use client";

// PageError — ErrorState ทั้งหน้า + ปุ่ม "ลองใหม่" (router.refresh) สำหรับ server component ที่ส่งฟังก์ชันให้ ErrorState โดยตรงไม่ได้

import { useRouter } from "next/navigation";
import { ErrorBanner, ErrorState } from "@/components/ui/ErrorState";

export function PageError({ message }: { message: string }) {
  const router = useRouter();
  return <ErrorState message={message} onRetry={() => router.refresh()} />;
}

/** แถบ error ของ "กองเดียว" — กองอื่นของหน้ายังแสดงตามปกติ */
export function SectionError({ message }: { message: string }) {
  const router = useRouter();
  return <ErrorBanner message={message} onRetry={() => router.refresh()} />;
}
