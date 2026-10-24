// @vitest-environment jsdom
// QA รอบ M→L (24 ต.ค. 69): เทสต์เติมช่องที่ชุดเดิมของ Luke ยังไม่ครอบ — ไล่ตามเคส A/B ของ ux-ring-size-build.md ข้อ 6
//   A1  ซูม (G1) ต้องบล็อกทั้ง 4 จอวัด — ชุดเดิมครอบเฉพาะ R2Coin
//   A5  G5 กลางเซสชัน (เทียบเสร็จแล้วค่าเปลี่ยน) ต้อง "ปิดปุ่มจนกว่าจะขยับ" เหมือน G5 หลังโหลดหน้าใหม่
//   B1  หมุนจอกลางจอวัด ค่า มม. ไม่หาย
//   B16 ตัวเลขเดียวกันทุกที่ (live · R6 · LINE · ข้อความคัดลอก) ผ่าน flow จริง
//   edge: กดปุ่ม LINE รัวๆ · A7 ราคา/สรรพคุณทั้ง COPY
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CALIBRATION_STORAGE_KEY } from "@/lib/ring-size/calibration";
import { COPY } from "@/lib/ring-size/config";
import { RingSizeClient } from "../RingSizeClient";
import { mockRects, resetBrowserState, seedCalibration, setViewport, setVisualViewport } from "./setup.test-util";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetBrowserState();
});
beforeEach(() => {
  resetBrowserState();
  mockRects(390, 300);
});

const user = () => userEvent.setup();
const btn = (name: string | RegExp) => screen.getByRole("button", { name });
const stored = (key: string) => JSON.parse(window.localStorage.getItem(key) ?? "null");

/** visualViewport จำลองที่เปลี่ยน scale ได้ + ยิง event ได้ */
function fakeVisualViewport(scale: number, height = 800) {
  const listeners: Record<string, Array<() => void>> = {};
  const vv = {
    scale,
    height,
    addEventListener: (t: string, f: () => void) => (listeners[t] ??= []).push(f),
    removeEventListener: (t: string, f: () => void) => {
      listeners[t] = (listeners[t] ?? []).filter((x) => x !== f);
    },
  };
  setVisualViewport(vv as unknown as VisualViewport);
  return { vv, fire: () => Object.values(listeners).forEach((fs) => fs.forEach((f) => f())) };
}

/** R0 → R3 (มีค่าเทียบที่ตรงเครื่อง) → วิธี A → R5A */
async function toR5A(u = user()) {
  seedCalibration({ ref: "coin", pxPerMm: 6 });
  render(<RingSizeClient />);
  await u.click(await screen.findByRole("button", { name: "เริ่มวัดไซส์" }));
  await u.click(btn(/วางแหวนวงเดิมบนจอ/));
  await u.click(btn("พร้อมแล้ว เริ่มวัด"));
  return u;
}

/** R0 → R3 → วิธี B → R5B */
async function toR5B(u = user()) {
  seedCalibration({ ref: "coin", pxPerMm: 6 });
  render(<RingSizeClient />);
  await u.click(await screen.findByRole("button", { name: "เริ่มวัดไซส์" }));
  await u.click(btn(/พันกระดาษรอบนิ้ว/));
  await u.click(btn("พร้อมแล้ว เริ่มวัด"));
  return u;
}

describe("A1: ซูม (scale ≠ 1) บล็อกครบทั้ง 4 จอวัด (R2 · R2Coin · R5A · R5B)", () => {
  it("R2 บัตร: alert + ปุ่มปิดพร้อมเหตุผลบนปุ่ม แม้ขยับเส้นแล้ว · กดแล้วไม่ไป R3", async () => {
    fakeVisualViewport(1.5);
    const u = user();
    render(<RingSizeClient />);
    await u.click(btn("เริ่มวัดไซส์"));
    await u.click(btn(/บัตร 1 ใบ/));
    await u.click(btn("เข้าใจแล้ว เริ่มเทียบ"));
    await u.click(btn("เพิ่มทีละนิด"));
    expect(screen.getByRole("alert")).toHaveTextContent("หน้านี้ถูกซูมอยู่");
    const blocked = btn(COPY.g1.cta);
    expect(blocked).toBeDisabled();
    await u.click(blocked);
    expect(screen.queryByRole("heading", { level: 1, name: "ขั้นที่ 2 เลือกวิธีวัด" })).toBeNull();
    expect(window.localStorage.getItem(CALIBRATION_STORAGE_KEY)).toBeNull(); // ไม่บันทึกค่าที่ซูมอยู่
  });

  it("R5A: ซูม → alert + ปุ่ม 'ใช้ค่านี้' ปิด แม้ขยับวงแล้ว · ไม่เกิดผลลัพธ์ · ปลดซูมแล้วกดได้", async () => {
    const { vv, fire } = fakeVisualViewport(1.5);
    const u = await toR5A();
    await u.click(btn("เพิ่มขนาดวงกลมทีละนิด"));
    expect(screen.getByRole("alert")).toHaveTextContent("หน้านี้ถูกซูมอยู่");
    const blocked = btn(COPY.g1.cta);
    expect(blocked).toBeDisabled();
    await u.click(blocked);
    expect(screen.queryByTestId("result-size")).toBeNull();
    vv.scale = 1;
    fire();
    await waitFor(() => expect(btn("ใช้ค่านี้")).toBeEnabled());
  });

  it("R5B: ซูม → alert + ปุ่ม 'ใช้ค่านี้' ปิด (ไม่ใช่ G2) · ปลดซูมแล้วกดได้", async () => {
    const { vv, fire } = fakeVisualViewport(1.5, 900);
    const u = await toR5B();
    await u.click(btn("เพิ่ม 0.5 มม."));
    expect(screen.getByRole("alert")).toHaveTextContent("หน้านี้ถูกซูมอยู่");
    const blocked = btn(COPY.g1.cta);
    expect(blocked).toBeDisabled();
    vv.scale = 1;
    fire();
    await waitFor(() => expect(btn("ใช้ค่านี้")).toBeEnabled());
  });

  it("ขอบ ±1%: scale 1.005 ไม่ถือว่าซูม · 1.02 ถือว่าซูม (R5A)", async () => {
    const { vv, fire } = fakeVisualViewport(1.005);
    const u = await toR5A();
    await u.click(btn("เพิ่มขนาดวงกลมทีละนิด"));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(btn("ใช้ค่านี้")).toBeEnabled();
    vv.scale = 1.02;
    fire();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});

// 🔴 บั๊กที่ QA เจอ (QA-1): RingSizeClient.tsx `initiallyTouched={draftPpm !== null}` — draft ค้างใน state หลังเทียบเสร็จในเซสชันเดียวกัน
// ทำให้จอเทียบที่ถูกเด้งมาเพราะ G5 เปิดปุ่มยืนยันทันทีด้วยค่าเริ่มที่ "ยังไม่ตรงเครื่อง" (Safari aA: dpr เท่าเดิม → ค่าเริ่ม = ppm เก่าเป๊ะ)
// ผู้ใช้กดยืนยันโดยไม่ขยับ → บันทึกค่าเก่าที่ผิดพร้อม fingerprint ใหม่ (G5 ถูกข้ามเงียบๆ — ขัดเคส A5/B12)
// (เดิมเป็น it.fails ตอน QA เจอบั๊ก — แก้แล้ว เปลี่ยนเป็น it ปกติ: g5Active นับตั้งแต่รอบ render ที่เด้งมาจอเทียบ)
describe("A5: G5 กลางเซสชัน — ปุ่มต้องปิดจนกว่าจะขยับ (ไม่ปล่อยบันทึกค่าเก่าที่ยังไม่ตรวจซ้ำ)", () => {
  it("QA-1 เทียบเหรียญเสร็จ → R3 → Safari aA (ความกว้างแนวตั้ง 390 → 339) → เด้งไปจอเทียบ G5 · ปุ่ม 'วงกลมเท่าเหรียญแล้ว' ต้องยังปิด", async () => {
    const u = user();
    render(<RingSizeClient />);
    await u.click(btn("เริ่มวัดไซส์"));
    await u.click(btn(/เหรียญ 10 บาท/));
    await u.click(btn("ขยายวงกลมทีละนิด")); // ขยับ → เกิด draft ใน state ของหน้า
    await u.click(btn("วงกลมเท่าเหรียญแล้ว"));
    expect(screen.getByRole("heading", { level: 1, name: "ขั้นที่ 2 เลือกวิธีวัด" })).toBeInTheDocument();

    setViewport({ innerWidth: 339, innerHeight: 844 });
    fireEvent(window, new Event("resize"));
    await waitFor(() => expect(screen.getByText(COPY.g5.bar)).toBeInTheDocument());
    // G5: ค่าที่ใช้เริ่มคือค่าเก่า (dpr ไม่เปลี่ยน → ppm เดิม) ซึ่ง "ไม่ตรงเครื่องแล้ว" — ผู้ใช้ต้องขยับเองก่อนยืนยัน
    expect(screen.getByRole("button", { name: /วงกลมเท่าเหรียญแล้ว|ปรับวงกลมก่อน/ })).toBeDisabled();
  });

  it("QA-1 เทียบเสร็จ → R3 → DPR เปลี่ยน (ซูมเบราว์เซอร์) → จอเทียบ G5 ปุ่มต้องยังปิด", async () => {
    const u = user();
    render(<RingSizeClient />);
    await u.click(btn("เริ่มวัดไซส์"));
    await u.click(btn(/เหรียญ 10 บาท/));
    await u.click(btn("ขยายวงกลมทีละนิด"));
    await u.click(btn("วงกลมเท่าเหรียญแล้ว"));
    Object.defineProperty(window, "devicePixelRatio", { value: 1.25, configurable: true });
    try {
      fireEvent(window, new Event("resize"));
      await waitFor(() => expect(screen.getByText(COPY.g5.bar)).toBeInTheDocument());
      expect(screen.getByRole("button", { name: /วงกลมเท่าเหรียญแล้ว|ปรับวงกลมก่อน/ })).toBeDisabled();
    } finally {
      Object.defineProperty(window, "devicePixelRatio", { value: 1, configurable: true });
    }
  });
});

describe("B1: หมุนจอกลางจอวัด — ค่า มม. คงเดิม ไม่ stale", () => {
  it("R5A: ปรับเป็น 17.3 แล้วหมุนเป็นแนวนอน (resize) → ค่ายังเป็น 17.3 · ไม่เด้ง G5 · กด 'ใช้ค่านี้' ได้ผลเดิม", async () => {
    const u = await toR5A();
    fireEvent.change(screen.getByRole("slider"), { target: { value: "17.3" } });
    expect(screen.getByText(/ผ่านศูนย์กลาง 17\.3 มม\. · เส้นรอบวง 54\.3 มม\. · เบอร์ 55/)).toBeInTheDocument();
    setViewport({ innerWidth: 844, innerHeight: 390 });
    fireEvent(window, new Event("resize"));
    expect(screen.queryByText(COPY.g5.bar)).toBeNull();
    expect(screen.getByText(/ผ่านศูนย์กลาง 17\.3 มม\. · เส้นรอบวง 54\.3 มม\. · เบอร์ 55/)).toBeInTheDocument();
    await u.click(btn("ใช้ค่านี้"));
    expect(screen.getByTestId("result-size")).toHaveTextContent("55");
    expect(screen.getByText("เส้นรอบวงด้านในประมาณ 54.3 มม.")).toBeInTheDocument();
  });

  it("เวทีวาดใหม่ตามขนาดที่วัดใหม่หลังหมุน (r ไม่ใช่ค่าเก่า) — เหรียญ ppm 6", async () => {
    seedCalibration({ ref: "coin", pxPerMm: 6 });
    const u = user();
    render(<RingSizeClient />);
    await u.click(await screen.findByRole("button", { name: "เริ่มวัดไซส์" }));
    await u.click(btn(/วางแหวนวงเดิมบนจอ/));
    await u.click(btn("พร้อมแล้ว เริ่มวัด"));
    const svgBefore = document.querySelector('svg[shape-rendering="geometricPrecision"]') as SVGSVGElement;
    expect(svgBefore.getAttribute("viewBox")).toBe("0 0 390 300");
    mockRects(844, 200);
    setViewport({ innerWidth: 844, innerHeight: 390 });
    fireEvent(window, new Event("resize"));
    await waitFor(() => expect((document.querySelector('svg[shape-rendering="geometricPrecision"]') as SVGSVGElement).getAttribute("viewBox")).toBe("0 0 844 200"));
  });
});

describe("B16: ตัวเลขชุดเดียวกันทุกที่ (live · R6 · LINE · ข้อความคัดลอก) ผ่าน flow จริง", () => {
  it("R5A d=17.3 → c=54.3 → เบอร์ 55 (ระหว่าง 54–55): ทุกพื้นผิวตรงกัน", async () => {
    const writes: string[] = [];
    const u = user(); // userEvent.setup() ติดตั้ง clipboard ของตัวเอง → ต้อง stub ทับ "หลัง" setup
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(async (t: string) => void writes.push(t)) }, configurable: true });
    await toR5A(u);
    fireEvent.change(screen.getByRole("slider"), { target: { value: "17.3" } });
    await u.click(btn("ใช้ค่านี้"));
    const body = document.body.textContent ?? "";
    expect(screen.getByTestId("result-size")).toHaveTextContent("55");
    expect(body).toContain("เส้นรอบวงด้านในประมาณ 54.3 มม.");
    expect(body).toContain("อยู่ระหว่างเบอร์ 54 กับ 55 · แนะนำเบอร์ 55");
    // LINE: ปุ่มหลักคัดลอกข้อความ
    await u.click(btn(/สั่ง\/ถามแหวนไซส์นี้ทาง LINE/));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toContain("~54.3 มม.");
    expect(writes[0]).toContain("อยู่ระหว่างเบอร์ 54-55 ระบบแนะนำเบอร์ 55");
    expect(writes[0]).toContain("วิธี: แหวนวงเดิม");
    expect(writes[0]).toContain("เทียบจอด้วย: เหรียญ 10 บาท");
    // ผลล่าสุดที่เก็บ = ค่าหลังปัด 0.1 (ตรงที่แสดง)
    expect(stored("ringSize:lastResult:v1")).toMatchObject({ circ: 54.3, method: "A" });
  });

  it("R5B 54.0 มม. → เบอร์ 54 (ไม่ between) · live ตรงกับ R6 · เส้นรอบวง 1 ทศนิยมแม้เป็นจำนวนเต็ม", async () => {
    const u = await toR5B();
    // เริ่มที่ 50.0 → +0.5 × 8 = 54.0
    for (let i = 0; i < 8; i++) fireEvent.click(btn("เพิ่ม 0.5 มม."));
    expect(document.body.textContent).toContain("54.0 มม.");
    expect(screen.getByText("เบอร์ 54")).toBeInTheDocument();
    await u.click(btn("ใช้ค่านี้"));
    expect(screen.getByTestId("result-size")).toHaveTextContent("54");
    expect(screen.getByText("เส้นรอบวงด้านในประมาณ 54.0 มม.")).toBeInTheDocument();
    expect(screen.queryByText(/อยู่ระหว่างเบอร์/)).toBeNull();
  });
});

describe("edge: เรียกซ้ำ / race", () => {
  it("กดปุ่ม LINE หลักรัวๆ (double-tap) → คัดลอกครั้งเดียว · เปิดแชทครั้งเดียว", async () => {
    // ใช้ LineCta ผ่าน R6 จริง: ฉีด navigate ไม่ได้ จึงนับการเขียนคลิปบอร์ด (busy guard ต้องกันซ้ำ)
    const writeText = vi.fn(() => new Promise<void>((res) => setTimeout(res, 30)));
    const u = user();
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await toR5A(u);
    await u.click(btn("เพิ่มขนาดวงกลมทีละนิด"));
    await u.click(btn("ใช้ค่านี้"));
    const cta = btn(/ทาง LINE/);
    fireEvent.click(cta);
    fireEvent.click(cta);
    fireEvent.click(cta);
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it("ดับเบิลคลิก 'ใช้ค่านี้' ที่ R5A ไม่ทำให้ผลล่าสุดเสียหาย (เก็บค่าเดียว ไม่ throw)", async () => {
    const u = await toR5A();
    await u.click(btn("เพิ่มขนาดวงกลมทีละนิด"));
    const go = btn("ใช้ค่านี้");
    fireEvent.click(go);
    fireEvent.click(go);
    expect(screen.getByTestId("result-size")).toBeInTheDocument();
    expect(stored("ringSize:lastResult:v1")).toMatchObject({ circ: 44.3, method: "A" });
  });
});

describe("A7: ไม่มีราคา / คำอ้างสรรพคุณ ทั้งก้อนข้อความของหน้านี้", () => {
  function allStrings(x: unknown, out: string[] = []): string[] {
    if (typeof x === "string") out.push(x);
    else if (typeof x === "function") {
      // ฟังก์ชันข้อความ: เรียกด้วยค่าตัวแทนเพื่อให้เห็นประโยคจริง
      try {
        const f = x as (...a: unknown[]) => unknown;
        const r = f(55, "54.3", "แหวนวงเดิม", "เหรียญ 10 บาท", 45, "coin");
        if (typeof r === "string") out.push(r);
      } catch {
        /* ฟังก์ชันที่ต้องการ arg ชนิดอื่น — ข้าม */
      }
    } else if (Array.isArray(x)) x.forEach((v) => allStrings(v, out));
    else if (x && typeof x === "object") Object.values(x).forEach((v) => allStrings(v, out));
    return out;
  }
  const texts = allStrings(COPY);

  it("มีข้อความจริงให้ตรวจ (กัน false-pass)", () => {
    expect(texts.length).toBeGreaterThan(150);
  });
  it("ไม่มีสัญลักษณ์/คำราคา (฿ · THB · ราคา · ส่วนลด · โปร · ลดราคา · ฟรี) — 'บาท' ได้เฉพาะ 'เหรียญ 10 บาท'", () => {
    for (const t of texts) {
      expect(t, t).not.toMatch(/฿|THB|ราคา|ส่วนลด|โปรโมชัน|โปร\b|ลดราคา|ฟรี|ถูกกว่า/);
      const stripped = t.replace(/เหรียญ 10 บาท/g, "");
      expect(stripped, t).not.toContain("บาท");
    }
  });
  it("ไม่มีคำอ้างสรรพคุณ/ความเชื่อ/การันตี (เสริมดวง · มงคล · ศักดิ์สิทธิ์ · รักษา · รับประกัน · 100% · การันตี)", () => {
    for (const t of texts) expect(t, t).not.toMatch(/เสริมดวง|มงคล|ศักดิ์สิทธิ์|รักษา|รับประกัน|100\s*%|การันตี|ดวงชะตา|ดวงดี|ดวงตก|โชคลาภ/);
  });
  it("ไม่มี URL/อีเมล/เบอร์โทร/@ ฝังใน COPY (ลิงก์ LINE มาจาก lib/shop/line.ts ที่เดียว) ยกเว้น handle ที่ส่งผ่านจาก import", () => {
    for (const t of texts) {
      expect(t, t).not.toMatch(/https?:\/\//);
      expect(t, t).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
      expect(t, t).not.toMatch(/\b0\d{1,2}[- ]?\d{3}[- ]?\d{4}\b/);
    }
    const withAt = texts.filter((t) => t.includes("@"));
    for (const t of withAt) expect(t).toMatch(/@3jjewelry/);
  });
});

describe("R6 ปุ่มเกมพลอย + ปุ่มรอง: ไม่พาเบอร์/พารามิเตอร์ไปกับ URL", () => {
  it("ทุกลิงก์ <a href> บนหน้าผล ไม่มี query string ที่มีเบอร์/มม. และไม่ชี้โดเมนนอกที่ยืนยัน", async () => {
    const u = await toR5A();
    fireEvent.change(screen.getByRole("slider"), { target: { value: "17.3" } });
    await u.click(btn("ใช้ค่านี้"));
    const hrefs = Array.from(document.querySelectorAll("a[href]")).map((a) => a.getAttribute("href")!);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const h of hrefs) {
      expect(["/gem-quiz", "https://lin.ee/PzIJl6j"], h).toContain(h);
    }
    // within ไว้ให้ lint ไม่บ่น: ตรวจว่าปุ่ม LINE สำรองมีจริง
    expect(within(document.body).getByText("เปิดแชท LINE")).toBeInTheDocument();
  });
});

describe("B3 edge: ปุ่มย้อนบนจอ กดซ้ำเร็วๆ ก่อนที่ popstate จะมา", () => {
  // 🟡 QA-2: goBack() เรียก history.back() ทุกครั้งที่เห็นว่า entry ก่อนหน้าคือปลายทาง — idxRef อัปเดตเฉพาะตอน popstate มาถึง
  // กดซ้ำก่อนหน้านั้น = back() ซ้ำ → ย้อนเกิน R0 ออกจากหน้า (spec B3: "ไม่ปิดหน้า") · แก้แล้วด้วย guard flag "กำลังย้อน" (backPendingRef) จน popstate มา (เดิมเป็น it.fails)
  it("QA-2 กดย้อนที่ R1Pick สองครั้งติดกัน → history.back() ถูกเรียกครั้งเดียว", async () => {
    const u = user();
    render(<RingSizeClient />);
    await u.click(btn("เริ่มวัดไซส์")); // R1Pick = entry ที่ 1
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    const b = screen.getByRole("button", { name: "ย้อนกลับ" });
    fireEvent.click(b);
    fireEvent.click(b);
    expect(back).toHaveBeenCalledTimes(1);
  });
});

describe("ขอบร้าน 45/68 ใน flow จริง (R5B ก้าว 0.5): ระหว่างเบอร์ที่คร่อมขอบ", () => {
  async function measure(keyPresses: number) {
    seedCalibration({ ref: "coin", pxPerMm: 6 });
    const u = user();
    render(<RingSizeClient />);
    await u.click(await screen.findByRole("button", { name: "เริ่มวัดไซส์" }));
    await u.click(btn(/พันกระดาษรอบนิ้ว/));
    await u.click(btn("พร้อมแล้ว เริ่มวัด"));
    const ruler = screen.getByRole("slider", { name: "ไม้บรรทัด ลากเส้นแดงขึ้นลงได้" });
    const key = keyPresses >= 0 ? "ArrowDown" : "ArrowUp";
    for (let i = 0; i < Math.abs(keyPresses); i++) fireEvent.keyDown(ruler, { key });
    await u.click(btn("ใช้ค่านี้"));
  }

  it("44.5 มม. → แนะนำ 45 (ในช่วงร้าน) · แสดงระหว่าง 44–45 · มี chip ช่วงร้าน · ปุ่ม LINE ปกติ", async () => {
    await measure(-11); // 50 − 5.5
    expect(screen.getByTestId("result-size")).toHaveTextContent("45");
    expect(screen.getByText("อยู่ระหว่างเบอร์ 44 กับ 45 · แนะนำเบอร์ 45")).toBeInTheDocument();
    expect(screen.getByText("อยู่ในช่วงเบอร์ที่ร้านทำ (45–68)")).toBeInTheDocument();
    expect(screen.queryByText(/อยู่นอกช่วงที่ร้านทำ/)).toBeNull();
  });

  it("68.5 มม. → แนะนำ 69 (นอกช่วงร้าน) → R6Out · เบอร์ที่แสดงตรงกับหัวกล่อง · ไม่มี chip", async () => {
    await measure(37); // 50 + 18.5
    expect(screen.getByTestId("result-size")).toHaveTextContent("69");
    expect(screen.getByText("เบอร์ 69 อยู่นอกช่วงที่ร้านทำ")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ถามแอดมินเรื่องเบอร์ 69 ทาง LINE" })).toBeInTheDocument();
    expect(screen.queryByText(/อยู่ในช่วงเบอร์ที่ร้านทำ/)).toBeNull();
    expect(screen.queryByText("ดูแหวนในร้าน")).toBeNull();
  });

  it("0.0 มม. (ลากสุดบน) → G4 ไม่ขึ้นเบอร์ 0 / ไม่มี '-0' ในผล · 80.0 มม. (สุดล่าง) → G4 ทิศใหญ่", async () => {
    await measure(-100); // clamp ที่ 0
    expect(screen.queryByTestId("result-size")).toBeNull();
    expect(document.body.textContent).not.toMatch(/-0\b/);
    expect(screen.getByText("ค่านี้อยู่นอกช่วงที่เครื่องมือวัดได้")).toBeInTheDocument();
    cleanup();
    resetBrowserState();
    await measure(100); // clamp ที่ 80
    expect(screen.getByText(/ใหญ่กว่าช่วงที่เครื่องมือนี้วัดได้ \(40–75 มม\.\)/)).toBeInTheDocument();
  });
});

describe("B14: ลิงก์ 'เทียบใหม่' ที่หน้าแรก (คนกลับมา) → R1Pick", () => {
  it("R0 แถบ 'เครื่องนี้เทียบหน้าจอไว้แล้ว' กด 'เทียบใหม่' → R1Pick (ไม่ใช่จอเทียบของ ref เดิม) และย้อนกลับได้ถึง R0", async () => {
    seedCalibration({ ref: "coin", pxPerMm: 6 });
    const u = user();
    render(<RingSizeClient />);
    await u.click(await screen.findByRole("button", { name: "เทียบใหม่" }));
    expect(screen.getByRole("heading", { level: 1, name: "ขั้นที่ 1 เทียบขนาดหน้าจอ" })).toBeInTheDocument();
    expect(screen.getByLabelText("ขั้นที่ 1 จาก 3")).toHaveTextContent("01 / 03"); // กลับเป็นเส้นทางคนใหม่ 3 ขั้น (ไม่ใช่ 01/02)
    await u.click(screen.getByRole("button", { name: "ย้อนกลับ" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "เริ่มวัดไซส์" })).toBeInTheDocument());
  });
});
