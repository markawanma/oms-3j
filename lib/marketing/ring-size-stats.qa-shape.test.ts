// lib/marketing/ring-size-stats.qa-shape.test.ts — QA อิสระ (qa/ring-size-p3): ตัวแปลง jsonb ต้องตรง "shape จริง" ที่ SQL คืน
//
// วิธี: อ่าน supabase/migrations/0193_ring_size_analytics.sql ส่วน 5 → ถอด tree ของ jsonb_build_object ที่ SQL ประกอบเอง
// (ไม่ใช้ fixture ที่ dev เขียนไว้) แล้วเทียบกับ "key ทุกตัวที่ parser อ่านจริง" (Proxy บันทึกการอ่าน)
//   - key ที่ SQL คืนแต่ parser ไม่อ่าน  = section ถูกทิ้งเงียบ (ต้องเป็นศูนย์)
//   - key ที่ parser อ่านแต่ SQL ไม่คืน   = bug (parser คาดของที่ไม่มีจริง ⇒ section เป็น null ตลอดกาล)
// ค่าคงที่ที่ต้องตรงกับ SQL (ลำดับขั้น/ช่วงวัน/ชุด in_app/ช่วงเบอร์) ถูกอ่านจากไฟล์ SQL เช่นกัน ไม่ copy ตัวเลขมาไว้ในเทสต์
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRingSizeStats } from "./ring-size-stats";
import { RING_STATS_MAX_DAYS, RING_STATS_MIN_DAYS } from "./ring-size-filters";
import { RING_IN_APP, RING_SIZE_RANGE, RING_STAGE_MAX } from "@/lib/ring-size/track-schema";

// ---------- ถอด shape จาก SQL ----------
const SQL_FILE = readFileSync(join(process.cwd(), "supabase", "migrations", "0193_ring_size_analytics.sql"), "utf8");

function stripSqlComments(s: string): string {
  // ลบ -- ถึงท้ายบรรทัด (ไม่มี '--' ใน string literal ของส่วนที่เราสนใจ)
  return s
    .split("\n")
    .map((l) => {
      const i = l.indexOf("--");
      return i >= 0 ? l.slice(0, i) : l;
    })
    .join("\n");
}

function statsFunctionBody(): string {
  const start = SQL_FILE.indexOf("create function analytics.ring_size_stats(");
  const end = SQL_FILE.indexOf("comment on function analytics.ring_size_stats(");
  if (start < 0 || end < 0 || end <= start) throw new Error("ไม่พบ analytics.ring_size_stats ใน 0193");
  return stripSqlComments(SQL_FILE.slice(start, end));
}

/** แยก argument ระดับบนสุด (นับวงเล็บ · เคารพ string literal '...') */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inStr = false;
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      cur += c;
      if (c === "'") {
        if (s[i + 1] === "'") {
          cur += "'";
          i++;
        } else inStr = false;
      }
      continue;
    }
    if (c === "'") {
      inStr = true;
      cur += c;
    } else if (c === "(") {
      depth++;
      cur += c;
    } else if (c === ")") {
      depth--;
      cur += c;
    } else if (c === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  if (cur.trim() !== "") out.push(cur);
  return out;
}

/** เนื้อในวงเล็บของ call ที่เริ่มที่ index ของ "name(" */
function callInner(s: string, openIdx: number): { inner: string; end: number } {
  let depth = 0;
  let inStr = false;
  for (let i = openIdx; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === "'") {
        if (s[i + 1] === "'") i++;
        else inStr = false;
      }
      continue;
    }
    if (c === "'") inStr = true;
    else if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return { inner: s.slice(openIdx + 1, i), end: i };
    }
  }
  throw new Error("วงเล็บไม่ครบ");
}

const JBO = "jsonb_build_object(";

/** คืน path ทั้งหมดที่ SQL ประกอบ: ".key" · ".key.sub" · ".arr[]" · ".arr[].sub" */
function collectPaths(objArgs: string, prefix: string, into: Set<string>): void {
  const args = splitTop(objArgs);
  if (args.length % 2 !== 0) throw new Error(`jsonb_build_object จำนวน arg เป็นคี่ที่ ${prefix}`);
  for (let i = 0; i < args.length; i += 2) {
    const km = /^\s*'([^']+)'\s*$/.exec(args[i]);
    if (!km) throw new Error(`key ไม่ใช่ literal: ${args[i].trim().slice(0, 40)}`);
    const path = `${prefix}.${km[1]}`;
    into.add(path);
    const val = args[i + 1].trim();
    if (val.startsWith(JBO)) {
      const { inner } = callInner(val, JBO.length - 1);
      collectPaths(inner, path, into);
    } else if (val.includes("jsonb_agg(")) {
      into.add(`${path}[]`);
      const j = val.indexOf(JBO);
      if (j >= 0) {
        const { inner } = callInner(val, j + JBO.length - 1);
        collectPaths(inner, `${path}[]`, into);
      }
    }
  }
}

function sqlPaths(): Set<string> {
  const body = statsFunctionBody();
  const j = body.indexOf(JBO);
  if (j < 0) throw new Error("ไม่พบ jsonb_build_object ก้อนนอกสุด");
  const { inner } = callInner(body, j + JBO.length - 1);
  const out = new Set<string>();
  collectPaths(inner, "", out);
  return out;
}

// ---------- Proxy บันทึกการอ่านของ parser ----------
function recording(value: unknown, path: string, reads: Set<string>): unknown {
  if (typeof value !== "object" || value === null) return value;
  return new Proxy(value as object, {
    get(target, key, receiver) {
      const v = Reflect.get(target, key, receiver);
      if (typeof key !== "string" || key === "length") return typeof v === "function" ? v.bind(receiver) : v;
      const isIdx = Array.isArray(target) && /^\d+$/.test(key);
      const next = isIdx ? `${path}[]` : `${path}.${key}`;
      reads.add(next);
      return recording(v, next, reads);
    },
  });
}

// ---------- fixture ที่เขียนมือ: ค่าไม่ซ้ำกันทุกช่อง (จับ cross-wiring เช่น a_to_b ↔ b_to_a) ----------
// รูปร่างตามที่ SQL ประกอบ · ตัวเลขเป็นข้อมูลวางโครง ไม่ใช่ข้อมูลจริง
function sqlShapedPayload(): Record<string, unknown> {
  return {
    sessions: 101,
    returning: 7,
    measured: 53,
    shop_range: { min: 45, max: 68 },
    data_since: "2026-10-26",
    by_in_app: { line: 11, tiktok: 12, fb: 13, ig: 14, browser: 15, unknown: 16 },
    funnel: [101, 90, 80, 71, 63, 60, 58, 57],
    abandon_at: [11, 10, 9, 8, 3, 2, 1],
    result_sizes: [
      { size: 50, count: 21 },
      { size: 55, count: 22 },
      { size: 70, count: 3 },
    ],
    size_summary: { below_range: 1, in_range: 43, above_range: 9, between_count: 4 },
    circ_hist: [
      { mm: 52, count: 5 },
      { mm: 53, count: 6 },
    ],
    method: { A: 31, B: 32 },
    method_stats: {
      A: { picked: 41, measured: 42, abandoned_at_measure: 43, invalid_sessions: 44, remeasured: 45, between: null },
      B: { picked: 51, measured: 52, abandoned_at_measure: 53, invalid_sessions: 54, remeasured: 55, between: 56 },
    },
    switched: { a_to_b: 61, b_to_a: 62, both: 63 },
    saw_between: 64,
    ref: { card: 71, coin: 72 },
    method_x_ref: { A_card: 81, A_coin: 82, B_card: 83, B_coin: 84 },
    cta: { line: 91, share: 92, shop: 93, gem_quiz: 94 },
    friction: { zoom_blocked: 17, calib_warn: 18, invalid: 19, stale_recalib: 20, remeasured: 23 },
    daily: [
      { date: "2026-10-26", sessions: 24, measured: 25 },
      { date: "2026-10-27", sessions: 26, measured: 27 },
    ],
  };
}

function pathsOf(v: unknown, prefix = "", into = new Set<string>()): Set<string> {
  if (Array.isArray(v)) {
    into.add(`${prefix}[]`);
    for (const item of v) pathsOf(item, `${prefix}[]`, into);
  } else if (typeof v === "object" && v !== null) {
    for (const [k, val] of Object.entries(v)) {
      into.add(`${prefix}.${k}`);
      pathsOf(val, `${prefix}.${k}`, into);
    }
  }
  return into;
}

const diff = (a: Set<string>, b: Set<string>) => [...a].filter((x) => !b.has(x)).sort();

describe("QA2 — tree จาก SQL (0193 ส่วน 5) vs สิ่งที่ parser อ่านจริง", () => {
  it("SQL ถอด shape ได้ครบ (กันเทสต์ผ่านเพราะถอดไม่เจออะไร): top-level 20 section", () => {
    const paths = sqlPaths();
    const top = [...paths]
      .filter((p) => /^\.[a-z_]+$/.test(p))
      .map((p) => p.slice(1))
      .sort();
    expect(top).toEqual(
      [
        "abandon_at", "by_in_app", "circ_hist", "cta", "daily", "data_since", "friction", "funnel", "measured", "method",
        "method_stats", "method_x_ref", "ref", "result_sizes", "returning", "saw_between", "sessions", "shop_range",
        "size_summary", "switched",
      ].sort()
    );
    expect(paths.size).toBeGreaterThan(55);
  });

  it("fixture ที่ใช้ทดสอบมี path ครบเท่า SQL ทุกตัว (ไม่ขาด ไม่เกิน ยกเว้น [] ของ array ที่ SQL ไม่ระบุสมาชิก)", () => {
    const sql = sqlPaths();
    const fx = pathsOf(sqlShapedPayload());
    expect(diff(sql, fx)).toEqual([]); // SQL มีแต่ fixture ไม่มี
    expect(diff(fx, sql)).toEqual([]); // fixture มีแต่ SQL ไม่มี
  });

  it("parser อ่านทุก path ที่ SQL คืน — ไม่มี section ถูกทิ้งเงียบ", () => {
    const reads = new Set<string>();
    parseRingSizeStats(recording(sqlShapedPayload(), "", reads));
    expect(diff(sqlPaths(), reads)).toEqual([]);
  });

  it("parser ไม่อ่าน key ที่ SQL ไม่คืน (key ที่คาดแต่ไม่มี = section เป็น null ตลอดกาล)", () => {
    const reads = new Set<string>();
    parseRingSizeStats(recording(sqlShapedPayload(), "", reads));
    expect(diff(reads, sqlPaths())).toEqual([]);
  });

  it("parse fixture รูปร่าง SQL ⇒ ทุก section ไม่เป็น null", () => {
    const r = parseRingSizeStats(sqlShapedPayload());
    expect(r).not.toBeNull();
    const nulls = Object.entries(r!).filter(([, v]) => v === null).map(([k]) => k);
    expect(nulls).toEqual([]);
  });

  it("ค่าแต่ละ key ไปถูกช่อง (ค่าไม่ซ้ำกัน ⇒ จับการสลับ a_to_b/b_to_a, A_card/B_card, zoom/calib ฯลฯ)", () => {
    expect(parseRingSizeStats(sqlShapedPayload())).toEqual({
      sessions: 101,
      returning: 7,
      measured: 53,
      shopRange: { min: 45, max: 68 },
      dataSince: "2026-10-26",
      byInApp: { line: 11, tiktok: 12, fb: 13, ig: 14, browser: 15, unknown: 16 },
      funnel: [101, 90, 80, 71, 63, 60, 58, 57],
      abandonAt: [11, 10, 9, 8, 3, 2, 1],
      resultSizes: [
        { size: 50, count: 21 },
        { size: 55, count: 22 },
        { size: 70, count: 3 },
      ],
      sizeSummary: { belowRange: 1, inRange: 43, aboveRange: 9, betweenCount: 4 },
      circHist: [
        { mm: 52, count: 5 },
        { mm: 53, count: 6 },
      ],
      method: { A: 31, B: 32 },
      methodStats: {
        A: { picked: 41, measured: 42, abandonedAtMeasure: 43, invalidSessions: 44, remeasured: 45, between: null },
        B: { picked: 51, measured: 52, abandonedAtMeasure: 53, invalidSessions: 54, remeasured: 55, between: 56 },
      },
      switched: { aToB: 61, bToA: 62, both: 63 },
      sawBetween: 64,
      ref: { card: 71, coin: 72 },
      methodXRef: { aCard: 81, aCoin: 82, bCard: 83, bCoin: 84 },
      cta: { line: 91, share: 92, shop: 93, gemQuiz: 94 },
      friction: { zoomBlocked: 17, calibWarn: 18, invalid: 19, staleRecalib: 20, remeasured: 23 },
      daily: [
        { date: "2026-10-26", sessions: 24, measured: 25 },
        { date: "2026-10-27", sessions: 26, measured: 27 },
      ],
    });
  });

  it("ทีละ section: ทำลาย key เดียวของ section ใด ⇒ เฉพาะ section นั้นเป็น null (ที่เหลือรอด) — ไม่มี section ผูกกันเอง", () => {
    // key ย่อยที่ SQL คืน → ชื่อ field ของผลลัพธ์ที่ต้องกลายเป็น null
    const cases: [string, (p: Record<string, any>) => void, string][] = [
      ["by_in_app.unknown", (p) => delete p.by_in_app.unknown, "byInApp"],
      ["funnel ขาด 1 ช่อง", (p) => p.funnel.pop(), "funnel"],
      ["abandon_at เกิน 1 ช่อง", (p) => p.abandon_at.push(0), "abandonAt"],
      ["result_sizes.count เป็นสตริง", (p) => (p.result_sizes[0].count = "21"), "resultSizes"],
      ["size_summary.between_count", (p) => delete p.size_summary.between_count, "sizeSummary"],
      ["circ_hist.mm ทศนิยม", (p) => (p.circ_hist[0].mm = 52.5), "circHist"],
      ["method.B", (p) => delete p.method.B, "method"],
      ["method_stats.A.remeasured", (p) => delete p.method_stats.A.remeasured, "methodStats"],
      ["method_stats.B.between เป็น null (B ต้องเป็นตัวเลข)", (p) => (p.method_stats.B.between = null), "methodStats"],
      ["switched.both", (p) => delete p.switched.both, "switched"],
      ["saw_between เป็นสตริง", (p) => (p.saw_between = "64"), "sawBetween"],
      ["ref.coin", (p) => delete p.ref.coin, "ref"],
      ["method_x_ref.B_coin", (p) => delete p.method_x_ref.B_coin, "methodXRef"],
      ["cta.gem_quiz", (p) => delete p.cta.gem_quiz, "cta"],
      ["friction.stale_recalib", (p) => delete p.friction.stale_recalib, "friction"],
      ["daily.date มีเวลา", (p) => (p.daily[0].date = "2026-10-26T00:00:00Z"), "daily"],
      ["shop_range.max", (p) => delete p.shop_range.max, "shopRange"],
    ];
    for (const [name, mutate, field] of cases) {
      const p = sqlShapedPayload() as Record<string, any>;
      mutate(p);
      const r = parseRingSizeStats(p) as Record<string, unknown> | null;
      expect(r, name).not.toBeNull();
      const nulls = Object.entries(r!).filter(([, v]) => v === null).map(([k]) => k);
      expect(nulls, name).toEqual([field]);
    }
  });
});

describe("QA2 — ค่าคงที่ฝั่ง TS ต้องตรงกับ SQL จริง (อ่านจากไฟล์ SQL)", () => {
  const body = statsFunctionBody();

  it("จำนวนขั้น funnel/abandon_at ตรง generate_series ใน SQL", () => {
    const m = [...body.matchAll(/generate_series\(\s*0\s*,\s*(\d+)\s*\)/g)].map((x) => Number(x[1]));
    expect(m).toEqual([7, 6]); // funnel (0..7) แล้ว abandon_at (0..6)
    expect(RING_STAGE_MAX).toBe(m[0]);
    expect(parseRingSizeStats({ ...sqlShapedPayload(), funnel: Array(m[0] + 1).fill(1), abandon_at: Array(m[1] + 1).fill(1) })).not.toBeNull();
    expect(parseRingSizeStats({ ...sqlShapedPayload(), funnel: Array(m[0] + 1).fill(1), abandon_at: Array(m[1] + 1).fill(1) })!.funnel).toHaveLength(8);
  });

  it("ช่วงวันของ RPC (6 ≤ to−from ≤ 179) ⇒ MIN/MAX_DAYS ของ UI = 7/180 พอดี", () => {
    const lo = /\(p_to - p_from\)\s*<\s*(\d+)/.exec(body);
    const hi = /\(p_to - p_from\)\s*>\s*(\d+)/.exec(body);
    expect(lo && hi).toBeTruthy();
    expect(RING_STATS_MIN_DAYS).toBe(Number(lo![1]) + 1);
    expect(RING_STATS_MAX_DAYS).toBe(Number(hi![1]) + 1);
  });

  it("retention ใน SQL = RING_STATS_MAX_DAYS (ข้อความ 'ย้อนหลัง 180 วัน' ไม่โกหก)", () => {
    const m = /created_at\s*<\s*now\(\)\s*-\s*interval\s*'(\d+) days'/.exec(SQL_FILE);
    expect(m).toBeTruthy();
    expect(Number(m![1])).toBe(RING_STATS_MAX_DAYS);
  });

  it("ชุด in_app ใน CHECK ของตาราง = RING_IN_APP · ช่วง result_size = RING_SIZE_RANGE", () => {
    const chk = /in_app\s+text not null default 'unknown'\s*check \(in_app in \(([^)]*)\)\)/.exec(SQL_FILE);
    expect(chk).toBeTruthy();
    const set = [...chk![1].matchAll(/'([a-z]+)'/g)].map((x) => x[1]);
    expect(set).toEqual([...RING_IN_APP]);
    const rs = /result_size\s+smallint check \(result_size between (\d+) and (\d+)\)/.exec(SQL_FILE);
    expect(rs).toBeTruthy();
    expect([Number(rs![1]), Number(rs![2])]).toEqual([...RING_SIZE_RANGE]);
  });

  it("by_in_app ที่ SQL คืน = ชุด RING_IN_APP ครบ (ไม่มี bucket ตกหล่น)", () => {
    const paths = [...sqlPaths()].filter((p) => p.startsWith(".by_in_app.")).map((p) => p.slice(".by_in_app.".length)).sort();
    expect(paths).toEqual([...RING_IN_APP].sort());
  });

  it("shop_range จาก SQL (int4range(a,b,'[]') คืน min=a max=b) ผ่าน parser · ไม่ hardcode: ใช้เลขที่อ่านจาก SQL", () => {
    const m = /int4range\(\s*(\d+)\s*,\s*(\d+)\s*,\s*'\[\]'\s*\)/.exec(SQL_FILE);
    expect(m).toBeTruthy();
    const r = parseRingSizeStats({ ...sqlShapedPayload(), shop_range: { min: Number(m![1]), max: Number(m![2]) } });
    expect(r!.shopRange).toEqual({ min: Number(m![1]), max: Number(m![2]) });
    // และ SQL คืน max = upper − 1 (ช่วง canonical [a, b+1)) — ถ้าแก้เป็น upper เฉยๆ ตารางจะโชว์เบอร์เกิน 1 แถว
    expect(body).toMatch(/'max',\s*upper\(analytics\.ring_size_shop_range\(\)\)\s*-\s*1/);
    expect(body).toMatch(/'min',\s*lower\(analytics\.ring_size_shop_range\(\)\)/);
  });

  it("invariant ของ SQL ที่ UI พึ่ง: sum(abandon_at) + funnel[7] = sessions ⇒ fixture ที่สอดคล้องกับ SQL ผ่านโดยไม่ crash ที่ parser", () => {
    const p = sqlShapedPayload() as { funnel: number[]; abandon_at: number[]; sessions: number };
    expect(p.abandon_at.reduce((a, b) => a + b, 0) + p.funnel[7]).toBe(p.sessions);
  });
});
