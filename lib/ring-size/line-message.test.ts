import { describe, expect, it } from "vitest";
import { LINE_OA_ID, LINE_OA_URL, lineOaMessageUrl } from "@/lib/shop/line";
import { LINE_HELP_MESSAGE, LINE_OA_FALLBACK_URL, LINE_PRIMARY_MODE } from "./config";
import { buildLineMessage, buildOaMessageUrl, copyText, helpLineHref, primaryLineHref } from "./line-message";
import type { Method } from "./config";
import { circToRec } from "./size";

const rec = (c: number, m: Method) => circToRec(c, m)!;

describe("buildLineMessage (spec ข้อ 2.7 · A6)", () => {
  it("แบบปกติ: เบอร์ · มม. 1 ทศนิยม · วิธี · เทียบจอด้วย", () => {
    expect(buildLineMessage({ size: rec(54, "A"), method: "A", ref: "coin" })).toBe(
      "สวัสดี ฉันวัดไซส์แหวนได้เบอร์ 54 (เส้นรอบวงด้านใน ~54.0 มม. · วิธี: แหวนวงเดิม · เทียบจอด้วย: เหรียญ 10 บาท) ช่วยแนะนำแหวนไซส์นี้ให้หน่อย"
    );
  });
  it("แบบระหว่างเบอร์: ช่วง lo-hi + เบอร์ที่ระบบแนะนำ", () => {
    expect(buildLineMessage({ size: rec(54.4, "B"), method: "B", ref: "card" })).toBe(
      "สวัสดี ฉันวัดไซส์แหวนได้ ~54.4 มม. อยู่ระหว่างเบอร์ 54-55 ระบบแนะนำเบอร์ 55 (วิธี: กระดาษพันนิ้ว · เทียบจอด้วย: บัตร) ช่วยแนะนำแหวนไซส์นี้ให้หน่อย"
    );
  });
  it("มีเฉพาะ เบอร์/มม./วิธี/เทียบจอด้วย — ไม่มีราคา ชื่อ เบอร์โทร URL อีเมล", () => {
    const msgs = [
      buildLineMessage({ size: rec(54, "A"), method: "A", ref: "coin" }),
      buildLineMessage({ size: rec(54.4, "B"), method: "B", ref: "card" }),
      buildLineMessage({ size: rec(41.2, "A"), method: "A", ref: "card" }),
    ];
    for (const m of msgs) {
      expect(m).not.toMatch(/บาท(?!\))|฿|ราคา|THB|\bhttps?:|@|โทร|เบอร์โทร|ชื่อ|อีเมล|email/i);
      // เลขทั้งหมดในข้อความ ต้องเป็นเบอร์/มม. ที่มาจากผลวัดเท่านั้น (ไม่มีเลข 10 หลักแบบเบอร์โทร)
      expect(m).not.toMatch(/\d{7,}/);
    }
  });
  it("คำว่า บาท ปรากฏได้เฉพาะในชื่อวัตถุเทียบ 'เหรียญ 10 บาท'", () => {
    const m = buildLineMessage({ size: rec(54, "A"), method: "A", ref: "coin" });
    expect(m.match(/บาท/g)).toHaveLength(1);
    expect(m).toContain("เหรียญ 10 บาท");
    expect(buildLineMessage({ size: rec(54, "A"), method: "A", ref: "card" })).not.toContain("บาท");
  });
});

describe("ลิงก์ LINE — ค่าเดียวจาก lib/shop/line.ts", () => {
  it("OA ID = 3jjewelry · fallback = lin.ee ที่เจ้าของให้", () => {
    expect(LINE_OA_ID).toBe("3jjewelry");
    expect(LINE_OA_FALLBACK_URL).toBe(LINE_OA_URL);
    expect(LINE_OA_FALLBACK_URL).toBe("https://lin.ee/PzIJl6j");
  });
  it("oaMessage encode ข้อความ + ใช้ %40 กับ ID ของเจ้าของ", () => {
    const input = { size: rec(54, "A"), method: "A" as const, ref: "coin" as const };
    const url = buildOaMessageUrl(input);
    expect(url.startsWith("https://line.me/R/oaMessage/%403jjewelry/?")).toBe(true);
    expect(url).toBe(lineOaMessageUrl(buildLineMessage(input)));
    expect(decodeURIComponent(url.split("?")[1])).toBe(buildLineMessage(input));
  });
  it("โหมดเริ่มต้นบน production = copyThenOpen (oaMessage ยังไม่ผ่านทดสอบเครื่องจริง)", () => {
    expect(LINE_PRIMARY_MODE).toBe("copyThenOpen");
  });
  it("primaryLineHref: copyThenOpen → แชทเปล่า · oaMessage → แชทพร้อมข้อความ", () => {
    const input = { size: rec(54, "A"), method: "A" as const, ref: "coin" as const };
    expect(primaryLineHref(input, "copyThenOpen")).toBe(LINE_OA_FALLBACK_URL);
    expect(primaryLineHref(input, "oaMessage")).toBe(buildOaMessageUrl(input));
  });
  it("ข้อความขอให้ช่วยวัดยังไม่ยืนยัน (null) → ปุ่มเปิดแชทเปล่า ไม่มีข้อความเตรียม", () => {
    expect(LINE_HELP_MESSAGE).toBeNull();
    expect(helpLineHref("oaMessage")).toBe(LINE_OA_FALLBACK_URL);
    expect(helpLineHref("copyThenOpen")).toBe(LINE_OA_FALLBACK_URL);
  });
});

describe("copyText — ไม่ throw ไม่ว่า environment ไหน", () => {
  it("ไม่มี navigator/document (node) → false ไม่ throw", async () => {
    await expect(copyText("x")).resolves.toBe(false);
  });
});
