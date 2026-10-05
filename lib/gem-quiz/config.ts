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
//
// ============================================================================
// v2 (5 ต.ค. 69) — reconcile กับแพ็กเกจ UI/UX ภายนอก (design doc
// docs/3j-jewelry/analytics/design-gem-quiz-v2-reconcile.md §3/§4).
//
// พอร์ตมาจาก docs/3j-jewelry/analytics/gem-quiz-v2-handoff/data/quiz-config.json
// คำต่อคำ (ตัวเลขคะแนน/ลำดับพลอย/คำถาม/ตัวเลือก) — ไฟล์นั้นคือ fixture ของ oracle
// test ใน recommend.test.ts ด้วย ห้ามแก้ตัวเลขในไฟล์นี้โดยไม่แก้ fixture คู่กัน.
//
// เปลี่ยนจาก v1: 12 พลอย → 5 พลอยแท้ธรรมชาติ, คำถามแนะนำ 2 ข้อ (placeholder
// ไม่มีเนื้อหาจริง) → 4 ข้อ (birth_day/intention/feeling/jewelry_type เนื้อหา
// อนุมัติแล้วตาม design doc §9 O2), scoring แบบ generic score table → sum ของ
// 4 มิติเฉพาะเจาะจง (ดู recommend.ts)
//
// 🔴 ห้ามเพิ่ม priceGroup หรือข้อมูลราคา/กลุ่มราคา/ต้นทุนใดๆ ในไฟล์นี้ — ไฟล์นี้
// import เข้า client component ได้ (GemQuizClient.tsx) ใครก็เปิด DevTools เห็น
// field นี้ได้ทันที (security audit เดิม finding M1 ของ v1 — ยังมีผลเต็มกับ v2)
// price_group มีแค่ฝั่ง DB (gem_quiz_stone table) สำหรับ cross-tab ภายในเท่านั้น
// ============================================================================

export const QUIZ_VERSION = 2;

export type GemQuizSrc = "card" | "share" | "live" | "direct";
export const GEM_QUIZ_SRC_VALUES: readonly GemQuizSrc[] = ["card", "share", "live", "direct"];

/** รหัสพลอย 5 ตัวที่ยังเปิดใช้ใน v2 (gemOrder ของแพ็กเกจ — ลำดับนี้คือ
 * tie-break สุดท้ายของ recommend.ts: ชนะเมื่อคะแนนเท่ากันทุกมิติ, ascending). */
export type GemQuizStoneCode = "garnet" | "amethyst" | "citrine" | "peridot" | "blue_topaz";

export interface GemQuizStoneColors {
  readonly base: string;
  readonly light: string;
  readonly dark: string;
}

export interface GemQuizStoneConfig {
  code: GemQuizStoneCode;
  labelTh: string;
  /** ตัดเสมอกันสุดท้ายของ recommend.ts แบบ deterministic (gemOrder ascending)
   * — ต้องตรงกับ sort_order ที่ seed ไว้ใน supabase/migrations/0157_*.sql เป๊ะ. */
  sortOrder: number;
  nameEn: string;
  /** แกนความหมายหลักของพลอย (เช่น POWER/CALM) — ใช้แสดงผลเท่านั้น ไม่มีผลคะแนน */
  core: string;
  keywords: string;
  meaning: string;
  mood: string;
  colors: GemQuizStoneColors;
  // 🔴 ห้ามเพิ่ม priceGroup หรือข้อมูลราคา/กลุ่มราคาใดๆ ที่นี่ (ดูคำเตือนหัวไฟล์)
}

// 🔴 ต้องตรงกับ seed 5 แถวใน supabase/migrations/0157_gem_quiz_v2_five_stones.sql
// ทุกตัวอักษร (code/sortOrder) — RPC analytics.gem_quiz_submit ปฏิเสธรหัสที่ไม่มี
// จริง/ปิดใช้งานใน DB อยู่แล้ว (defense-in-depth) แต่ถ้าสองที่นี้ไม่ตรงกัน ผู้ใช้
// จะเจอ "รหัสพลอยไม่ถูกต้อง" ทั้งที่หน้าจอเลือกให้เอง — เปลี่ยนที่นี่ ต้องเปลี่ยน
// migration คู่กันเสมอ (ไม่มี single source of truth ข้าม TS/SQL ได้จริง).
export const GEM_QUIZ_STONES = [
  {
    code: "garnet",
    labelTh: "โกเมน",
    nameEn: "Garnet",
    core: "POWER",
    keywords: "พลัง · ความมั่นใจ · แรงผลักดัน",
    meaning: "พลัง ความกล้า และแรงผลักดัน",
    mood: "แดงเข้ม · มั่นใจ",
    sortOrder: 10,
    colors: { base: "#A3192B", light: "#E0566A", dark: "#5C0A16" },
  },
  {
    code: "amethyst",
    labelTh: "อเมทิสต์",
    nameEn: "Amethyst",
    core: "CALM",
    keywords: "ความสงบ · สมาธิ · ความชัดเจน",
    meaning: "ความสงบ สมาธิ และความสมดุล",
    mood: "ม่วง · สงบนิ่ง",
    sortOrder: 20,
    colors: { base: "#6E3FA6", light: "#AE88E0", dark: "#38195E" },
  },
  {
    code: "citrine",
    labelTh: "ซิทริน",
    nameEn: "Citrine",
    core: "ABUNDANCE",
    keywords: "โอกาส · ความสำเร็จ · พลังบวก",
    meaning: "โอกาส ความสำเร็จ และพลังบวก",
    mood: "เหลืองทอง · สดใส",
    sortOrder: 30,
    colors: { base: "#D99A2B", light: "#F6CF6E", dark: "#8C5A0E" },
  },
  {
    code: "peridot",
    labelTh: "เพอริดอท",
    nameEn: "Peridot",
    core: "RENEWAL",
    keywords: "การเติบโต · การเริ่มต้นใหม่ · การเปลี่ยนแปลง",
    meaning: "การเติบโต การเริ่มต้นใหม่ และการเปลี่ยนแปลง",
    mood: "เขียวอ่อน · สดชื่น",
    sortOrder: 40,
    colors: { base: "#7DA331", light: "#BCDB72", dark: "#476515" },
  },
  {
    code: "blue_topaz",
    labelTh: "บลูโทพาส",
    nameEn: "Blue Topaz",
    core: "CLARITY",
    keywords: "การสื่อสาร · ความชัดเจน · ความสงบ",
    meaning: "การสื่อสาร ความชัดเจน และการแสดงออก",
    mood: "ฟ้า · ใจเย็น",
    sortOrder: 50,
    colors: { base: "#2E86C6", light: "#86C8EE", dark: "#15527F" },
  },
] as const satisfies readonly GemQuizStoneConfig[];

export const GEM_QUIZ_STONE_CODES: readonly GemQuizStoneCode[] = GEM_QUIZ_STONES.map((s) => s.code);

/** code review S5: หา stone object จาก code ที่เดิมกระจาย 5 ที่ (throw/`!`/
 * fallback คนละแบบ) รวมเป็น lookup เดียว — type ปลอดภัยเพราะ key เป็น
 * GemQuizStoneCode (ไม่ใช่ string ทั่วไป) ไม่ต้อง throw/`!` ที่เรียกใช้เลย
 * ส่วนโค้ดที่ได้ code มาจากภายนอก (DB/URL) เป็น string ธรรมดา — ยังต้องเช็ค
 * `in` หรือ optional ก่อนอยู่ดีตามจุดนั้นๆ นี่แก้แค่จุดที่โค้ดเรียกด้วย
 * GemQuizStoneCode literal ที่รู้แน่นอนอยู่แล้วว่ามีจริง */
export const GEM_QUIZ_STONE_BY_CODE: Readonly<Record<GemQuizStoneCode, (typeof GEM_QUIZ_STONES)[number]>> =
  Object.fromEntries(GEM_QUIZ_STONES.map((s) => [s.code, s])) as Record<GemQuizStoneCode, (typeof GEM_QUIZ_STONES)[number]>;

/** gemOrder ของแพ็กเกจ — ลำดับ ascending ใช้เป็นตัวตัดเสมอสุดท้ายใน
 * recommend.ts (ยิ่ง index น้อยยิ่งชนะเมื่อคะแนนเท่ากันทุกมิติก่อนหน้า) —
 * recommend.ts ใช้ลำดับของ GEM_QUIZ_STONE_CODES array ตรงๆ (ไม่ได้อ่าน
 * sortOrder field เลย — field นั้นเป็นแค่สำเนาข้อมูลที่ DB เก็บไว้แสดงผล). */

/** Q4 "พลอยไหนดึงดูดคุณที่สุด" — เลือกได้ 0-3 ตัว เรียงตามอันดับที่แตะ
 * (B1 กลับมติอีกรอบ 5 ต.ค. 69 หลังทดสอบจริงบนเว็บ: ต้องมีตัวเลือก "ยังไม่แน่ใจ
 * แนะนำให้ฉัน" แบบเดียวกับ Q5 — เลือกแล้วส่ง liked=[] ระบบคำนวณจากวันเกิด/
 * เป้าหมาย/ความรู้สึกล้วนๆ MIN กลับเป็น 0 จาก 1 ที่เคาะไว้ตอนเช้า ดู
 * design-gem-quiz-v2-reconcile.md หัวไฟล์). */
export const MAX_LIKED_STONES = 3;
export const MIN_LIKED_STONES = 0;

export type GemQuizBirthDay = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";
export type GemQuizIntention = "love" | "wealth" | "career" | "confidence" | "calm" | "renewal";
export type GemQuizFeeling = "energy" | "calm" | "clarity" | "renew" | "open" | "advance";
export type GemQuizJewelryType = "ring" | "necklace" | "earring" | "bracelet" | "unknown";

export interface GemQuizOption {
  code: string;
  labelTh: string;
}

export interface GemQuizQuestion {
  /** key ใน answers jsonb — ต้องตรง regex ^[a-z][a-z0-9_]{0,31}$ (เหมือน RPC) */
  code: string;
  labelTh: string;
  options: readonly GemQuizOption[];
}

// Q1/Q2/Q3/Q5 ของแพ็กเกจ (Q4 = liked_stone_codes, ไม่ใช่ key ใน answers — design
// doc §3.1: "answers รับแค่ string ต่อ key เท่านั้น array ใส่ไม่ได้ ⇒ Q4 อยู่ใน
// liked"). เนื้อหาคำถาม/ตัวเลือกอนุมัติแล้ว (design doc §9 O2 — เจ้าของส่ง
// แพ็กเกจมาเองนับเป็นการอนุมัติ ไม่ต้องรอ brand-strategist ตรวจซ้ำ).
export const GEM_QUIZ_QUESTIONS = [
  {
    code: "birth_day",
    labelTh: "คุณเกิดวันอะไร?",
    options: [
      { code: "sun", labelTh: "อาทิตย์" },
      { code: "mon", labelTh: "จันทร์" },
      { code: "tue", labelTh: "อังคาร" },
      { code: "wed", labelTh: "พุธ" },
      { code: "thu", labelTh: "พฤหัสบดี" },
      { code: "fri", labelTh: "ศุกร์" },
      { code: "sat", labelTh: "เสาร์" },
    ],
  },
  {
    code: "intention",
    labelTh: "วันนี้คุณอยากเสริมเรื่องอะไรเป็นพิเศษ?",
    options: [
      { code: "love", labelTh: "ความรัก & เสน่ห์" },
      { code: "wealth", labelTh: "การเงิน & โอกาส" },
      { code: "career", labelTh: "งาน & ความสำเร็จ" },
      { code: "confidence", labelTh: "ความมั่นใจ & พลังใจ" },
      { code: "calm", labelTh: "ความสงบ & การปกป้อง" },
      { code: "renewal", labelTh: "การเริ่มต้นใหม่ & การเปลี่ยนแปลง" },
    ],
  },
  {
    code: "feeling",
    labelTh: "วันนี้คุณรู้สึกอย่างไรที่สุด?",
    options: [
      { code: "energy", labelTh: "อยากมีพลัง ไม่ท้อ" },
      { code: "calm", labelTh: "อยากใจนิ่ง ไม่วุ่นวาย" },
      { code: "clarity", labelTh: "คิดเยอะ อยากได้ความชัดเจน" },
      { code: "renew", labelTh: "รู้สึกอยากเริ่มต้นใหม่" },
      { code: "open", labelTh: "อยากเปิดใจ มีความสัมพันธ์ที่ดี" },
      { code: "advance", labelTh: "อยากก้าวหน้า คว้าโอกาส" },
    ],
  },
  {
    code: "jewelry_type",
    labelTh: "วันนี้คุณอยากใส่แบบไหน?",
    options: [
      { code: "ring", labelTh: "แหวน" },
      { code: "necklace", labelTh: "สร้อย / จี้" },
      { code: "earring", labelTh: "ต่างหู" },
      { code: "bracelet", labelTh: "กำไล" },
      { code: "unknown", labelTh: "ยังไม่แน่ใจ — แนะนำให้ฉัน" },
    ],
  },
] as const satisfies readonly GemQuizQuestion[];

/** {questionCode: {optionCode: productTh}} ของ jewelry_type — ใช้ประกอบชื่อ
 * สินค้า/placement ใน result.ts (English name มาจาก GemQuizJewelryTypeConfig.en). */
export interface GemQuizJewelryTypeConfig {
  code: GemQuizJewelryType;
  labelTh: string;
  /** ชื่อไทยสั้นของประเภทเครื่องประดับ ("แหวน"/"จี้"/...) ไม่มีค่าสำหรับ "unknown" */
  productTh?: string;
  en?: string;
}

export const GEM_QUIZ_JEWELRY_TYPES = [
  { code: "ring", labelTh: "แหวน", productTh: "แหวน", en: "Ring" },
  { code: "necklace", labelTh: "สร้อย / จี้", productTh: "จี้", en: "Pendant" },
  { code: "earring", labelTh: "ต่างหู", productTh: "ต่างหู", en: "Earrings" },
  { code: "bracelet", labelTh: "กำไล", productTh: "กำไล", en: "Bracelet" },
  { code: "unknown", labelTh: "ยังไม่แน่ใจ — แนะนำให้ฉัน" },
] as const satisfies readonly GemQuizJewelryTypeConfig[];

// ============================================================================
// Scoring — พอร์ตจาก rank() ใน design/Quiz.dc.html (ดู recommend.ts สำหรับ
// comparator/tie-break เต็ม) ตัวเลขทุกตัวต้องตรง quiz-config.json เป๊ะ
// ============================================================================

/** DAYS[day].s ของ Quiz.dc.html — คะแนนตามวันเกิด (ให้สูงสุด 2 พลอยต่อวัน) */
export const GEM_QUIZ_BIRTH_DAY_SCORES: Readonly<Record<GemQuizBirthDay, Readonly<Partial<Record<GemQuizStoneCode, number>>>>> = {
  sun: { garnet: 3, citrine: 2 },
  mon: { amethyst: 3, blue_topaz: 2 },
  tue: { garnet: 3, peridot: 2 },
  wed: { blue_topaz: 3, peridot: 2 },
  thu: { citrine: 3, amethyst: 2 },
  fri: { peridot: 3, blue_topaz: 2 },
  sat: { amethyst: 3, garnet: 2 },
};

/** INTENTS[intent].p / .s ของ Quiz.dc.html + points.primary/secondary ของ
 * quiz-config.json (primary=8, secondary=5). */
export const GEM_QUIZ_INTENTION_POINTS = { primary: 8, secondary: 5 } as const;

export interface GemQuizIntentionWeights {
  primary: readonly GemQuizStoneCode[];
  secondary: readonly GemQuizStoneCode[];
}

export const GEM_QUIZ_INTENTIONS: Readonly<Record<GemQuizIntention, GemQuizIntentionWeights>> = {
  love: { primary: ["garnet", "peridot", "blue_topaz"], secondary: ["amethyst"] },
  wealth: { primary: ["citrine", "garnet"], secondary: ["peridot"] },
  career: { primary: ["garnet", "citrine"], secondary: ["blue_topaz"] },
  confidence: { primary: ["garnet", "citrine"], secondary: ["peridot"] },
  calm: { primary: ["amethyst", "blue_topaz"], secondary: ["peridot"] },
  renewal: { primary: ["peridot", "citrine"], secondary: ["garnet"] },
};

/** FEELS[feel].m ของ Quiz.dc.html + points.match ของ quiz-config.json (=7). */
export const GEM_QUIZ_FEELING_MATCH_POINTS = 7 as const;

export const GEM_QUIZ_FEELINGS: Readonly<Record<GemQuizFeeling, readonly GemQuizStoneCode[]>> = {
  energy: ["garnet", "citrine"],
  calm: ["amethyst", "blue_topaz"],
  clarity: ["amethyst", "blue_topaz"],
  renew: ["peridot", "citrine"],
  open: ["peridot", "blue_topaz", "garnet"],
  advance: ["citrine", "garnet", "peridot"],
};

/** pointsByRank ของ q4_preference ใน quiz-config.json — index0 = liked[0]
 * (อันดับ 1 ที่แตะ) ให้คะแนนสูงสุด ยิ่งอันดับหลังยิ่งได้น้อย เกินอันดับ 3 = 0. */
export const GEM_QUIZ_PREFERENCE_POINTS_BY_RANK: readonly number[] = [6, 4, 2];

// ลำดับตัดเสมอ (intention → feeling → preference → birth_day) ตาม
// tieBreakOrder ของ quiz-config.json — comparator จริงอยู่ที่ recommend.ts
// เขียนเป็น field access ตรงๆ ตามที่ oracle ของแพ็กเกจทำ ไม่มี export แยก
// เพราะไม่มีที่อื่นอ่านค่านี้ (code review N1 — ของเดิมเป็น dead export)

// ============================================================================
// Result content — พอร์ตจาก renderVals() ของ Quiz.dc.html (ดู result.ts)
// ============================================================================

/** DEFAULT_TYPE ของ Quiz.dc.html — ใช้เมื่อ jewelry_type = "unknown" */
export const GEM_QUIZ_DEFAULT_JEWELRY: Readonly<Record<GemQuizStoneCode, GemQuizJewelryType>> = {
  garnet: "ring",
  amethyst: "ring",
  citrine: "ring",
  peridot: "ring",
  blue_topaz: "necklace",
};

export interface GemQuizRingFinger {
  placement: string;
  why: string;
}

/** FINGER ของ Quiz.dc.html — ใช้เมื่อประเภทเครื่องประดับ (จริงหรือ default) = ring */
export const GEM_QUIZ_RING_FINGER: Readonly<Record<GemQuizStoneCode, GemQuizRingFinger>> = {
  garnet: { placement: "แหวนที่นิ้วชี้", why: "การตัดสินใจ การนำทาง และการลงมือทำ" },
  amethyst: { placement: "แหวนที่นิ้วกลาง", why: "ความมั่นคง ขอบเขต และความสมดุล" },
  citrine: { placement: "แหวนที่นิ้วชี้", why: "การเติบโต ทิศทาง และการขยายโอกาส" },
  peridot: { placement: "แหวนที่นิ้วนาง", why: "การเติบโตของตัวเอง การเริ่มต้นใหม่ และความสัมพันธ์" },
  blue_topaz: { placement: "แหวนที่นิ้วก้อย", why: "การสื่อสาร การแสดงออก และการเจรจา" },
};

/** PLACE ของ Quiz.dc.html — ใช้เมื่อประเภท (จริงหรือ default) ไม่ใช่ ring */
export const GEM_QUIZ_OTHER_PLACEMENT: Readonly<Record<"necklace" | "earring" | "bracelet", string>> = {
  necklace: "สร้อยระดับอก ให้พลอยอยู่กลางลุค",
  earring: "ต่างหูทั้งสองข้าง ใกล้ใบหน้า",
  bracelet: "กำไลที่ข้อมือ",
};

export const GEM_QUIZ_HAND_NOTE = "ใส่ในมือที่คุณรู้สึกถนัดและสบายที่สุด" as const;

/** ข้อความ "hand" ของ renderVals() เมื่อประเภท (จริงหรือ default) ไม่ใช่
 * ring/bracelet (คือ necklace/earring) — ไม่มีใน quiz-config.json ชั้นบนสุด
 * แต่มีอยู่ใน <script> ของ Quiz.dc.html เอง (แหล่งความจริงของ logic ผลลัพธ์). */
export const GEM_QUIZ_LENGTH_FIT_NOTE = "เลือกความยาวและขนาดที่ใส่สบายตลอดวัน" as const;

export interface GemQuizPair {
  gems: readonly [GemQuizStoneCode, GemQuizStoneCode];
  title: string;
  th: string;
  fit: string;
}

/** PAIRS ของ Quiz.dc.html — ทุกพลอยปรากฏอย่างน้อย 1 pair เสมอ (invariant ที่
 * result.ts พึ่งพา: fallback find ตัวที่ 2 ต้องเจอเสมอ ไม่มีทาง undefined) */
export const GEM_QUIZ_PAIRS: readonly GemQuizPair[] = [
  { gems: ["garnet", "citrine"], title: "Power + Abundance", th: "พลัง + ความอุดมสมบูรณ์", fit: "งาน · ธุรกิจ · โอกาส · แรงจูงใจ" },
  { gems: ["amethyst", "blue_topaz"], title: "Calm + Clarity", th: "ความสงบ + ความชัดเจน", fit: "โฟกัส · การสื่อสาร · การนำเสนอ · สมดุลทางอารมณ์" },
  { gems: ["peridot", "citrine"], title: "Renewal + Abundance", th: "การเริ่มต้นใหม่ + ความอุดมสมบูรณ์", fit: "เริ่มต้นใหม่ · เติบโตในงาน · โอกาสใหม่" },
  { gems: ["garnet", "peridot"], title: "Power + Renewal", th: "พลัง + การเริ่มต้นใหม่", fit: "เริ่มสิ่งใหม่ · เติบโต · ความมั่นใจ" },
  { gems: ["amethyst", "peridot"], title: "Calm + Renewal", th: "ความสงบ + การเริ่มต้นใหม่", fit: "รีเซ็ต · ปล่อยวาง · บทใหม่" },
];

/** disclaimer ของ quiz-config.json — render ทุกผลลัพธ์ (design doc §5 "หน้าผล") */
export const GEM_QUIZ_DISCLAIMER =
  "ผลลัพธ์นี้จัดทำขึ้นเพื่อความเชื่อส่วนบุคคล และใช้เป็นแนวทางในการเลือกเครื่องประดับเพื่อเสริมความมั่นใจเท่านั้น " +
  "ความหมายของพลอยเป็นการตีความเชิงสัญลักษณ์ ไม่สามารถรับประกันผลลัพธ์หรือการเปลี่ยนแปลงที่เกิดขึ้นจริงได้";

/** GemQuizAnswers — shape ของ answers jsonb (questionCode -> optionCode). v2:
 * 4 key บังคับ (birth_day/intention/feeling/jewelry_type) — validate.ts บังคับ
 * ว่าต้องมีครบทุก key ที่ GEM_QUIZ_QUESTIONS ต้องการ. */
export type GemQuizAnswers = Record<string, string>;
