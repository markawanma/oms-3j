// @vitest-environment jsdom
// D1.3 (design-ring-showcase-multi.md §15): แบบที่ 8 เม็ดเดี่ยว 790 บาท — DOM จริง
// Z3-ใหม่ (สลับแบบแล้วหัวหน้า+สรุป+href LINE เปลี่ยนตาม) · Z13 (คำต้องห้ามทุกโหมด) · Z15 · ต้องไม่พัง (สลับแบบ 7→1→7 สีเดิมกลับ · ลิงก์เดิม)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { GEM_QUIZ_PAIRS } from "@/lib/gem-quiz/config";
import { formatPriceThb } from "@/lib/ring-builder/showcase/config";
import { DESIGNS, getShowcaseDesign, type ShowcaseDesignId } from "@/lib/ring-builder/showcase/designs";
import { EMPTY_SHOWCASE_PARAMS, parseTableParam, readShowcaseParams, type IntentionTable, type ShowcaseParams } from "@/lib/ring-builder/showcase/quiz-link";
import { RingShowcaseClient } from "./RingShowcaseClient";

afterEach(cleanup);
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null as never);
  window.history.replaceState(null, "", "/ring-builder");
  Element.prototype.scrollIntoView = vi.fn();
});

const TABLE = parseTableParam("gac.acp.cpb.bgc.pab.gpa") as IntentionTable;
const QUIZ: ShowcaseParams = { ...EMPTY_SHOWCASE_PARAMS, table: TABLE, intention: "love" };
const user = () => userEvent.setup();
const SOL: ShowcaseDesignId = "solitaire";
const FORBIDDEN = /พลอยเสริม|เม็ดข้าง|ทุกเม็ด|เม็ด 1|เม็ดที่ 1|ซ้ายไปขวา|พลอยหลัก|CZ เล็ก/;

const designRadio = (id: ShowcaseDesignId) => screen.getByRole("radio", { name: `${getShowcaseDesign(id).name} ${formatPriceThb(id)}` });
const designGroup = () => screen.getByRole("radiogroup", { name: "เลือกแบบแหวน" });
const modeRadio = (name: string) => screen.getByRole("radio", { name });
const lineHref = () => screen.getByRole("link", { name: /ส่งให้แอดมินทาง LINE/ }).getAttribute("href") ?? "";
const lineMessage = () => decodeURIComponent(lineHref().slice(lineHref().indexOf("/?") + 2));
const url = () => `${window.location.pathname}${window.location.search}`;
const statusText = () =>
  screen
    .getAllByRole("status")
    .map((el) => el.textContent)
    .join("|");
/** ข้อความของหน้านอกการ์ดเลือกแบบ (การ์ดแสดงราคาทุกแบบโดยตั้งใจ) */
const pageTextOutsidePicker = () => (document.body.textContent ?? "").replace(designGroup().textContent ?? "", "");
const prices = (t: string) => [...t.matchAll(/(\d[\d,]*)\s*บาท/g)].map((m) => `${m[1]} บาท`);

async function pickSolitaire(u: ReturnType<typeof user>, params: ShowcaseParams = EMPTY_SHOWCASE_PARAMS) {
  render(<RingShowcaseClient params={{ ...params, ring: SOL }} />);
}

describe("การ์ดเลือกแบบ + ราคาต่อแบบ", () => {
  it("chip ใบที่ 8 = เม็ดเดี่ยว 790 · ที่เหลือ 890 · aria-label = ชื่อ + ราคา", () => {
    render(<RingShowcaseClient params={EMPTY_SHOWCASE_PARAMS} />);
    const radios = within(designGroup()).getAllByRole("radio");
    expect(radios).toHaveLength(8);
    expect(radios[7]).toHaveAccessibleName("แหวนเม็ดเดี่ยว 6 เตย 790 บาท");
    expect(radios[7]).toHaveTextContent("790 บาท");
    for (const r of radios.slice(0, 7)) expect(r).toHaveTextContent("890 บาท");
  });
  it("Z3-ใหม่ สลับแบบ: หัวหน้า + สรุป + href LINE เปลี่ยนตามราคาของแบบ · ไม่มีราคาอื่นนอกการ์ดเลือกแบบ", async () => {
    const u = user();
    render(<RingShowcaseClient params={QUIZ} />);
    for (const id of [SOL, "bar7", SOL, "trinity"] as ShowcaseDesignId[]) {
      await u.click(designRadio(id));
      const price = formatPriceThb(id);
      const header = screen.getByRole("heading", { level: 1 }).parentElement as HTMLElement;
      expect(header).toHaveTextContent(price);
      const summary = screen.getByRole("heading", { name: "สรุปที่เลือก" }).parentElement as HTMLElement;
      expect(within(summary).getByText(price)).toBeInTheDocument();
      expect(prices(lineMessage())).toEqual([price]);
      expect(new Set(prices(pageTextOutsidePicker()))).toEqual(new Set([price]));
      expect(statusText()).toContain(price); // ประกาศ SR รู้ว่าราคาเปลี่ยน
    }
  });
  it("Z15: ไม่มีข้อความ 'ทุกแบบ' ผูกกับราคา ทุกแบบ", async () => {
    const u = user();
    render(<RingShowcaseClient params={EMPTY_SHOWCASE_PARAMS} />);
    for (const d of DESIGNS) {
      await u.click(designRadio(d.id));
      expect(document.body.textContent).not.toMatch(/บาท\s*ทุกแบบ/);
    }
  });
});

describe("Z13 — solitaire ไม่มีคำต้องห้ามในทุกโหมด (DOM + LINE + aria stage + ประกาศ)", () => {
  function assertClean() {
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(FORBIDDEN);
    expect(text).not.toMatch(/เพชร|undefined|NaN|\[object/);
    expect(lineMessage()).not.toMatch(FORBIDDEN);
    expect(statusText()).not.toMatch(FORBIDDEN);
    expect(screen.getByRole("region", { name: "ภาพแหวน" }).getAttribute("aria-label") ?? "").not.toMatch(FORBIDDEN);
    for (const pair of GEM_QUIZ_PAIRS) {
      expect(text, pair.title).not.toContain(pair.title); // ไม่มีข้อความคู่พลอย (pair.title) — แหวนมีพลอยเม็ดเดียว
    }
  }
  it("แนะนำ ชุด 1/2/3 · ไม่มี quiz (direct) · เลือกเองยังไม่เลือก", async () => {
    const u = user();
    await pickSolitaire(u, QUIZ);
    for (const n of [1, 2, 3]) {
      await u.click(screen.getByRole("radio", { name: new RegExp(`^ชุด ${n} `) }));
      assertClean();
      const summary = screen.getByRole("heading", { name: "สรุปที่เลือก" }).parentElement as HTMLElement;
      expect(within(summary).getByText("พลอยเม็ดเดี่ยว")).toBeInTheDocument();
    }
    await u.click(modeRadio("เลือกพลอยเอง"));
    assertClean();
    cleanup();
    render(<RingShowcaseClient params={{ ...EMPTY_SHOWCASE_PARAMS, ring: SOL }} />);
    assertClean();
    await u.click(modeRadio("เลือกพลอยเอง"));
    assertClean();
  });
  it("การ์ดชุดของเม็ดเดี่ยว: ไอคอนเดียว ชื่อเดียว (ไม่มี ' + ') ไม่มี sameAs · คำอธิบาย = labelTh + keywords ของพลอยนั้น", async () => {
    const u = user();
    await pickSolitaire(u, QUIZ);
    const cards = screen.getAllByRole("radio", { name: /^ชุด [123] / });
    expect(cards).toHaveLength(3);
    for (const c of cards) expect(c.textContent).not.toContain(" + ");
    const sets = within(screen.getByRole("radiogroup", { name: "พลอยที่คุณเลือกได้" })).getAllByRole("radio");
    expect(sets).toHaveLength(3);
    expect(document.body.textContent).not.toContain("คู่เดียวกับชุด");
  });
  it("เลือกเอง: radiogroup เดียว 6 ตัวเลือก (5 พลอย + CZ ขาว) · ไม่มีแถบเลขเม็ด/ใส่ทุกเม็ด/กลับเป็น CZ/เลิกทำ · เลือกแล้ว LINE/สรุป/URL/ประกาศถูก", async () => {
    const u = user();
    await pickSolitaire(u, QUIZ);
    await u.click(modeRadio("เลือกพลอยเอง"));
    const group = screen.getByRole("radiogroup", { name: "พลอยเม็ดเดี่ยว" });
    const names = within(group).getAllByRole("radio").map((r) => r.getAttribute("aria-label"));
    expect(names).toHaveLength(6);
    expect(names[5]).toBe("CZ ขาว");
    expect(screen.queryByRole("radiogroup", { name: "เลือกพลอยทีละเม็ด" })).toBeNull();
    expect(screen.queryByRole("button", { name: "กลับเป็น CZ ขาวทั้งหมด" })).toBeNull();
    expect(screen.queryByRole("button", { name: "เลิกทำ" })).toBeNull();

    await u.click(within(group).getByRole("radio", { name: "โกเมน" }));
    expect(within(group).getByRole("radio", { name: "โกเมน" })).toHaveAttribute("aria-checked", "true");
    expect(url()).toBe("/ring-builder?t=gac.acp.cpb.bgc.pab.gpa&i=love&q=love&c=g&d=own&r=solitaire");
    expect(statusText()).toContain("เปลี่ยนพลอยเป็นโกเมนแล้ว");
    expect(lineMessage()).toContain("พลอย: เลือกพลอยเอง\nพลอยเม็ดเดี่ยว: โกเมน\n");
    expect(screen.getByRole("heading", { name: "สรุปที่เลือก" }).parentElement).toHaveTextContent("พลอยเม็ดเดี่ยวโกเมน");
    expect(document.body.textContent).not.toMatch(FORBIDDEN);

    // CZ ขาว: เพิ่ม Latin → เว้นวรรคหน้าชื่อในประกาศ · ไม่มีคำอธิบายพลอย
    await u.click(within(group).getByRole("radio", { name: "CZ ขาว" }));
    expect(statusText()).toContain("เปลี่ยนพลอยเป็น CZ ขาวแล้ว");
    expect(lineMessage()).toContain("พลอยเม็ดเดี่ยว: CZ ขาว");
    expect(document.body.textContent).not.toMatch(FORBIDDEN);
  });
});

describe("ต้องไม่พัง — สลับแบบ/ลิงก์", () => {
  it("เลือกเอง: bar7 (หลายสี) → solitaire → bar7 สีเดิมกลับ (ownByCount) · solitaire → ไขว้ = [x,x]", async () => {
    const u = user();
    render(<RingShowcaseClient params={{ ...EMPTY_SHOWCASE_PARAMS, ring: "bar7" }} />);
    await u.click(modeRadio("เลือกพลอยเอง"));
    const slotGroup = (n: number) => screen.getByRole("radiogroup", { name: `เลือกพลอยให้เม็ดที่ ${n}` });
    await u.click(within(slotGroup(1)).getByRole("radio", { name: "โกเมน" })); // ใส่ทุกเม็ด
    await u.click(screen.getByRole("radio", { name: /^เม็ดที่ 4 / }));
    await u.click(within(slotGroup(4)).getByRole("radio", { name: "ซิทริน" }));
    expect(url()).toContain("c=g.g.g.c.g.g.g");

    await u.click(designRadio(SOL));
    expect(url()).toContain("c=c&"); // เม็ดกลาง (ซิทริน) ส่งต่อมา
    expect(url()).toContain("r=solitaire");
    expect(statusText()).toContain("ปรับพลอยให้พอดี 1 เม็ด");
    expect(document.body.textContent).not.toMatch(FORBIDDEN);

    await u.click(designRadio("bar7"));
    expect(url()).toContain("c=g.g.g.c.g.g.g"); // จำสีเดิมต่อจำนวนเม็ด
    expect(url()).toContain("r=bar7");

    await u.click(designRadio(SOL));
    await u.click(designRadio("bypass2"));
    expect(url()).toContain("c=citrine.citrine");
    expect(url()).not.toContain("r=");
  });
  it("ลิงก์เดิมของ 7 แบบเปิดผลเดิม · ลิงก์ solitaire ?r=solitaire และ ?c=g&d=own&r=solitaire เปิดได้", () => {
    render(<RingShowcaseClient params={readShowcaseParams({ r: SOL })} />);
    expect(designRadio(SOL)).toHaveAttribute("aria-checked", "true");
    expect(prices(lineMessage())).toEqual(["790 บาท"]);
    cleanup();
    render(<RingShowcaseClient params={readShowcaseParams({ c: "g", d: "own", r: SOL })} />);
    expect(screen.getByRole("radio", { name: "โกเมน" })).toHaveAttribute("aria-checked", "true");
    expect(lineMessage()).toContain("พลอยเม็ดเดี่ยว: โกเมน");
    cleanup();
    render(<RingShowcaseClient params={readShowcaseParams({ c: "g.a", d: "own", r: SOL })} />);
    // c=g.a ของ solitaire ถูกทิ้ง (Z14) → ยังไม่ได้เลือกพลอย · ไม่ crash
    expect(lineMessage()).not.toContain("โกเมน");
    cleanup();
    render(<RingShowcaseClient params={readShowcaseParams({ c: "g.g.g.g.g.g.g", d: "own", r: "bar7" })} />);
    expect(prices(lineMessage())).toEqual(["890 บาท"]);
  });
  it("ไซซ์: solitaire 50–60 ครบ 11 ปุ่ม · ไซซ์ดิบ 57 ที่ไขว้ใช้ไม่ได้... กลับมาเมื่อสลับ", async () => {
    const u = user();
    render(<RingShowcaseClient params={{ ...EMPTY_SHOWCASE_PARAMS, ring: SOL }} />);
    const sizeGroup = () => screen.getByRole("radiogroup", { name: /^เลือกไซซ์/ });
    expect(within(sizeGroup()).getAllByRole("radio")).toHaveLength(11);
    await u.click(within(sizeGroup()).getByRole("radio", { name: "เบอร์ 50" }));
    expect(lineMessage()).toContain("เบอร์ 50");
    await u.click(designRadio("bypass2")); // ไขว้ 55–58 → 50 ใช้ไม่ได้
    expect(lineMessage()).toContain("รอแอดมินช่วยเช็ก");
    await u.click(designRadio(SOL));
    expect(lineMessage()).toContain("เบอร์ 50");
  });
});
