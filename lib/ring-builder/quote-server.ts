// lib/ring-builder/quote-server.ts — ออกราคาผูกพัน + เซ็นรหัส + ประกอบข้อความทั้งหมดที่ server (server-only)
// หลักการ: ราคาที่อยู่ในรูป = ในรหัส = ที่ DB คิด ณ วินาทีที่ออกรหัส · client ไม่ได้ส่งราคา/เวลา/ร้านมา · lineText/qrText/pricedAtLabel/groups ประกอบที่นี่
// ราคาไม่ตรง expectedTotal → conflict (409) พร้อมราคาใหม่ ไม่ออกรหัส · ไม่มี secret → secret (503) ไม่แตะ DB
import "server-only";
import { getServiceClient } from "@/lib/supabase/server";
import { getDevShopId } from "@/lib/dev/context";
import { readErrorCode } from "@/lib/supabase/postgrest-error";
import { CZ_WHITE, LINE_COPY, MAX_BODY_PRICE_THB, MAX_OFFER_PRICE_THB, MAX_STONE_NO, MAX_TOTAL_THB, MM100_MAX, MM100_MIN, MONTHS_TH, QUOTE_REASONS, type QuoteReason } from "./config";
import { pricedAtToSec } from "./code";
import { issueCode, getCodeSecret } from "./code-sign";
import { stoneLabel } from "./mm";
import { formatBaht, isInt, isObj, type Raw } from "./util";
import type { QuoteConflict, QuoteDesign, QuoteGroup, QuoteLine, QuoteOk, QuoteRejected, QuoteRequest } from "./types";


/** เวลาไทย (UTC+7 คงที่ ไม่มี DST) — ไม่พึ่ง Intl/TZ ของเครื่อง */
function bkk(iso: string): { d: number; m: number; y: number; hh: number; mm: number } | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const t = new Date(ms + 7 * 3600 * 1000);
  return { d: t.getUTCDate(), m: t.getUTCMonth(), y: t.getUTCFullYear() + 543, hh: t.getUTCHours(), mm: t.getUTCMinutes() };
}

/** "9 พ.ย. 2569" */
export function formatThaiDateBkk(iso: string): string {
  const p = bkk(iso);
  return p ? `${p.d} ${MONTHS_TH[p.m]} ${p.y}` : "";
}

/** "9 พ.ย. 2569 14:32" (หลังบ้าน) */
export function formatThaiDateTimeBkk(iso: string): string {
  const p = bkk(iso);
  return p ? `${p.d} ${MONTHS_TH[p.m]} ${p.y} ${String(p.hh).padStart(2, "0")}:${String(p.mm).padStart(2, "0")}` : "";
}


/** จัดกลุ่มตามพลอย (ตามลำดับที่เจอครั้งแรก) — บวก/คูณจำนวนเต็มที่ DB คิดมาแล้ว ไม่มีสูตรใหม่ */
export function buildGroups(lines: QuoteLine[]): QuoteGroup[] {
  const out: QuoteGroup[] = [];
  for (const l of lines) {
    const g = out.find((x) => x.stoneNo === l.stoneNo);
    if (g) {
      g.count += 1;
      g.subtotalThb += l.priceThb;
    } else {
      out.push({ stoneNo: l.stoneNo, name: l.name, count: 1, unitPriceThb: l.priceThb, subtotalThb: l.priceThb });
    }
  }
  return out;
}

export function buildLineText(i: { stoneCount: number; design: QuoteDesign; size: number | null; lines: QuoteLine[]; total: number; pricedAtLabel: string; code: string }): string {
  const stones = i.lines.map((l) => `${l.pos} ${l.name}`).join(" · ");
  return [
    LINE_COPY.greeting,
    `แบบ: แถว ${i.stoneCount} เม็ด ${i.design.name} (พลอย${i.design.shapeName} ${i.design.stoneLabel} มม.)`,
    `ไซซ์: ${i.size === null ? LINE_COPY.sizeAdminCheck : `เบอร์ ${i.size}`}`,
    `${LINE_COPY.stonesHeading}: ${stones}`,
    `ราคารวม ${formatBaht(i.total)} (ณ ${i.pricedAtLabel})`,
    `รหัสสั่งทำ: ${i.code}`,
    LINE_COPY.closing,
  ].join("\n");
}

interface ParsedQuote {
  total: number;
  body: number;
  design: QuoteDesign;
  lines: QuoteLine[];
  pricedAt: string;
}

/**
 * แปลงผล rb_quote (ok:true) → ค่าที่ตรวจรูปร่างแล้ว · โครงผิด = null (route ตอบ 500 ไม่ออกรหัส)
 * S10 (defense-in-depth): รหัสที่เซ็นต้องตรงกับสิ่งที่ลูกค้าขอและยอดที่เซ็นต้องบวกกลับได้ ·
 *   - lines[i].pos === i+1 และ lines[i].stone_no === positions[i] (ผิดลำดับ/ผิดเม็ด = ไม่เซ็น)
 *   - total === body + Σ price (ยอดที่เซ็นห้ามเพี้ยนจากบรรทัด) · พลอยสี (stone_no > 0) ราคา ≥ 1 · CZ ขาวราคา 0
 */
export function parseQuoteOk(raw: Raw, positions: readonly number[]): ParsedQuote | null {
  if (!isInt(raw.total, 0, MAX_TOTAL_THB) || !isInt(raw.body, 1, MAX_BODY_PRICE_THB) || typeof raw.priced_at !== "string" || !Array.isArray(raw.lines) || !isObj(raw.design)) return null;
  const d = raw.design;
  if (typeof d.name !== "string" || typeof d.shape_name !== "string" || !isInt(d.major_mm100, MM100_MIN, MM100_MAX) || !isInt(d.minor_mm100, MM100_MIN, MM100_MAX)) return null;
  if (raw.lines.length !== positions.length) return null;
  const lines: QuoteLine[] = [];
  let sum = raw.body;
  for (let i = 0; i < raw.lines.length; i++) {
    const l = raw.lines[i];
    if (!isObj(l) || !isInt(l.pos, 1, 7) || !isInt(l.stone_no, 0, MAX_STONE_NO) || !isInt(l.price, 0, MAX_OFFER_PRICE_THB)) return null;
    if (l.pos !== i + 1 || l.stone_no !== positions[i]) return null;
    sum += l.price;
    if (l.stone_no === 0) {
      if (l.price !== 0) return null;
      lines.push({ pos: l.pos, stoneNo: 0, name: CZ_WHITE.name, priceThb: 0 });
    } else {
      if (l.price < 1 || typeof l.name !== "string") return null;
      lines.push({ pos: l.pos, stoneNo: l.stone_no, name: l.name, priceThb: l.price });
    }
  }
  if (sum !== raw.total) return null;
  return {
    total: raw.total,
    body: raw.body,
    design: { name: d.name, shapeName: d.shape_name, stoneLabel: stoneLabel(d.major_mm100, d.minor_mm100) },
    lines,
    pricedAt: raw.priced_at,
  };
}

export type QuoteOutcome =
  | { kind: "ok"; body: QuoteOk }
  | { kind: "conflict"; body: QuoteConflict }
  | { kind: "rejected"; body: QuoteRejected }
  | { kind: "secret" }
  | { kind: "error"; code: string };

export async function issueQuote(req: QuoteRequest): Promise<QuoteOutcome> {
  // ไม่มี secret = ไม่ออกรหัสได้เลย → ไม่แตะ DB (fail closed)
  if (!getCodeSecret()) return { kind: "secret" };
  let raw: unknown;
  try {
    const { data, error } = await getServiceClient()
      .schema("analytics")
      .rpc("rb_quote", { p_shop_id: getDevShopId(), p_design_no: req.design, p_size: req.size, p_positions: req.positions, p_at: null });
    if (error) throw error;
    raw = data;
  } catch (err) {
    return { kind: "error", code: readErrorCode(err) ?? "(none)" };
  }
  if (!isObj(raw)) return { kind: "error", code: "shape" };

  if (raw.ok !== true) {
    const code = raw.code;
    if (typeof code !== "string" || !(QUOTE_REASONS as readonly string[]).includes(code)) return { kind: "error", code: "shape" };
    const body: QuoteRejected = { ok: false, reason: code as QuoteReason };
    if (code === "stone_unavailable") {
      const nos = Array.isArray(raw.stone_nos) ? raw.stone_nos.filter((n): n is number => isInt(n, 1, 1023)) : [];
      body.stoneNos = nos;
    }
    return { kind: "rejected", body };
  }

  const q = parseQuoteOk(raw, req.positions);
  if (!q) return { kind: "error", code: "shape" };
  const groups = buildGroups(q.lines);

  if (q.total !== req.expectedTotal) {
    return { kind: "conflict", body: { ok: false, reason: "price_changed", total: q.total, body: q.body, design: q.design, lines: q.lines, groups } };
  }

  const pricedAtSec = pricedAtToSec(q.pricedAt);
  if (pricedAtSec === null) return { kind: "error", code: "shape" };
  const issued = issueCode({ designNo: req.design, size: req.size, positions: q.lines.map((l) => l.stoneNo), totalThb: q.total, pricedAtSec });
  // L7: secret หาย (503) แยกจาก fields ผิด (บั๊กฝั่งเรา → 500) — ไม่ปนกัน
  if (!issued.ok) return issued.reason === "secret" ? { kind: "secret" } : { kind: "error", code: "fields" };
  const pricedAtLabel = formatThaiDateBkk(q.pricedAt);
  return {
    kind: "ok",
    body: {
      ok: true,
      code: issued.code,
      total: q.total,
      body: q.body,
      design: q.design,
      lines: q.lines,
      groups,
      pricedAt: q.pricedAt,
      pricedAtLabel,
      qrText: issued.code,
      lineText: buildLineText({ stoneCount: q.lines.length, design: q.design, size: req.size, lines: q.lines, total: q.total, pricedAtLabel, code: issued.code }),
    },
  };
}
