// lib/ring-size/copy-guard.test.ts — ด่านกวาดข้อความ/ซอร์สของ /ring-size (build spec ข้อ 2 · 3 · 5 · 6 A9-A13)
//
// กฎที่ล็อกด้วยเทสต์ (ไม่ใช่วินัย):
//   A10 ถ้อยคำต้องห้าม · A11 ความแม่นชุดเดียว · A12 ไม่มีเลขตัวอย่างจาก mockup ใน config · A13 ค่าที่ยังไม่ยืนยัน = ปิดบน production
//   + ข้อบังคับ implement: ไม่มีเวทีจำลอง (A9 ส่วนซอร์ส) · ไม่มี border บนองค์ประกอบวัด · ไม่ใช้ 100vh · ไม่ปิด pinch-zoom (G1) ·
//     ไม่ใช้ font-bold บน serif · ตัวหนังสือ ≥ 13 px · ปุ่มปิดใช้งานเป็น <button disabled> · ไม่มี network/Server Action ·
//     ไม่มี <link> ฟอนต์ภายนอก (ใช้ next/font ของ layout แม่)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as config from "./config";
import { ACCURACY_NOTE, ACCURACY_SHORT, COPY, NOINDEX } from "./config";
import { RING_APP_DIR, RING_LIB_DIR, listSources, readStripped, rel } from "./source-scan.test-util";

/** เก็บสตริงทุกตัวใน COPY — ฟังก์ชันเรียกด้วยชุดอาร์กิวเมนต์ตัวอย่างหลายชุดเพื่อให้ได้ข้อความทุกแบบ */
function collectStrings(node: unknown, out: string[] = []): string[] {
  if (typeof node === "string") out.push(node);
  else if (typeof node === "function") {
    const fn = node as (...a: unknown[]) => unknown;
    for (const args of [["coin"], ["card"], ["A"], ["B"], ["เล็ก", "ใหญ่"], ["x", "เล็ก", "40", "75"], ["x", "y", "z", "w", "v"], [1, 2, 3, 4, 5], [1, "2", "A", "coin"]]) {
      try {
        const v = fn(...args);
        if (typeof v === "string") out.push(v);
      } catch {
        // ชุดอาร์กิวเมนต์ไม่เข้ากับฟังก์ชันนี้ — ข้าม
      }
    }
  } else if (Array.isArray(node)) node.forEach((n) => collectStrings(n, out));
  else if (node && typeof node === "object") Object.values(node).forEach((n) => collectStrings(n, out));
  return out;
}

const FORBIDDEN: Array<[RegExp, string]> = [
  [/ครึ่งเบอร์/, "ครึ่งเบอร์"],
  [/แม่นยำ/, "แม่นยำ"],
  [/แม่นที่สุด/, "แม่นที่สุด"],
  [/ใกล้เคียงกัน/, "ใกล้เคียงกัน"],
  [/ใน 1 นาที/, "ใน 1 นาที"],
  [/ทุกใบ/, "ทุกใบ"],
  [/ทุกเหรียญ/, "ทุกเหรียญ"],
  [/ไม่บันทึกอะไร/, "ไม่บันทึกอะไร"],
  [/ถามขออนุญาต/, "ถามขออนุญาต"],
  [/เสมอ/, "เสมอ"],
  [/มาตรฐานสากล/, "มาตรฐานสากล"],
  [/\bISO\b/, "ISO"],
  [/ทุกร้าน/, "ทุกร้าน"],
  [/ร้านมีเบอร์นี้/, "ร้านมีเบอร์นี้"],
  [/บัตรสมาชิก/, "บัตรสมาชิก"],
  [/ใบขับขี่/, "ใบขับขี่"],
  [/ภาพจำลอง/, "ภาพจำลอง"],
];

const APP_SOURCES = listSources(RING_APP_DIR);
const LIB_SOURCES = listSources(RING_LIB_DIR);
const UI_SOURCES = APP_SOURCES.filter((f) => /\.tsx$/.test(f));

describe("สแกนไม่ว่างเปล่า (กัน false-pass)", () => {
  it("เจอไฟล์ที่ต้องตรวจ", () => {
    expect(APP_SOURCES.length).toBeGreaterThan(20);
    expect(LIB_SOURCES.length).toBeGreaterThan(8);
    expect(Object.keys(COPY).length).toBeGreaterThan(15);
  });
});

describe("A10: ถ้อยคำต้องห้าม ไม่อยู่ใน copy และซอร์ส UI (ตัดคอมเมนต์แล้ว)", () => {
  const strings = collectStrings(COPY);
  it("COPY มีข้อความจริงให้ตรวจ", () => {
    expect(strings.length).toBeGreaterThan(150);
  });
  it.each(FORBIDDEN)("COPY ไม่มี %s", (re, label) => {
    expect(strings.filter((s) => re.test(s)), label).toEqual([]);
  });
  it.each(FORBIDDEN)("ซอร์ส app/(quiz)/ring-size และ lib/ring-size (ไม่รวมเทสต์) ไม่มี %s", (re, label) => {
    const hits = [...APP_SOURCES, ...LIB_SOURCES].filter((f) => re.test(readStripped(f))).map(rel);
    expect(hits, label).toEqual([]);
  });
  it("negative control: ด่านนี้จับของจริงได้", () => {
    expect(FORBIDDEN.some(([re]) => re.test("ผลที่ได้แม่นยำมาก"))).toBe(true);
    expect(FORBIDDEN.some(([re]) => re.test("ถูกต้องตามมาตรฐาน ISO"))).toBe(true);
    expect(FORBIDDEN.some(([re]) => re.test("คลาดเคลื่อนได้ราว ±1 เบอร์"))).toBe(false);
    expect(FORBIDDEN.some(([re]) => re.test("ISOLATED toISOString"))).toBe(false);
  });
});

describe("A11: ความแม่นชุดเดียว (มติ Q1: ±1 เบอร์ ทุกวิธี)", () => {
  it("ข้อความมาจาก config จุดเดียว", () => {
    expect(ACCURACY_SHORT).toBe("คลาดเคลื่อนได้ราว ±1 เบอร์");
    expect(ACCURACY_NOTE).toBe("วัดด้วยมือถือ คลาดเคลื่อนได้ราว ±1 เบอร์ ถ้าจะซื้อเป็นของขวัญหรือไม่แน่ใจ ทักแอดมินช่วยเช็กอีกครั้งได้");
  });
  it("ไม่มีสตริงความแม่นซ้ำในซอร์ส UI (ใช้ ACCURACY_* จาก config เท่านั้น)", () => {
    const hits = UI_SOURCES.filter((f) => /±|คลาดเคลื่อน/.test(readStripped(f))).map(rel);
    expect(hits).toEqual([]);
  });
  it("ทุกข้อความใน COPY ที่มี ± ต้องอ้าง ACCURACY_SHORT/NOTE (ถ้อยคำเดียว — ไม่มีสำเนาที่พิมพ์ซ้ำ รวมการ์ดแชร์)", () => {
    const withPm = collectStrings(COPY).filter((s) => s.includes("±"));
    expect(withPm.length).toBeGreaterThan(0);
    for (const s of withPm) {
      expect(s.includes(ACCURACY_SHORT), s).toBe(true);
      expect(s).not.toMatch(/ครึ่ง/); // ไม่มี ±ครึ่งเบอร์ ที่ใดเลย
    }
  });
  it("ไม่มีข้อความที่บอกว่าวิธีไหนแม่นกว่ากัน", () => {
    for (const s of collectStrings(COPY)) expect(s).not.toMatch(/แม่นกว่า|แม่นที่สุด|ที่แม่น/);
  });
});

describe("A12: ไม่มีเลขตัวอย่างจาก mockup ฝังใน config", () => {
  const src = readStripped(join(RING_LIB_DIR, "config.ts"));
  it("ไม่มี 54 · 58 · 57.5 · 43 · 54.1 · 37.7 · 2569 เป็นตัวเลขเดี่ยวๆ", () => {
    expect(src.match(/(?<![\d.])(54|58|57\.5|43|54\.1|37\.7|2569)(?![\d])/g)).toBeNull();
  });
  it("ข้อความไม่มีเลขตัวอย่าง (เฉพาะเลขในประโยคที่เป็นข้อเท็จจริงของสเปค: 3J · ±1 · 10 บาท · ① ② · 80? ไม่มี)", () => {
    for (const s of collectStrings(COPY)) {
      expect(s, s).not.toMatch(/(?<![\d.])(54|58|57\.5|43|54\.1|37\.7|2569)(?![\d])/);
    }
  });
});

describe("A13: ค่าที่ยังไม่ยืนยัน = ปิด/null บน production", () => {
  it("flag ซ่อนค่าเป็นค่า default ปิดทั้งหมด", () => {
    expect(config.SHOW_FINGER_TIPS).toBe(false);
    expect(config.SHOW_KNUCKLE_RULE).toBe(false);
    expect(config.PAPER_SIZE_HINT).toBeNull();
    expect(config.BETWEEN_REASON).toBeNull();
    expect(config.RING_TOOL_DESTINATIONS.shop).toBeNull();
    expect(config.SHARE_CARD_URL).toBeNull();
    expect(config.LINE_HELP_MESSAGE).toBeNull();
    expect(config.LINE_PRIMARY_MODE).toBe("copyThenOpen");
    expect(config.TRACK_ENABLED).toBe(false);
    expect(NOINDEX).toBe(true);
  });
  it("COPY ไม่มี marker ค้าง [ต้องยืนยัน / [รอผ่านด่าน", () => {
    for (const s of collectStrings(COPY)) expect(s).not.toMatch(/\[ต้องยืนยัน|\[รอผ่านด่าน/);
  });
  it("L3: ข้อความที่ยังไม่ผ่านด่านข้อเท็จจริงไม่อยู่ใน bundle เลย (ไม่ใช่แค่ซ่อนด้วย flag): knuckle = null · tips = [] · tipsTitle = null", () => {
    expect(COPY.r4b.knuckle).toBeNull();
    expect(COPY.r6.tips).toEqual([]);
    expect(COPY.r6.tipsTitle).toBeNull();
    const SENTENCES = [
      "ลองสวมแถบกระดาษผ่านข้อนิ้ว",
      "ใช้ค่าที่ใหญ่กว่า",
      "นิ้วขนาดไม่เท่ากันตลอดวัน",
      "บวมตอนเย็น",
      "หลังออกกำลังกาย",
      "ควรวัดช่วงบ่าย",
      "ข้อนิ้วใหญ่กว่าโคนนิ้ว",
      "ผ่านข้อนิ้วได้โดยไม่ฝืด",
      "เคล็ดลับก่อนสั่ง",
    ];
    // ทั้ง config และซอร์ส UI/ลอจิกที่ส่งถึงลูกค้า (ตัดคอมเมนต์แล้ว) ต้องไม่มีสตริงเหล่านี้
    const hits: string[] = [];
    for (const f of [...APP_SOURCES, ...LIB_SOURCES]) {
      const code = readStripped(f);
      for (const t of SENTENCES) if (code.includes(t)) hits.push(`${rel(f)}: ${t}`);
    }
    expect(hits).toEqual([]);
    for (const s of collectStrings(COPY)) for (const t of SENTENCES) expect(s.includes(t), `${t} ใน COPY`).toBe(false);
  });
  it("ไม่มีข้อความเคล็ดลับ 'หน้ากว้าง' (รอกฎช่าง Q12) อยู่ใน config เลย", () => {
    for (const s of collectStrings(COPY)) expect(s).not.toMatch(/หน้ากว้าง|ครึ่งถึง 1 เบอร์/);
  });
  it("ค่าคงที่ที่ยืนยันแล้ว: เหรียญ 26 · บัตร 53.98 · ช่วงร้าน 45–68", () => {
    expect(config.CALIBRATION.REF.coin.mm).toBe(26);
    expect(config.CALIBRATION.REF.card.mm).toBe(53.98);
    expect(config.SHOP_RING_SIZES).toEqual({ min: 45, max: 68 });
    expect(config.CALIBRATION.STROKE_PX).toBe(2);
    expect(config.CALIBRATION.PPM_TYPICAL).toEqual([4.5, 7.5]);
    expect(config.MEASURE.G4).toEqual([40, 75]);
  });
});

describe("ข้อบังคับ implement (ซอร์ส UI)", () => {
  it("A9: เวทีไม่มีวัตถุจำลอง — ไม่มีข้อความ 'ภาพจำลอง' (ครอบใน A10 แล้ว) และไฟล์ *Stage ไม่มี border/box-sizing", () => {
    const stages = UI_SOURCES.filter((f) => /(Stage|StageSvg)\.tsx$/.test(f) && !/StageHost/.test(f));
    expect(stages.length).toBeGreaterThanOrEqual(5);
    for (const f of stages) expect(readStripped(f), rel(f)).not.toMatch(/border|box-sizing|boxSizing/);
  });
  it("เวที: viewBox ผูกกับ width/height ที่วัดจริง (ไม่มี viewBox ตายตัวในไฟล์เวที)", () => {
    for (const f of UI_SOURCES.filter((p) => /(CalibrationStage|CoinCalibrationStage|RingDiscStage|StageSvg|RulerStage)\.tsx$/.test(p))) {
      const code = readStripped(f);
      expect(code, rel(f)).not.toMatch(/viewBox=["']\d/); // ห้าม viewBox="0 0 390 ..." ตายตัว
    }
  });
  it("ไม่ปัด px เป็นจำนวนเต็มในเวที (ไม่มี Math.round/floor/ceil ในไฟล์เวที)", () => {
    for (const f of UI_SOURCES.filter((p) => /(CalibrationStage|CoinCalibrationStage|RingDiscStage|StageSvg)\.tsx$/.test(p))) {
      expect(readStripped(f), rel(f)).not.toMatch(/Math\.(round|floor|ceil|trunc)/);
    }
    expect(readStripped(join(RING_LIB_DIR, "stage-geometry.ts"))).not.toMatch(/Math\.(round|floor|ceil|trunc)/);
  });
  it("ไม่ใช้ 100vh / h-screen / min-h-screen (ใช้ dvh)", () => {
    const hits = UI_SOURCES.filter((f) => /100vh|h-screen|min-h-screen|svh|lvh/.test(readStripped(f))).map(rel);
    expect(hits).toEqual([]);
    expect(readStripped(join(RING_APP_DIR, "layout.tsx"))).toContain("100dvh");
  });
  it("G1: ไม่ปิด pinch-zoom ทั้งหน้า (ไม่มี viewport-fit/maximum-scale/user-scalable/export viewport)", () => {
    for (const f of APP_SOURCES) {
      const code = readStripped(f);
      expect(code, rel(f)).not.toMatch(/viewport-fit|maximum-scale|user-scalable|minimum-scale/);
      expect(code, rel(f)).not.toMatch(/export\s+(const|function)\s+viewport/);
    }
  });
  it("ไม่มี <link> ฟอนต์/ไฟล์ภายนอก และไม่มี URL ฟอนต์ของ Google", () => {
    for (const f of APP_SOURCES) {
      const code = readStripped(f);
      expect(code, rel(f)).not.toMatch(/<link[\s>]/);
      expect(code, rel(f)).not.toMatch(/fonts\.googleapis|fonts\.gstatic/);
    }
  });
  it("ไม่ใช้ font-bold (serif โหลดแค่ 500/600 — ห้ามให้เบราว์เซอร์สังเคราะห์ตัวหนา) และไม่ขอ font-weight 700", () => {
    for (const f of UI_SOURCES) {
      const code = readStripped(f);
      expect(code, rel(f)).not.toMatch(/font-bold|font-extrabold|font-black/);
      expect(code, rel(f)).not.toMatch(/fontWeight\s*[:=]\s*["']?[7-9]00/);
    }
    expect(readStripped(join(RING_LIB_DIR, "share-card.ts"))).not.toMatch(/\b700 \d+px/);
  });
  it("ตัวหนังสือ ≥ 13 px ทุกที่ (class text-[Npx])", () => {
    const small: string[] = [];
    for (const f of UI_SOURCES) {
      for (const m of readStripped(f).matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)) {
        if (Number(m[1]) < 13) small.push(`${rel(f)}: ${m[0]}`);
      }
    }
    expect(small).toEqual([]);
  });
  it("B12: ปุ่มปิดใช้งานเป็น <button disabled> — ไม่มี <a aria-disabled>", () => {
    for (const f of UI_SOURCES) expect(readStripped(f), rel(f)).not.toMatch(/aria-disabled/);
  });
  it("ไม่มี Server Action / lib/actions / network (fetch · XHR · sendBeacon · WebSocket) ในหน้านี้", () => {
    for (const f of [...APP_SOURCES, ...LIB_SOURCES]) {
      const raw = readFileSync(f, "utf8");
      expect(raw, rel(f)).not.toMatch(/^\s*["']use server["'];?\s*$/m);
      expect(readStripped(f), rel(f)).not.toMatch(/lib\/actions|\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource/);
    }
  });
  it("ไม่มี dangerouslySetInnerHTML และไม่ใช้ eval/new Function", () => {
    for (const f of [...APP_SOURCES, ...LIB_SOURCES]) {
      expect(readStripped(f), rel(f)).not.toMatch(/dangerouslySetInnerHTML|\beval\s*\(|new Function\s*\(/);
    }
  });
  it("ไม่แตะ DB/auth/env: ไม่ import supabase / lib/auth / process.env", () => {
    for (const f of [...APP_SOURCES, ...LIB_SOURCES]) {
      expect(readStripped(f), rel(f)).not.toMatch(/supabase|lib\/auth|process\.env/);
    }
  });
});
