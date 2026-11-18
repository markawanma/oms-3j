// @vitest-environment jsdom
// D1.2 P3 — stage + RingViewer กับ renderer ปลอม: สลับแบบ = setRing บน renderer เดิม (ไม่ remount ไม่สร้าง context ใหม่) · สีตามแบบ · โมเดลของแบบล้ม → fallback + ลองอีกครั้ง
// · context lost ของแบบไม่มีรูป (Z6) · WebGL ปลอมถูกจำลองที่ระดับโมดูล gl-renderer (ไม่ใช่ jsdom canvas)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { getShowcaseDesign, mainIndexes, type ShowcaseDesignId } from "@/lib/ring-builder/showcase/designs";
import { EMPTY_SHOWCASE_PARAMS } from "@/lib/ring-builder/showcase/quiz-link";
import type { GemTint } from "@/lib/ring-builder/viewer/gem-colors";
import { SHOWCASE_PHOTOS } from "./_assets";
import { RingShowcaseClient } from "./RingShowcaseClient";

const h = vi.hoisted(() => {
  const state = { opts: null as null | { onReady?: () => void; onUnsupported?: (r: string) => void }, failIds: new Set<string>() };
  const renderer = { setTints: vi.fn(), setRing: vi.fn(), resetView: vi.fn(), dispose: vi.fn() };
  const createRingRenderer = vi.fn((_canvas: unknown, _ring: unknown, opts: { onReady?: () => void; onUnsupported?: (r: string) => void }) => {
    state.opts = opts;
    opts.onReady?.();
    return renderer;
  });
  return { state, renderer, createRingRenderer };
});

vi.mock("@/lib/ring-builder/viewer/gl-renderer", () => ({
  isWebGLAvailable: () => true,
  createRingRenderer: h.createRingRenderer,
}));
// ทำให้ "สร้างโมเดลของแบบนี้ล้ม" จำลองได้ (ใช้ของจริงที่เหลือ)
vi.mock("@/lib/ring-builder/viewer/showcase-rings", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/ring-builder/viewer/showcase-rings")>();
  return {
    ...orig,
    getShowcaseRing: (id: string) => {
      if (h.state.failIds.has(id)) throw new Error(`boom ${id}`);
      return orig.getShowcaseRing(id as never);
    },
  };
});

afterEach(cleanup);
beforeEach(() => {
  h.createRingRenderer.mockClear();
  h.renderer.setTints.mockClear();
  h.renderer.setRing.mockClear();
  h.renderer.resetView.mockClear();
  h.renderer.dispose.mockClear();
  h.state.opts = null;
  h.state.failIds.clear();
  window.history.replaceState(null, "", "/ring-builder");
  Element.prototype.scrollIntoView = vi.fn();
});

const designRadio = (id: ShowcaseDesignId) => screen.getByRole("radio", { name: getShowcaseDesign(id).name });
const stage = () => screen.getByRole("region", { name: "ภาพแหวน" });
async function mounted() {
  await waitFor(() => expect(h.createRingRenderer).toHaveBeenCalled());
  await waitFor(() => expect(within(stage()).getByRole("img")).toBeInTheDocument());
}
const lastTints = (): GemTint[] => h.renderer.setTints.mock.calls[h.renderer.setTints.mock.calls.length - 1][0] as GemTint[];
const ringArg = (call: number) => (h.renderer.setRing.mock.calls[call][0] as { gems: unknown[] }).gems.length;

describe("สลับแบบบน renderer เดิม", () => {
  it("mount: สร้าง renderer 1 ครั้งด้วยโมเดลไขว้ (4 เม็ด) · tints 4 · aria ของ canvas มีป้ายหลัก/เสริมของไขว้", async () => {
    render(<RingShowcaseClient params={EMPTY_SHOWCASE_PARAMS} />);
    await mounted();
    expect(h.createRingRenderer).toHaveBeenCalledTimes(1);
    expect((h.createRingRenderer.mock.calls[0][1] as { gems: unknown[] }).gems).toHaveLength(4);
    expect(lastTints()).toHaveLength(4);
    const canvas = within(stage()).getByRole("img");
    expect(canvas.tagName).toBe("CANVAS");
    expect(canvas.getAttribute("aria-label")).toBe("ภาพจำลองแหวนไขว้พลอยไข่ 2 เม็ด 3 มิติ พลอยหลัก (เม็ดบน) CZ ขาว พลอยเสริม (เม็ดล่าง) CZ ขาว CZ เล็ก 2 เม็ด");
    expect(within(stage()).getByText("ลากเพื่อหมุน")).toBeInTheDocument();
  });

  it("สลับครบ 7 แบบ: createRingRenderer ครั้งเดียว · dispose ไม่ถูกเรียก · setRing ต่อครั้ง ถือจำนวนเม็ดของแบบนั้น · tints ยาวเท่าเม็ด", async () => {
    const u = userEvent.setup();
    render(<RingShowcaseClient params={EMPTY_SHOWCASE_PARAMS} />);
    await mounted();
    const order: [ShowcaseDesignId, number][] = [
      ["trinity", 3],
      ["scroll6", 6],
      ["channel4", 4],
      ["channel6", 6],
      ["bar7", 7],
      ["small7", 7],
      ["bypass2", 4],
    ];
    for (let i = 0; i < order.length; i++) {
      await u.click(designRadio(order[i][0]));
      expect(h.renderer.setRing).toHaveBeenCalledTimes(i + 1);
      expect(ringArg(i)).toBe(order[i][1]);
      expect(lastTints()).toHaveLength(order[i][1]);
    }
    expect(h.createRingRenderer).toHaveBeenCalledTimes(1);
    expect(h.renderer.dispose).not.toHaveBeenCalled();
    // ยังเป็น canvas เดิม พร้อมใช้ (ไม่มี fallback ทับ)
    expect(within(stage()).getByRole("img").tagName).toBe("CANVAS");
  });

  it("เลือกแบบเดิมซ้ำ = ไม่เรียก setRing · เปลี่ยนพลอย = setTints (ไม่ setRing)", async () => {
    const u = userEvent.setup();
    render(<RingShowcaseClient params={{ ...EMPTY_SHOWCASE_PARAMS, ring: "channel4" }} />);
    await mounted();
    expect(h.createRingRenderer).toHaveBeenCalledTimes(1);
    expect((h.createRingRenderer.mock.calls[0][1] as { gems: unknown[] }).gems).toHaveLength(4);
    await u.click(designRadio("channel4"));
    expect(h.renderer.setRing).not.toHaveBeenCalled();
    await u.click(screen.getByRole("radio", { name: "เลือกพลอยเอง" }));
    // D1.2a: แตะพลอยครั้งแรก = ใส่ทุกเม็ด (รายเม็ด)
    await u.click(within(screen.getByRole("radiogroup", { name: "เลือกพลอยให้เม็ดที่ 1" })).getByRole("radio", { name: "อเมทิสต์" }));
    expect(h.renderer.setRing).not.toHaveBeenCalled();
    const t = lastTints();
    expect(t).toHaveLength(4);
    // ฝังล็อค 4: ทุกเม็ด = อเมทิสต์
    expect(t.every((x) => !x.cz)).toBe(true);
  });

  it("สีตามตำแหน่ง: แถวคี่ 1 เม็ดกลาง · แถวคู่ 2 เม็ดกลาง = พลอยหลัก ที่เหลือ = พลอยเสริม", async () => {
    const u = userEvent.setup();
    // D1.2a: โหมดแบบแนะนำยังเป็น หลัก (เม็ดกลาง) / เสริม (ที่เหลือ) — โหมดเลือกเองแถวเป็นรายเม็ด (ดูเทสต์ถัดไป)
    render(<RingShowcaseClient params={{ ...EMPTY_SHOWCASE_PARAMS, top3: ["garnet", "peridot", "citrine"] }} />);
    await mounted();
    for (const [id, n] of [
      ["trinity", 3],
      ["scroll6", 6],
      ["bar7", 7],
    ] as const) {
      await u.click(designRadio(id));
      const t = lastTints();
      const mains = new Set(mainIndexes(n));
      expect(t).toHaveLength(n);
      const garnet = t.filter((_, i) => mains.has(i));
      const peridot = t.filter((_, i) => !mains.has(i));
      expect(new Set(garnet.map((x) => x.rgb.join(","))).size).toBe(1);
      expect(new Set(peridot.map((x) => x.rgb.join(","))).size).toBe(1);
      expect(garnet[0].rgb.join(",")).not.toBe(peridot[0].rgb.join(","));
    }
  });
});

describe("D1.2a เลือกรายเม็ด → สีรายเม็ดบน 3D", () => {
  it("แตะพลอยครั้งแรก = ทุกเม็ดสีนั้น · เปลี่ยนเม็ดที่ 4 = เฉพาะตำแหน่ง 4 (ซ้าย→ขวา) เปลี่ยนสี · ไม่ setRing", async () => {
    const u = userEvent.setup();
    render(<RingShowcaseClient params={{ ...EMPTY_SHOWCASE_PARAMS, ring: "bar7" }} />);
    await mounted();
    await u.click(screen.getByRole("radio", { name: "เลือกพลอยเอง" }));
    await u.click(within(screen.getByRole("radiogroup", { name: "เลือกพลอยให้เม็ดที่ 1" })).getByRole("radio", { name: "โกเมน" }));
    const all = lastTints();
    expect(all).toHaveLength(7);
    expect(new Set(all.map((x) => x.rgb.join(","))).size).toBe(1);
    expect(all.every((x) => !x.cz)).toBe(true);
    await u.click(within(screen.getByRole("radiogroup", { name: "เลือกพลอยทีละเม็ด" })).getByRole("radio", { name: /^เม็ดที่ 4 / }));
    await u.click(within(screen.getByRole("radiogroup", { name: "เลือกพลอยให้เม็ดที่ 4" })).getByRole("radio", { name: "ซิทริน" }));
    const t = lastTints();
    expect(t).toHaveLength(7);
    t.forEach((x, i) => (i === 3 ? expect(x.rgb).not.toEqual(all[0].rgb) : expect(x.rgb).toEqual(all[0].rgb)));
    expect(h.renderer.setRing).not.toHaveBeenCalled();
  });
  it("ยังไม่เลือก (เลือกเองเปล่า) = CZ ขาวทุกเม็ด · สลับแบบ = ความยาว tints ตามโมเดลเสมอ", async () => {
    const u = userEvent.setup();
    render(<RingShowcaseClient params={{ ...EMPTY_SHOWCASE_PARAMS, ring: "trinity" }} />);
    await mounted();
    await u.click(screen.getByRole("radio", { name: "เลือกพลอยเอง" }));
    expect(lastTints().every((x) => x.cz)).toBe(true);
    await u.click(within(screen.getByRole("radiogroup", { name: "เลือกพลอยให้เม็ดที่ 1" })).getByRole("radio", { name: "เพอริดอท" }));
    for (const [id, n] of [["bar7", 7], ["channel4", 4], ["scroll6", 6], ["trinity", 3]] as const) {
      await u.click(designRadio(id));
      expect(lastTints()).toHaveLength(n);
    }
  });
});

describe("โมเดลของแบบล้ม (build/upload throw) — fallback + ลองอีกครั้ง", () => {
  it("สลับไปแบบที่ล้ม: แจ้ง 'โหลดภาพ 3 มิติของแบบนี้ไม่ได้' + ปุ่มลองอีกครั้ง + ภาพประกอบทับ canvas (ไม่ค้างภาพแบบก่อน) · พลอย/ไซซ์/LINE ใช้ต่อได้", async () => {
    const u = userEvent.setup();
    render(<RingShowcaseClient params={EMPTY_SHOWCASE_PARAMS} />);
    await mounted();
    h.state.failIds.add("bar7");
    await u.click(designRadio("bar7"));
    const s = stage();
    expect(await within(s).findByText("โหลดภาพ 3 มิติของแบบนี้ไม่ได้")).toBeInTheDocument();
    expect(within(s).getByRole("button", { name: "ลองอีกครั้ง" })).toBeInTheDocument();
    expect(within(s).getByText("ภาพประกอบตำแหน่งเม็ด ไม่ใช่ภาพจริง")).toBeInTheDocument();
    expect(s.querySelectorAll("img")).toHaveLength(0); // ไม่เอารูปไขว้มาแทน (Z6)
    expect(h.renderer.setRing).not.toHaveBeenCalled(); // โมเดลสร้างไม่ได้ ไม่ส่งอะไรให้ renderer
    await u.click(screen.getByRole("radio", { name: "เบอร์ 50" }));
    expect(screen.getByRole("link", { name: /ส่งให้แอดมินทาง LINE/ }).getAttribute("href")).toContain("50");
  });

  it("กด 'ลองอีกครั้ง' หลังแก้แล้ว → remount viewer (renderer ใหม่) · ข้อความล้มหาย · สลับไปแบบอื่นก็ล้างสถานะล้ม", async () => {
    const u = userEvent.setup();
    render(<RingShowcaseClient params={EMPTY_SHOWCASE_PARAMS} />);
    await mounted();
    h.state.failIds.add("bar7");
    await u.click(designRadio("bar7"));
    await within(stage()).findByText("โหลดภาพ 3 มิติของแบบนี้ไม่ได้");
    h.state.failIds.clear();
    await u.click(within(stage()).getByRole("button", { name: "ลองอีกครั้ง" }));
    await waitFor(() => expect(h.createRingRenderer).toHaveBeenCalledTimes(2));
    expect((h.createRingRenderer.mock.calls[1][1] as { gems: unknown[] }).gems).toHaveLength(7);
    await waitFor(() => expect(within(stage()).queryByText("โหลดภาพ 3 มิติของแบบนี้ไม่ได้")).toBeNull());
    expect(h.renderer.dispose).toHaveBeenCalledTimes(1); // อันเก่าถูกคืน

    // ล้มอีกรอบ แล้วสลับไปแบบอื่น (ไม่กดลองอีกครั้ง)
    h.state.failIds.add("small7");
    await u.click(designRadio("small7"));
    await within(stage()).findByText("โหลดภาพ 3 มิติของแบบนี้ไม่ได้");
    await u.click(designRadio("trinity"));
    await waitFor(() => expect(within(stage()).queryByText("โหลดภาพ 3 มิติของแบบนี้ไม่ได้")).toBeNull());
    await waitFor(() => expect(h.createRingRenderer).toHaveBeenCalledTimes(3));
    expect((h.createRingRenderer.mock.calls[2][1] as { gems: unknown[] }).gems).toHaveLength(3);
  });

  it("แบบเริ่มต้นที่ล้มตั้งแต่ mount (ผ่าน r) → fallback ของแบบนั้นทันที ไม่ค้าง 'กำลังโหลด…'", async () => {
    h.state.failIds.add("scroll6");
    render(<RingShowcaseClient params={{ ...EMPTY_SHOWCASE_PARAMS, ring: "scroll6" }} />);
    expect(await within(stage()).findByText("โหลดภาพ 3 มิติของแบบนี้ไม่ได้")).toBeInTheDocument();
    expect(within(stage()).queryByText("กำลังโหลดภาพ 3 มิติ…")).toBeNull();
    expect(h.createRingRenderer).not.toHaveBeenCalled();
  });
});

describe("context lost — Z6 รูปไม่ข้ามแบบ", () => {
  it("แบบไม่มีรูป (เตย 7): lost → ข้อความ + ภาพประกอบ · ไม่มี <img> · กู้แล้วกลับมา canvas", async () => {
    const u = userEvent.setup();
    render(<RingShowcaseClient params={EMPTY_SHOWCASE_PARAMS} />);
    await mounted();
    await u.click(designRadio("bar7"));
    h.state.opts?.onUnsupported?.("context_lost");
    expect(await within(stage()).findByText(/ภาพ 3 มิติหยุดชั่วคราว · แบบนี้ยังไม่มีรูปถ่ายจริง/)).toBeInTheDocument();
    expect(within(stage()).queryByText(/ดูรูปจริงด้านล่างแทน/)).toBeNull();
    expect(stage().querySelectorAll("img")).toHaveLength(0);
    h.state.opts?.onReady?.();
    await waitFor(() => expect(within(stage()).queryByText(/หยุดชั่วคราว/)).toBeNull());
    expect(within(stage()).getByRole("img").tagName).toBe("CANVAS");
  });
  it("แบบไขว้ (มีรูป): lost → รูปจริงของไขว้ + ข้อความเดิม · สลับไปแบบแถวตอน lost → รูปไขว้หายทันที", async () => {
    const u = userEvent.setup();
    render(<RingShowcaseClient params={EMPTY_SHOWCASE_PARAMS} />);
    await mounted();
    h.state.opts?.onUnsupported?.("context_lost");
    expect(await within(stage()).findByText("ภาพ 3 มิติหยุดชั่วคราว ดูรูปจริงด้านล่างแทน")).toBeInTheDocument();
    const imgs = [...stage().querySelectorAll("img")];
    expect(imgs).toHaveLength(1);
    expect(SHOWCASE_PHOTOS.bypass2.map((p) => p.src)).toContain(imgs[0].getAttribute("src"));
    await u.click(designRadio("channel6"));
    expect(stage().querySelectorAll("img")).toHaveLength(0);
    expect(within(stage()).getByText(/แบบนี้ยังไม่มีรูปถ่ายจริง/)).toBeInTheDocument();
  });
  it("shader/WebGL ล้ม (no_webgl) กับแบบไม่มีรูป → ข้อความ 'เครื่องนี้แสดงภาพ 3 มิติไม่ได้ · แบบนี้ยังไม่มีรูปถ่ายจริง'", async () => {
    render(<RingShowcaseClient params={{ ...EMPTY_SHOWCASE_PARAMS, ring: "small7" }} />);
    await mounted();
    h.state.opts?.onUnsupported?.("no_webgl");
    expect(await within(stage()).findByText(/เครื่องนี้แสดงภาพ 3 มิติไม่ได้ · แบบนี้ยังไม่มีรูปถ่ายจริง/)).toBeInTheDocument();
    expect(stage().querySelectorAll("img")).toHaveLength(0);
  });
});
