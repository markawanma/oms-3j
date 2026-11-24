// lib/ring-builder/showcase/designs.ts — แบบแหวน 8 แบบที่ลูกค้าเลือกได้ (D1.2 · D1.3 เพิ่มเม็ดเดี่ยว · pure · ไม่มีเรขาคณิต ไม่ import รูป/viewer)
// แหล่งเดียวของ: id · ชื่อ · จำนวนเม็ด · เม็ดไหนคือ "พลอยหลัก" · คำเรียกตำแหน่ง · ช่วงไซซ์ · CZ เล็กที่มาพร้อมแหวน
// 🔴 ไม่มีช่องราคา / lead days / ขนาดพลอย (มม.) — ตั้งใจ (Z3/Z7): ราคาต่อแบบอยู่ config.ts (SHOWCASE_PRICE_THB_BY_DESIGN) ที่เดียว · ขนาดพลอยเป็นค่าประมาณจากรูป ห้ามถึงลูกค้า
//    พารามิเตอร์ 3D อยู่ viewer/row-presets.ts (ค่าประมาณ) — เชื่อมกันด้วย id เท่านั้น + test ไขว้ (designs.test.ts)
// 🔴 ค่าที่ต้องมาจากเจ้าของ (ยังไม่ยืนยัน — เปลี่ยนที่นี่ที่เดียว):
//    TODO_OWNER_DESIGN_NAME   — ชื่อแบบทั้ง 8 เป็นชื่อชั่วคราว (แบบ 8 "แหวนเม็ดเดี่ยว 6 เตย" ชั่วคราวเหมือนกัน) (ตาม Yoda/เจ้าของพูดปากเปล่า) · UI ต้องรับชื่อจริงที่ยาวขึ้นได้
//    TODO_OWNER_SCROLL6_CENTER — ก้นหอย 6 เม็ด: ใช้กฎ 2 เม็ดกลางเหมือนฝังล็อค (TL ตั้งไว้ก่อน)
//    TODO_OWNER_EXTRA_CZ       — แบบแถวใหม่ไม่มี CZ เล็ก (มติ 9 พ.ย.: พลอยทุกเม็ดในวงขนาดเท่ากัน) · CZ เล็ก 2 เม็ดมีเฉพาะแบบไขว้
//    TODO_OWNER_SIZES          — ไซซ์แบบแถวใหม่ 50–60 (ไขว้ 55–58 ตามเดิม)

export const SHOWCASE_DESIGN_IDS = ["bypass2", "trinity", "scroll6", "channel4", "channel6", "bar7", "small7", "solitaire"] as const;
export type ShowcaseDesignId = (typeof SHOWCASE_DESIGN_IDS)[number];
export const DEFAULT_DESIGN_ID: ShowcaseDesignId = "bypass2";

export type ShowcaseLayout = { kind: "bypass" } | { kind: "row"; stoneCount: 1 | 3 | 4 | 6 | 7 };

export interface ShowcaseDesign {
  readonly id: ShowcaseDesignId;
  /** ชื่อเต็ม — ใช้ใน LINE / alt / aria (TODO_OWNER_DESIGN_NAME) */
  readonly name: string;
  /** ชื่อบน chip (สั้น · ไม่ตัดคำ) */
  readonly shortName: string;
  readonly layout: ShowcaseLayout;
  /** จำนวนเม็ดที่เป็น "พลอยหลัก" (1 หรือ 2) */
  readonly mainCount: 1 | 2;
  /** คำเรียกตำแหน่ง — ใช้ในป้าย "พลอยหลัก (ตำแหน่ง)" / "พลอยเสริม (ตำแหน่ง)" */
  readonly positions: { readonly main: string; readonly sub: string };
  /** จำนวน CZ เล็กที่มาพร้อมแหวน (นอกเหนือจากพลอยหลัก/เสริม) */
  readonly extraCz: number;
  /** ไซซ์ที่เลือกได้ (เบอร์ร้าน · ต่อเนื่อง) */
  readonly sizes: readonly number[];
}

function range(min: number, max: number): readonly number[] {
  const out: number[] = [];
  for (let s = min; s <= max; s++) out.push(s);
  return out;
}

const ROW_SIZES = range(50, 60);

function rowDesign(id: ShowcaseDesignId, name: string, shortName: string, stoneCount: 1 | 3 | 4 | 6 | 7): ShowcaseDesign {
  const two = stoneCount % 2 === 0;
  return {
    id,
    name,
    shortName,
    layout: { kind: "row", stoneCount },
    mainCount: two ? 2 : 1,
    positions: { main: two ? "เม็ดกลาง 2 เม็ด" : "เม็ดกลาง", sub: "เม็ดข้าง" },
    extraCz: 0,
    sizes: ROW_SIZES,
  };
}

export const DESIGNS: readonly ShowcaseDesign[] = [
  {
    id: "bypass2",
    name: "แหวนไขว้พลอยไข่ 2 เม็ด", // TODO_OWNER_DESIGN_NAME
    shortName: "ไขว้ 2 เม็ด",
    layout: { kind: "bypass" },
    mainCount: 1,
    positions: { main: "เม็ดบน", sub: "เม็ดล่าง" },
    extraCz: 2,
    sizes: range(55, 58),
  },
  rowDesign("trinity", "แหวน TRINITY 3 เม็ด", "TRINITY 3 เม็ด", 3), // TODO_OWNER_DESIGN_NAME
  rowDesign("scroll6", "แหวนก้นหอย 6 เม็ด", "ก้นหอย 6 เม็ด", 6), // TODO_OWNER_DESIGN_NAME · TODO_OWNER_SCROLL6_CENTER
  rowDesign("channel4", "แหวนฝังล็อค 4 เม็ด", "ฝังล็อค 4 เม็ด", 4), // TODO_OWNER_DESIGN_NAME
  rowDesign("channel6", "แหวนฝังล็อค 6 เม็ด", "ฝังล็อค 6 เม็ด", 6), // TODO_OWNER_DESIGN_NAME
  rowDesign("bar7", "แหวนเตย 7 เม็ด", "เตย 7 เม็ด", 7), // TODO_OWNER_DESIGN_NAME
  rowDesign("small7", "แหวนแถวเล็ก 7 เม็ด", "แถวเล็ก 7 เม็ด", 7), // TODO_OWNER_DESIGN_NAME
  rowDesign("solitaire", "แหวนเม็ดเดี่ยว 6 เตย", "เม็ดเดี่ยว 6 เตย", 1), // TODO_OWNER_DESIGN_NAME (24 พ.ย. 69 · ราคา/ไซซ์ 50–60/21 วัน = ค่าตั้งต้น)
];

/** id ต้องอยู่ใน whitelist (เทียบค่าตรงๆ ไม่เดินโซ่ prototype) */
export function isShowcaseDesignId(raw: unknown): raw is ShowcaseDesignId {
  return typeof raw === "string" && (SHOWCASE_DESIGN_IDS as readonly string[]).includes(raw);
}

/** แบบจาก id — id ผิด = undefined (ไม่ throw · ผู้เรียกตัดสินว่าจะ fallback หรือ null) */
export function findShowcaseDesign(id: unknown): ShowcaseDesign | undefined {
  return isShowcaseDesignId(id) ? DESIGNS.find((d) => d.id === id) : undefined;
}

/** แบบจาก id ที่ผ่านด่านแล้ว (type guard ผ่าน ShowcaseDesignId) */
export function getShowcaseDesign(id: ShowcaseDesignId): ShowcaseDesign {
  const d = DESIGNS.find((x) => x.id === id);
  if (!d) throw new Error(`designs: ไม่มีแบบ "${String(id)}"`);
  return d;
}

/** เม็ดเดี่ยว (แถว 1 เม็ด) — ไม่มี "พลอยหลัก/เสริม/ทุกเม็ด/เม็ด n/ซ้ายไปขวา" ในข้อความลูกค้า (Z13) · ทุกจุดที่เขียนคำพวกนี้ต้อง branch ด้วยฟังก์ชันนี้ */
export function isSingleStone(d: ShowcaseDesign): boolean {
  return d.layout.kind === "row" && d.layout.stoneCount === 1;
}

/** จำนวนเม็ดของวง (ไขว้ = พลอยไข่ 2 เม็ด + CZ เล็ก = 4 เม็ดในโมเดล แต่นับพลอยหลัก/เสริม 2 เม็ด) */
export function gemSlotCount(d: ShowcaseDesign): number {
  return d.layout.kind === "row" ? d.layout.stoneCount : 4;
}

/** ดัชนีเม็ด "พลอยหลัก" ของแถว n เม็ด (เรียงซ้าย→ขวา): คี่ = 1 เม็ดกลาง · คู่ = 2 เม็ดกลาง · ค่าแปลก = [] */
export function mainIndexes(n: number): number[] {
  if (!Number.isInteger(n) || n < 1) return [];
  return n % 2 === 1 ? [(n - 1) / 2] : [n / 2 - 1, n / 2];
}

/** จำนวนเม็ดที่ลูกค้าเลือกสีได้ (D1.2a): ไขว้ = 2 (บน/ล่าง) · แถว = จำนวนเม็ดของแบบ · ใช้เป็นคีย์จำสีต่อจำนวนเม็ด */
export function ownSlotCount(d: ShowcaseDesign): number {
  return d.layout.kind === "row" ? d.layout.stoneCount : 2;
}

/** ชุดรายเม็ดจากคู่ (หลัก, เสริม): เม็ดกลาง (mainIndexes) = หลัก ที่เหลือ = เสริม — ตรงกับที่โหมดแบบแนะนำแสดง */
export function seedFromPair<T>(n: number, main: T, secondary: T): T[] {
  const mains = new Set(mainIndexes(n));
  return Array.from({ length: n }, (_, i) => (mains.has(i) ? main : secondary));
}

export function sizeRange(id: ShowcaseDesignId): { min: number; max: number } {
  const s = getShowcaseDesign(id).sizes;
  return { min: s[0], max: s[s.length - 1] };
}

/** ป้ายบทบาท: "พลอยหลัก (เม็ดกลาง)" / "พลอยเสริม (เม็ดข้าง)" — ข้อความมาจากแบบเท่านั้น (ห้ามพิมพ์ "บน/ล่าง" ตายตัวในคอมโพเนนต์) */
export function roleMainLabel(d: ShowcaseDesign): string {
  return `พลอยหลัก (${d.positions.main})`;
}
export function roleSubLabel(d: ShowcaseDesign): string {
  return `พลอยเสริม (${d.positions.sub})`;
}

/** บรรทัดอธิบายตำแหน่ง (หัวแผงพลอย) — ท้ายประโยคเรื่อง CZ เล็กแสดงเฉพาะแบบที่มี extraCz */
export function placementNote(d: ShowcaseDesign): string | null {
  if (isSingleStone(d)) return null; // เม็ดเดียว: ไม่มีหลัก/เสริมให้อธิบาย (D1.3 §15.3 จุดที่ 1)
  const base =
    d.layout.kind === "bypass"
      ? `${d.positions.main} = พลอยหลัก · ${d.positions.sub} = พลอยเสริม`
      : `${d.positions.main} = พลอยหลัก · ${d.positions.sub}ที่เหลือ = พลอยเสริม`;
  return d.extraCz > 0 ? `${base} · CZ เล็ก ${d.extraCz} เม็ดมาพร้อมแหวน` : base;
}
