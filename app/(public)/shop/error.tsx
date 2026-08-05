"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/ui/ErrorState";

export default function ShopError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // eslint-disable-next-line no-console -- surface unexpected catalog load failures for debugging
    console.error("[/shop] catalog load failed:", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-[1100px] px-4 pb-10 pt-5">
      <ErrorState message="โหลดแคตตาล็อกสินค้าไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" onRetry={reset} />
    </div>
  );
}
