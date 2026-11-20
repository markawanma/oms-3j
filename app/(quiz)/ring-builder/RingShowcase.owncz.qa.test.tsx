// @vitest-environment jsdom
// QA own-cz: ปุ่ม "กลับเป็น CZ ขาวทั้งหมด" · เลิกทำ · "ใส่ CZ ขาวทุกเม็ด" · คำอธิบาย · สลับแบบ · reload
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { getShowcaseDesign, type ShowcaseDesignId } from "@/lib/ring-builder/showcase/designs";
import { EMPTY_SHOWCASE_PARAMS, readShowcaseParams, type ShowcaseParams } from "@/lib/ring-builder/showcase/quiz-link";
import { RingShowcaseClient } from "./RingShowcaseClient";

afterEach(cleanup);
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null as never);
  window.history.replaceState(null, "", "/ring-builder");
  Element.prototype.scrollIntoView = vi.fn();
});

const modeRadio = (name: string) => screen.getByRole("radio", { name });
const designRadio = (id: ShowcaseDesignId) => screen.getByRole("radio", { name: getShowcaseDesign(id).name });
const slotBar = () => screen.getByRole("radiogroup", { name: "เลือกพลอยทีละเม็ด" });
const slot = (n: number) => within(slotBar()).getByRole("radio", { name: new RegExp(`^เม็ดที่ ${n} `) });
const gem = (n: number, name: string) => within(screen.getByRole("radiogroup", { name: `เลือกพลอยให้เม็ดที่ ${n}` })).getByRole("radio", { name });
const RESET = "กลับเป็น CZ ขาวทั้งหมด";
const url = () => `${window.location.pathname}${window.location.search}`;
function lineMessage(): string {
  const href = screen.getByRole("link", { name: /ส่งให้แอดมินทาง LINE/ }).getAttribute("href") ?? "";
  return decodeURIComponent(href.slice(href.indexOf("/?") + 2));
}
async function openOwn(id: ShowcaseDesignId, params: ShowcaseParams = EMPTY_SHOWCASE_PARAMS) {
  const u = userEvent.setup();
  render(<RingShowcaseClient params={{ ...params, ring: id }} />);
  await u.click(modeRadio("เลือกพลอยเอง"));
  return u;
}

describe("QA own-cz - UI", () => {
  it("CZ ขาวเป็นตัวเลือกที่ 6 ท้ายแถว · 5 ตำแหน่งเดิมไม่ขยับ", async () => {
    await openOwn("bar7");
    const names = within(screen.getByRole("radiogroup", { name: "เลือกพลอยให้เม็ดที่ 1" })).getAllByRole("radio").map((r) => r.getAttribute("aria-label"));
    expect(names).toHaveLength(6);
    expect(names[5]).toBe("CZ ขาว");
    expect(names.slice(0, 5)).not.toContain("CZ ขาว");
  });
  it("ปุ่มรีเซ็ต: ซ่อนตอนยังไม่เลือก + ตอนทุกเม็ด CZ · โผล่เมื่อมีเม็ดไม่ใช่ CZ · กด = CZ ทุกเม็ด + เลิกทำคืนค่า", async () => {
    const u = await openOwn("scroll6");
    expect(screen.queryByRole("button", { name: RESET })).toBeNull();
    await u.click(gem(1, "โกเมน"));
    await u.click(slot(3));
    await u.click(gem(3, "อเมทิสต์"));
    expect(screen.getByRole("button", { name: RESET })).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: RESET }));
    for (let i = 1; i <= 6; i++) expect(slot(i)).toHaveAccessibleName(`เม็ดที่ ${i} CZ ขาว`);
    expect(screen.queryByRole("button", { name: RESET })).toBeNull();
    expect(lineMessage()).toContain("เม็ด 1–6: CZ ขาวทุกเม็ด");
    expect(url()).toContain("c=z.z.z.z.z.z");
    await u.click(screen.getByRole("button", { name: "เลิกทำ" }));
    expect(slot(1)).toHaveAccessibleName("เม็ดที่ 1 โกเมน");
    expect(slot(3)).toHaveAccessibleName("เม็ดที่ 3 อเมทิสต์");
    expect(screen.getByRole("button", { name: RESET })).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: RESET }));
    expect(screen.queryByRole("button", { name: RESET })).toBeNull();
  });
  it("แตะ CZ ก่อนอย่างอื่น = ใส่ CZ ทุกเม็ด · แล้วแก้ทีละเม็ด · 'ใส่ CZ ขาวทุกเม็ด' ทำงาน", async () => {
    const u = await openOwn("channel4");
    await u.click(gem(1, "CZ ขาว"));
    for (let i = 1; i <= 4; i++) expect(slot(i)).toHaveAccessibleName(`เม็ดที่ ${i} CZ ขาว`);
    expect(screen.queryByRole("button", { name: RESET })).toBeNull();
    expect(screen.queryByRole("button", { name: "ใส่ CZ ขาวทุกเม็ด" })).toBeNull();
    await u.click(slot(2));
    await u.click(gem(2, "โกเมน"));
    await u.click(slot(4));
    await u.click(gem(4, "CZ ขาว"));
    await u.click(screen.getByRole("button", { name: "ใส่ CZ ขาวทุกเม็ด" }));
    for (let i = 1; i <= 4; i++) expect(slot(i)).toHaveAccessibleName(`เม็ดที่ ${i} CZ ขาว`);
    expect(screen.getAllByRole("status").some((el) => el.textContent === "ใส่ CZ ขาวทุกเม็ดแล้ว")).toBe(true);
  });
  it("คำอธิบาย: CZ ล้วน = ไม่มีการ์ดคำอธิบาย/ข้อความแนะนำ · โกเมน+CZ = โกเมนตัวเดียว ไม่มีความหมายของ CZ", async () => {
    const u = await openOwn("bar7");
    await u.click(gem(1, "CZ ขาว"));
    expect(screen.queryByText("แตะพลอยหนึ่งชนิดเพื่อใส่ทุกเม็ดก่อน แล้วแตะเลขเม็ดเพื่อเปลี่ยนทีละเม็ด")).toBeNull();
    await u.click(slot(2));
    await u.click(gem(2, "โกเมน"));
    expect(screen.getAllByText("โกเมน").length).toBeGreaterThan(0);
    expect(screen.queryByText("โกเมน ทุกเม็ด")).toBeNull();
    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/เพชร|พลอยหลัก|พลอยเสริม/);
  });
  it("สลับแบบ แถว↔แถว↔ไขว้: CZ คงข้ามแถว · ไปไขว้ส่ง CZ ต่อ (รหัสเต็ม cz ไม่ใช่ z) · กลับแถวได้ค่าเดิม", async () => {
    const u = await openOwn("bar7");
    await u.click(gem(1, "โกเมน"));
    await u.click(slot(3));
    await u.click(gem(3, "CZ ขาว"));
    await u.click(designRadio("channel4"));
    expect(url()).toMatch(/c=[gz.]+/);
    await u.click(designRadio("bypass2"));
    // แถว 4 เม็ด [โกเมน, CZ... ] → ไขว้: บน = เม็ดกลางตัวแรก (เม็ด 2) · ล่าง = เม็ด 1 = โกเมน · URL ใช้รหัสเต็ม ไม่ใช่ตัวอักษร z
    expect(url()).toMatch(/c=[a-z_]+\.[a-z_]+&/);
    expect(url()).not.toMatch(/c=[^&]*z/);
    await u.click(designRadio("bar7"));
    expect(slot(3)).toHaveAccessibleName("เม็ดที่ 3 CZ ขาว");
    expect(slot(1)).toHaveAccessibleName("เม็ดที่ 1 โกเมน");
  });
  it("แถว CZ ล้วน → ไขว้ ไม่ crash → กลับแถว CZ ล้วนคงเดิม", async () => {
    const u = await openOwn("trinity");
    await u.click(gem(1, "CZ ขาว"));
    await u.click(designRadio("bypass2"));
    expect(screen.getByRole("link", { name: /ส่งให้แอดมินทาง LINE/ })).toBeInTheDocument();
    expect(url()).toContain("c=cz.cz");
    await u.click(designRadio("trinity"));
    expect(slot(1)).toHaveAccessibleName("เม็ดที่ 1 CZ ขาว");
  });
  it("ไขว้: CZ ขาวเป็นตัวเลือกที่ 6 ทั้งบนและล่าง · 5 ตำแหน่งเดิมไม่ขยับ", async () => {
    await openOwn("bypass2");
    const cz = screen.getAllByRole("radio", { name: "CZ ขาว" });
    expect(cz).toHaveLength(2);
    for (const g of screen.getAllByRole("radiogroup").filter((x) => within(x).queryByRole("radio", { name: "โกเมน" }))) {
      const names = within(g).getAllByRole("radio").map((r) => r.getAttribute("aria-label"));
      expect(names).toHaveLength(6);
      expect(names[5]).toBe("CZ ขาว");
    }
  });
  it("ไขว้: เลือก CZ บน/ล่าง · URL = รหัสเต็ม · LINE/สรุป ชัดเจน 890 ไม่มีเพชร · CZ ล้วนไม่มีการ์ดคำอธิบาย · รีเซ็ต + เลิกทำ", async () => {
    const u = await openOwn("bypass2");
    const [topCz, bottomCz] = screen.getAllByRole("radio", { name: "CZ ขาว" });
    const [topGarnet, bottomGarnet] = screen.getAllByRole("radio", { name: "โกเมน" });
    expect(screen.queryByRole("button", { name: RESET })).toBeNull();
    await u.click(topGarnet);
    await u.click(bottomCz);
    expect(url()).toContain("c=garnet.cz");
    let msg = lineMessage();
    expect(msg).toContain("พลอยหลัก (เม็ดบน): โกเมน");
    expect(msg).toContain("พลอยเสริม (เม็ดล่าง): CZ ขาว");
    expect(msg).toContain("890");
    expect(msg).not.toContain("เพชร");
    // โกเมน+CZ = คำอธิบายโกเมนตัวเดียว (ไม่ใช่ "ทั้งสองเม็ด")
    expect(screen.queryByText(/โกเมน ทุกเม็ด/)).toBeNull();
    await u.click(topCz);
    expect(url()).toContain("c=cz.cz");
    msg = lineMessage();
    expect(msg).toContain("พลอยหลัก (เม็ดบน): CZ ขาว");
    expect(msg).toContain("พลอยเสริม (เม็ดล่าง): CZ ขาว");
    expect(msg).not.toContain("เพชร");
    expect(screen.queryByRole("button", { name: RESET })).toBeNull();
    expect(screen.queryByText("แตะพลอยหลักก่อน ระบบใส่ชนิดเดียวกันให้พลอยเสริม แล้วเปลี่ยนได้")).toBeNull(); // CZ ล้วน ≠ ยังไม่เลือก
    await u.click(bottomGarnet);
    await u.click(screen.getByRole("button", { name: RESET }));
    expect(url()).toContain("c=cz.cz");
    expect(screen.queryByRole("button", { name: RESET })).toBeNull();
    await u.click(screen.getByRole("button", { name: "เลิกทำ" }));
    expect(url()).toContain("c=cz.garnet");
  });
  it("ไขว้ ↔ แถว: CZ ส่งต่อกันได้ ไม่ crash", async () => {
    const u = await openOwn("bypass2");
    await u.click(screen.getAllByRole("radio", { name: "CZ ขาว" })[0]);
    await u.click(screen.getAllByRole("radio", { name: "โกเมน" })[1]);
    expect(url()).toContain("c=cz.garnet");
    await u.click(designRadio("trinity"));
    // ไขว้→แถว: เม็ดกลาง = บน (CZ) · เม็ดข้าง = ล่าง (โกเมน)
    expect(slot(2)).toHaveAccessibleName("เม็ดที่ 2 CZ ขาว");
    expect(slot(1)).toHaveAccessibleName("เม็ดที่ 1 โกเมน");
    await u.click(designRadio("bypass2"));
    expect(url()).toContain("c=cz.garnet");
  });
});

describe("QA own-cz - reload + ลิงก์เสีย", () => {
  it("c มี z + d=own → แถบเม็ดตรง · LINE ตรง", () => {
    render(<RingShowcaseClient params={readShowcaseParams({ c: "g.z.z.a.z.z.g", d: "own", r: "bar7" })} />);
    expect(slot(2)).toHaveAccessibleName("เม็ดที่ 2 CZ ขาว");
    expect(slot(4)).toHaveAccessibleName("เม็ดที่ 4 อเมทิสต์");
    expect(lineMessage()).toContain("CZ ขาว");
  });
  it("c เสีย (z ตัวใหญ่/จำนวนไม่ตรง/cz) ไม่ crash · ไม่เขียนกลับ URL", () => {
    for (const c of ["g.Z.a.p.b.g.a", "z.z.z", "cz.cz.cz.cz.cz.cz.cz", "z".repeat(100)]) {
      cleanup();
      window.history.replaceState(null, "", "/ring-builder");
      render(<RingShowcaseClient params={readShowcaseParams({ c, d: "own", r: "bar7" })} />);
      expect(url()).not.toContain("Z");
      expect(url()).not.toContain("cz.cz");
    }
  });
  it("ลิงก์ไขว้: รหัสเต็มเดิมยังใช้ได้ · cz โหลดกลับถูก · ตัวอักษร z / CZ ตัวใหญ่ = ไม่เลือก ไม่ crash", () => {
    render(<RingShowcaseClient params={readShowcaseParams({ c: "garnet.amethyst", d: "own" })} />);
    expect(screen.getAllByRole("radio", { name: "โกเมน", checked: true })).toHaveLength(1);
    cleanup();
    window.history.replaceState(null, "", "/ring-builder");
    render(<RingShowcaseClient params={readShowcaseParams({ c: "cz.amethyst", d: "own" })} />);
    expect(screen.getAllByRole("radio", { name: "CZ ขาว", checked: true })).toHaveLength(1);
    expect(url()).toContain("c=cz.amethyst");
    for (const c of ["z.amethyst", "CZ.amethyst", "cz.cz.cz"]) {
      cleanup();
      window.history.replaceState(null, "", "/ring-builder");
      render(<RingShowcaseClient params={readShowcaseParams({ c, d: "own" })} />);
      expect(url()).not.toContain("c=");
    }
  });
  it("ลิงก์ D1.2 เดิม c=g.a (2 ตัว) บนแบบแถวยังขยายได้", () => {
    render(<RingShowcaseClient params={readShowcaseParams({ c: "g.a", d: "own", r: "bar7" })} />);
    expect(slot(1)).toHaveAccessibleName("เม็ดที่ 1 อเมทิสต์");
  });
});
