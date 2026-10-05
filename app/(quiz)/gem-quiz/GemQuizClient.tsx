"use client";

// app/(quiz)/gem-quiz/GemQuizClient.tsx — state machine ของแบบทดสอบเลือกพลอย
// v2 (design doc §4.2/§5): landing → q1 birth_day → q2 intention → q3
// feeling → q4 preferences(1-3) → q5 jewelry_type → loading(~1.5s) → result.
// ตรรกะคำนวณทั้งหมดอยู่ที่ lib/gem-quiz/recommend.ts + result.ts แล้ว —
// ไฟล์นี้ควบคุมแค่ "จอไหนแสดงอยู่" + เก็บคำตอบ + ยิง submit ครั้งเดียวต่อรอบ
//
// ไม่ import จาก "use server" หรือ lib/actions ใดๆ เลย (กฎโครงสร้าง §1.2 —
// ดู lib/gem-quiz/config.ts หัวไฟล์) ทางเขียนข้อมูลทางเดียวคือ
// fetch('/api/gem-quiz/submit') แบบ fire-and-forget ด้านล่าง
//
// 🔴 Hydration (บทเรียนรอบที่แล้ว, บังคับทุกจุด):
//   - state เริ่มต้นต้อง deterministic ตรงกับ SSR เป๊ะ — ไม่มี useState(()=>
//     random/shuffle(...)) เป็น lazy initializer ที่ไหนเลยในไฟล์นี้
//   - localStorage/navigator/window/query string อ่านเฉพาะใน useEffect หรือ
//     event handler เท่านั้น ไม่ใช่ตอน render
//   - timer ของ LoadingScreen เริ่มใน useEffect + clear ใน cleanup
//   - prefers-reduced-motion อยู่ที่ CSS (tailwind.config.ts's motion-safe:
//     animation) ไม่ใช่ตรรกะ JS ที่นี่
import { useEffect, useMemo, useRef, useState } from "react";
import {
  GEM_QUIZ_QUESTIONS,
  GEM_QUIZ_SRC_VALUES,
  GEM_QUIZ_STONE_BY_CODE,
  GEM_QUIZ_STONES,
  MAX_LIKED_STONES,
  QUIZ_VERSION,
  type GemQuizAnswers,
  type GemQuizSrc,
  type GemQuizStoneConfig,
} from "@/lib/gem-quiz/config";
import { rankGems } from "@/lib/gem-quiz/recommend";
import { buildResultView } from "@/lib/gem-quiz/result";
import { Landing } from "./_screens/Landing";
import { QuestionScreen } from "./_screens/QuestionScreen";
import { PreferenceScreen } from "./_screens/PreferenceScreen";
import { LoadingScreen } from "./_screens/LoadingScreen";
import { ResultScreen } from "./_screens/ResultScreen";

const LOCAL_STORAGE_DONE_KEY = `gemQuizDone:v${QUIZ_VERSION}`;
const LOADING_DURATION_MS = 1500;

// จอ "liked" (Q4) ไม่มี key ใน answers (เก็บใน likedCodes แยก — design §3.1:
// "answers รับแค่ string ต่อ key เท่านั้น array ใส่ไม่ได้") จึงแทรกเข้าไปใน
// ลำดับจอด้วยมือ ไม่ derive จาก GEM_QUIZ_QUESTIONS ตรงๆ แบบ v1 เดิม
const SCREENS = ["landing", "q1", "q2", "q3", "q4", "q5", "loading", "result"] as const;
type Screen = (typeof SCREENS)[number];
const TOTAL_QUESTIONS = 5;
const QUESTION_NUMBER: Partial<Record<Screen, number>> = { q1: 1, q2: 2, q3: 3, q4: 4, q5: 5 };

// ลำดับจริงของ GEM_QUIZ_QUESTIONS คือ [birth_day, intention, feeling,
// jewelry_type] — คำถามของจอ q1/q2/q3/q5 ตามลำดับนี้เป๊ะ (ไม่ hardcode index
// ตรงๆ เพื่อกันพังถ้าลำดับ config เปลี่ยน แต่ map ตาม code ที่รู้จักแน่นอน)
const QUESTION_BY_CODE = Object.fromEntries(GEM_QUIZ_QUESTIONS.map((q) => [q.code, q]));
const SCREEN_QUESTION_CODE: Partial<Record<Screen, string>> = {
  q1: "birth_day",
  q2: "intention",
  q3: "feeling",
  q5: "jewelry_type",
};

function shuffleStones(stones: readonly GemQuizStoneConfig[]): GemQuizStoneConfig[] {
  const arr = [...stones];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function readSrcFromLocation(): GemQuizSrc {
  if (typeof window === "undefined") return "direct";
  const raw = new URLSearchParams(window.location.search).get("src");
  return raw && (GEM_QUIZ_SRC_VALUES as readonly string[]).includes(raw) ? (raw as GemQuizSrc) : "direct";
}

/** อ่านธง "ทำแล้ว" ของรอบก่อนหน้า — เรียกสดๆ ตอนกำลังจะยิง submit เท่านั้น
 * (ไม่ใช่ค่าที่ cache ไว้ตอน mount) เพราะถ้าผู้ใช้กด "ทำแบบทดสอบใหม่" ใน
 * session เดียวกัน ธงอาจเพิ่งถูก set จากรอบก่อนไปแล้ว. */
function readRetakeFlag(): boolean {
  try {
    return window.localStorage.getItem(LOCAL_STORAGE_DONE_KEY) === "1";
  } catch {
    // in-app browser (LINE/TikTok) บล็อก localStorage ได้ — fail safe ไปทาง
    // "ไม่ retake" ไม่ throw (N-2)
    return false;
  }
}

function markDone(): void {
  try {
    window.localStorage.setItem(LOCAL_STORAGE_DONE_KEY, "1");
  } catch {
    // เช่นเดียวกับ readRetakeFlag — เงียบ ไม่กระทบผลลัพธ์ที่ผู้ใช้เห็นไปแล้ว
  }
}

function screenIndex(screen: Screen): number {
  return SCREENS.indexOf(screen);
}

export function GemQuizClient({ token }: { token: string | null }) {
  const [screen, setScreen] = useState<Screen>("landing");
  const [answers, setAnswers] = useState<GemQuizAnswers>({});
  const [likedCodes, setLikedCodes] = useState<string[]>([]);
  // กลับมติ 5 ต.ค. 69: true = แตะ "ยังไม่แน่ใจ แนะนำให้ฉัน" ที่ Q4 ไว้
  // (exclusive กับ likedCodes — toggleLiked()/selectUnsurePreference() คุมให้
  // ไม่ซ้อนกัน) ใช้คุมปุ่ม "ถัดไป" แทน MIN_LIKED_STONES ที่กลับเป็น 0 แล้ว
  const [preferenceUnsure, setPreferenceUnsure] = useState(false);
  const [focusStoneCode, setFocusStoneCode] = useState<string | null>(null);
  const [honeypot, setHoneypot] = useState("");

  // ลำดับที่แสดงของ Q4 — เริ่ม deterministic (ลำดับ config เป๊ะ, ไม่สุ่ม)
  // แล้วค่อยสุ่มจริงใน useEffect หลัง mount เท่านั้น (ดูคำเตือนหัวไฟล์)
  const [stoneOrder, setStoneOrder] = useState<GemQuizStoneConfig[]>(() => [...GEM_QUIZ_STONES]);
  useEffect(() => {
    setStoneOrder(shuffleStones(GEM_QUIZ_STONES));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- สุ่มครั้งเดียวตอน mount ตั้งใจ
  }, []);

  const [src, setSrc] = useState<GemQuizSrc>("direct");
  useEffect(() => {
    setSrc(readSrcFromLocation());
  }, []);

  const submittedRef = useRef(false);
  const loadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // security audit M2 (5 ต.ค. 69): ต้องไม่ถูก reset ใน restart() ต่างจาก
  // submittedRef — design §5 สั่ง "ref = localStorage OR ส่งแล้วในรอบนี้" แต่
  // ของเดิมอ่านแค่ localStorage ซึ่งพังถ้า in-app browser (LINE/TikTok) บล็อก
  // localStorage (คอมเมนต์ N-2) — กดรีสตาร์ตกี่รอบใน session เดียวกันก็ควร
  // เป็น retake=true ตั้งแต่รอบที่ 2 แม้ localStorage จะอ่านไม่ได้เลย
  const sentThisSessionRef = useRef(false);

  // จอ loading auto-advance ไป result หลัง ~1.5s — ตั้ง/เคลียร์ timer เฉพาะใน
  // useEffect (ไม่ใช่ JS ควบคุม motion — นั่นคือ CSS motion-safe: ของ
  // tailwind.config.ts) cleanup ป้องกัน timer ค้างถ้า unmount ก่อนครบเวลา
  useEffect(() => {
    if (screen !== "loading") return;
    loadingTimerRef.current = setTimeout(() => setScreen("result"), LOADING_DURATION_MS);
    return () => {
      if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current);
    };
  }, [screen]);

  // Submit ครั้งเดียวต่อรอบที่ทำจบ (design §5: "submit ครั้งเดียวต่อรอบที่ทำ
  // จบ") — fire-and-forget, ไม่แสดง error ใดๆ ให้ผู้ใช้เห็นไม่ว่าสำเร็จหรือล้ม
  // (ผลลัพธ์แสดงจากการคำนวณฝั่ง client ไปก่อนแล้ว). markDone() เฉพาะตอนได้
  // 204 กลับมาเท่านั้น (ไม่ใช่ทุก response ที่ resolve — 400/403/503 ก็ resolve
  // เหมือนกันแต่ไม่ใช่ "สำเร็จจริง").
  useEffect(() => {
    if (screen !== "result" || submittedRef.current) return;
    submittedRef.current = true;

    const body = {
      v: QUIZ_VERSION,
      src,
      token: token ?? "",
      hp: honeypot,
      liked: likedCodes,
      answers,
      // M2: localStorage อย่างเดียวพังถ้า in-app browser บล็อกมัน — รอบที่ 2
      // ขึ้นไปใน session เดียวกันนี้ต้องเป็น retake=true เสมอ ไม่ว่า
      // localStorage จะอ่านได้หรือไม่
      retake: readRetakeFlag() || sentThisSessionRef.current,
    };
    sentThisSessionRef.current = true;

    fetch("/api/gem-quiz/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then((res) => {
        if (res.status === 204) markDone();
      })
      .catch(() => {
        // เงียบโดยตั้งใจ (N-4)
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- submittedRef กันยิงซ้ำ ไม่ต้องตาม deps ที่เปลี่ยนหลัง submit แล้ว
  }, [screen]);

  function goNext() {
    setScreen((prev) => SCREENS[Math.min(screenIndex(prev) + 1, SCREENS.length - 1)]);
  }
  function goBack() {
    setScreen((prev) => SCREENS[Math.max(screenIndex(prev) - 1, 0)]);
  }

  function selectAnswer(questionCode: string, optionCode: string) {
    setAnswers((prev) => ({ ...prev, [questionCode]: optionCode }));
  }

  function toggleLiked(code: string) {
    // กลับมติ 5 ต.ค. 69: เลือกพลอยจริงต้องเคลียร์ "ยังไม่แน่ใจ" เสมอ (exclusive
    // กัน — ดูคอมเมนต์หัวไฟล์ GemPicker.tsx)
    setPreferenceUnsure(false);
    setLikedCodes((prev) => {
      if (prev.includes(code)) return prev.filter((c) => c !== code);
      if (prev.length >= MAX_LIKED_STONES) return prev;
      return [...prev, code];
    });
  }

  function selectUnsurePreference() {
    setLikedCodes([]);
    setPreferenceUnsure(true);
  }

  // code review S4: mockup ต้นฉบับ (Quiz.dc.html:641-642, 704-705) สั่ง
  // scrollTo({top:0}) ตอนแตะพลอยทางเลือกและตอนกด "กลับไปที่พลอยแนะนำอันดับ 1"
  // — รอบพอร์ตแรกไม่ได้ทำ บนมือถือรายการทางเลือกอยู่กลางหน้าผลที่ยาวมาก แตะ
  // แล้วเห็นแค่รายการสลับ ส่วน hero ที่เปลี่ยนอยู่นอกจอ ไม่รู้ว่าอะไรเปลี่ยน
  function focusStone(code: string | null) {
    setFocusStoneCode(code);
    if (typeof window === "undefined") return;
    // jsdom (vitest) ไม่มี window.matchMedia โดย default — กันไว้ไม่ใช้ง่ายๆ
    // ว่า "มี window แปลว่ามี matchMedia เสมอ" (เจอ TypeError จริงตอนรันเทสต์)
    const reduceMotion =
      typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  }

  function restart() {
    submittedRef.current = false;
    setAnswers({});
    setLikedCodes([]);
    setPreferenceUnsure(false);
    setFocusStoneCode(null);
    setScreen("landing");
  }

  // Preview สีพลอยบนจอ loading — คำนวณได้แล้วตอนนี้เพราะทุกคำตอบที่ rankGems
  // ต้องใช้ตอบครบแล้วก่อนจะมาถึงจอ loading ได้ (ปุ่ม "ถัดไป" ของทุกจอ disabled
  // จนกว่าจะตอบ). ไม่ throw เพราะไม่ได้เรียก buildResultView() (ซึ่งต้องการ
  // jewelryType ด้วย) — ใช้ rankGems() ตรงๆ (jewelry_type ไม่มีผลคะแนน).
  // กลับมติ 5 ต.ค. 69: likedCodes=[] ("ยังไม่แน่ใจ") เป็นค่าสุดท้ายที่ถูกต้องได้
  // แล้ว ไม่ใช่สัญญาณว่า "ยังตอบไม่ครบ" อีกต่อไป — เอาออกจากเงื่อนไข fallback
  const loadingHeroColors = useMemo(() => {
    if (!answers.birth_day || !answers.intention || !answers.feeling) {
      return GEM_QUIZ_STONES[0].colors;
    }
    const ranked = rankGems({
      birthDay: answers.birth_day,
      intention: answers.intention,
      feeling: answers.feeling,
      likedStoneCodes: likedCodes,
    });
    // code review S5: ranked[0].code เป็น GemQuizStoneCode อยู่แล้ว index
    // ตรงๆ แทน .find()+`!`
    return GEM_QUIZ_STONE_BY_CODE[ranked[0].code].colors;
  }, [answers.birth_day, answers.intention, answers.feeling, likedCodes]);

  const resultView = useMemo(() => {
    if (screen !== "result") return null;
    return buildResultView({
      answers: {
        birthDay: answers.birth_day ?? "",
        intention: answers.intention ?? "",
        feeling: answers.feeling ?? "",
        jewelryType: answers.jewelry_type ?? "",
      },
      likedStoneCodes: likedCodes,
      focusStoneCode,
    });
  }, [screen, answers, likedCodes, focusStoneCode]);

  const questionCode = SCREEN_QUESTION_CODE[screen];
  const question = questionCode ? QUESTION_BY_CODE[questionCode] : undefined;
  const currentQuestionNumber = QUESTION_NUMBER[screen];

  return (
    <>
      {/* L3 honeypot (design §5.2) — mount ตลอดทุกจอ (ไม่ผูกกับจอใดจอหนึ่ง)
          ซ่อนจากคนจริงด้วย CSS off-screen (ไม่ใช่ display:none ที่ bot บางตัว
          รู้จักข้าม) + tabIndex=-1 + autoComplete=off + aria-hidden */}
      <input
        type="text"
        name="hp"
        value={honeypot}
        onChange={(e) => setHoneypot(e.target.value)}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden"
      />

      {screen === "landing" && <Landing onStart={goNext} />}

      {screen === "q4" && (
        <PreferenceScreen
          stones={stoneOrder}
          selected={likedCodes}
          onToggle={toggleLiked}
          isUnsure={preferenceUnsure}
          onSelectUnsure={selectUnsurePreference}
          max={MAX_LIKED_STONES}
          onNext={goNext}
          onBack={goBack}
          current={4}
          total={TOTAL_QUESTIONS}
        />
      )}

      {question && currentQuestionNumber !== undefined && (
        <QuestionScreen
          key={screen}
          questionCode={question.code}
          labelTh={question.labelTh}
          options={question.options}
          selected={answers[question.code]}
          onSelect={(code) => selectAnswer(question.code, code)}
          onNext={goNext}
          onBack={goBack}
          current={currentQuestionNumber}
          total={TOTAL_QUESTIONS}
        />
      )}

      {screen === "loading" && <LoadingScreen heroColors={loadingHeroColors} />}

      {screen === "result" && resultView && (
        <ResultScreen
          view={resultView}
          onFocusAlternative={focusStone}
          onBackToTop={() => focusStone(null)}
          onRestart={restart}
        />
      )}
    </>
  );
}
