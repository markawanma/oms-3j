import { describe, expect, it } from "vitest";
import { describeRpcError, humanizeRpcError } from "./rpc-messages";

const err = (code: string, message: string) => ({ code, message });

describe("ข้อความ error ของ content_signal_capture / set_status (22023 ภาษาเจ้าของ ไม่ตกเป็นข้อความกลาง)", () => {
  const cases: [string, RegExp][] = [
    ["content_signal_capture: ตัวเลขยอด/ผู้ติดตามต้องอยู่ระหว่าง 0 ถึง 10,000,000,000 (ไม่เห็นให้เว้นว่าง ห้ามใส่ 0)", /ตัวเลขต้องอยู่ระหว่าง 0/],
    ['content_signal_capture: ติดธง "ตัวเลขประมาณ" แต่ไม่มีตัวเลขสักช่อง', /ค่าประมาณ/],
    ["content_signal_capture: posted_on ต้องไม่หลังวันที่เห็น", /วันที่โพสต์คลิป/],
    ["content_signal_capture: seen_on อยู่ในอนาคต", /วันที่เห็น/],
    ["content_signal_capture: คลิปอ้างอิงต้องมีลิงก์และ hook_text", /ประโยคเปิด/],
    ["content_signal_capture: summary ต้องมี 1 บรรทัด ยาว 1-300 ตัวอักษร", /สรุป/],
    ["content_signal_capture: hook_text ยาวเกิน 500 ตัวอักษร", /ประโยคเปิดยาวเกิน/],
    ["content_signal_capture: ลิงก์ยาวเกิน 500 ตัวอักษร", /ลิงก์ยาวเกิน/],
    ["content_signal_capture: ลิงก์ไม่ถูกต้อง (ต้องเป็น http/https ไม่มี user@ ช่องว่าง)", /คัดลอกลิงก์จากแอป/],
    ["content_signal_set_status: เก็บไว้ก่อนต้องระบุวันกลับมาดู (วันนี้หรืออนาคต)", /เลือกวันกลับมาดู/],
  ];
  for (const [msg, re] of cases) {
    it(msg.slice(0, 60), () => {
      const m = humanizeRpcError(err("22023", msg), "ล้มเหลว");
      expect(m).toMatch(re);
      expect(m).not.toMatch(/content_signal|hook_text|posted_on|seen_on/);
    });
  }

  it("23505 ซ้ำ ใช้ข้อความตามบริบทที่ส่งมา", () => {
    const d = describeRpcError(err("23505", "content_signal_capture: ลิงก์นี้ถูกบันทึกไว้แล้ว"), "x", { duplicate: "ลิงก์นี้เคยแปะแล้ว" });
    expect(d.message).toBe("ลิงก์นี้เคยแปะแล้ว");
    expect(d.duplicate).toBe(true);
  });
});
