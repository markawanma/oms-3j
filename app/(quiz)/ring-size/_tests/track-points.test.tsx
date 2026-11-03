// @vitest-environment jsdom
// track-points.test.tsx — จุดเกาะสถิติใน /ring-size (design-ring-size-analytics §4.3 · §9 เคส 16 17 21 22) แบบ end-to-end:
// เรนเดอร์ RingSizeClient จริง + track.ts จริง แล้วดัก navigator.sendBeacon → อ่าน body ที่ "ขึ้นสาย" จริง (ไม่ mock track)
//
// แผนที่เคส (brief P2) → เทสต์ในไฟล์นี้:
//   A ผลวัดโผล่ที่ finishMeasure จุดเดียว (ไม่โผล่ที่ cta/G4/viewLastResult/stage 6) · B CTA ไม่พกผล · C g4 เฉพาะ G4
//   D ไม่มี src (แม้ URL มี ?src=) · E DNT/GPC ไม่ส่ง · F body มีแต่ field ใน allowlist · G viewLastResult ไม่เพิ่มรอบวัด
//   ต้องไม่พัง: endpoint ล่ม/ไม่มี sendBeacon+fetch/sessionStorage throw/ไม่มี randomUUID → flow ครบ ไม่มี error บนจอ ·
//   กด LINE/แชร์/เกมพลอย → beacon ก่อน navigate · คนกลับมา is_return · กระโดด 1→5 · วัด 3 รอบ → stage 7 สามครั้ง
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { circToRec } from "@/lib/ring-size/size";
import { resetTrackStateForTests } from "@/lib/ring-size/track";
import { RING_SNAPSHOT_KEYS, parseRingTrackBody } from "@/lib/ring-size/track-schema";
import { RingSizeClient } from "../RingSizeClient";
import { LineCta } from "../_components/LineCta";
import { R6 } from "../_screens/R6";
import { mockRects, resetBrowserState, seedCalibration, seedLastResult, setVisualViewport } from "./setup.test-util";

type Body = Record<string, unknown>;

const restorers: Array<() => void> = [];
function setNav(key: string, value: unknown) {
  const had = Object.getOwnPropertyDescriptor(navigator, key);
  Object.defineProperty(navigator, key, { value, configurable: true, writable: true });
  restorers.push(() => {
    if (had) Object.defineProperty(navigator, key, had);
    else delete (navigator as unknown as Body)[key];
  });
}

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(blob);
  });
}

/** ดัก sendBeacon — คืนตัวอ่าน body ทุกก้อนที่ถูกส่ง (เรียงตามเวลา) */
function installBeacon() {
  const log: string[] = []; // ลำดับเหตุการณ์ข้ามระบบ (beacon / navigate) ใช้เช็ค "beacon ก่อน navigate"
  const calls: Array<{ url: string; data: Blob }> = [];
  setNav(
    "sendBeacon",
    vi.fn((url: string, data: Blob) => {
      calls.push({ url, data });
      log.push("beacon");
      return true;
    })
  );
  return {
    log,
    calls,
    sent: async (): Promise<Body[]> => Promise.all(calls.map(async (c) => JSON.parse(await readBlob(c.data)) as Body)),
  };
}

const user = () => userEvent.setup();
const btn = (name: string | RegExp) => screen.getByRole("button", { name });
const RULER = { name: "ไม้บรรทัด ลากเส้นแดงขึ้นลงได้" };

let clock = 0;
beforeEach(() => {
  resetBrowserState();
  mockRects(390, 300);
  resetTrackStateForTests();
  window.sessionStorage.clear();
  // นาฬิกาที่เดินหน้าเสมอ (ครั้งละ 1.5 วิ) — throttle 1 วิของผลวัดไม่บังรอบจริง (ตัว throttle เทสต์ใน lib/ring-size/track.test.ts)
  clock = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => (clock += 1500));
  setNav("sendBeacon", undefined);
  vi.stubGlobal("fetch", undefined);
});
afterEach(() => {
  cleanup();
  while (restorers.length) restorers.pop()!();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetBrowserState();
});

/** ทุก body ต้องผ่านตัวตรวจของ route และมีเฉพาะ key ใน allowlist (F) */
async function expectWireClean(beacon: ReturnType<typeof installBeacon>) {
  const bodies = await beacon.sent();
  for (const body of bodies) {
    expect(parseRingTrackBody(body).ok, JSON.stringify(body)).toBe(true);
    for (const k of Object.keys(body)) expect(["sid", ...RING_SNAPSHOT_KEYS], k).toContain(k);
    expect(JSON.stringify(body)).not.toMatch(/"src"|"source"|"ip"|"ua"|cookie|Mozilla/);
  }
  return bodies;
}

const RESULT_KEYS = ["circ_mm", "size", "between"] as const;
const hasResult = (b: Body) => RESULT_KEYS.some((k) => k in b);

/** ไปจนถึง R5B (กระดาษ) โดยมีค่าเทียบจอเดิม */
async function toPaperMeasure(u = user()) {
  render(<RingSizeClient />);
  await u.click(await screen.findByRole("button", { name: "เริ่มวัดไซส์" }));
  await u.click(btn(/พันกระดาษรอบนิ้ว/));
  await u.click(btn("พร้อมแล้ว เริ่มวัด"));
  return u;
}

describe("stage 0: เปิดหน้า", () => {
  it("คนใหม่: in_app เป็น bucket (ไม่ใช่ UA ดิบ) · is_return=false · ส่งครั้งเดียว", async () => {
    const b = installBeacon();
    render(<RingSizeClient />);
    const bodies = await expectWireClean(b);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ stage: 0, in_app: "browser", is_return: false });
    expect(JSON.stringify(bodies[0])).not.toContain("jsdom");
  });

  it("in_app จาก UA ของ LINE/TikTok/FB/IG (bucket เท่านั้น)", async () => {
    const cases: Array<[string, string]> = [
      ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Line/13.5.0", "line"],
      ["Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 BytedanceWebview/d8a21c6", "tiktok"],
      ["Mozilla/5.0 (iPhone) AppleWebKit/605 [FBAN/FBIOS;FBAV/450.0]", "fb"],
      ["Mozilla/5.0 (iPhone) AppleWebKit/605 Instagram 300.0", "ig"],
    ];
    for (const [ua, expected] of cases) {
      cleanup();
      resetTrackStateForTests();
      const b = installBeacon();
      setNav("userAgent", ua);
      render(<RingSizeClient />);
      const [first] = await expectWireClean(b);
      expect(first, ua).toMatchObject({ stage: 0, in_app: expected });
      expect(JSON.stringify(first)).not.toContain("Mozilla");
    }
  });

  it("คนกลับมา (มีค่าเทียบ หรือมีผลเดิมใน localStorage) → is_return=true", async () => {
    seedCalibration();
    const b = installBeacon();
    render(<RingSizeClient />);
    expect((await b.sent())[0]).toMatchObject({ stage: 0, is_return: true });

    cleanup();
    resetBrowserState();
    resetTrackStateForTests();
    seedLastResult();
    const b2 = installBeacon();
    render(<RingSizeClient />);
    expect((await b2.sent())[0]).toMatchObject({ stage: 0, is_return: true });
  });

  it("D: ไม่อ่าน ?src= จาก URL — แม้ URL มี src/source ก็ไม่มีในสาย", async () => {
    window.history.replaceState(null, "", "/ring-size?src=line&source=tiktok");
    const b = installBeacon();
    render(<RingSizeClient />);
    const bodies = await expectWireClean(b);
    expect(JSON.stringify(bodies)).not.toMatch(/src|source|tiktok/);
    window.history.replaceState(null, "", "/");
  });
});

describe("funnel เต็ม (คนใหม่ · เหรียญ · วิธีแหวน) — ลำดับ stage 0→7 และผลวัดโผล่จุดเดียว", () => {
  it("0 start(1) → R1Pick(2) → เลือกเหรียญ(3) → เทียบเสร็จ(4 +ref) → เลือกวิธี(5 +method) → R5A(6 +method) → ผล(7 +ผล)", async () => {
    const b = installBeacon();
    const u = user();
    render(<RingSizeClient />);
    await u.click(await screen.findByRole("button", { name: "เริ่มวัดไซส์" }));
    await u.click(btn(/เหรียญ 10 บาท/));
    await u.click(btn("ขยายวงกลมทีละนิด"));
    await u.click(btn("วงกลมเท่าเหรียญแล้ว"));
    await u.click(btn(/วางแหวนวงเดิมบนจอ/));
    await u.click(btn("พร้อมแล้ว เริ่มวัด"));
    await u.click(btn("เพิ่มขนาดวงกลมทีละนิด"));
    await u.click(btn("ใช้ค่านี้"));
    expect(screen.getByTestId("result-size")).toHaveTextContent("44");

    const bodies = await expectWireClean(b);
    expect(bodies.map((x) => x.stage)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(bodies[0]).toMatchObject({ in_app: "browser", is_return: false });
    expect(bodies[4]).toMatchObject({ stage: 4, ref: "coin" });
    expect(bodies[4]).not.toHaveProperty("g3");
    expect(bodies[4]).not.toHaveProperty("g5");
    expect(bodies[5]).toMatchObject({ stage: 5, method: "A" });
    expect(bodies[6]).toMatchObject({ stage: 6, method: "A" });
    // วิธีแหวน 44.3 → ใกล้สุด 44 (ไม่มีระหว่างเบอร์ → between=false)
    expect(bodies[7]).toEqual({ sid: bodies[7].sid, stage: 7, method: "A", circ_mm: 44.3, size: 44, between: false });
    // A: ผลวัดโผล่ที่ event เดียวเท่านั้น
    expect(bodies.filter(hasResult)).toHaveLength(1);
    expect(new Set(bodies.map((x) => x.sid)).size).toBe(1);
  });

  it("คนกลับมา: stage กระโดด 1→5 (ข้ามเทียบจอ) และ is_return · ผลวิธีกระดาษพก between", async () => {
    seedCalibration();
    const b = installBeacon();
    const u = await toPaperMeasure();
    // 50 − 2.5 = 47.5 → วิธี B: ceil(47.5−0.25)=48 และห่างเบอร์ใกล้สุด 0.5 > 0.25 → ระหว่างเบอร์ 47 กับ 48
    const ruler = screen.getByRole("slider", RULER);
    for (let i = 0; i < 5; i++) fireEvent.keyDown(ruler, { key: "ArrowUp" });
    await u.click(btn("ใช้ค่านี้"));
    const expected = circToRec(47.5, "B")!;
    expect(expected.between).not.toBeNull();

    const bodies = await expectWireClean(b);
    expect(bodies.map((x) => x.stage)).toEqual([0, 1, 5, 6, 7]);
    expect(bodies[0]).toMatchObject({ is_return: true });
    expect(bodies[2]).toMatchObject({ stage: 5, method: "B" });
    expect(bodies[3]).toMatchObject({ stage: 6, method: "B" });
    expect(bodies[4]).toMatchObject({ stage: 7, method: "B", circ_mm: expected.circ, size: expected.rec, between: true });
    expect(bodies.filter(hasResult)).toHaveLength(1);
  });

  it("เทียบจอด้วยค่านอกช่วงปกติแล้วกดใช้ค่านี้ → stage 4 พก g3 · ค่าเทียบเก่าไม่ตรงเครื่อง (G5) → stage 4 พก g5", async () => {
    // G3
    const b = installBeacon();
    const u = user();
    render(<RingSizeClient />);
    await u.click(await screen.findByRole("button", { name: "เริ่มวัดไซส์" }));
    await u.click(btn(/เหรียญ 10 บาท/));
    fireEvent.change(screen.getByRole("slider", { name: "ปรับขนาดวงกลมเทียบเหรียญ" }), { target: { value: "3.5" } });
    await u.click(btn("วงกลมเท่าเหรียญแล้ว"));
    expect(await b.sent()).toHaveLength(4); // 0 1 2 3 — ยังไม่มี stage 4 จนกว่าผู้ใช้ตัดสินที่ G3
    await u.click(btn("ถูกต้องแล้ว ใช้ค่านี้"));
    const g3 = (await expectWireClean(b)).at(-1)!;
    expect(g3).toMatchObject({ stage: 4, ref: "coin", g3: true });
    expect(g3).not.toHaveProperty("g5");

    // G5
    cleanup();
    resetBrowserState();
    mockRects(390, 300);
    resetTrackStateForTests();
    seedCalibration({ ref: "coin", dpr: 3 });
    const b2 = installBeacon();
    render(<RingSizeClient />);
    await u.click(await screen.findByRole("button", { name: "เริ่มวัดไซส์" }));
    fireEvent.change(screen.getByRole("slider"), { target: { value: "6" } });
    await u.click(btn("วงกลมเท่าเหรียญแล้ว"));
    const bodies = await expectWireClean(b2);
    expect(bodies.map((x) => x.stage)).toEqual([0, 1, 3, 4]);
    expect(bodies[3]).toMatchObject({ stage: 4, ref: "coin", g5: true });
    expect(bodies[3]).not.toHaveProperty("g3");
  });
});

describe("G1 ซูม · C G4", () => {
  it("G1 ที่จอเทียบ → { stage 3, g1 } · ที่จอวัด → { stage 6, method, g1 } · ไม่พกผล", async () => {
    const vv = { scale: 1.6, height: 700, addEventListener: () => {}, removeEventListener: () => {} };
    setVisualViewport(vv as unknown as VisualViewport);
    const b = installBeacon();
    const u = user();
    render(<RingSizeClient />);
    await u.click(await screen.findByRole("button", { name: "เริ่มวัดไซส์" }));
    await u.click(btn(/เหรียญ 10 บาท/));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    let bodies = await expectWireClean(b);
    expect(bodies.some((x) => x.g1 === true && x.stage === 3)).toBe(true);

    cleanup();
    resetBrowserState();
    mockRects(390, 300);
    resetTrackStateForTests();
    setVisualViewport(vv as unknown as VisualViewport);
    seedCalibration();
    const b2 = installBeacon();
    render(<RingSizeClient />);
    await u.click(await screen.findByRole("button", { name: "เริ่มวัดไซส์" }));
    await u.click(btn(/วางแหวนวงเดิมบนจอ/));
    await u.click(btn("พร้อมแล้ว เริ่มวัด"));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    bodies = await expectWireClean(b2);
    const g1 = bodies.filter((x) => x.g1 === true);
    expect(g1).toEqual([{ sid: g1[0].sid, stage: 6, method: "A", g1: true }]);
    expect(bodies.some(hasResult)).toBe(false);
  });

  it("G4 (ค่าวัดผิดปกติ): { stage 7, method, g4 } — ไม่พก circ_mm/size/between · วัดใหม่แล้วได้ผล = event ผลแยกอีกอัน", async () => {
    seedCalibration();
    const b = installBeacon();
    const u = user();
    render(<RingSizeClient />);
    await u.click(await screen.findByRole("button", { name: "เริ่มวัดไซส์" }));
    await u.click(btn(/วางแหวนวงเดิมบนจอ/));
    await u.click(btn("พร้อมแล้ว เริ่มวัด"));
    fireEvent.change(screen.getByRole("slider", { name: "ปรับขนาดวงกลมให้เท่ารูแหวน" }), { target: { value: "12" } });
    await u.click(btn("ใช้ค่านี้"));
    expect(screen.getByRole("alert")).toHaveTextContent("ค่านี้อยู่นอกช่วงที่เครื่องมือวัดได้");

    let bodies = await expectWireClean(b);
    const g4 = bodies.at(-1)!;
    expect(g4).toEqual({ sid: g4.sid, stage: 7, method: "A", g4: true });
    expect(bodies.filter((x) => "g4" in x)).toHaveLength(1);
    expect(bodies.some(hasResult)).toBe(false);

    // วัดใหม่ → ได้ผล: event ผลมาแยก (ไม่มี g4 ปน) · g4 ไม่ไปอยู่ใน event อื่น
    await u.click(btn("วัดใหม่"));
    fireEvent.change(screen.getByRole("slider", { name: "ปรับขนาดวงกลมให้เท่ารูแหวน" }), { target: { value: "14" } }); // ค่าเดิมที่ค้าง (12.0) ยังเป็น G4
    await u.click(btn("ใช้ค่านี้"));
    expect(screen.getByTestId("result-size")).toBeInTheDocument();
    bodies = await expectWireClean(b);
    expect(bodies.filter((x) => "g4" in x)).toHaveLength(1);
    const result = bodies.filter(hasResult);
    expect(result).toHaveLength(1);
    expect(result[0]).not.toHaveProperty("g4");
  });
});

describe("หน้าผล R6: CTA · G viewLastResult", () => {
  async function reachR6() {
    seedCalibration();
    const b = installBeacon();
    const u = await toPaperMeasure();
    fireEvent.keyDown(screen.getByRole("slider", RULER), { key: "ArrowUp" }); // 50 → 49.5 (ผลถึง R6 ปกติ)
    await u.click(btn("ใช้ค่านี้"));
    expect(screen.getByTestId("result-size")).toBeInTheDocument();
    return { b, u };
  }

  /** กันการนำทางจริงของ jsdom (anchor click) — ลงทะเบียนที่ document (React ทำงานก่อนที่ root) */
  function blockNavigation() {
    const h = (e: Event) => e.preventDefault();
    document.addEventListener("click", h);
    restorers.push(() => document.removeEventListener("click", h));
  }

  it("B: แชร์ / เกมพลอย → { stage 7, cta } เท่านั้น ไม่พกผล · ผลวัดยังมีแค่ event เดียว (A)", async () => {
    blockNavigation();
    const { b, u } = await reachR6();
    const before = (await b.sent()).length;
    await u.click(btn("แชร์ / บันทึกผลเป็นรูป"));
    await u.click(screen.getByRole("link", { name: "เล่นเกม: คุณเหมาะกับพลอยอะไร" }));
    const bodies = await expectWireClean(b);
    const cta = bodies.slice(before);
    expect(cta).toEqual([
      { sid: cta[0].sid, stage: 7, cta: "share" },
      { sid: cta[0].sid, stage: 7, cta: "gem_quiz" },
    ]);
    expect(bodies.filter(hasResult)).toHaveLength(1);
  });

  it("ลิงก์เกมพลอยเป็น <a href='/gem-quiz'> ตรงๆ (ไม่ใช่ next/link · ไม่แนบพารามิเตอร์)", async () => {
    blockNavigation();
    await reachR6();
    const link = screen.getByRole("link", { name: "เล่นเกม: คุณเหมาะกับพลอยอะไร" });
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("/gem-quiz");
  });

  it("G: viewLastResult (ดูผลเดิมจากหน้าแรก) ไม่ส่งอะไรเลย (ไม่เพิ่มรอบวัด) · CTA หลังจากนั้นพกแค่ cta", async () => {
    blockNavigation();
    seedCalibration();
    seedLastResult({ circ: 54, method: "A", ref: "coin" });
    const b = installBeacon();
    const u = user();
    render(<RingSizeClient />);
    await u.click(await screen.findByRole("button", { name: "ดูผลอีกครั้ง" }));
    expect(screen.getByTestId("result-size")).toHaveTextContent("54");
    let bodies = await expectWireClean(b);
    expect(bodies.map((x) => x.stage)).toEqual([0]); // มีแต่ตอนเปิดหน้า
    expect(bodies.some(hasResult)).toBe(false);

    await u.click(btn("แชร์ / บันทึกผลเป็นรูป"));
    bodies = await expectWireClean(b);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toEqual({ sid: bodies[1].sid, stage: 7, cta: "share" });
  });

  it("วัด 3 รอบ → stage 7 พกผล 3 ครั้ง (ไม่ถูกกลืน) · วัดใหม่/ลองวิธีเดิมซ้ำ stage 5/6 ไม่ส่งซ้ำ", async () => {
    seedCalibration();
    const b = installBeacon();
    const u = user();
    render(<RingSizeClient />);
    await u.click(await screen.findByRole("button", { name: "เริ่มวัดไซส์" }));
    for (let round = 0; round < 3; round++) {
      if (round > 0) await u.click(btn("วัดใหม่")); // R6 → R3
      await u.click(btn(/พันกระดาษรอบนิ้ว/));
      await u.click(btn("พร้อมแล้ว เริ่มวัด"));
      const ruler = screen.getByRole("slider", RULER);
      for (let i = 0; i <= round; i++) fireEvent.keyDown(ruler, { key: "ArrowDown" });
      await u.click(btn("ใช้ค่านี้"));
      expect(screen.getByTestId("result-size")).toBeInTheDocument();
    }
    const bodies = await expectWireClean(b);
    const results = bodies.filter(hasResult);
    expect(results).toHaveLength(3);
    // ไม้บรรทัดจำค่ารอบก่อน (R5B เริ่มจากค่าที่วัดครั้งก่อน) → ขยับสะสม: 50→50.5 · +1.0→51.5 · +1.5→53
    expect(results.map((x) => x.circ_mm)).toEqual([50.5, 51.5, 53]);
    expect(results.every((x) => x.stage === 7 && x.method === "B")).toBe(true);
    expect(bodies.filter((x) => x.stage === 5)).toHaveLength(1);
    expect(bodies.filter((x) => x.stage === 6)).toHaveLength(1);
  });

  it("ลองวิธีอื่น (B→A): stage 5/6 ตามวิธีใหม่ส่งทุกครั้งที่วิธีเปลี่ยน", async () => {
    blockNavigation();
    const { b, u } = await reachR6();
    await u.click(btn("ลองวิธีอื่น"));
    await u.click(btn("พร้อมแล้ว เริ่มวัด"));
    const bodies = await expectWireClean(b);
    const last = bodies.slice(-1)[0];
    expect(last).toMatchObject({ stage: 6, method: "A" });
    expect(bodies.filter((x) => x.stage === 6).map((x) => x.method)).toEqual(["B", "A"]);
    expect(bodies.filter(hasResult)).toHaveLength(1); // ยังไม่ได้ผลรอบใหม่ = ไม่มีผลเพิ่ม
  });
});

describe("17: ปุ่ม LINE — beacon ถูกเรียกก่อน แล้ว navigate ทันที (ไม่รอ network)", () => {
  const input = { size: circToRec(54, "A")!, method: "A" as const, ref: "coin" as const };

  it("copyThenOpen: คลิก → beacon (cta line) → คัดลอก → navigate · ลำดับ beacon ก่อน navigate เสมอ", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(async () => {}) }, configurable: true });
    const b = installBeacon();
    const navigate = vi.fn(() => void b.log.push("navigate"));
    render(<LineCta input={input} label="สั่ง/ถามแหวนไซส์นี้ทาง LINE" navigate={navigate} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "สั่ง/ถามแหวนไซส์นี้ทาง LINE" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    expect(b.log).toEqual(["beacon", "navigate"]);
    const [body] = await expectWireClean(b);
    expect(body).toEqual({ sid: body.sid, stage: 7, cta: "line" });
  });

  it("beacon ถูกเรียกตอนคลิกทันที — ก่อนที่การคัดลอกจะเสร็จ (copy ค้างอยู่ก็ไม่ทำให้ event หาย)", async () => {
    // userEvent.click ตรงๆ (ไม่ใช่ setup()) — setup() ติดตั้ง clipboard stub ของตัวเองทับ stub นี้
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(() => new Promise<void>(() => {})) }, configurable: true });
    const b = installBeacon();
    const navigate = vi.fn();
    render(<LineCta input={input} label="L" navigate={navigate} />);
    void userEvent.click(screen.getByRole("button", { name: "L" }));
    await waitFor(() => expect(b.calls).toHaveLength(1));
    expect(navigate).not.toHaveBeenCalled(); // copy ยังไม่จบ → ยังไม่ไปไหน แต่ event ถูกส่งแล้ว
  });

  it("endpoint ช้า/ค้าง (beacon ไม่ตอบ) ก็ไม่หน่วง navigate — track ไม่รอผล", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(async () => {}) }, configurable: true });
    setNav("sendBeacon", () => true); // คืนทันที ไม่มีทางรู้ผลอยู่แล้ว
    vi.stubGlobal("fetch", () => new Promise(() => {})); // ไม่ resolve ตลอดกาล
    const navigate = vi.fn();
    render(<LineCta input={input} label="L" navigate={navigate} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "L" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
  });

  it("คัดลอกไม่ได้ → ไม่ navigate (ของเดิม) แต่ยังนับว่ากดปุ่ม LINE", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(async () => Promise.reject(new Error("denied"))) }, configurable: true });
    document.execCommand = vi.fn(() => false);
    const b = installBeacon();
    const navigate = vi.fn();
    render(<LineCta input={input} label="L" navigate={navigate} />);
    // userEvent.click ตรงๆ (ไม่ใช่ setup()) — setup() ติดตั้ง clipboard stub ของตัวเองทับ stub ที่ตั้งไว้
    await userEvent.click(screen.getByRole("button", { name: "L" }));
    expect(await screen.findByText(/คัดลอกอัตโนมัติไม่ได้/)).toBeInTheDocument();
    expect(b.calls).toHaveLength(1); // นับว่ากดปุ่ม LINE แล้ว (ผู้ใช้ตั้งใจจะไป LINE)
    expect(navigate).not.toHaveBeenCalled();
  });

  it("โหมด oaMessage (ลิงก์) และลิงก์สำรอง 'เปิดแชท LINE' ก็ยิง cta line ก่อนเบราว์เซอร์ไปต่อ · กดซ้ำไม่ส่งซ้ำ (dedupe)", async () => {
    const h = (e: Event) => e.preventDefault();
    document.addEventListener("click", h);
    restorers.push(() => document.removeEventListener("click", h));
    const b = installBeacon();
    render(<LineCta input={input} label="L" mode="oaMessage" />);
    const u = userEvent.setup();
    await u.click(screen.getByRole("link", { name: "L" }));
    await u.click(screen.getByRole("link", { name: "เปิดแชท LINE" }));
    await u.click(screen.getByRole("link", { name: "L" }));
    const bodies = await expectWireClean(b);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ stage: 7, cta: "line" });
  });

  it("ปุ่ม 'คัดลอกข้อความ' (ไม่ได้เปิดแชท) ไม่นับเป็นกด LINE", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(async () => {}) }, configurable: true });
    const b = installBeacon();
    render(<LineCta input={input} label="L" />);
    await userEvent.setup().click(screen.getByRole("button", { name: "คัดลอกข้อความ" }));
    expect(b.calls).toHaveLength(0);
  });

  it("R6 render ตรงๆ (ไม่ผ่าน client): ปุ่มแชร์ยิง cta share ครั้งเดียว ไม่พกเบอร์", async () => {
    const b = installBeacon();
    render(<R6 step={null} size={circToRec(54, "A")!} method="A" refKind="coin" measuredAt={1} onBack={() => {}} onRemeasure={() => {}} onOtherMethod={() => {}} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "แชร์ / บันทึกผลเป็นรูป" }));
    const bodies = await expectWireClean(b);
    expect(bodies).toEqual([{ sid: bodies[0].sid, stage: 7, cta: "share" }]);
  });
});

describe("E: DNT / GPC — ทั้ง flow ไม่เรียก beacon/fetch เลย และใช้งานได้ครบ", () => {
  async function runWholeFlow() {
    seedCalibration();
    const beacon = installBeacon();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const u = await toPaperMeasure();
    fireEvent.keyDown(screen.getByRole("slider", RULER), { key: "ArrowUp" });
    await u.click(btn("ใช้ค่านี้"));
    expect(screen.getByTestId("result-size")).toBeInTheDocument();
    await u.click(btn("แชร์ / บันทึกผลเป็นรูป"));
    return { beacon, fetchSpy };
  }

  it("DNT=1", async () => {
    setNav("doNotTrack", "1");
    const { beacon, fetchSpy } = await runWholeFlow();
    expect(beacon.calls).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem("ringSize:sid:v1")).toBeNull();
  });

  it("GPC (navigator.globalPrivacyControl=true)", async () => {
    setNav("globalPrivacyControl", true);
    const { beacon, fetchSpy } = await runWholeFlow();
    expect(beacon.calls).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("16: ช่องส่งล่ม/ไม่มี → flow วัดครบ ไม่มี error บนจอ ไม่มี unhandled rejection", () => {
  async function measureOnce() {
    seedCalibration();
    const u = await toPaperMeasure();
    fireEvent.keyDown(screen.getByRole("slider", RULER), { key: "ArrowUp" });
    await u.click(btn("ใช้ค่านี้"));
    expect(screen.getByTestId("result-size")).toHaveTextContent(String(circToRec(49.5, "B")!.rec));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(document.body.textContent).not.toMatch(/error|Error|ล้มเหลว|ผิดพลาด|TypeError/);
  }

  async function withNoUnhandled(fn: () => Promise<void>) {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      await fn();
      await new Promise((r) => setTimeout(r, 30));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  }

  it("endpoint ล่ม (fetch reject) และ sendBeacon คืน false", () =>
    withNoUnhandled(async () => {
      setNav("sendBeacon", () => false);
      vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
      await measureOnce();
    }));

  it("offline: sendBeacon throw + fetch throw แบบ sync", () =>
    withNoUnhandled(async () => {
      setNav("sendBeacon", () => {
        throw new Error("offline");
      });
      vi.stubGlobal("fetch", () => {
        throw new Error("offline");
      });
      await measureOnce();
    }));

  it("ไม่มีทั้ง sendBeacon และ fetch", () => withNoUnhandled(measureOnce));

  it("sessionStorage throw (โหมด private/ถูกบล็อก) → ยังวัดได้ครบ · beacon ยังไปด้วย sid ในหน่วยความจำ", () =>
    withNoUnhandled(async () => {
      const realGet = Storage.prototype.getItem;
      const realSet = Storage.prototype.setItem;
      // เฉพาะ key ของ sid ที่ throw — localStorage (ค่าเทียบจอ) ต้องใช้ได้ตามปกติ
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, k: string) {
        if (k === "ringSize:sid:v1") throw new DOMException("denied", "SecurityError");
        return realGet.call(this, k);
      });
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k: string, v: string) {
        if (k === "ringSize:sid:v1") throw new DOMException("denied", "SecurityError");
        realSet.call(this, k, v);
      });
      const b = installBeacon();
      await measureOnce();
      const bodies = await b.sent();
      expect(bodies.length).toBeGreaterThan(3);
      expect(new Set(bodies.map((x) => x.sid)).size).toBe(1);
    }));

  it("ไม่มี crypto.randomUUID → ไม่ส่งอะไรเลย · flow วัดครบ", () =>
    withNoUnhandled(async () => {
      vi.stubGlobal("crypto", {});
      const b = installBeacon();
      await measureOnce();
      expect(b.calls).toHaveLength(0);
    }));
});
