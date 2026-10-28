import type { CSSProperties, ReactNode } from "react";

// app/(quiz)/ring-size/layout.tsx — shell ของเครื่องมือวัดไซส์แหวน (หน้าสาธารณะ ไม่ login · ไม่มี DB)
//
// ซ้อนอยู่ใน (quiz)/layout.tsx (ห้ามแก้ — gem quiz ใช้งานจริง): ได้ฟอนต์ next/font self-host ของ layout แม่มาฟรี
// (class font-quiz-sans / font-quiz-serif · ตัวแปร --font-gem-quiz-*) — ที่นี่ "ห้ามมี <link> ฟอนต์" ใดๆ
//
// 🔴 กฎโครงสร้างเดียวกับ gem quiz (design §1.2): ไฟล์ใต้ app/(quiz)/ring-size/** และ lib/ring-size/** ห้าม import
// ไฟล์ "use server" / lib/actions ไม่ว่าทางตรงหรือทางอ้อม (หน้านี้ถูก exempt จาก auth gate ได้ — ถ้ามี Server Action หลุดเข้ามา
// มันจะรันได้โดยไม่ผ่าน middleware) · test: lib/gem-quiz/no-server-action-graph.test.ts เดินทั้ง app/(quiz)/** ให้แล้ว
//
// เปลือกจอ: layout แม่ห่าง <main min-h-screen bg-white> (100vh + พื้นขาว + sm:การ์ดกลางจอ) ซึ่งเราแก้ไม่ได้ →
// wrapper นี้ position:fixed inset-0 ความสูง 100dvh + overflow-y-auto + overscroll-contain + พื้น --rs-bg
//   - ความสูงนิ่ง ไม่เปลี่ยนตามแถบ Safari หด/ขยาย (ดีต่อ G2/clamp ความสูงเวที)
//   - ไม่มีช่องขาวใต้จอ · scroll เกิดที่เดียว (RingSizeClient ล็อก overflow ของ html ระหว่างหน้านี้เปิดอยู่)
//   - ไม่ใช้ 100vh · ปุ่ม sticky ใช้ safe-area-inset-bottom ที่ StickyActionBar
// ห้ามตั้ง viewport-fit=cover / maximum-scale / user-scalable (ห้ามปิด pinch-zoom — ซูมตรวจด้วย G1)
//
// Token --rs-* ประกาศจุดเดียวที่นี่ (แยกจาก --gq-* ของ gem quiz) · ค่าตาม build spec ข้อ 7.3 (contrast คำนวณแล้ว)
const RS_TOKENS = {
  "--rs-brand": "var(--gq-burgundy)", // = #a2191d (primary-600) — ที่มาเดียวกับ gem quiz
  "--rs-brand-hover": "#7d1316",
  "--rs-bg": "#FBF7F2",
  "--rs-surface": "#FFFFFF",
  "--rs-text": "#2B1E1E",
  "--rs-text-2": "#6A5B58",
  "--rs-text-3": "#5C4D49",
  "--rs-border": "#EADFD6",
  "--rs-border-btn": "#E0D3C8",
  "--rs-border-btn-2": "#D9C9BD",
  "--rs-gold": "#C8A777",
  "--rs-blush": "#F6E7E3",
  "--rs-blush-text": "#5A2A26",
  "--rs-success": "#EAF3EC",
  "--rs-success-text": "#1F5132",
  "--rs-warn": "#FFF4E5",
  "--rs-warn-border": "#EBCB97",
  "--rs-warn-text": "#4A3200",
  "--rs-warn-icon": "#8A5300",
  "--rs-chip-bg": "#F4EEE8",
  "--rs-disabled-bg": "#E5D9D3",
  "--rs-disabled-text": "#675A56",
  "--rs-radius-btn": "16px",
  "--rs-radius-card": "22px",
  "--rs-radius-pill": "99px",
  colorScheme: "light", // กันโหมดมืดบังคับทำเวทีมืด
} as CSSProperties;

export default function RingSizeLayout({ children }: { children: ReactNode }) {
  return (
    <div
      className="font-quiz-sans fixed inset-0 z-10 h-[100dvh] overflow-y-auto overscroll-contain bg-[var(--rs-bg)] text-[var(--rs-text)]"
      style={RS_TOKENS}
    >
      {children}
    </div>
  );
}
