// @vitest-environment jsdom
// D1.2 (design-ring-showcase-multi.md §11): เลือก 7 แบบแหวน · Z2 ไซซ์ข้ามแบบ · Z3 ราคา 890 ตัวเดียว · Z4 ลิงก์/คำต้องห้าม · Z6 รูปไม่ข้ามแบบ · Z10 บน/ล่าง · ชุด n · URL `r` · empty state รูป
// เครื่องไม่มี WebGL (getContext = null) → stage ตกเป็นรูปจริง/ภาพประกอบ — ฝั่ง 3D จริงอยู่ RingShowcase.stage3d.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { DESIGNS, getShowcaseDesign, type ShowcaseDesignId } from "@/lib/ring-builder/showcase/designs";
import { EMPTY_SHOWCASE_PARAMS, parseTableParam, type IntentionTable, type ShowcaseParams } from "@/lib/ring-builder/showcase/quiz-link";
import type { LastMeasuredSize } from "@/lib/ring-builder/last-size";
import { SHOWCASE_PHOTOS } from "./_assets";

// ทดสอบกลไก "แบบที่ยังไม่มีรูป" (empty state / ไม่ข้ามแบบ Z6) — ตอนนี้ทุกแบบมีรูปจริงแล้ว จึงจำลองให้ 6 แบบแถวไม่มีรูป
// รูปจริงของทุกแบบทดสอบแยกที่ RingShowcase.photos.test.tsx (ไม่ mock)
vi.mock("./_assets", async (orig) => {
  const m = await orig<typeof import("./_assets")>();
  return { ...m, SHOWCASE_PHOTOS: { ...m.SHOWCASE_PHOTOS, trinity: [], scroll6: [], channel4: [], channel6: [], bar7: [], small7: [] } };
});
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
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null as never);
  window.history.replaceState(null, "", "/ring-builder");
  Element.prototype.scrollIntoView = vi.fn();
});

const TABLE = parseTableParam("gac.acp.cpb.bgc.pab.gpa") as IntentionTable;
const QUIZ: ShowcaseParams = { ...EMPTY_SHOWCASE_PARAMS, table: TABLE, intention: "love" };
const user = () => userEvent.setup();

function lineHref(): string {
  return screen.getByRole("link", { name: /ส่งให้แอดมินทาง LINE/ }).getAttribute("href") ?? "";
}
function lineMessage(): string {
  const href = lineHref();
  return decodeURIComponent(href.slice(href.indexOf("/?") + 2));
}
const designRadio = (id: ShowcaseDesignId) => screen.getByRole("radio", { name: getShowcaseDesign(id).name });
const designGroup = () => screen.getByRole("radiogroup", { name: "เลือกแบบแหวน" });
const sizeGroup = () => screen.getByRole("radiogroup", { name: /^เลือกไซซ์/ });
const modeRadio = (name: string) => screen.getByRole("radio", { name });

describe("DesignPicker", () => {
  it("7 radio เรียงตามแบบ · ไขว้ถูกเลือกเริ่มต้น · roving tabindex · ปัดดู 7 แบบ", () => {
    render(<RingShowcaseClient params={EMPTY_SHOWCASE_PARAMS} />);
    const radios = within(designGroup()).getAllByRole("radio");
    expect(radios).toHaveLength(7);
    expect(radios.map((r) => r.getAttribute("aria-label"))).toEqual(DESIGNS.map((d) => d.name));
    expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual(["true", "false", "false", "false", "false", "false", "false"]);
    expect(radios.map((r) => r.getAttribute("tabindex"))).toEqual(["0", "-1", "-1", "-1", "-1", "-1", "-1"]);
    expect(screen.getByText("ปัดดูทั้ง 7 แบบ")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("แหวนพลอยของ 3J Jewelry");
  });
  it("คีย์บอร์ด: ลูกศร/Home/End เลือก+โฟกัส · เรียก scrollIntoView เมื่อโฟกัสย้าย", async () => {
    const u = user();
    render(<RingShowcaseClient params={EMPTY_SHOWCASE_PARAMS} />);
    const radios = within(designGroup()).getAllByRole("radio");
    radios[0].focus();
    await u.keyboard("{ArrowRight}");
    expect(radios[1]).toHaveAttribute("aria-checked", "true");
    expect(radios[1]).toHaveFocus();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    await u.keyboard("{End}");
    expect(radios[6]).toHaveAttribute("aria-checked", "true");
    await u.keyboard("{ArrowRight}");
    expect(radios[0]).toHaveAttribute("aria-checked", "true"); // วนรอบ
    await u.keyboard("{ArrowLeft}");
    expect(radios[6]).toHaveAttribute("aria-checked", "true");
    await u.keyboard("{Home}");
    expect(radios[0]).toHaveAttribute("aria-checked", "true");
  });
  it("ประกาศ SR เมื่อเปลี่ยนแบบ (role=status)", async () => {
    const u = user();
    render(<RingShowcaseClient params={EMPTY_SHOWCASE_PARAMS} />);
    await u.click(designRadio("channel4"));
    expect(screen.getAllByRole("status").some((el) => el.textContent === "เลือกแบบ แหวนฝังล็อค 4 เม็ด แล้ว")).toBe(true);
  });
  it("r ใน URL → เปิดที่แบบนั้น (ไซซ์ 50–60 ครบ 11 ปุ่ม) · r ผิด/ไม่มี = ไขว้ (55–58)", () => {
    const { unmount } = render(<RingShowcaseClient params={{ ...EMPTY_SHOWCASE_PARAMS, ring: "small7" }} />);
    expect(designRadio("small7")).toHaveAttribute("aria-checked", "true");
    expect(within(sizeGroup()).getAllByRole("radio").map((r) => r.textContent)).toEqual(["50", "51", "52", "53", "54", "55", "56", "57", "58", "59", "60"]);
    expect(sizeGroup()).toHaveAccessibleName("เลือกไซซ์ (ช่วง 50–60)");
    unmount();
    render(<RingShowcaseClient params={EMPTY_SHOWCASE_PARAMS} />);
    expect(within(sizeGroup()).getAllByRole("radio").map((r) => r.textContent)).toEqual(["55", "56", "57", "58"]);
  });
});

describe("เปลี่ยนแบบ — ข้อความตามแบบ + พลอยไม่หาย", () => {
  it("ป้ายตำแหน่ง/บรรทัดอธิบาย/เลือกเอง เปลี่ยนตามแบบ (ไขว้ บน/ล่าง → แถว เม็ดกลาง/เม็ดข้าง → ฝังล็อค 2 เม็ดกลาง)", async () => {
    const u = user();
    render(<RingShowcaseClient params={QUIZ} />);
    expect(screen.getByText("เม็ดบน = พลอยหลัก · เม็ดล่าง = พลอยเสริม · CZ เล็ก 2 เม็ดมาพร้อมแหวน")).toBeInTheDocument();
    await u.click(designRadio("bar7"));
    expect(screen.getByText("เม็ดกลาง = พลอยหลัก · เม็ดข้างที่เหลือ = พลอยเสริม")).toBeInTheDocument();
    await u.click(modeRadio("เลือกพลอยเอง"));
    // D1.2a: แบบแถว + เลือกเอง = รายเม็ด (แถบเม็ด 1..N) แทน 2 แถวหลัก/เสริม
    expect(within(screen.getByRole("radiogroup", { name: "เลือกพลอยทีละเม็ด" })).getAllByRole("radio")).toHaveLength(7);
    expect(screen.queryByRole("radiogroup", { name: "พลอยหลัก (เม็ดกลาง)" })).toBeNull();
    await u.click(designRadio("channel6"));
    expect(within(screen.getByRole("radiogroup", { name: "เลือกพลอยทีละเม็ด" })).getAllByRole("radio")).toHaveLength(6);
    expect(screen.getByText("เลือกพลอยทีละเม็ด · ราคาเท่ากันไม่ว่าจะเลือกกี่สี")).toBeInTheDocument();
    expect(screen.queryByText("เม็ดกลาง 2 เม็ด = พลอยหลัก · เม็ดข้างที่เหลือ = พลอยเสริม")).toBeNull();
  });
  it("เลือกพลอยเองแล้วสลับแบบ → พลอยคงเดิม · เลือกชนิดเดียวกัน 'ทุกเม็ด' (ไม่ใช่ 'ทั้ง 2 เม็ด')", async () => {
    const u = user();
    render(<RingShowcaseClient params={EMPTY_SHOWCASE_PARAMS} />);
    await u.click(modeRadio("เลือกพลอยเอง"));
    await u.click(within(screen.getByRole("radiogroup", { name: "พลอยหลัก (เม็ดบน)" })).getByRole("radio", { name: "โกเมน" }));
    await u.click(designRadio("small7"));
    // D1.2a: ไขว้ [โกเมน, โกเมน] → แถว 7 เม็ด = โกเมนทุกเม็ด
    expect(within(screen.getByRole("radiogroup", { name: "เลือกพลอยให้เม็ดที่ 1" })).getByRole("radio", { name: "โกเมน" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("โกเมน ทุกเม็ด")).toBeInTheDocument();
    expect(lineMessage()).toContain("เม็ด 1–7: โกเมน (ทุกเม็ด)");
  });
  it("ชุดแนะนำคงเดิมข้ามแบบ (ชุด 2 แล้วสลับแบบ ยังเป็นชุด 2)", async () => {
    const u = user();
    render(<RingShowcaseClient params={QUIZ} />);
    await u.click(within(screen.getByRole("radiogroup", { name: "พลอยที่คุณเลือกได้" })).getAllByRole("radio")[1]);
    await u.click(designRadio("scroll6"));
    expect(lineMessage()).toContain("พลอย: ชุด 2");
    expect(lineMessage()).toContain("แบบแหวน: แหวนก้นหอย 6 เม็ด");
    expect(within(screen.getByRole("radiogroup", { name: "พลอยที่คุณเลือกได้" })).getAllByRole("radio")[1]).toHaveAttribute("aria-checked", "true");
  });
  it("URL: r เขียนเฉพาะที่ไม่ใช่ไขว้ ต่อท้ายสุด · กลับไขว้ = URL เดิม byte-for-byte", async () => {
    const u = user();
    render(<RingShowcaseClient params={QUIZ} />);
    const original = window.location.search;
    expect(original).not.toContain("r=");
    await u.click(designRadio("channel4"));
    expect(window.location.search).toBe(`${original}&r=channel4`);
    await u.click(designRadio("bypass2"));
    expect(window.location.search).toBe(original); // กลับไขว้ = byte เดิม
    await u.click(designRadio("channel4"));
    await u.click(modeRadio("เลือกพลอยเอง"));
    expect(window.location.search.endsWith("&d=own&r=channel4")).toBe(true); // r ต่อท้ายสุดต่อจาก c/d
    await u.click(designRadio("bypass2"));
    expect(window.location.search).not.toContain("r=");
  });
});

describe("Z2 — ไซซ์ข้ามแบบ (effectiveSize)", () => {
  it("เลือก 50 บน TRINITY → สลับไขว้: ไม่มีปุ่มถูกเลือก · มีแถบอธิบาย · LINE 'รอแอดมินช่วยเช็ก' ไม่มี 50 · สลับกลับ = ไซซ์กลับมาเอง", async () => {
    const u = user();
    render(<RingShowcaseClient params={EMPTY_SHOWCASE_PARAMS} />);
    await u.click(designRadio("trinity"));
    await u.click(screen.getByRole("radio", { name: "เบอร์ 50" }));
    expect(lineMessage()).toContain("ไซซ์: เบอร์ 50");

    await u.click(designRadio("bypass2"));
    expect(within(sizeGroup()).getAllByRole("radio").every((r) => r.getAttribute("aria-checked") === "false")).toBe(true);
    expect(screen.getByText("ไซซ์ 50 ใช้กับแบบนี้ไม่ได้ (แบบนี้มีไซซ์ 55–58) · เลือกไซซ์ใหม่ หรือส่งข้อความแล้วแจ้งไซซ์กับแอดมินทาง LINE ได้")).toBeInTheDocument();
    expect(screen.getAllByRole("status").some((el) => el.textContent?.includes("ไซซ์ 50 ที่เลือกไว้ใช้กับแบบนี้ไม่ได้"))).toBe(true);
    const msg = lineMessage();
    expect(msg).toContain("ไซซ์: รอแอดมินช่วยเช็ก");
    expect(msg).not.toMatch(/เบอร์ 50|ไซซ์: เบอร์/);
    expect(decodeURIComponent(lineHref())).not.toContain("50");
    const summary = screen.getByRole("heading", { name: "สรุปที่เลือก" }).parentElement as HTMLElement;
    expect(within(summary).getByText("รอแอดมินช่วยเช็ก")).toBeInTheDocument();
    expect(screen.getByText(/ยังไม่ได้เลือกไซซ์/)).toBeInTheDocument(); // แถบเหลืองเดิม

    await u.click(designRadio("trinity"));
    expect(screen.getByRole("radio", { name: "เบอร์ 50" })).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByText(/ใช้กับแบบนี้ไม่ได้/)).toBeNull();
    expect(lineMessage()).toContain("ไซซ์: เบอร์ 50");
  });
  it("ไซซ์ที่ใช้ได้ทั้งสองแบบ (56) คงเดิมข้ามแบบ · กดไซซ์ใหม่ตอนนอกช่วง = ทับค่าเดิม", async () => {
    const u = user();
    render(<RingShowcaseClient params={EMPTY_SHOWCASE_PARAMS} />);
    await u.click(screen.getByRole("radio", { name: "เบอร์ 56" }));
    await u.click(designRadio("channel6"));
    expect(screen.getByRole("radio", { name: "เบอร์ 56" })).toHaveAttribute("aria-checked", "true");
    await u.click(screen.getByRole("radio", { name: "เบอร์ 52" }));
    await u.click(designRadio("bypass2"));
    expect(screen.getByText(/ไซซ์ 52 ใช้กับแบบนี้ไม่ได้/)).toBeInTheDocument();
    await u.click(screen.getByRole("radio", { name: "เบอร์ 57" })); // ทับ 52
    expect(screen.queryByText(/^ไซซ์ 52 ใช้กับแบบนี้ไม่ได้/)).toBeNull();
    await u.click(designRadio("channel6"));
    expect(screen.getByRole("radio", { name: "เบอร์ 57" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "เบอร์ 52" })).toHaveAttribute("aria-checked", "false");
  });
  it("ไซซ์ขอบ 50/60 (แถว) · 55/58 (ไขว้) ส่ง LINE ได้ทุกแบบ", async () => {
    const u = user();
    render(<RingShowcaseClient params={EMPTY_SHOWCASE_PARAMS} />);
    for (const d of DESIGNS) {
      await u.click(designRadio(d.id));
      for (const s of [d.sizes[0], d.sizes[d.sizes.length - 1]]) {
        await u.click(screen.getByRole("radio", { name: `เบอร์ ${s}` }));
        expect(lineMessage()).toContain(`ไซซ์: เบอร์ ${s}`);
      }
    }
  });
  it("ผลวัดล่าสุดเทียบกับช่วงของ 'แบบที่เลือกอยู่' (52 ใช้ได้กับแถว ไม่ได้กับไขว้)", async () => {
    lastSizeMock.read.mockReturnValue({ size: 52, method: "A", savedAt: 1, inShopRange: true });
    const u = user();
    render(<RingShowcaseClient params={EMPTY_SHOWCASE_PARAMS} />);
    expect(await screen.findByText("ผลวัดล่าสุด: เบอร์ 52")).toBeInTheDocument();
    expect(screen.getByText("ไซซ์นี้อยู่นอกช่วงของแบบนี้ ทักแอดมินได้")).toBeInTheDocument();
    await u.click(designRadio("bar7"));
    expect(screen.getByRole("button", { name: "ใช้เบอร์ 52" })).toBeInTheDocument();
  });
});

describe("ทุกแบบ × ทุกโหมด — Z3 Z4 Z10 (DOM จริง)", () => {
  it("ราคา 890 ค่าเดียวทั้งจอและ LINE · ไม่มีคำว่าเพชร · ลิงก์ออกได้แค่ LINE/ring-size/gem-quiz", async () => {
    const u = user();
    const { container } = render(<RingShowcaseClient params={QUIZ} />);
    for (const d of DESIGNS) {
      await u.click(designRadio(d.id));
      for (const mode of ["แบบแนะนำ", "เลือกพลอยเอง"]) {
        await u.click(modeRadio(mode));
        const text = container.textContent ?? "";
        expect([...text.matchAll(/(\d[\d,]*)\s*บาท/g)].map((m) => m[1]).every((p) => p === "890")).toBe(true);
        expect([...lineMessage().matchAll(/(\d[\d,]*)\s*บาท/g)].map((m) => m[1])).toEqual(["890"]);
        expect(text).not.toMatch(/เพชร|undefined|NaN|\[object/);
        const hrefs = [...container.querySelectorAll("a[href]")].map((a) => a.getAttribute("href") ?? "");
        // P3: "/" = ลิงก์กลับหน้ารวมเครื่องมือ (ToolsHubLink) — ต้องมีตัวเดียวเท่านั้น (ไม่ใช่ prefix/origin อื่น)
        for (const h of hrefs) expect(h === "/" || h === "/ring-size" || h === "/gem-quiz" || h.startsWith("https://line.me/R/oaMessage/")).toBe(true);
        expect(hrefs.filter((h) => h === "/")).toHaveLength(1);
      }
    }
  });
  it("Z10: แบบแถวไม่มี 'บน/ล่าง' ในจอและ LINE · 'ทั้ง 2 เม็ด' ไม่โผล่ที่ใดเลย · 'ชุด n' ตอนเลือกเองไม่โผล่ (การ์ดชุด/บรรทัดพลอย)", async () => {
    const u = user();
    const { container } = render(<RingShowcaseClient params={QUIZ} />);
    for (const d of DESIGNS.filter((x) => x.layout.kind === "row")) {
      await u.click(designRadio(d.id));
      await u.click(modeRadio("แบบแนะนำ"));
      let text = container.textContent ?? "";
      expect(text).not.toMatch(/เม็ดบน|เม็ดล่าง|พลอยบน|พลอยล่าง|ทั้ง 2 เม็ด/);
      expect(lineMessage()).not.toMatch(/เม็ดบน|เม็ดล่าง|พลอยบน|พลอยล่าง|ทั้ง 2 เม็ด/);
      expect(text).toMatch(/ชุด 1/);
      expect(text).not.toMatch(/CZ เล็ก/); // ไม่มี CZ เล็กในแบบแถว (ทั้ง placementNote และ czNote)
      expect(text).not.toContain("CZ คือคิวบิกเซอร์โคเนีย");
      await u.click(modeRadio("เลือกพลอยเอง"));
      text = container.textContent ?? "";
      expect(text).not.toMatch(/เม็ดบน|เม็ดล่าง|พลอยบน|พลอยล่าง|ทั้ง 2 เม็ด/);
      expect(text).not.toMatch(/ชุด \d/);
      expect(lineMessage()).not.toMatch(/ชุด \d/);
      expect(lineMessage()).toContain("พลอย: เลือกพลอยเอง");
    }
  });
  it("ไขว้: ยังมีประโยค CZ เล็ก 2 เม็ด + czNote · แบบแถวไม่มี", async () => {
    const u = user();
    const { container } = render(<RingShowcaseClient params={EMPTY_SHOWCASE_PARAMS} />);
    expect(container.textContent).toContain("CZ คือคิวบิกเซอร์โคเนีย");
    expect(lineMessage()).toContain("CZ เล็ก 2 เม็ด");
    await u.click(designRadio("trinity"));
    expect(container.textContent).not.toContain("CZ คือคิวบิกเซอร์โคเนีย");
    expect(lineMessage()).not.toContain("CZ เล็ก");
  });
  it("การ์ดสรุปของแต่ละแบบ: แบบแหวน/พลอยหลัก/พลอยเสริม ตรงกับ designs.ts", async () => {
    const u = user();
    render(<RingShowcaseClient params={QUIZ} />);
    for (const d of DESIGNS) {
      await u.click(designRadio(d.id));
      const summary = screen.getByRole("heading", { name: "สรุปที่เลือก" }).parentElement as HTMLElement;
      expect(within(summary).getByText(d.name)).toBeInTheDocument();
      expect(within(summary).getByText(`พลอยหลัก (${d.positions.main})`)).toBeInTheDocument();
      expect(within(summary).getByText(`พลอยเสริม (${d.positions.sub})`)).toBeInTheDocument();
      expect(within(summary).queryByText("CZ เล็ก") !== null).toBe(d.extraCz > 0);
    }
  });
});

describe("Z6 — รูปจริงไม่ข้ามแบบ + empty state", () => {
  const BYPASS_SRCS = SHOWCASE_PHOTOS.bypass2.map((p) => p.src);
  it("แบบไขว้: stage ใช้รูปแรกของไขว้ (WebGL ไม่มี) + แกลเลอรี 5 รูป · มี photosNote", () => {
    const { container } = render(<RingShowcaseClient params={EMPTY_SHOWCASE_PARAMS} />);
    const imgs = [...container.querySelectorAll("img")].map((i) => i.getAttribute("src"));
    expect(imgs).toHaveLength(6);
    expect(imgs.every((s) => BYPASS_SRCS.includes(s ?? ""))).toBe(true);
    expect(screen.getByText(/ภาพถ่ายเป็นตัวอย่างแหวนชิ้นหนึ่ง/)).toBeInTheDocument();
  });
  it("6 แบบที่ไม่มีรูป: ไม่มี <img> เลยทั้งหน้า · stage = ภาพประกอบ + ป้าย 'ไม่ใช่ภาพจริง' + ข้อความ · gallery = การ์ดบอกตรงๆ · ไม่มี photosNote/ปุ่มสไลด์", async () => {
    const u = user();
    const { container } = render(<RingShowcaseClient params={EMPTY_SHOWCASE_PARAMS} />);
    for (const d of DESIGNS.filter((x) => x.id !== "bypass2")) {
      await u.click(designRadio(d.id));
      expect(container.querySelectorAll("img")).toHaveLength(0);
      for (const src of BYPASS_SRCS) expect(container.innerHTML).not.toContain(src);
      const stage = screen.getByRole("region", { name: "ภาพแหวน" });
      expect(await within(stage).findByText(/เครื่องนี้แสดงภาพ 3 มิติไม่ได้ · แบบนี้ยังไม่มีรูปถ่ายจริง/)).toBeInTheDocument();
      expect(within(stage).getByText("ภาพประกอบตำแหน่งเม็ด ไม่ใช่ภาพจริง")).toBeInTheDocument();
      expect(within(stage).queryByText(/ดูรูปจริงด้านล่างแทน/)).toBeNull();
      expect(screen.getByRole("heading", { name: "ดูของจริง" })).toBeInTheDocument();
      expect(screen.getByText("แบบนี้ยังไม่มีรูปถ่ายจริง")).toBeInTheDocument();
      expect(screen.getByText("ภาพด้านบนเป็นภาพจำลอง 3 มิติ สีและรายละเอียดของชิ้นจริงอาจต่างจากภาพ")).toBeInTheDocument();
      expect(screen.queryByText(/ภาพถ่ายเป็นตัวอย่างแหวนชิ้นหนึ่ง/)).toBeNull();
      expect(screen.queryByRole("button", { name: "รูปถัดไป" })).toBeNull();
      expect(screen.queryByRole("region", { name: "ดูของจริง" })).toBeNull();
    }
    // กลับไขว้ → รูปกลับมา
    await u.click(designRadio("bypass2"));
    expect(container.querySelectorAll("img")).toHaveLength(6);
  });
  it("pictogram ใน chip: aria-hidden · ไม่ใช้รูปถ่ายเป็น thumbnail", () => {
    render(<RingShowcaseClient params={EMPTY_SHOWCASE_PARAMS} />);
    const group = designGroup();
    expect(group.querySelectorAll("img")).toHaveLength(0);
    const svgs = group.querySelectorAll("svg[aria-hidden='true']");
    expect(svgs.length).toBeGreaterThanOrEqual(7);
    // ทึบ = พลอยหลัก: ฝังล็อค 4 มี 2 จุดทึบ · TRINITY มี 1 · เตย 7 มี 1
    const filled = (id: ShowcaseDesignId) => [...designRadio(id).querySelectorAll("circle")].filter((c) => c.getAttribute("fill") === "currentColor").length;
    expect(filled("channel4")).toBe(2);
    expect(filled("trinity")).toBe(1);
    expect(filled("bar7")).toBe(1);
    expect(designRadio("scroll6").querySelectorAll("circle")).toHaveLength(6);
    expect(designRadio("small7").querySelectorAll("circle")).toHaveLength(7);
  });
});
