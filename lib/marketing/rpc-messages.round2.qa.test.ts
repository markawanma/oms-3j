// QA (R2-D2) รอบตรวจซ้ำ — BUG-QA-2: ข้อความ 3 ตัวอย่างเดิมที่เจอจริงในเบราว์เซอร์ ต้องบอกเจ้าของว่าต้องทำอะไร (ไม่ใช่ fallback "รีเฟรช")
// + ข้อความที่มี SQL / stack / constraint / ชื่อตาราง ต้องยังถูกกัน แม้จะมีภาษาไทยปน
import { describe, expect, it } from "vitest";
import { humanizeRpcError } from "./rpc-messages";

const FB = "บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง";
const GENERIC55 = "ทำรายการนี้ไม่ได้ในสถานะปัจจุบัน — รีเฟรชแล้วลองใหม่";
const e = (code: string, message: string) => ({ code, message: "content_piece_advance: " + message });

describe("BUG-QA-2 ข้อความ 3 ตัวอย่างเดิม", () => {
  it("(metric_code — …) → เห็น 'ยังไม่ได้ตั้งวัน' และ 'ตัวชี้วัด' ไม่รั่ว snake_case", () => {
    const m = humanizeRpcError(e("55000", "วางแผนไม่ได้ — ยังไม่ได้ตั้งวัน · ยังไม่ได้เลือกตัวชี้วัด (metric_code — ไม่วัดผลให้เลือก none)"), FB);
    expect(m).toContain("ยังไม่ได้ตั้งวัน");
    expect(m).toContain("ตัวชี้วัด");
    expect(m).not.toBe(GENERIC55);
    expect(m).not.toMatch(/[a-z]+_[a-z_]+/i);
    expect(m).not.toContain("รีเฟรช");
  });
  it("ชนิด short_clip ใช้กับช่องทาง line_oa ไม่ได้ → ชื่อไทย", () => {
    const m = humanizeRpcError(e("55000", "วางแผนไม่ได้ — ชนิด short_clip ใช้กับช่องทาง line_oa ไม่ได้"), FB);
    expect(m).toContain("คลิปสั้น");
    expect(m).toContain("LINE OA");
    expect(m).not.toMatch(/short_clip|line_oa/);
    expect(m).not.toContain("รีเฟรช");
  });
  it("ด่าน fact_check ยังไม่ผ่าน (สถานะ pending) → ชื่อด่านไทย + ยังเห็นรายการ [ต้องยืนยัน]", () => {
    const m = humanizeRpcError(e("55000", "อนุมัติไม่ได้ — ด่าน fact_check ยังไม่ผ่าน (สถานะ pending) · มี [ต้องยืนยัน] ที่ยังไม่ตอบ 8 รายการ"), FB);
    expect(m).toContain("ข้อเท็จจริง");
    expect(m).toContain("ยังไม่ตอบ 8 รายการ");
    expect(m).not.toMatch(/fact_check|pending/);
  });
  it("ครบทุกข้อบล็อกของ content_piece_approve_blockers ในประโยคเดียว", () => {
    const m = humanizeRpcError(
      e("55000", "อนุมัติไม่ได้ — ด่าน fact_check ยังไม่มีผลตรวจ · ด่าน brand_rule ยังไม่ผ่าน (สถานะ blocked) · ด่าน risk_owner ยังไม่ผ่าน (สถานะ pending) · ยังไม่ได้ระบุชนิดชิ้นงาน (piece_kind) · ชิ้น LINE ยังไม่ได้เลือกผู้รับ (ทุกคน/เฉพาะกลุ่ม)"),
      FB
    );
    for (const w of ["ข้อเท็จจริง", "กฎแบรนด์", "ความเสี่ยง", "ผู้รับ"]) expect(m).toContain(w);
    expect(m).not.toMatch(/[a-z]+_[a-z_]+/i);
  });
});

describe("ข้อความเทคนิคยังถูกกัน (แม้มีภาษาไทยปน)", () => {
  const cases = [
    "อนุมัติไม่ได้ — ERROR: syntax error at or near \"select\"",
    "ชิ้นงานล้มเหลว select * from analytics.campaign_step where id = 1",
    "ชิ้นงานล้มเหลว insert into analytics.content_piece_event values (1)",
    "บันทึกไม่ได้ new row violates check constraint \"campaign_step_x_check\"",
    "ผิดพลาด permission denied for table campaign_step ของชิ้นงาน",
    "ชิ้นงานพัง relation \"analytics.foo\" does not exist",
    "ชิ้นงานพัง at PLpgSQL.fn(line 12) stack trace",
    "update campaign_step set piece_status = 'x' ชิ้นงาน",
  ];
  for (const c of cases) {
    it(`55000 :: ${c.slice(0, 50)}`, () => {
      const m = humanizeRpcError({ code: "55000", message: c }, FB);
      expect(m).toBe(GENERIC55);
    });
  }
  it("22023 / ไม่มีรหัส ไม่เคยโชว์ข้อความดิบ", () => {
    expect(humanizeRpcError({ code: "22023", message: "select * from analytics.x" }, FB)).toBe("ข้อมูลที่กรอกไม่ถูกต้อง — ตรวจแล้วลองใหม่");
    expect(humanizeRpcError({ code: undefined, message: "ล้มเหลว select 1" }, FB)).toBe(FB);
  });
  it("ข้อความไทยปกติที่มีคำอังกฤษทั่วไป (shot list / hook A/B) ยังโชว์ได้ ไม่ถูกกันเกิน", () => {
    const m = humanizeRpcError(e("55000", "ส่งตรวจไม่ได้ — hook A/B ต้องติดประเภทต่างกันอย่างน้อย 2 ประเภท (ตอนนี้ 0; hook ยังไม่ติดประเภท 0 ตัว)"), FB);
    expect(m).toContain("ส่งตรวจไม่ได้");
    expect(m).toContain("hook A/B");
    expect(humanizeRpcError(e("55000", "ส่งตรวจไม่ได้ — คลิปต้องมี shot list อย่างน้อย 1 ช็อต"), FB)).toContain("shot list");
  });
});
