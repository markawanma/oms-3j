// lib/ring-size/track-schema.test.ts — สัญญาข้อมูลสถิติ /ring-size (design-ring-size-analytics §4.2 · เคส §9 ข้อ 3)
// + ด่านกัน drift: allowlist/enum/ช่วงตัวเลขใน track-schema.ts ต้องตรงกับ migration 0193 (อ่านไฟล์ SQL มาเทียบ)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SHOP_RING_SIZES } from "./config";
import {
  RING_CIRC_MM_RANGE,
  RING_CTA,
  RING_IN_APP,
  RING_METHOD,
  RING_REF,
  RING_SIZE_RANGE,
  RING_SNAPSHOT_KEYS,
  RING_STAGES,
  inAppBucket,
  parseRingTrackBody,
} from "./track-schema";

const SID = "3f2b8c1e-9a4d-4e6b-8c2f-1a2b3c4d5e6f"; // UUID v4
const ok = (body: unknown) => parseRingTrackBody(body);

describe("parseRingTrackBody — ต้องผ่าน (ต้องไม่พัง)", () => {
  it("ขั้นต่ำ: sid + stage", () => {
    const r = ok({ sid: SID, stage: 0 });
    expect(r).toEqual({ ok: true, data: { sessionId: SID, snapshot: { stage: 0 } } });
  });

  it("snapshot ครบทุก field — หยิบทีละ field ไม่มีอะไรเกินเข้า output", () => {
    const body = {
      sid: SID, stage: 7, in_app: "line", is_return: true, ref: "coin", method: "B", circ_mm: 54.1, size: 52, between: false, in_range: true,
      g1: false, g3: true, g4: false, g5: true, cta: "gem_quiz", used_a: true, used_b: true, saw_between: false,
    };
    const r = ok(body);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const { sid, ...rest } = body;
      expect(r.data.sessionId).toBe(sid);
      expect(r.data.snapshot).toEqual(rest);
    }
  });

  it("ค่าขอบของช่วงที่ถูกต้องผ่าน: stage 0/7 · circ 20/120 · size 30/90", () => {
    for (const body of [
      { sid: SID, stage: 0 }, { sid: SID, stage: 7 },
      { sid: SID, stage: 7, circ_mm: 20, size: 30 }, { sid: SID, stage: 7, circ_mm: 120, size: 90 },
    ]) expect(ok(body).ok, JSON.stringify(body)).toBe(true);
  });

  it("sid ตัวพิมพ์ใหญ่ผ่านและถูก normalize เป็นตัวเล็ก", () => {
    const r = ok({ sid: SID.toUpperCase(), stage: 1 });
    expect(r.ok && r.data.sessionId).toBe(SID);
  });
});

describe("parseRingTrackBody — ต้องปฏิเสธ (design §9 ข้อ 3)", () => {
  const bad: Array<[string, unknown]> = [
    ["null", null], ["array", []], ["string", "x"], ["number", 5], ["undefined", undefined], ["array ของ object", [{ sid: SID, stage: 1 }]],
    ["ไม่มี sid", { stage: 1 }], ["sid null", { sid: null, stage: 1 }], ["sid ไม่ใช่ string", { sid: 5, stage: 1 }],
    ["sid ไม่ใช่ UUID", { sid: "abc", stage: 1 }], ["sid UUID v1", { sid: "3f2b8c1e-9a4d-1e6b-8c2f-1a2b3c4d5e6f", stage: 1 }],
    ["sid variant ผิด", { sid: "3f2b8c1e-9a4d-4e6b-cc2f-1a2b3c4d5e6f", stage: 1 }], ["sid ยาวเกิน", { sid: SID + "0", stage: 1 }],
    ["sid มีช่องว่าง", { sid: " " + SID, stage: 1 }], ["sid ว่าง", { sid: "", stage: 1 }],
    ["ไม่มี stage", { sid: SID }], ["stage null", { sid: SID, stage: null }], ["stage 8", { sid: SID, stage: 8 }], ["stage 99", { sid: SID, stage: 99 }],
    ["stage -1", { sid: SID, stage: -1 }], ["stage 1.5", { sid: SID, stage: 1.5 }], ["stage string", { sid: SID, stage: "1" }],
    ["stage NaN", { sid: SID, stage: Number.NaN }], ["stage Infinity", { sid: SID, stage: Number.POSITIVE_INFINITY }],
    ["stage boolean", { sid: SID, stage: true }], ["stage array", { sid: SID, stage: [1] }],
    ["key ไม่รู้จัก ip", { sid: SID, stage: 1, ip: "1.2.3.4" }], ["key user_agent", { sid: SID, stage: 1, user_agent: "x" }],
    ["key shop_id", { sid: SID, stage: 1, shop_id: "11111111-1111-1111-1111-111111111111" }],
    ["key hp", { sid: SID, stage: 1, hp: "" }], ["key created_at", { sid: SID, stage: 1, created_at: "2020-01-01" }],
    ["key ตัวพิมพ์ใหญ่ STAGE", { sid: SID, stage: 1, STAGE: 2 }], ["key in_shop_range (DB คำนวณเอง)", { sid: SID, stage: 1, in_shop_range: true }],
    ["__proto__ เป็น own key", JSON.parse(`{"sid":"${SID}","stage":1,"__proto__":{"stage":9}}`)],
    // 🔴 src ถูกตัดจาก allowlist (มติเจ้าของ 25 ต.ค. 69 ไม่แยกช่องทาง) — ส่งมา = key ไม่รู้จัก = 400 ไม่ใช่ ignore เงียบ
    ["key src (ตัดออกตามมติ)", { sid: SID, stage: 1, src: "line" }], ["key src null", { sid: SID, stage: 1, src: null }],
    ["key source", { sid: SID, stage: 1, source: "line" }],
    ["in_app นอกชุด", { sid: SID, stage: 1, in_app: "evil" }], ["in_app ตัวพิมพ์ใหญ่", { sid: SID, stage: 1, in_app: "LINE" }],
    ["in_app null", { sid: SID, stage: 1, in_app: null }], ["in_app number", { sid: SID, stage: 1, in_app: 7 }],
    ["ref นอกชุด", { sid: SID, stage: 1, ref: "x" }], ["ref Card", { sid: SID, stage: 1, ref: "Card" }],
    ["method C", { sid: SID, stage: 1, method: "C" }], ["method a", { sid: SID, stage: 1, method: "a" }],
    ["cta นอกชุด", { sid: SID, stage: 1, cta: "x" }], ["cta array", { sid: SID, stage: 1, cta: ["line"] }], ["cta boolean", { sid: SID, stage: 1, cta: true }],
    ["circ 19.9", { sid: SID, stage: 7, circ_mm: 19.9 }], ["circ 120.1", { sid: SID, stage: 7, circ_mm: 120.1 }],
    ["circ NaN", { sid: SID, stage: 7, circ_mm: Number.NaN }], ["circ Infinity", { sid: SID, stage: 7, circ_mm: Number.POSITIVE_INFINITY }],
    ["circ -Infinity", { sid: SID, stage: 7, circ_mm: Number.NEGATIVE_INFINITY }], ["circ 1e9", { sid: SID, stage: 7, circ_mm: 1e9 }],
    ["circ string", { sid: SID, stage: 7, circ_mm: "54" }], ["circ 'NaN'", { sid: SID, stage: 7, circ_mm: "NaN" }], ["circ null", { sid: SID, stage: 7, circ_mm: null }],
    ["circ 0", { sid: SID, stage: 7, circ_mm: 0 }], ["circ ลบ", { sid: SID, stage: 7, circ_mm: -54 }],
    ["size 29", { sid: SID, stage: 7, size: 29 }], ["size 91", { sid: SID, stage: 7, size: 91 }], ["size 55.5", { sid: SID, stage: 7, size: 55.5 }],
    ["size 1e9", { sid: SID, stage: 7, size: 1e9 }], ["size string", { sid: SID, stage: 7, size: "55" }], ["size null", { sid: SID, stage: 7, size: null }],
    ["size NaN", { sid: SID, stage: 7, size: Number.NaN }], ["size 0", { sid: SID, stage: 7, size: 0 }],
    ...(["is_return", "between", "in_range", "g1", "g3", "g4", "g5", "used_a", "used_b", "saw_between"] as const).flatMap((k) => [
      [`${k}="true"`, { sid: SID, stage: 1, [k]: "true" }] as [string, unknown],
      [`${k}=1`, { sid: SID, stage: 1, [k]: 1 }] as [string, unknown],
      [`${k}=null`, { sid: SID, stage: 1, [k]: null }] as [string, unknown],
    ]),
    ["key มากเกิน 20", Object.fromEntries([["sid", SID], ["stage", 1], ...Array.from({ length: 20 }, (_, i) => [`k${i}`, 1])])],
  ];

  it.each(bad)("%s", (_label, body) => {
    expect(ok(body).ok).toBe(false);
  });

  it("เหตุผลที่ปฏิเสธเป็นรหัสคงที่ ไม่ echo ค่าที่ client ส่งมา", () => {
    const r = ok({ sid: SID, stage: 1, in_app: "<script>alert(1)</script>" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).not.toMatch(/script|alert/);
  });
});

describe("inAppBucket", () => {
  it.each([
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/13.9.0", "line"],
    ["Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36 Line/14.0.0", "line"],
    ["Mozilla/5.0 (iPhone) AppleWebKit/605 Mobile/15E148 musical_ly_30.1.0 BytedanceWebview/d8a21c6", "tiktok"],
    ["Mozilla/5.0 (Linux; Android 12) Chrome/110 Mobile Safari/537.36 TikTok 28.0", "tiktok"],
    ["Mozilla/5.0 (iPhone) Mobile/15E148 [FBAN/FBIOS;FBAV/420.0.0]", "fb"],
    ["Mozilla/5.0 (Linux; Android 13) Chrome/120 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/430.0.0]", "fb"],
    ["Mozilla/5.0 (iPhone) Mobile/15E148 Instagram 300.0.0.0", "ig"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605 Version/17.0 Mobile/15E148 Safari/604.1", "browser"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36", "browser"],
    ["", "unknown"], ["   ", "unknown"], [null, "unknown"], [undefined, "unknown"],
  ])("%s → %s", (ua, want) => {
    expect(inAppBucket(ua as string | null | undefined)).toBe(want);
  });

  it("ไม่จับ Line ที่เป็นส่วนหนึ่งของคำอื่น (Pipeline/ Baseline/ )", () => {
    expect(inAppBucket("Mozilla/5.0 Pipeline/1.0")).toBe("browser");
    expect(inAppBucket("Mozilla/5.0 Baseline/2")).toBe("browser");
  });

  it("ผลลัพธ์อยู่ในชุด RING_IN_APP เสมอ", () => {
    for (const ua of ["x", "Line/1", "TikTok", "FBAN", "Instagram", ""]) expect(RING_IN_APP).toContain(inAppBucket(ua));
  });
});

// ───────── drift กับ migration 0193 ─────────
const SQL = readFileSync(join(process.cwd(), "supabase", "migrations", "0193_ring_size_analytics.sql"), "utf8");

function sqlArray(after: string): string[] {
  const i = SQL.indexOf(after);
  expect(i, `ไม่พบ "${after}" ใน migration`).toBeGreaterThanOrEqual(0);
  const m = /array\s*\[([^\]]*)\]/.exec(SQL.slice(i));
  expect(m, `ไม่พบ array หลัง "${after}"`).not.toBeNull();
  return [...m![1].matchAll(/'([^']*)'/g)].map((x) => x[1]);
}

describe("track-schema ตรงกับ migration 0193 (กัน drift)", () => {
  it("allowlist ของ snapshot = v_allowed ใน ring_size_session_upsert", () => {
    expect([...sqlArray("v_allowed constant text[]")].sort()).toEqual([...RING_SNAPSHOT_KEYS].sort());
  });
  it("ไม่มี src ใน allowlist ทั้งสองฝั่ง (มติเจ้าของ 25 ต.ค. 69)", () => {
    expect(RING_SNAPSHOT_KEYS as readonly string[]).not.toContain("src");
    expect(sqlArray("v_allowed constant text[]")).not.toContain("src");
    expect(SQL).not.toMatch(/create table[^;]*ring_size_src/i);
  });
  it("in_app: check constraint ของตาราง = RING_IN_APP", () => {
    const m = /in_app\s+text not null default 'unknown'\s*check \(in_app in \(([^)]*)\)\)/.exec(SQL);
    expect(m).not.toBeNull();
    expect([...m![1].matchAll(/'([^']*)'/g)].map((x) => x[1])).toEqual([...RING_IN_APP]);
  });
  it("cta · ref · method ในฟังก์ชัน = ชุดใน TS", () => {
    expect(sqlArray("p_snapshot ? 'cta'")).toEqual([...RING_CTA]);
    expect(sqlArray("p_snapshot ? 'ref'")).toEqual([...RING_REF]);
    expect(sqlArray("p_snapshot ? 'method'")).toEqual([...RING_METHOD]);
  });
  it("ช่วงตัวเลข: stage 0-7 · circ 20-120 · size 30-90", () => {
    expect(RING_STAGES).toHaveLength(8);
    expect(SQL).toContain("v_num between 0 and 7");
    expect(SQL).toContain(`v_num between ${RING_CIRC_MM_RANGE[0]} and ${RING_CIRC_MM_RANGE[1]}`);
    expect(SQL).toContain(`v_num between ${RING_SIZE_RANGE[0]} and ${RING_SIZE_RANGE[1]}`);
    expect(SQL).toContain(`max_stage      smallint not null default 0 check (max_stage between 0 and ${RING_STAGES.length - 1})`);
  });
  it("ช่วงเบอร์ร้านใน DB = SHOP_RING_SIZES ของ config.ts (แก้คู่เสมอ)", () => {
    expect(SHOP_RING_SIZES).not.toBeNull();
    expect(SQL).toContain(`int4range(${SHOP_RING_SIZES!.min}, ${SHOP_RING_SIZES!.max}, '[]')`);
  });
});
