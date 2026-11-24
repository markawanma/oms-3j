// lib/ring-builder/showcase/config.ts — ค่าคงที่ของหน้า "แบบของ 3J Jewelry" (D1 demo · D1.2 หลายแบบ · pure · import ได้แค่ designs.ts ที่ pure เหมือนกัน)
// แหล่งเดียวของ: ราคา · ระยะ pre-order · ข้อความหน้าจอ · ชื่อ query key — ชื่อแบบ/ไซซ์/ตำแหน่งพลอยอยู่ designs.ts
// 🔴 ค่าจากเจ้าของ: ราคา "ต่อแบบ" — 7 แบบ 890 บาท (เจ้าของเปลี่ยน 18 พ.ย. 69 จาก 800) · แบบเม็ดเดี่ยว 790 บาท (เจ้าของ 24 พ.ย. 69) · pre-order ทำภายใน 21 วัน · พลอยไข่ 7×5 มม. (ไขว้ — อยู่ใน bypass-ring.ts)
//    ค่าอื่นที่ไม่มีในเอกสาร = ห้ามแต่ง → TODO_OWNER_* (ดู designs.ts: ชื่อแบบ · ก้นหอย 6 เม็ดกลาง · CZ เล็กของแบบแถว · ไซซ์แบบใหม่ · รูปถ่ายจริง)
// 🔴 D1.2 (18 พ.ย. 69 · design-ring-showcase-multi.md §0): เดิม "แบบเดียว (X4) — แบบอื่นห้ามอยู่ใน config/bundle" → ตอนนี้ 7 แบบ แต่ builder แบบแถว
//    (viewer/row-ring.ts) อยู่ใน chunk lazy ของ RingViewer เท่านั้น ไม่เข้า first-load (Z9)
// 🔴 D1.3 (24 พ.ย. 69 · §15): ราคาต่อแบบอยู่ SHOWCASE_PRICE_THB_BY_DESIGN ที่นี่ที่เดียว · ไม่มีคำว่า "ทุกแบบ" ผูกกับราคา · hub ไม่แสดงราคา
// 🔴 config ในโค้ด: แก้ราคา/ไซซ์/รูป ต้อง deploy ใหม่ · D2 จะย้ายไป rb_* (ดู design-ring-showcase-demo.md §2)
import { DESIGNS, type ShowcaseDesignId } from "./designs";

/** ราคาเหมาต่อวง (บาท) ต่อแบบ — Record บังคับครบทุก id ตอน compile (เพิ่มแบบใหม่แล้วลืมราคา = build ไม่ผ่าน) · ไม่คิดค่าพลอยเพิ่ม */
export const SHOWCASE_PRICE_THB_BY_DESIGN: Readonly<Record<ShowcaseDesignId, number>> = {
  bypass2: 890,
  trinity: 890,
  scroll6: 890,
  channel4: 890,
  channel6: 890,
  bar7: 890,
  small7: 890,
  solitaire: 790, // เจ้าของ 24 พ.ย. 69: "ราคา 790 วงนี้จะถูกกว่า เอาขึ้นได้เลย"
};

/** ราคาของแบบ — id นอก whitelist = throw (ผู้เรียกส่ง id ที่ผ่านด่านแล้วเสมอ · ห้ามมี fallback ราคา) */
export function showcasePriceThb(id: ShowcaseDesignId): number {
  if (!Object.prototype.hasOwnProperty.call(SHOWCASE_PRICE_THB_BY_DESIGN, id)) throw new Error(`config: ไม่มีราคาของแบบ "${String(id)}"`);
  return SHOWCASE_PRICE_THB_BY_DESIGN[id];
}

/** pre-order: ทำภายในกี่วัน (TODO_OWNER_LEAD_DAYS: 21 วันใช้กับแบบแถวใหม่เหมือนกันไหม — ตั้งไว้เท่ากันทุกแบบก่อน) */
export const SHOWCASE_LEAD_DAYS = 21;

/** จำนวนชุดพลอยที่ให้เลือก (ชุด 1/2/3 = พลอยอันดับ 1–3 จาก quiz) */
export const SHOWCASE_SET_COUNT = 3;

/** query key ที่หน้าอ่าน (X2 · D1.1 §9.1 · D1.2 §4) — มีแค่ 7 key นี้ (g t i q c d r) · key อื่น (?price= ?size= ?design=) ไม่มีผล */
export const SHOWCASE_PARAM_KEY = "g"; // ลิงก์ D1 เดิม: top3 รหัสเต็ม a.b.c
export const SHOWCASE_PARAM_TABLE = "t"; // D1.1: top3 ของ 6 เรื่อง (ตารางคำนวณล่วงหน้าตอนสร้าง CTA)
export const SHOWCASE_PARAM_INTENTION = "i"; // D1.1: เรื่องที่เลือกอยู่
export const SHOWCASE_PARAM_OWN = "c"; // D1.1: พลอยที่เลือกเอง <หลัก>.<เสริม>
export const SHOWCASE_PARAM_DESIGN = "d"; // D1.1: ชุดพลอย 1/2/3/own
export const SHOWCASE_PARAM_ANSWERED = "q"; // D1.1 BUG-1: เรื่องที่ตอบใน quiz (ใช้ตัดสินป้าย "จากแบบทดสอบ" เมื่อ i ถูกเปลี่ยนแล้ว)
export const SHOWCASE_PARAM_RING = "r"; // D1.2: แบบแหวน (ไม่ใช้ d ซ้ำ — d = ชุดพลอย) · ไม่มี/ผิด = ไขว้
/** ความยาวสูงสุดของค่า param ใดๆ (X1) — t ยาว 23 · g ยาวสุด 3 รหัสเต็ม < 64 */
export const SHOWCASE_PARAM_MAX_LEN = 64;

export const SHOWCASE_PATH = "/ring-builder";
export const GEM_QUIZ_PATH = "/gem-quiz";
export const RING_SIZE_PATH = "/ring-size";

/** "790 บาท" — ทุกที่ที่แสดงราคาต้องผ่านฟังก์ชันนี้ (ห้ามพิมพ์ตัวเลขราคาในคอมโพเนนต์) · arg บังคับ ไม่มี default */
export function formatPriceThb(id: ShowcaseDesignId): string {
  return `${showcasePriceThb(id).toLocaleString("en-US")} บาท`;
}

export function leadTimeLabel(): string {
  return `พรีออเดอร์ ทำภายใน ${SHOWCASE_LEAD_DAYS} วัน`;
}

/** ชื่อที่ขึ้นต้นด้วยอักษรละติน (CZ ขาว) ต้องเว้นวรรคหน้าชื่อเมื่อต่อท้ายคำไทย — ชื่อพลอยไทยไม่ต้อง */
function thaiGap(name: string): string {
  return /^[A-Za-z]/.test(name) ? ` ${name}` : name;
}

/** ข้อความหน้าจอ (UX spec D1/D1.1/D1.2) — พลอยและคำอธิบายคู่พลอยมาจาก GEM_QUIZ_* ไม่ซ้ำที่นี่ · ข้อความที่ขึ้นกับแบบ (ชื่อ/ตำแหน่ง/CZ) มาจาก designs.ts */
export const SHOWCASE_COPY = {
  pageTitle: "แหวนของ 3J Jewelry | ลองพลอยของคุณบนแหวน",
  // ไม่มีตัวเลขราคา (D1.2 §8-3) · จำนวนแบบนับจาก DESIGNS
  pageDescription: `ลองพลอยจากแบบทดสอบของคุณบนแหวน ${DESIGNS.length} แบบ เลือกไซซ์ แล้วส่งให้แอดมินยืนยันทาง LINE`,
  // h1 คงที่ของหน้า (ชื่อแบบอยู่ในตัวเลือกแล้ว) — UX §12 ข้อ 8 รอเจ้าของยืนยันถ้อยคำ
  h1: "แหวนพลอยของ 3J Jewelry",
  stageLabel: "ภาพแหวน",
  badge: "ภาพจำลอง",
  dragHint: "ลากเพื่อหมุน",
  resetView: "กลับมุมหน้า",
  loading3d: "กำลังโหลดภาพ 3 มิติ…",
  unsupported3d: "เครื่องนี้แสดงภาพ 3 มิติไม่ได้ ดูรูปจริงด้านล่างแทน",
  contextLost3d: "ภาพ 3 มิติหยุดชั่วคราว ดูรูปจริงด้านล่างแทน",
  // แบบที่ยังไม่มีรูปถ่ายจริง (UX §5) — ห้ามเอารูปแบบอื่นมาแทน (Z6)
  contextLost3dNoPhoto: "ภาพ 3 มิติหยุดชั่วคราว · แบบนี้ยังไม่มีรูปถ่ายจริง · เลือกพลอยและไซซ์แล้วส่งให้แอดมินได้ตามปกติ",
  stageNo3dNoPhoto: "เครื่องนี้แสดงภาพ 3 มิติไม่ได้ · แบบนี้ยังไม่มีรูปถ่ายจริง · เลือกพลอยและไซซ์แล้วส่งให้แอดมินได้ตามปกติ",
  pictogramBadge: "ภาพประกอบตำแหน่งเม็ด ไม่ใช่ภาพจริง",
  stageDesignLoadFailed: "โหลดภาพ 3 มิติของแบบนี้ไม่ได้",
  stageRetry: "ลองอีกครั้ง",
  // เลือกแบบแหวน
  designHeading: "เลือกแบบแหวน",
  designHint: (count: number) => `ปัดดูทั้ง ${count} แบบ`,
  designAnnounce: (name: string, price: string) => `เลือกแบบ ${name} แล้ว · ${price}`,
  designAnnounceSizeOut: (size: number) => ` · ไซซ์ ${size} ที่เลือกไว้ใช้กับแบบนี้ไม่ได้`,
  pickerHeading: "พลอยที่คุณเลือกได้",
  // ป้ายการ์ด (Y6): คำนวณจาก "ที่มา" — "จากแบบทดสอบ" ใช้ได้เฉพาะเมื่อผลมาจาก quiz จริง (เรื่องที่ตอบ หรือลิงก์ g เดิม)
  rankBadge: (n: number) => `อันดับ ${n} จากแบบทดสอบ`,
  rankBadgeIntention: (n: number) => `อันดับ ${n} ในเรื่องนี้`,
  basisQuiz: "จากผลแบบทดสอบของคุณ",
  basisIntention: "จัดอันดับตามเรื่องที่เลือก ไม่ใช่ผลแบบทดสอบ",
  // โหมดเลือกพลอย (D1.1 · UX)
  modeLabel: "วิธีเลือกพลอย",
  modeRecommended: "แบบแนะนำ",
  modeOwn: "เลือกพลอยเอง",
  // เรื่องที่อยากเสริม
  intentionHeading: "อยากเสริมเรื่องไหน",
  intentionChosen: (label: string) => `เรื่องที่เลือก: ${label}`,
  intentionChange: "เปลี่ยน",
  intentionAnnounce: (label: string) => `แสดงแบบแนะนำสำหรับ ${label}`,
  intentionDirect: "เลือกเรื่องด้านบนเพื่อดูแบบแนะนำ",
  // เลือกพลอยเอง (ป้ายหลัก/เสริม + ตำแหน่ง สร้างจาก designs.ts: roleMainLabel / roleSubLabel)
  ownEmptyHint: "แตะพลอยหลักก่อน ระบบใส่ชนิดเดียวกันให้พลอยเสริม แล้วเปลี่ยนได้",
  ownBothSame: (label: string) => `${label} ทุกเม็ด`,
  ownNoPairNote: "คู่นี้ยังไม่มีคำอธิบายเฉพาะคู่ แสดงคำอธิบายรายเม็ดแทน",
  gemNone: "CZ ขาว (ยังไม่ได้เลือกพลอยสี)", // โหมดเลือกเองที่ยังไม่เลือก — ใช้ตรงกันทั้งสรุปบนจอและ LINE
  summaryOwn: "เลือกพลอยเอง",
  // D1.3 แบบเม็ดเดี่ยว — พลอยเม็ดเดียว: ไม่มีคำว่า หลัก/เสริม/ทุกเม็ด/เม็ดที่ n (Z13)
  singleStoneLabel: "พลอยเม็ดเดี่ยว",
  singleStoneEmptyHint: "แตะพลอยที่ชอบเพื่อดูบนแหวน",
  singleStoneAnnounce: (name: string) => `เปลี่ยนพลอยเป็น${thaiGap(name)}แล้ว`,
  // D1.2a เลือกรายเม็ด (แบบแถว) — ทุกเม็ดเท่ากัน ไม่มีคำว่า หลัก/เสริม · ราคาเท่าเดิม
  summaryOwnSlots: "เลือกพลอยเอง (รายเม็ด · ซ้ายไปขวา มองตรงหน้าแหวน)",
  ownPerGemNote: "เลือกพลอยทีละเม็ด · ราคาเท่ากันไม่ว่าจะเลือกกี่สี",
  ownPerGemOrderHint: "นับจากซ้ายไปขวา เมื่อมองตรงหน้าแหวน",
  ownSlotBarLabel: "เลือกพลอยทีละเม็ด",
  ownSlotAria: (n: number, name: string | null) => (name ? `เม็ดที่ ${n} ${name}` : `เม็ดที่ ${n} ยังไม่เลือก`),
  ownSlotHeading: (n: number, name: string | null) => (name ? `เม็ดที่ ${n} · ${name}` : `เม็ดที่ ${n} · ยังไม่เลือก`),
  ownSlotRowAria: (n: number) => `เลือกพลอยให้เม็ดที่ ${n}`,
  ownFillAll: (name: string) => `ใส่${thaiGap(name)}ทุกเม็ด`,
  ownFillAllDone: (name: string) => `ใส่${thaiGap(name)}ทุกเม็ดแล้ว`,
  ownResetCz: "กลับเป็น CZ ขาวทั้งหมด",
  ownResetCzDone: "กลับเป็น CZ ขาวทุกเม็ดแล้ว",
  ownUndo: "เลิกทำ",
  ownUndoDone: "เลิกทำแล้ว",
  ownEmptyHintPerGem: "แตะพลอยหนึ่งชนิดเพื่อใส่ทุกเม็ดก่อน แล้วแตะเลขเม็ดเพื่อเปลี่ยนทีละเม็ด",
  ownSlotsAnnounce: (n: number, name: string) => `เม็ดที่ ${n} เป็น${thaiGap(name)}แล้ว`,
  ownFitAnnounce: (count: number) => `ปรับพลอยให้พอดี ${count} เม็ด กลับไปแบบเดิมสีเดิมจะกลับมา`,
  // ชุดพลอย 1/2/3 (D1.2: "แบบ" = แบบแหวนอย่างเดียว · ชุดพลอยเรียก "ชุด n" ทุกที่รวม LINE — UX §12 ข้อ 3 รอเจ้าของยืนยัน)
  setLabel: (n: number) => `ชุด ${n}`,
  sameAs: (n: number) => `คู่เดียวกับชุด ${n} — สลับว่าเม็ดไหนเป็นพลอยหลัก`,
  quizCardTitle: "อยากรู้ว่าพลอยไหนเหมาะกับคุณ?",
  quizCardCta: "ทำแบบทดสอบ 1 นาที",
  quizCardNote: "ตอนนี้แสดงแหวนพร้อม CZ ขาว",
  sizeHeading: "เลือกไซซ์",
  sizeRange: (min: number, max: number) => `ช่วง ${min}–${max}`,
  sizeUnit: (n: number) => `เบอร์ ${n}`,
  sizeHelp: "ไม่รู้ไซซ์? วัดด้วยเครื่องมือวัดไซซ์",
  lastMeasured: (n: number) => `ผลวัดล่าสุด: เบอร์ ${n}`,
  useLastMeasured: (n: number) => `ใช้เบอร์ ${n}`,
  lastMeasuredOutOfRange: "ไซซ์นี้อยู่นอกช่วงของแบบนี้ ทักแอดมินได้",
  sizeOutOfRangeNote: (size: number, min: number, max: number) =>
    `ไซซ์ ${size} ใช้กับแบบนี้ไม่ได้ (แบบนี้มีไซซ์ ${min}–${max}) · เลือกไซซ์ใหม่ หรือส่งข้อความแล้วแจ้งไซซ์กับแอดมินทาง LINE ได้`,
  sizeMissingWarn: "ยังไม่ได้เลือกไซซ์ — ส่งได้เลย แอดมินจะช่วยเช็กไซซ์ให้",
  photosHeading: "ดูของจริง",
  photosNote: "ภาพถ่ายเป็นตัวอย่างแหวนชิ้นหนึ่ง สีพลอยของชิ้นที่ทำจริงอาจต่างจากภาพ",
  noPhotoTitle: "แบบนี้ยังไม่มีรูปถ่ายจริง",
  noPhotoBody: "ภาพด้านบนเป็นภาพจำลอง 3 มิติ สีและรายละเอียดของชิ้นจริงอาจต่างจากภาพ",
  photoPrev: "รูปก่อนหน้า",
  photoNext: "รูปถัดไป",
  photoFailed: "รูปนี้โหลดไม่ได้",
  photoRetry: "ลองอีกครั้ง",
  summaryHeading: "สรุปที่เลือก",
  summaryDesign: "แบบแหวน",
  summaryGems: "พลอย",
  summaryExtraCz: "CZ เล็ก",
  extraCzCount: (n: number) => `${n} เม็ด`,
  summarySize: "ไซซ์",
  summaryPrice: "ราคา",
  sizePending: "รอแอดมินช่วยเช็ก",
  notAnOrder: "ยังไม่ใช่การสั่งซื้อ — ส่งให้แอดมินยืนยันก่อน",
  lineButton: "ส่งให้แอดมินทาง LINE",
  copyButton: "คัดลอกข้อความ",
  copiedButton: "คัดลอกแล้ว ✓",
  copyFailed: "กดค้างเพื่อคัดลอกเอง",
  copyFallbackLabel: "ข้อความที่จะส่ง",
  // P1d (ux-tools-navigation §3 + ux-ring-save-image §5): ปุ่ม "แก้" ในสรุป — พาไปหัวข้อนั้น ไม่รีเซ็ตค่า · แถวไซซ์ที่ยังไม่เลือก = "เลือก"
  editButton: "แก้",
  editSizeSelectButton: "เลือก",
  editAriaDesign: "แก้แบบแหวน",
  editAriaGems: "แก้ชุดพลอย",
  editAriaSize: "แก้ไซซ์",
  editAriaSizeSelect: "เลือกไซซ์",
  jumpAnnounce: (heading: string) => `ไปที่ ${heading}`,
  retakeQuiz: "ทำแบบทดสอบใหม่",
  // ปุ่ม "บันทึกรูป" (ux-ring-save-image §2.2 · TL ตั้งค่าเริ่มต้น 25 พ.ย. Q5 = "บันทึกรูป") — client-only ไม่มีลิงก์/QR/LINE ID บนภาพ (Q3)
  saveButton: "บันทึกรูป",
  saveBusy: "กำลังสร้างรูป…",
  saveWaitStage: "รอภาพ 3 มิติโหลดก่อน จึงบันทึกรูปได้",
  saveDesignFailed: "บันทึกรูปไม่ได้ เพราะภาพ 3 มิติของแบบนี้โหลดไม่ได้",
  saveFailed: "สร้างรูปไม่สำเร็จ ลองอีกครั้งได้เลย",
  saveSheetTitle: "บันทึกรูปแหวน",
  saveSheetHint: "กดค้างที่รูปเพื่อบันทึกลงเครื่อง", // ไม่อ้างชื่อเมนูของ iOS/Android (ยังไม่ยืนยันคำจริง)
  saveSheetClose: "ปิด",
  saveWordmark: "3J · JEWELRY",
  saveImageNote: "ภาพจำลอง 3 มิติ สีพลอยและรายละเอียดของชิ้นจริงอาจต่างจากภาพ",
  savePriceAsOf: (date: string) => `ราคา ณ ${date}`,
  // ไม่ใช้คำว่า "เพชร" แม้ในประโยคปฏิเสธ (X7) · แสดงเฉพาะแบบที่มี CZ เล็กมาพร้อมแหวน (extraCz > 0)
  czNote: "CZ คือคิวบิกเซอร์โคเนีย พลอยเม็ดเล็กสีขาวที่มาพร้อมแหวน",
} as const;

/** ภาพจริง — คำบรรยายมุมมองมาจากชื่อไฟล์ต้นฉบับที่เจ้าของส่ง (ยังไม่ผ่านการยืนยัน) · ใช้กับรูปแบบไขว้ */
// TODO_OWNER_PHOTO_CAPTION — เจ้าของยังไม่ได้ยืนยันคำบรรยายรูป (ใช้ alt ชั่วคราวตามมุมถ่าย)
export const SHOWCASE_PHOTO_VIEWS = ["มุมเฉียงด้านบน", "มองทะลุวงแหวน", "มุมบน", "มุมข้าง 1", "มุมข้าง 2"] as const;
