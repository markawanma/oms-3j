// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lineOaMessageUrl } from "@/lib/shop/line";
import { buildLineMessage } from "@/lib/ring-size/line-message";
import { circToRec } from "@/lib/ring-size/size";
import { ACCURACY_NOTE } from "@/lib/ring-size/config";
import { LineCta } from "../_components/LineCta";
import { ShareCardSheet } from "../_components/ShareCardSheet";
import RingSizeLayout from "../layout";
import { metadata } from "../page";
import { R6 } from "../_screens/R6";
import { mockRects, resetBrowserState } from "./setup.test-util";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetBrowserState();
});
beforeEach(() => {
  resetBrowserState();
  mockRects(390, 300);
});

const MEASURED_AT = new Date(2026, 9, 24, 12).getTime();

function renderR6(c: number, method: "A" | "B" = "A") {
  const size = circToRec(c)!;
  return render(<R6 step={{ current: 3, total: 3 }} size={size} method={method} refKind="coin" measuredAt={MEASURED_AT} onBack={() => {}} onRemeasure={() => {}} onOtherMethod={() => {}} />);
}

describe("R6 / R6Between / R6Out — ช่วงร้านตัดสินด้วยเบอร์หลังปัด (A14 A15)", () => {
  it.each([
    [45, true],
    [68, true],
    [44, false],
    [69, false],
  ])("c=%s → chip %s", (c, inRange) => {
    renderR6(c);
    expect(screen.getByTestId("result-size")).toHaveTextContent(String(c));
    if (inRange) {
      expect(screen.getByText("อยู่ในช่วงเบอร์ที่ร้านทำ (45–68)")).toBeInTheDocument();
      expect(screen.queryByText(/อยู่นอกช่วงที่ร้านทำ/)).toBeNull();
    } else {
      expect(screen.getByText(`เบอร์ ${c} อยู่นอกช่วงที่ร้านทำ`)).toBeInTheDocument();
      expect(screen.queryByText(/อยู่ในช่วงเบอร์ที่ร้านทำ/)).toBeNull();
    }
  });

  it("ใช้เบอร์หลังปัด ceil(c−0.25): 44.2 → 44 นอกช่วง · 44.3 → 45 ในช่วง", () => {
    renderR6(44.2);
    expect(screen.getByTestId("result-size")).toHaveTextContent("44");
    expect(screen.getByText("เบอร์ 44 อยู่นอกช่วงที่ร้านทำ")).toBeInTheDocument();
    cleanup();
    renderR6(44.3);
    expect(screen.getByTestId("result-size")).toHaveTextContent("45");
    expect(screen.getByText("อยู่ในช่วงเบอร์ที่ร้านทำ (45–68)")).toBeInTheDocument();
  });

  it("chip เป็นสีกลาง (chip-bg/text-3) ไม่ใช่สีเขียว success", () => {
    renderR6(60);
    const chip = screen.getByText("อยู่ในช่วงเบอร์ที่ร้านทำ (45–68)");
    expect(chip.className).toContain("--rs-chip-bg");
    expect(chip.className).toContain("--rs-text-3");
    expect(chip.className).not.toContain("--rs-success");
  });

  it("R6 ปกติ: เบอร์ใหญ่ serif 600 (ไม่ใช่ 700) · บรรทัด 'ตามตารางร้าน 3J' · เส้นรอบวง 1 ทศนิยม · ความแม่นชุดเดียว", () => {
    renderR6(54);
    const num = screen.getByTestId("result-size");
    expect(num.className).toContain("text-[104px]");
    expect(num.className).toContain("font-semibold");
    expect(num.className).not.toMatch(/font-bold/);
    expect(screen.getByText("เส้นรอบวงด้านในประมาณ 54.0 มม.")).toBeInTheDocument();
    expect(screen.getByText("เบอร์ตามตารางของร้าน 3J (เส้นรอบวงด้านใน มม.)")).toBeInTheDocument();
    expect(screen.getByText(ACCURACY_NOTE)).toBeInTheDocument();
    expect(screen.getByText("วัดด้วยแหวนวงเดิม")).toBeInTheDocument();
    expect(screen.queryByText(/อยู่ระหว่างเบอร์/)).toBeNull();
    // ส่วนตัว: ข้อความใหม่ ไม่มี tracking
    expect(screen.getByText("เบอร์ของคุณเก็บไว้ในเครื่องนี้ ร้านไม่ได้รับชื่อหรือข้อมูลส่วนตัวของคุณ จนกว่าคุณจะกดส่งทาง LINE เอง")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("นับสถิติ");
  });

  it("R6Between: เล็กกว่า/ใหญ่กว่า (แนะนำ) · ไม่มีเหตุผล 'ถอดง่ายกว่า/สวมสบายกว่า' (ยังไม่ยืนยัน)", () => {
    renderR6(54.4, "B");
    expect(screen.getByText("เบอร์แหวนที่แนะนำ")).toBeInTheDocument();
    expect(screen.getByText("อยู่ระหว่างเบอร์ 54 กับ 55 · แนะนำเบอร์ 55")).toBeInTheDocument();
    expect(screen.getByText("เล็กกว่า")).toBeInTheDocument();
    expect(screen.getByText("ใหญ่กว่า (แนะนำ)")).toBeInTheDocument();
    expect(screen.getByText(/ถ้าค่าอยู่ระหว่างเบอร์ เราแนะนำเบอร์ที่ใหญ่กว่า/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/ถอดง่าย|สวมสบาย|เพราะ/);
    expect(screen.getByText("วัดด้วยกระดาษพันนิ้ว")).toBeInTheDocument();
  });

  it("ปุ่ม LINE หลัก: R6Between ติดขอบล่าง (sticky) · R6 ปกติ/R6Out อยู่ในกระแส ไม่ sticky (ข้อ 3.2.4)", () => {
    renderR6(54.4);
    expect(screen.getByRole("button", { name: "สั่ง/ถามแหวนไซส์นี้ทาง LINE" }).closest(".sticky")).not.toBeNull();
    cleanup();
    renderR6(54);
    expect(screen.getByRole("button", { name: "สั่ง/ถามแหวนไซส์นี้ทาง LINE" }).closest(".sticky")).toBeNull();
    cleanup();
    renderR6(42);
    expect(screen.getByRole("button", { name: "ถามแอดมินเรื่องเบอร์ 42 ทาง LINE" }).closest(".sticky")).toBeNull();
  });

  it("R6Out: หัวกล่อง/เนื้อ/ปุ่มตาม spec · ไม่มีปุ่มดูแหวนในร้าน · ไม่มีคำสัญญาปรับไซส์", () => {
    renderR6(42);
    expect(screen.getByText("เบอร์ 42 อยู่นอกช่วงที่ร้านทำ")).toBeInTheDocument();
    expect(screen.getByText("ร้านทำเบอร์ 45–68 · ทักแอดมินถามได้ว่ามีแบบปรับไซส์หรือรับทำพิเศษไหม")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ถามแอดมินเรื่องเบอร์ 42 ทาง LINE" })).toBeInTheDocument();
    expect(screen.queryByText("สั่ง/ถามแหวนไซส์นี้ทาง LINE")).toBeNull();
    expect(screen.queryByText("ดูแหวนในร้าน")).toBeNull();
  });

  it("ปุ่มรอง: แชร์ · เกมพลอย (/gem-quiz ตรงๆ ไม่แนบเบอร์) · วัดใหม่ · ลองวิธีอื่น · ไม่มีเคล็ดลับก่อนสั่ง", () => {
    renderR6(54);
    expect(screen.getByRole("button", { name: "แชร์ / บันทึกผลเป็นรูป" })).toBeInTheDocument();
    const gem = screen.getByRole("link", { name: "เล่นเกม: คุณเหมาะกับพลอยอะไร" });
    expect(gem.getAttribute("href")).toBe("/gem-quiz"); // ไม่มี ?src= ไม่มีเบอร์ใน URL
    expect(screen.getByRole("button", { name: "วัดใหม่" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ลองวิธีอื่น" })).toBeInTheDocument();
    expect(screen.queryByText("เคล็ดลับก่อนสั่ง")).toBeNull();
  });

  it("ไม่มีราคา/สรรพคุณ/ชื่อธุรกิจในเครือบนหน้าผล (A7)", () => {
    renderR6(54);
    expect(document.body.textContent).not.toMatch(/฿|ราคา|ลดราคา|โปร|รักษา|โชคดี|เสริมดวง|ส่วนลด|เงินแท่ง|OEM/);
  });
});

describe("LineCta — ปุ่ม LINE หลัก + ทางสำรอง", () => {
  const input = { size: circToRec(54)!, method: "A" as const, ref: "coin" as const };
  const message = buildLineMessage(input);

  function stubClipboard(impl: (t: string) => Promise<void>) {
    const writeText = vi.fn(impl);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    return writeText;
  }

  it("copyThenOpen: คัดลอกข้อความที่เตรียมไว้ แล้วเปิดแชท (lin.ee ที่เจ้าของให้)", async () => {
    const writeText = stubClipboard(async () => {});
    const navigate = vi.fn();
    render(<LineCta input={input} label="สั่ง/ถามแหวนไซส์นี้ทาง LINE" mode="copyThenOpen" navigate={navigate} />);
    expect(screen.getByText("ระบบจะคัดลอกข้อความที่มีเบอร์ของคุณ แล้วเปิดแชท วางแล้วกดส่งได้เลย")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "สั่ง/ถามแหวนไซส์นี้ทาง LINE" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("https://lin.ee/PzIJl6j"));
    expect(writeText).toHaveBeenCalledWith(message);
    expect(screen.getByText("คัดลอกแล้ว วางในแชทได้เลย")).toBeInTheDocument();
  });

  it("copyThenOpen: คัดลอกไม่ได้ทุกทาง → ไม่เปิดต่อ · แสดงกล่องข้อความให้คัดลอกเอง (ไม่จบที่ปุ่มเงียบ)", async () => {
    stubClipboard(async () => {
      throw new Error("denied");
    });
    document.execCommand = vi.fn(() => false);
    const navigate = vi.fn();
    render(<LineCta input={input} label="สั่ง/ถามแหวนไซส์นี้ทาง LINE" mode="copyThenOpen" navigate={navigate} />);
    await userEvent.click(screen.getByRole("button", { name: "สั่ง/ถามแหวนไซส์นี้ทาง LINE" }));
    expect(await screen.findByText(/คัดลอกอัตโนมัติไม่ได้ กดค้างที่ข้อความด้านล่าง/)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "คัดลอกข้อความ" })).toHaveValue(message);
    expect(navigate).not.toHaveBeenCalled();
    // ทางสำรอง "เปิดแชท LINE" ยังใช้ได้เสมอ
    expect(screen.getByRole("link", { name: "เปิดแชท LINE" })).toHaveAttribute("href", "https://lin.ee/PzIJl6j");
  });

  it("ไม่มี navigator.clipboard (webview) → ใช้ execCommand สำรอง", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    document.execCommand = vi.fn(() => true);
    const navigate = vi.fn();
    render(<LineCta input={input} label="x" mode="copyThenOpen" navigate={navigate} />);
    await userEvent.click(screen.getByRole("button", { name: "x" }));
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(document.execCommand).toHaveBeenCalledWith("copy");
  });

  it("oaMessage: ปุ่มหลักเป็นลิงก์ปกติหน้าเดิม (ไม่ใช้ window.open) พร้อมข้อความ encode", () => {
    render(<LineCta input={input} label="สั่ง/ถามแหวนไซส์นี้ทาง LINE" mode="oaMessage" />);
    const a = screen.getByRole("link", { name: "สั่ง/ถามแหวนไซส์นี้ทาง LINE" });
    expect(a).toHaveAttribute("href", lineOaMessageUrl(message));
    expect(a.getAttribute("target")).toBeNull();
    expect(screen.getByText("ข้อความที่มีเบอร์ของคุณจะถูกเตรียมไว้ในแชท แค่กดส่ง")).toBeInTheDocument();
  });

  it("แถว 'ส่งไม่ได้?' ทั้งสองโหมด: คัดลอกข้อความ → 'คัดลอกแล้ว วางในแชทได้เลย' · เปิดแชท LINE", async () => {
    const writeText = stubClipboard(async () => {});
    render(<LineCta input={input} label="x" mode="oaMessage" />);
    expect(screen.getByText("ส่งไม่ได้?")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "คัดลอกข้อความ" }));
    expect(writeText).toHaveBeenCalledWith(message);
    expect(await screen.findByText("คัดลอกแล้ว วางในแชทได้เลย")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "เปิดแชท LINE" })).toHaveAttribute("href", "https://lin.ee/PzIJl6j");
  });

  it("ข้อความที่คัดลอกมีเฉพาะ เบอร์ · มม. · วิธี · เทียบจอด้วย (A6)", () => {
    expect(message).toBe("สวัสดี ฉันวัดไซส์แหวนได้เบอร์ 54 (เส้นรอบวงด้านใน ~54.0 มม. · วิธี: แหวนวงเดิม · เทียบจอด้วย: เหรียญ 10 บาท) ช่วยแนะนำแหวนไซส์นี้ให้หน่อย");
  });
});

describe("ShareCardSheet — R7 (B19 B20)", () => {
  const data = { rec: 45, circ: 44.3, measuredAt: MEASURED_AT };

  function fakeCanvas(opts: { ctx: boolean }) {
    const ctx = {
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 0,
      font: "",
      textAlign: "",
      textBaseline: "",
      fillRect() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      arcTo() {},
      arc() {},
      closePath() {},
      stroke() {},
      fill() {},
      fillText() {},
      measureText: (t: string) => ({ width: t.length * 10 }),
      drawImage() {},
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => (opts.ctx ? ctx : null)) as never);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,iVBORw0KGgo=");
    // jsdom ไม่โหลดรูป — ให้โลโก้ล้มทันที (การ์ดต้องทำได้แม้ไม่มีโลโก้)
    class FailImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 0;
      naturalHeight = 0;
      set src(_v: string) {
        setTimeout(() => this.onerror?.(), 0);
      }
    }
    vi.stubGlobal("Image", FailImage);
  }

  it("โหลด → แสดง <img> data URL (ไม่ใช่ blob:) พร้อมคำสั่งกดค้าง · มี fallback คัดลอกข้อความเสมอ", async () => {
    fakeCanvas({ ctx: true });
    render(<ShareCardSheet data={data} onClose={() => {}} />);
    expect(screen.getByText("กำลังทำรูป…")).toBeInTheDocument();
    const img = await screen.findByRole("img", { name: "การ์ดไซส์แหวนของฉัน" });
    expect(img.getAttribute("src")).toMatch(/^data:image\/png;base64,/);
    expect(img.getAttribute("src")).not.toMatch(/^blob:/);
    expect(screen.getByText("กดค้างที่รูปเพื่อบันทึก แล้วส่งให้คนที่จะซื้อให้ได้เลย")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "คัดลอกข้อความ" })).toBeInTheDocument();
    expect(screen.queryByText("กำลังทำรูป…")).toBeNull();
    // ไม่มีปุ่มแชร์ของระบบเมื่อ navigator.share ไม่มี (webview)
    expect(screen.queryByRole("button", { name: "แชร์รูปนี้" })).toBeNull();
  });

  it("canvas ใช้ไม่ได้ → ข้อความผิดพลาด + ลองใหม่ + คัดลอกข้อความ (ไม่ throw)", async () => {
    fakeCanvas({ ctx: false });
    render(<ShareCardSheet data={data} onClose={() => {}} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("ทำรูปไม่สำเร็จ ลองใหม่อีกครั้ง หรือคัดลอกเป็นข้อความแทน");
    expect(screen.getByRole("button", { name: "ลองใหม่" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "คัดลอกข้อความ" })).toBeInTheDocument();
  });

  it("ลองใหม่ → สร้างอีกครั้งได้ (หลังแก้ canvas)", async () => {
    fakeCanvas({ ctx: false });
    render(<ShareCardSheet data={data} onClose={() => {}} />);
    await screen.findByRole("alert");
    vi.restoreAllMocks();
    fakeCanvas({ ctx: true });
    await userEvent.click(screen.getByRole("button", { name: "ลองใหม่" }));
    expect(await screen.findByRole("img", { name: "การ์ดไซส์แหวนของฉัน" })).toBeInTheDocument();
  });

  it("คัดลอกข้อความ (spec 2.1): เบอร์ + ตามตารางร้าน 3J + มม. 1 ทศนิยม + ±1 เบอร์ · คัดลอกไม่ได้ = กล่องให้คัดลอกเอง", async () => {
    fakeCanvas({ ctx: false });
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<ShareCardSheet data={data} onClose={() => {}} />);
    await screen.findByRole("alert");
    await userEvent.click(screen.getByRole("button", { name: "คัดลอกข้อความ" }));
    const expected = "ไซส์แหวนของฉัน เบอร์ 45 ตามตารางของร้าน 3J (เส้นรอบวงด้านในประมาณ 44.3 มม. คลาดเคลื่อนได้ราว ±1 เบอร์) วัดจากเครื่องมือของ 3J Jewelry";
    expect(writeText).toHaveBeenCalledWith(expected);
    expect(await screen.findByText("คัดลอกแล้ว วางในแชทได้เลย")).toBeInTheDocument();

    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    document.execCommand = vi.fn(() => false);
    await userEvent.click(screen.getByRole("button", { name: "คัดลอกข้อความ" }));
    expect(await screen.findByRole("textbox")).toHaveValue(expected);
  });

  it("เครื่องแชร์ไฟล์ได้ → มีปุ่ม 'แชร์รูปนี้' และเรียก navigator.share พร้อมไฟล์ png", async () => {
    fakeCanvas({ ctx: true });
    const share = vi.fn(async () => {});
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    Object.defineProperty(navigator, "canShare", { value: () => true, configurable: true });
    render(<ShareCardSheet data={data} onClose={() => {}} />);
    const b = await screen.findByRole("button", { name: "แชร์รูปนี้" });
    await userEvent.click(b);
    expect(share).toHaveBeenCalledTimes(1);
    const arg = share.mock.calls[0] as unknown as [ShareData];
    expect(arg[0].files?.[0].type).toBe("image/png");
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    Object.defineProperty(navigator, "canShare", { value: undefined, configurable: true });
  });

  it("dialog: โฟกัสไปหัวข้อ · Esc ปิด · aria-modal", async () => {
    fakeCanvas({ ctx: true });
    const onClose = vi.fn();
    render(<ShareCardSheet data={data} onClose={onClose} />);
    const dlg = screen.getByRole("dialog", { name: "แชร์ / บันทึกผลเป็นรูป" });
    expect(dlg).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("heading", { name: "แชร์ / บันทึกผลเป็นรูป" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});

// ───────────────────────── layout / metadata / contrast ─────────────────────────

function luminance(hex: string): number {
  const n = parseInt(hex.replace("#", ""), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("layout (ข้อ 3.2.1 · 7.3)", () => {
  function tokens() {
    const { container } = render(
      <RingSizeLayout>
        <span>child</span>
      </RingSizeLayout>
    );
    const root = container.firstElementChild as HTMLElement;
    const t = (name: string) => root.style.getPropertyValue(name).trim();
    return { root, t };
  }

  it("wrapper fixed inset-0 สูง 100dvh เลื่อนเอง ไม่ใช้ 100vh · พื้น --rs-bg · color-scheme light · ฟอนต์ของ layout แม่", () => {
    const { root } = tokens();
    expect(root.className).toContain("fixed");
    expect(root.className).toContain("inset-0");
    expect(root.className).toContain("h-[100dvh]");
    expect(root.className).toContain("overflow-y-auto");
    expect(root.className).toContain("overscroll-contain");
    expect(root.className).toContain("font-quiz-sans");
    expect(root.className).toContain("bg-[var(--rs-bg)]");
    expect(root.className).not.toMatch(/100vh|min-h-screen|h-screen/);
    expect(root.style.colorScheme).toBe("light");
    expect(document.querySelector("link")).toBeNull();
    expect(screen.getByText("child")).toBeInTheDocument();
  });

  it("token --rs-* ครบและผูกกับแบรนด์เดิม (ไม่ re-palette)", () => {
    const { t } = tokens();
    expect(t("--rs-brand")).toBe("var(--gq-burgundy)");
    expect(t("--rs-brand-hover")).toBe("#7d1316");
    expect(t("--rs-bg")).toBe("#FBF7F2");
    expect(t("--rs-disabled-bg")).toBe("#E5D9D3");
    expect(t("--rs-disabled-text")).toBe("#675A56");
    expect(t("--rs-chip-bg")).toBe("#F4EEE8");
    for (const n of ["--rs-surface", "--rs-text", "--rs-text-2", "--rs-text-3", "--rs-border", "--rs-gold", "--rs-blush", "--rs-success", "--rs-warn"]) {
      expect(t(n), n).not.toBe("");
    }
  });

  it("B12/B17: contrast ตามตาราง 7.3 ผ่าน (ปุ่มปิดใช้งาน ≥ 4.5 · ตัวหลัก/รอง/กฎตัดสินใจ · ปุ่มหลัก)", () => {
    const { t } = tokens();
    expect(contrast(t("--rs-disabled-text"), t("--rs-disabled-bg"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t("--rs-text-3"), t("--rs-bg"))).toBeGreaterThanOrEqual(7);
    expect(contrast(t("--rs-text-2"), t("--rs-bg"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t("--rs-text"), t("--rs-bg"))).toBeGreaterThanOrEqual(7);
    expect(contrast("#FFFFFF", "#a2191d")).toBeGreaterThanOrEqual(7); // ข้อความขาวบนปุ่มแบรนด์ (primary-600)
    expect(contrast("#a2191d", t("--rs-bg"))).toBeGreaterThanOrEqual(7);
    expect(contrast(t("--rs-blush-text"), t("--rs-blush"))).toBeGreaterThanOrEqual(7);
    expect(contrast(t("--rs-success-text"), t("--rs-success"))).toBeGreaterThanOrEqual(7);
    expect(contrast(t("--rs-warn-text"), t("--rs-warn"))).toBeGreaterThanOrEqual(7);
    expect(contrast(t("--rs-warn-icon"), t("--rs-warn"))).toBeGreaterThanOrEqual(3);
    expect(contrast(t("--rs-text-3"), t("--rs-chip-bg"))).toBeGreaterThanOrEqual(4.5); // chip สีกลาง
  });
});

describe("page metadata", () => {
  it("noindex จนเจ้าของสั่งเปิด · ไม่อ้างไฟล์ OG ที่ยังไม่มี · ไม่ใช้ถ้อยคำต้องห้าม", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.openGraph?.images).toBeUndefined();
    expect(String(metadata.title)).toBe("วัดไซส์แหวนด้วยมือถือ | 3J Jewelry");
    expect(metadata.description).not.toMatch(/แม่นยำ|ใน 1 นาที|มาตรฐานสากล/);
  });
});
