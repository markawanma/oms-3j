"use client";

// app/(quiz)/gem-quiz/GemQuizClient.tsx — state machine ของแบบทดสอบเลือกพลอย
// (design §4.2/§4.3). ไม่ import จาก "use server" หรือ lib/actions ใดๆ เลย
// (กฎโครงสร้าง §1.2 — ดู lib/gem-quiz/config.ts หัวไฟล์) ทางเขียนข้อมูลทางเดียว
// คือ fetch('/api/gem-quiz/submit') แบบ fire-and-forget ด้านล่าง
//
// 🔴 เนื้อหาคำถาม/ตัวเลือก/ลักษณะพลอย/ความเชื่อยังเป็น placeholder ทั้งหมด
// (รอทีม content ผ่าน 3 ด่านตาม 3j-content-orchestration — ดู config.ts และ
// หมายเหตุที่ RESULT_PLACEHOLDER_COPY ด้านล่าง) ห้าม deploy ขึ้น prod ด้วย
// เนื้อหานี้.
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  GEM_QUIZ_QUESTIONS,
  GEM_QUIZ_SRC_VALUES,
  GEM_QUIZ_STONES,
  MAX_LIKED_STONES,
  QUIZ_VERSION,
  type GemQuizAnswers,
  type GemQuizSrc,
  type GemQuizStoneConfig,
} from "@/lib/gem-quiz/config";
import { recommendStoneCodes } from "@/lib/gem-quiz/recommend";

const LOCAL_STORAGE_DONE_KEY = `gemQuizDone:v${QUIZ_VERSION}`;

// §4.3 slot 3/4/5: config.ts (ตามที่ backend ส่งมอบจริง) มีแค่ labelTh ของแต่
// ละพลอย — ไม่มีฟิลด์ "ลักษณะพลอย" / "ตามความเชื่อที่คนไทยนิยม" / disclaimer
// ให้ดึงเลย (ไม่ตรงกับที่ design §8 สมมติไว้ว่า "ดึงจาก config เท่านั้น"). แทน
// ที่จะเขียนเนื้อหาเชิงข้อเท็จจริง/ความเชื่อขึ้นมาเอง (ขัดกฎ "ห้ามอนุมาน
// ข้อเท็จจริงที่ไม่มี" และยังไม่ผ่าน 3 ด่าน content) จึงคงไว้เป็น placeholder
// ที่มองเห็นชัดว่าเป็น placeholder — ดู README ส่วนท้าย GemQuizClient.test.tsx
// และรายงานส่งมอบสำหรับรายละเอียดช่องว่างนี้.
const CHARACTERISTIC_PLACEHOLDER = "[รอเนื้อหาจากทีม content ผ่าน 3 ด่าน — ยังไม่มีในระบบ]";
const BELIEF_PLACEHOLDER = "[รอเนื้อหาจากทีม content ผ่าน 3 ด่าน — ยังไม่มีในระบบ]";
const DISCLAIMER_PLACEHOLDER =
  "[รอข้อความจริงจาก copywriter] ความเชื่อเป็นวัฒนธรรมที่เล่าต่อกันมา ไม่ใช่การรับรองผล";

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

function readRetakeFlag(): boolean {
  try {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(LOCAL_STORAGE_DONE_KEY) === "1";
  } catch {
    // in-app browser (LINE/TikTok) บล็อก localStorage ได้ — ไม่กระทบการทำแบบ
    // ทดสอบ แค่เสีย signal ของ "คนเดิมทำซ้ำ" ไปบ้าง (N-2)
    return false;
  }
}

function markDone(): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LOCAL_STORAGE_DONE_KEY, "1");
  } catch {
    // เช่นเดียวกับ readRetakeFlag — เงียบ ไม่กระทบผลลัพธ์ที่ผู้ใช้เห็นไปแล้ว
  }
}

function buildShareUrl(): string {
  if (typeof window === "undefined") return "";
  const url = new URL(window.location.href);
  // ไม่แนบคำตอบใดๆใน URL (design §4.3 slot 6) — เปลี่ยนแค่ src เป็น "share"
  url.search = "";
  url.searchParams.set("src", "share");
  return url.toString();
}

type StepKey = "liked" | (typeof GEM_QUIZ_QUESTIONS)[number]["code"] | "result";

export function GemQuizClient({ token }: { token: string | null }) {
  const shuffledStones = useState(() => shuffleStones(GEM_QUIZ_STONES))[0];
  const src = useState(() => readSrcFromLocation())[0];
  const isRetake = useState(() => readRetakeFlag())[0];

  const steps = useMemo<StepKey[]>(() => ["liked", ...GEM_QUIZ_QUESTIONS.map((q) => q.code), "result"], []);
  const [stepIndex, setStepIndex] = useState(0);
  const currentStep = steps[stepIndex];

  const [likedCodes, setLikedCodes] = useState<string[]>([]);
  const [answers, setAnswers] = useState<GemQuizAnswers>({});
  const [honeypot, setHoneypot] = useState("");

  const [canUseShareApi, setCanUseShareApi] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");

  const submittedRef = useRef(false);

  useEffect(() => {
    setCanUseShareApi(typeof navigator !== "undefined" && typeof navigator.share === "function");
  }, []);

  const recommendedStoneCodes = useMemo(() => recommendStoneCodes(answers), [answers]);

  // Fire-and-forget submit — ยิงแค่ครั้งเดียวตอนมาถึงหน้าผลลัพธ์ (คุมด้วย
  // submittedRef) ไม่ await ที่ตัว effect (ไม่บล็อก UI) และไม่แสดง error ใดๆ
  // ให้ผู้ใช้เห็น ไม่ว่า request จะสำเร็จหรือล้มเหลว (N-4, design §2/§5.2).
  useEffect(() => {
    if (currentStep !== "result" || submittedRef.current) return;
    submittedRef.current = true;

    const body = {
      v: QUIZ_VERSION,
      src,
      token: token ?? "",
      hp: honeypot,
      liked: likedCodes,
      answers,
      retake: isRetake,
    };

    fetch("/api/gem-quiz/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(() => markDone())
      .catch(() => {
        // เงียบโดยตั้งใจ — ผลลัพธ์แสดงไปก่อนยิง request นี้แล้ว (N-4)
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- submittedRef กัน
    // ไม่ให้ effect นี้ยิงซ้ำ ไม่ต้องตาม deps ที่เปลี่ยนหลัง submit ไปแล้ว
  }, [currentStep]);

  function goNext() {
    setStepIndex((i) => Math.min(i + 1, steps.length - 1));
  }
  function goBack() {
    setStepIndex((i) => Math.max(i - 1, 0));
  }

  function toggleLiked(code: string) {
    setLikedCodes((prev) => {
      if (prev.includes(code)) return prev.filter((c) => c !== code);
      if (prev.length >= MAX_LIKED_STONES) return prev;
      return [...prev, code];
    });
  }

  function handleShare() {
    const shareUrl = buildShareUrl();
    if (canUseShareApi) {
      navigator.share({ url: shareUrl, title: "แบบทดสอบเลือกพลอย 3J Jewelry" }).catch(() => {
        // ผู้ใช้กดยกเลิกกล่องแชร์ของระบบ — ไม่ต้องแจ้งอะไรเพิ่ม
      });
    }
  }

  async function handleCopyLink() {
    const shareUrl = buildShareUrl();
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  }

  // ---- Q1: ชอบพลอยอะไร (design §4.2 ขั้น 1) ----
  if (currentStep === "liked") {
    return (
      <div className="mx-auto max-w-md px-4 py-6">
        <HoneypotField value={honeypot} onChange={setHoneypot} />
        <StepProgress current={1} total={steps.length} />
        <h2 className="mt-3 text-lg font-bold text-zinc-900">ชอบพลอยอะไร</h2>
        <p className="mt-1 text-sm text-zinc-500">เลือกได้สูงสุด {MAX_LIKED_STONES} ตัว — เลือกตามใจชอบ ไม่มีคำตอบที่ถูกหรือผิด</p>

        <fieldset className="mt-4 grid grid-cols-2 gap-2.5" aria-label="ตัวเลือกพลอยที่ชอบ">
          {shuffledStones.map((stone) => {
            const checked = likedCodes.includes(stone.code);
            const disabled = !checked && likedCodes.length >= MAX_LIKED_STONES;
            return (
              <label
                key={stone.code}
                className={`flex min-h-11 cursor-pointer items-center justify-center rounded-md border px-3 py-3 text-center text-sm font-medium transition-colors ${
                  checked
                    ? "border-primary-600 bg-primary-50 text-primary-700"
                    : disabled
                      ? "cursor-not-allowed border-zinc-200 text-zinc-400"
                      : "border-zinc-300 text-zinc-700 hover:border-primary-300"
                }`}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={checked}
                  disabled={disabled}
                  onChange={() => toggleLiked(stone.code)}
                />
                {stone.labelTh}
              </label>
            );
          })}
        </fieldset>

        <div className="mt-5 flex flex-col gap-2">
          <Button onClick={goNext} disabled={likedCodes.length === 0}>
            ถัดไป
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setLikedCodes([]);
              goNext();
            }}
          >
            ยังไม่มีในใจ
          </Button>
        </div>
      </div>
    );
  }

  // ---- คำถามแนะนำ (design §4.2 ขั้น 2-3) ----
  if (currentStep !== "result") {
    const question = GEM_QUIZ_QUESTIONS.find((q) => q.code === currentStep);
    if (!question) return null; // ไม่เกิดจริง — steps ผลิตจาก GEM_QUIZ_QUESTIONS เสมอ
    const selected = answers[question.code];

    return (
      <div className="mx-auto max-w-md px-4 py-6">
        <StepProgress current={stepIndex + 1} total={steps.length} />
        <h2 className="mt-3 text-lg font-bold text-zinc-900">{question.labelTh}</h2>

        <fieldset className="mt-4 flex flex-col gap-2" aria-label={question.labelTh}>
          {question.options.map((option) => {
            const checked = selected === option.code;
            return (
              <label
                key={option.code}
                className={`flex min-h-11 cursor-pointer items-center rounded-md border px-3.5 py-2.5 text-sm font-medium transition-colors ${
                  checked ? "border-primary-600 bg-primary-50 text-primary-700" : "border-zinc-300 text-zinc-700 hover:border-primary-300"
                }`}
              >
                <input
                  type="radio"
                  name={question.code}
                  className="sr-only"
                  checked={checked}
                  onChange={() => setAnswers((prev) => ({ ...prev, [question.code]: option.code }))}
                />
                {option.labelTh}
              </label>
            );
          })}
        </fieldset>

        <div className="mt-5 flex gap-2">
          <Button variant="secondary" onClick={goBack}>
            ย้อนกลับ
          </Button>
          <Button onClick={goNext} disabled={!selected} className="flex-1">
            ถัดไป
          </Button>
        </div>
      </div>
    );
  }

  // ---- ผลลัพธ์ (design §4.3) ----
  const likedStoneLabels = likedCodes
    .map((code) => GEM_QUIZ_STONES.find((s) => s.code === code)?.labelTh)
    .filter((label): label is string => Boolean(label));
  const recommendedStones = recommendedStoneCodes
    .map((code) => GEM_QUIZ_STONES.find((s) => s.code === code))
    .filter((s): s is GemQuizStoneConfig => Boolean(s));

  return (
    <div className="mx-auto max-w-md px-4 py-6">
      <h2 className="text-lg font-bold text-zinc-900">ผลลัพธ์ของคุณ</h2>

      <section className="mt-4">
        <h3 className="text-sm font-bold text-zinc-500">พลอยที่คุณชอบ</h3>
        <p className="mt-1 text-base text-zinc-900">{likedStoneLabels.length > 0 ? likedStoneLabels.join(" · ") : "ยังไม่มีในใจ"}</p>
      </section>

      <section className="mt-4">
        <h3 className="text-sm font-bold text-zinc-500">พลอยที่เข้ากับเรื่องที่คุณมองหา</h3>
        <p className="mt-1 text-base font-semibold text-primary-700">{recommendedStones.map((s) => s.labelTh).join(" · ")}</p>
      </section>

      <section className="mt-4">
        <h3 className="text-sm font-bold text-zinc-500">ลักษณะพลอย</h3>
        <p className="mt-1 text-sm text-zinc-700">{CHARACTERISTIC_PLACEHOLDER}</p>
      </section>

      <section className="mt-4">
        <h3 className="text-sm font-bold text-zinc-500">ตามความเชื่อที่คนไทยนิยม</h3>
        <p className="mt-1 text-sm text-zinc-700">{BELIEF_PLACEHOLDER}</p>
      </section>

      {/* disclaimer คงที่ render ทุกผลลัพธ์เสมอ (design §4.3 slot 5) */}
      <p className="mt-4 rounded-md bg-zinc-50 px-3 py-2.5 text-xs text-zinc-500">{DISCLAIMER_PLACEHOLDER}</p>

      <div className="mt-5 flex flex-col gap-2">
        {/* C1 (design §11, ไม่บล็อก) — default ไป LINE OA ตามที่ footer เดิมของ
            (public)/layout.tsx ใช้อยู่แล้ว ไม่ลิงก์ไป /shop (F13: แคตตาล็อก
            เว็บคนละชุดกับของที่ขายในไลฟ์). */}
        <a
          href="https://line.me/R/ti/p/@3jsilver"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-primary-600 px-4 text-base font-medium text-white transition-colors hover:bg-primary-700"
        >
          คุยกับเราทาง LINE
        </a>

        {canUseShareApi ? (
          <Button variant="secondary" onClick={handleShare}>
            ชวนเพื่อนมาทำ
          </Button>
        ) : (
          <div className="flex flex-col gap-2">
            <a
              href={`https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(buildShareUrl())}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-zinc-300 px-4 text-base font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
            >
              แชร์ไปที่ LINE
            </a>
            <Button variant="secondary" onClick={handleCopyLink}>
              {copyState === "copied" ? "คัดลอกลิงก์แล้ว" : copyState === "error" ? "คัดลอกไม่สำเร็จ ลองใหม่" : "คัดลอกลิงก์"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function HoneypotField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  // L3 honeypot (design §5.2) — ซ่อนจากคนจริงด้วย CSS off-screen (ไม่ใช่
  // display:none/visibility:hidden ซึ่ง bot บางตัวรู้จักข้าม) + tabIndex=-1
  // (ไม่หยุดที่ช่องนี้ตอนกด Tab) + autoComplete=off + aria-hidden (screen
  // reader ไม่ประกาศ).
  return (
    <input
      type="text"
      name="hp"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      tabIndex={-1}
      autoComplete="off"
      aria-hidden="true"
      className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden"
    />
  );
}

function StepProgress({ current, total }: { current: number; total: number }) {
  return (
    <p className="text-xs font-medium text-zinc-400" aria-live="polite">
      ขั้นที่ {current} จาก {total}
    </p>
  );
}
