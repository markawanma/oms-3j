// lib/ring-builder/admin-server.ts — ชั้นกลางของ action หลังบ้านออกแบบแหวน (server-only · ไม่ใช่ "use server")
//  - adminRpc(): ใส่ p_shop_id (env) + p_actor (session user id ฝั่ง server) "หลัง" พารามิเตอร์ธุรกิจ → client ทับไม่ได้ · error: log เฉพาะ code+hint (ห้าม log ทั้งก้อน)
//  - mapAdminCatalog(): ประกอบ AdminCatalog ทีละ field จากผล rb_admin_catalog
//  - checkCodeText(): ข้อความทั้งก้อน → ดึงรหัส → check char → HMAC → rb_code_check → 8 สถานะ (ระบบตรวจไม่ได้ ≠ รหัสผิด)
// 🔴 ห้ามอยู่ในกราฟ runtime ของหน้า/route สาธารณะ (boundary.test.ts)
import "server-only";
import { getServiceClient } from "@/lib/supabase/server";
import { getDevShopId } from "@/lib/dev/context";
import { getSessionUser } from "@/lib/auth/session";
import { readErrorCode } from "@/lib/supabase/postgrest-error";
import { CZ_WHITE } from "./config";
import { secToIso } from "./code";
import { verifyCodeFromText } from "./code-sign";
import { stoneLabel } from "./mm";
import { cardImageUrl } from "./catalog-server";
import { buildGroups, formatBaht, formatThaiDateBkk, formatThaiDateTimeBkk } from "./quote-server";
import type { QuoteLine } from "./types";
import type {
  AdminCatalog, AdminCoverageMissing, AdminDesign, AdminOffer, AdminShape, AdminStone, CodeCheckResult, CodeCheckRow, CodeCheckView, CoverageReason, HiddenReason,
} from "./admin-types";

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);
const int = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);

export type AdminResult<T> = { ok: true; data: T } | { ok: false; error: string; code?: string };
const GENERIC = "ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง";

/** hint ของ RPC (snake_case) → ข้อความไทย · ไม่รู้จัก = ข้อความกลาง (ไม่ echo ข้อความดิบของ DB) */
const HINT_MESSAGES: Record<string, string> = {
  name_invalid: "ชื่อไม่ถูกต้อง (ยาวเกิน/สั้นเกิน/มีอักขระซ่อน)",
  short_name_invalid: "ชื่อสั้น (แถบตำแหน่ง) ต้องยาว 1-6 ตัวอักษร",
  color_invalid: "สีต้องเป็นรหัส #RRGGBB",
  name_dup: "มีรายการชื่อนี้อยู่แล้ว",
  not_found: "ไม่พบรายการนี้",
  size_invalid: "ขนาดต้องอยู่ระหว่าง 0.50-20.00 มม.",
  size_range_invalid: "ช่วงไซซ์ต้องอยู่ใน 45-68 และต่ำสุดไม่เกินสูงสุด",
  stone_count_invalid: "จำนวนเม็ดต้องเป็น 3-7",
  shape_dims_invalid: "ขนาดไม่ตรงกับทรง (ทรงกลมต้องกว้าง = ยาว · ทรงไข่ต้องยาวกว่ากว้าง)",
  axis_required: "ทรงไข่ต้องระบุทิศเม็ด",
  axis_not_allowed: "ทรงกลมไม่มีทิศเม็ด",
  design_locked: "แบบนี้เปิดขายแล้ว — แก้จำนวนเม็ด/ทรง/ขนาดเม็ด/ทิศเม็ดไม่ได้ ให้ทำสำเนาเป็นแบบใหม่",
  model_bound: "แบบนี้มีโมเดลผูกอยู่ — แก้จำนวนเม็ดไม่ได้",
  shape_kind_locked: "รูปร่างของทรงแก้ไม่ได้ (สร้างทรงใหม่)",
  render_kind_invalid: "ต้องเลือกรูปร่างที่ระบบรองรับ (กลม/ไข่)",
  price_invalid: "ราคาต้องเป็นจำนวนเต็มบาทในช่วงที่กำหนด",
  price_too_fast: "ตั้งราคาถี่เกินไป รอสักครู่แล้วลองใหม่",
  price_required: "ตั้งราคาตัวเรือนก่อนเปิดขาย",
  shape_inactive: "ทรงพลอยของแบบนี้ปิดอยู่ — เปิดทรงก่อน",
  not_published: "แบบนี้ยังไม่เคยเปิดขาย — ใช้ปุ่ม \"เปิดขาย\"",
  path_invalid: "รูปการ์ดไม่ถูกต้อง",
  design_no_exhausted: "เลขแบบเต็มแล้ว",
  stone_no_exhausted: "เลขพลอยเต็มแล้ว",
  actor_required: "ต้องเข้าสู่ระบบก่อนทำรายการ",
  rb_actor_forbidden: "เฉพาะเจ้าของร้าน/แอดมินเท่านั้น",
  invalid: "ข้อมูลไม่ถูกต้อง",
  sort_invalid: "ลำดับไม่ถูกต้อง",
  count_mismatch: "จำนวนเม็ดไม่ตรงกับแบบ",
  stone_locked: "พลอยนี้เคยมีราคาขายแล้ว — แก้ชื่อ/สีไม่ได้ (เพิ่มพลอยใหม่แทน)",
};

export function adminErrorMessage(hint: string | null): string {
  return (hint && HINT_MESSAGES[hint]) || GENERIC;
}

function readHint(err: unknown): string | null {
  if (!isObj(err)) return null;
  const h = err.hint;
  return typeof h === "string" && /^[a-z][a-z0-9_]{1,40}$/.test(h) ? h : null;
}

/** id ผู้ใช้จาก session ฝั่ง server (ไม่รับจาก client) */
async function actorId(): Promise<string | null> {
  try {
    return (await getSessionUser())?.id ?? null;
  } catch {
    return null;
  }
}

export async function adminRpc<T = unknown>(fn: string, params: Record<string, unknown>): Promise<AdminResult<T>> {
  const actor = await actorId();
  if (!actor) return { ok: false, error: "ต้องเข้าสู่ระบบก่อนทำรายการ", code: "actor_required" };
  try {
    const { data, error } = await getServiceClient().schema("analytics").rpc(fn, { ...params, p_shop_id: getDevShopId(), p_actor: actor });
    if (error) throw error;
    return { ok: true, data: data as T };
  } catch (err) {
    const hint = readHint(err);
    // 🔴 log เฉพาะ fn + SQLSTATE + hint (รูปร่างปลอดภัย) — ไม่ log error ทั้งก้อน/พารามิเตอร์
    console.error("ring-builder admin rpc failed", { fn, code: readErrorCode(err) ?? "(none)", hint: hint ?? "(none)" });
    return hint ? { ok: false, error: adminErrorMessage(hint), code: hint } : { ok: false, error: GENERIC };
  }
}

// ---------------------------------------------------------------------------
// admin catalog mapper
// ---------------------------------------------------------------------------
const HIDDEN: readonly HiddenReason[] = ["draft", "closed", "shape_closed", "no_price"];
const COVERAGE: readonly CoverageReason[] = ["stone_closed", "no_offer", "offer_closed", "no_price"];

function mapShape(r: unknown): AdminShape | null {
  if (!isObj(r)) return null;
  const id = str(r.id), nameTh = str(r.name_th), sort = int(r.sort), changed = str(r.status_changed_at), active = bool(r.is_active);
  const ua = int(r.used_by_active_designs), ut = int(r.used_by_designs);
  if (!id || !nameTh || sort === null || !changed || active === null || ua === null || ut === null) return null;
  if (r.render_kind !== "round" && r.render_kind !== "oval") return null;
  return { id, nameTh, renderKind: r.render_kind, isActive: active, sort, usedByActiveDesigns: ua, usedByDesigns: ut, statusChangedAt: changed };
}

function mapDesign(r: unknown, supabaseUrl: string | undefined): AdminDesign | null {
  if (!isObj(r)) return null;
  const id = str(r.id), name = str(r.name), shapeId = str(r.shape_id), shapeName = str(r.shape_name), changed = str(r.status_changed_at);
  const no = int(r.design_no), count = int(r.stone_count), major = int(r.major_mm100), minor = int(r.minor_mm100), smin = int(r.size_min), smax = int(r.size_max), sort = int(r.sort), sellable = int(r.sellable_stones);
  const active = bool(r.is_active), published = bool(r.published), locked = bool(r.locked), visible = bool(r.visible), shapeActive = bool(r.shape_active);
  if (!id || !name || !shapeId || !shapeName || !changed || no === null || count === null || major === null || minor === null || smin === null || smax === null || sort === null || sellable === null) return null;
  if (active === null || published === null || locked === null || visible === null || shapeActive === null) return null;
  if (r.shape_kind !== "round" && r.shape_kind !== "oval") return null;
  const hidden = r.hidden_reason === null ? null : (HIDDEN as readonly unknown[]).includes(r.hidden_reason) ? (r.hidden_reason as HiddenReason) : undefined;
  if (hidden === undefined) return null;
  const axis = r.stone_axis === "along_row" || r.stone_axis === "across_row" ? r.stone_axis : null;
  return {
    id, designNo: no, name, stoneCount: count, shapeId, shapeName, shapeKind: r.shape_kind, shapeActive,
    stoneMm100: { major, minor }, stoneLabel: stoneLabel(major, minor), stoneAxis: axis, sizeMin: smin, sizeMax: smax,
    bodyPriceThb: int(r.body_price_thb), cardImageUrl: cardImageUrl(r.card_image_path, supabaseUrl),
    isActive: active, published, locked, visible, hiddenReason: hidden, statusChangedAt: changed, statusChangedLabel: formatThaiDateBkk(changed), sort, sellableStones: sellable,
  };
}

function mapOffer(r: unknown): AdminOffer | null {
  if (!isObj(r)) return null;
  const id = str(r.id), shapeId = str(r.shape_id), shapeName = str(r.shape_name), major = int(r.major_mm100), minor = int(r.minor_mm100), active = bool(r.is_active);
  if (!id || !shapeId || !shapeName || major === null || minor === null || active === null) return null;
  return { id, shapeId, shapeName, stoneMm100: { major, minor }, stoneLabel: stoneLabel(major, minor), isActive: active, priceThb: int(r.price_thb) };
}

function mapMissing(r: unknown): AdminCoverageMissing | null {
  if (!isObj(r)) return null;
  const no = int(r.design_no), name = str(r.design_name), count = int(r.stone_count), shape = str(r.shape_name), major = int(r.major_mm100), minor = int(r.minor_mm100);
  if (no === null || !name || count === null || !shape || major === null || minor === null || !(COVERAGE as readonly unknown[]).includes(r.reason)) return null;
  return { designNo: no, designName: name, stoneCount: count, shapeName: shape, stoneLabel: stoneLabel(major, minor), reason: r.reason as CoverageReason };
}

function mapStone(r: unknown): AdminStone | null {
  if (!isObj(r) || !isObj(r.coverage)) return null;
  const id = str(r.id), no = int(r.stone_no), name = str(r.name_th), short = str(r.short_name), color = str(r.color_hex), active = bool(r.is_active), sort = int(r.sort);
  const vis = int(r.coverage.visible_designs), sell = int(r.coverage.sellable_designs);
  if (!id || no === null || !name || !short || !color || active === null || sort === null || vis === null || sell === null) return null;
  if (!Array.isArray(r.offers) || !Array.isArray(r.coverage.missing)) return null;
  return {
    id, stoneNo: no, nameTh: name, shortName: short, colorHex: color, isActive: active, sort,
    offers: r.offers.map(mapOffer).filter((x): x is AdminOffer => x !== null),
    coverage: { visibleDesigns: vis, sellableDesigns: sell, missing: r.coverage.missing.map(mapMissing).filter((x): x is AdminCoverageMissing => x !== null) },
  };
}

export function mapAdminCatalog(raw: unknown, supabaseUrl: string | undefined): AdminCatalog | null {
  if (!isObj(raw) || !isObj(raw.sizes) || !Array.isArray(raw.shapes) || !Array.isArray(raw.designs) || !Array.isArray(raw.stones)) return null;
  const at = str(raw.catalog_at), smin = int(raw.sizes.min), smax = int(raw.sizes.max);
  if (!at || smin === null || smax === null) return null;
  return {
    catalogAt: at,
    sizes: { min: smin, max: smax },
    shapes: raw.shapes.map(mapShape).filter((x): x is AdminShape => x !== null),
    designs: raw.designs.map((d) => mapDesign(d, supabaseUrl)).filter((x): x is AdminDesign => x !== null),
    stones: raw.stones.map(mapStone).filter((x): x is AdminStone => x !== null),
  };
}

// ---------------------------------------------------------------------------
// ตรวจรหัส
// ---------------------------------------------------------------------------
interface CheckLineRaw {
  pos: number;
  stoneNo: number;
  name: string | null;
  price: number | null;
  active: boolean;
}

function mapCheckLines(v: unknown, current: boolean): CheckLineRaw[] | null {
  if (!Array.isArray(v)) return null;
  const out: CheckLineRaw[] = [];
  for (const l of v) {
    if (!isObj(l)) return null;
    const pos = int(l.pos), stoneNo = int(l.stone_no);
    if (pos === null || stoneNo === null) return null;
    const price = l.price === null ? null : int(l.price);
    if (l.price !== null && price === null) return null;
    out.push({ pos, stoneNo, name: stoneNo === 0 ? CZ_WHITE.name : str(l.name), price: stoneNo === 0 ? 0 : price, active: current ? l.stone_active !== false && l.offer_active !== false : true });
  }
  return out;
}

const diff = (a: number | null, b: number | null): number | null => (a === null || b === null ? null : b - a);

/** แปลงผล rb_code_check → CodeCheckResult (pure · ทดสอบได้) */
export function buildCodeCheckResult(raw: unknown, code: string, signedTotal: number, size: number | null, nowMs: number): CodeCheckResult {
  const unavailable: CodeCheckResult = { status: "unavailable", view: null };
  if (!isObj(raw) || raw.ok !== true) return unavailable;
  // HMAC ถูกแต่ DB ไม่รู้จักแบบนี้ = ผิดปกติฝั่งระบบ ไม่ใช่ "รหัสผิด"
  if (raw.found !== true) return unavailable;
  const d = raw.design, c = raw.creation, n = raw.current;
  if (!isObj(d) || !isObj(c) || !isObj(n)) return unavailable;
  const designNo = int(d.no), count = int(d.stone_count), major = int(d.major_mm100), minor = int(d.minor_mm100), smin = int(d.size_min), smax = int(d.size_max);
  const name = str(d.name), shapeName = str(d.shape_name), changedAt = str(d.status_changed_at), pricedAt = str(c.at);
  const designActive = bool(d.is_active);
  // M1: ทรงที่ปิดแล้ว = ขายแบบนี้ไม่ได้ แม้แบบเองยังเปิด — ต้องอ่านสถานะทรงด้วย (ไม่มี = ตรวจไม่ได้ ไม่เดาว่าเปิด)
  const shapeActive = bool(d.shape_active);
  const shapeChangedAt = str(d.shape_status_changed_at);
  const cLines = mapCheckLines(c.lines, false), nLines = mapCheckLines(n.lines, true);
  if (designNo === null || count === null || major === null || minor === null || smin === null || smax === null || !name || !shapeName || !changedAt || !pricedAt || designActive === null || shapeActive === null || !cLines || !nLines) return unavailable;
  if (cLines.length !== nLines.length) return unavailable;
  const sizeStatus = raw.size_status;
  if (sizeStatus !== "ok" && sizeStatus !== "admin_check" && sizeStatus !== "out_of_range") return unavailable;

  const cBody = int(c.body), nBody = int(n.body);
  const cTotal = c.complete === true ? int(c.total) : null;
  const nTotal = n.complete === true ? int(n.total) : null;
  const historyOk = raw.signed_total_match === true;

  const lines: QuoteLine[] = cLines.map((l) => ({ pos: l.pos, stoneNo: l.stoneNo, name: l.name ?? "", priceThb: l.price ?? 0 }));
  const cGroups = buildGroups(lines);
  const rows: CodeCheckRow[] = [{ label: "ตัวเรือน", count: null, included: false, creationThb: cBody, currentThb: nBody, diffThb: diff(cBody, nBody) }];
  for (const g of cGroups) {
    if (g.stoneNo === 0) {
      rows.push({ label: g.name, count: g.count, included: true, creationThb: null, currentThb: null, diffThb: null });
      continue;
    }
    const cs = cLines.filter((l) => l.stoneNo === g.stoneNo);
    const ns = nLines.filter((l) => l.stoneNo === g.stoneNo);
    const cSum = cs.every((l) => l.price !== null) ? cs.reduce((s, l) => s + (l.price as number), 0) : null;
    const nSum = ns.every((l) => l.price !== null) ? ns.reduce((s, l) => s + (l.price as number), 0) : null;
    rows.push({ label: g.name, count: g.count, included: false, creationThb: cSum, currentThb: nSum, diffThb: diff(cSum, nSum) });
  }

  const closedStones: { stoneNo: number; name: string }[] = [];
  if (Array.isArray(raw.closed_stones)) {
    for (const s of raw.closed_stones) {
      if (isObj(s) && int(s.stone_no) !== null && str(s.name)) closedStones.push({ stoneNo: s.stone_no as number, name: s.name as string });
    }
  }
  const closedNos = new Set(closedStones.map((s) => s.stoneNo));
  const posText = lines.map((l) => `${l.pos} ${l.name}`).join(" · ");
  const pricedAtMs = Date.parse(pricedAt);
  const pricedLabel = formatThaiDateBkk(pricedAt);
  const sizeText = size === null ? "รอแอดมินช่วยเช็ก" : `เบอร์ ${size}`;
  const total = diff(cTotal, nTotal);

  const view: CodeCheckView = {
    code, designNo, designName: name, stoneCount: count, shapeName, stoneLabel: stoneLabel(major, minor), size,
    sizeStatus, sizeMin: smin, sizeMax: smax, pricedAt, pricedAtLabel: formatThaiDateTimeBkk(pricedAt),
    ageDays: Number.isFinite(pricedAtMs) ? Math.max(0, Math.floor((nowMs - pricedAtMs) / 86_400_000)) : 0,
    designActive, designClosedLabel: designActive ? null : formatThaiDateBkk(changedAt),
    shapeActive,
    // วันที่ปิดตามตัวที่ปิดจริง: แบบปิดก่อน (ถ้าปิดทั้งคู่) ไม่งั้นทรง
    closedLabel: !designActive ? formatThaiDateBkk(changedAt) : !shapeActive && shapeChangedAt ? formatThaiDateBkk(shapeChangedAt) : null,
    closedBy: !designActive ? "design" : !shapeActive ? "shape" : null,
    lines: cLines.map((l) => ({ pos: l.pos, stoneNo: l.stoneNo, name: l.name ?? "", closedNow: closedNos.has(l.stoneNo) })),
    rows, creationTotalThb: cTotal, currentTotalThb: nTotal, diffTotalThb: total, signedTotalThb: signedTotal, historyMatchesSignedTotal: historyOk, closedStones,
    summaryText: [
      `รหัส ${code}`,
      `แบบ: แถว ${count} เม็ด ${name} (พลอย${shapeName} ${stoneLabel(major, minor)} มม.)`,
      `ไซซ์: ${sizeText}`,
      `พลอย (นับซ้ายไปขวา): ${posText}`,
      `ราคา ณ ตอนสร้าง ${formatBaht(signedTotal)} (${pricedLabel})`,
    ].join("\n"),
    priceNoticeText: nTotal !== null
      ? `ราคาแหวนตามแบบที่ออกแบบไว้ตอนนี้ ${formatBaht(nTotal)} (ตอนออกแบบ ${formatBaht(signedTotal)} ณ ${pricedLabel}) รบกวนยืนยันว่าจะให้ดำเนินการต่อไหมคะ/ครับ`
      : "",
  };

  let status: CodeCheckResult["status"];
  const sellableNow = designActive && shapeActive;
  if (!sellableNow) status = "design_closed";
  // L1: ไซซ์นอกช่วงของแบบ = ต้องให้แอดมินตัดสินใจ ไม่ใช่ "ok"
  else if (sizeStatus === "out_of_range" || closedStones.length > 0 || !historyOk || (total !== null && total !== 0) || cTotal === null || nTotal === null || (view.rows[0].diffThb ?? 0) !== 0) status = "changed";
  else status = "ok";
  return { status, view };
}

/** ข้อความทั้งก้อน → ผลตรวจ 8 สถานะ · secret หาย/DB ล้ม = unavailable (ห้ามบอกว่ารหัสผิด) */
export async function checkCodeText(text: string): Promise<CodeCheckResult> {
  const v = verifyCodeFromText(text);
  switch (v.status) {
    case "empty":
    case "not_found":
    case "not_issued":
      return { status: v.status, view: null };
    case "bad_format":
      return { status: "bad_format", view: null };
    case "unavailable":
      return { status: "unavailable", view: null };
    case "valid":
      break;
  }
  const f = v.fields;
  const res = await adminRpc<unknown>("rb_code_check", {
    p_design_no: f.designNo,
    p_size: f.size,
    p_positions: f.positions,
    p_priced_at: secToIso(f.pricedAtSec),
    p_signed_total: f.totalThb,
  });
  if (!res.ok) return { status: "unavailable", view: null };
  return buildCodeCheckResult(res.data, v.code, f.totalThb, f.size, Date.now());
}
