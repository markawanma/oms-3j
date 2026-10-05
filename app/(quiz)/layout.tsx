import type { ReactNode } from "react";
import { Cormorant_Garamond, IBM_Plex_Sans_Thai, Noto_Serif_Thai } from "next/font/google";

// app/(quiz)/layout.tsx — shell ของแบบทดสอบเลือกพลอย v2 (design doc §5).
//
// 🔴 กฎโครงสร้าง (design §1.2 — ดู lib/gem-quiz/config.ts หัวไฟล์สำหรับ
// รายละเอียดเต็ม): ไฟล์นี้และทุกไฟล์ใต้ app/(quiz)/** ห้าม import ไฟล์ที่มี
// "use server" (รวม lib/actions/**) เด็ดขาด ไม่ว่าทางตรงหรือทางอ้อม — หน้านี้
// ถูก exempt จาก auth gate ของ middleware.ts ถ้า Server Action หลุดเข้ามาใน
// module graph ของหน้านี้ มันจะรันได้โดยไม่ผ่าน middleware เลย
// code-reviewer: grep หา "use server" / "lib/actions" ใต้ app/(quiz)/ ต้องว่าง
// เสมอ — มี automated test ยืนยันแล้วที่ lib/gem-quiz/no-server-action-graph.test.ts
//
// ไม่มี header/footer คงที่เหมือน v1 — แต่ละจอ (_screens/*) ออกแบบ header ของ
// ตัวเองตาม mockup (QuizHeader สำหรับ Q1-Q5, custom header สำหรับ landing/
// result) เพราะ mockup ไม่มี header เดียวที่ใช้ร่วมกันได้ทุกจอ (บางจอมี back
// บางจอมี restart บางจอไม่มีอะไรเลย).
//
// next/font self-host ทั้ง 3 ตระกูล (ไม่มี <link> ไป fonts.googleapis.com
// ตรงๆ — ดาวน์โหลดมาเสิร์ฟเองตอน build, ไม่ส่ง IP ผู้ใช้ไปบุคคลที่สาม) เฉพาะ
// subset/weight ที่ใช้งานจริงตาม mockup (Quiz.dc.html's <link> เดิม:
// Cormorant+Garamond:wght@500;600, IBM+Plex+Sans+Thai:wght@400;500;600,
// Noto+Serif+Thai:wght@500;600) + italic ของ Cormorant Garamond (tagline
// หน้า landing "Your Gem. Your Intention. Your Day.").
const cormorantGaramond = Cormorant_Garamond({
  subsets: ["latin"], // ไม่มี subset "thai" ให้เลือก — ใช้กับตัวอักษรละติน/ตัวเลขเท่านั้น (wordmark, hero numerals, tagline)
  weight: ["500", "600"],
  style: ["normal", "italic"],
  display: "swap",
  variable: "--font-gem-quiz-display",
});
const notoSerifThai = Noto_Serif_Thai({
  subsets: ["thai", "latin"],
  weight: ["500", "600"],
  display: "swap",
  variable: "--font-gem-quiz-serif",
});
const ibmPlexSansThai = IBM_Plex_Sans_Thai({
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-gem-quiz-sans",
});

// Palette — O1 (design doc §9): แบรนด์เดิม #a2191d (= tailwind.config.ts's
// primary-600) แทน Burgundy #8F1015 ของแพ็กเกจต้นฉบับ. ประกาศเป็น CSS
// variable ที่นี่จุดเดียว (ทุก component ใต้ gem-quiz/** อ้างอิงผ่าน
// `[var(--gq-xxx)]` arbitrary value ของ Tailwind) — เปลี่ยนสีแบรนด์ทั้ง
// ฟีเจอร์นี้ = แก้บรรทัดเดียวที่นี่ ไม่ต้องไล่แก้ทุกไฟล์.
//
// burgundy / burgundy-dark / burgundy-soft / burgundy-border ดึงมาจาก scale
// ที่ derive ไว้แล้วใน tailwind.config.ts (primary-600/700/50/200) ตรงตามที่
// design doc สั่ง ("map #a2191d เป็นเฉด 600 ของ palette, derive เฉดเข้ม/อ่อน
// เอง") — ไม่ใช่เลขที่คิดขึ้นใหม่ลอยๆ ที่นี่. ส่วนที่เหลือ (ivory/text/border
// เฉยๆ) เป็นโทนกลางไม่ใช่สีแบรนด์ คงตามค่าของ mockup ตรงๆ.
const GEM_QUIZ_PALETTE_STYLE = {
  "--gq-burgundy": "#a2191d", // primary-600 — CTA/progress/selected border (mockup เดิม #8F1015)
  "--gq-burgundy-dark": "#801418", // primary-700 — headings/hover (mockup เดิม #650A0D)
  "--gq-burgundy-soft": "#faf5f5", // primary-50 — การ์ด/แถบพื้นหลังอ่อน (mockup เดิม #FBF2F2)
  "--gq-burgundy-border": "#ebcbcc", // primary-200 — เส้นขอบอ่อนรอบพื้นบัง burgundy-soft (mockup เดิม #E3CFCF)
  "--gq-ivory": "#FAF8F4",
  "--gq-text": "#292929",
  "--gq-text-muted": "#6F6A66",
  "--gq-text-faint": "#736C67",
  "--gq-border": "#E5E1DC",
  "--gq-border-soft": "#EEE7E1",
  "--gq-divider": "#F1EDE8",
} as React.CSSProperties;

export default function QuizLayout({ children }: { children: ReactNode }) {
  return (
    <div
      className={`${cormorantGaramond.variable} ${notoSerifThai.variable} ${ibmPlexSansThai.variable} font-quiz-sans min-h-screen bg-[var(--gq-ivory)] text-[var(--gq-text)]`}
      style={GEM_QUIZ_PALETTE_STYLE}
    >
      {/* Mobile (ต่ำกว่า sm): เต็มจอ 375-430px ตามที่ใช้งานจริงบนมือถือ, ไม่มี
          การ์ด/เงา/ขอบ. Desktop (sm ขึ้นไป): การ์ด 500-600px กลางจอ ลอยอยู่บน
          พื้น ivory รอบๆ (design §5). ไม่ล็อกความสูงคงที่ — ปล่อยให้แต่ละจอ
          (โดยเฉพาะ ResultScreen ที่เนื้อหายาว) ไหลตามเนื้อหาธรรมชาติ. */}
      <div className="mx-auto w-full max-w-[560px] sm:py-10">
        <main className="relative flex min-h-screen w-full flex-col bg-white sm:min-h-0 sm:overflow-hidden sm:rounded-[28px] sm:border sm:border-[var(--gq-border)] sm:shadow-xl sm:shadow-black/5">
          {children}
        </main>
      </div>
    </div>
  );
}
