import { StatsCard } from "./StatsCard";

// ux-ring-size-stats.md §10 "อ่านก่อนตีความ" — ไม่พับ (สั้น) · ถ้อยคำเป็นร่างให้เจ้าของตรวจตอน UAT
// 🔴 ห้ามคำ PDPA / "ปลอดภัยตามกฎหมาย" · ห้ามศัพท์ session/RPC/stage · ห้ามรหัส G1–G5 (มี test สแกนไฟล์ในโฟลเดอร์นี้)
export function ReadingNotes() {
  return (
    <StatsCard id="rs-notes" title="อ่านก่อนตีความ">
      <ul className="list-disc space-y-1.5 pl-4 text-sm text-zinc-700">
        <li>
          <span className="font-semibold">ไม่ระบุตัวตน</span>: ไม่มีชื่อ เบอร์โทร หรือข้อมูลเครื่อง · เห็นเฉพาะตัวเลขรวม ไม่มีรายชื่อรายคน
          ไม่มีเวลาละเอียดระดับนาที · ไม่มีปุ่มส่งออกข้อมูลดิบ
        </li>
        <li>
          <span className="font-semibold">นับเป็นครั้ง ไม่ใช่คน</span>: คนเดียวกันที่ปิดแท็บแล้วเปิดใหม่ นับเป็นครั้งใหม่
        </li>
        <li>
          <span className="font-semibold">อาจต่ำกว่าความจริง</span>: คนที่ตั้งเบราว์เซอร์ไม่ให้ติดตาม (Do Not Track) ไม่ถูกนับ
          และบางเครื่องส่งสัญญาณไม่ทันตอนปิดหน้า
        </li>
        <li>
          <span className="font-semibold">"กดปุ่ม LINE" คือจำนวนที่กดปุ่ม</span> ไม่ใช่จำนวนคนที่ทักมาจริง
          และเป็นตัวเลขขั้นต่ำ (นับเฉพาะปุ่มหน้าผลลัพธ์)
        </li>
        <li>
          <span className="font-semibold">วิธีวัดกับความแม่น</span>: ตัวเลขในหมวด "วัดด้วยอะไร" บอกความยาก/ความไม่มั่นใจ ไม่ใช่ความแม่นจริง
        </li>
        <li>
          <span className="font-semibold">ย้อนหลังได้ 180 วัน</span>: ระบบลบข้อมูลที่เก่ากว่านั้นอัตโนมัติ
        </li>
      </ul>
    </StatsCard>
  );
}
