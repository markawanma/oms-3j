// lib/gem-quiz/config.ts
//
// 🔴 กฎโครงสร้างที่สำคัญที่สุดของ lib/gem-quiz/** (design doc §1.2 — ไม่ใช่
// วินัย เป็นช่องโหว่จริงถ้าละเมิด):
//
//   ทุกไฟล์ใต้ lib/gem-quiz/** และ app/(quiz)/** ห้าม `import` ไฟล์ที่มี
//   "use server" (รวม lib/actions/**) เด็ดขาด ไม่ว่าทางตรงหรือทางอ้อม
//
// เหตุผล: /gem-quiz เป็นหน้า exempt จาก auth gate (middleware.ts ไม่รันเลยกับ
// path นี้). ถ้าหน้านี้ import ไฟล์ "use server" ใดๆ เข้ามาในโมดูลกราฟของมัน —
// export ทุกตัวในไฟล์นั้นจะกลายเป็น Server Action ที่ "ขึ้นทะเบียน" อยู่ใน
// worker ของหน้านี้ไปด้วย (แม้จะไม่ได้เรียกใช้ตรงๆ) และ Next 15.5.25 จะรัน
// action ที่อยู่ใน worker ของหน้า exempt แดงๆ โดยไม่ผ่าน middleware เลย — เหลือ
// ด่านเดียวคือ requireOwnerAdmin() ภายใน action นั้น ซึ่งหน้าสาธารณะไม่มี
// session ให้ผ่านอยู่แล้ว (ดูรายละเอียดเต็มใน design doc §1.2/F3).
//
// ⇒ ทางเขียนข้อมูลของฟีเจอร์นี้ทางเดียวคือ fetch('/api/gem-quiz/submit') —
// ไม่มี Server Action ที่ไหนในฟีเจอร์นี้เลย. ไฟล์นี้และทุกไฟล์พี่น้องในโฟลเดอร์นี้
// จึงต้องเป็น "pure" TS module ที่ import ได้ปลอดภัยทั้งจาก client component
// (app/(quiz)/gem-quiz/GemQuizClient.tsx) และจาก route handler
// (app/api/gem-quiz/submit/route.ts) — ไม่มี "use server", ไม่มี "use client",
// ไม่มี side-effect ตอน import.
//
// code-reviewer: grep หา `use server` และ `lib/actions` ใต้ lib/gem-quiz/ และ
// app/(quiz)/ ต้องว่างเสมอ (design §1.2).

export const QUIZ_VERSION = 1;

export type GemQuizSrc = "card" | "share" | "live" | "direct";
export const GEM_QUIZ_SRC_VALUES: readonly GemQuizSrc[] = ["card", "share", "live", "direct"];

export interface GemQuizStoneConfig {
  code: string;
  labelTh: string;
  /** cross-tab ภายในเท่านั้น (design §3.1) — ห้ามแสดงในหน้าสาธารณะที่ไหนเลย. */
  priceGroup: 1 | 2;
  /** ตัดเสมอกันของ recommend.ts แบบ deterministic (design §4.4) — ต้องตรงกับ
   * sort_order ที่ seed ไว้ใน supabase/migrations/0154_gem_quiz.sql §1 เป๊ะ. */
  sortOrder: number;
}

// 🔴 ต้องตรงกับ seed 12 แถวใน supabase/migrations/0154_gem_quiz.sql §1 ทุก
// ตัวอักษร (code/priceGroup/sortOrder) — RPC analytics.gem_quiz_submit ปฏิเสธ
// รหัสที่ไม่มีจริงใน DB อยู่แล้ว (defense-in-depth) แต่ถ้าสองที่นี้ไม่ตรงกัน
// ผู้ใช้จะเจอ "รหัสพลอยไม่ถูกต้อง" ทั้งที่หน้าจอเลือกให้เอง — เปลี่ยนที่นี่ ต้อง
// เปลี่ยน migration คู่กันเสมอ (ไม่มี single source of truth ข้าม TS/SQL ได้จริง
// ตามที่ design doc §9 ยอมรับ trade-off ไว้).
export const GEM_QUIZ_STONES: readonly GemQuizStoneConfig[] = [
  { code: "blue_topaz", labelTh: "บลูโทพาส", priceGroup: 1, sortOrder: 10 },
  { code: "amethyst", labelTh: "อเมทิส", priceGroup: 1, sortOrder: 20 },
  { code: "peridot", labelTh: "เพอริดอท", priceGroup: 1, sortOrder: 30 },
  { code: "citrine", labelTh: "ซิทริน", priceGroup: 1, sortOrder: 40 },
  { code: "garnet", labelTh: "โกเมน", priceGroup: 1, sortOrder: 50 },
  { code: "pearl", labelTh: "มุก", priceGroup: 2, sortOrder: 60 },
  { code: "nil", labelTh: "นิล", priceGroup: 2, sortOrder: 70 },
  { code: "ruby", labelTh: "ทับทิม", priceGroup: 2, sortOrder: 80 },
  { code: "sapphire", labelTh: "ไพลิน", priceGroup: 2, sortOrder: 90 },
  { code: "busarakham", labelTh: "บุษราคัม", priceGroup: 2, sortOrder: 100 },
  { code: "iolite", labelTh: "ไอโอไลท์", priceGroup: 2, sortOrder: 110 },
  { code: "kyanite", labelTh: "ไคยาไนท์", priceGroup: 2, sortOrder: 120 },
];

export const GEM_QUIZ_STONE_CODES: readonly string[] = GEM_QUIZ_STONES.map((s) => s.code);

/** Q1 "ชอบพลอยอะไร" — เลือกได้สูงสุดเท่านี้ (B1 เคาะแล้ว 4 ต.ค. 69: 3 ตัว +
 * ตัวเลือก "ยังไม่มีในใจ" = array ว่าง, ไม่ใช่ sentinel code แยก). */
export const MAX_LIKED_STONES = 3;

export interface GemQuizOption {
  code: string;
  /** 🔴 placeholder — ยังไม่ผ่าน 3 ด่าน content (ข้อเท็จจริง/แบรนด์/ความเสี่ยง,
   * ดู skill 3j-content-orchestration) ห้าม deploy ขึ้น prod ด้วยข้อความนี้. */
  labelTh: string;
}

export interface GemQuizQuestion {
  /** key ใน answers jsonb — ต้องตรง regex ^[a-z][a-z0-9_]{0,31}$ (เหมือน RPC) */
  code: string;
  /** 🔴 placeholder — รอ copywriter (B3, design §11) */
  labelTh: string;
  options: readonly GemQuizOption[];
}

// 🔴🔴🔴 PLACEHOLDER — ห้าม deploy ขึ้น prod ด้วยเนื้อหานี้ 🔴🔴🔴
//
// B3 (คำถามเปิดของ design doc) ยังไม่เคาะ: เนื้อหาคำถามแนะนำจริง (ข้อ 1 =
// เรื่อง/ความหมายที่อยากได้, ข้อ 2 = วันเกิดแบบอาทิตย์-เสาร์) ต้องผ่าน
// copywriter + 3 ด่าน content ก่อน (ข้อเท็จจริงต้องมี URL จาก docs-researcher ·
// กฎแบรนด์ 3j-brand-and-market §5 ห้ามรับประกันผล/ห้ามมุมพลอยเสก · ความเสี่ยง
// สุขภาพ/การเงิน-โชคลาภ ห้ามทีมตอบเอง).
//
// รหัสคำถาม/ตัวเลือกด้านล่างเป็นโครง "ว่าง" ที่ตั้งใจให้เป็นกลางที่สุด
// (opt_a/opt_b/... ไม่ใช่ wealth/love/health) เพื่อไม่ให้ backend เผลอไปเคาะมุม
// เนื้อหาที่เป็นงานของทีม content แทน — คงไว้สำหรับ unit test ของ recommend.ts
// ให้มีโครง 2 คำถาม x ตัวเลือกจริงให้ไล่ combination ได้ (§4.4) เท่านั้น
//
// ข้อ 2 (วันเกิด) ใส่ 7 วันจริงไว้แล้วเพราะเป็น "วันในสัปดาห์" ไม่ใช่เนื้อหาที่
// ต้องผ่าน 3 ด่าน (ข้อเท็จจริงเป็นกลาง ไม่ใช่เคลม) — label ยังเป็นภาษาไทยปกติได้
export const GEM_QUIZ_QUESTIONS: readonly GemQuizQuestion[] = [
  {
    code: "q_intent",
    labelTh: "[รอ copy จริง — B3] อยากได้พลอยไว้เรื่องอะไร",
    options: [
      { code: "opt_a", labelTh: "[รอ copy จริง — ตัวเลือก A]" },
      { code: "opt_b", labelTh: "[รอ copy จริง — ตัวเลือก B]" },
      { code: "opt_c", labelTh: "[รอ copy จริง — ตัวเลือก C]" },
      { code: "opt_d", labelTh: "[รอ copy จริง — ตัวเลือก D]" },
    ],
  },
  {
    code: "q_birth_dow",
    labelTh: "เกิดวันไหน",
    options: [
      { code: "sun", labelTh: "วันอาทิตย์" },
      { code: "mon", labelTh: "วันจันทร์" },
      { code: "tue", labelTh: "วันอังคาร" },
      { code: "wed", labelTh: "วันพุธ" },
      { code: "thu", labelTh: "วันพฤหัสบดี" },
      { code: "fri", labelTh: "วันศุกร์" },
      { code: "sat", labelTh: "วันเสาร์" },
    ],
  },
];

/** {questionCode: {optionCode: {stoneCode: weight}}} — ตารางคะแนนสำหรับ
 * lib/gem-quiz/recommend.ts. 🔴 เป็นโครง placeholder เช่นเดียวกับคำถามด้านบน —
 * ตัวเลขน้ำหนักเหล่านี้เป็นค่าสมมติเพื่อให้ recommend.ts มีอะไรให้คำนวณ/ทดสอบ
 * (deterministic, ครอบ combination ได้จริง) ไม่ใช่ความเชื่อ "วันเกิด → พลอย"
 * จริงของทีม content — การผูกวันเกิดกับพลอยเป็นเนื้อหาเชิงความเชื่อ (design §4.3
 * slot 4 "ตามความเชื่อที่คนไทยนิยม") ต้องผ่าน 3 ด่าน content ก่อนใช้จริง เช่นกัน
 * (brand-strategist/docs-researcher ชี้ขาด ไม่ใช่ backend-dev).
 */
export const GEM_QUIZ_SCORE_TABLE: Readonly<Record<string, Readonly<Record<string, Readonly<Record<string, number>>>>>> = {
  q_intent: {
    opt_a: { blue_topaz: 2, amethyst: 1, pearl: 2 },
    opt_b: { citrine: 2, garnet: 1, ruby: 2 },
    opt_c: { peridot: 2, sapphire: 2, iolite: 1 },
    opt_d: { nil: 2, kyanite: 1, busarakham: 2 },
  },
  q_birth_dow: {
    sun: { ruby: 2 },
    mon: { pearl: 2 },
    tue: { garnet: 1, kyanite: 1 },
    wed: { peridot: 1, amethyst: 1 },
    thu: { busarakham: 2 },
    fri: { blue_topaz: 1, citrine: 1 },
    sat: { sapphire: 2, nil: 1 },
  },
};

/** GemQuizAnswers — shape ของ answers jsonb (questionCode -> optionCode). */
export type GemQuizAnswers = Record<string, string>;
