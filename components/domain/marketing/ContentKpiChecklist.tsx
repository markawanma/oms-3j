// ContentKpiChecklist — /marketing/content/history/[postId]'s "เช็คเพิ่มเติม
// ด้วยตา" section (screen design §5). This block is DELIBERATELY static —
// it translates content-kpi-definition.md §5's rows 3/4/5/6 into manual
// prompts, not an auto-generated verdict, because §0 of the screen design
// found there's no schema link between content_post and live_session_log
// (rows 3/4/5) and no "หมวดสินค้า" dimension separate from content_type
// (row 6) to compute any of these automatically. Backlog, not a bug — see
// §11 decision #3 (parked) in the screen design doc.
//
// <details> closed-by-default pattern copied from
// components/domain/marketing/ContentTypeChip.tsx's ContentTypeLegend.

export function ContentKpiChecklist() {
  return (
    <details className="rounded-lg border border-zinc-200 bg-white shadow-sm">
      <summary className="min-h-11 cursor-pointer select-none px-3.5 py-2.5 text-sm font-semibold text-zinc-700">
        เช็คเพิ่มเติมด้วยตา (ยังไม่มีในระบบอัตโนมัติ)
      </summary>
      <div className="space-y-3 border-t border-zinc-100 px-3.5 py-3 text-xs leading-relaxed text-zinc-600">
        <p>ถ้าคลิปนี้โพสต์ก่อนไลฟ์คืนไหน ลองเทียบกับสมุดจดไลฟ์คืนนั้นเองว่า:</p>
        <ul className="space-y-2.5">
          <li>
            <span className="font-semibold text-zinc-700">คนเข้าห้องคืนนั้นขึ้นจากปกติไหม</span> — ถ้าคลิปวิวดีแต่คนเข้าห้องไม่ขึ้น
            → คลิปไม่ได้พาคนมาไลฟ์ ลองย้ายเวลาปล่อยมาช่วง 18:00–20:00 แทน
          </li>
          <li>
            <span className="font-semibold text-zinc-700">ถ้าคนเข้าห้องขึ้น แต่ยอดคืนนั้นไม่ขึ้น</span> → ปัญหาน่าจะอยู่ในห้อง
            (ของที่โชว์/วิธีปิด) ไม่ใช่ที่คลิป — อย่าตัดสินคลิปจากเคสนี้
          </li>
          <li>
            <span className="font-semibold text-zinc-700">ถ้าคนเข้าห้องปกติแต่ยอดคืนนั้นพุ่งเอง</span> → ไม่ใช่ผลจากคลิป ไปดูว่าคืนนั้นยกอะไรมาโชว์แทน
          </li>
          <li>
            <span className="font-semibold text-zinc-700">ถ้าคลิปนี้พูดเรื่องเงินแท่ง</span> อย่าตัดสินด้วยยอดขาย
            (ยอดเงินแท่งตกทั้งปีอยู่แล้ว) ดูเพื่อน LINE เพิ่ม/คนถามราคาแทน
          </li>
        </ul>
      </div>
    </details>
  );
}
