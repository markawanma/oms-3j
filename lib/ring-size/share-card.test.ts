import { describe, expect, it } from "vitest";
import { SHARE_CARD_HEIGHT, SHARE_CARD_MIN_FONT_PX, SHARE_CARD_WIDTH, dataUrlToFile, drawShareCard, wrapText, type Ctx2D } from "./share-card";
import { COPY } from "./config";

// ctx ปลอม: บันทึกการเรียก เพื่อตรวจขนาดฟอนต์ ข้อความที่วาด และไม่ throw
function fakeCtx(opts: { drawImageThrows?: boolean } = {}) {
  const texts: string[] = [];
  const fonts: string[] = [];
  let font = "";
  const ctx = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    textAlign: "left",
    textBaseline: "alphabetic",
    get font() {
      return font;
    },
    set font(v: string) {
      font = v;
      fonts.push(v);
    },
    fillRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    arcTo() {},
    arc() {},
    closePath() {},
    stroke() {},
    fill() {},
    fillText(t: string) {
      texts.push(t);
    },
    // ความกว้างจำลอง: 0.5 × ขนาดฟอนต์ ต่อตัวอักษร
    measureText(t: string) {
      const px = Number(/(\d+)px/.exec(font)?.[1] ?? 16);
      return { width: t.length * px * 0.5 } as TextMetrics;
    },
    drawImage() {
      if (opts.drawImageThrows) throw new Error("taint");
    },
  };
  return { ctx: ctx as unknown as Ctx2D, texts, fonts };
}

const DATA = { rec: 54, circ: 54.3, measuredAt: new Date(2026, 9, 24, 12).getTime() };

describe("drawShareCard (R7 · B19)", () => {
  it("ขนาดการ์ด 1080×1350", () => {
    expect([SHARE_CARD_WIDTH, SHARE_CARD_HEIGHT]).toEqual([1080, 1350]);
  });

  it("ตัวหนังสือเล็กสุด ≥ 34 px ทุกบรรทัด", () => {
    const { ctx, fonts } = fakeCtx();
    drawShareCard(ctx, DATA, { logo: null });
    const sizes = fonts.map((f) => Number(/(\d+)px/.exec(f)?.[1])).filter(Number.isFinite);
    expect(sizes.length).toBeGreaterThan(3);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(SHARE_CARD_MIN_FONT_PX);
  });

  it("เลขเบอร์ใช้ serif น้ำหนัก 600 ไม่ใช่ 700 (ฟอนต์โหลดแค่ 500/600)", () => {
    const { ctx, fonts } = fakeCtx();
    drawShareCard(ctx, DATA, { logo: null });
    expect(fonts.some((f) => f.startsWith("600 380px"))).toBe(true);
    expect(fonts.some((f) => f.startsWith("700 "))).toBe(false);
  });

  it("เนื้อหา: เบอร์จริง · เส้นรอบวง 1 ทศนิยม · ข้อความความแม่นชุดเดียว · วันที่ พ.ศ. · ท้ายการ์ด LINE", () => {
    const { ctx, texts } = fakeCtx();
    drawShareCard(ctx, DATA, { logo: null });
    const all = texts.join("\n");
    expect(texts).toContain("54");
    expect(all).toContain("เส้นรอบวงด้านในประมาณ 54.3 มม.");
    expect(all).toContain("±1 เบอร์");
    expect(all).toContain("เบอร์ตามตารางของร้าน 3J");
    expect(all).toContain("วัดเมื่อ 24 ต.ค. 2569");
    expect(all).toContain("3J Jewelry · LINE @3jjewelry");
  });

  it("ไม่มีราคา/URL/ข้อมูลส่วนตัว/ชื่อธุรกิจในเครือ (SHARE_CARD_URL = null)", () => {
    const { ctx, texts } = fakeCtx();
    drawShareCard(ctx, DATA, { logo: null });
    const all = texts.join("\n");
    expect(all).not.toMatch(/https?:|www\.|฿|ราคา|บาท|โทร|ชื่อ/);
  });

  it("เส้นรอบวงแสดง 1 ทศนิยมแม้เป็นจำนวนเต็ม", () => {
    const { ctx, texts } = fakeCtx();
    drawShareCard(ctx, { ...DATA, rec: 54, circ: 54 }, { logo: null });
    expect(texts.join("\n")).toContain("54.0 มม.");
  });

  it("ข้อความเล็กไม่เกิน 2 บรรทัด", () => {
    const { ctx, texts } = fakeCtx();
    drawShareCard(ctx, DATA, { logo: null });
    // ส่วนของ footer แตกเป็นบรรทัด — รวมแล้วต้องได้ข้อความเดิมครบ
    const footerParts = texts.filter((t) => COPY.share.footer.includes(t) && t.length > 5);
    expect(footerParts.length).toBeGreaterThanOrEqual(1);
    expect(footerParts.length).toBeLessThanOrEqual(2);
    expect(footerParts.join(" ")).toBe(COPY.share.footer);
  });

  it("ไม่ throw เมื่อโลโก้วาดไม่ได้ (canvas taint) หรือฟอนต์ล้ม (ตกไปฟอนต์ระบบ)", () => {
    const { ctx } = fakeCtx({ drawImageThrows: true });
    expect(() => drawShareCard(ctx, DATA, { logo: {} as CanvasImageSource })).not.toThrow();
    expect(() => drawShareCard(fakeCtx().ctx, DATA, { logo: null, fonts: undefined })).not.toThrow();
  });
});

describe("wrapText", () => {
  it("ตัดตามช่องว่างไม่เกิน maxLines และไม่ทำข้อความหาย", () => {
    const ctx = { measureText: (t: string) => ({ width: t.length * 10 }) as TextMetrics };
    const text = "aaa bbb ccc ddd eee fff";
    const lines = wrapText(ctx, text, 80, 2);
    expect(lines.length).toBeLessThanOrEqual(2);
    expect(lines.join(" ")).toBe(text);
  });
  it("คำเดียวยาวเกินกว้าง → ยังคืนหนึ่งบรรทัด ไม่วนไม่สิ้นสุด", () => {
    const ctx = { measureText: (t: string) => ({ width: t.length * 100 }) as TextMetrics };
    expect(wrapText(ctx, "ยาวมากไม่มีช่องว่าง", 50, 2)).toEqual(["ยาวมากไม่มีช่องว่าง"]);
  });
});

describe("dataUrlToFile", () => {
  it("แปลง data URL base64 → File (ไม่ใช้ blob:/fetch)", () => {
    const f = dataUrlToFile("data:image/png;base64,iVBORw0KGgo=", "x.png");
    expect(f).not.toBeNull();
    expect(f!.type).toBe("image/png");
    expect(f!.name).toBe("x.png");
    expect(f!.size).toBeGreaterThan(0);
  });
  it("รูปแบบเสีย → null ไม่ throw", () => {
    expect(dataUrlToFile("blob:https://x/1", "x.png")).toBeNull();
    expect(dataUrlToFile("data:image/png;base64,@@@", "x.png")).toBeNull();
  });
});
