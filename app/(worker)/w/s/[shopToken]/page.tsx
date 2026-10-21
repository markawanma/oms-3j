import { loadIntakeHub } from "@/lib/jobs/worker-server";
import { ShopIntakeApp } from "@/components/domain/jobs/worker/shop/ShopIntakeApp";
import type { ShopInitial } from "@/components/domain/jobs/worker/shop/ShopHub";

// /w/s/<shopToken> — หน้าผู้จัดการเปิดใบจากมือถือ (สาธารณะ · พิสูจน์ตัวด้วย QR ร้าน + PIN ที่ DB · ไม่ผ่าน middleware auth)
// server component อ่านผ่าน loadIntakeHub (hash token ก่อนถึง DB · allowlist) แล้วส่งให้ client เฉพาะสถานะที่ปลอดภัย
// QR ถูกเพิกถอน/ไม่พบ = ข้อความเดียวกัน (ไม่บอกว่า token เคยมีจริงไหม) · โหลดล้มอื่นๆ = "เชื่อมต่อไม่ได้" + ลองอีกครั้ง
// force-dynamic: ทุกครั้งต้องเห็นสถานะสด + ไม่แคช (token ใน URL)
export const dynamic = "force-dynamic";

const MSG_OFFLINE = "เชื่อมต่อไม่ได้ — เช็คสัญญาณแล้วลองอีกครั้ง";

export default async function ShopIntakePage({ params }: { params: Promise<{ shopToken: string }> }) {
  const { shopToken } = await params;
  let initial: ShopInitial;
  try {
    const res = await loadIntakeHub(shopToken);
    if (res.ok) initial = { kind: "hub", hub: res.data };
    else if (res.code === "invalid_token") initial = { kind: "closed" };
    else initial = { kind: "error", message: res.code === "rate_limited" ? res.error : MSG_OFFLINE };
  } catch {
    initial = { kind: "error", message: MSG_OFFLINE };
  }
  return <ShopIntakeApp token={shopToken} initial={initial} />;
}
