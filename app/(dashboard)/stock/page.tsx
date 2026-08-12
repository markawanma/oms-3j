import { listStock } from "@/lib/actions/stock";
import { StockPageClient } from "@/components/domain/StockPageClient";
import { ErrorState } from "@/components/ui/ErrorState";

export const dynamic = "force-dynamic";

export default async function StockPage() {
  let result;
  try {
    result = await listStock("");
  } catch (err) {
    return <ErrorState message={err instanceof Error ? err.message : "เกิดข้อผิดพลาดที่ไม่คาดคิด"} />;
  }

  return (
    <div>
      <h1 className="mb-3 text-xl font-bold text-zinc-900">สต็อกกลาง</h1>
      {result.ok ? <StockPageClient initialStock={result.data} /> : <ErrorState message={result.error} />}
    </div>
  );
}
