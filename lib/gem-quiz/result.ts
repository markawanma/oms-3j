// lib/gem-quiz/result.ts
//
// buildResultView() — พอร์ตจาก renderVals() ใน
// docs/3j-jewelry/analytics/gem-quiz-v2-handoff/design/Quiz.dc.html (ส่วนที่
// เกี่ยวกับหน้าผลลัพธ์, บรรทัด ~600-662) เป็น pure TS. ใช้ร่วมกันทั้ง client
// (ResultScreen แสดงผลทันทีหลังตอบคำถามครบ) และเป็นเอกสารอ้างอิงเดียวที่นิยาม
// "ผลลัพธ์หน้าจอ" ของฟีเจอร์นี้ (ไม่มี import จาก "use server"/lib/actions —
// กฎ §1.2, ดู config.ts หัวไฟล์).
//
// 🔴 V13 ของ design doc: ห้ามพอร์ต fallback `const ans = complete ? a : DEMO`
// ของต้นฉบับ — ถ้าคำตอบไม่ครบ buildResultView() ต้อง throw ไม่ใช่โชว์ข้อมูล
// DEMO ปลอมแบบที่ mockup ทำ (จะหลอกผู้ใช้ว่าระบบคำนวณจากคำตอบของเขาจริง
// ทั้งที่ไม่ใช่ — ยังไม่เด้ง landing ให้ด้วย).
//
// Products: ชื่อเท่านั้น ห้ามมีราคา (design §5 "หน้าผล" — ตัด ฿[ราคา] ของ
// แพ็กเกจทิ้งเพราะยังไม่ผ่าน 3 ด่าน content, ลาย→SKU map ไม่ได้, ต่อ catalog
// ตรงๆ เสี่ยงซ้ำ finding M1 ของ v1).
import {
  GEM_QUIZ_DEFAULT_JEWELRY,
  GEM_QUIZ_DISCLAIMER,
  GEM_QUIZ_HAND_NOTE,
  GEM_QUIZ_JEWELRY_TYPES,
  GEM_QUIZ_LENGTH_FIT_NOTE,
  GEM_QUIZ_OTHER_PLACEMENT,
  GEM_QUIZ_PAIRS,
  GEM_QUIZ_QUESTIONS,
  GEM_QUIZ_RING_FINGER,
  GEM_QUIZ_STONE_BY_CODE,
  type GemQuizJewelryType,
  type GemQuizJewelryTypeConfig,
  type GemQuizPair,
  type GemQuizStoneCode,
  type GemQuizStoneConfig,
} from "./config";
import { rankGems } from "./recommend";

export interface GemQuizResultInput {
  answers: {
    birthDay: string;
    intention: string;
    feeling: string;
    jewelryType: string;
  };
  /** ลำดับมีความหมาย — index 0 = พลอยที่ชอบอันดับ 1. ต้องมี 1-3 ตัว (MIN/MAX_LIKED_STONES) */
  likedStoneCodes: readonly string[];
  /** ผู้ใช้แตะ "ดูพลอยทางเลือก" บนหน้าผล — ถ้าไม่อยู่ใน top 3 จะถูกเมินและใช้
   * rank 1 แทน (เหมือน renderVals() เดิม: `top.indexOf(s.focus) >= 0 ? s.focus : top[0]`) */
  focusStoneCode?: string | null;
}

export interface GemQuizResultHero {
  stoneCode: GemQuizStoneCode;
  isAlternative: boolean;
  heroA: "YOUR GEM" | "ANOTHER GEM";
  heroB: "FOR TODAY";
  heroSub: string;
  line2: string;
  prefNote: string;
  intentionLabel: string;
  feelingLabel: string;
  birthDayLabel: string;
  /** ชื่อพลอยที่ชอบทั้งหมด (ตามลำดับ) คั่นด้วย ", " — สำหรับสรุปคำตอบ Q4 */
  likedLabels: string;
  /** label ของคำตอบ jewelry_type ที่ผู้ใช้เลือกจริง (อาจเป็น "unknown") */
  jewelryTypeChosenLabel: string;
}

export interface GemQuizResultPairing {
  heroStoneCode: GemQuizStoneCode;
  pairStoneCode: GemQuizStoneCode;
  title: string;
  th: string;
  fit: string;
}

export interface GemQuizResultAlternative {
  stoneCode: GemQuizStoneCode;
  label: string;
}

export interface GemQuizResultHowToWear {
  note: string;
  title: string;
  titleTh: string;
  place: string;
  hand: string;
  why: string;
}

export interface GemQuizResultProduct {
  stoneCode: GemQuizStoneCode;
  nameEn: string;
  nameTh: string;
}

export interface GemQuizResultView {
  hero: GemQuizResultHero;
  pairing: GemQuizResultPairing;
  alternatives: readonly GemQuizResultAlternative[];
  howToWear: GemQuizResultHowToWear;
  products: readonly GemQuizResultProduct[];
  disclaimer: string;
}

// code review S5: ใช้ GEM_QUIZ_STONE_BY_CODE (config.ts) แทน .find() ตรงๆ —
// รับ string ธรรมดาเพราะ input มาจาก likedStoneCodes/recommended ที่ยัง
// ไม่ narrow เป็น GemQuizStoneCode ตอน compile-time (ต่าง จาก Landing.tsx ที่
// code เป็น literal รู้แน่นอนอยู่แล้ว) ยัง throw เหมือนเดิมถ้าไม่เจอจริง —
// ต้องเช็ค hasOwnProperty ก่อน (security audit L1 เจอกับดักเดียวกันนี้ใน
// recommend.ts มาแล้ว: code="constructor" คืน Object constructor function
// แทน undefined ถ้า index ตรงๆ โดยไม่กัน)
function getStoneConfig(code: string): GemQuizStoneConfig {
  const table = GEM_QUIZ_STONE_BY_CODE as Readonly<Record<string, GemQuizStoneConfig>>;
  const stone = Object.prototype.hasOwnProperty.call(table, code) ? table[code] : undefined;
  if (!stone) {
    throw new Error(`buildResultView: ไม่พบรหัสพลอย "${code}" ใน GEM_QUIZ_STONES`);
  }
  return stone;
}

function getOptionLabel(questionCode: string, optionCode: string): string {
  const question = GEM_QUIZ_QUESTIONS.find((q) => q.code === questionCode);
  const option = question?.options.find((o) => o.code === optionCode);
  if (!option) {
    throw new Error(`buildResultView: "${optionCode}" ไม่ใช่ตัวเลือกของคำถาม "${questionCode}"`);
  }
  return option.labelTh;
}

function getJewelryTypeConfig(code: string): GemQuizJewelryTypeConfig {
  const type = GEM_QUIZ_JEWELRY_TYPES.find((t) => t.code === code);
  if (!type) {
    throw new Error(`buildResultView: "${code}" ไม่ใช่ประเภทเครื่องประดับที่รู้จัก`);
  }
  return type;
}

/** หา pair ที่มี pid อยู่ และอีกตัวอยู่ใน others ก่อน (ให้ pairing สอดคล้องกับ
 * ทางเลือกอันดับ 2/3 จริง) ถ้าไม่เจอ fallback เป็น pair แรกที่มี pid อยู่เลย —
 * GEM_QUIZ_PAIRS ครอบทุกพลอยอย่างน้อย 1 pair เสมอ (invariant ที่พิสูจน์ไว้ใน
 * config.ts) จึง fallback ไม่มีทาง undefined ตราบใดที่ pid เป็นพลอยที่มีจริง. */
function findPair(pid: GemQuizStoneCode, others: readonly GemQuizStoneCode[]): GemQuizPair {
  const preferred = GEM_QUIZ_PAIRS.find(
    (pair) => pair.gems.includes(pid) && others.some((other) => pair.gems.includes(other))
  );
  const fallback = preferred ?? GEM_QUIZ_PAIRS.find((pair) => pair.gems.includes(pid));
  if (!fallback) {
    throw new Error(`buildResultView: ไม่พบ pairing สำหรับพลอย "${pid}" (ขัดกับ invariant ของ GEM_QUIZ_PAIRS)`);
  }
  return fallback;
}

/** ประกอบหน้าผลลัพธ์ทั้งหมด — ต้องเรียกเมื่อคำตอบครบเท่านั้น (ทุก key ใน
 * answers ไม่ว่าง) ไม่ครบ = throw (ห้าม fallback เป็นค่าสมมติ — V13).
 * likedStoneCodes ว่างได้ตามปกติ (กลับมติ 5 ต.ค. 69 — "ยังไม่แน่ใจ แนะนำให้ฉัน"
 * ที่ Q4 ส่ง liked=[] มา ไม่ใช่ error — ดู design-gem-quiz-v2-reconcile.md). */
export function buildResultView(input: GemQuizResultInput): GemQuizResultView {
  const { answers, likedStoneCodes } = input;

  if (!answers.birthDay || !answers.intention || !answers.feeling || !answers.jewelryType) {
    throw new Error("buildResultView: answers ไม่ครบ (ต้องมี birthDay/intention/feeling/jewelryType ทั้งหมด)");
  }

  const ranked = rankGems({
    birthDay: answers.birthDay,
    intention: answers.intention,
    feeling: answers.feeling,
    likedStoneCodes,
  });
  const top3 = ranked.slice(0, 3).map((r) => r.code);
  const rank1 = top3[0];

  const pid = input.focusStoneCode && top3.includes(input.focusStoneCode as GemQuizStoneCode)
    ? (input.focusStoneCode as GemQuizStoneCode)
    : rank1;
  const isAlternative = pid !== rank1;
  const others = top3.filter((code) => code !== pid);

  const heroStone = getStoneConfig(pid);

  // กลับมติ 5 ต.ค. 69: likedStoneCodes ว่างได้แล้ว ("ยังไม่แน่ใจ แนะนำให้ฉัน")
  // — ต้องมี prefNote เคสที่ 4 แยกจาก 3 เคสเดิม (fav เป็น rank1 / อยู่ใน top3 /
  // ไม่อยู่ใน top3) ที่สมมติว่ามี fav เสมอ
  let prefNote: string;
  if (likedStoneCodes.length === 0) {
    prefNote = `คุณให้ 3J เลือกพลอยให้ตามวันเกิด เป้าหมาย และความรู้สึกของคุณวันนี้`;
  } else {
    const fav = likedStoneCodes[0] as GemQuizStoneCode;
    const favStone = getStoneConfig(fav);
    if (fav === pid) {
      prefNote = `และ ${heroStone.nameEn} ก็เป็นพลอยที่คุณเลือกเป็นอันดับแรกด้วย`;
    } else if (top3.includes(fav)) {
      prefNote = `คุณชอบ ${favStone.nameEn} เป็นพิเศษ และวันนี้ ${favStone.nameEn} ก็เป็นหนึ่งในตัวเลือกที่เหมาะกับคุณเช่นกัน`;
    } else {
      prefNote = `คุณชอบ ${favStone.nameEn} เป็นพิเศษ — สามารถใส่คู่กับ ${heroStone.nameEn} ได้ตามสไตล์ที่คุณชอบ`;
    }
  }

  const hero: GemQuizResultHero = {
    stoneCode: pid,
    isAlternative,
    heroA: isAlternative ? "ANOTHER GEM" : "YOUR GEM",
    heroB: "FOR TODAY",
    heroSub: isAlternative ? "พลอยทางเลือกสำหรับวันนี้" : "พลอยประจำวันของคุณ",
    line2: isAlternative
      ? `${heroStone.nameEn} เป็นอีกหนึ่งตัวเลือกที่ 3J แนะนำ เพราะในเชิงสัญลักษณ์ ${heroStone.nameEn} สื่อถึง${heroStone.meaning}`
      : `3J จึงแนะนำ ${heroStone.nameEn} เป็นพลอยประจำวันนี้ เพราะในเชิงสัญลักษณ์ ${heroStone.nameEn} สื่อถึง${heroStone.meaning}`,
    prefNote,
    intentionLabel: getOptionLabel("intention", answers.intention),
    feelingLabel: getOptionLabel("feeling", answers.feeling),
    birthDayLabel: getOptionLabel("birth_day", answers.birthDay),
    likedLabels:
      likedStoneCodes.length > 0 ? likedStoneCodes.map((code) => getStoneConfig(code).nameEn).join(", ") : "ให้ระบบแนะนำ",
    jewelryTypeChosenLabel: getOptionLabel("jewelry_type", answers.jewelryType),
  };

  const pair = findPair(pid, others);
  const pairOtherCode = pair.gems.find((code) => code !== pid) ?? pair.gems[0];

  const pairing: GemQuizResultPairing = {
    heroStoneCode: pid,
    pairStoneCode: pairOtherCode,
    title: pair.title,
    th: pair.th,
    fit: pair.fit,
  };

  const alternatives: GemQuizResultAlternative[] = others.map((code) => ({
    stoneCode: code,
    label: code === rank1 ? "พลอยแนะนำอันดับ 1" : `ทางเลือกที่ ${top3.indexOf(code)}`,
  }));

  const resolvedTypeCode: GemQuizJewelryType =
    answers.jewelryType === "unknown" ? GEM_QUIZ_DEFAULT_JEWELRY[pid] : (answers.jewelryType as GemQuizJewelryType);
  const resolvedType = getJewelryTypeConfig(resolvedTypeCode);
  if (!resolvedType.en || !resolvedType.productTh) {
    // ไม่เกิดจริง — GEM_QUIZ_DEFAULT_JEWELRY คืนได้แค่ ring/necklace ซึ่งทั้งคู่
    // มี en/productTh ครบ และ "unknown" ไม่มีทางมาถึงจุดนี้ (ถูก resolve ไปแล้ว)
    throw new Error(`buildResultView: ประเภทเครื่องประดับ "${resolvedTypeCode}" ไม่มีชื่อ en/productTh สำหรับแสดงผล`);
  }

  const place =
    resolvedTypeCode === "ring"
      ? GEM_QUIZ_RING_FINGER[pid].placement
      : GEM_QUIZ_OTHER_PLACEMENT[resolvedTypeCode as "necklace" | "earring" | "bracelet"];
  const hand = resolvedTypeCode === "ring" || resolvedTypeCode === "bracelet" ? GEM_QUIZ_HAND_NOTE : GEM_QUIZ_LENGTH_FIT_NOTE;
  const why =
    resolvedTypeCode === "ring"
      ? `เป็น symbolic reminder ของ${GEM_QUIZ_RING_FINGER[pid].why}`
      : `ให้ ${heroStone.nameEn} อยู่ใกล้ตัวตลอดวัน เป็น reminder ของ${heroStone.meaning}`;

  const howToWear: GemQuizResultHowToWear = {
    note: answers.jewelryType === "unknown" ? "3J เลือกให้ตามพลอย" : "ตามที่คุณเลือก",
    title: `${heroStone.nameEn} ${resolvedType.en}`,
    titleTh: `${resolvedType.productTh}${heroStone.labelTh}`,
    place,
    hand,
    why,
  };

  // products = [พลอยหลัก, ทางเลือกตัวแรก] — ชื่อเท่านั้น ห้ามมีราคา (design §5)
  const secondProductCode = others[0] ?? pairOtherCode;
  const products: GemQuizResultProduct[] = [pid, secondProductCode].map((code) => {
    const stone = getStoneConfig(code);
    return {
      stoneCode: code,
      nameEn: `${stone.nameEn} ${resolvedType.en}`,
      nameTh: `${resolvedType.productTh}${stone.labelTh}`,
    };
  });

  return {
    hero,
    pairing,
    alternatives,
    howToWear,
    products,
    disclaimer: GEM_QUIZ_DISCLAIMER,
  };
}
