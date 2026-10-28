// lib/jobs/gem-tabs.ts — แท็บของหน้า /oem/gems (?tab=) — แยกออกจาก client component เพื่อให้ page.tsx (server) เรียกได้

export type GemTab = "items" | "types" | "shapes";
export const GEM_TABS: { key: GemTab; label: string }[] = [
  { key: "items", label: "รายการพลอย" },
  { key: "types", label: "ชนิด" },
  { key: "shapes", label: "รูปทรง" },
];
/** ค่าอื่นนอกจาก types/shapes = รายการพลอย (ค่าเริ่ม) — ไม่เชื่อ query string */
export const parseGemTab = (v: unknown): GemTab => (v === "types" || v === "shapes" ? v : "items");
