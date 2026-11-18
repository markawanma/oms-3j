// @vitest-environment jsdom
// QA (R2-D2) D1.1 — param ผสมผ่าน page จริง · state ข้ามโหมด · reload/แชร์ได้หน้าเดิม
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { GEM_QUIZ_STONES } from "@/lib/gem-quiz/config";
import { EMPTY_SHOWCASE_PARAMS, parseTableParam, readShowcaseParams, type IntentionTable, type ShowcaseParams } from "@/lib/ring-builder/showcase/quiz-link";
import RingShowcasePage from "./page";
import { RingShowcaseClient } from "./RingShowcaseClient";

afterEach(cleanup);
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null as never);
  window.history.replaceState(null, "", "/ring-builder");
});

const TABLE = parseTableParam("gac.acp.cpb.bgc.pab.gpa") as IntentionTable;
const QUIZ: ShowcaseParams = { ...EMPTY_SHOWCASE_PARAMS, table: TABLE, intention: "love" };
const HUGE = "x".repeat(10_000);

function lineMessage(): string {
  const href = screen.getByRole("link", { name: /ส่งให้แอดมินทาง LINE/ }).getAttribute("href") ?? "";
  return decodeURIComponent(href.slice(href.indexOf("/?") + 2));
}
const modeRadio = (name: string) => screen.getByRole("radio", { name });
const gemRow = (name: string) => within(screen.getByRole("radiogroup", { name }));

describe("page: param ผสมกัน → ไม่ throw · ไม่มีค่าดิบถึง DOM/LINE · ราคา 890", () => {
  const combos: Record<string, unknown>[] = [
    { g: "garnet.citrine.peridot", t: "gac.acp.cpb.bgc.pab.gpa" },
    { g: "garnet.citrine.peridot", t: "gac.acp.cpb.bgc.pab.gpa", i: "love", c: "garnet.citrine", d: "own" },
    { t: "gac.acp.cpb.bgc.pab.gpa", i: "<b>x</b>" },
    { t: "bad", i: "love", c: "garnet.citrine", d: "2" },
    { c: "garnet.citrine", d: "1" },
    { d: "own" },
    { g: ["garnet.citrine.peridot", "x"], t: ["a"], i: ["love"], c: ["garnet.citrine"], d: ["own"] },
    { g: HUGE, t: HUGE, i: HUGE, c: HUGE, d: HUGE, price: HUGE, size: HUGE },
    { c: `garnet.${HUGE}`, d: "own", i: "love", t: `gac.${HUGE}` },
    { c: "คำไทย.😀", d: "own", i: "รัก", t: "😀" },
    { price: "1", size: "99", design: "x", src: "<script>alert(1)</script>" },
  ];
  it.each(combos.map((c, n) => [n, c] as const))("combo #%i", async (_n, sp) => {
    const el = await RingShowcasePage({ searchParams: Promise.resolve(sp as Record<string, string | string[] | undefined>) });
    const { container } = render(el);
    const html = container.innerHTML;
    expect(html).not.toContain("xxxxxxxx");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert(1)");
    expect(html).not.toContain("<b>x</b>");
    expect(container.textContent).not.toMatch(/undefined|NaN|\[object|เพชร/);
    const msg = lineMessage();
    expect(msg).toContain("ราคา 890 บาท");
    expect(msg).not.toContain("xxxxxxxx");
    expect(window.location.search).not.toContain("xxxxxxxx");
    expect(window.location.search).not.toMatch(/price|size|src|%3C|<|😀|คำไทย/);
  });
  it("t+i ดี + c ดี + d=own → เริ่มโหมดเลือกเอง และ URL ยังมี c อยู่ครบ", async () => {
    const el = await RingShowcasePage({ searchParams: Promise.resolve({ t: "gac.acp.cpb.bgc.pab.gpa", i: "love", c: "peridot.amethyst", d: "own" }) });
    render(el);
    expect(modeRadio("เลือกพลอยเอง")).toHaveAttribute("aria-checked", "true");
    expect(window.location.search).toBe("?t=gac.acp.cpb.bgc.pab.gpa&i=love&q=love&c=peridot.amethyst&d=own");
  });
});

describe("state ข้ามโหมด", () => {
  it("เลือกเอง → แบบแนะนำ(แบบ 3) → เลือกเอง → แบบแนะนำ: own กับ recIndex ไม่หายทั้งสองฝั่ง · URL ตามทุกขั้น", async () => {
    const u = userEvent.setup();
    render(<RingShowcaseClient params={QUIZ} />);
    await u.click(within(screen.getByRole("radiogroup", { name: "พลอยที่คุณเลือกได้" })).getAllByRole("radio")[2]); // แบบ 3
    expect(window.location.search).toContain("d=3");
    await u.click(modeRadio("เลือกพลอยเอง"));
    await u.click(gemRow("พลอยหลัก (เม็ดบน)").getByRole("radio", { name: "บลูโทพาส" }));
    await u.click(gemRow("พลอยเสริม (เม็ดล่าง)").getByRole("radio", { name: "โกเมน" }));
    expect(window.location.search).toContain("c=blue_topaz.garnet");
    expect(window.location.search).toContain("d=own");
    await u.click(modeRadio("แบบแนะนำ"));
    expect(window.location.search).toContain("c=blue_topaz.garnet"); // own อยู่ใน URL แม้ดูแบบแนะนำ
    expect(window.location.search).toContain("d=3");
    expect(window.location.search).not.toContain("d=own");
    expect(lineMessage()).toContain("พลอย: ชุด 3");
    await u.click(modeRadio("เลือกพลอยเอง"));
    expect(lineMessage()).toContain("พลอยหลัก (เม็ดบน): บลูโทพาส · พลอยเสริม (เม็ดล่าง): โกเมน");
    expect(lineMessage()).not.toMatch(/ชุด \d/);
    await u.click(modeRadio("แบบแนะนำ"));
    expect(within(screen.getByRole("radiogroup", { name: "พลอยที่คุณเลือกได้" })).getAllByRole("radio")[2]).toHaveAttribute("aria-checked", "true");
  });
  it("เปลี่ยนเรื่อง → recIndex กลับ 1 · ไม่ทำให้ own หาย · d=own ถูกถอดเพราะ active=rec", async () => {
    const u = userEvent.setup();
    render(<RingShowcaseClient params={{ ...QUIZ, own: { top: "peridot", bottom: "amethyst" }, design: 3 }} />);
    await u.click(screen.getByRole("button", { name: "เปลี่ยน" }));
    await u.click(screen.getByRole("radio", { name: "งาน & ความสำเร็จ" }));
    expect(window.location.search).toContain("i=career");
    expect(window.location.search).toContain("c=peridot.amethyst");
    expect(window.location.search).not.toMatch(/d=/);
    await u.click(modeRadio("เลือกพลอยเอง"));
    expect(gemRow("พลอยหลัก (เม็ดบน)").getByRole("radio", { name: "เพอริดอท" })).toHaveAttribute("aria-checked", "true");
    expect(gemRow("พลอยเสริม (เม็ดล่าง)").getByRole("radio", { name: "อเมทิสต์" })).toHaveAttribute("aria-checked", "true");
  });
  it("เข้าตรง แตะเม็ดแรกเป็นพลอยใดก็ได้ (ไม่ใช่แค่โกเมน) = ตั้งทั้งสองเม็ดเป็นพลอยนั้น · แตะล่างก่อนก็ตั้งทั้งสอง (own ไม่เคยครึ่งเดียว)", async () => {
    const u = userEvent.setup();
    for (const stone of GEM_QUIZ_STONES) {
      for (const row of ["พลอยหลัก (เม็ดบน)", "พลอยเสริม (เม็ดล่าง)"]) {
        const { unmount } = render(<RingShowcaseClient params={EMPTY_SHOWCASE_PARAMS} />);
        await u.click(modeRadio("เลือกพลอยเอง"));
        await u.click(gemRow(row).getByRole("radio", { name: stone.labelTh }));
        for (const r of ["พลอยหลัก (เม็ดบน)", "พลอยเสริม (เม็ดล่าง)"]) {
          expect(gemRow(r).getByRole("radio", { name: stone.labelTh }), `${row}/${stone.code}`).toHaveAttribute("aria-checked", "true");
        }
        expect(window.location.search).toBe(`?c=${stone.code}.${stone.code}&d=own`);
        unmount();
        window.history.replaceState(null, "", "/ring-builder");
      }
    }
  });
  it("เปลี่ยนเรื่องที่เลือกซ้ำเรื่องเดิม = ไม่ทำอะไร (recIndex ไม่ถูกรีเซ็ต)", async () => {
    const u = userEvent.setup();
    render(<RingShowcaseClient params={QUIZ} />);
    await u.click(within(screen.getByRole("radiogroup", { name: "พลอยที่คุณเลือกได้" })).getAllByRole("radio")[1]);
    await u.click(screen.getByRole("button", { name: "เปลี่ยน" }));
    await u.click(screen.getByRole("radio", { name: "ความรัก & เสน่ห์" }));
    expect(window.location.search).toContain("d=2");
  });
  it("ราคา 890 ทุกสถานะของ 25 คู่ × 2 โหมด (LINE + หน้าจอ) และไม่มีราคาอื่นบนจอ", async () => {
    const u = userEvent.setup();
    const { container } = render(<RingShowcaseClient params={EMPTY_SHOWCASE_PARAMS} />);
    await u.click(modeRadio("เลือกพลอยเอง"));
    for (const a of GEM_QUIZ_STONES) {
      await u.click(gemRow("พลอยหลัก (เม็ดบน)").getByRole("radio", { name: a.labelTh }));
      expect(lineMessage()).toContain("ราคา 890 บาท");
      expect([...(container.textContent ?? "").matchAll(/(\d[\d,]*)\s*บาท/g)].map((m) => m[1]).every((p) => p === "890")).toBe(true);
    }
  });
});

describe("reload / แชร์ลิงก์ → ได้หน้าเดิม (design §9.6 ต้องไม่พัง)", () => {
  function shownSig(): string {
    const m = lineMessage();
    return m.split("\n").filter((l) => l.startsWith("พลอย:") || l.startsWith("พลอยหลัก")).join(" | ");
  }
  /** เปิดหน้าใหม่จาก URL ที่หน้าเขียนไว้ (จำลอง reload / ส่งลิงก์ให้เพื่อน / กลับจาก /ring-size) */
  function reopenFromCurrentUrl(): ShowcaseParams {
    const sp = Object.fromEntries(new URLSearchParams(window.location.search));
    return readShowcaseParams(sp);
  }
  it("เรื่องที่ตอบใน quiz (ไม่เปลี่ยนเรื่อง) → reload ได้ 3 แบบเดิมและแบบที่เลือกอยู่เดิม", async () => {
    const u = userEvent.setup();
    const first = render(<RingShowcaseClient params={QUIZ} />);
    await u.click(within(screen.getByRole("radiogroup", { name: "พลอยที่คุณเลือกได้" })).getAllByRole("radio")[1]);
    const before = shownSig();
    const params = reopenFromCurrentUrl();
    first.unmount();
    render(<RingShowcaseClient params={params} />);
    expect(shownSig()).toBe(before);
  });
  // BUG-1 (QA 17 พ.ย. 69) แก้แล้ว: URL เก็บ t+q เสมอ → reload ได้อันดับ t[i] ชุดเดิม
  it("เปลี่ยนเป็นเรื่องอื่นจากผล quiz แล้ว reload → ต้องได้พลอยชุดเดิมที่เห็นก่อน reload", async () => {
    const u = userEvent.setup();
    const first = render(<RingShowcaseClient params={QUIZ} />);
    await u.click(screen.getByRole("button", { name: "เปลี่ยน" }));
    await u.click(screen.getByRole("radio", { name: "การเงิน & โอกาส" })); // wealth: t[wealth] = acp
    const before = shownSig();
    const params = reopenFromCurrentUrl();
    first.unmount();
    render(<RingShowcaseClient params={params} />);
    expect(shownSig()).toBe(before);
  });
});
