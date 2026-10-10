// lib/marketing/rpc-messages.ts — แปลง error จาก RPC ของ workflow content เป็นข้อความไทยที่เจ้าของอ่านรู้เรื่อง
// (content-ui-build-plan.md §5.7 + ภาคผนวก B)
//
// หลักการ:
//  1. ตัดคำนำหน้า `ชื่อฟังก์ชัน:` ที่ RPC ใส่มาใน raise ทุกอัน
//  2. จับ pattern ที่รู้จัก (rules ด้านล่าง) → ข้อความมาตรฐาน
//  3. ไม่รู้จัก → ล้าง enum ดิบ / identifier / ชื่อคอลัมน์ ออก แล้วใช้ถ้า "สะอาดและเป็นไทย" · ไม่งั้นใช้ข้อความตามรหัส
//  4. ห้ามรั่ว: ชื่อฟังก์ชัน (`content_piece_advance`) · enum ดิบ (`in_review`) · ชื่อคอลัมน์ (`piece_kind`) · `analytics.` · `p_*`
//
// Pure module — ไม่มี import ที่ผูก server (ใช้ได้ทั้ง server action, client component, vitest)

import { readErrorCode, readErrorMessage } from "@/lib/supabase/postgrest-error";
import {
  CHANNEL_LABEL,
  CUSTOMER_GROUP_LABEL,
  FOOTAGE_STATUS_LABEL,
  GATE_KIND_LABEL,
  GATE_STATUS_LABEL,
  PIECE_KIND_LABEL,
  PIECE_STATUS_LABEL,
  SHOOT_LOCATION_LABEL,
} from "@/lib/marketing/piece-labels";

export interface DescribedRpcError {
  message: string;
  /** SQLSTATE หรือรหัสของ PostgREST (undefined ถ้าไม่มี เช่น เครือข่ายล่ม) */
  code: string | undefined;
  /** หน้านี้เก่ากว่า DB (สถานะ/ข้อมูลเปลี่ยนไปแล้ว) — ผู้เรียกควร router.refresh() และไม่แสดงเป็นความผิดพลาดแดงน่ากลัว */
  stale: boolean;
  /** ซ้ำ (23505) */
  duplicate: boolean;
}

export interface RpcErrorOptions {
  /** ข้อความเมื่อเจอ 23505 — ขึ้นกับบริบท (ลิงก์/ยอด/โพสต์) */
  duplicate?: string;
}

const GENERIC_BY_CODE: Record<string, string> = {
  "55000": "ทำรายการนี้ไม่ได้ในสถานะปัจจุบัน — รีเฟรชแล้วลองใหม่",
  "22023": "ข้อมูลที่กรอกไม่ถูกต้อง — ตรวจแล้วลองใหม่",
  "42501": "เฉพาะเจ้าของร้านทำรายการนี้ได้",
  "23505": "มีรายการนี้อยู่แล้ว",
};

interface Rule {
  /** ผูกกับรหัส (ไม่ระบุ = ทุกรหัส) */
  code?: string;
  test: RegExp;
  message: string;
  stale?: boolean;
}

// ลำดับสำคัญ: เฉพาะเจาะจงก่อนกว้าง
const RULES: Rule[] = [
  // ---- 55000: สถานะ/ลำดับ ----
  { code: "55000", test: /ตอบแล้ว/, message: "ข้อเสนอนี้ตอบไปแล้ว", stale: true },
  {
    code: "55000",
    test: /ข้อมูลแคมเปญเปลี่ยนแล้ว|ข้อเสนอเปลี่ยนไปแล้ว|ข้อมูลข้อเสนอเปลี่ยนแล้ว|ป้ายที่ระบบคำนวณเปลี่ยนไปแล้ว/,
    message: "ข้อมูลเปลี่ยนไประหว่างที่เปิดหน้า — โหลดใหม่ก่อนยืนยัน (ข้อความที่พิมพ์ไว้ยังอยู่)",
    stale: true,
  },
  {
    code: "55000",
    test: /ชิ้นงานรอเงื่อนไขอยู่/,
    message: "ชิ้นงานรอเงื่อนไขอยู่ — กด 'กลับมาทำต่อ' ก่อน",
    stale: true, // หน้านี้ยังไม่รู้ว่าชิ้นถูกพักในอีกแท็บ
  },
  { code: "55000", test: /อยู่สถานะ.+แล้ว|ถูกยกเลิกแล้ว|ไม่ได้ถูกยกเลิก|อยู่สถานะยกเลิกแล้ว/, message: "ชิ้นนี้เปลี่ยนสถานะไปแล้ว — รีเฟรชเพื่อดูล่าสุด", stale: true },
  { code: "55000", test: /เดินหน้าได้ทีละขั้น|ย้อนได้ทีละ|ย้อนได้เฉพาะไป|จาก .+ ไป .+ ไม่ได้/, message: "เปลี่ยนสถานะแบบนี้ไม่ได้ในตอนนี้ — รีเฟรชแล้วลองใหม่", stale: true },
  { code: "55000", test: /ลบยอดไม่ได้|แก้ยอดต้องผ่าน|เกิน 30 วัน/, message: "แก้ยอดย้อนหลังเกิน 30 วันไม่ได้ — แจ้งทีม" },
  {
    code: "55000",
    test: /อนุมัติแล้ว ห้ามแก้|อนุมัติแล้ว แก้ .+ ไม่ได้/,
    message: "อนุมัติแล้วแก้เนื้อหาไม่ได้ — ส่งกลับก่อน",
    stale: true, // BUG-QA-3: หน้ายังโชว์โหมดแก้ของชิ้นที่อนุมัติไปแล้วในอีกแท็บ → ต้อง refresh
  },
  {
    code: "55000",
    test: /เลื่อนวันหลังวางแผนแล้ว/,
    message: "เลื่อนวันหลังวางแผนแล้วต้องใช้ปุ่ม 'เลื่อน' (ต้องมีเหตุผล)",
    stale: true, // หน้ายังเป็นสถานะก่อนวางแผน
  },
  // ---- โพสต์ ----
  { code: "55000", test: /ที่ใช้งานอยู่แล้ว/, message: "ชิ้นนี้มีโพสต์ของช่องทางนี้อยู่แล้ว — ปลดโพสต์เดิมก่อนถ้าต้องวางลิงก์ใหม่", stale: true },
  { code: "55000", test: /ผูกกับชิ้นนี้อยู่แล้ว/, message: "ลิงก์นี้ผูกกับชิ้นนี้อยู่แล้ว", stale: true },
  { code: "55000", test: /ผูกกับชิ้นงานอื่น|ผูกกับเอกสารของชิ้นงานอื่น|เพิ่งถูกผูกกับชิ้นงานอื่น/, message: "ลิงก์นี้ผูกกับชิ้นงานอื่นอยู่แล้ว" },
  { code: "55000", test: /โพสต์ได้เฉพาะชิ้นที่อนุมัติแล้ว/, message: "โพสต์ได้เฉพาะชิ้นที่อนุมัติแล้ว — รีเฟรชแล้วลองใหม่", stale: true },
  { code: "55000", test: /ชิ้นนี้โพสต์แล้ว/, message: "ชิ้นนี้โพสต์แล้ว — เพิ่มโพสต์ใบที่ 2 ได้เฉพาะชิ้น FB/IG", stale: true },
  // ---- 22023: อินพุต ----
  { code: "22023", test: /ต้องมีแหล่งอ้างอิงอย่างน้อย 1 ลิงก์/, message: "ผ่านได้ต้องมีลิงก์แหล่งอ้างอิงอย่างน้อย 1 ลิงก์" },
  { code: "22023", test: /ลิงก์แหล่งอ้างอิงไม่ถูกต้อง/, message: "ลิงก์ไม่ถูกต้อง (ต้องขึ้นต้นด้วย http:// หรือ https://)" },
  { code: "22023", test: /ลิงก์โพสต์ไม่ถูกต้อง/, message: "ลิงก์โพสต์ไม่ถูกต้อง — คัดลอกลิงก์จากหน้าโพสต์มาวางใหม่" },
  { code: "22023", test: /ตัวเลขยอด.ผู้ติดตามต้องอยู่ระหว่าง/, message: "ตัวเลขต้องอยู่ระหว่าง 0 ถึง 10,000,000,000 (ไม่เห็นให้เว้นว่าง · เห็นเป็น 0 จริงใส่ 0 ได้)" },
  { code: "22023", test: /ติดธง "ตัวเลขประมาณ" แต่ไม่มีตัวเลข/, message: "ติ๊กว่าตัวเลขเป็นค่าประมาณ แต่ยังไม่ได้ใส่ตัวเลขสักช่อง" },
  { code: "22023", test: /posted_on ต้องไม่หลังวันที่เห็น/, message: "วันที่โพสต์คลิปต้องไม่หลังวันที่เห็น" },
  { code: "22023", test: /seen_on อยู่ในอนาคต/, message: "วันที่เห็นอยู่ในอนาคตไม่ได้" },
  { code: "22023", test: /คลิปอ้างอิงต้องมีลิงก์และ hook_text/, message: "คลิปอ้างอิงต้องมีทั้งลิงก์และประโยคเปิดของคลิป" },
  { code: "22023", test: /summary ต้องมี 1 บรรทัด/, message: "สรุปต้องมี 1–300 ตัวอักษร" },
  { code: "22023", test: /hook_text ยาวเกิน/, message: "ประโยคเปิดยาวเกิน 500 ตัวอักษร" },
  { code: "22023", test: /ลิงก์ยาวเกิน 500/, message: "ลิงก์ยาวเกิน 500 ตัวอักษร" },
  { code: "22023", test: /ลิงก์ไม่ถูกต้อง [(]/, message: "ลิงก์ไม่ถูกต้อง — คัดลอกลิงก์จากแอปมาวางใหม่" },
  { code: "22023", test: /เก็บไว้ก่อนต้องระบุวันกลับมาดู/, message: "เก็บไว้ก่อนต้องเลือกวันกลับมาดู (วันนี้หรืออนาคต)" },
  { code: "22023", test: /เวลาโพสต์อยู่นอกช่วง|เวลาโพสต์ของโพสต์นี้อยู่นอกช่วง/, message: "วันที่โพสต์ไม่ถูกต้อง — ต้องอยู่ระหว่าง 1 ม.ค. 2568 ถึงวันนี้" },
  { code: "22023", test: /ไม่มีค่าเปลี่ยน/, message: "ไม่มีค่าที่เปลี่ยน" },
  { code: "22023", test: /\[ต้องยืนยัน/, message: "คำตอบต้องไม่มี [ต้องยืนยัน…] ค้างอยู่" },
  { code: "22023", test: /อักขระล่องหน/, message: "ข้อความมีอักขระที่มองไม่เห็น — ลบแล้วพิมพ์ใหม่" },
  { code: "22023", test: /ยาวเกิน/, message: "ข้อความยาวเกินกำหนด" },
  { code: "22023", test: /เหตุผล/, message: "ใส่เหตุผลอย่างน้อย 3 ตัวอักษร" },
  { code: "22023", test: /เฉพาะกลุ่ม.+audience_segment|audience_segment/, message: "เลือก 'เฉพาะกลุ่ม' ไม่ได้ — ชิ้นนี้ยังไม่มีกลุ่มลูกค้าที่ตั้งไว้ (ตั้งผ่านหน้ากลุ่มลูกค้าเดิม)" },
];

/** enum ดิบ → ป้ายไทย (ใช้ label map เดียวกับ PieceStatusBadge) */
const ENUM_WORDS: Array<[RegExp, string]> = [
  [/(?<![A-Za-z0-9_])in_review(?![A-Za-z0-9_])/g, PIECE_STATUS_LABEL.in_review],
  [/(?<![A-Za-z0-9_])approved(?![A-Za-z0-9_])/g, PIECE_STATUS_LABEL.approved],
  [/(?<![A-Za-z0-9_])produced(?![A-Za-z0-9_])/g, PIECE_STATUS_LABEL.produced],
  [/(?<![A-Za-z0-9_])posted(?![A-Za-z0-9_])/g, PIECE_STATUS_LABEL.posted],
  [/(?<![A-Za-z0-9_])drafting(?![A-Za-z0-9_])/g, PIECE_STATUS_LABEL.drafting],
  [/(?<![A-Za-z0-9_])planned(?![A-Za-z0-9_])/g, PIECE_STATUS_LABEL.planned],
  [/(?<![A-Za-z0-9_])cancelled(?![A-Za-z0-9_])/g, PIECE_STATUS_LABEL.cancelled],
  [/(?<![A-Za-z0-9_])idea(?![A-Za-z0-9_])/g, PIECE_STATUS_LABEL.idea],
  [/(?<![A-Za-z0-9_])resume(?![A-Za-z0-9_])/g, "กลับมาทำต่อ"],
  [/(?<![A-Za-z0-9_])restore(?![A-Za-z0-9_])/g, "กู้คืน"],
  [/(?<![A-Za-z0-9_])hold(?![A-Za-z0-9_])/g, PIECE_STATUS_LABEL.on_hold],
];

/**
 * ชื่อคอลัมน์/ค่า enum ที่ DB ใส่ในประโยคภาษาไทย → คำไทย (BUG-QA-2)
 * แทนที่จะทิ้งทั้งข้อความเมื่อเหลือ snake_case — เจ้าของควรเห็น "ยังไม่ได้ตั้งวัน" ไม่ใช่ "รีเฟรชแล้วลองใหม่"
 * ยาวก่อนสั้น (เช่น line_audience_reason ก่อน line_audience) เพื่อไม่ให้แทนที่ทับบางส่วน
 */
// เขียนตรงทีละคำ (หนี้ §11 ข้อ 6) — เฉพาะ snake_case + สถานะด่าน 3 คำ · คำอังกฤษเดี่ยว (shot/other/story/na ฯลฯ) อาจอยู่ในประโยคปกติ ห้ามแทนที่
// ค่าไทยตรงกับ label map ใน piece-labels.ts — มีเทสต์เทียบ (rpc-messages.test.ts "IDENT_TH ตรงกับ label map")
const IDENT_TH: Record<string, string> = {
  fact_check: "ข้อเท็จจริง",
  brand_rule: "กฎแบรนด์",
  risk_owner: "ความเสี่ยง",
  short_clip: "คลิปสั้น",
  live_cut: "คลิปตัดจากไลฟ์",
  ig_fb_post: "โพสต์ FB/IG",
  line_message: "ข้อความ LINE",
  line_oa: "LINE OA",
  tiktok_live: "TikTok LIVE",
  parcel_insert: "การ์ดในพัสดุ",
  jewelry_925: "เครื่องประดับ 925",
  silver_bar: "เงินแท่ง",
  needs_shoot: "ต้องถ่าย",
  has_footage: "มีภาพแล้ว",
  product_table: "โต๊ะถ่ายสินค้า",
  host_cam: "กล้องโฮสต์",
  pending: "รอตรวจ",
  passed: "ผ่าน",
  blocked: "ติด",
  piece_kind: "ชนิดชิ้นงาน",
  metric_code: "ตัวชี้วัด",
  baseline_value: "ค่าฐาน",
  baseline_as_of: "วันที่ของค่าฐาน",
  baseline_spread: "ช่วงแกว่ง",
  pass_threshold: "เกณฑ์ผ่าน",
  pass_op: "ทิศของเกณฑ์",
  customer_group: "กลุ่มลูกค้า",
  line_audience_reason: "เหตุผลของผู้รับ LINE",
  line_audience: "ผู้รับ LINE",
  audience_segment: "กลุ่มลูกค้าเป้าหมาย",
  footage_status: "สถานะภาพ",
  footage_url: "ลิงก์ไฟล์ภาพ",
  shoot_location: "สถานที่ถ่าย",
  shoot_minutes_est: "เวลาประเมินถ่ายทำ",
  shoot_date: "วันถ่าย",
  shoot_note: "หมายเหตุถ่ายทำ",
  expected_host_id: "โฮสต์ที่คาด",
  content_type_code: "ประเภทเนื้อหา",
  time_slot: "ช่วงเวลา",
  start_time: "เวลา",
  content_body: "เนื้อหา",
  hook_type: "ประเภท hook",
  step_id: "ชิ้นงาน",
};
const IDENT_RE = new RegExp(
  `(?<![A-Za-z0-9_])(${Object.keys(IDENT_TH)
    .sort((a, b) => b.length - a.length)
    .join("|")})(?![A-Za-z0-9_])`,
  "g"
);

/** ข้อความที่ดูเป็น error ทางเทคนิค (SQL/stack/constraint) — ห้ามโชว์แม้จะมีภาษาไทยปน */
const TECHNICAL_RE =
  /\b(select|insert into|update\s+\w+\s+set|delete from|syntax error|violates|constraint|stack|traceback|permission denied|pg_)\b|ERROR:|\bat\s+\w+\.\w+\(|relation ".*" does not exist/i;

const THAI = /[฀-๿]/;
const MAX_LEN = 300;

/** ล้างข้อความดิบจาก RPC: prefix ชื่อฟังก์ชัน · enum · identifier ในวงเล็บ · ชื่อโมดูล */
export function sanitizeRpcText(raw: string): string {
  let t = raw.trim();
  t = t.replace(/^[a-z][a-z0-9_]*:\s*/i, ""); // `content_piece_advance: `
  t = t.replace(/\s*\([a-z][a-z0-9_.]*(?:\s*,\s*[a-z][a-z0-9_.]*)*\)/gi, ""); // `(piece_kind)` `(a, b)` — ล้างก่อนแปลง enum
  for (const [re, label] of ENUM_WORDS) t = t.replace(re, label);
  t = t.replace(IDENT_RE, (m) => IDENT_TH[m] ?? m);
  t = t.replace(/\banalytics\.[a-z0-9_]+/gi, "");
  t = t.replace(/\b(?:content|campaign|recommendation|live)_[a-z0-9_]+/gi, "");
  t = t.replace(/\bp_[a-z0-9_]+/gi, "");
  return t.replace(/\s{2,}/g, " ").replace(/\s+([,.;:])/g, "$1").trim();
}

/** ข้อความสะอาดพอจะโชว์ไหม: ยังมีตัวอักษรไทย · ไม่เหลือ snake_case · ไม่ยาวเกิน */
function isShowable(text: string): boolean {
  if (!text || text.length > MAX_LEN) return false;
  if (!THAI.test(text)) return false;
  if (/[a-z]+_[a-z_]+/i.test(text)) return false;
  if (/analytics\./i.test(text)) return false;
  if (TECHNICAL_RE.test(text)) return false;
  return true;
}

export function describeRpcError(err: unknown, fallback: string, opts: RpcErrorOptions = {}): DescribedRpcError {
  const code = readErrorCode(err);
  const rawMsg = readErrorMessage(err);

  if (code === "42501") {
    return { message: GENERIC_BY_CODE["42501"], code, stale: false, duplicate: false };
  }
  if (code === "23505") {
    return { message: opts.duplicate ?? GENERIC_BY_CODE["23505"], code, stale: false, duplicate: true };
  }

  const stripped = rawMsg.replace(/^[a-z][a-z0-9_]*:\s*/i, "");
  for (const rule of RULES) {
    if (rule.code && rule.code !== code) continue;
    if (rule.test.test(stripped)) {
      return { message: rule.message, code, stale: rule.stale === true, duplicate: false };
    }
  }

  if (code === "55000") {
    // 55000 = ข้อความ "ภาษาเจ้าของ" (ด่านไม่ผ่าน/รายการที่ขาด) → ใช้ถ้าสะอาด ไม่งั้นข้อความมาตรฐาน
    const cleaned = sanitizeRpcText(rawMsg);
    return { message: isShowable(cleaned) ? cleaned : GENERIC_BY_CODE["55000"], code, stale: false, duplicate: false };
  }
  if (code === "22023") {
    return { message: GENERIC_BY_CODE["22023"], code, stale: false, duplicate: false };
  }

  // ไม่มีรหัส/รหัสอื่น (เครือข่าย · PostgREST · constraint) — ไม่เดา ใช้ fallback ของ action
  return { message: fallback, code, stale: false, duplicate: false };
}

/** ข้อความไทยพร้อมแสดง (ใช้ทุก server action ใน workflow นี้) */
export function humanizeRpcError(err: unknown, fallback = "บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง", opts: RpcErrorOptions = {}): string {
  return describeRpcError(err, fallback, opts).message;
}
