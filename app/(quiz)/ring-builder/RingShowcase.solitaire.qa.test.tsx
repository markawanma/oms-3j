// @vitest-environment jsdom
// QA (R2-D2) D1.3 — DOM ทุกแบบ (8) x (ไม่มี quiz / มี quiz): ราคานอกการ์ดเลือกแบบ = ราคาแบบนั้นค่าเดียว · ไม่มี "ทุกแบบ" · ลิงก์ ?price= ไม่มีผล · เม็ดเดี่ยวไม่มีคำต้องห้ามหลังคลิกพลอย
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { formatPriceThb } from "@/lib/ring-builder/showcase/config";
import { DESIGNS } from "@/lib/ring-builder/showcase/designs";
import { EMPTY_SHOWCASE_PARAMS, parseTableParam, readShowcaseParams, type IntentionTable } from "@/lib/ring-builder/showcase/quiz-link";
import { RingShowcaseClient } from "./RingShowcaseClient";

afterEach(cleanup);
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null as never);
  window.history.replaceState(null, "", "/ring-builder");
  Element.prototype.scrollIntoView = vi.fn();
});

const TABLE = parseTableParam("gac.acp.cpb.bgc.pab.gpa") as IntentionTable;
const prices = (t: string) => [...t.matchAll(/(\d[\d,]*)\s*บาท/g)].map((m) => `${m[1]} บาท`);
const outsidePicker = () => (document.body.textContent ?? "").replace(screen.getByRole("radiogroup", { name: "เลือกแบบแหวน" }).textContent ?? "", "");
const linkHref = () => screen.getByRole("link", { name: /ส่งให้แอดมินทาง LINE/ }).getAttribute("href") ?? "";

describe("QA DOM — ทุกแบบเริ่มจาก ?r=<id> (ลิงก์ตรง)", () => {
  for (const d of DESIGNS) {
    it(`${d.id}: ราคานอกการ์ด = ${formatPriceThb(d.id)} ค่าเดียว · ไม่มี ทุกแบบ · LINE ตรงราคา`, () => {
      for (const quiz of [false, true]) {
        const params = readShowcaseParams({ r: d.id, price: "1", p: "5", ...(quiz ? { t: "gac.acp.cpb.bgc.pab.gpa", i: "love" } : {}) });
        render(<RingShowcaseClient params={params} />);
        expect(new Set(prices(outsidePicker())), `${d.id} quiz=${quiz}`).toEqual(new Set([formatPriceThb(d.id)]));
        expect(document.body.textContent).not.toMatch(/บาท\s*ทุกแบบ|ทุกแบบ\s*\d/);
        expect(prices(decodeURIComponent(linkHref()))).toEqual([formatPriceThb(d.id)]);
        cleanup();
      }
    });
  }
  it("เม็ดเดี่ยวไม่มี quiz + ลิงก์ c=z / c=g: ไม่ crash · ไม่มีคำต้องห้าม", () => {
    for (const c of ["z", "g", "g.a", "__proto__"]) {
      render(<RingShowcaseClient params={readShowcaseParams({ r: "solitaire", d: "own", c })} />);
      expect(document.body.textContent, c).not.toMatch(/พลอยเสริม|ทุกเม็ด|เม็ดที่|เม็ด 1|ซ้ายไปขวา/);
      expect(prices(outsidePicker())).toEqual(expect.arrayContaining(["790 บาท"]));
      expect(prices(outsidePicker()).every((p) => p === "790 บาท")).toBe(true);
      cleanup();
    }
  });
  it("เม็ดเดี่ยว: ไม่มี quiz ผ่านค่าเริ่มต้น EMPTY (ไม่มี ?r) ยังเป็นไขว้ 890 · คลิกการ์ดเม็ดเดี่ยวแล้วราคาเป็น 790", async () => {
    const u = userEvent.setup();
    render(<RingShowcaseClient params={EMPTY_SHOWCASE_PARAMS} />);
    expect(new Set(prices(outsidePicker()))).toEqual(new Set(["890 บาท"]));
    await u.click(screen.getByRole("radio", { name: /เม็ดเดี่ยว \(1 เม็ด\) 790 บาท/ }));
    expect(new Set(prices(outsidePicker()))).toEqual(new Set(["790 บาท"]));
    expect(document.body.textContent).not.toMatch(/พลอยเสริม|ทุกเม็ด|ซ้ายไปขวา/);
    expect(TABLE).toBeTruthy();
  });
});
