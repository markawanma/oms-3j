// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CALIBRATION_STORAGE_KEY, LAST_RESULT_STORAGE_KEY, currentFingerprint } from "@/lib/ring-size/calibration";
import { RingSizeClient } from "../RingSizeClient";
import { MOCKUP_NUMBERS, mockRects, resetBrowserState, seedCalibration, seedLastResult, setViewport, setVisualViewport } from "./setup.test-util";

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
const heading = (name: string | RegExp) => screen.getByRole("heading", { level: 1, name });
const counter = (label: string) => screen.getByLabelText(label);
const stored = (key: string) => JSON.parse(window.localStorage.getItem(key) ?? "null");
const hasNoTodoMarkers = () => expect(document.body.textContent).not.toMatch(/\[ต้องยืนยัน|\[รอผ่านด่าน/);

/** เดินจาก R0 → จอเทียบเหรียญ (ผ่าน R1Pick) */
async function toCoinCalibration(u = user()) {
  render(<RingSizeClient />);
  await u.click(btn("เริ่มวัดไซส์"));
  await u.click(btn(/เหรียญ 10 บาท/));
  expect(screen.getByText("ปรับวงแดงจนล้อมขอบเหรียญพอดีรอบวง")).toBeInTheDocument();
  return u;
}

describe("R0 + hydration", () => {
  it("เรนเดอร์ฝั่งเซิร์ฟเวอร์ (ไม่มี effect) ได้ R0 โครงเปล่า แม้ใน storage มีค่า — ไม่มีการ์ดเงื่อนไข (กัน hydration mismatch)", () => {
    seedCalibration();
    seedLastResult();
    const html = renderToString(<RingSizeClient />);
    expect(html).toContain("วัดไซส์แหวนด้วยมือถือ");
    expect(html).toContain("เริ่มวัดไซส์");
    expect(html).not.toContain("ผลล่าสุดของคุณ");
    expect(html).not.toContain("เทียบหน้าจอไว้แล้ว");
    // คำอธิบายเป็นแบบคนใหม่ (ไม่ใช่ "คนกลับมา") จนกว่าจะอ่าน storage เสร็จ
    expect(html).toContain("ไม่ต้องมีอุปกรณ์พิเศษ");
  });

  it("หลังอ่าน storage เสร็จ: คนกลับมาเห็นการ์ดผลล่าสุด + แถบเทียบจอแล้ว · คำอธิบายตัดท่อนท้าย", async () => {
    seedCalibration();
    seedLastResult({ circ: 54 });
    render(<RingSizeClient />);
    expect(await screen.findByText("ผลล่าสุดของคุณ: เบอร์ 54")).toBeInTheDocument();
    expect(screen.getByText("เครื่องนี้เทียบหน้าจอไว้แล้ว ข้ามขั้นที่ 1 ได้")).toBeInTheDocument();
    expect(screen.queryByText(/ไม่ต้องมีอุปกรณ์พิเศษ/)).toBeNull();
    expect(screen.getByText("รู้เบอร์แหวนได้ในไม่กี่นาที ไม่ต้องไปร้าน")).toBeInTheDocument();
  });

  it("ข้อความ R0: ไม่มี 'ใน 1 นาที' · ไม่เปิดกล้อง · เหรียญหรือบัตร · ปุ่มเริ่มอยู่ในแถบ sticky", () => {
    render(<RingSizeClient />);
    expect(document.body.textContent).not.toContain("ใน 1 นาที");
    expect(screen.getByText("รู้เบอร์แหวนได้ในไม่กี่นาที ไม่ต้องไปร้าน ไม่ต้องมีอุปกรณ์พิเศษ")).toBeInTheDocument();
    expect(screen.getByText("เหรียญ 10 บาท หรือบัตร 1 ใบ ไว้เทียบขนาดหน้าจอ")).toBeInTheDocument();
    expect(screen.getByText("ไม่เปิดกล้อง ไม่ถ่ายรูป ไม่ต้องกรอกชื่อหรือเบอร์โทร")).toBeInTheDocument();
    const cta = btn("เริ่มวัดไซส์");
    expect(cta.closest(".sticky")).not.toBeNull();
    expect(cta.className).toContain("min-h-[56px]");
    // ภาพวงแหวนตกแต่งซ่อนเมื่อจอเตี้ย (< 720 px)
    expect(document.querySelector('[class*="max-height:719px"]')).not.toBeNull();
  });
});

describe("คนใหม่ ทางเหรียญ 7 จอ (R0 R1Pick R2Coin R3 R4 R5 R6) + ตัวนับ + ผล", () => {
  it("เดินครบจนได้ผล · ไม่มีจอ R1Coin · ปุ่มปิดจนกว่าจะขยับ · บันทึกค่าเทียบ · ผลล่าสุด", async () => {
    const u = await toCoinCalibration();
    // R1Pick → R2Coin ตรง ไม่มีจอสอนเหรียญ
    expect(screen.queryByRole("heading", { name: /เทียบจอด้วยเหรียญ/ })).toBeNull();
    expect(counter("ขั้นที่ 1 จาก 3")).toHaveTextContent("01 / 03");
    // แถบ "ก่อนเริ่ม" 2 ข้อ + ป้ายข้อความบนเวที (ไม่ใช่ภาพเหรียญ)
    expect(screen.getByText(/① วางมือถือบนโต๊ะเรียบๆ/)).toBeInTheDocument();
    expect(screen.getByText("วางเหรียญตรงกลางวงนี้")).toBeInTheDocument();

    const off = btn("ปรับวงกลมก่อน จึงกดได้");
    expect(off).toBeDisabled();
    await u.click(btn("ขยายวงกลมทีละนิด"));
    const on = btn("วงกลมเท่าเหรียญแล้ว");
    expect(on).toBeEnabled();
    expect(window.localStorage.getItem(CALIBRATION_STORAGE_KEY)).toBeNull(); // ยังไม่บันทึกจนกด
    await u.click(on);

    // R3: ตัวนับ 02/03 + แถบเทียบเรียบร้อย + บันทึกค่าแล้ว
    expect(heading("ขั้นที่ 2 เลือกวิธีวัด")).toBeInTheDocument();
    expect(counter("ขั้นที่ 2 จาก 3")).toHaveTextContent("02 / 03");
    expect(screen.getByText("เทียบหน้าจอเรียบร้อย")).toBeInTheDocument();
    const saved = stored(CALIBRATION_STORAGE_KEY);
    expect(saved).toMatchObject({ ref: "coin", version: 2, portraitWidth: 390 });
    expect(saved.pxPerMm).toBeGreaterThan(6);
    expect(Object.keys(saved).sort()).toEqual(["dpr", "portraitWidth", "pxPerMm", "ref", "savedAt", "screenLong", "screenShort", "version"]);
    // R3 ไม่มี pill ความแม่น/เวลา (มติ Q1)
    expect(document.body.textContent).not.toMatch(/~30 วินาที|±ครึ่ง|คลาดเคลื่อนมากกว่า/);

    await u.click(btn(/วางแหวนวงเดิมบนจอ/));
    expect(heading("วัดด้วยแหวนวงเดิม")).toBeInTheDocument();
    await u.click(btn("พร้อมแล้ว เริ่มวัด"));

    // R5A: ค่าเริ่ม 14.0 · ปุ่มปิด
    expect(btn("ขยับค่าก่อน จึงกดได้")).toBeDisabled();
    expect(screen.getByText(/ผ่านศูนย์กลาง 14\.0 มม\. · เส้นรอบวง 44\.0 มม\. · เบอร์ 44/)).toBeInTheDocument();
    await u.click(btn("เพิ่มขนาดวงกลมทีละนิด"));
    expect(screen.getByText(/ผ่านศูนย์กลาง 14\.1 มม\. · เส้นรอบวง 44\.3 มม\. · เบอร์ 45/)).toBeInTheDocument();
    await u.click(btn("ใช้ค่านี้"));

    // R6 (ระหว่างเบอร์ 44–45 → แนะนำ 45 · อยู่ในช่วงร้าน)
    expect(screen.getByTestId("result-size")).toHaveTextContent("45");
    expect(counter("ขั้นที่ 3 จาก 3")).toHaveTextContent("03 / 03");
    expect(screen.getByText("เส้นรอบวงด้านในประมาณ 44.3 มม.")).toBeInTheDocument();
    expect(screen.getByText("อยู่ระหว่างเบอร์ 44 กับ 45 · แนะนำเบอร์ 45")).toBeInTheDocument();
    expect(screen.getByText("เบอร์ตามตารางของร้าน 3J (เส้นรอบวงด้านใน มม.)")).toBeInTheDocument();
    expect(screen.getByText("อยู่ในช่วงเบอร์ที่ร้านทำ (45–68)")).toBeInTheDocument();
    expect(screen.getByText("วัดด้วยแหวนวงเดิม")).toBeInTheDocument();
    expect(stored(LAST_RESULT_STORAGE_KEY)).toMatchObject({ circ: 44.3, method: "A", ref: "coin", version: 1 });
    hasNoTodoMarkers();
  });

  it("R1Pick: ข้อความตามมติ (ไม่มี 'แม่นที่สุด/ใกล้เคียงกัน/ถามขออนุญาต') · กล่องไม่ใช้กล้อง", async () => {
    const u = user();
    render(<RingSizeClient />);
    await u.click(btn("เริ่มวัดไซส์"));
    expect(heading("ขั้นที่ 1 เทียบขนาดหน้าจอ")).toBeInTheDocument();
    expect(screen.getByText("ไม่ต้องใช้บัตร")).toBeInTheDocument();
    expect(screen.getByText("คว่ำหน้าบัตรได้")).toBeInTheDocument();
    expect(screen.getByText("บัตร ATM หรือบัตรขนาดเท่ากัน")).toBeInTheDocument();
    expect(screen.getByText("หน้านี้ไม่ใช้กล้อง")).toBeInTheDocument();
    expect(screen.getByText(/ไม่ใช้กล้องและไม่ถ่ายรูป ไม่อ่านข้อมูลบัตร/)).toBeInTheDocument();
    expect(screen.getByText("ใช้แค่อย่างใดอย่างหนึ่ง · ผลที่ได้คลาดเคลื่อนได้ราว ±1 เบอร์ ไม่ว่าเลือกแบบไหน")).toBeInTheDocument();
    for (const bad of ["แม่นที่สุด", "ใกล้เคียงกัน", "ถามขออนุญาต", "ไม่บันทึกอะไร", "บัตรสมาชิก", "ใบขับขี่"]) expect(document.body.textContent).not.toContain(bad);
  });
});

describe("โครงจอวัด (ข้อ 3.2.1 · B8 ส่วนที่ทดสอบใน jsdom ได้)", () => {
  it("R2Coin: header + เวทีไม่เลื่อน · เนื้อหาเลื่อนในตัวเอง · ปุ่มหลักอยู่แถบ sticky ล่าง · ความสูงใช้ dvh", async () => {
    await toCoinCalibration();
    const cta = btn("ปรับวงกลมก่อน จึงกดได้");
    expect(cta.closest(".sticky")).not.toBeNull();
    expect(cta.closest(".overflow-y-auto")).toBeNull(); // ปุ่มไม่ถูกเลื่อนหนี
    const slider = screen.getByRole("slider");
    expect(slider.closest(".overflow-y-auto")).not.toBeNull(); // slider อยู่ในส่วนเนื้อหาที่เลื่อนได้
    expect(btn("ย้อนกลับ").closest(".overflow-y-auto")).toBeNull(); // header ไม่เลื่อน
    const root = slider.closest("[class*='h-[100dvh]']") as HTMLElement;
    expect(root).not.toBeNull();
    const stage = document.querySelector('[data-testid="coin-ring"]')!.closest("div[style]") as HTMLElement;
    expect(stage.getAttribute("style")).toMatch(/clamp\(240px,.*100dvh.*540px.*380px\)/); // jsdom อาจย่อ calc() ใน clamp()
  });
});

describe("ทางบัตร 8 จอ + สลับวิธีเทียบ (B14)", () => {
  it("R1Pick → R1 (สอน) → R2 → R3 · R1 ลิงก์ใช้เหรียญ → R2Coin · R2Coin 'ใช้บัตรแทน' → R1", async () => {
    const u = user();
    render(<RingSizeClient />);
    await u.click(btn("เริ่มวัดไซส์"));
    await u.click(btn(/บัตร 1 ใบ/));
    expect(heading("ขั้นที่ 1 เทียบขนาดหน้าจอ")).toBeInTheDocument();
    expect(screen.getByText(/ใช้บัตรขนาดมาตรฐานแบบบัตร ATM · ไม่ใช้บัตรที่งอ ขอบบิ่น หรือเล็กกว่าปกติ/)).toBeInTheDocument();
    // ลิงก์ → เหรียญ
    await u.click(btn("ไม่สะดวกใช้บัตร? ใช้เหรียญ 10 บาทแทน"));
    expect(screen.getByText("ปรับวงแดงจนล้อมขอบเหรียญพอดีรอบวง")).toBeInTheDocument();
    // ลิงก์ → บัตร (R1 สอน)
    await u.click(btn("ใช้บัตรแทน"));
    expect(screen.getByText("เข้าใจแล้ว เริ่มเทียบ")).toBeInTheDocument();
    await u.click(btn("เข้าใจแล้ว เริ่มเทียบ"));
    // R2 บัตร
    expect(screen.getByText("เลื่อนจนเส้นแดงชิดขอบบัตรทั้ง 2 ข้างพอดี")).toBeInTheDocument();
    expect(btn("เลื่อนเส้นก่อน จึงกดได้")).toBeDisabled();
    expect(counter("ขั้นที่ 1 จาก 3")).toBeInTheDocument();
    fireEvent.click(btn("เพิ่มทีละนิด"));
    await u.click(btn("เส้นชิดขอบบัตรแล้ว"));
    expect(heading("ขั้นที่ 2 เลือกวิธีวัด")).toBeInTheDocument();
    expect(stored(CALIBRATION_STORAGE_KEY)).toMatchObject({ ref: "card" });
  });

  it("'เทียบใหม่' ที่ R3 → R1Pick (ให้เลือกเหรียญ/บัตรใหม่)", async () => {
    seedCalibration();
    const u = user();
    render(<RingSizeClient />);
    await u.click(await screen.findByRole("button", { name: "เริ่มวัดไซส์" }));
    await u.click(btn("เทียบใหม่"));
    expect(heading("ขั้นที่ 1 เทียบขนาดหน้าจอ")).toBeInTheDocument();
    expect(btn(/เหรียญ 10 บาท/)).toBeInTheDocument();
    expect(btn(/บัตร 1 ใบ/)).toBeInTheDocument();
  });
});

describe("คนกลับมา (มีค่าเทียบที่ใช้ได้) 5 จอ + ตัวนับ 01/02 → 02/02 (B13)", () => {
  it("R0 → R3 ข้ามขั้น 1 → ... → R6 ตัวนับ 2 ขั้น · 'ดูผลอีกครั้ง' แล้วย้อน → R0", async () => {
    seedCalibration({ ref: "card" });
    const u = user();
    render(<RingSizeClient />);
    await u.click(await screen.findByRole("button", { name: "เริ่มวัดไซส์" }));
    expect(heading("ขั้นที่ 2 เลือกวิธีวัด")).toBeInTheDocument();
    expect(counter("ขั้นที่ 1 จาก 2")).toHaveTextContent("01 / 02");
    await u.click(btn(/พันกระดาษรอบนิ้ว/));
    expect(counter("ขั้นที่ 1 จาก 2")).toBeInTheDocument();
    await u.click(btn("พร้อมแล้ว เริ่มวัด"));
    // R5B: ปุ่มปิดจนกว่าจะขยับ
    expect(btn("ขยับค่าก่อน จึงกดได้")).toBeDisabled();
    fireEvent.click(btn("เพิ่ม 0.5 มม."));
    await u.click(btn("ใช้ค่านี้"));
    expect(counter("ขั้นที่ 2 จาก 2")).toHaveTextContent("02 / 02");
    // 50.5 → ปัด 50.5 → เบอร์ 51 (ceil(50.25)) · ระหว่าง 50–51
    expect(screen.getByTestId("result-size")).toHaveTextContent("51");
    expect(screen.getByText("วัดด้วยกระดาษพันนิ้ว")).toBeInTheDocument();
  });

  it("การ์ดผลล่าสุดที่ R0 → R6 → ปุ่มย้อนกลับไป R0 (ไม่ไปจอวัดที่ไม่มีค่า)", async () => {
    seedCalibration();
    seedLastResult({ circ: 54, method: "A", ref: "coin" });
    const u = user();
    render(<RingSizeClient />);
    await u.click(await screen.findByRole("button", { name: "ดูผลอีกครั้ง" }));
    expect(screen.getByTestId("result-size")).toHaveTextContent("54");
    expect(screen.getByText("เส้นรอบวงด้านในประมาณ 54.0 มม.")).toBeInTheDocument();
    await u.click(btn("ย้อนกลับ"));
    await waitFor(() => expect(heading("วัดไซส์แหวนด้วยมือถือ")).toBeInTheDocument());
  });
});

describe("A4: storage เสีย/ถูกบล็อก (B2)", () => {
  it.each([
    ["ref นอก whitelist", JSON.stringify({ pxPerMm: 6, ref: "ruler", dpr: 1, screenShort: 390, screenLong: 844, portraitWidth: 390, savedAt: 1, version: 2 })],
    ["version ผิด", JSON.stringify({ pxPerMm: 6, ref: "coin", dpr: 1, screenShort: 390, screenLong: 844, portraitWidth: 390, savedAt: 1, version: 3 })],
    ["ค่า v1 เดิม (ก่อนมี portraitWidth) — ถือว่ายังไม่เทียบ ไม่ใช้ค่าที่ไม่รู้ว่าซูม aA ไหม", JSON.stringify({ pxPerMm: 6, ref: "coin", dpr: 1, screenShort: 390, screenLong: 844, savedAt: 1, version: 1 })],
    ["v2 แต่ไม่มี portraitWidth", JSON.stringify({ pxPerMm: 6, ref: "coin", dpr: 1, screenShort: 390, screenLong: 844, savedAt: 1, version: 2 })],
    ["ข้อความธรรมดา", "banana"],
    ["ตัวเลขนอกช่วง", JSON.stringify({ pxPerMm: 99, ref: "coin", dpr: 1, screenShort: 390, screenLong: 844, portraitWidth: 390, savedAt: 1, version: 2 })],
  ])("%s → ทำเหมือนไม่มีค่า ไม่ crash ไปเริ่มที่ R1Pick", async (_l, raw) => {
    window.localStorage.setItem(CALIBRATION_STORAGE_KEY, raw);
    const u = user();
    render(<RingSizeClient />);
    await waitFor(() => expect(screen.queryByText(/เทียบหน้าจอไว้แล้ว/)).toBeNull());
    await u.click(btn("เริ่มวัดไซส์"));
    expect(heading("ขั้นที่ 1 เทียบขนาดหน้าจอ")).toBeInTheDocument();
  });

  it("localStorage throw ทุกครั้ง → ทำจบได้ ได้ผล (แค่ไม่จำ)", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const u = await toCoinCalibration();
    await u.click(btn("ขยายวงกลมทีละนิด"));
    await u.click(btn("วงกลมเท่าเหรียญแล้ว"));
    await u.click(btn(/วางแหวนวงเดิมบนจอ/));
    await u.click(btn("พร้อมแล้ว เริ่มวัด"));
    await u.click(btn("เพิ่มขนาดวงกลมทีละนิด"));
    await u.click(btn("ใช้ค่านี้"));
    expect(screen.getByTestId("result-size")).toBeInTheDocument();
  });
});

describe("G5: ค่าเก่าอาจไม่ตรงเครื่องนี้ (A5)", () => {
  it("DPR เปลี่ยน → ไม่ข้ามไป R3 · ไปจอเทียบของ ref เดิม (ข้าม R1Pick) พร้อมแถบแจ้ง · ปุ่มปิด", async () => {
    seedCalibration({ ref: "coin", dpr: 3, pxPerMm: 6 }); // jsdom dpr = 1 → ไม่ตรง
    const u = user();
    render(<RingSizeClient />);
    await waitFor(() => expect(screen.getByRole("button", { name: "เริ่มวัดไซส์" })).toBeInTheDocument());
    expect(screen.queryByText(/เทียบหน้าจอไว้แล้ว/)).toBeNull(); // ไม่อ้างว่าเทียบไว้แล้วเมื่อค่าไม่ตรง
    await u.click(btn("เริ่มวัดไซส์"));
    expect(screen.queryByRole("heading", { name: "ขั้นที่ 2 เลือกวิธีวัด" })).toBeNull();
    expect(screen.getByText("ปรับวงแดงจนล้อมขอบเหรียญพอดีรอบวง")).toBeInTheDocument();
    expect(screen.getByText("ดูเหมือนหน้าจอหรือการซูมเปลี่ยนไป เช็กค่าอีกครั้ง ใช้เวลา 10 วินาที")).toBeInTheDocument();
    expect(btn("ปรับวงกลมก่อน จึงกดได้")).toBeDisabled(); // ไม่ใช้ค่าเก่าเงียบๆ
    // ค่าเริ่ม = ppm เก่า × (dpr เก่า ÷ dpr ใหม่) = 18 → clamp ที่ 9.0 (ขอบช่วงแถบเลื่อน)
    const r = Number(document.querySelector('[data-testid="coin-ring"]')!.getAttribute("r"));
    expect(r).toBeCloseTo((26 * 9) / 2 + 1, 10);
    expect(btn("เปลี่ยนไปใช้บัตรแทน")).toBeInTheDocument();
  });

  it("ref เดิมเป็นบัตร → ไปจอบัตร (R2) ไม่ใช่เหรียญ", async () => {
    seedCalibration({ ref: "card", dpr: 2, pxPerMm: 6 });
    const u = user();
    render(<RingSizeClient />);
    await waitFor(() => expect(screen.getByRole("button", { name: "เริ่มวัดไซส์" })).toBeInTheDocument());
    await u.click(btn("เริ่มวัดไซส์"));
    expect(screen.getByText("เลื่อนจนเส้นแดงชิดขอบบัตรทั้ง 2 ข้างพอดี")).toBeInTheDocument();
    expect(screen.getByText(/ดูเหมือนหน้าจอหรือการซูมเปลี่ยนไป/)).toBeInTheDocument();
  });

  it("S2 Safari aA page zoom: dpr เท่าเดิมแต่ความกว้างหน้าแนวตั้งเปลี่ยน (390 → 339) → G5 ไม่ใช้ค่าเก่าเงียบๆ", async () => {
    seedCalibration({ ref: "coin", pxPerMm: 6, portraitWidth: 390 }); // เทียบตอนความกว้าง 390 (jsdom dpr = 1 เท่าเดิม)
    setViewport({ innerWidth: 339, innerHeight: 844 }); // 115% → เลย์เอาต์แคบลง
    const u = user();
    render(<RingSizeClient />);
    await waitFor(() => expect(screen.getByRole("button", { name: "เริ่มวัดไซส์" })).toBeInTheDocument());
    expect(screen.queryByText(/เทียบหน้าจอไว้แล้ว/)).toBeNull();
    await u.click(btn("เริ่มวัดไซส์"));
    expect(screen.queryByRole("heading", { name: "ขั้นที่ 2 เลือกวิธีวัด" })).toBeNull();
    expect(screen.getByText("ดูเหมือนหน้าจอหรือการซูมเปลี่ยนไป เช็กค่าอีกครั้ง ใช้เวลา 10 วินาที")).toBeInTheDocument();
    expect(btn("ปรับวงกลมก่อน จึงกดได้")).toBeDisabled();
  });

  it("S2 กลางทาง: ปรับ aA หลังเทียบเสร็จ (resize) ขณะอยู่ที่ R3 → เด้งไปจอเทียบ ไม่ปล่อยวัดด้วยค่าเก่า", async () => {
    seedCalibration({ ref: "coin", pxPerMm: 6, portraitWidth: 390 });
    const u = user();
    render(<RingSizeClient />);
    await u.click(await screen.findByRole("button", { name: "เริ่มวัดไซส์" }));
    expect(heading("ขั้นที่ 2 เลือกวิธีวัด")).toBeInTheDocument();
    setViewport({ innerWidth: 339, innerHeight: 844 });
    fireEvent(window, new Event("resize"));
    await waitFor(() => expect(screen.getByText("ดูเหมือนหน้าจอหรือการซูมเปลี่ยนไป เช็กค่าอีกครั้ง ใช้เวลา 10 วินาที")).toBeInTheDocument());
    expect(screen.getByText("ปรับวงแดงจนล้อมขอบเหรียญพอดีรอบวง")).toBeInTheDocument();
  });

  it("หมุนเป็นแนวนอน (innerWidth > innerHeight) ไม่ทำให้ค่า stale (ไม่เทียบ portraitWidth)", async () => {
    seedCalibration({ ref: "coin", pxPerMm: 6, portraitWidth: 390 });
    setViewport({ innerWidth: 844, innerHeight: 390 });
    const u = user();
    render(<RingSizeClient />);
    await u.click(await screen.findByRole("button", { name: "เริ่มวัดไซส์" }));
    expect(heading("ขั้นที่ 2 เลือกวิธีวัด")).toBeInTheDocument();
  });

  it("หลังเทียบใหม่ → R3 (ค่าใหม่ถูกบันทึกและใช้ได้ ไม่ stale)", async () => {
    seedCalibration({ ref: "coin", dpr: 3 });
    const u = user();
    render(<RingSizeClient />);
    await waitFor(() => expect(screen.getByRole("button", { name: "เริ่มวัดไซส์" })).toBeInTheDocument());
    await u.click(btn("เริ่มวัดไซส์"));
    fireEvent.change(screen.getByRole("slider"), { target: { value: "6" } });
    await u.click(btn("วงกลมเท่าเหรียญแล้ว"));
    expect(heading("ขั้นที่ 2 เลือกวิธีวัด")).toBeInTheDocument();
    expect(stored(CALIBRATION_STORAGE_KEY).dpr).toBe(currentFingerprint().dpr);
  });
});

describe("G1: ซูม (A1)", () => {
  it("scale ≠ 1 → แถบ alert + ปุ่มยืนยันถูกบล็อกพร้อมเหตุผลบนปุ่ม · scale กลับ 1 → ปลดเอง", async () => {
    const listeners: Record<string, Array<() => void>> = {};
    const vv = { scale: 1.6, height: 700, addEventListener: (t: string, f: () => void) => (listeners[t] ??= []).push(f), removeEventListener: () => {} };
    setVisualViewport(vv as unknown as VisualViewport);
    const u = await toCoinCalibration();
    await u.click(btn("ขยายวงกลมทีละนิด")); // แตะแล้ว แต่ยังโดนซูมบล็อก
    expect(screen.getByRole("alert")).toHaveTextContent("หน้านี้ถูกซูมอยู่ ทำให้ขนาดบนจอเพี้ยน");
    const blocked = btn("ย่อหน้ากลับเป็นขนาดปกติก่อน จึงกดได้");
    expect(blocked).toBeDisabled();
    await u.click(blocked);
    expect(screen.getByText("ปรับวงแดงจนล้อมขอบเหรียญพอดีรอบวง")).toBeInTheDocument(); // ยังอยู่จอเดิม
    vv.scale = 1;
    listeners.resize.forEach((f) => f());
    await waitFor(() => expect(btn("วงกลมเท่าเหรียญแล้ว")).toBeEnabled());
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("G3: ค่าเทียบนอก 4.5–7.5 (A2) ทั้ง 2 ref · ไม่บันทึกจนกว่าตัดสิน", () => {
  it("เหรียญ: ปรับ 3.5 → G3 · ไม่บันทึก · 'ปรับอีกครั้ง' ปิด · 'ถูกต้องแล้ว ใช้ค่านี้' บันทึก+ไป R3", async () => {
    const u = await toCoinCalibration();
    fireEvent.change(screen.getByRole("slider", { name: "ปรับขนาดวงกลมเทียบเหรียญ" }), { target: { value: "3.5" } });
    await u.click(btn("วงกลมเท่าเหรียญแล้ว"));
    const dlg = screen.getByRole("alertdialog");
    expect(within(dlg).getByText("ขนาดที่เทียบได้ต่างจากมือถือส่วนใหญ่")).toBeInTheDocument();
    expect(within(dlg).getByText("วางเหรียญนอนราบกลางวง")).toBeInTheDocument();
    expect(window.localStorage.getItem(CALIBRATION_STORAGE_KEY)).toBeNull(); // ยังไม่บันทึก
    await u.click(within(dlg).getByRole("button", { name: "ปรับอีกครั้ง" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(window.localStorage.getItem(CALIBRATION_STORAGE_KEY)).toBeNull(); // ปรับอีกครั้ง = ไม่บันทึก
    await u.click(btn("วงกลมเท่าเหรียญแล้ว"));
    await u.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: /ถูกต้องแล้ว ใช้ค่านี้/ }));
    expect(heading("ขั้นที่ 2 เลือกวิธีวัด")).toBeInTheDocument();
    expect(stored(CALIBRATION_STORAGE_KEY).pxPerMm).toBeCloseTo(3.5, 10);
  });

  it("บัตร: ปรับ 4.0 → G3 พร้อมเช็กลิสต์ของบัตร (ไม่ใช่ของเหรียญ)", async () => {
    const u = user();
    render(<RingSizeClient />);
    await u.click(btn("เริ่มวัดไซส์"));
    await u.click(btn(/บัตร 1 ใบ/));
    await u.click(btn("เข้าใจแล้ว เริ่มเทียบ"));
    fireEvent.change(screen.getByRole("slider", { name: "ปรับความกว้างเส้นเทียบบัตร" }), { target: { value: "4" } });
    await u.click(btn("เส้นชิดขอบบัตรแล้ว"));
    const dlg = screen.getByRole("alertdialog");
    expect(within(dlg).getByText("ใช้บัตรขนาดมาตรฐานแบบบัตร ATM")).toBeInTheDocument();
    expect(within(dlg).queryByText(/เหรียญ/)).toBeNull();
    expect(window.localStorage.getItem(CALIBRATION_STORAGE_KEY)).toBeNull();
  });

  it("ค่าปกติ (6.0) ไม่ขึ้น G3 · ขอบ 4.5 และ 7.5 ผ่านเงียบ", async () => {
    for (const v of ["4.5", "7.5"]) {
      const u = await toCoinCalibration();
      fireEvent.change(screen.getByRole("slider"), { target: { value: v } });
      await u.click(btn("วงกลมเท่าเหรียญแล้ว"));
      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(heading("ขั้นที่ 2 เลือกวิธีวัด")).toBeInTheDocument();
      cleanup();
      resetBrowserState();
    }
  });
});

describe("G4: ค่าวัดนอกช่วง 40–75 (A3) · ปลายทาง 'วัดใหม่' ตาม method", () => {
  it("วิธีแหวน: d=12.0 → เส้นรอบวง 37.7 → G4 ไม่ขึ้นผล ไม่บันทึกผลล่าสุด · 'วัดใหม่' → R5A", async () => {
    seedCalibration();
    const u = user();
    render(<RingSizeClient />);
    await u.click(await screen.findByRole("button", { name: "เริ่มวัดไซส์" }));
    await u.click(btn(/วางแหวนวงเดิมบนจอ/));
    await u.click(btn("พร้อมแล้ว เริ่มวัด"));
    fireEvent.change(screen.getByRole("slider", { name: "ปรับขนาดวงกลมให้เท่ารูแหวน" }), { target: { value: "12" } });
    await u.click(btn("ใช้ค่านี้"));
    expect(screen.getByRole("alert")).toHaveTextContent("ค่านี้อยู่นอกช่วงที่เครื่องมือวัดได้");
    expect(screen.getByText(/ค่าที่วัดได้ \(37\.7 มม\.\) เล็กกว่าช่วงที่เครื่องมือนี้วัดได้ \(40–75 มม\.\)/)).toBeInTheDocument();
    expect(screen.queryByTestId("result-size")).toBeNull();
    expect(screen.getByText("ตอนเทียบจอใช้บัตรขนาดมาตรฐานแบบบัตร ATM หรือเหรียญ 10 บาทหมุนเวียนสองสี")).toBeInTheDocument();
    expect(screen.getByText("วัดที่ขอบด้านในของแหวน")).toBeInTheDocument();
    expect(window.localStorage.getItem(LAST_RESULT_STORAGE_KEY)).toBeNull();
    await u.click(btn("วัดใหม่"));
    await waitFor(() => expect(screen.getByText(/ขยายวงกลมจนไม่เหลือช่องว่าง/)).toBeInTheDocument());
  });

  it("วิธีกระดาษ: ความยาว 0 → G4 (เช็กลิสต์ของกระดาษ · ทิศ เล็ก) · 'วัดใหม่' → R5B · 'เทียบหน้าจอใหม่' → R1Pick", async () => {
    seedCalibration();
    const u = user();
    render(<RingSizeClient />);
    await u.click(await screen.findByRole("button", { name: "เริ่มวัดไซส์" }));
    await u.click(btn(/พันกระดาษรอบนิ้ว/));
    await u.click(btn("พร้อมแล้ว เริ่มวัด"));
    fireEvent.keyDown(screen.getByRole("slider", { name: "ไม้บรรทัด ลากเส้นแดงขึ้นลงได้" }), { key: "Home" });
    await u.click(btn("ใช้ค่านี้"));
    expect(screen.getByText("กระดาษแบนราบ ไม่ยืดหรือม้วน")).toBeInTheDocument();
    expect(screen.getByText(/ค่าที่วัดได้ \(0\.0 มม\.\) เล็กกว่า/)).toBeInTheDocument();
    await u.click(btn("วัดใหม่"));
    await waitFor(() => expect(screen.getByText(/วางปลายกระดาษที่ไม่มีรอยให้ตรงเลข 0/)).toBeInTheDocument());
    // วัดค่าที่ใหญ่เกิน → G4 ทิศ ใหญ่
    fireEvent.keyDown(screen.getByRole("slider", { name: "ไม้บรรทัด ลากเส้นแดงขึ้นลงได้" }), { key: "End" });
    await u.click(btn("ใช้ค่านี้"));
    expect(screen.getByText(/ค่าที่วัดได้ \(80\.0 มม\.\) ใหญ่กว่า/)).toBeInTheDocument();
    await u.click(btn("เทียบหน้าจอใหม่"));
    expect(heading("ขั้นที่ 1 เทียบขนาดหน้าจอ")).toBeInTheDocument();
  });

  it("ขอบช่วง: เส้นรอบวง 40.0 และ 75.0 ขึ้นผล (ไม่ใช่ G4)", async () => {
    seedCalibration();
    const u = user();
    render(<RingSizeClient />);
    await u.click(await screen.findByRole("button", { name: "เริ่มวัดไซส์" }));
    await u.click(btn(/พันกระดาษรอบนิ้ว/));
    await u.click(btn("พร้อมแล้ว เริ่มวัด"));
    const ruler = screen.getByRole("slider", { name: "ไม้บรรทัด ลากเส้นแดงขึ้นลงได้" });
    fireEvent.keyDown(ruler, { key: "Home" });
    for (let i = 0; i < 80; i++) fireEvent.keyDown(ruler, { key: "ArrowDown" }); // 0 → 40.0
    expect(ruler).toHaveAttribute("aria-valuenow", "40");
    await u.click(btn("ใช้ค่านี้"));
    expect(screen.getByTestId("result-size")).toHaveTextContent("40");
    expect(screen.getByText("เบอร์ 40 อยู่นอกช่วงที่ร้านทำ")).toBeInTheDocument(); // ในช่วงวัดได้ แต่ร้านไม่ได้ทำเบอร์นี้
  });

  it("S4 ขอบบน: เส้นรอบวง 75.0 ขึ้นผล (ไม่ใช่ G4) · 75.5 → G4 ทิศ ใหญ่", async () => {
    seedCalibration();
    const u = user();
    render(<RingSizeClient />);
    await u.click(await screen.findByRole("button", { name: "เริ่มวัดไซส์" }));
    await u.click(btn(/พันกระดาษรอบนิ้ว/));
    await u.click(btn("พร้อมแล้ว เริ่มวัด"));
    const ruler = screen.getByRole("slider", { name: "ไม้บรรทัด ลากเส้นแดงขึ้นลงได้" });
    fireEvent.keyDown(ruler, { key: "Home" });
    for (let i = 0; i < 150; i++) fireEvent.keyDown(ruler, { key: "ArrowDown" }); // 0 → 75.0
    expect(ruler).toHaveAttribute("aria-valuenow", "75");
    await u.click(btn("ใช้ค่านี้"));
    expect(screen.queryByText("ค่านี้อยู่นอกช่วงที่เครื่องมือวัดได้")).toBeNull();
    expect(screen.getByTestId("result-size")).toHaveTextContent("75");
    expect(screen.getByText("เส้นรอบวงด้านในประมาณ 75.0 มม.")).toBeInTheDocument();
    expect(stored(LAST_RESULT_STORAGE_KEY)).toMatchObject({ circ: 75, method: "B" });
    // ขยับเกินขอบบนครึ่งมิลลิเมตร → G4
    await u.click(btn("ย้อนกลับ"));
    await waitFor(() => expect(screen.getByRole("slider", { name: "ไม้บรรทัด ลากเส้นแดงขึ้นลงได้" })).toBeInTheDocument());
    fireEvent.keyDown(screen.getByRole("slider", { name: "ไม้บรรทัด ลากเส้นแดงขึ้นลงได้" }), { key: "ArrowDown" });
    await u.click(btn("ใช้ค่านี้"));
    expect(screen.getByRole("alert")).toHaveTextContent("ค่านี้อยู่นอกช่วงที่เครื่องมือวัดได้");
    expect(screen.getByText(/ค่าที่วัดได้ \(75\.5 มม\.\) ใหญ่กว่า/)).toBeInTheDocument();
  });
});

describe("Back ของเครื่อง: ย้อนทีละจอ ไม่ปิดหน้า ค่าไม่หาย (B3)", () => {
  it("R5A ปรับแล้ว → Back → R4A → เดินหน้า → R5A ยังเป็นค่าที่ปรับไว้ (ปุ่มเปิดอยู่)", async () => {
    seedCalibration();
    const u = user();
    render(<RingSizeClient />);
    await u.click(await screen.findByRole("button", { name: "เริ่มวัดไซส์" }));
    await u.click(btn(/วางแหวนวงเดิมบนจอ/));
    await u.click(btn("พร้อมแล้ว เริ่มวัด"));
    await u.click(btn("เพิ่มขนาดวงกลมทีละนิด"));
    await u.click(btn("เพิ่มขนาดวงกลมทีละนิด"));
    expect(screen.getByText(/ผ่านศูนย์กลาง 14\.2 มม\./)).toBeInTheDocument();

    window.history.back();
    await waitFor(() => expect(heading("วัดด้วยแหวนวงเดิม")).toBeInTheDocument());
    await u.click(btn("พร้อมแล้ว เริ่มวัด"));
    expect(screen.getByText(/ผ่านศูนย์กลาง 14\.2 มม\./)).toBeInTheDocument();
    expect(btn("ใช้ค่านี้")).toBeEnabled();
  });

  it("Back ของเครื่องคืน method ด้วย: R6 (แหวน) → ลองวิธีอื่น (กระดาษ) → Back → R6 → ปุ่มย้อนบนจอไป R5A ไม่ใช่ R5B", async () => {
    seedCalibration();
    const u = user();
    render(<RingSizeClient />);
    await u.click(await screen.findByRole("button", { name: "เริ่มวัดไซส์" }));
    await u.click(btn(/วางแหวนวงเดิมบนจอ/));
    await u.click(btn("พร้อมแล้ว เริ่มวัด"));
    await u.click(btn("เพิ่มขนาดวงกลมทีละนิด"));
    await u.click(btn("ใช้ค่านี้"));
    expect(screen.getByText("วัดด้วยแหวนวงเดิม")).toBeInTheDocument();
    await u.click(btn("ลองวิธีอื่น")); // → R4B (method = B)
    expect(heading("วัดด้วยกระดาษพันนิ้ว")).toBeInTheDocument();
    window.history.back(); // Back ของเครื่อง → R6 ของแหวน
    await waitFor(() => expect(screen.getByTestId("result-size")).toBeInTheDocument());
    await u.click(btn("ย้อนกลับ"));
    // ถ้า method ค้างเป็น B จะไปจอไม้บรรทัด · ที่ถูกคือจอวงกลมของวิธีแหวน
    await waitFor(() => expect(screen.getByText(/ขยายวงกลมจนไม่เหลือช่องว่าง/)).toBeInTheDocument());
    expect(screen.queryByText(/วางปลายกระดาษที่ไม่มีรอยให้ตรงเลข 0/)).toBeNull();
  });

  it("ปุ่มย้อนบนจอ ใช้ history เดียวกัน (ไม่สะสม entry): R3 → R4A → ย้อน → R3 → ย้อน → R0", async () => {
    seedCalibration();
    const u = user();
    render(<RingSizeClient />);
    await u.click(await screen.findByRole("button", { name: "เริ่มวัดไซส์" }));
    const idxAtR3 = (window.history.state as { i: number }).i;
    await u.click(btn(/วางแหวนวงเดิมบนจอ/));
    expect(window.history.state).toMatchObject({ rs: "R4A", i: idxAtR3 + 1 });
    await u.click(btn("ย้อนกลับ"));
    await waitFor(() => expect(heading("ขั้นที่ 2 เลือกวิธีวัด")).toBeInTheDocument());
    expect(window.history.state).toMatchObject({ rs: "R3", i: idxAtR3 }); // ย้อนด้วย history.back() ไม่สะสม entry
    await u.click(btn("ย้อนกลับ")); // ข้ามขั้น 1 → กลับหน้าแรก
    await waitFor(() => expect(heading("วัดไซส์แหวนด้วยมือถือ")).toBeInTheDocument());
  });

  it("ทุกจอเป็น 1 history entry: เดิน R0 → R1Pick → R2Coin ทำให้ history.length เพิ่มทีละ 1", async () => {
    render(<RingSizeClient />);
    const idx = () => (window.history.state as { rs: string; i: number }).i;
    const start = idx();
    expect(window.history.state).toMatchObject({ rs: "R0" });
    const u = user();
    await u.click(btn("เริ่มวัดไซส์"));
    expect(window.history.state).toMatchObject({ rs: "R1Pick", i: start + 1 });
    await u.click(btn(/เหรียญ 10 บาท/));
    expect(window.history.state).toMatchObject({ rs: "R2Coin", i: start + 2 });
  });

  it("เปิดจอที่ต้องมีค่าเทียบโดยไม่มีค่า (Back เก่า) → R1Pick พร้อมข้อความ ไม่ crash", async () => {
    seedCalibration({ ref: "coin" });
    const u = user();
    render(<RingSizeClient />);
    await u.click(await screen.findByRole("button", { name: "เริ่มวัดไซส์" })); // R3
    window.localStorage.clear();
    // จำลอง popstate ไปจอวัดหลัง storage หาย: ค่าใน state ยังอยู่ จึงยังวัดต่อได้ (ไม่หลุดกลางทาง)
    await u.click(btn(/วางแหวนวงเดิมบนจอ/));
    expect(screen.getByText("วัดด้วยแหวนวงเดิม")).toBeInTheDocument();
  });
});

describe("R6Out · chip · ช่วงร้าน 45–68 (A14 A15) ผ่าน flow จริง", () => {
  async function measureWithPaper(targetKeyPresses: number) {
    seedCalibration();
    const u = user();
    render(<RingSizeClient />);
    await u.click(await screen.findByRole("button", { name: "เริ่มวัดไซส์" }));
    await u.click(btn(/พันกระดาษรอบนิ้ว/));
    await u.click(btn("พร้อมแล้ว เริ่มวัด"));
    const ruler = screen.getByRole("slider", { name: "ไม้บรรทัด ลากเส้นแดงขึ้นลงได้" });
    // เริ่มที่ 50.0 → ขยับด้วยคีย์บอร์ดทีละ 0.5 มม.
    const key = targetKeyPresses >= 0 ? "ArrowDown" : "ArrowUp";
    for (let i = 0; i < Math.abs(targetKeyPresses); i++) fireEvent.keyDown(ruler, { key });
    await u.click(btn("ใช้ค่านี้"));
    return u;
  }

  it("ความยาว 44.0 (เบอร์ 44) → R6Out: หัว/ปุ่มใหม่ · ไม่มี chip · ไม่มีปุ่มดูแหวนในร้าน · ไม่ยืนยันนโยบายปรับไซส์", async () => {
    await measureWithPaper(-12); // 50 − 6 = 44.0
    expect(screen.getByTestId("result-size")).toHaveTextContent("44");
    expect(screen.getByText("เบอร์ 44 อยู่นอกช่วงที่ร้านทำ")).toBeInTheDocument();
    expect(screen.getByText("ร้านทำเบอร์ 45–68 · ทักแอดมินถามได้ว่ามีแบบปรับไซส์หรือรับทำพิเศษไหม")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ถามแอดมินเรื่องเบอร์ 44 ทาง LINE" })).toBeInTheDocument();
    expect(screen.queryByText(/อยู่ในช่วงเบอร์ที่ร้านทำ/)).toBeNull();
    expect(screen.queryByText("ดูแหวนในร้าน")).toBeNull();
    expect(document.body.textContent).not.toMatch(/รับปรับไซส์ได้|ปรับไซส์ได้ฟรี|มีบริการปรับไซส์/);
  });

  it("ความยาว 45.0 (เบอร์ 45) → chip 'อยู่ในช่วงเบอร์ที่ร้านทำ (45–68)' ไม่ใช่ R6Out", async () => {
    await measureWithPaper(-10);
    expect(screen.getByTestId("result-size")).toHaveTextContent("45");
    expect(screen.getByText("อยู่ในช่วงเบอร์ที่ร้านทำ (45–68)")).toBeInTheDocument();
    expect(screen.queryByText(/อยู่นอกช่วงที่ร้านทำ/)).toBeNull();
    expect(screen.getByRole("button", { name: "สั่ง/ถามแหวนไซส์นี้ทาง LINE" })).toBeInTheDocument();
  });

  it("ความยาว 68.0 → chip · ความยาว 69.0 → R6Out", async () => {
    await measureWithPaper(36); // 50 + 18 = 68.0
    expect(screen.getByTestId("result-size")).toHaveTextContent("68");
    expect(screen.getByText("อยู่ในช่วงเบอร์ที่ร้านทำ (45–68)")).toBeInTheDocument();
    cleanup();
    resetBrowserState();
    await measureWithPaper(38); // 69.0
    expect(screen.getByTestId("result-size")).toHaveTextContent("69");
    expect(screen.getByText("เบอร์ 69 อยู่นอกช่วงที่ร้านทำ")).toBeInTheDocument();
  });

});

describe("A13 + A12: ค่า default production ไม่มี marker/ค่าจาก mockup หลุดใน DOM", () => {
  it("เดินทุกจอ: ไม่มี [ต้องยืนยัน · ไม่มีเคล็ดลับก่อนสั่ง · ไม่มีปุ่มดูแหวนในร้าน · ไม่มีเลขตัวอย่างจาก mockup ในจอที่ยังไม่มีผลวัด", async () => {
    const u = user();
    render(<RingSizeClient />);
    const snap = (label: string) => {
      hasNoTodoMarkers();
      const text = document.body.textContent ?? "";
      expect(text, label).not.toMatch(MOCKUP_NUMBERS);
      expect(text, label).not.toContain("เคล็ดลับก่อนสั่ง");
      expect(text, label).not.toContain("ดูแหวนในร้าน");
      expect(text, label).not.toMatch(/ภาพจำลอง|ครึ่งเบอร์|แม่นยำ|มาตรฐานสากล/);
    };
    snap("R0");
    await u.click(btn("เริ่มวัดไซส์"));
    snap("R1Pick");
    await u.click(btn(/บัตร 1 ใบ/));
    snap("R1");
    await u.click(btn("เข้าใจแล้ว เริ่มเทียบ"));
    snap("R2");
    fireEvent.click(btn("เพิ่มทีละนิด"));
    await u.click(btn("เส้นชิดขอบบัตรแล้ว"));
    snap("R3");
    await u.click(btn(/วางแหวนวงเดิมบนจอ/));
    snap("R4A");
    await u.click(btn("ไม่มีแหวน? ใช้วิธีกระดาษแทน"));
    snap("R4B");
    // R4B: ไม่มีตัวเลขขนาดกระดาษ และไม่มีกล่องข้อนิ้ว
    expect(screen.getByText("ตัดกระดาษเป็นแถบยาวพอพันรอบนิ้วแล้วปลายซ้อนกันได้ (กระดาษบางที่ไม่ยืด เช่น A4)")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/15 ซม|1 ซม|ข้อนิ้ว|ใช้ค่าที่ใหญ่กว่า/);
    expect(screen.getByText(/ตัดส่วนที่เกินรอยดินสอทิ้งก่อนวาง/)).toBeInTheDocument();
    await u.click(btn("พร้อมแล้ว เริ่มวัด"));
    snap("R5B");
    fireEvent.click(btn("เพิ่ม 0.5 มม."));
    await u.click(btn("ใช้ค่านี้"));
    hasNoTodoMarkers(); // R6 มีเลขจริงจากผลวัด จึงไม่ตรวจ MOCKUP_NUMBERS
    expect(document.body.textContent).not.toContain("เคล็ดลับก่อนสั่ง");
    expect(document.body.textContent).not.toContain("ดูแหวนในร้าน");
  });
});

describe("R5B + G2 (B9 B10)", () => {
  it("จอสูงไม่พอ → G2 (role=status) · ขยายกลับ → R5B เดิม ค่าเดิมคงอยู่", async () => {
    seedCalibration({ pxPerMm: 6 });
    const u = user();
    setViewport({ innerHeight: 800 });
    render(<RingSizeClient />);
    await u.click(await screen.findByRole("button", { name: "เริ่มวัดไซส์" }));
    await u.click(btn(/พันกระดาษรอบนิ้ว/));
    await u.click(btn("พร้อมแล้ว เริ่มวัด"));
    fireEvent.click(btn("เพิ่ม 0.5 มม."));
    expect(screen.getByText(/50\.5 มม\./)).toBeInTheDocument();

    // Hruler = 12 + 80 × 6 + 12 = 504 → ต้องการ viewport ≥ 504 + 56
    setViewport({ innerHeight: 540 });
    fireEvent(window, new Event("resize"));
    await waitFor(() => expect(screen.getByText("จอนี้เล็กเกินไปสำหรับขั้นตอนนี้")).toBeInTheDocument());
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ให้แอดมินช่วยวัดทาง LINE" })).toHaveAttribute("href", "https://lin.ee/PzIJl6j");
    expect(screen.getByRole("button", { name: "ใช้วิธีแหวนวงเดิมแทน" })).toBeInTheDocument();

    setViewport({ innerHeight: 800 });
    fireEvent(window, new Event("resize"));
    await waitFor(() => expect(screen.getByText(/วางปลายกระดาษที่ไม่มีรอยให้ตรงเลข 0/)).toBeInTheDocument());
    expect(screen.getByText(/50\.5 มม\./)).toBeInTheDocument(); // ค่าไม่หาย
  });

  it("ขอบ G2 ใช้ความสูงบล็อกบนที่วัดจริง (52 px): viewport 556 = 504 + 52 ยังวัดได้ · 555 → G2", async () => {
    seedCalibration({ pxPerMm: 6 });
    const u = user();
    setViewport({ innerHeight: 556 });
    render(<RingSizeClient />);
    await u.click(await screen.findByRole("button", { name: "เริ่มวัดไซส์" }));
    await u.click(btn(/พันกระดาษรอบนิ้ว/));
    await u.click(btn("พร้อมแล้ว เริ่มวัด"));
    expect(screen.getByText(/วางปลายกระดาษที่ไม่มีรอยให้ตรงเลข 0/)).toBeInTheDocument();
    expect(screen.queryByText("จอนี้เล็กเกินไปสำหรับขั้นตอนนี้")).toBeNull();
    setViewport({ innerHeight: 555 });
    fireEvent(window, new Event("resize"));
    await waitFor(() => expect(screen.getByText("จอนี้เล็กเกินไปสำหรับขั้นตอนนี้")).toBeInTheDocument());
    // G2 ไม่ซ้อน header สองชั้น (บล็อกบนของ R5B ยังอยู่ตัวเดียว)
    expect(screen.getAllByRole("button", { name: "ย้อนกลับ" })).toHaveLength(1);
  });

  it("G2 'ใช้วิธีแหวนวงเดิมแทน' → R4A", async () => {
    seedCalibration({ pxPerMm: 6 });
    const u = user();
    setViewport({ innerHeight: 540 });
    render(<RingSizeClient />);
    await u.click(await screen.findByRole("button", { name: "เริ่มวัดไซส์" }));
    await u.click(btn(/พันกระดาษรอบนิ้ว/));
    await u.click(btn("พร้อมแล้ว เริ่มวัด"));
    await u.click(btn("ใช้วิธีแหวนวงเดิมแทน"));
    expect(heading("วัดด้วยแหวนวงเดิม")).toBeInTheDocument();
  });

  it("R5B: ลาก (pointer) บนไม้บรรทัด → ค่าตามตำแหน่งนิ้ว ปัด 0.5 มม. · ไม่ใช่ NaN", async () => {
    seedCalibration({ pxPerMm: 6 });
    const u = user();
    render(<RingSizeClient />);
    await u.click(await screen.findByRole("button", { name: "เริ่มวัดไซส์" }));
    await u.click(btn(/พันกระดาษรอบนิ้ว/));
    await u.click(btn("พร้อมแล้ว เริ่มวัด"));
    const ruler = screen.getByRole("slider", { name: "ไม้บรรทัด ลากเส้นแดงขึ้นลงได้" });
    expect(ruler.className).toContain("touch-none");
    // y = 12 + mm × 6 → mm 55 = y 342 (rect.top = 0 จาก mock)
    fireEvent.pointerDown(ruler, { clientY: 342, pointerId: 1 });
    expect(ruler).toHaveAttribute("aria-valuenow", "55");
    fireEvent.pointerMove(ruler, { clientY: 345.4, pointerId: 1 });
    expect(Number(ruler.getAttribute("aria-valuenow"))).toBeCloseTo(55.5, 10);
    fireEvent.pointerUp(ruler, { pointerId: 1 });
    fireEvent.pointerMove(ruler, { clientY: 400, pointerId: 1 });
    expect(Number(ruler.getAttribute("aria-valuenow"))).toBeCloseTo(55.5, 10); // ปล่อยแล้วไม่ตามนิ้ว
    fireEvent.pointerDown(ruler, { clientY: 99999, pointerId: 1 }); // เกินปลาย → clamp 80
    expect(ruler).toHaveAttribute("aria-valuenow", "80");
  });
});

describe("R2 บัตร: จอเล็ก (S1) — ลดเว้นขอบเหลือ 8 px · แถบ tooSmall มีปุ่มเหรียญเสมอ", () => {
  async function toCardCalibration(width: number) {
    mockRects(width, 300);
    const u = user();
    render(<RingSizeClient />);
    await u.click(btn("เริ่มวัดไซส์"));
    await u.click(btn(/บัตร 1 ใบ/));
    await u.click(btn("เข้าใจแล้ว เริ่มเทียบ"));
    return u;
  }

  it("S1 iPhone SE/6-8 กว้าง 375 px · ~6.42 px/มม.: ปรับถึงได้ (ไม่ถูก clamp) · ไม่ขึ้น tooSmall · บันทึกค่า 6.42 ได้", async () => {
    const u = await toCardCalibration(375);
    const slider = screen.getByRole("slider", { name: "ปรับความกว้างเส้นเทียบบัตร" });
    // max = (375 − 2×8 − 2×2) ÷ 53.98 = 6.5765… ≥ 6.42
    expect(Number(slider.getAttribute("max"))).toBeCloseTo(6.5765, 4);
    expect(Number(slider.getAttribute("max"))).toBeGreaterThanOrEqual(6.42);
    fireEvent.change(slider, { target: { value: "6.42" } });
    expect(Number(screen.getByRole("slider").getAttribute("max"))).toBeGreaterThanOrEqual(6.42);
    expect(screen.getByRole("slider")).toHaveValue("6.42"); // ไม่ถูกลดลงเพราะเกินจอ
    // เส้นสองข้างอยู่ในจอ: ขอบนอกของเส้น = กลาง ± (53.98 × 6.42 ÷ 2 + 2) = ± 175.3 → 0 < x < 375
    const lines = document.querySelectorAll('[data-testid^="card-line"]');
    const xs = Array.from(lines).map((l) => Number(l.getAttribute("x1")));
    expect(Math.min(...xs) - 1).toBeGreaterThan(0);
    expect(Math.max(...xs) + 1).toBeLessThan(375);
    expect(screen.queryByText(/จอนี้เล็กเกินกว่าจะเทียบด้านนี้/)).toBeNull();
    await u.click(btn("เส้นชิดขอบบัตรแล้ว"));
    expect(heading("ขั้นที่ 2 เลือกวิธีวัด")).toBeInTheDocument();
    expect(stored(CALIBRATION_STORAGE_KEY).pxPerMm).toBeCloseTo(6.42, 10);
  });

  it("กว้าง 320 px (เล็กกว่าบัตรที่ 6.42 px/มม.): ขึ้น tooSmall + ปุ่ม 'ใช้เหรียญ 10 บาทแทน' · กดแล้วไปจอเหรียญ", async () => {
    const u = await toCardCalibration(320);
    // (320 − 20) ÷ 53.98 = 5.5576 < 6.42 → ค่าเริ่ม 6.0 ถูก clamp ลง = ถึงขอบแถบเลื่อนทันที
    expect(await screen.findByText("จอนี้เล็กเกินกว่าจะเทียบด้านนี้ — ให้แอดมินช่วยวัดทาง LINE แทน")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "ปรับไม่ได้? ให้แอดมินช่วยวัดทาง LINE" }).length).toBeGreaterThan(0);
    expect(Number(screen.getByRole("slider").getAttribute("max"))).toBeCloseTo(5.5576, 4);
    const switchBtn = btn("ใช้เหรียญ 10 บาทแทน");
    await u.click(switchBtn);
    expect(screen.getByText("ปรับวงแดงจนล้อมขอบเหรียญพอดีรอบวง")).toBeInTheDocument();
  });

  it("เวทีกว้างพอ → ไม่มีแถบแจ้ง และไม่มีปุ่ม 'ใช้เหรียญ 10 บาทแทน' บนจอบัตร", async () => {
    await toCardCalibration(390);
    expect(screen.queryByText(/จอนี้เล็กเกินกว่าจะเทียบด้านนี้/)).toBeNull();
    expect(screen.queryByRole("button", { name: "ใช้เหรียญ 10 บาทแทน" })).toBeNull();
  });
});

describe("ลิงก์ช่วยเหลือ/ตัวอย่างบนจอเทียบ", () => {
  it("R2Coin: ดูตัวอย่าง (เปิด dialog) · ขอ LINE (ลิงก์ lin.ee ไม่มีข้อความเตรียม) · ใช้บัตรแทน", async () => {
    const u = await toCoinCalibration();
    await u.click(btn("ดูตัวอย่าง พอดี / เล็กไป / ใหญ่ไป"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await u.keyboard("{Escape}");
    const help = screen.getByRole("link", { name: "ปรับไม่ได้? ให้แอดมินช่วยวัดทาง LINE" });
    expect(help).toHaveAttribute("href", "https://lin.ee/PzIJl6j");
    expect(btn("ใช้บัตรแทน")).toBeInTheDocument();
  });
  it("R2 บัตร: คำใบ้ใหม่ + ลิงก์ตัวอย่างและ LINE", async () => {
    const u = user();
    render(<RingSizeClient />);
    await u.click(btn("เริ่มวัดไซส์"));
    await u.click(btn(/บัตร 1 ใบ/));
    await u.click(btn("เข้าใจแล้ว เริ่มเทียบ"));
    expect(screen.getByText("เห็นเส้นแดงหนาเท่ากันทั้ง 2 ข้าง = พอดี · เส้นบางลงหรือถูกบัตรบัง = แคบไป · เห็นช่องว่าง = กว้างไป")).toBeInTheDocument();
    expect(btn("ดูตัวอย่าง พอดี / แคบไป / กว้างไป")).toBeInTheDocument();
  });
});
