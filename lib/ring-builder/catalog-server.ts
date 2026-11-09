// lib/ring-builder/catalog-server.ts — อ่าน rb_public_catalog (INVOKER · service_role) แล้วประกอบ PublicCatalog "ทีละ field"
// 🔴 ห้าม spread/คัดลอก object ดิบจาก DB — field ใหม่ในอนาคตต้องไม่หลุดตามมาฟรีๆ (oem-quote-invariants ข้อ 1) · ค่าที่ผิดรูป = ข้ามแถวนั้น (fail closed)
// ไฟล์นี้อยู่ในกราฟของหน้าสาธารณะ — ห้าม import lib/actions/** · ไฟล์ "use server" · lib/jobs/gems* · admin-server.ts (boundary.test.ts)
import "server-only";
import { getServiceClient } from "@/lib/supabase/server";
import { getDevShopId } from "@/lib/dev/context";
import { readErrorCode } from "@/lib/supabase/postgrest-error";
import { MAX_DESIGN_NO, MAX_STONE_NO, RING_BUILDER_SIZES } from "./config";
import { stoneLabel } from "./mm";
import type { PublicCatalog, PublicDesign, PublicOffer, PublicStone, ShapeKind, StoneAxis } from "./types";

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown, lo: number, hi: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
const isStr = (v: unknown, max: number): v is string => typeof v === "string" && v.length >= 1 && v.length <= max;
const CARD_PATH_RE = /^designs\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/;
const HEX_RE = /^#[0-9A-F]{6}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/** path ใน bucket public 'ring-builder' → URL (ไม่มี SUPABASE_URL หรือ path ผิดรูป = null → UI ใช้แผนภาพ) */
export function cardImageUrl(path: unknown, supabaseUrl: string | null | undefined): string | null {
  if (typeof path !== "string" || !CARD_PATH_RE.test(path)) return null;
  if (!supabaseUrl) return null;
  return `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/ring-builder/${path}`;
}

function mapStone(r: unknown): PublicStone | null {
  if (!isObj(r) || !isInt(r.no, 1, MAX_STONE_NO) || !isStr(r.name, 40) || !isStr(r.short_name, 6) || typeof r.color_hex !== "string" || !HEX_RE.test(r.color_hex)) return null;
  return { no: r.no, name: r.name, shortName: r.short_name, colorHex: r.color_hex };
}

function mapOffer(r: unknown): PublicOffer | null {
  if (!isObj(r) || !isInt(r.stone_no, 1, MAX_STONE_NO) || !isInt(r.price_thb, 1, 100000)) return null;
  return { stoneNo: r.stone_no, priceThb: r.price_thb };
}

function mapDesign(r: unknown, supabaseUrl: string | null | undefined): PublicDesign | null {
  if (!isObj(r)) return null;
  const kind: ShapeKind | null = r.shape_kind === "round" || r.shape_kind === "oval" ? r.shape_kind : null;
  const axis: StoneAxis | null = r.stone_axis === "along_row" || r.stone_axis === "across_row" ? r.stone_axis : null;
  if (!kind || !isInt(r.no, 1, MAX_DESIGN_NO) || !isInt(r.stone_count, 3, 7) || !isStr(r.name, 40) || !isStr(r.shape_name, 20)) return null;
  if (!isInt(r.major_mm100, 50, 2000) || !isInt(r.minor_mm100, 50, 2000) || r.major_mm100 < r.minor_mm100) return null;
  if (!isInt(r.size_min, RING_BUILDER_SIZES.min, RING_BUILDER_SIZES.max) || !isInt(r.size_max, RING_BUILDER_SIZES.min, RING_BUILDER_SIZES.max) || r.size_min > r.size_max) return null;
  if (!isInt(r.body_price_thb, 1, 1_000_000) || !Array.isArray(r.offers)) return null;
  if (kind === "oval" && axis === null) return null;
  const offers: PublicOffer[] = [];
  for (const o of r.offers) {
    const m = mapOffer(o);
    if (m) offers.push(m);
  }
  return {
    no: r.no,
    stoneCount: r.stone_count as PublicDesign["stoneCount"],
    name: r.name,
    shape: { kind, name: r.shape_name },
    stoneMm100: { major: r.major_mm100, minor: r.minor_mm100 },
    stoneLabel: stoneLabel(r.major_mm100, r.minor_mm100),
    stoneAxis: kind === "round" ? null : axis,
    sizeMin: r.size_min,
    sizeMax: r.size_max,
    bodyPriceThb: r.body_price_thb,
    cardImageUrl: cardImageUrl(r.card_image_path, supabaseUrl),
    model: { kind: "none" },
    offers,
  };
}

/** แปลงผล rb_public_catalog → PublicCatalog · โครงผิด = null (หน้าแสดง error — ไม่เดา) */
export function mapPublicCatalog(raw: unknown, supabaseUrl: string | null | undefined): PublicCatalog | null {
  if (!isObj(raw) || typeof raw.catalog_at !== "string" || !ISO_RE.test(raw.catalog_at) || !isObj(raw.sizes)) return null;
  if (!Array.isArray(raw.stones) || !Array.isArray(raw.designs)) return null;
  if (!isInt(raw.sizes.min, 1, 200) || !isInt(raw.sizes.max, 1, 200)) return null;
  const stones: PublicStone[] = [];
  for (const s of raw.stones) {
    const m = mapStone(s);
    if (m) stones.push(m);
  }
  const designs: PublicDesign[] = [];
  for (const d of raw.designs) {
    const m = mapDesign(d, supabaseUrl);
    if (m) designs.push(m);
  }
  return { catalogAt: raw.catalog_at, sizes: { min: raw.sizes.min, max: raw.sizes.max }, stones, designs };
}

/** ใช้ที่ page.tsx (server) · ไม่รับ shop จาก client · ล้ม = null + log เฉพาะ code */
export async function getPublicCatalog(): Promise<PublicCatalog | null> {
  try {
    const { data, error } = await getServiceClient().schema("analytics").rpc("rb_public_catalog", { p_shop_id: getDevShopId(), p_at: null });
    if (error) throw error;
    return mapPublicCatalog(data, process.env.SUPABASE_URL);
  } catch (err) {
    console.error("ring-builder catalog failed", { code: readErrorCode(err) ?? "(none)" });
    return null;
  }
}
