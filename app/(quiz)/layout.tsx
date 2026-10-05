import type { ReactNode } from "react";

// app/(quiz)/layout.tsx — route group ใหม่สำหรับหน้าสาธารณะแบบทดสอบเลือกพลอย
// (design doc §4.1, docs/3j-jewelry/analytics/design-gem-quiz.md). แยกจาก
// (public) โดยตั้งใจ — (public)/layout.tsx มี tagline เชิงสุขภาพ ("ไม่แพ้ผิว")
// และ footer เรื่องยืนยันราคาก่อนสั่งซื้อ ซึ่งไม่เกี่ยวกับหน้านี้เลย และเป็นเคลม
// ที่ไม่ควรอยู่ใกล้หน้าที่ต้องระวังเรื่องเคลมอยู่แล้ว (F10).
//
// 🔴 กฎโครงสร้าง (design §1.2 — ดู lib/gem-quiz/config.ts หัวไฟล์สำหรับ
// รายละเอียดเต็ม): ไฟล์นี้และทุกไฟล์ใต้ app/(quiz)/** ห้าม import ไฟล์ที่มี
// "use server" (รวม lib/actions/**) เด็ดขาด ไม่ว่าทางตรงหรือทางอ้อม — หน้านี้
// ถูก exempt จาก auth gate ของ middleware.ts ถ้า Server Action หลุดเข้ามาใน
// module graph ของหน้านี้ มันจะรันได้โดยไม่ผ่าน middleware เลย
// code-reviewer: grep หา "use server" / "lib/actions" ใต้ app/(quiz)/ ต้องว่าง
// เสมอ — มี automated test ยืนยันแล้วที่ lib/gem-quiz/no-server-action-graph.test.ts
export default function QuizLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-white">
      <header className="border-b-[3px] border-[#A2191D] px-4 pb-4 pt-7 text-center">
        <div
          aria-hidden="true"
          className="mx-auto mb-2 h-11 w-11 -rotate-45 rounded-full border-4 border-[#A2191D] border-t-transparent"
        />
        <h1 className="text-xl font-bold tracking-wide text-zinc-900">3J JEWELRY</h1>
        <p className="mt-1.5 text-sm text-zinc-500">แบบทดสอบเลือกพลอย</p>
      </header>
      <main>{children}</main>
      {/* footer เรื่องราคา/tagline สุขภาพของ (public)/layout.tsx ไม่เหมาะกับหน้านี้
          (design §4.1) — เหลือแค่บรรทัดที่เป็นจริงตามตาราง gem_quiz_response
          (§3.2 — ไม่มีคอลัมน์ IP/UA/token/ข้อความอิสระเลย). */}
      <footer className="mt-8 border-t border-zinc-200 px-4 pb-6 pt-4 text-center text-xs text-zinc-500">
        <p>แบบทดสอบนี้ไม่เก็บข้อมูลส่วนตัว</p>
      </footer>
    </div>
  );
}
