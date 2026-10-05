// Landing (S00) — จอเปิดแบบทดสอบ (design §5). พอร์ตจาก Quiz.dc.html
// "00 LANDING" (บรรทัด ~18-39).
import { GemIcon } from "../_components/GemIcon";
import { PrimaryButton } from "../_components/PrimaryButton";
import { Logo } from "@/components/brand/Logo";
import { GEM_QUIZ_STONE_BY_CODE } from "@/lib/gem-quiz/config";

// code review S5: index ตรงๆ แทน .find()+`!` — "garnet" เป็น literal ที่ TS
// รู้อยู่แล้วว่าเป็น key ของ GEM_QUIZ_STONE_BY_CODE ไม่ต้องพิสูจน์ runtime
const GARNET = GEM_QUIZ_STONE_BY_CODE.garnet;
const AMETHYST = GEM_QUIZ_STONE_BY_CODE.amethyst;
const BLUE_TOPAZ = GEM_QUIZ_STONE_BY_CODE.blue_topaz;

export function Landing({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex min-h-screen flex-col items-center px-6 pb-7 pt-11 text-center sm:min-h-[700px]">
      {/* เจ้าของสั่ง 5 ต.ค. 69: ใช้โลโก้จริง (components/brand/Logo.tsx — ใช้
          ที่เดียวกับใบเสร็จ/ใบเสนอราคา OEM) แทนไอคอนวาดมือ+ตัวหนังสือของ mockup
          ต้นฉบับ (circle+star SVG) ซึ่งเป็น placeholder ตามที่ CLAUDE.md ของ
          แพ็กเกจระบุไว้แต่แรกว่าต้องเปลี่ยน */}
      <div className="motion-safe:animate-gq-fade-up flex flex-col items-center">
        <Logo className="h-12" />
      </div>

      {/* ช่องว่างชัดเจนก่อน <br/> (ไม่ใช่แค่ขึ้นบรรทัดใหม่ในซอร์ส) — ไม่งั้นชื่อ
          ที่ screen reader อ่านจะกลายเป็น "DAILYGEM QUIZ" ไม่มีช่องว่างระหว่างคำ
          (<br/> ไม่ถูกตีความเป็นช่องว่างใน accessible name computation) */}
      <h1 className="mt-7 font-quiz-display text-[44px] font-medium leading-[0.98] tracking-[0.04em] text-[var(--gq-burgundy-dark)] sm:text-[54px]">
        DAILY{" "}
        <br />
        GEM QUIZ
      </h1>
      <p className="mt-4 font-quiz-serif text-xl font-medium text-[var(--gq-text)]">วันนี้คุณควรใส่พลอยอะไร?</p>
      <p className="mt-2 max-w-[290px] text-sm leading-[1.6] text-[var(--gq-text-muted)]">
        ค้นหาพลอยที่เหมาะกับคุณสำหรับวันนี้ จากวันเกิด เป้าหมาย ความรู้สึก และสไตล์ที่คุณชอบ
      </p>

      <div className="relative min-h-0 w-full flex-1">
        <div
          aria-hidden="true"
          className="absolute bottom-[26px] left-1/2 h-[46px] w-[250px] -translate-x-1/2 rounded-full"
          style={{ background: "var(--gq-border-soft)" }}
        />
        {/* บั๊กที่เจ้าของเจอ 5 ต.ค. 69 ("พลอยอยู่ไม่ตรง") มี 2 ชั้นซ้อนกัน:
            1) ค่า offset เดิม (-170px / -86px) ไม่ตรงกับต้นฉบับ Quiz.dc.html
               บรรทัด 30-32 (margin-left: -118px / 46px / -62px) — แก้กลับให้
               ตรงต้นฉบับเป๊ะแล้ว (translateX ติดลบ = margin-left ติดลบ
               ความหมายเดียวกัน: ระยะจากขอบซ้ายกล่องถึงกึ่งกลางจอ)
            2) garnet ยังเหลื่อมอยู่ดีแม้แก้ข้อ 1 แล้ว เพราะ keyframe ของ
               motion-safe:animate-gq-gem-in เซ็ต transform: scale(...) ตรงๆ
               ซึ่ง "แทนที่" ทั้ง property transform ไม่ใช่ "บวกเพิ่ม" จาก
               translateX ที่ utility class เซ็ตไว้ก่อน (ยืนยันจาก
               getBoundingClientRect จริง: garnet เรนเดอร์ที่ offset 0 ไม่ใช่
               -62px ที่สั่งไว้) ⇒ แยกชั้น: div นอกคุม position อย่างเดียว
               (ไม่มี animation) ส่วน div ในคุม scale-in animation อย่างเดียว
               (ไม่มี position) กัน transform สองตัวชนกันเอง */}
        <div className="absolute bottom-10 left-1/2 -translate-x-[118px]" aria-hidden="true">
          <GemIcon colors={AMETHYST.colors} size={70} />
        </div>
        <div className="absolute bottom-10 left-1/2 translate-x-[46px]" aria-hidden="true">
          <GemIcon colors={BLUE_TOPAZ.colors} size={66} />
        </div>
        <div className="absolute bottom-[46px] left-1/2 -translate-x-[62px]" aria-hidden="true">
          <div className="motion-safe:animate-gq-gem-in">
            <GemIcon colors={GARNET.colors} size={124} />
          </div>
        </div>
        <svg
          className="motion-safe:animate-gq-twinkle absolute left-[62px] top-[22px]"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="var(--gq-burgundy)"
          aria-hidden="true"
        >
          <path d="M12 2l2 8 8 2-8 2-2 8-2-8-8-2 8-2z" />
        </svg>
        <svg
          className="motion-safe:animate-gq-twinkle absolute right-[70px] top-[52px] [animation-delay:.6s]"
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="#C9A9AA"
          aria-hidden="true"
        >
          <path d="M12 2l2 8 8 2-8 2-2 8-2-8-8-2 8-2z" />
        </svg>
      </div>

      <p className="mb-3.5 text-[13px] text-[var(--gq-text-muted)]">5 คำถาม · ใช้เวลาไม่ถึง 1 นาที</p>
      <PrimaryButton onClick={onStart} trailingArrow>
        เริ่มทำแบบทดสอบ
      </PrimaryButton>
      <p className="mt-4 font-quiz-display text-base italic text-[var(--gq-burgundy)]">Your Gem. Your Intention. Your Day.</p>
    </div>
  );
}
