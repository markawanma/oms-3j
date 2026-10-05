// ResultScreen (S07) — หน้าผลลัพธ์ (design §5): Hero/Why/Pairing/Alternatives/
// How-to-wear/Products/CTA/Disclaimer. ข้อมูลทั้งหมดมาจาก buildResultView()
// (lib/gem-quiz/result.ts) — หน้านี้แค่แสดงผล ไม่คำนวณเลขเงิน/คะแนนเอง.
//
// 🔴 Products มีแค่ชื่อ (ไม่มีราคา — ยังไม่ผ่าน 3 ด่าน content) และไม่มีลิงก์
// "ดูรายละเอียด" ไปไหน (mockup ต้นฉบับใช้ href="#" ซึ่งเป็น placeholder ไม่ใช่
// ปลายทางจริง — ตัดออกแทนที่จะส่งลิงก์ที่ไปไหนไม่ได้จริงให้ผู้ใช้กด).
// CTA ปลายทาง (O4 ของ design doc §9) ยังไม่เคาะ — ใช้ LINE OA เป็นปลายทาง
// ชั่วคราวตาม precedent เดิมของไซต์ (เหมือน v1) จนกว่า Tech Lead/เจ้าของจะ
// เคาะปลายทางจริง (ไม่บล็อกการ implement ตาม design doc §9).
import { GemIcon } from "../_components/GemIcon";
import { PrimaryButton } from "../_components/PrimaryButton";
import { GEM_QUIZ_STONE_BY_CODE, type GemQuizStoneCode } from "@/lib/gem-quiz/config";
import type { GemQuizResultView } from "@/lib/gem-quiz/result";

const LINE_OA_URL = "https://line.me/R/ti/p/@3jsilver";

// code review S5: code เป็น GemQuizStoneCode (literal union) อยู่แล้ว — TS
// การันตีว่ามีจริงใน GEM_QUIZ_STONE_BY_CODE ไม่ต้อง throw/`!` เหมือนของเดิม
function getStone(code: GemQuizStoneCode) {
  return GEM_QUIZ_STONE_BY_CODE[code];
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3.5 border-b border-[var(--gq-divider)] py-3 last:border-b-0">
      <span className="text-[var(--gq-burgundy)]">{icon}</span>
      <span className="flex flex-col gap-px">
        <span className="text-xs text-[var(--gq-text-muted)]">{label}</span>
        <span className="text-[15px]">{value}</span>
      </span>
    </div>
  );
}

export function ResultScreen({
  view,
  onFocusAlternative,
  onBackToTop,
  onRestart,
}: {
  view: GemQuizResultView;
  onFocusAlternative: (code: string) => void;
  onBackToTop: () => void;
  onRestart: () => void;
}) {
  const heroStone = getStone(view.hero.stoneCode);
  const pairA = getStone(view.pairing.heroStoneCode);
  const pairB = getStone(view.pairing.pairStoneCode);

  return (
    <div className="min-h-screen sm:min-h-0">
      {/* Hero */}
      <div className="motion-safe:animate-gq-fade-up flex flex-col items-center px-6 pb-[30px] pt-7 text-center" style={{ background: "var(--gq-ivory)" }}>
        <div className="flex w-full items-center justify-between">
          <button
            type="button"
            aria-label="เริ่มใหม่"
            onClick={onRestart}
            className="-ml-2.5 flex h-11 w-11 items-center justify-center rounded-full text-[var(--gq-text)] transition-colors hover:bg-white"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 12a8 8 0 1 0 2.4-5.7" />
              <path d="M4 4.5v4h4" />
            </svg>
          </button>
          <span className="pl-[0.4em] font-quiz-display text-[13px] font-semibold tracking-[0.4em] text-[var(--gq-burgundy-dark)]">3J · JEWELRY</span>
          <span className="w-11" aria-hidden="true" />
        </div>

        <p className="mt-3.5 font-quiz-display text-[32px] font-medium leading-[1.02] tracking-[0.06em] text-[var(--gq-burgundy-dark)]">
          {view.hero.heroA}
          <br />
          {view.hero.heroB}
        </p>
        <p className="mt-1.5 text-sm text-[var(--gq-text-muted)]">{view.hero.heroSub}</p>

        <div className="relative my-3.5 flex h-[230px] w-[230px] items-center justify-center">
          <div aria-hidden="true" className="absolute inset-[22px] rounded-full opacity-[0.18]" style={{ background: heroStone.colors.light }} />
          <div aria-hidden="true" className="absolute inset-0 rounded-full border border-[var(--gq-border)]" />
          <div className="motion-safe:animate-gq-gem-in relative">
            <GemIcon colors={heroStone.colors} size={150} />
          </div>
          <svg className="motion-safe:animate-gq-twinkle absolute left-[22px] top-10" width="14" height="14" viewBox="0 0 24 24" fill="var(--gq-burgundy)" aria-hidden="true">
            <path d="M12 2l2 8 8 2-8 2-2 8-2-8-8-2 8-2z" />
          </svg>
          <svg className="motion-safe:animate-gq-twinkle absolute bottom-[46px] right-6 [animation-delay:.7s]" width="10" height="10" viewBox="0 0 24 24" fill="#C9A9AA" aria-hidden="true">
            <path d="M12 2l2 8 8 2-8 2-2 8-2-8-8-2 8-2z" />
          </svg>
        </div>

        <h1 className="font-quiz-display text-[46px] font-semibold leading-none tracking-[0.08em] text-[var(--gq-burgundy-dark)]">
          {heroStone.nameEn.toUpperCase()}
        </h1>
        <p className="mt-1.5 font-quiz-serif text-lg text-[var(--gq-text)]">{heroStone.labelTh}</p>
        <span className="mt-3.5 rounded-full border border-[var(--gq-burgundy-border)] bg-white px-4 py-1.5 text-xs font-semibold tracking-[0.24em] text-[var(--gq-burgundy)]">
          {heroStone.core}
        </span>
        <p className="mt-3 text-[15px] font-medium text-[var(--gq-burgundy)]">{heroStone.keywords}</p>

        <div className="mt-5 flex flex-col gap-2.5 rounded-2xl border border-[var(--gq-border-soft)] bg-white px-[1.125rem] py-[1.125rem] text-left text-sm leading-[1.7]">
          <p className="m-0">
            วันนี้คุณเลือกโฟกัสเรื่อง <strong className="font-semibold text-[var(--gq-burgundy-dark)]">{view.hero.intentionLabel}</strong> และบอกเราว่า{" "}
            <strong className="font-semibold text-[var(--gq-burgundy-dark)]">&ldquo;{view.hero.feelingLabel}&rdquo;</strong>
          </p>
          <p className="m-0">{view.hero.line2}</p>
          <p className="m-0 text-[13px] text-[var(--gq-text-muted)]">{view.hero.prefNote}</p>
        </div>

        {view.hero.isAlternative && (
          <button
            type="button"
            onClick={onBackToTop}
            className="mt-3.5 min-h-11 rounded-full border border-[var(--gq-burgundy-border)] bg-white px-4 text-sm text-[var(--gq-burgundy)]"
          >
            ← กลับไปที่พลอยแนะนำอันดับ 1
          </button>
        )}
        <p className="mt-[1.125rem] text-[13px] text-[var(--gq-text-muted)]">เลื่อนลงเพื่อดูคำแนะนำของคุณ ↓</p>
      </div>

      {/* Why */}
      <div className="flex flex-col gap-4 px-5 pt-8 pb-2">
        <h2 className="text-center font-quiz-serif text-[21px] font-semibold text-[var(--gq-burgundy-dark)]">ทำไมถึงเหมาะกับคุณวันนี้?</h2>
        <div className="rounded-2xl border border-[var(--gq-border-soft)] px-4">
          <InfoRow
            icon={
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3.5" y="5" width="17" height="15" rx="2" />
                <path d="M3.5 9.5h17M8 3v4M16 3v4" />
              </svg>
            }
            label="วันเกิดของคุณ"
            value={`วัน${view.hero.birthDayLabel}`}
          />
          <InfoRow
            icon={
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="8.5" />
                <circle cx="12" cy="12" r="4.5" />
                <circle cx="12" cy="12" r="1" />
              </svg>
            }
            label="เป้าหมายวันนี้"
            value={view.hero.intentionLabel}
          />
          <InfoRow
            icon={
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 19c0-8 6-14 15-14 0 9-6 15-14 15" />
                <path d="M5 19l8-8" />
              </svg>
            }
            label="ความรู้สึกวันนี้"
            value={view.hero.feelingLabel}
          />
          <InfoRow
            icon={
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 3.5h12l3.5 5L12 20.5 2.5 8.5z" />
                <path d="M2.5 8.5h19M9 3.5l3 5 3-5M12 8.5v12" />
              </svg>
            }
            label="พลอยที่คุณชอบ"
            value={view.hero.likedLabels}
          />
          <InfoRow
            icon={
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="14.5" r="6" />
                <path d="M9.5 6.5L12 3.5l2.5 3L12 9z" />
              </svg>
            }
            label="สไตล์ที่คุณเลือก"
            value={view.hero.jewelryTypeChosenLabel}
          />
        </div>
        <p className="px-1 text-sm leading-[1.7]">
          <strong className="font-semibold text-[var(--gq-burgundy-dark)]">{heroStone.nameEn}</strong> เหมาะกับโจทย์ของคุณวันนี้
          เพราะในเชิงสัญลักษณ์เชื่อมโยงกับ{heroStone.meaning}
        </p>
      </div>

      {/* Pairing */}
      <div className="px-5 pt-6 pb-2">
        <div className="flex flex-col items-center gap-3.5 rounded-[18px] px-[1.125rem] py-6 text-center" style={{ background: "var(--gq-burgundy-soft)" }}>
          <span className="text-xs font-semibold tracking-[0.2em] text-[var(--gq-burgundy)]">TRY THIS COMBINATION</span>
          <div className="flex items-center justify-center gap-[1.125rem]">
            <div className="flex w-[104px] flex-col items-center gap-1.5">
              <GemIcon colors={pairA.colors} size={64} />
              <span className="text-[15px] font-medium">{pairA.nameEn}</span>
              <span className="text-xs text-[var(--gq-text-muted)]">{pairA.labelTh}</span>
            </div>
            <span className="font-quiz-display text-3xl text-[var(--gq-burgundy)]">+</span>
            <div className="flex w-[104px] flex-col items-center gap-1.5">
              <GemIcon colors={pairB.colors} size={64} />
              <span className="text-[15px] font-medium">{pairB.nameEn}</span>
              <span className="text-xs text-[var(--gq-text-muted)]">{pairB.labelTh}</span>
            </div>
          </div>
          <p className="font-quiz-display text-2xl font-semibold text-[var(--gq-burgundy-dark)]">{view.pairing.title}</p>
          <p className="-mt-2 text-[13px] text-[var(--gq-text-muted)]">{view.pairing.th}</p>
          <p className="text-sm">เหมาะกับ: {view.pairing.fit}</p>
        </div>
      </div>

      {/* Alternatives */}
      {view.alternatives.length > 0 && (
        <div className="flex flex-col gap-3.5 px-5 pt-7 pb-2">
          <div className="flex flex-col gap-1 text-center">
            <h2 className="font-quiz-serif text-[21px] font-semibold text-[var(--gq-burgundy-dark)]">ทางเลือกอื่นสำหรับคุณ</h2>
            <p className="text-[13px] text-[var(--gq-text-muted)]">แตะเพื่อดูคำแนะนำของพลอยนั้น</p>
          </div>
          {view.alternatives.map((alt) => {
            const altStone = getStone(alt.stoneCode);
            return (
              <button
                key={alt.stoneCode}
                type="button"
                onClick={() => onFocusAlternative(alt.stoneCode)}
                className="flex min-h-[84px] w-full items-center gap-3.5 rounded-2xl border border-[var(--gq-border)] bg-white px-3.5 py-3 text-left transition-colors hover:border-[var(--gq-burgundy-border)]"
              >
                <span className="flex h-[60px] w-[60px] flex-none items-center justify-center rounded-xl bg-[var(--gq-ivory)]">
                  <GemIcon colors={altStone.colors} size={44} />
                </span>
                <span className="flex flex-1 flex-col gap-0.5">
                  <span className="text-[11px] tracking-[0.08em] text-[var(--gq-burgundy)]">{alt.label}</span>
                  <span className="text-base font-medium">
                    {altStone.nameEn} <span className="font-normal text-[var(--gq-text-muted)]">· {altStone.labelTh}</span>
                  </span>
                  <span className="text-[13px] text-[var(--gq-text-muted)]">{altStone.keywords}</span>
                </span>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--gq-burgundy)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </button>
            );
          })}
        </div>
      )}

      {/* How to wear */}
      <div className="flex flex-col gap-3.5 px-5 pt-7 pb-2">
        <h2 className="text-center font-quiz-serif text-[21px] font-semibold text-[var(--gq-burgundy-dark)]">วันนี้ลองใส่แบบนี้</h2>
        <div className="flex flex-col gap-4 rounded-2xl border border-[var(--gq-border-soft)] px-4 py-[1.125rem]">
          <div className="flex gap-3.5">
            <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full" style={{ background: "var(--gq-burgundy-soft)", color: "var(--gq-burgundy)" }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="14.5" r="6" />
                <path d="M9.5 6.5L12 3.5l2.5 3L12 9z" />
              </svg>
            </span>
            <span className="flex flex-col gap-0.5">
              <span className="text-xs text-[var(--gq-text-muted)]">เครื่องประดับ · {view.howToWear.note}</span>
              <span className="text-base font-medium">{view.howToWear.title}</span>
              <span className="text-[13px] text-[var(--gq-text-muted)]">{view.howToWear.titleTh}</span>
            </span>
          </div>
          <div className="flex gap-3.5">
            <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full" style={{ background: "var(--gq-burgundy-soft)", color: "var(--gq-burgundy)" }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M8 13V6a1.5 1.5 0 0 1 3 0v6M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11V6a1.5 1.5 0 0 1 3 0v7c0 4-2.5 7-6 7-2.5 0-4-1.2-5.5-3.5L3.8 13a1.5 1.5 0 0 1 2.5-1.6L8 13" />
              </svg>
            </span>
            <span className="flex flex-col gap-0.5">
              <span className="text-xs text-[var(--gq-text-muted)]">ตำแหน่งที่แนะนำ</span>
              <span className="text-base font-medium">{view.howToWear.place}</span>
              <span className="text-[13px] leading-[1.6] text-[var(--gq-text-muted)]">{view.howToWear.hand}</span>
            </span>
          </div>
          <div className="flex gap-3.5">
            <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full" style={{ background: "var(--gq-burgundy-soft)", color: "var(--gq-burgundy)" }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 3l1.8 7.2L21 12l-7.2 1.8L12 21l-1.8-7.2L3 12l7.2-1.8z" />
              </svg>
            </span>
            <span className="flex flex-col gap-0.5">
              <span className="text-xs text-[var(--gq-text-muted)]">ความหมาย</span>
              <span className="text-sm leading-[1.65]">{view.howToWear.why}</span>
            </span>
          </div>
          <div className="flex gap-3.5">
            <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full" style={{ background: "var(--gq-burgundy-soft)", color: "var(--gq-burgundy)" }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M19.5 14.5A8 8 0 1 1 9.5 4.5a6.5 6.5 0 0 0 10 10z" />
              </svg>
            </span>
            <span className="flex flex-col gap-0.5">
              <span className="text-xs text-[var(--gq-text-muted)]">สไตล์การใส่</span>
              <span className="text-sm leading-[1.65]">ใส่คู่กับเงิน 925 ให้ภาพรวมดูเรียบหรู และให้ {heroStone.nameEn} เป็นจุดเด่น</span>
            </span>
          </div>
        </div>
        <p className="text-center text-xs leading-[1.6] text-[var(--gq-text-faint)]">คำแนะนำเหล่านี้เป็นแนวทางตามความเชื่อและสไตล์การสวมใส่</p>
      </div>

      {/* Products */}
      <div className="flex flex-col gap-3.5 px-5 pt-7 pb-2">
        <div className="flex flex-col gap-1 text-center">
          <span className="font-quiz-display text-[22px] font-semibold tracking-[0.06em] text-[var(--gq-burgundy-dark)]">JEWELRY FOR YOUR TODAY</span>
          <span className="text-[13px] text-[var(--gq-text-muted)]">เครื่องประดับ 3J ที่เข้ากับพลอยของคุณ</span>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          {view.products.map((product) => {
            const stone = getStone(product.stoneCode);
            return (
              <div key={`${product.stoneCode}-${product.nameEn}`} className="flex flex-col overflow-hidden rounded-2xl border border-[var(--gq-border-soft)]">
                <div className="flex h-[132px] items-center justify-center" style={{ background: "var(--gq-ivory)" }}>
                  <GemIcon colors={stone.colors} size={70} />
                </div>
                <div className="flex flex-col gap-0.5 px-3 py-3.5">
                  <span className="text-sm font-medium">{product.nameEn}</span>
                  <span className="text-[13px] text-[var(--gq-text-muted)]">{product.nameTh}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* CTA + disclaimer */}
      <div className="flex flex-col gap-2.5 px-5 pt-6 pb-8">
        <a
          href={LINE_OA_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-14 w-full items-center justify-center gap-2.5 rounded-full bg-[var(--gq-burgundy)] text-base font-medium text-white transition-colors hover:bg-[var(--gq-burgundy-dark)]"
        >
          ดูเครื่องประดับจากพลอยนี้
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </a>
        <PrimaryButton variant="secondary" onClick={onRestart}>
          ทำแบบทดสอบใหม่
        </PrimaryButton>
        <div className="mt-2 border-t border-[var(--gq-divider)] pt-4">
          <p className="text-xs leading-[1.65] text-[var(--gq-text-faint)]">
            <strong className="font-semibold">ข้อควรทราบ:</strong> {view.disclaimer}
          </p>
        </div>
      </div>
    </div>
  );
}
