// lib/ring-builder/quote-schema.ts — ตรวจรูปร่าง body ของ POST /api/ring-builder/quote ก่อนแตะ DB (pure)
// strict: ต้องมี key ครบ 5 ตัวเป๊ะ ไม่รับ key อื่น (shop_id · ราคารายตำแหน่ง · pricedAt ถูกปฏิเสธ — ไม่รับจาก client เด็ดขาด)
import { MAX_DESIGN_NO, MAX_STONE_NO, MAX_STONES, MIN_STONES, RING_BUILDER_SIZES } from "./config";
import type { QuoteRequest } from "./types";

const KEYS = ["design", "expectedTotal", "positions", "size", "v"] as const;
const isInt = (v: unknown, lo: number, hi: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;

export function parseQuoteRequest(raw: unknown): { ok: true; data: QuoteRequest } | { ok: false } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false };
  const o = raw as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  if (keys.length !== KEYS.length || keys.some((k, i) => k !== KEYS[i])) return { ok: false };
  if (o.v !== 1) return { ok: false };
  if (!isInt(o.design, 1, MAX_DESIGN_NO)) return { ok: false };
  if (o.size !== null && !isInt(o.size, RING_BUILDER_SIZES.min, RING_BUILDER_SIZES.max)) return { ok: false };
  if (!Array.isArray(o.positions) || !isInt(o.positions.length, MIN_STONES, MAX_STONES)) return { ok: false };
  if (!o.positions.every((p) => isInt(p, 0, MAX_STONE_NO))) return { ok: false };
  // expectedTotal เกินเพดานรหัสได้ (server ตอบ total_too_large เอง) แต่ต้องเป็นจำนวนเต็มที่ปลอดภัย
  if (!isInt(o.expectedTotal, 0, 100_000_000)) return { ok: false };
  return { ok: true, data: { v: 1, design: o.design, size: o.size as number | null, positions: o.positions as number[], expectedTotal: o.expectedTotal } };
}
