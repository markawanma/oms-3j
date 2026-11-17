// @vitest-environment jsdom
// D1.1 (design §9.6): Y3 ราคาคงที่ 25 คู่ · Y4 ข้อความคู่ · Y6 ป้ายตามที่มา · Y7 LINE ตามโหมด · สลับโหมดค่าอยู่ครบ · URL เขียนกลับ · ไม่มี "เพชร"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { GEM_QUIZ_PAIRS, GEM_QUIZ_STONES } from "@/lib/gem-quiz/config";
import { EMPTY_SHOWCASE_PARAMS, parseTableParam, type IntentionTable, type ShowcaseParams } from "@/lib/ring-builder/showcase/quiz-link";
import RingShowcasePage from "./page";
import { RingShowcaseClient } from "./RingShowcaseClient";

afterEach(cleanup);
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null as never);
  window.history.replaceState(null, "", "/ring-builder");
});

const TABLE = parseTableParam("gac.acp.cpb.bgc.pab.gpa") as IntentionTable;
const QUIZ: ShowcaseParams = { ...EMPTY_SHOWCASE_PARAMS, table: TABLE, intention: "love" };
const user = () => userEvent.setup();

function lineMessage(): string {
  const href = screen.getByRole("link", { name: /ส่งให้แอดมินทาง LINE/ }).getAttribute("href") ?? "";
  return decodeURIComponent(href.slice(href.indexOf("/?") + 2));
}
const modeRadio = (name: string) => screen.getByRole("radio", { name });
const gemRow = (name: string) => within(screen.getByRole("radiogroup", { name }));

describe("Y6: ป้ายตามที่มา", () => {
  it("t+i เรื่องที่ตอบ → 'จากผลแบบทดสอบของคุณ' + 'อันดับ n จากแบบทดสอบ'", () => {
    render(<RingShowcaseClient params={QUIZ} />);
    expect(screen.getByText("จากผลแบบทดสอบของคุณ")).toBeInTheDocument();
    expect(screen.getAllByText(/จากแบบทดสอบ/).length).toBe(3);
  });
  it("i เดี่ยว → ไม่มีคำว่า 'จากแบบทดสอบ' เลย", () => {
    const { container } = render(<RingShowcaseClient params={{ ...EMPTY_SHOWCASE_PARAMS, intention: "calm" }} />);
    expect(container.textContent).not.toContain("จากแบบทดสอบ");
    expect(container.textContent).not.toContain("จากผลแบบทดสอบ");
    expect(screen.getByText("จัดอันดับตามเรื่องที่เลือก ไม่ใช่ผลแบบทดสอบ")).toBeInTheDocument();
    expect(screen.getAllByText(/ในเรื่องนี้/).length).toBe(3);
  });
  it("เปลี่ยนเรื่อง → ป้ายเปลี่ยน · กลับมาเรื่องเดิม → ป้ายแรกกลับมา · URL ถอด t ตอนเรื่องต่าง", async () => {
    const u = user();
    const { container } = render(<RingShowcaseClient params={QUIZ} />);
    await u.click(screen.getByRole("button", { name: "เปลี่ยน" }));
    await u.click(screen.getByRole("radio", { name: "การเงิน & โอกาส" }));
    expect(container.textContent).not.toContain("จากแบบทดสอบ");
    expect(window.location.search).toBe("?i=wealth"); // ไม่มี t → reload จะไม่อ้าง quiz
    await u.click(screen.getByRole("button", { name: "เปลี่ยน" }));
    await u.click(screen.getByRole("radio", { name: "ความรัก & เสน่ห์" }));
    expect(screen.getByText("จากผลแบบทดสอบของคุณ")).toBeInTheDocument();
    expect(window.location.search).toContain("t=gac.acp.cpb.bgc.pab.gpa&i=love");
  });
  it("ลิงก์ g เดิม: ไม่มีข้อความ basis (เหมือน D1) แต่ป้ายการ์ดจากแบบทดสอบ · กดเลือกเรื่อง → ถอด g", async () => {
    const u = user();
    render(<RingShowcaseClient params={{ ...EMPTY_SHOWCASE_PARAMS, top3: ["garnet", "citrine", "peridot"] }} />);
    expect(screen.getAllByText(/จากแบบทดสอบ/).length).toBe(3);
    expect(window.location.search).toBe("?g=garnet.citrine.peridot");
    await u.click(screen.getByRole("radio", { name: "ความสงบ & การปกป้อง" }));
    expect(screen.queryAllByText(/จากแบบทดสอบ/).length).toBe(0);
    expect(window.location.search).toBe("?i=calm");
  });
  it("เข้าตรง: ไม่มีการ์ดแบบ · มีข้อความเลือกเรื่อง · เลือกเรื่อง → ได้แบบ 1/2/3 ป้าย 'ในเรื่องนี้'", async () => {
    const u = user();
    render(<RingShowcaseClient params={EMPTY_SHOWCASE_PARAMS} />);
    expect(screen.getByText("เลือกเรื่องด้านบนเพื่อดูแบบแนะนำ")).toBeInTheDocument();
    await u.click(screen.getByRole("radio", { name: "งาน & ความสำเร็จ" }));
    const cards = within(screen.getByRole("radiogroup", { name: "พลอยที่คุณเลือกได้" })).getAllByRole("radio");
    expect(cards).toHaveLength(3);
    expect(cards[0]).toHaveTextContent("อันดับ 1 ในเรื่องนี้");
    expect(modeRadio("แบบแนะนำ")).toHaveAttribute("aria-checked", "true");
  });
});

describe("โหมดเลือกพลอยเอง", () => {
  it("สลับโหมด: seed จากแบบที่ดูอยู่ · สลับกลับค่าแนะนำอยู่ครบ · ไม่ล้างฝั่งตรงข้าม", async () => {
    const u = user();
    render(<RingShowcaseClient params={QUIZ} />);
    await u.click(within(screen.getByRole("radiogroup", { name: "พลอยที่คุณเลือกได้" })).getAllByRole("radio")[1]); // แบบ 2
    await u.click(modeRadio("เลือกพลอยเอง"));
    const seeded = lineMessage();
    expect(seeded).toContain("· เลือกพลอยเอง");
    expect(seeded).not.toMatch(/· แบบ \d/);
    await u.click(gemRow("พลอยบน (เม็ดหลัก)").getByRole("radio", { name: "บลูโทพาส" }));
    await u.click(modeRadio("แบบแนะนำ"));
    expect(within(screen.getByRole("radiogroup", { name: "พลอยที่คุณเลือกได้" })).getAllByRole("radio")[1]).toHaveAttribute("aria-checked", "true");
    expect(lineMessage()).toContain("· แบบ 2");
    await u.click(modeRadio("เลือกพลอยเอง"));
    expect(gemRow("พลอยบน (เม็ดหลัก)").getByRole("radio", { name: "บลูโทพาส" })).toHaveAttribute("aria-checked", "true");
  });
  it("เข้าตรง: ว่างทั้งคู่ + คำแนะนำ · แตะเม็ดแรก = ตั้งทั้งสอง (บน=ล่างได้) · แล้วเปลี่ยนล่างได้ · สรุปแสดง 'ยังไม่ได้เลือกพลอย' ตอนว่าง", async () => {
    const u = user();
    render(<RingShowcaseClient params={EMPTY_SHOWCASE_PARAMS} />);
    await u.click(modeRadio("เลือกพลอยเอง"));
    expect(screen.getByText("แตะพลอยบนก่อน ระบบใส่ชนิดเดียวกันให้ล่าง แล้วเปลี่ยนล่างได้")).toBeInTheDocument();
    expect(screen.getAllByText("ยังไม่ได้เลือกพลอย")).toHaveLength(2);
    await u.click(gemRow("พลอยบน (เม็ดหลัก)").getByRole("radio", { name: "โกเมน" }));
    expect(gemRow("พลอยล่าง (เม็ดเสริม)").getByRole("radio", { name: "โกเมน" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("โกเมน ทั้ง 2 เม็ด")).toBeInTheDocument();
    await u.click(gemRow("พลอยล่าง (เม็ดเสริม)").getByRole("radio", { name: "ซิทริน" }));
    expect(screen.getByText("Power + Abundance")).toBeInTheDocument();
    expect(window.location.search).toBe("?c=garnet.citrine&d=own");
  });
  it("Y4: ทั้ง 25 แบบ — ข้อความคู่โผล่เฉพาะคู่ใน GEM_QUIZ_PAIRS · คู่อื่นแสดงรายเม็ดจาก config + หมายเหตุ", async () => {
    const u = user();
    const { container } = render(<RingShowcaseClient params={EMPTY_SHOWCASE_PARAMS} />);
    await u.click(modeRadio("เลือกพลอยเอง"));
    let withPair = 0;
    for (const a of GEM_QUIZ_STONES)
      for (const b of GEM_QUIZ_STONES) {
        await u.click(gemRow("พลอยบน (เม็ดหลัก)").getByRole("radio", { name: a.labelTh }));
        await u.click(gemRow("พลอยล่าง (เม็ดเสริม)").getByRole("radio", { name: b.labelTh }));
        const text = container.textContent ?? "";
        const exact = GEM_QUIZ_PAIRS.find((p) => p.gems.includes(a.code) && p.gems.includes(b.code) && a.code !== b.code);
        const shown = GEM_QUIZ_PAIRS.filter((p) => text.includes(p.title));
        if (exact) {
          withPair++;
          expect(shown).toEqual([exact]);
          expect(text).not.toContain("คู่นี้ยังไม่มีคำอธิบายเฉพาะคู่");
        } else {
          expect(shown).toEqual([]); // ห้ามมีข้อความคู่ใดๆ
          if (a.code === b.code) expect(text).toContain(`${a.labelTh} ทั้ง 2 เม็ด`);
          else {
            expect(text).toContain(a.keywords);
            expect(text).toContain(b.keywords);
            expect(text).toContain("คู่นี้ยังไม่มีคำอธิบายเฉพาะคู่ แสดงคำอธิบายรายเม็ดแทน");
          }
        }
        // Y3: ราคาเดียว 800 ทุกคู่
        expect([...lineMessage().matchAll(/(\d[\d,]*)\s*บาท/g)].map((m) => m[1])).toEqual(["800"]);
        expect(text).not.toContain("เพชร");
        expect(text).not.toMatch(/undefined|NaN|\[object/);
      }
    expect(withPair).toBe(10);
  }, 60000);
  it("d=own + c → เริ่มที่เลือกเอง · d=own ไม่มี c → แบบแนะนำ", () => {
    const { unmount } = render(<RingShowcaseClient params={{ ...QUIZ, own: { top: "peridot", bottom: "amethyst" }, design: "own" }} />);
    expect(modeRadio("เลือกพลอยเอง")).toHaveAttribute("aria-checked", "true");
    expect(lineMessage()).toContain("พลอยบน: เพอริดอท · พลอยล่าง: อเมทิสต์");
    unmount();
    render(<RingShowcaseClient params={{ ...QUIZ, design: "own" }} />);
    expect(modeRadio("แบบแนะนำ")).toHaveAttribute("aria-checked", "true");
  });
  it("เปลี่ยนเรื่องระหว่างมี own → กลับแบบแนะนำ · own คงเดิม", async () => {
    const u = user();
    render(<RingShowcaseClient params={{ ...QUIZ, own: { top: "peridot", bottom: "amethyst" }, design: "own" }} />);
    await u.click(modeRadio("แบบแนะนำ"));
    await u.click(screen.getByRole("button", { name: "เปลี่ยน" }));
    await u.click(screen.getByRole("radio", { name: "ความมั่นใจ & พลังใจ" }));
    expect(window.location.search).toContain("c=peridot.amethyst");
    expect(window.location.search).toContain("i=confidence");
  });
});

describe("page: key ใหม่ผ่าน page จริง · ราคาเปลี่ยนจาก param ไม่ได้ (Y3)", () => {
  it("?price=1&c=...&d=own ไม่เปลี่ยนราคา · c ผิดรูปถูกทิ้ง", async () => {
    const el = await RingShowcasePage({ searchParams: Promise.resolve({ price: "1", c: "garnet.citrine", d: "own" }) });
    render(el);
    expect(lineMessage()).toContain("ราคา 800 บาท");
    cleanup();
    const bad = await RingShowcasePage({ searchParams: Promise.resolve({ c: "cz_white.garnet", d: "own", t: "x", i: "<b>" }) });
    const { container } = render(bad);
    expect(modeRadio("แบบแนะนำ")).toHaveAttribute("aria-checked", "true");
    expect(container.innerHTML).not.toContain("<b>");
  });
});
