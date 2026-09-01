import { Lock } from "lucide-react";
import { getSilverPriceHistory } from "@/lib/actions/silver-price-history";
import { getDevRole } from "@/lib/dev/context";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { SilverPriceHistorySection } from "@/components/domain/catalog/SilverPriceHistorySection";

export const dynamic = "force-dynamic"; // price history grows every capture — never cache

// /catalog/silver-price — ประวัติราคาเงินจาก Google Sheet ต้นทาง (supabase/
// migrations/0102_silver_price_history.sql). Owner สั่งไว้ตรงๆ: "สร้าง
// โครงสร้างมาเก็บประวัติราคาเนื้อเงิน ให้เห็นใน localhost ไว้แถวๆ สินค้าของ
// ร้าน" ⇒ อยู่ใต้ /catalog (เหมือน /catalog/sku-prefix).
//
// Owner/admin gate (security audit fix, 0901): คอลัมน์ที่หน้านี้โชว์
// (silver_value_per_baht, block_fee_1, shopee_1) คือตัวเลขต้นทุน เดิมคอมเมนต์
// ตรงนี้เขียนว่า "ไม่มี owner/admin gate" — ผิด และช่องนี้ถูกอุดแล้วทั้งที่ page
// (EmptyState ด้านล่าง เหมือน /catalog, /oem/rates) และที่ action จริง
// (lib/actions/silver-price-history.ts — ด่านตัวจริง เพราะ action id หลุดไปกับ
// client bundle เรียกตรงได้ไม่ว่า page จะ render อะไร)
export default async function SilverPriceHistoryPage() {
  if (getDevRole() === "staff") {
    return (
      <EmptyState
        icon={Lock}
        title="หน้านี้จำกัดสิทธิ์"
        description="เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่ดูประวัติราคาเนื้อเงินได้"
      />
    );
  }

  let result;
  try {
    result = await getSilverPriceHistory();
  } catch (err) {
    return <ErrorState message={err instanceof Error ? err.message : "เกิดข้อผิดพลาดที่ไม่คาดคิด"} />;
  }

  if (!result.ok) return <ErrorState message={result.error} />;

  return (
    <div className="flex flex-col gap-1">
      <div>
        <h1 className="text-lg font-bold text-zinc-900">ประวัติราคาเงิน</h1>
        <p className="text-xs text-zinc-500">
          เก็บจาก Google Sheet ที่ป้อนราคาเข้าเว็บ 3jthailand.com/silver-price ทุกครั้งที่ scheduled task รัน — ใช้คิดต้นทุน/ตัดสินใจแคมเปญ
          ราคาเงินได้ทันที (หน้าเว็บสาธารณะในอนาคตจะโชว์แค่ 14 วันล่าสุด)
        </p>
      </div>
      <SilverPriceHistorySection rows={result.data} />
    </div>
  );
}
