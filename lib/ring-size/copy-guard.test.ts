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
import { RING_APP_DIR, RING_LIB_DIR, listSources, readStripped, rel, stripComments } from "./source-scan.test-util";

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
    // TRACK_ENABLED เปิดแล้ว (P2 3 พ.ย. 69 — มติเจ้าของ + คู่กับถ้อยคำใหม่ในหัวข้อ "ความเป็นส่วนตัว" ด้านล่าง) · ไม่ใช่ "ค่าที่ยังไม่ยืนยัน"
    expect(config.TRACK_ENABLED).toBe(true);
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
  it("ไม่มี Server Action / lib/actions / network (fetch · XHR · sendBeacon · WebSocket) ในหน้านี้ — ยกเว้นไฟล์เดียว lib/ring-size/track.ts (P2 สถิติไม่ระบุตัวตน)", () => {
    const NETWORK_ALLOWED = "lib/ring-size/track.ts"; // path เป๊ะ — ไฟล์อื่น (รวมที่ชื่อคล้าย) ไม่ได้รับยกเว้น
    for (const f of [...APP_SOURCES, ...LIB_SOURCES]) {
      const raw = readFileSync(f, "utf8");
      expect(raw, rel(f)).not.toMatch(/^\s*["']use server["'];?\s*$/m);
      const code = readStripped(f);
      if (rel(f) === NETWORK_ALLOWED) {
        // ไฟล์ที่ได้รับยกเว้นยังห้าม channel อื่น (ส่งได้แค่ sendBeacon/fetch) และห้ามลากโค้ดฝั่งเซิร์ฟเวอร์
        expect(code, rel(f)).not.toMatch(/lib\/actions|XMLHttpRequest|WebSocket|EventSource/);
      } else {
        expect(code, rel(f)).not.toMatch(/lib\/actions|\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource/);
      }
    }
  });
  it("track.ts เป็นไฟล์เดียวที่มี network (ยืนยันว่ามีจริง + ยิงไป endpoint ในเว็บเดียวกันเท่านั้น ไม่มี URL ภายนอก)", () => {
    const withNetwork = [...APP_SOURCES, ...LIB_SOURCES].filter((f) => /\bfetch\s*\(|sendBeacon/.test(readStripped(f))).map(rel);
    expect(withNetwork).toEqual(["lib/ring-size/track.ts"]);
    const code = readStripped(join(RING_LIB_DIR, "track.ts"));
    expect(code).not.toMatch(/https?:|\/\/[a-z0-9.-]+\.[a-z]{2,}/i);
    expect(code).toMatch(/TRACK_ENDPOINT/);
    expect(config.TRACK_ENDPOINT).toBe("/api/ring-size/event");
  });
  it("M1: trackMeasured( มี call site เดียวใต้ app/(quiz)/ring-size (ไม่นับ _tests) และอยู่ใน finishMeasure — ผลวัดส่งได้จุดเดียว", () => {
    const calls = APP_SOURCES.flatMap((f) => {
      const n = (readStripped(f).match(/\btrackMeasured\s*\(/g) ?? []).length;
      return n > 0 ? [{ file: rel(f), n }] : [];
    });
    expect(calls).toEqual([{ file: "app/(quiz)/ring-size/RingSizeClient.tsx", n: 1 }]);
    // ตำแหน่ง: อยู่ในตัว finishMeasure (หลัง const finishMeasure ก่อน const viewLastResult) — ไม่ใช่ viewLastResult/จอ R6
    const client = readStripped(join(RING_APP_DIR, "RingSizeClient.tsx"));
    const at = client.indexOf("trackMeasured(");
    expect(at).toBeGreaterThan(client.indexOf("const finishMeasure"));
    expect(at).toBeLessThan(client.indexOf("const viewLastResult"));
    // lib: ไม่มีใครเรียก trackMeasured นอก track.ts (ตัว export อยู่ใน track.ts เอง)
    const libCalls = LIB_SOURCES.filter((f) => rel(f) !== "lib/ring-size/track.ts" && /\btrackMeasured\s*\(/.test(readStripped(f))).map(rel);
    expect(libCalls).toEqual([]);
    // negative control: ตัวนับจับของจริงได้
    expect("trackMeasured({ a: 1 })".match(/\btrackMeasured\s*\(/g)).toHaveLength(1);
    expect("// trackMeasured( ในคอมเมนต์ถูกตัด".match(/\btrackMeasured\s*\(/g)).toHaveLength(1);
    expect(stripComments("// trackMeasured( ในคอมเมนต์ถูกตัด\nconst x = 1;").match(/\btrackMeasured\s*\(/g)).toBeNull();
  });
  it("M1: signature ของ track() รับ type ที่ไม่มีช่องผลวัด (พฤติกรรมตัดผลที่ runtime ล็อกใน track.test.ts กลุ่ม M1)", () => {
    const code = readStripped(join(RING_LIB_DIR, "track.ts"));
    expect(code).toMatch(/export function track\(snapshot: TrackSnapshot\)/);
  });
  it("L2: หน้า /ring-size ตั้ง metadata referrer = strict-origin (ไม่ใช่ no-referrer — Origin ของ beacon ต้องอยู่) และ fetch สำรองใช้ strict-origin", () => {
    const page = readStripped(join(RING_APP_DIR, "page.tsx"));
    expect(page).toMatch(/referrer:\s*"strict-origin"/);
    expect(page).not.toMatch(/no-referrer/);
    expect(readStripped(join(RING_LIB_DIR, "track.ts"))).toMatch(/referrerPolicy:\s*"strict-origin"/);
    expect(readStripped(join(RING_LIB_DIR, "track.ts"))).not.toMatch(/referrerPolicy:\s*"no-referrer"/);
  });
  it("track.ts ไม่ import supabase/env/gem-quiz/next และไม่อ่านตัวตน (cookie · IP · query string · ชื่อ · เบอร์ · LINE)", () => {
    const code = readStripped(join(RING_LIB_DIR, "track.ts"));
    expect(code).not.toMatch(/supabase|process\.env|gem-quiz|from ["']next|lib\/auth/);
    expect(code).not.toMatch(/document\.cookie|location\.(search|href|hash)|URLSearchParams|userAgent|\.referrer|localStorage/);
    // import ได้เฉพาะ ./config และ ./track-schema (ค่าคงที่/ชนิดเดียวกับที่ route ใช้ — ไม่ประกาศซ้ำ)
    const imports = [...code.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]).sort();
    expect(imports).toEqual(["./config", "./track-schema"]);
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

describe("ถ้อยคำความเป็นส่วนตัว (P2 — design-ring-size-analytics §4.4 · เจ้าของอนุมัติแล้ว)", () => {
  const OLD_PROMISE = "จนกว่าคุณจะกดส่ง";
  const R6_PRIVACY =
    "เบอร์ของคุณเก็บไว้ในเครื่องนี้ · ร้านได้รับสถิติการใช้งานแบบไม่ระบุตัวตน เช่น เบอร์ที่วัดได้ วิธีวัด ปุ่มที่กด และประเภทแอปที่เปิด (เช่น LINE) · ร้านไม่เก็บชื่อ เบอร์โทร หรือรหัสเครื่อง และลบอัตโนมัติภายใน 6 เดือน";

  /** ข้อความความเป็นส่วนตัวที่ screen เลือก render ตาม flag (ต้องตรงกับที่ R6.tsx / R1Pick.tsx เลือกจริง — เทสต์ซอร์สด้านล่างล็อก) */
  const rendered = (trackEnabled: boolean) =>
    trackEnabled ? [COPY.r6.privacy, COPY.pick.privacyBody, COPY.r0.privacy] : [COPY.r6.privacyOff, COPY.pick.privacyBodyOff, COPY.r0.privacy];

  it("COPY.r6.privacy = ถ้อยคำที่เจ้าของอนุมัติ ลอกทั้งประโยค (ห้ามแก้คำ)", () => {
    expect(COPY.r6.privacy).toBe(R6_PRIVACY);
  });

  it("เมื่อ TRACK_ENABLED เปิด: copy ที่ render ต้องไม่มี 'จนกว่าคุณจะกดส่ง' (คำสัญญาที่ไม่จริงอีกต่อไป)", () => {
    expect(config.TRACK_ENABLED).toBe(true);
    for (const s of rendered(config.TRACK_ENABLED)) expect(s).not.toContain(OLD_PROMISE);
    for (const s of rendered(config.TRACK_ENABLED)) expect(s).not.toMatch(/ไม่ได้รับชื่อหรือข้อมูลส่วนตัว/);
  });

  it("negative control: ข้อความเดิมถูกจับได้จริง · ข้อความเดิมอยู่ได้เฉพาะใน key *Off (ใช้เมื่อปิดสถิติ) — ไม่หลุดไป key อื่นของ COPY", () => {
    expect(rendered(false).some((s) => s.includes(OLD_PROMISE))).toBe(true);
    const holders: string[] = [];
    const walk = (node: unknown, path: string) => {
      if (typeof node === "string") {
        if (node.includes(OLD_PROMISE)) holders.push(path);
      } else if (node && typeof node === "object" && !Array.isArray(node)) {
        for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`);
      }
    };
    walk(COPY, "COPY");
    expect(holders).toEqual(["COPY.r6.privacyOff"]);
  });

  it("ข้อความที่เจ้าของไม่ได้อนุมัติแก้ยังคงเดิม: r0.privacy (ไม่เปิดกล้อง ไม่ถ่ายรูป ไม่ต้องกรอกชื่อหรือเบอร์โทร)", () => {
    expect(COPY.r0.privacy).toBe("ไม่เปิดกล้อง ไม่ถ่ายรูป ไม่ต้องกรอกชื่อหรือเบอร์โทร");
  });

  it("ไม่พูดเกินที่เก็บจริง: ข้อความเมื่อเปิดสถิติไม่อ้างว่า 'ไม่เก็บอะไร/ไม่ส่งอะไร' และไม่บอกว่าเก็บนานกว่า 6 เดือน หรือเก็บ IP/ช่องทาง/รหัสเครื่อง", () => {
    for (const s of [COPY.r6.privacy, COPY.pick.privacyBody]) {
      expect(s).not.toMatch(/ไม่เก็บอะไร|ไม่ส่งอะไร|ไม่มีข้อมูล|ไม่บันทึก|ทันที|ถาวร|ตลอดไป/);
      expect(s).not.toMatch(/IP|ที่อยู่ไอพี|ลิงก์ที่|ช่องทาง|รหัสโฆษณา/);
    }
    // r6.privacy ระบุสิ่งที่เก็บ + สิ่งที่ไม่เก็บ + อายุข้อมูล ครบ 3 อย่าง
    expect(COPY.r6.privacy).toMatch(/เบอร์ที่วัดได้/);
    expect(COPY.r6.privacy).toMatch(/ร้านไม่เก็บชื่อ เบอร์โทร หรือรหัสเครื่อง/);
    expect(COPY.r6.privacy).toMatch(/ลบอัตโนมัติภายใน 6 เดือน/);
    // กล่อง R1Pick: ไม่ใช้กล้อง + ผล/ค่าจออยู่ในเครื่อง + สถิติไม่ระบุตัวตน (สอดคล้องกัน)
    expect(COPY.pick.privacyBody).toMatch(/ไม่ใช้กล้อง/);
    expect(COPY.pick.privacyBody).toMatch(/เก็บไว้ในเครื่องของคุณ/);
    expect(COPY.pick.privacyBody).toMatch(/สถิติการใช้งานแบบไม่ระบุตัวตน/);
    expect(COPY.pick.privacyBody).toMatch(/ไม่มีชื่อ เบอร์โทร หรือรหัสเครื่อง/);
  });

  it("screen เลือกข้อความตาม TRACK_ENABLED (R6 · R1Pick) — ไม่มีข้อความตายตัวที่ไม่ผ่านสวิตช์", () => {
    const r6 = readStripped(join(RING_APP_DIR, "_screens", "R6.tsx"));
    const pick = readStripped(join(RING_APP_DIR, "_screens", "R1Pick.tsx"));
    expect(r6).toMatch(/TRACK_ENABLED \? COPY\.r6\.privacy : COPY\.r6\.privacyOff/);
    expect(pick).toMatch(/TRACK_ENABLED \? COPY\.pick\.privacyBody : COPY\.pick\.privacyBodyOff/);
    // ไม่มีสายต่อท้ายแบบเดิม (privacyTracked) เหลือใน COPY หรือซอร์ส
    expect(Object.keys(COPY.r6)).not.toContain("privacyTracked");
    for (const f of [...APP_SOURCES, ...LIB_SOURCES]) expect(readStripped(f), rel(f)).not.toMatch(/privacyTracked/);
  });

  it("ไม่มีถ้อยคำต้องห้าม/เลขตัวอย่างในข้อความใหม่ (กวาดด้วยกฎเดิม A10/A12)", () => {
    for (const s of [COPY.r6.privacy, COPY.pick.privacyBody, COPY.pick.privacyBodyOff, COPY.r6.privacyOff]) {
      for (const [re, label] of FORBIDDEN) expect(re.test(s), `${label} ใน ${s}`).toBe(false);
      expect(s).not.toMatch(/(?<![\d.])(54|58|57\.5|43|54\.1|37\.7|2569)(?![\d])/);
    }
  });
});
