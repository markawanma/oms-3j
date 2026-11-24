// @vitest-environment jsdom
// รูปจริงต่อแบบ (20 พ.ย. 69): ทุกแบบมีรูป · รูปไม่ปนข้ามแบบ · ไม่อยู่ใน public/ · alt ไม่แต่งมุมที่ไม่รู้ · ไม่ mock _assets (ข้อมูลจริง)
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { DESIGNS, getShowcaseDesign, type ShowcaseDesignId } from "@/lib/ring-builder/showcase/designs";
import { EMPTY_SHOWCASE_PARAMS } from "@/lib/ring-builder/showcase/quiz-link";
import { SHOWCASE_PHOTOS } from "./_assets";
import { photoAlt } from "./_components/PhotoGallery";
import { formatPriceThb } from "@/lib/ring-builder/showcase/config";
import { RingShowcaseClient } from "./RingShowcaseClient";

afterEach(cleanup);
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null as never);
  window.history.replaceState(null, "", "/ring-builder");
  Element.prototype.scrollIntoView = vi.fn();
});

const ASSETS = join(process.cwd(), "app", "(quiz)", "ring-builder", "_assets");
const NEW_SEVEN: ShowcaseDesignId[] = ["trinity", "scroll6", "channel4", "channel6", "bar7", "small7", "solitaire"];

describe("รูปจริงต่อแบบ", () => {
  it("ทุกแบบมีรูป ≥1 · 7 แบบใหม่ (รวมเม็ดเดี่ยว) 4 รูป/แบบ · ไขว้ 5 รูป", () => {
    for (const d of DESIGNS) expect(SHOWCASE_PHOTOS[d.id].length).toBeGreaterThanOrEqual(1);
    for (const id of NEW_SEVEN) expect(SHOWCASE_PHOTOS[id]).toHaveLength(4);
    expect(SHOWCASE_PHOTOS.bypass2).toHaveLength(5);
  });
  it("รูปของแบบหนึ่งไม่ปนแบบอื่น (src ไม่ซ้ำข้ามแบบ) + มีมิติ", () => {
    const seen = new Map<string, ShowcaseDesignId>();
    for (const d of DESIGNS) {
      for (const p of SHOWCASE_PHOTOS[d.id]) {
        expect(seen.has(p.src), `${p.src} ซ้ำระหว่าง ${seen.get(p.src)} กับ ${d.id}`).toBe(false);
        seen.set(p.src, d.id);
        expect(p.width).toBeGreaterThan(0);
        expect(p.height).toBeGreaterThan(0);
      }
    }
  });
  it("ไฟล์อยู่ใน _assets ตามชื่อ <designId>-n.jpg · ไม่มีรูปใน public/ring-builder · ขนาด ≤ 60KB/รูป", () => {
    for (const id of NEW_SEVEN) for (let n = 1; n <= 4; n++) {
      const f = join(ASSETS, `${id}-${n}.jpg`);
      expect(existsSync(f), f).toBe(true);
      expect(statSync(f).size).toBeLessThan(60 * 1024);
    }
    expect(readdirSync(ASSETS).filter((f) => f.endsWith(".jpg"))).toHaveLength(33); // ไขว้ 5 + อีก 7 แบบ x 4
    expect(existsSync(join(process.cwd(), "public", "ring-builder"))).toBe(false);
  });
  it("alt: ไขว้มีชื่อมุม · แบบอื่นใช้ 'ภาพถ่ายจริง <ชื่อแบบ> รูปที่ n' ไม่แต่งมุม", () => {
    expect(photoAlt("X", 0, 5, ["มุมบน"])).toBe("X รูปที่ 1 จาก 5 — มุมบน");
    expect(photoAlt("แหวน TRINITY 3 เม็ด", 1, 4)).toBe("ภาพถ่ายจริง แหวน TRINITY 3 เม็ด รูปที่ 2 จาก 4");
  });
  it("หน้าของแต่ละแบบ: stage + แกลเลอรี เห็นเฉพาะรูปของแบบนั้น · ไม่มีการ์ด 'ยังไม่มีรูปถ่ายจริง'", async () => {
    const u = userEvent.setup();
    const { container } = render(<RingShowcaseClient params={EMPTY_SHOWCASE_PARAMS} />);
    for (const d of DESIGNS) {
      await u.click(screen.getByRole("radio", { name: `${getShowcaseDesign(d.id).name} ${formatPriceThb(d.id)}` }));
      const own = SHOWCASE_PHOTOS[d.id].map((p) => p.src);
      const others = DESIGNS.filter((x) => x.id !== d.id).flatMap((x) => SHOWCASE_PHOTOS[x.id].map((p) => p.src));
      const imgs = [...container.querySelectorAll("img")].map((i) => i.getAttribute("src") ?? "");
      expect(imgs).toHaveLength(own.length + 1); // stage (WebGL ไม่มี = รูปแรก) + แกลเลอรี
      expect(imgs.every((s) => own.includes(s))).toBe(true);
      for (const s of others) expect(container.innerHTML).not.toContain(s);
      expect(screen.queryByText("แบบนี้ยังไม่มีรูปถ่ายจริง")).toBeNull();
      const gallery = screen.getByRole("region", { name: "ดูของจริง" });
      expect(within(gallery).getAllByRole("img")).toHaveLength(own.length);
      if (d.id !== "bypass2") {
        for (const im of within(gallery).getAllByRole("img")) expect(im.getAttribute("alt")).toMatch(new RegExp(`^ภาพถ่ายจริง ${d.name} รูปที่ [0-9] จาก 4$`));
      }
    }
  });
});
