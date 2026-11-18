// @vitest-environment jsdom
// D1.2a: เลือกพลอยรายเม็ดในโหมด "เลือกพลอยเอง" ของแบบแถว 3–7 เม็ด (UX "D1.2a เลือกรายเม็ด")
// ไขว้ 2 เม็ดคงเดิม (2 แถวบน/ล่าง · URL byte เดิม) · จำสีต่อจำนวนเม็ด · ห้ามมีคำหลัก/เสริมในโหมดรายเม็ด · ราคา 890 ตัวเดียว
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { getShowcaseDesign, ownSlotCount, type ShowcaseDesignId } from "@/lib/ring-builder/showcase/designs";
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

const designRadio = (id: ShowcaseDesignId) => screen.getByRole("radio", { name: getShowcaseDesign(id).name });
const modeRadio = (name: string) => screen.getByRole("radio", { name });
const slotBar = () => screen.getByRole("radiogroup", { name: "เลือกพลอยทีละเม็ด" });
const slot = (n: number) => within(slotBar()).getByRole("radio", { name: new RegExp(`^เม็ดที่ ${n} `) });
const gem = (n: number, name: string) => within(screen.getByRole("radiogroup", { name: `เลือกพลอยให้เม็ดที่ ${n}` })).getByRole("radio", { name });
function lineMessage(): string {
  const href = screen.getByRole("link", { name: /ส่งให้แอดมินทาง LINE/ }).getAttribute("href") ?? "";
  return decodeURIComponent(href.slice(href.indexOf("/?") + 2));
}
const url = () => `${window.location.pathname}${window.location.search}`;
const ROW_COPY_BANNED = /พลอยหลัก|พลอยเสริม/;

async function openOwn(u: ReturnType<typeof user>, id: ShowcaseDesignId, params: ShowcaseParams = EMPTY_SHOWCASE_PARAMS) {
  render(<RingShowcaseClient params={{ ...params, ring: id }} />);
  await u.click(modeRadio("เลือกพลอยเอง"));
}

describe("D1.2a — แถบเม็ด + เลือกทีละเม็ด", () => {
  it("แบบแถวทุกแบบ: แถบ N ช่อง ตามจำนวนเม็ด · เริ่มที่เม็ดที่ 1 · ไม่มีคำหลัก/เสริมในแผงเลือกเอง", async () => {
    for (const id of ["trinity", "channel4", "scroll6", "channel6", "bar7", "small7"] as ShowcaseDesignId[]) {
      cleanup();
      const u = user();
      await openOwn(u, id);
      const radios = within(slotBar()).getAllByRole("radio");
      expect(radios).toHaveLength(ownSlotCount(getShowcaseDesign(id)));
      expect(radios[0]).toHaveAttribute("aria-checked", "true");
      expect(screen.getByText("เลือกพลอยทีละเม็ด · ราคาเท่ากันไม่ว่าจะเลือกกี่สี")).toBeInTheDocument();
      expect(screen.getByText("นับจากซ้ายไปขวา เมื่อมองตรงหน้าแหวน")).toBeInTheDocument();
      expect(screen.getByText("แตะพลอยหนึ่งชนิดเพื่อใส่ทุกเม็ดก่อน แล้วแตะเลขเม็ดเพื่อเปลี่ยนทีละเม็ด")).toBeInTheDocument();
      expect(document.body.textContent ?? "").not.toMatch(ROW_COPY_BANNED); // ไม่มี "พลอยหลัก"/"พลอยเสริม" ทั้งหน้า
    }
  });
  it("แตะพลอยครั้งแรกตอนว่าง = ใส่ทุกเม็ด · แตะเลขเม็ดแล้วเปลี่ยนเฉพาะเม็ดนั้น · ไม่เลื่อนเม็ดเอง · LINE จับกลุ่มช่วง", async () => {
    const u = user();
    await openOwn(u, "bar7");
    await u.click(gem(1, "โกเมน"));
    expect(slot(3)).toHaveAccessibleName("เม็ดที่ 3 โกเมน");
    expect(lineMessage()).toContain("เม็ด 1–7: โกเมน (ทุกเม็ด)");
    await u.click(slot(4));
    expect(slot(4)).toHaveAttribute("aria-checked", "true");
    await u.click(gem(4, "ซิทริน"));
    expect(slot(4)).toHaveAttribute("aria-checked", "true"); // ไม่เลื่อนไปเม็ดถัดไป
    expect(slot(4)).toHaveAccessibleName("เม็ดที่ 4 ซิทริน");
    expect(slot(5)).toHaveAccessibleName("เม็ดที่ 5 โกเมน");
    const msg = lineMessage();
    expect(msg).toContain("พลอย: เลือกพลอยเอง (รายเม็ด · ซ้ายไปขวา มองตรงหน้าแหวน)");
    expect(msg).toContain("เม็ด 1–3: โกเมน\nเม็ด 4: ซิทริน\nเม็ด 5–7: โกเมน");
    expect(msg.match(/\d[\d,]*\s*บาท/g)).toEqual(["890 บาท"]);
    expect(msg).not.toMatch(/หลัก|เสริม|เพชร|ชุด \d/);
    expect(screen.getByRole("heading", { name: "เม็ดที่ 4 · ซิทริน" })).toBeInTheDocument();
    expect(screen.getAllByRole("status").some((el) => el.textContent === "เม็ดที่ 4 เป็นซิทรินแล้ว")).toBe(true);
  });
  it("คีย์บอร์ด: ลูกศรบนแถบย้ายเม็ดที่แก้ (roving) · Home/End", async () => {
    const u = user();
    await openOwn(u, "channel4");
    slot(1).focus();
    await u.keyboard("{ArrowRight}");
    expect(slot(2)).toHaveAttribute("aria-checked", "true");
    expect(slot(2)).toHaveFocus();
    await u.keyboard("{End}");
    expect(slot(4)).toHaveAttribute("aria-checked", "true");
    await u.keyboard("{ArrowRight}");
    expect(slot(1)).toHaveAttribute("aria-checked", "true");
  });
  it("'ใส่ X ทุกเม็ด': ซ่อนเมื่อทุกเม็ดเป็นสีนั้นแล้ว · กดแล้วมี 'เลิกทำ' คืนค่าเดิม · แก้อย่างอื่น = เลิกทำหาย", async () => {
    const u = user();
    await openOwn(u, "scroll6");
    await u.click(gem(1, "โกเมน"));
    expect(screen.queryByRole("button", { name: /ทุกเม็ด$/ })).toBeNull();
    await u.click(slot(2));
    await u.click(gem(2, "อเมทิสต์"));
    await u.click(screen.getByRole("button", { name: "ใส่อเมทิสต์ทุกเม็ด" }));
    expect(slot(6)).toHaveAccessibleName("เม็ดที่ 6 อเมทิสต์");
    expect(screen.getByRole("button", { name: "เลิกทำ" })).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "เลิกทำ" }));
    expect(slot(6)).toHaveAccessibleName("เม็ดที่ 6 โกเมน");
    expect(slot(2)).toHaveAccessibleName("เม็ดที่ 2 อเมทิสต์");
    expect(screen.queryByRole("button", { name: "เลิกทำ" })).toBeNull();
    await u.click(screen.getByRole("button", { name: "ใส่อเมทิสต์ทุกเม็ด" }));
    await u.click(gem(2, "ซิทริน"));
    expect(screen.queryByRole("button", { name: "เลิกทำ" })).toBeNull();
  });
  it("สลับถี่ (>4 ช่วง) → LINE เป็นบรรทัดเดียวเรียงทีละเม็ด", async () => {
    const u = user();
    await openOwn(u, "bar7");
    await u.click(gem(1, "โกเมน"));
    for (const n of [2, 4, 6]) {
      await u.click(slot(n));
      await u.click(gem(n, "อเมทิสต์"));
    }
    expect(lineMessage()).toContain("เม็ด 1–7 (ซ้ายไปขวา): โกเมน · อเมทิสต์ · โกเมน · อเมทิสต์ · โกเมน · อเมทิสต์ · โกเมน");
  });
});

describe("D1.2a — เปิดครั้งแรกจากชุดแนะนำ · สลับแบบ · จำสีต่อจำนวนเม็ด", () => {
  it("seed จากชุดที่ดูอยู่: เม็ดกลาง = พลอยหลัก ที่เหลือ = พลอยเสริม (ตรงกับที่เห็น)", async () => {
    const u = user();
    render(<RingShowcaseClient params={{ ...QUIZ, ring: "bar7" }} />);
    const recMsg = lineMessage();
    const main = /พลอยหลัก \(เม็ดกลาง\): (\S+)/.exec(recMsg)?.[1];
    const sub = /พลอยเสริม \(เม็ดข้าง\): (\S+)/.exec(recMsg)?.[1];
    expect(main && sub).toBeTruthy();
    await u.click(modeRadio("เลือกพลอยเอง"));
    expect(slot(4)).toHaveAccessibleName(`เม็ดที่ 4 ${main}`);
    for (const n of [1, 2, 3, 5, 6, 7]) expect(slot(n)).toHaveAccessibleName(`เม็ดที่ ${n} ${sub}`);
  });
  it("สลับ 7→4→7: สีเดิมกลับมา · 7→3 เก็บเม็ด 3–5 · ประกาศ 'ปรับพลอยให้พอดี' · ก้นหอย 6 = ฝังล็อค 6 ใช้ชุดเดียวกัน", async () => {
    const u = user();
    await openOwn(u, "bar7");
    await u.click(gem(1, "โกเมน"));
    await u.click(slot(1));
    await u.click(gem(1, "อเมทิสต์"));
    await u.click(slot(3));
    await u.click(gem(3, "ซิทริน"));
    await u.click(designRadio("channel4"));
    expect(within(slotBar()).getAllByRole("radio")).toHaveLength(4);
    // 7→4 เก็บเม็ด 2–5 = [โกเมน, ซิทริน, โกเมน, โกเมน]
    expect(slot(1)).toHaveAccessibleName("เม็ดที่ 1 โกเมน");
    expect(slot(2)).toHaveAccessibleName("เม็ดที่ 2 ซิทริน");
    expect(screen.getAllByRole("status").some((el) => /ปรับพลอยให้พอดี 4 เม็ด กลับไปแบบเดิมสีเดิมจะกลับมา/.test(el.textContent ?? ""))).toBe(true);
    await u.click(slot(1));
    await u.click(gem(1, "บลูโทพาส"));
    await u.click(designRadio("small7")); // 7 เม็ดเหมือนเตย → ชุดเดียวกัน
    expect(slot(1)).toHaveAccessibleName("เม็ดที่ 1 อเมทิสต์");
    expect(slot(3)).toHaveAccessibleName("เม็ดที่ 3 ซิทริน");
    await u.click(designRadio("trinity")); // 7→3 เก็บเม็ด 3–5 = [ซิทริน, โกเมน, โกเมน]
    expect(slot(1)).toHaveAccessibleName("เม็ดที่ 1 ซิทริน");
    expect(slot(3)).toHaveAccessibleName("เม็ดที่ 3 โกเมน");
    await u.click(designRadio("channel6"));
    await u.click(slot(1));
    await u.click(gem(1, "เพอริดอท"));
    await u.click(designRadio("scroll6"));
    expect(slot(1)).toHaveAccessibleName("เม็ดที่ 1 เพอริดอท");
    await u.click(designRadio("bar7"));
    expect(slot(1)).toHaveAccessibleName("เม็ดที่ 1 อเมทิสต์"); // กลับมาจำนวนเดิม สีเดิมเป๊ะ
  });
  it("เม็ดที่แก้อยู่เกินจำนวนใหม่ → ขยับไปเม็ดสุดท้าย · ทุกคู่แบบ: จำนวนช่องในแถบ = จำนวนเม็ดของแบบเสมอ", async () => {
    const u = user();
    await openOwn(u, "bar7");
    await u.click(gem(1, "โกเมน"));
    await u.click(slot(7));
    await u.click(designRadio("trinity"));
    expect(slot(3)).toHaveAttribute("aria-checked", "true");
    for (const id of ["bar7", "channel4", "scroll6", "trinity", "small7", "channel6"] as ShowcaseDesignId[]) {
      await u.click(designRadio(id));
      expect(within(slotBar()).getAllByRole("radio")).toHaveLength(ownSlotCount(getShowcaseDesign(id)));
      expect(lineMessage()).toMatch(/เม็ด 1–\d: /);
    }
  });
  it("ไขว้ → แถว: กลาง = สีบน ที่เหลือ = สีล่าง · กลับไขว้ = สี บน/ล่าง เดิมที่จำไว้ (ไม่ fit ทับ)", async () => {
    const u = user();
    render(<RingShowcaseClient params={EMPTY_SHOWCASE_PARAMS} />);
    await u.click(modeRadio("เลือกพลอยเอง"));
    await u.click(within(screen.getByRole("radiogroup", { name: "พลอยหลัก (เม็ดบน)" })).getByRole("radio", { name: "โกเมน" }));
    await u.click(within(screen.getByRole("radiogroup", { name: "พลอยเสริม (เม็ดล่าง)" })).getByRole("radio", { name: "ซิทริน" }));
    await u.click(designRadio("bar7"));
    expect(slot(4)).toHaveAccessibleName("เม็ดที่ 4 โกเมน");
    expect(slot(1)).toHaveAccessibleName("เม็ดที่ 1 ซิทริน");
    await u.click(slot(1));
    await u.click(gem(1, "อเมทิสต์"));
    await u.click(designRadio("bypass2"));
    expect(within(screen.getByRole("radiogroup", { name: "พลอยหลัก (เม็ดบน)" })).getByRole("radio", { name: "โกเมน" })).toHaveAttribute("aria-checked", "true");
    expect(within(screen.getByRole("radiogroup", { name: "พลอยเสริม (เม็ดล่าง)" })).getByRole("radio", { name: "ซิทริน" })).toHaveAttribute("aria-checked", "true");
    expect(url()).toBe("/ring-builder?c=garnet.citrine&d=own");
  });
  it("แถว → ไขว้ ครั้งแรก: บน = เม็ดกลาง · ล่าง = เม็ดที่ 1", async () => {
    const u = user();
    render(<RingShowcaseClient params={readShowcaseParams({ c: "a.c.p.b.g.a.c", d: "own", r: "bar7" })} />);
    await u.click(designRadio("bypass2"));
    expect(within(screen.getByRole("radiogroup", { name: "พลอยหลัก (เม็ดบน)" })).getByRole("radio", { name: "บลูโทพาส" })).toHaveAttribute("aria-checked", "true");
    expect(within(screen.getByRole("radiogroup", { name: "พลอยเสริม (เม็ดล่าง)" })).getByRole("radio", { name: "อเมทิสต์" })).toHaveAttribute("aria-checked", "true");
    expect(url()).toBe("/ring-builder?c=blue_topaz.amethyst&d=own");
  });
  it("ไขว้ own: ไม่มีแถบเม็ด (2 แถวเดิม) · URL byte เดิม", async () => {
    const u = user();
    render(<RingShowcaseClient params={EMPTY_SHOWCASE_PARAMS} />);
    await u.click(modeRadio("เลือกพลอยเอง"));
    expect(screen.queryByRole("radiogroup", { name: "เลือกพลอยทีละเม็ด" })).toBeNull();
    expect(screen.getByText("เม็ดบน = พลอยหลัก · เม็ดล่าง = พลอยเสริม · CZ เล็ก 2 เม็ดมาพร้อมแหวน")).toBeInTheDocument();
    await u.click(within(screen.getByRole("radiogroup", { name: "พลอยหลัก (เม็ดบน)" })).getByRole("radio", { name: "โกเมน" }));
    expect(url()).toBe("/ring-builder?c=garnet.garnet&d=own");
  });
});

describe("D1.2a — URL + reload", () => {
  it("เขียน c=N ตัวอักษร ซ้าย→ขวา ตามจำนวนเม็ด · reload (อ่านกลับ) คงสีรายเม็ดและเปิดโหมดเลือกเอง", async () => {
    const u = user();
    await openOwn(u, "channel4");
    await u.click(gem(1, "โกเมน"));
    await u.click(slot(3));
    await u.click(gem(3, "บลูโทพาส"));
    expect(url()).toBe("/ring-builder?c=g.g.b.g&d=own&r=channel4");
    cleanup();
    const params = readShowcaseParams(Object.fromEntries(new URL(url(), "https://x.test").searchParams));
    render(<RingShowcaseClient params={params} />);
    expect(modeRadio("เลือกพลอยเอง")).toHaveAttribute("aria-checked", "true");
    expect(slot(3)).toHaveAccessibleName("เม็ดที่ 3 บลูโทพาส");
    expect(slot(2)).toHaveAccessibleName("เม็ดที่ 2 โกเมน");
    expect(lineMessage()).toContain("เม็ด 1–2: โกเมน\nเม็ด 3: บลูโทพาส\nเม็ด 4: โกเมน");
  });
  it("URL ของแบบแนะนำ/ไขว้ ไม่มี c · ลิงก์ preview D1.2 (c 2 ตัว + r แถว + d=own) เปิดแล้วขยายตามกฎ", async () => {
    render(<RingShowcaseClient params={readShowcaseParams({ c: "garnet.amethyst", d: "own", r: "bar7" })} />);
    expect(modeRadio("เลือกพลอยเอง")).toHaveAttribute("aria-checked", "true");
    expect(slot(4)).toHaveAccessibleName("เม็ดที่ 4 โกเมน");
    expect(slot(1)).toHaveAccessibleName("เม็ดที่ 1 อเมทิสต์");
  });
  it("c ปลอม (จำนวนไม่ตรง/ตัวใหญ่/นอก whitelist) + d=own → ไม่ crash · ยังไม่เลือก (แถบว่าง · LINE 'ยังไม่ได้เลือกพลอยสี')", () => {
    for (const c of ["g.a.c", "G.A.C.P.B.G.A", "g.a.c.p.b.g.q", "x".repeat(80)]) {
      cleanup();
      render(<RingShowcaseClient params={readShowcaseParams({ c, d: "own", r: "bar7" })} />);
      // d=own ที่ไม่มีชุดสี → กลับไปแบบแนะนำ (เหมือนลิงก์ own ที่ c เสีย)
      expect(modeRadio("แบบแนะนำ")).toHaveAttribute("aria-checked", "true");
    }
  });
  it("ยังไม่เลือก (เข้าตรง → เลือกเอง): แถบเป็นวงว่าง · สรุป/LINE ไม่มีหลัก/เสริม", async () => {
    const u = user();
    await openOwn(u, "bar7");
    for (let n = 1; n <= 7; n++) expect(slot(n)).toHaveAccessibleName(`เม็ดที่ ${n} ยังไม่เลือก`);
    expect(lineMessage()).toContain("ยังไม่ได้เลือกพลอยสี");
    expect(lineMessage()).not.toMatch(/หลัก|เสริม/);
    expect(document.body.textContent ?? "").not.toMatch(ROW_COPY_BANNED);
  });
});

describe("D1.2a — ต้องไม่พัง", () => {
  it("โหมดแบบแนะนำของแบบแถว: เหมือนเดิม (พลอยหลัก/เสริม + ชุด n) · ป้าย 'จากแบบทดสอบ' ยังอยู่", () => {
    render(<RingShowcaseClient params={{ ...QUIZ, ring: "bar7", answered: "love" }} />);
    expect(lineMessage()).toMatch(/พลอย: ชุด 1\nพลอยหลัก \(เม็ดกลาง\): .+ · พลอยเสริม \(เม็ดข้าง\): /);
    expect(screen.getAllByText(/จากแบบทดสอบ/).length).toBeGreaterThan(0);
  });
  it("ราคา 890 ตัวเดียวในหน้า เมื่ออยู่โหมดรายเม็ด (ไม่มีราคาต่อเม็ด)", async () => {
    const u = user();
    await openOwn(u, "small7");
    await u.click(gem(1, "ซิทริน"));
    const prices = document.body.textContent?.match(/\d[\d,]*\s*บาท/g) ?? [];
    expect(new Set(prices)).toEqual(new Set(["890 บาท"]));
  });
});
