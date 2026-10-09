// QA (R2-D2) — ทดสอบ humanizeRpcError กับ "ข้อความ raise จริงจาก migration 0159–0162"
// ไม่ใช่ข้อความที่เราแต่งเอง: ดึงทุก `raise exception '…' using errcode = 'XXXXX'` ที่เป็นของ workflow content มาแปลงแล้วตรวจว่า
//  1) ไม่รั่ว identifier (ชื่อฟังก์ชัน / snake_case / analytics. / p_*) ออกจอ (F5)
//  2) ผลลัพธ์เป็นภาษาไทยเสมอและไม่ว่าง · ยาว ≤ 300
//  3) ข้อความที่เป็นภาษาเจ้าของ (รายการที่ขาดของ "อนุมัติไม่ได้ — …") ยังเห็นเนื้อหา ไม่ถูกกลบเป็นข้อความกลาง
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { describeRpcError, humanizeRpcError } from "./rpc-messages";

const FILES = [
  "0159_content_piece_workflow.sql",
  "0160_content_piece_post_views.sql",
  "0161_content_measure_amend_result.sql",
  "0162_content_feedback_verdict_inbox.sql",
];

interface Raised {
  file: string;
  code: string;
  message: string;
}

function extract(): Raised[] {
  const out: Raised[] = [];
  for (const f of FILES) {
    const sql = readFileSync(resolve(__dirname, "../../supabase/migrations", f), "utf8");
    // raise exception '<literal>' [, args…] using errcode = 'CODE'  (ข้ามข้อความที่ประกอบด้วย || / format — ไม่ใช่ literal เดี่ยว)
    const re = /raise\s+exception\s+'((?:[^']|'')*)'\s*(?:,[^;]*?)?\s*using\s+(?:errcode\s*=\s*'([0-9A-Z]{5})'|hint)/gis;
    for (const m of sql.matchAll(re)) {
      const code = m[2];
      if (!code) continue;
      const message = m[1].replace(/''/g, "'").replace(/%/g, "x");
      out.push({ file: f, code, message });
    }
  }
  return out;
}

const RAISED = extract().filter((r) => ["55000", "22023", "42501", "23505"].includes(r.code));
const THAI = /[฀-๿]/;

describe("ข้อความ raise จริงจาก migration 0159–0162 ผ่าน humanizeRpcError", () => {
  it("ดึงข้อความจริงมาได้มากพอ (กัน regex พังเงียบ)", () => {
    expect(RAISED.length).toBeGreaterThan(150);
    expect(RAISED.filter((r) => r.code === "55000").length).toBeGreaterThan(40);
    expect(RAISED.filter((r) => r.code === "22023").length).toBeGreaterThan(40);
  });

  it("ทุกข้อความ: ไม่รั่ว identifier · เป็นไทย · ไม่ว่าง · ≤ 300", () => {
    const bad: string[] = [];
    for (const r of RAISED) {
      for (const prefix of ["content_piece_advance: ", ""]) {
        const out = humanizeRpcError({ code: r.code, message: prefix + r.message }, "บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง", { duplicate: "ซ้ำ" });
        const problems: string[] = [];
        if (!out.trim()) problems.push("ว่าง");
        if (out.length > 300) problems.push("ยาว>300");
        if (!THAI.test(out)) problems.push("ไม่มีไทย");
        if (/[a-z]+_[a-z_]+/i.test(out)) problems.push("snake_case");
        if (/analytics\./i.test(out)) problems.push("analytics.");
        if (/\bp_[a-z]/i.test(out)) problems.push("p_*");
        if (/\b(in_review|approved|drafting|produced|cancelled|planned)\b/.test(out)) problems.push("enum ดิบ");
        if (problems.length) bad.push(`[${r.code}] ${prefix ? "(มี prefix) " : ""}${r.message.slice(0, 90)}  ⇒  ${out.slice(0, 90)}  :: ${problems.join(",")}`);
      }
    }
    expect(bad, bad.join("\n")).toEqual([]);
  });

  it("55000 'ส่งตรวจไม่ได้/วางแผนไม่ได้ — …' จริงจาก DB ยังเห็นเนื้อหา ไม่ถูกกลบเป็นข้อความกลาง", () => {
    const owner = RAISED.filter((r) => r.code === "55000" && /^(?:content_piece_advance:\s*)?(ส่งตรวจไม่ได้|วางแผนไม่ได้)\s—/.test(r.message));
    expect(owner.length).toBeGreaterThan(2);
    const generic = "ทำรายการนี้ไม่ได้ในสถานะปัจจุบัน — รีเฟรชแล้วลองใหม่";
    const swallowed = owner
      .map((r) => ({ r, out: humanizeRpcError({ code: "55000", message: r.message }, "x") }))
      .filter((x) => x.out === generic)
      .map((x) => x.r.message.slice(0, 100));
    expect(swallowed, swallowed.join("; ")).toEqual([]);
  });

  // ข้อความจริงของ content_piece_approve_blockers() (0159 บรรทัด ~1383-1411) ต่อกันด้วย ' · ' แล้วห่อด้วย 'อนุมัติไม่ได้ — '
  // BUG-QA-1: DB ใส่ชื่อด่านดิบ (fact_check/brand_rule/risk_owner) ในข้อความ → humanizeRpcError เห็น snake_case แล้วกลบทั้งก้อนเป็นข้อความกลาง
  // ผลคือเจ้าของที่กดอนุมัติจากแท็บเก่า (can_approve เปลี่ยนไประหว่างที่เปิดหน้า) ไม่เห็นว่าติดอะไร (ภาคผนวก B: "แสดงรายการหลังเครื่องหมาย —")
  describe("approve blockers จริงจาก DB", () => {
    const wrap = (items: string[]) => ({ code: "55000", message: "content_piece_advance: อนุมัติไม่ได้ — " + items.join(" · ") });
    it("ไม่รั่ว identifier ไม่ว่าชนิดข้อบล็อกไหน", () => {
      const out = humanizeRpcError(
        wrap([
          "ด่าน fact_check ยังไม่มีผลตรวจ",
          "ด่าน brand_rule ยังไม่ผ่าน (สถานะ pending)",
          "ด่าน risk_owner ยังไม่ผ่าน (สถานะ blocked)",
          "มี [ต้องยืนยัน] ที่ยังไม่ตอบ 8 รายการ",
          "ยังมี [ต้องยืนยัน] ค้างอยู่ในข้อความของชิ้นงาน",
          "ยังไม่ได้ระบุชนิดชิ้นงาน (piece_kind)",
          "ชิ้น LINE ยังไม่ได้เลือกผู้รับ (ทุกคน/เฉพาะกลุ่ม)",
        ]),
        "x"
      );
      expect(out).not.toMatch(/[a-z]+_[a-z_]+/i);
      expect(THAI.test(out)).toBe(true);
    });
    it("ข้อบล็อกที่ไม่มีชื่อด่านดิบ (ต้องยืนยัน/ผู้รับ LINE) เห็นเนื้อหา", () => {
      const out = humanizeRpcError(wrap(["มี [ต้องยืนยัน] ที่ยังไม่ตอบ 8 รายการ", "ชิ้น LINE ยังไม่ได้เลือกผู้รับ (ทุกคน/เฉพาะกลุ่ม)"]), "x");
      expect(out).toContain("ยังไม่ตอบ 8 รายการ");
      expect(out).toContain("ยังไม่ได้เลือกผู้รับ");
    });
    // เป้าหมายตามภาคผนวก B: ข้อความที่มีชื่อด่านดิบต้องยังบอกเจ้าของได้ว่าด่านไหน (แปลง fact_check → ข้อเท็จจริง ฯลฯ) — ตอนนี้ยังไม่ทำ = บั๊ก
    it("BUG-QA-1: ข้อบล็อกที่มีชื่อด่านดิบ ยังแสดงรายการที่ติด (ไม่กลบเป็นข้อความกลาง)", () => {
      const out = humanizeRpcError(wrap(["ด่าน fact_check ยังไม่มีผลตรวจ", "มี [ต้องยืนยัน] ที่ยังไม่ตอบ 8 รายการ"]), "x");
      expect(out).toContain("ยังไม่ตอบ 8 รายการ");
    });
  });

  it("42501 ทุกข้อความ = ข้อความเจ้าของร้านเท่านั้น · 23505 ใช้ข้อความบริบท", () => {
    for (const r of RAISED.filter((x) => x.code === "42501")) {
      expect(humanizeRpcError({ code: "42501", message: r.message }, "x")).toBe("เฉพาะเจ้าของร้านทำรายการนี้ได้");
    }
    for (const r of RAISED.filter((x) => x.code === "23505")) {
      expect(describeRpcError({ code: "23505", message: r.message }, "x", { duplicate: "ซ้ำแล้ว" }).message).toBe("ซ้ำแล้ว");
    }
  });
});

describe("วางแผนไม่ได้ — ข้อความจริงจาก content_piece_advance (0159 บรรทัด ~2233-2251)", () => {
  const wrap = (items: string[]) => ({ code: "55000", message: "content_piece_advance: วางแผนไม่ได้ — " + items.join(" · ") });
  it("ข้อความที่วงเล็บมีเฉพาะ identifier เดี่ยว (piece_kind) → เห็นรายการ", () => {
    const out = humanizeRpcError(wrap(["ยังไม่ได้ตั้งวัน", "ยังไม่ได้ระบุชนิดชิ้นงาน (piece_kind)"]), "x");
    expect(out).toContain("ยังไม่ได้ตั้งวัน");
  });
  // BUG-QA-2 (พบในเบราว์เซอร์จริง: idea → "วางแผน…" โดยไม่ใส่วัน เจ้าของเห็น "ทำรายการนี้ไม่ได้ในสถานะปัจจุบัน — รีเฟรชแล้วลองใหม่"):
  // DB ใส่ "(metric_code — ไม่วัดผลให้เลือก none)" และ "ชนิด short_clip ใช้กับช่องทาง line_oa ไม่ได้" → วงเล็บมีภาษาไทย/ขีด ตัว sanitize ไม่ล้าง
  // → เหลือ snake_case → ทั้งก้อนถูกกลบเป็นข้อความกลางที่บอกให้ "รีเฟรช" ทั้งที่ต้องไปตั้งวัน
  it("BUG-QA-2: มี '(metric_code — ไม่วัดผลให้เลือก none)' ยังต้องเห็น 'ยังไม่ได้ตั้งวัน'", () => {
    const out = humanizeRpcError(wrap(["ยังไม่ได้ตั้งวัน", "ยังไม่ได้เลือกตัวชี้วัด (metric_code — ไม่วัดผลให้เลือก none)"]), "x");
    expect(out).toContain("ยังไม่ได้ตั้งวัน");
  });
  it("BUG-QA-2b: 'ชนิด short_clip ใช้กับช่องทาง line_oa ไม่ได้' ต้องไม่กลายเป็นข้อความให้รีเฟรช", () => {
    const out = humanizeRpcError(wrap(["ชนิด short_clip ใช้กับช่องทาง line_oa ไม่ได้"]), "x");
    expect(out).not.toContain("รีเฟรช");
  });
});

