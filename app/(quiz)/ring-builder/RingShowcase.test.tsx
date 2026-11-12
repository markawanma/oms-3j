// @vitest-environment jsdom
// หน้า /ring-builder (D1 demo): state ครบ 4 แบบ (โหลด/ล้ม/ว่าง=เข้าตรง/สำเร็จ) · a11y radiogroup · ข้อความ LINE · X2 (page อ่าน key เดียว) · X7 (ข้อความพลอยคำต่อคำ)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { GEM_QUIZ_DISCLAIMER, GEM_QUIZ_PAIRS } from "@/lib/gem-quiz/config";
import { buildShowcaseSets } from "@/lib/ring-builder/showcase/sets";
import type { GemTop3 } from "@/lib/ring-builder/showcase/quiz-link";
import type { LastMeasuredSize } from "@/lib/ring-builder/last-size";
import RingShowcasePage from "./page";
import { RingShowcaseClient } from "./RingShowcaseClient";

const lastSizeMock = vi.hoisted(() => ({ read: vi.fn<() => LastMeasuredSize | null>(() => null) }));
vi.mock("@/lib/ring-builder/last-size", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/ring-builder/last-size")>();
  return { ...orig, getLastMeasuredSize: () => lastSizeMock.read() };
});

afterEach(cleanup);
beforeEach(() => {
  lastSizeMock.read.mockReset();
  lastSizeMock.read.mockReturnValue(null);
  // jsdom ไม่มี WebGL — ทำให้นิ่ง (ไม่พ่น "not implemented") และจำลองเครื่องที่แสดง 3 มิติไม่ได้
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null as never);
});

const TOP3: GemTop3 = ["garnet", "citrine", "peridot"];

function lineHref(): string {
  const a = screen.getByRole("link", { name: /ส่งให้แอดมินทาง LINE/ });
  return a.getAttribute("href") ?? "";
}
function lineMessage(): string {
  const href = lineHref();
  return decodeURIComponent(href.slice(href.indexOf("/?") + 2));
}

describe("เข้าตรง (ไม่มี g) — โหมด CZ ขาว", () => {
  it("แสดงชื่อแบบ + 800 บาท + การ์ดชวนทำ quiz แทนแบบ 1/2/3 · ไม่มี radio ของพลอย", () => {
    render(<RingShowcaseClient top3={null} />);
    expect(screen.getByRole("heading", { level: 1, name: "แหวนไขว้พลอยไข่ 2 เม็ด" })).toBeInTheDocument();
    expect(screen.getAllByText("800 บาท").length).toBeGreaterThan(0);
    expect(screen.getByText(/พรีออเดอร์ ทำภายใน 21 วัน/)).toBeInTheDocument();
    const quiz = screen.getByRole("link", { name: "ทำแบบทดสอบ 1 นาที" });
    expect(quiz).toHaveAttribute("href", "/gem-quiz");
    expect(screen.queryByRole("radiogroup", { name: "พลอยที่คุณเลือกได้" })).toBeNull();
  });
  it("ยังเลือกไซซ์/ส่ง LINE ได้ · พลอย = CZ ขาว", async () => {
    const user = userEvent.setup();
    render(<RingShowcaseClient top3={null} />);
    await user.click(screen.getByRole("radio", { name: "เบอร์ 56" }));
    const msg = lineMessage();
    expect(msg).toContain("พลอยบน: CZ ขาว · พลอยล่าง: CZ ขาว · CZ เล็ก 2 เม็ด");
    expect(msg).toContain("ไซซ์: เบอร์ 56");
    expect(msg).not.toMatch(/· แบบ \d/);
  });
});

describe("stage: WebGL ใช้ไม่ได้ → รูปจริงแทน ตัวเลือกยังใช้ได้", () => {
  it("แสดงข้อความ + รูปจริงรูปแรกพร้อม alt · ไม่มี canvas", async () => {
    render(<RingShowcaseClient top3={TOP3} />);
    const stage = screen.getByRole("region", { name: "ภาพแหวน" });
    expect(await within(stage).findByText("เครื่องนี้แสดงภาพ 3 มิติไม่ได้ ดูรูปจริงด้านล่างแทน")).toBeInTheDocument();
    expect(within(stage).getByRole("status")).toBeInTheDocument();
    expect(within(stage).getByRole("img", { name: /รูปที่ 1 จาก 5/ })).toBeInTheDocument();
    expect(stage.querySelector("canvas")).toBeNull();
  });
  it("เลือกพลอย/ไซซ์ได้ตามปกติ และข้อความอธิบายพลอยเปลี่ยน", async () => {
    const user = userEvent.setup();
    render(<RingShowcaseClient top3={TOP3} />);
    await user.click(screen.getAllByRole("radio", { name: /แบบ 3/ })[0]);
    const sets = buildShowcaseSets(TOP3);
    expect(screen.getByText(sets[2].pair.title)).toBeInTheDocument();
  });
});

describe("เลือกแบบพลอย (มาจาก quiz)", () => {
  it("radiogroup 3 ใบ · แบบ 1 ถูกเลือกเริ่มต้น · ชื่อ 'บน + ล่าง' ตาม findPair เดียวกับ quiz", () => {
    render(<RingShowcaseClient top3={TOP3} />);
    const group = screen.getByRole("radiogroup", { name: "พลอยที่คุณเลือกได้" });
    const radios = within(group).getAllByRole("radio");
    expect(radios).toHaveLength(3);
    expect(radios[0]).toHaveAttribute("aria-checked", "true");
    expect(radios[1]).toHaveAttribute("aria-checked", "false");
    expect(radios.map((r) => r.getAttribute("tabindex"))).toEqual(["0", "-1", "-1"]);
    expect(radios[0]).toHaveTextContent("โกเมน + ซิทริน");
    expect(radios[0]).toHaveTextContent("อันดับ 1 จากแบบทดสอบ");
    expect(radios[1]).toHaveTextContent("ซิทริน + โกเมน");
    expect(radios[1]).toHaveTextContent("คู่เดียวกับแบบ 1 — สลับว่าเม็ดไหนอยู่บน");
  });

  it("X7: คำอธิบายคู่พลอย = GEM_QUIZ_PAIRS คำต่อคำ (title / th / เหมาะกับ: fit) + คำอธิบายบน/ล่าง", () => {
    render(<RingShowcaseClient top3={TOP3} />);
    const pair = GEM_QUIZ_PAIRS.find((p) => p.gems.includes("garnet") && p.gems.includes("citrine"))!;
    expect(screen.getByText(pair.title)).toBeInTheDocument();
    expect(screen.getByText(pair.th)).toBeInTheDocument();
    expect(screen.getByText(`เหมาะกับ: ${pair.fit}`)).toBeInTheDocument();
    expect(screen.getByText("บน = พลอยหลักของแบบ · ล่าง = พลอยเสริม · CZ เล็ก 2 เม็ดมาพร้อมแหวน")).toBeInTheDocument();
  });

  it("คลิกแบบ 3 → aria-checked เปลี่ยน · คำอธิบายเปลี่ยนเป็นคู่ของแบบ 3 · ข้อความ LINE มี 'แบบ 3'", async () => {
    const user = userEvent.setup();
    render(<RingShowcaseClient top3={TOP3} />);
    const radios = within(screen.getByRole("radiogroup", { name: "พลอยที่คุณเลือกได้" })).getAllByRole("radio");
    await user.click(radios[2]);
    expect(radios[2]).toHaveAttribute("aria-checked", "true");
    expect(radios[0]).toHaveAttribute("aria-checked", "false");
    const s3 = buildShowcaseSets(TOP3)[2];
    expect(screen.getByText(`เหมาะกับ: ${s3.pair.fit}`)).toBeInTheDocument();
    const msg = lineMessage();
    expect(msg).toContain("แบบ: แหวนไขว้พลอยไข่ 2 เม็ด · แบบ 3");
    expect(msg).toContain("พลอยบน: เพอริดอท");
  });

  it("ลูกศรซ้าย/ขวา/Home/End เลื่อนการเลือกและโฟกัส (roving tabindex)", async () => {
    const user = userEvent.setup();
    render(<RingShowcaseClient top3={TOP3} />);
    const radios = within(screen.getByRole("radiogroup", { name: "พลอยที่คุณเลือกได้" })).getAllByRole("radio");
    radios[0].focus();
    await user.keyboard("{ArrowRight}");
    expect(radios[1]).toHaveAttribute("aria-checked", "true");
    expect(radios[1]).toHaveFocus();
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(radios[2]).toHaveAttribute("aria-checked", "true");
    await user.keyboard("{Home}");
    expect(radios[0]).toHaveAttribute("aria-checked", "true");
    await user.keyboard("{End}");
    expect(radios[2]).toHaveAttribute("aria-checked", "true");
  });
});

describe("เลือกไซซ์", () => {
  it("มีแค่ 55–58 · ไม่เลือก = แถบเตือน + ข้อความ 'รอแอดมินช่วยเช็ก' · ปุ่ม LINE ยังเป็นลิงก์ที่กดได้", () => {
    render(<RingShowcaseClient top3={TOP3} />);
    const sizes = within(screen.getByRole("radiogroup", { name: "เลือกไซซ์" })).getAllByRole("radio");
    expect(sizes.map((s) => s.textContent)).toEqual(["55", "56", "57", "58"]);
    expect(sizes.every((s) => s.getAttribute("aria-checked") === "false")).toBe(true);
    expect(screen.getByText("ยังไม่ได้เลือกไซซ์ — ส่งได้เลย แอดมินจะช่วยเช็กไซซ์ให้")).toBeInTheDocument();
    expect(screen.getAllByText("รอแอดมินช่วยเช็ก").length).toBeGreaterThan(0);
    const link = screen.getByRole("link", { name: /ส่งให้แอดมินทาง LINE/ });
    expect(link.tagName).toBe("A");
    expect(link).not.toHaveAttribute("aria-disabled");
    expect(lineMessage()).toContain("ไซซ์: รอแอดมินช่วยเช็ก");
  });
  it("เลือก 57 → ข้อความ LINE 'เบอร์ 57' · แถบเตือนหาย · ล้างไซซ์กลับเป็นรอแอดมินได้", async () => {
    const user = userEvent.setup();
    render(<RingShowcaseClient top3={TOP3} />);
    await user.click(screen.getByRole("radio", { name: "เบอร์ 57" }));
    expect(screen.getByRole("radio", { name: "เบอร์ 57" })).toHaveAttribute("aria-checked", "true");
    expect(lineMessage()).toContain("ไซซ์: เบอร์ 57");
    expect(screen.queryByText(/ยังไม่ได้เลือกไซซ์/)).toBeNull();
    await user.click(screen.getByRole("button", { name: /ล้างไซซ์/ }));
    expect(lineMessage()).toContain("ไซซ์: รอแอดมินช่วยเช็ก");
    expect(screen.getByText(/ยังไม่ได้เลือกไซซ์/)).toBeInTheDocument();
  });
  it("ลูกศรเลื่อนไซซ์ได้", async () => {
    const user = userEvent.setup();
    render(<RingShowcaseClient top3={TOP3} />);
    const sizes = within(screen.getByRole("radiogroup", { name: "เลือกไซซ์" })).getAllByRole("radio");
    sizes[0].focus();
    await user.keyboard("{ArrowRight}");
    expect(sizes[1]).toHaveAttribute("aria-checked", "true");
  });
  it("มีลิงก์ไป /ring-size", () => {
    render(<RingShowcaseClient top3={TOP3} />);
    expect(screen.getByRole("link", { name: /วัดด้วยเครื่องมือวัดไซซ์/ })).toHaveAttribute("href", "/ring-size");
  });
  it("ผลวัดล่าสุดในช่วง → ปุ่มเสนอ 'ใช้เบอร์ n' (ไม่เลือกให้เอง) · กดแล้วเลือก", async () => {
    lastSizeMock.read.mockReturnValue({ size: 56, method: "A", savedAt: 1, inShopRange: true });
    const user = userEvent.setup();
    render(<RingShowcaseClient top3={TOP3} />);
    expect(await screen.findByText("ผลวัดล่าสุด: เบอร์ 56")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "เบอร์ 56" })).toHaveAttribute("aria-checked", "false");
    await user.click(screen.getByRole("button", { name: "ใช้เบอร์ 56" }));
    expect(screen.getByRole("radio", { name: "เบอร์ 56" })).toHaveAttribute("aria-checked", "true");
  });
  it("ผลวัดล่าสุดนอก 55–58 → ข้อความแจ้ง ไม่มีปุ่มใช้เบอร์นี้", async () => {
    lastSizeMock.read.mockReturnValue({ size: 61, method: "B", savedAt: 1, inShopRange: true });
    render(<RingShowcaseClient top3={TOP3} />);
    expect(await screen.findByText("ผลวัดล่าสุด: เบอร์ 61")).toBeInTheDocument();
    expect(screen.getByText("ไซซ์นี้อยู่นอกช่วงของแบบนี้ ทักแอดมินได้")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ใช้เบอร์/ })).toBeNull();
  });
  it("localStorage ถูกบล็อก (อ่านแล้ว throw) → หน้ายังใช้ได้ ไม่มีกล่องผลวัด", async () => {
    lastSizeMock.read.mockImplementation(() => {
      throw new Error("SecurityError");
    });
    render(<RingShowcaseClient top3={TOP3} />);
    expect(screen.getByRole("radiogroup", { name: "เลือกไซซ์" })).toBeInTheDocument();
    expect(screen.queryByText(/ผลวัดล่าสุด/)).toBeNull();
  });
});

describe("สรุป + ส่ง LINE + คัดลอก", () => {
  it("การ์ดสรุป: แบบ · พลอยบน · พลอยล่าง · ไซซ์ · 800 บาท · 'ยังไม่ใช่การสั่งซื้อ'", () => {
    render(<RingShowcaseClient top3={TOP3} />);
    const summary = screen.getByRole("heading", { name: "สรุปที่เลือก" }).parentElement as HTMLElement;
    expect(within(summary).getByText("แหวนไขว้พลอยไข่ 2 เม็ด · แบบ 1")).toBeInTheDocument();
    expect(within(summary).getByText("โกเมน")).toBeInTheDocument();
    expect(within(summary).getByText("ซิทริน")).toBeInTheDocument();
    expect(within(summary).getByText("800 บาท")).toBeInTheDocument();
    expect(within(summary).getByText("ยังไม่ใช่การสั่งซื้อ — ส่งให้แอดมินยืนยันก่อน")).toBeInTheDocument();
  });
  it("ลิงก์ LINE เป็น <a> ปกติ (ไม่ใช่ window.open) จาก lineOaMessageUrl · ราคามีค่าเดียว", () => {
    render(<RingShowcaseClient top3={TOP3} />);
    const a = screen.getByRole("link", { name: /ส่งให้แอดมินทาง LINE/ });
    expect(a.getAttribute("href")).toMatch(/^https:\/\/line\.me\/R\/oaMessage\/%40/);
    expect([...lineMessage().matchAll(/(\d[\d,]*)\s*บาท/g)].map((m) => m[1])).toEqual(["800"]);
  });
  it("คัดลอกสำเร็จ → ปุ่ม 'คัดลอกแล้ว ✓' แล้วกลับเป็นเดิมหลัง 3 วิ", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<RingShowcaseClient top3={TOP3} />);
      await user.click(screen.getByRole("button", { name: "คัดลอกข้อความ" }));
      expect(await screen.findByRole("button", { name: "คัดลอกแล้ว ✓" })).toBeInTheDocument();
      expect(await navigator.clipboard.readText()).toBe(lineMessage());
      await vi.advanceTimersByTimeAsync(3100);
      expect(screen.getByRole("button", { name: "คัดลอกข้อความ" })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
  it("คัดลอกไม่สำเร็จ → textarea อ่านอย่างเดียวพร้อมข้อความ · ปุ่ม LINE ยังเปิดได้", async () => {
    const user = userEvent.setup();
    render(<RingShowcaseClient top3={TOP3} />);
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    await user.click(screen.getByRole("button", { name: "คัดลอกข้อความ" }));
    const ta = (await screen.findByLabelText("กดค้างเพื่อคัดลอกเอง")) as HTMLTextAreaElement;
    expect(ta).toHaveAttribute("readonly");
    expect(ta.value).toBe(lineMessage());
    expect(screen.getByRole("link", { name: /ส่งให้แอดมินทาง LINE/ })).toBeInTheDocument();
  });
});

describe("รูปจริง", () => {
  it("5 รูปพร้อม alt ตามมุมถ่าย · ปุ่มก่อนหน้า/ถัดไปมี aria-label", () => {
    render(<RingShowcaseClient top3={TOP3} />);
    const gallery = screen.getByRole("region", { name: "ดูของจริง" });
    const imgs = within(gallery).getAllByRole("img");
    expect(imgs).toHaveLength(5);
    imgs.forEach((img, i) => expect(img.getAttribute("alt")).toMatch(new RegExp(`รูปที่ ${i + 1} จาก 5 — `)));
    expect(screen.getByRole("button", { name: "รูปก่อนหน้า" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "รูปถัดไป" })).toBeInTheDocument();
  });
  it("รูปโหลดไม่ได้ → กรอบ 'รูปนี้โหลดไม่ได้' + ลองอีกครั้ง แล้ว mount รูปใหม่", async () => {
    const user = userEvent.setup();
    render(<RingShowcaseClient top3={TOP3} />);
    const gallery = screen.getByRole("region", { name: "ดูของจริง" });
    fireEvent.error(within(gallery).getAllByRole("img")[1]);
    expect(within(gallery).getByText("รูปนี้โหลดไม่ได้")).toBeInTheDocument();
    expect(within(gallery).getAllByRole("img")).toHaveLength(4);
    await user.click(within(gallery).getByRole("button", { name: "ลองอีกครั้ง" }));
    expect(within(gallery).getAllByRole("img")).toHaveLength(5);
  });
});

describe("ข้อความท้ายหน้า + กฎแบรนด์", () => {
  it("disclaimer เดิมของ quiz คำต่อคำ · ไม่มีคำว่า 'เพชร' ทั้งหน้า (X7)", () => {
    const { container } = render(<RingShowcaseClient top3={TOP3} />);
    expect(screen.getByText(GEM_QUIZ_DISCLAIMER, { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/CZ คือคิวบิกเซอร์โคเนีย/)).toBeInTheDocument();
    expect(container.textContent).not.toContain("เพชร");
    expect(container.textContent).not.toMatch(/นำโชค|เสริมดวง/);
  });
  it("X6: ไม่มีน้ำหนัก/ต้นทุน/สเปคช่างบนหน้า", () => {
    const { container } = render(<RingShowcaseClient top3={TOP3} />);
    expect(container.textContent).not.toMatch(/กรัม|น้ำหนัก|ต้นทุน|margin|3\.2/i);
  });
  it("ไม่มี horizontal-scroll class ที่ระดับเปลือก (overflow-x-hidden) และไม่มี input ข้อมูลส่วนบุคคล/ชำระเงิน", () => {
    const { container } = render(<RingShowcaseClient top3={TOP3} />);
    expect(container.firstElementChild?.className).toContain("overflow-x-hidden");
    expect(container.querySelectorAll("input")).toHaveLength(0);
  });
});

describe("page.tsx — X1/X2", () => {
  async function propsOf(sp: Record<string, string | string[] | undefined>) {
    const el = (await RingShowcasePage({ searchParams: Promise.resolve(sp) })) as { props: { top3: GemTop3 | null } };
    return el.props.top3;
  }
  it("g ถูกต้อง → top3 · ?price= ?size= ?design= ไม่มีผล", async () => {
    expect(await propsOf({ g: "garnet.citrine.peridot" })).toEqual(["garnet", "citrine", "peridot"]);
    expect(await propsOf({ g: "garnet.citrine.peridot", price: "1", size: "99", design: "9" })).toEqual(["garnet", "citrine", "peridot"]);
    expect(await propsOf({ price: "1", size: "99", design: "9" })).toBeNull();
  });
  it("g ผิดรูป → null ไม่ throw", async () => {
    for (const g of ["constructor.garnet.citrine", "__proto__.a.b", "garnet.garnet.citrine", "garnet.citrine", "x".repeat(65), "<b>.garnet.citrine"]) {
      expect(await propsOf({ g })).toBeNull();
    }
    expect(await propsOf({ g: ["garnet.citrine.peridot", "x"] })).toBeNull();
  });
  it("page อ่าน searchParams เฉพาะ key g", async () => {
    const touched: (string | symbol)[] = [];
    const proxy = new Proxy({ g: "garnet.citrine.peridot", price: "1", size: "2" } as Record<string, string>, {
      get(t, k) {
        touched.push(k);
        return t[k as string];
      },
    });
    await RingShowcasePage({ searchParams: Promise.resolve(proxy) });
    // await Promise.resolve(proxy) แตะ "then" ของ proxy เอง (กลไก Promise ไม่ใช่โค้ดหน้า) — ตัดออกก่อนเทียบ
    expect(touched.filter((k) => k !== "then")).toEqual(["g"]);
  });
});
