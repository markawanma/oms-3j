// lib/ring-builder/showcase/config.ts — ค่าคงที่ของหน้า "แบบของ 3J Jewelry" (D1 demo · pure · ไม่มี runtime import)
// แหล่งเดียวของ: ชื่อแบบ · ราคา · ไซซ์ · ขนาดพลอย · ระยะ pre-order · ข้อความหน้าจอ
// 🔴 ค่าจากเจ้าของ (12 พ.ย. 69): ราคา 800 บาทตายตัว · ไซซ์ 55–58 · พลอยไข่ 7×5 มม. · pre-order ทำภายใน 21 วัน
//    ค่าอื่นที่ไม่มีในเอกสาร = ห้ามแต่ง → TODO_OWNER_* (ดูที่ชื่อแบบและคำบรรยายรูปด้านล่าง) · แบบเดียวเท่านั้น (X4) — แบบอื่นห้ามอยู่ใน config/bundle
// 🔴 D1 = config ในโค้ด: แก้ราคา/ไซซ์/รูป ต้อง deploy ใหม่ · D2 จะย้ายไป rb_* (ดู design-ring-showcase-demo.md §2)

/** ราคาเหมาตายตัวต่อวง (บาท) — ค่าเดียวของทั้งหน้า · ไม่คิดค่าพลอยเพิ่ม */
export const SHOWCASE_PRICE_THB = 800;

/** ไซซ์ที่เปิดให้เลือก (เบอร์ร้าน) · ต้องอยู่ในช่วงร้าน 45–68 (config.test.ts ล็อก) */
export const SHOWCASE_SIZES = [55, 56, 57, 58] as const;
// review 12 พ.ย.: ช่วงคำนวณจากรายการเดียว — แก้ไซซ์ที่เดียว ด่าน isShowcaseSize/fitsDesignRange ตามเอง
export const SHOWCASE_SIZE_RANGE = {
  min: SHOWCASE_SIZES[0],
  max: SHOWCASE_SIZES[SHOWCASE_SIZES.length - 1],
} as const;

/** พลอยไข่ (มม.) — ยาว × กว้าง */
export const SHOWCASE_OVAL_MM = { long: 7, short: 5 } as const;

/** pre-order: ทำภายในกี่วัน */
export const SHOWCASE_LEAD_DAYS = 21;

// TODO_OWNER_DESIGN_NAME — ชื่อแบบชั่วคราว (เจ้าของยังไม่ตั้งชื่อ) · เปลี่ยนที่นี่ที่เดียว
export const SHOWCASE_DESIGN_NAME = "แหวนไขว้พลอยไข่ 2 เม็ด";

/** จำนวนแบบพลอยที่ให้เลือก (แบบ 1/2/3 = พลอยอันดับ 1–3 จาก quiz) */
export const SHOWCASE_SET_COUNT = 3;

/** query key เดียวที่หน้าอ่าน (X2) */
export const SHOWCASE_PARAM_KEY = "g";
/** ความยาวสูงสุดของค่า g (X1) */
export const SHOWCASE_PARAM_MAX_LEN = 64;

export const SHOWCASE_PATH = "/ring-builder";
export const GEM_QUIZ_PATH = "/gem-quiz";
export const RING_SIZE_PATH = "/ring-size";

/** "800 บาท" — ทุกที่ที่แสดงราคาต้องผ่านฟังก์ชันนี้ (ห้ามพิมพ์ตัวเลขราคาในคอมโพเนนต์) */
export function formatPriceThb(): string {
  return `${SHOWCASE_PRICE_THB.toLocaleString("en-US")} บาท`;
}

export function leadTimeLabel(): string {
  return `พรีออเดอร์ ทำภายใน ${SHOWCASE_LEAD_DAYS} วัน`;
}

/** ข้อความหน้าจอ (UX spec ข้อ 2–4) — พลอยและคำอธิบายคู่พลอยมาจาก GEM_QUIZ_* ไม่ซ้ำที่นี่ */
export const SHOWCASE_COPY = {
  pageTitle: "แหวนของ 3J Jewelry | ลองพลอยของคุณบนแหวน",
  pageDescription: "ลองพลอยจากแบบทดสอบของคุณบนแหวนไขว้พลอยไข่ 2 เม็ด เลือกไซซ์ แล้วส่งให้แอดมินยืนยันทาง LINE",
  stageLabel: "ภาพแหวน",
  badge: "ภาพจำลอง",
  dragHint: "ลากเพื่อหมุน",
  resetView: "กลับมุมหน้า",
  loading3d: "กำลังโหลดภาพ 3 มิติ…",
  unsupported3d: "เครื่องนี้แสดงภาพ 3 มิติไม่ได้ ดูรูปจริงด้านล่างแทน",
  contextLost3d: "ภาพ 3 มิติหยุดชั่วคราว ดูรูปจริงด้านล่างแทน",
  pickerHeading: "พลอยที่คุณเลือกได้",
  pickerBasisNote: "บน = พลอยหลักของแบบ · ล่าง = พลอยเสริม · CZ เล็ก 2 เม็ดมาพร้อมแหวน",
  rankBadge: (n: number) => `อันดับ ${n} จากแบบทดสอบ`,
  sameAs: (n: number) => `คู่เดียวกับแบบ ${n} — สลับว่าเม็ดไหนอยู่บน`,
  quizCardTitle: "อยากรู้ว่าพลอยไหนเหมาะกับคุณ?",
  quizCardCta: "ทำแบบทดสอบ 1 นาที",
  quizCardNote: "ตอนนี้แสดงแหวนพร้อม CZ ขาว",
  sizeHeading: "เลือกไซซ์",
  sizeUnit: (n: number) => `เบอร์ ${n}`,
  sizeHelp: "ไม่รู้ไซซ์? วัดด้วยเครื่องมือวัดไซซ์",
  lastMeasured: (n: number) => `ผลวัดล่าสุด: เบอร์ ${n}`,
  useLastMeasured: (n: number) => `ใช้เบอร์ ${n}`,
  lastMeasuredOutOfRange: "ไซซ์นี้อยู่นอกช่วงของแบบนี้ ทักแอดมินได้",
  sizeMissingWarn: "ยังไม่ได้เลือกไซซ์ — ส่งได้เลย แอดมินจะช่วยเช็กไซซ์ให้",
  photosHeading: "ดูของจริง",
  photosNote: "ภาพถ่ายเป็นตัวอย่างแหวนชิ้นหนึ่ง สีพลอยของชิ้นที่ทำจริงอาจต่างจากภาพ",
  photoPrev: "รูปก่อนหน้า",
  photoNext: "รูปถัดไป",
  photoFailed: "รูปนี้โหลดไม่ได้",
  photoRetry: "ลองอีกครั้ง",
  summaryHeading: "สรุปที่เลือก",
  summaryDesign: "แบบ",
  summaryTop: "พลอยบน",
  summaryBottom: "พลอยล่าง",
  summarySize: "ไซซ์",
  summaryPrice: "ราคา",
  sizePending: "รอแอดมินช่วยเช็ก",
  notAnOrder: "ยังไม่ใช่การสั่งซื้อ — ส่งให้แอดมินยืนยันก่อน",
  lineButton: "ส่งให้แอดมินทาง LINE",
  copyButton: "คัดลอกข้อความ",
  copiedButton: "คัดลอกแล้ว ✓",
  copyFailed: "กดค้างเพื่อคัดลอกเอง",
  copyFallbackLabel: "ข้อความที่จะส่ง",
  // ไม่ใช้คำว่า "เพชร" แม้ในประโยคปฏิเสธ (X7)
  czNote: "CZ คือคิวบิกเซอร์โคเนีย พลอยเม็ดเล็กสีขาวที่มาพร้อมแหวน",
} as const;

/** ภาพจริง — คำบรรยายมุมมองมาจากชื่อไฟล์ต้นฉบับที่เจ้าของส่ง (ยังไม่ผ่านการยืนยัน) */
// TODO_OWNER_PHOTO_CAPTION — เจ้าของยังไม่ได้ยืนยันคำบรรยายรูป (ใช้ alt ชั่วคราวตามมุมถ่าย)
export const SHOWCASE_PHOTO_VIEWS = ["มุมเฉียงด้านบน", "มองทะลุวงแหวน", "มุมบน", "มุมข้าง 1", "มุมข้าง 2"] as const;
