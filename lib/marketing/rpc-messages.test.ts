import { describe, expect, it } from "vitest";
import { describeRpcError, humanizeRpcError, sanitizeRpcText } from "./rpc-messages";

function err(code: string | undefined, message: string) {
  return { code, message };
}
const FB = "บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง";

/** ข้อความที่ห้ามหลุดออกจอ (ภาคผนวก B / ข้อ F5) */
function expectNoLeak(text: string) {
  expect(text).not.toMatch(/content_[a-z_]+/);
  expect(text).not.toMatch(/campaign_[a-z_]+/);
  expect(text).not.toMatch(/in_review|drafting|produced|cancelled|planned/);
  expect(text).not.toMatch(/piece_kind|baseline_value|pass_threshold/);
  expect(text).not.toMatch(/analytics\./);
  expect(text).not.toMatch(/\bp_[a-z]/);
  expect(text).not.toMatch(/[a-z]+_[a-z_]+/);
}

describe("humanizeRpcError — ตามตารางภาคผนวก B", () => {
  it("55000 อยู่สถานะนี้แล้ว → เปลี่ยนสถานะไปแล้ว (stale)", () => {
    const d = describeRpcError(err("55000", "content_piece_advance: ชิ้นงานอยู่สถานะ in_review แล้ว"), FB);
    expect(d.message).toBe("ชิ้นนี้เปลี่ยนสถานะไปแล้ว — รีเฟรชเพื่อดูล่าสุด");
    expect(d.stale).toBe(true);
  });
  it("55000 ชิ้นงานอยู่สถานะยกเลิกแล้ว", () => {
    expect(humanizeRpcError(err("55000", "content_piece_advance: ชิ้นงานอยู่สถานะยกเลิกแล้ว"), FB)).toBe(
      "ชิ้นนี้เปลี่ยนสถานะไปแล้ว — รีเฟรชเพื่อดูล่าสุด"
    );
  });
  it("55000 จาก X ไป Y ไม่ได้", () => {
    const m = humanizeRpcError(err("55000", "content_piece_advance: จาก approved ไป idea ไม่ได้ (ย้อนได้ทีละ 1 ขั้นเท่านั้น)"), FB);
    expect(m).toBe("เปลี่ยนสถานะแบบนี้ไม่ได้ในตอนนี้ — รีเฟรชแล้วลองใหม่");
  });
  it("55000 อนุมัติไม่ได้ — แสดงรายการและไม่รั่ว identifier", () => {
    const m = humanizeRpcError(
      err("55000", "content_piece_advance: อนุมัติไม่ได้ — ยังมี [ต้องยืนยัน] ที่ยังไม่ตอบ 1 รายการ · ด่าน fact_check ยังไม่ผ่าน"),
      FB
    );
    // ยังมี snake_case (fact_check) → ต้องไม่โชว์ข้อความดิบ แต่ใช้ข้อความมาตรฐานของ 55000
    expectNoLeak(m);
    expect(m.length).toBeGreaterThan(0);
  });
  it("55000 อนุมัติไม่ได้ ที่ข้อความสะอาด → แสดงรายการหลัง —", () => {
    const m = humanizeRpcError(err("55000", "content_piece_advance: อนุมัติไม่ได้ — ยังมี [ต้องยืนยัน] ที่ยังไม่ตอบ 2 รายการ"), FB);
    expect(m).toContain("ยังมี [ต้องยืนยัน] ที่ยังไม่ตอบ 2 รายการ");
    expectNoLeak(m);
  });
  it("55000 รอเงื่อนไข → กด 'กลับมาทำต่อ'", () => {
    expect(humanizeRpcError(err("55000", "content_piece_post: ชิ้นงานรอเงื่อนไขอยู่ (รอของ) — กด resume ก่อน"), FB)).toBe(
      "ชิ้นงานรอเงื่อนไขอยู่ — กด 'กลับมาทำต่อ' ก่อน"
    );
  });
  it("55000 วางแผนไม่ได้ — รายการ (ล้างวงเล็บ identifier)", () => {
    const m = humanizeRpcError(
      err("55000", "content_piece_advance: วางแผนไม่ได้ — ยังไม่ได้ตั้งวัน · ยังไม่ได้ระบุชนิดชิ้นงาน (piece_kind) · ยังไม่มีค่าฐาน (baseline_value)"),
      FB
    );
    expect(m).toContain("ยังไม่ได้ตั้งวัน");
    expect(m).toContain("ยังไม่ได้ระบุชนิดชิ้นงาน");
    expectNoLeak(m);
  });
  it("55000 ส่งตรวจไม่ได้ — แสดงตรง", () => {
    const m = humanizeRpcError(err("55000", "content_piece_advance: ส่งตรวจไม่ได้ — คลิปต้องมี shot list อย่างน้อย 1 ช็อต"), FB);
    expect(m).toContain("คลิปต้องมี shot list อย่างน้อย 1 ช็อต");
  });
  it("55000 ข้อมูลแคมเปญ/ข้อเสนอ/ป้ายเปลี่ยน → โหลดใหม่ (stale)", () => {
    for (const raw of [
      "campaign_verdict_confirm: ข้อมูลแคมเปญเปลี่ยนแล้ว — โหลดใหม่",
      "campaign_verdict_confirm: ข้อเสนอเปลี่ยนไปแล้ว",
      "recommendation_respond: ข้อมูลข้อเสนอเปลี่ยนแล้ว",
      "content_post_verdict_confirm: ป้ายที่ระบบคำนวณเปลี่ยนไปแล้ว",
    ]) {
      const d = describeRpcError(err("55000", raw), FB);
      expect(d.message).toBe("ข้อมูลเปลี่ยนไประหว่างที่เปิดหน้า — โหลดใหม่ก่อนยืนยัน (ข้อความที่พิมพ์ไว้ยังอยู่)");
      expect(d.stale).toBe(true);
    }
  });
  it("55000 ตอบแล้ว → ข้อเสนอนี้ตอบไปแล้ว", () => {
    const d = describeRpcError(err("55000", "recommendation_respond: ตอบแล้ว (done)"), FB);
    expect(d.message).toBe("ข้อเสนอนี้ตอบไปแล้ว");
    expect(d.stale).toBe(true);
  });
  it("55000 gate คำตัดสิน → แสดงตรง (ภาษาไทย)", () => {
    const m = humanizeRpcError(err("55000", "campaign_verdict_confirm: ยังมีผล T+7 ไม่ครบ 2 โพสต์ — ฟันธงไม่ได้"), FB);
    expect(m).toContain("ยังมีผล T+7 ไม่ครบ");
  });
  it("55000 แก้ยอดย้อนหลัง", () => {
    expect(humanizeRpcError(err("55000", "content_post_metric_amend: ย้อนหลังเกิน 30 วัน แก้ไม่ได้"), FB)).toBe(
      "แก้ยอดย้อนหลังเกิน 30 วันไม่ได้ — แจ้งทีม"
    );
  });
  it("55000 อนุมัติแล้ว ห้ามแก้เนื้อหา", () => {
    expect(humanizeRpcError(err("55000", "content_piece_set_plan: อนุมัติแล้ว แก้ piece_kind, channel ไม่ได้ — ส่งกลับ (in_review) ก่อน"), FB)).toBe(
      "อนุมัติแล้วแก้เนื้อหาไม่ได้ — ส่งกลับก่อน"
    );
  });
  it("55000 อื่นที่อ่านไม่ออก → ข้อความมาตรฐาน", () => {
    expect(humanizeRpcError(err("55000", "something broke in analytics.foo_bar"), FB)).toBe(
      "ทำรายการนี้ไม่ได้ในสถานะปัจจุบัน — รีเฟรชแล้วลองใหม่"
    );
  });
  it("55000 โพสต์: มีโพสต์ช่องนี้อยู่แล้ว / ผูกกับชิ้นอื่น", () => {
    expect(
      humanizeRpcError(err("55000", "content_piece_post: ชิ้นนี้มีโพสต์ tiktok ที่ใช้งานอยู่แล้ว (1 platform ต่อชิ้น 1 โพสต์) — ปลดผูกใบเดิมก่อน"), FB)
    ).toContain("มีโพสต์ของช่องทางนี้อยู่แล้ว");
    expect(humanizeRpcError(err("55000", "content_piece_post: โพสต์นี้ผูกกับชิ้นงานอื่นอยู่ — ปลดผูก (content_post_unlink_step) ก่อน"), FB)).toBe(
      "ลิงก์นี้ผูกกับชิ้นงานอื่นอยู่แล้ว"
    );
  });

  it("22023 เหตุผล", () => {
    expect(humanizeRpcError(err("22023", "content_piece_advance: การยกเลิกต้องมีเหตุผล (อย่างน้อย 3 ตัวอักษร)"), FB)).toBe(
      "ใส่เหตุผลอย่างน้อย 3 ตัวอักษร"
    );
  });
  it("22023 ต้องมีแหล่งอ้างอิง / ลิงก์แหล่งไม่ถูกต้อง", () => {
    expect(humanizeRpcError(err("22023", "content_gate_record: ต้องมีแหล่งอ้างอิงอย่างน้อย 1 ลิงก์"), FB)).toBe(
      "ผ่านได้ต้องมีลิงก์แหล่งอ้างอิงอย่างน้อย 1 ลิงก์"
    );
    expect(humanizeRpcError(err("22023", "content_gate_record: ลิงก์แหล่งอ้างอิงไม่ถูกต้อง"), FB)).toBe(
      "ลิงก์ไม่ถูกต้อง (ต้องขึ้นต้นด้วย http:// หรือ https://)"
    );
  });
  it("22023 ไม่มีค่าเปลี่ยน", () => {
    expect(humanizeRpcError(err("22023", "content_piece_set_plan: ไม่มีค่าเปลี่ยน"), FB)).toBe("ไม่มีค่าที่เปลี่ยน");
  });
  it("22023 [ต้องยืนยัน ในคำตอบ", () => {
    expect(humanizeRpcError(err("22023", "content_confirm_resolve: คำตอบห้ามมี [ต้องยืนยัน"), FB)).toBe(
      "คำตอบต้องไม่มี [ต้องยืนยัน…] ค้างอยู่"
    );
  });
  it("22023 ยาวเกิน / อักขระล่องหน", () => {
    expect(humanizeRpcError(err("22023", "recommendation_respond: คำตอบยาวเกิน 1000 ตัวอักษร"), FB)).toBe("ข้อความยาวเกินกำหนด");
    expect(humanizeRpcError(err("22023", "content_confirm_resolve: มีอักขระล่องหน"), FB)).toBe(
      "ข้อความมีอักขระที่มองไม่เห็น — ลบแล้วพิมพ์ใหม่"
    );
  });
  it("22023 เวลาโพสต์นอกช่วง", () => {
    expect(humanizeRpcError(err("22023", "content_piece_post: เวลาโพสต์อยู่นอกช่วงที่ยอมรับ (ต้องไม่ก่อน 2025-01-01)"), FB)).toContain("2568");
  });
  it("22023 อื่น → ข้อความมาตรฐาน", () => {
    expect(humanizeRpcError(err("22023", "content_piece_set_plan: hypothesis ว่างเปล่า"), FB)).toBe("ข้อมูลที่กรอกไม่ถูกต้อง — ตรวจแล้วลองใหม่");
  });
  it("42501 ทุกข้อความ", () => {
    expect(humanizeRpcError(err("42501", "content_piece_advance: ai ไม่มีสิทธิ์เปลี่ยนจาก approved ไป idea"), FB)).toBe(
      "เฉพาะเจ้าของร้านทำรายการนี้ได้"
    );
  });
  it("23505 ใช้ข้อความตามบริบท · ไม่ส่ง = ข้อความทั่วไป", () => {
    const ctx = describeRpcError(err("23505", "duplicate key value violates unique constraint content_signal_url_key"), FB, {
      duplicate: "ลิงก์นี้เคยถูกบันทึกแล้ว",
    });
    expect(ctx.message).toBe("ลิงก์นี้เคยถูกบันทึกแล้ว");
    expect(ctx.duplicate).toBe(true);
    expect(humanizeRpcError(err("23505", "dup"), FB)).toBe("มีรายการนี้อยู่แล้ว");
  });
  it("ไม่มีรหัส/เครือข่าย → fallback ของ action", () => {
    expect(humanizeRpcError(new Error("fetch failed"), FB)).toBe(FB);
    expect(humanizeRpcError(null, FB)).toBe(FB);
    expect(humanizeRpcError(undefined, FB)).toBe(FB);
    expect(humanizeRpcError(err("PGRST202", "Could not find the function analytics.x(...)"), FB)).toBe(FB);
  });
});

describe("ไม่รั่ว identifier (F5)", () => {
  const nasty = [
    "content_piece_advance: ชิ้นงานอยู่สถานะ in_review แล้ว",
    "content_piece_advance: จาก in_review ไป cancelled ไม่ได้ (piece_kind)",
    "recommendation_respond: p_expected_token ไม่ตรง",
    "analytics.content_piece_advance(uuid): พัง",
    "content_piece_set_plan: ค่าของ piece_kind ไม่ถูกต้อง",
    "content_piece_advance: อนุมัติไม่ได้ — ด่าน fact_check ยังไม่ผ่าน (content_gate_record)",
  ];
  for (const code of ["55000", "22023", "42501", "23505", undefined]) {
    for (const raw of nasty) {
      it(`${code ?? "no-code"} :: ${raw.slice(0, 40)}`, () => {
        expectNoLeak(humanizeRpcError(err(code, raw), FB));
      });
    }
  }
});

describe("sanitizeRpcText", () => {
  it("แปลง enum ดิบเป็นป้ายไทยและล้างวงเล็บ identifier", () => {
    expect(sanitizeRpcText("content_piece_advance: ส่งกลับ (in_review) ก่อน")).toBe("ส่งกลับ ก่อน");
    expect(sanitizeRpcText("ต้องกด resume ก่อน")).toBe("ต้องกด กลับมาทำต่อ ก่อน");
  });
  it("ไม่แตะคำที่มี enum เป็นส่วนของคำอื่น", () => {
    expect(sanitizeRpcText("not_approved_yet")).toContain("not_approved_yet");
  });
});

describe("ข้อความเทคนิค (SQL/stack) ห้ามขึ้นจอแม้มีภาษาไทยปน", () => {
  const FB = "บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง";
  for (const raw of [
    "ไม่สำเร็จ: insert into analytics.content_post values (1)",
    "ข้อผิดพลาด violates foreign key constraint ของชิ้นงาน",
    "พัง at Object.run(file.js:10) ลองใหม่",
    "select * from secret_table ที่ไม่มี",
  ]) {
    it(raw.slice(0, 30), () => {
      expect(humanizeRpcError({ code: "55000", message: raw }, FB)).toBe("ทำรายการนี้ไม่ได้ในสถานะปัจจุบัน — รีเฟรชแล้วลองใหม่");
    });
  }
  it("identifier ที่รู้จักถูกแปลงเป็นคำไทย ไม่ทิ้งทั้งข้อความ", () => {
    const m = humanizeRpcError(
      { code: "55000", message: "content_piece_advance: วางแผนไม่ได้ — ชนิด short_clip ใช้กับช่องทาง line_oa ไม่ได้ · ด่าน fact_check ยังไม่ผ่าน (สถานะ pending)" },
      FB
    );
    expect(m).toContain("คลิปสั้น");
    expect(m).toContain("LINE OA");
    expect(m).toContain("ข้อเท็จจริง");
    expect(m).not.toMatch(/[a-z]+_[a-z_]+/);
  });
});

describe("stale — ข้อความที่แปลว่า 'หน้านี้เก่ากว่า DB' ต้องสั่ง refresh", () => {
  const stale = (code: string, message: string) => describeRpcError({ code, message }, "x").stale;
  it("อนุมัติแล้วห้ามแก้ · รอเงื่อนไข · เลื่อนวันหลังวางแผน · มีโพสต์ช่องนี้แล้ว · ผูกกับชิ้นนี้แล้ว", () => {
    expect(stale("55000", "campaign_set_artifact_content: อนุมัติแล้ว ห้ามแก้เนื้อหา")).toBe(true);
    expect(stale("55000", "content_piece_post: ชิ้นงานรอเงื่อนไขอยู่ (รอของ) — กด resume ก่อน")).toBe(true);
    expect(stale("55000", "content_piece_set_plan: เลื่อนวันหลังวางแผนแล้วต้องใช้ content_piece_defer")).toBe(true);
    expect(stale("55000", "content_piece_post: ชิ้นนี้มีโพสต์ tiktok ที่ใช้งานอยู่แล้ว")).toBe(true);
    expect(stale("55000", "content_piece_post: โพสต์นี้ผูกกับชิ้นนี้อยู่แล้ว")).toBe(true);
  });
  it("ข้อผิดพลาดที่ไม่เกี่ยวกับความเก่า (ด่านไม่ผ่าน/อินพุต/ผูกชิ้นอื่น) ไม่ตั้ง stale", () => {
    expect(stale("55000", "content_piece_advance: อนุมัติไม่ได้ — ยังมี [ต้องยืนยัน] ที่ยังไม่ตอบ 2 รายการ")).toBe(false);
    expect(stale("55000", "content_piece_post: โพสต์นี้ผูกกับชิ้นงานอื่นอยู่")).toBe(false);
    expect(stale("22023", "content_piece_advance: การยกเลิกต้องมีเหตุผล")).toBe(false);
    expect(stale("42501", "x")).toBe(false);
  });
});

describe("IDENT_TH ตรงกับ label map", () => {
  it("ค่า enum snake_case ในประโยค → คำไทยจาก label map เดียวกัน · คำเดี่ยวไม่ถูกแทน", async () => {
    const L = await import("./piece-labels");
    const { sanitizeRpcText } = await import("./rpc-messages");
    const maps: Record<string, string>[] = [L.GATE_KIND_LABEL, L.PIECE_KIND_LABEL, L.CHANNEL_LABEL, L.CUSTOMER_GROUP_LABEL, L.FOOTAGE_STATUS_LABEL, L.SHOOT_LOCATION_LABEL, L.GATE_STATUS_LABEL];
    for (const m of maps) {
      for (const [k, v] of Object.entries(m)) {
        if (k.includes("_")) expect(sanitizeRpcText(`ยังไม่ได้ตั้ง ${k} ของชิ้นนี้`)).toContain(v);
      }
    }
    // คำเดี่ยว (ไม่มี _) ไม่ถูกแทนที่กลางประโยค
    expect(sanitizeRpcText("ลองดู other story shot ก่อน")).toContain("other story shot");
  });
});
