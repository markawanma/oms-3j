import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getOrderDetail } from "@/lib/actions/orders";
import { OrderDetailClient } from "@/components/domain/OrderDetailClient";
import { ErrorState } from "@/components/ui/ErrorState";

export const dynamic = "force-dynamic";

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let result;
  try {
    result = await getOrderDetail(id);
  } catch (err) {
    return <ErrorState message={err instanceof Error ? err.message : "เกิดข้อผิดพลาดที่ไม่คาดคิด"} />;
  }

  return (
    <div>
      <Link href="/" className="mb-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-zinc-600 hover:text-zinc-900">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        กลับไปหน้ารายการออเดอร์
      </Link>
      {result.ok ? <OrderDetailClient initialOrder={result.data} /> : <ErrorState message={result.error} />}
    </div>
  );
}
