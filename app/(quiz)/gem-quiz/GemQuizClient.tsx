"use client";

// app/(quiz)/gem-quiz/GemQuizClient.tsx — state machine ของแบบทดสอบเลือกพลอย
// v2 (design doc §4.2/§5): landing → q1 birth_day → q2 intention → q3
// feeling → q4 preferences(1-3) → q5 jewelry_type → loading(~1.5s) → result.
// ตรรกะคำนวณทั้งหมดอยู่ที่ lib/gem-quiz/recommend.ts + result.ts แล้ว —
// ไฟล์นี้ควบคุมแค่ "จอไหนแสดงอยู่" + เก็บคำตอบ + ยิง submit ครั้งเดียวต่อรอบ
//
// History (ux-tools-navigation §4 · มติเจ้าของ 24 พ.ย. 69): ทุกจอ = 1 history entry (pushState · key "gq") เพื่อให้ปุ่ม Back ของมือถือ/LINE
// ถอยทีละจอแทนที่จะหลุดออกจากหน้าแล้วคำตอบหาย — ต้นแบบเดียวกับ RingSizeClient (stackRef/idxRef/backPendingRef)
//   - Loading ถูก replace เป็น Result (ไม่เหลือ entry ของ Loading → Back จากผลไป Q5 ไม่เจอ loading วน)
//   - คง __NA ของ Next ใน history.state ทุกครั้ง (lib/nav/screen-history.ts) · รีโหลด/popstate ไปจอที่ไม่มีคำตอบรองรับ = กลับ Landing
//   - ปุ่มถอยบนจอเรียก history.back() "เฉพาะเมื่อ entry ก่อนหน้าคือจอปลายทางจริง" (ไม่งั้น pushState) — เปิดลิงก์ตรงแล้วไม่หลุดนอกเว็บ
//   - สถิติ: submit ครั้งเดียวต่อรอบ (submittedRef) — ถอยไปแก้คำตอบแล้วดูผลใหม่ "ไม่ส่งซ้ำ" (Q5 มติ TL) · reset เฉพาะ "ทำแบบทดสอบใหม่"
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { nextHistoryState, readHistState } from "@/lib/nav/screen-history";
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
const HISTORY_KEY = "gq";
/** ระยะที่ถือว่า "กำลังย้อน" สูงสุด (ms) ถ้า popstate ไม่มา — กันกดรัว = back() ซ้ำ = หลุดหน้า */
const BACK_PENDING_MS = 800;

function isScreenId(v: unknown): v is Screen {
  return typeof v === "string" && (SCREENS as readonly string[]).includes(v);
}

/** จอปลายทางของปุ่มถอย: q5/loading/result → q5 (loading ถูก replace เป็น result จึงไม่ค้างเป็น entry) · landing = ไม่มี */
function backTarget(screen: Screen): Screen | null {
  if (screen === "landing") return null;
  if (screen === "loading" || screen === "result") return "q5";
  return SCREENS[Math.max(SCREENS.indexOf(screen) - 1, 0)];
}

interface QuizData {
  answers: GemQuizAnswers;
  likedCodes: string[];
  preferenceUnsure: boolean;
}

/** guard popstate/รีโหลด: จอนี้มีคำตอบรองรับครบไหม (ไม่ค้างจอว่าง / ไม่ throw ใน buildResultView) */
function canShowScreen(screen: Screen, d: QuizData): boolean {
  const a = d.answers;
  const hasPref = d.likedCodes.length > 0 || d.preferenceUnsure;
  switch (screen) {
    case "landing":
    case "q1":
      return true;
    case "q2":
      return !!a.birth_day;
    case "q3":
      return !!a.birth_day && !!a.intention;
    case "q4":
      return !!a.birth_day && !!a.intention && !!a.feeling;
    case "q5":
      return !!a.birth_day && !!a.intention && !!a.feeling && hasPref;
    case "loading":
    case "result":
      return !!a.birth_day && !!a.intention && !!a.feeling && !!a.jewelry_type && hasPref;
  }
}

/** จำนวนคำตอบที่ทำไว้ (Q4 นับ 1 เมื่อเลือกพลอยหรือกด "ยังไม่แน่ใจ") — ≥ 2 = งานค้างที่ไม่ควรทิ้งเงียบๆ (§5) */
function answeredCount(d: QuizData): number {
  const n = ["birth_day", "intention", "feeling", "jewelry_type"].filter((k) => !!d.answers[k]).length;
  return n + (d.likedCodes.length > 0 || d.preferenceUnsure ? 1 : 0);
}
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

  // ───── history: ทุกจอ = 1 entry ─────
  const rootRef = useRef<HTMLDivElement>(null);
  const firstScreenRender = useRef(true);
  const stackRef = useRef<Screen[]>(["landing"]);
  const idxRef = useRef(0);
  const backPendingRef = useRef(false);
  const backTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // popstate handler ผูกครั้งเดียวตอน mount — อ่านคำตอบล่าสุดผ่าน ref (ไม่ใช่ closure เก่า)
  const dataRef = useRef<QuizData>({ answers, likedCodes, preferenceUnsure });
  dataRef.current = { answers, likedCodes, preferenceUnsure };

  const navigate = useCallback((next: Screen, opts?: { replace?: boolean }) => {
    if (opts?.replace) {
      stackRef.current[idxRef.current] = next;
    } else {
      stackRef.current = stackRef.current.slice(0, idxRef.current + 1);
      stackRef.current.push(next);
      idxRef.current += 1;
    }
    try {
      // ใช้ window.history.* (ตัวที่ Next patch ไว้) + state ที่คงของเดิม (__NA) — ห้ามเขียนทับทั้งก้อน (N9)
      const state = nextHistoryState(HISTORY_KEY, next, idxRef.current, window.history.state);
      if (opts?.replace) window.history.replaceState(state, "");
      else window.history.pushState(state, "");
    } catch {
      // history ใช้ไม่ได้ (sandbox/in-app browser) — จอยังเปลี่ยนได้ เสียแค่ปุ่ม Back ของเครื่อง (M9)
    }
    setScreen(next);
  }, []);

  // mount: ผูก popstate · entry แรก = Landing (รีโหลดแล้ว history.state ค้างจอเก่าแต่คำตอบหาย → เริ่ม Landing เสมอ)
  useEffect(() => {
    try {
      const prev = readHistState(HISTORY_KEY, isScreenId, window.history.state);
      const i = prev ? prev.i : 0;
      stackRef.current = [];
      stackRef.current[i] = "landing";
      idxRef.current = i;
      window.history.replaceState(nextHistoryState(HISTORY_KEY, "landing", i, window.history.state), "");
    } catch {
      // ไม่มี history API
    }

    const onPop = (e: PopStateEvent) => {
      const entry = readHistState(HISTORY_KEY, isScreenId, e.state);
      let id: Screen = entry ? entry.id : "landing";
      const i = entry ? entry.i : 0;
      backPendingRef.current = false;
      if (backTimerRef.current) {
        clearTimeout(backTimerRef.current);
        backTimerRef.current = null;
      }
      idxRef.current = i;
      if (!canShowScreen(id, dataRef.current)) {
        // N8: ไปจอที่ไม่มีคำตอบรองรับ (รีโหลดกลางทาง/Forward หลังเริ่มใหม่) → Landing ที่ entry นี้ ไม่ค้างจอว่าง
        id = "landing";
        try {
          window.history.replaceState(nextHistoryState(HISTORY_KEY, "landing", i, window.history.state), "");
        } catch {
          // ข้าม
        }
      }
      stackRef.current[i] = id;
      setScreen(id);
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      if (backTimerRef.current) clearTimeout(backTimerRef.current);
    };
  }, []);

  // เปลี่ยนจอ: โฟกัสเนื้อหาจอใหม่ + ขึ้นบนสุด (ไม่ทำตอน render ครั้งแรก) — Back แล้ว screen reader/คีย์บอร์ดตามไปด้วย
  useEffect(() => {
    if (firstScreenRender.current) {
      firstScreenRender.current = false;
      return;
    }
    const root = rootRef.current;
    if (!root) return;
    root.focus({ preventScroll: true });
    root.scrollIntoView?.({ block: "start" });
  }, [screen]);

  // จอ loading auto-advance ไป result หลัง ~1.5s — ตั้ง/เคลียร์ timer เฉพาะใน
  // useEffect (ไม่ใช่ JS ควบคุม motion — นั่นคือ CSS motion-safe: ของ
  // tailwind.config.ts) cleanup ป้องกัน timer ค้างถ้า unmount ก่อนครบเวลา
  // N7: Loading → Result ด้วย replace (entry เดียวกัน) · Back ระหว่าง loading → popstate เปลี่ยนจอ → cleanup เคลียร์ timer
  useEffect(() => {
    if (screen !== "loading") return;
    loadingTimerRef.current = setTimeout(() => navigate("result", { replace: true }), LOADING_DURATION_MS);
    return () => {
      if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current);
    };
  }, [screen, navigate]);

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
      // ลูกค้ากดลิงก์ไป /ring-builder ทันทีหลังเห็นผล — keepalive ให้ request ไม่ถูกตัดตอนเปลี่ยนหน้า (มติ TL 12 พ.ย. 69 §7e)
      keepalive: true,
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
    const cur = stackRef.current[idxRef.current] ?? screen;
    const next = SCREENS[Math.min(screenIndex(cur) + 1, SCREENS.length - 1)];
    if (next === cur) return; // กดรัวหลัง navigate — ไม่ push entry ซ้ำ
    navigate(next);
  }

  // ปุ่มถอยบนจอ: entry ก่อนหน้าคือปลายทาง → history.back() (ไม่สะสม entry) · ไม่ใช่ (เช่นรีโหลดกลางทาง) → pushState ไปปลายทาง
  // N1: ไม่เรียก history.back() ถ้า entry ก่อนหน้าไม่ใช่จอที่รู้จัก — กันหลุดออกนอกหน้า (เช่น แชต LINE)
  function goBack() {
    if (backPendingRef.current) return; // กำลังย้อนอยู่ — กดซ้ำไม่นับ
    const i = idxRef.current;
    const cur = stackRef.current[i] ?? screen;
    const dest = backTarget(cur);
    if (!dest || dest === cur) return;
    if (i > 0 && stackRef.current[i - 1] === dest) {
      try {
        backPendingRef.current = true;
        if (backTimerRef.current) clearTimeout(backTimerRef.current);
        backTimerRef.current = setTimeout(() => {
          backPendingRef.current = false;
        }, BACK_PENDING_MS);
        window.history.back();
        return;
      } catch {
        backPendingRef.current = false;
        // ตกไป navigate ปกติ
      }
    }
    navigate(dest);
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
    // §4.2: ล้างคำตอบ + history.go(-i) กลับ entry แรก (ไม่ push Landing ใหม่ — กัน Back วนกลับไปผลที่ถูกล้าง) · history ใช้ไม่ได้ = setScreen เฉยๆ
    // เปลี่ยนจอทันที (ไม่รอ popstate) — ไม่งั้นระหว่างรอ ResultScreen จะ render ด้วยคำตอบว่าง · popstate ที่ตามมาก็ได้ Landing เหมือนกัน
    const steps = idxRef.current;
    stackRef.current = ["landing"];
    idxRef.current = 0;
    setScreen("landing");
    if (steps > 0) {
      try {
        window.history.go(-steps);
      } catch {
        // ข้าม — จอเป็น Landing แล้ว
      }
    }
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
  // §5: กด "เครื่องมือ 3J" กลาง quiz (Q1–Q5) แล้วมีคำตอบ ≥ 2 → ถามก่อนออก · Landing/Loading/Result ไม่ถาม
  const hubDirty = answeredCount({ answers, likedCodes, preferenceUnsure }) >= 2;

  return (
    <div ref={rootRef} tabIndex={-1} className="outline-none">
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
          hubDirty={hubDirty}
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
          hubDirty={hubDirty}
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
          onBack={goBack}
        />
      )}
    </div>
  );
}
