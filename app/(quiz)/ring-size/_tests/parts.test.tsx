// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CALIBRATION } from "@/lib/ring-size/config";
import { circleRadiusFor, cardLineXs, ringInnerDiameterPx } from "@/lib/ring-size/stage-geometry";
import { isZoomed, useVisualViewportZoomed } from "@/lib/ring-size/use-visual-viewport-scale";
import { useElementSize } from "@/lib/ring-size/use-element-size";
import { CalibrationStage } from "../_components/CalibrationStage";
import { CoinCalibrationStage } from "../_components/CoinCalibrationStage";
import { FineAdjuster } from "../_components/FineAdjuster";
import { FitExamplesSheet } from "../_components/FitExamplesSheet";
import { G3Sheet } from "../_components/G3Sheet";
import { RingDiscStage } from "../_components/RingDiscStage";
import { RsButton } from "../_components/RsButton";
import { RulerStage } from "../_components/RulerStage";
import { StageHost } from "../_components/StageHost";
import { resetBrowserState, setVisualViewport, mockRects } from "./setup.test-util";
import { useState } from "react";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetBrowserState();
});
beforeEach(() => resetBrowserState());

// ───────────────────────── เวทีวัด (build spec ข้อ 3.1 · 3.3) ─────────────────────────

describe("CoinCalibrationStage — รัศมีจริงจาก attribute (B11)", () => {
  it.each([4.5, 6.0, 7.5])("ppm=%s: r ตรงสูตร และเส้นผ่านศูนย์กลางด้านในของเส้น = 26 × ppm", (ppm) => {
    const { container } = render(<CoinCalibrationStage width={390} height={300} ppm={ppm} />);
    const circle = container.querySelector("circle")!;
    const r = Number(circle.getAttribute("r"));
    const sw = Number(circle.getAttribute("stroke-width"));
    expect(sw).toBe(2);
    // ค่าตายตัวที่คำนวณมือ (ไม่ใช้สูตรเดียวกับโค้ด): 26 × ppm ÷ 2 + sw ÷ 2
    expect(r).toBeCloseTo({ 4.5: 59.5, 6: 79, 7.5: 98.5 }[ppm as 4.5 | 6 | 7.5], 10);
    expect(r).toBeCloseTo(circleRadiusFor(26, ppm, 2), 10);
    expect(ringInnerDiameterPx(r, sw)).toBeCloseTo(26 * ppm, 10);
    expect(circle.getAttribute("cx")).toBe("195");
    expect(circle.getAttribute("cy")).toBe("150");
    expect(circle.getAttribute("fill")).toBe("none");
  });
  it("ที่ ppm=6 → r = 79 พอดี", () => {
    const { container } = render(<CoinCalibrationStage width={390} height={300} ppm={6} />);
    expect(container.querySelector("circle")!.getAttribute("r")).toBe("79");
  });
  it("ไม่ปัด px เป็นจำนวนเต็ม: ppm 6.0115 ให้ r ทศนิยม ≠ r ของ 6.0", () => {
    const a = Number(render(<CoinCalibrationStage width={390} height={300} ppm={6} />).container.querySelector("circle")!.getAttribute("r"));
    cleanup();
    const b = Number(render(<CoinCalibrationStage width={390} height={300} ppm={6.0115} />).container.querySelector("circle")!.getAttribute("r"));
    expect(b).toBeGreaterThan(a);
    expect(Number.isInteger(b)).toBe(false);
  });
});

describe("CalibrationStage — พิกัดเส้นบัตร", () => {
  it.each([4.5, 6.0, 7.5])("ppm=%s: ขอบในของเส้นสองข้างห่างกัน 53.98 × ppm", (ppm) => {
    const { container } = render(<CalibrationStage width={400} height={300} ppm={ppm} />);
    const lines = container.querySelectorAll("line");
    expect(lines).toHaveLength(2);
    const [xl, xr] = [Number(lines[0].getAttribute("x1")), Number(lines[1].getAttribute("x1"))];
    expect(xr - xl - 2).toBeCloseTo(53.98 * ppm, 10);
    // ค่าตายตัวที่คำนวณมือ: ห่างจากกลาง 53.98 × ppm ÷ 2 + 1
    const off = { 4.5: 122.455, 6: 162.94, 7.5: 203.425 }[ppm as 4.5 | 6 | 7.5];
    expect(200 - xl).toBeCloseTo(off, 9);
    expect(xr - 200).toBeCloseTo(off, 9);
    const [exl, exr] = cardLineXs(200, 53.98, ppm, 2);
    expect(xl).toBeCloseTo(exl, 10);
    expect(xr).toBeCloseTo(exr, 10);
    expect(lines[0].getAttribute("stroke-width")).toBe("2");
  });
  it("ที่ ppm=6, sw=2 → x = cx ± 162.94", () => {
    const { container } = render(<CalibrationStage width={390} height={300} ppm={6} />);
    const lines = container.querySelectorAll("line");
    expect(195 - Number(lines[0].getAttribute("x1"))).toBeCloseTo(162.94, 10);
  });
});

describe("เวที: viewBox = ขนาดที่วัด · ไม่มี border · DOM มีเฉพาะที่อนุญาต (A9 / ข้อ 3.1.1)", () => {
  it("viewBox ตรงกับ width × height (1 หน่วย SVG = 1 CSS px)", () => {
    for (const [w, h] of [[390, 300], [360.5, 240.25]]) {
      const { container } = render(<CoinCalibrationStage width={w} height={h} ppm={6} />);
      const svg = container.querySelector("svg")!;
      expect(svg.getAttribute("viewBox")).toBe(`0 0 ${w} ${h}`);
      expect(svg.getAttribute("width")).toBe(String(w));
      expect(svg.getAttribute("height")).toBe(String(h));
      expect(svg.getAttribute("shape-rendering")).toBe("geometricPrecision");
      cleanup();
    }
  });

  it("StageHost วัดขนาดจริงผ่าน getBoundingClientRect แล้ววาด viewBox ตามนั้น", async () => {
    mockRects(372.5, 255.5);
    const { container } = render(<StageHost kind="coin">{(s) => <CoinCalibrationStage width={s.width} height={s.height} ppm={6} />}</StageHost>);
    await waitFor(() => expect(container.querySelector("svg")).not.toBeNull());
    expect(container.querySelector("svg")!.getAttribute("viewBox")).toBe("0 0 372.5 255.5");
  });

  it("องค์ประกอบวัดไม่มี style border/box-sizing (ชั้นที่วัดขนาดไม่มีเส้นขอบ)", async () => {
    mockRects(390, 300);
    const { container } = render(<StageHost kind="card">{(s) => <CalibrationStage width={s.width} height={s.height} ppm={6} />}</StageHost>);
    await waitFor(() => expect(container.querySelector("svg")).not.toBeNull());
    const svg = container.querySelector("svg")!;
    const measured = svg.parentElement!;
    expect(measured.className).not.toMatch(/border/);
    expect(measured.getAttribute("style") ?? "").not.toMatch(/border|box-sizing/);
    expect(measured.getAttribute("style")).toContain("dvh"); // clamp ด้วย dvh
    expect(measured.getAttribute("style")).not.toMatch(/(?<!d)vh/);
    expect(svg.getAttribute("style") ?? "").not.toMatch(/border|box-sizing/);
    expect(measured.className).toContain("touch-none"); // touch-action: none เฉพาะเวที
  });

  const ALLOWED: Record<string, string[]> = {
    card: ["svg", "line"],
    coin: ["svg", "circle"],
    disc: ["svg", "circle", "line"],
  };
  const tags = (root: Element) => [...new Set([root, ...Array.from(root.querySelectorAll("*"))].map((e) => e.tagName.toLowerCase()))].sort();

  it("R2 บัตร: <svg> + <line> ×2 เท่านั้น (ไม่มีกรอบ/ภาพ/สีพื้นบัตร)", () => {
    const { container } = render(<CalibrationStage width={390} height={300} ppm={6} />);
    expect(tags(container.firstElementChild!)).toEqual([...ALLOWED.card].sort());
    expect(container.querySelectorAll("line")).toHaveLength(2);
    expect(container.textContent).toBe("");
  });
  it("R2Coin: <svg> + <circle fill=none> ×1 เท่านั้น (ไม่มีวงเหรียญเงิน/ทอง ไม่มีเลข 10)", () => {
    const { container } = render(<CoinCalibrationStage width={390} height={300} ppm={6} />);
    expect(tags(container.firstElementChild!)).toEqual([...ALLOWED.coin].sort());
    expect(container.querySelectorAll("circle")).toHaveLength(1);
    expect(container.textContent).toBe("");
  });
  it("R5A: <svg> + วงทึบ 1 + กากบาท 2 เส้น เท่านั้น (ไม่มีภาพแหวนจำลอง)", () => {
    const { container } = render(<RingDiscStage width={390} height={300} ppm={6} diameterMm={14} />);
    expect(tags(container.firstElementChild!)).toEqual([...ALLOWED.disc].sort());
    expect(container.querySelectorAll("circle")).toHaveLength(1);
    expect(container.querySelectorAll("line")).toHaveLength(2);
    expect(Number(container.querySelector("circle")!.getAttribute("r"))).toBeCloseTo(42, 10); // 14 × 6 ÷ 2
  });
  it("R5B: ไม้บรรทัด + เส้นอ่านค่า + ที่จับ — ไม่มี rect/image/ellipse (ไม่มีกระดาษจำลอง) และไม่มีข้อความ 'ภาพจำลอง'", () => {
    const { container } = render(<RulerStage ppm={6} valueMm={50} />);
    expect(container.querySelector("rect, image, ellipse, foreignObject")).toBeNull();
    expect(container.textContent).not.toMatch(/จำลอง|กระดาษ/);
    // เส้นอ่านค่าอยู่ที่ y = 12 + 50 × 6
    expect(Number(container.querySelector('[data-testid="ruler-read-line"]')!.getAttribute("y1"))).toBe(312);
    // ไม้บรรทัดกว้าง 156 px · สูง 12 + 80 × ppm + 12
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("156");
    expect(svg.getAttribute("height")).toBe("504");
  });
  it("เลขไม้บรรทัด ≥ 13 px", () => {
    const { container } = render(<RulerStage ppm={6} valueMm={50} />);
    for (const t of Array.from(container.querySelectorAll("text"))) expect(Number(t.getAttribute("font-size"))).toBeGreaterThanOrEqual(13);
  });
});

describe("hooks", () => {
  it("isZoomed: ±1% ไม่ถือว่าซูม", () => {
    expect(isZoomed(1)).toBe(false);
    expect(isZoomed(1.005)).toBe(false);
    expect(isZoomed(0.995)).toBe(false);
    expect(isZoomed(1.02)).toBe(true);
    expect(isZoomed(2)).toBe(true);
    expect(isZoomed(undefined)).toBe(false);
    expect(isZoomed(Number.NaN)).toBe(false);
  });

  function Probe() {
    const z = useVisualViewportZoomed();
    return <span data-testid="z">{String(z)}</span>;
  }
  it("useVisualViewportZoomed ตามค่า scale + เปลี่ยนตาม event · ไม่มี visualViewport = false", () => {
    render(<Probe />);
    expect(screen.getByTestId("z")).toHaveTextContent("false");
    cleanup();

    const listeners: Record<string, Array<() => void>> = {};
    const vv = {
      scale: 1.5,
      addEventListener: (t: string, f: () => void) => (listeners[t] ??= []).push(f),
      removeEventListener: () => {},
    };
    setVisualViewport(vv as unknown as VisualViewport);
    render(<Probe />);
    expect(screen.getByTestId("z")).toHaveTextContent("true");
    act(() => {
      vv.scale = 1;
      listeners.resize.forEach((f) => f());
    });
    expect(screen.getByTestId("z")).toHaveTextContent("false");
  });

  it("useElementSize ไม่ปัดเศษ และไม่ตั้งขนาดเมื่อวัดได้ 0", async () => {
    function Sz() {
      const { ref, size } = useElementSize<HTMLDivElement>();
      return (
        <div ref={ref} data-testid="host">
          {size ? `${size.width}x${size.height}` : "none"}
        </div>
      );
    }
    const spy = mockRects(0, 0);
    render(<Sz />);
    expect(screen.getByTestId("host")).toHaveTextContent("none");
    cleanup();
    spy.mockRestore();
    mockRects(333.33, 222.22);
    render(<Sz />);
    await waitFor(() => expect(screen.getByTestId("host")).toHaveTextContent("333.33x222.22"));
  });
});

// ───────────────────────── FineAdjuster ─────────────────────────

function Harness({ start = 10, min = 0, max = 20, step = 1 }: { start?: number; min?: number; max?: number; step?: number | ((v: number) => number) }) {
  const [v, setV] = useState(start);
  return (
    <>
      <span data-testid="v">{v}</span>
      <FineAdjuster
        value={v}
        min={min}
        max={max}
        onChange={setV}
        step={step}
        sliderLabel="slider"
        decLabel="−"
        incLabel="+"
        decAria="dec"
        incAria="inc"
        valueText={(x) => `ค่า ${x}`}
      />
    </>
  );
}
const val = () => Number(screen.getByTestId("v").textContent);

describe("FineAdjuster (B15 · ข้อ 3.1.2)", () => {
  it("คีย์บอร์ด (click detail=0) ขยับ 1 ก้าว", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "inc" }));
    expect(val()).toBe(11);
    fireEvent.click(screen.getByRole("button", { name: "dec" }));
    fireEvent.click(screen.getByRole("button", { name: "dec" }));
    expect(val()).toBe(9);
  });

  it("เมาส์/สัมผัส: pointerdown ขยับทันที 1 ก้าว และ click ที่ตามมาไม่ขยับซ้ำ", () => {
    render(<Harness />);
    const inc = screen.getByRole("button", { name: "inc" });
    fireEvent.pointerDown(inc);
    fireEvent.pointerUp(inc);
    fireEvent.click(inc, { detail: 1 });
    expect(val()).toBe(11);
  });

  it("กดค้าง: เริ่มซ้ำหลัง 400 ms ที่ 120 ms แล้วเร่งขึ้น · pointerup หยุด", () => {
    vi.useFakeTimers();
    render(<Harness step={0.5} max={100} />);
    const inc = screen.getByRole("button", { name: "inc" });
    fireEvent.pointerDown(inc);
    expect(val()).toBe(10.5); // ทันที
    act(() => void vi.advanceTimersByTime(399));
    expect(val()).toBe(10.5); // ยังไม่ซ้ำ
    act(() => void vi.advanceTimersByTime(1));
    expect(val()).toBe(11); // 400 ms
    act(() => void vi.advanceTimersByTime(120));
    expect(val()).toBe(11.5);
    act(() => void vi.advanceTimersByTime(110));
    expect(val()).toBe(12); // เร่งขึ้น (110 ms)
    fireEvent.pointerUp(inc);
    const after = val();
    act(() => void vi.advanceTimersByTime(2000));
    expect(val()).toBe(after); // หยุดจริง
  });

  it("pointercancel และ pointerleave หยุดการกดค้างด้วย", () => {
    vi.useFakeTimers();
    render(<Harness max={100} />);
    const inc = screen.getByRole("button", { name: "inc" });
    fireEvent.pointerDown(inc);
    fireEvent.pointerCancel(inc);
    act(() => void vi.advanceTimersByTime(3000));
    expect(val()).toBe(11);
    fireEvent.pointerDown(inc);
    fireEvent.pointerLeave(inc);
    act(() => void vi.advanceTimersByTime(3000));
    expect(val()).toBe(12);
  });

  it("ที่ขอบช่วง: คงที่ ไม่ NaN ไม่เกิน", () => {
    render(<Harness start={19.5} max={20} step={1} />);
    const inc = screen.getByRole("button", { name: "inc" });
    fireEvent.click(inc);
    expect(val()).toBe(20);
    fireEvent.click(inc);
    expect(val()).toBe(20);
    cleanup();
    render(<Harness start={0.5} min={0} step={1} />);
    fireEvent.click(screen.getByRole("button", { name: "dec" }));
    expect(val()).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "dec" }));
    expect(val()).toBe(0);
    expect(Number.isNaN(val())).toBe(false);
  });

  it("ก้าวเป็นฟังก์ชันของค่าปัจจุบันได้ (ก้าว ppm ขึ้นกับ ppm)", () => {
    render(<Harness start={5} step={(v) => v / 10} max={100} />);
    fireEvent.click(screen.getByRole("button", { name: "inc" }));
    expect(val()).toBeCloseTo(5.5, 10);
  });

  it("slider มี aria-valuetext ไทยและช่วง min/max · ลากแล้วค่าเปลี่ยน · ค่าเสียไม่เข้า state", () => {
    render(<Harness />);
    const slider = screen.getByRole("slider", { name: "slider" });
    expect(slider).toHaveAttribute("aria-valuetext", "ค่า 10");
    expect(slider).toHaveAttribute("min", "0");
    expect(slider).toHaveAttribute("max", "20");
    fireEvent.change(slider, { target: { value: "13.5" } });
    expect(val()).toBe(13.5);
    expect(slider).toHaveAttribute("aria-valuetext", "ค่า 13.5");
    fireEvent.change(slider, { target: { value: "999" } });
    expect(val()).toBe(20); // clamp
  });

  it("ปุ่ม −/+ สูง/กว้าง ≥ 56 px (class min-h/min-w)", () => {
    render(<Harness />);
    for (const name of ["inc", "dec"]) {
      const b = screen.getByRole("button", { name });
      expect(b.className).toContain("min-h-[56px]");
      expect(b.className).toContain("min-w-[56px]");
    }
  });

  it("live region ประกาศแบบ debounce (ไม่ประกาศทุกการขยับ)", () => {
    vi.useFakeTimers();
    render(<Harness max={100} />);
    const region = document.querySelector('[role="status"][aria-live="polite"]')!;
    act(() => void vi.advanceTimersByTime(800));
    expect(region.textContent).toBe("ค่า 10");
    const inc = screen.getByRole("button", { name: "inc" });
    fireEvent.click(inc);
    fireEvent.click(inc);
    fireEvent.click(inc);
    expect(region.textContent).toBe("ค่า 10"); // ยังไม่ประกาศระหว่างขยับ
    act(() => void vi.advanceTimersByTime(800));
    expect(region.textContent).toBe("ค่า 13");
  });
});

// ───────────────────────── RsButton · dialogs ─────────────────────────

describe("RsButton (B12)", () => {
  it("ปิดใช้งาน = <button disabled> ไม่ใช่ลิงก์ แม้ส่ง href มา · กดไม่ได้", async () => {
    const onClick = vi.fn();
    render(
      <RsButton disabled href="https://example.invalid/x" onClick={onClick}>
        เลื่อนเส้นก่อน จึงกดได้
      </RsButton>
    );
    const b = screen.getByRole("button", { name: "เลื่อนเส้นก่อน จึงกดได้" });
    expect(b.tagName).toBe("BUTTON");
    expect(b).toBeDisabled();
    expect(document.querySelector("a")).toBeNull();
    await userEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
  });
  it("เปิดใช้งาน + href = <a> ลิงก์ปกติ (ไม่ใช้ window.open)", () => {
    render(<RsButton href="https://example.invalid/x">ไป</RsButton>);
    expect(screen.getByRole("link", { name: "ไป" })).toHaveAttribute("href", "https://example.invalid/x");
  });
  it("ขนาดขั้นต่ำ 56 px", () => {
    render(<RsButton>ปุ่ม</RsButton>);
    expect(screen.getByRole("button").className).toContain("min-h-[56px]");
  });
});

describe("FitExamplesSheet (ข้อ 4.2 · B17)", () => {
  function Opener({ kind }: { kind: "coin" | "card" }) {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>เปิดตัวอย่าง</button>
        {open ? <FitExamplesSheet kind={kind} onClose={() => setOpen(false)} /> : null}
      </>
    );
  }
  it("เหรียญ: dialog + 3 ภาพ role=img ไทย + คำอธิบาย + ท้ายแผ่นเรื่องเหรียญที่ระลึก", async () => {
    const user = userEvent.setup();
    render(<Opener kind="coin" />);
    await user.click(screen.getByRole("button", { name: "เปิดตัวอย่าง" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby");
    expect(screen.getAllByRole("img")).toHaveLength(3);
    expect(screen.getByText("พอดี: เห็นเส้นแดงเต็มและหนาเท่ากัน ไม่มีช่องว่าง")).toBeInTheDocument();
    expect(screen.getByText("เล็กไป: เส้นบางลงหรือถูกบัง — ขยายอีกนิด")).toBeInTheDocument();
    expect(screen.getByText("ใหญ่ไป: เห็นช่องว่างสีขาว — ย่ออีกนิด")).toBeInTheDocument();
    expect(screen.getByText(/ไม่ใช้เหรียญที่ระลึก/)).toBeInTheDocument();
    // ไม่พึ่งสีอย่างเดียว: มีคำ ถูก/ผิด สำหรับ screen reader
    expect(screen.getAllByText("ถูก")).toHaveLength(1);
    expect(screen.getAllByText("ผิด")).toHaveLength(2);
  });
  it("บัตร: คำว่า แคบไป/กว้างไป และไม่มีท้ายแผ่นเรื่องเหรียญ", async () => {
    const user = userEvent.setup();
    render(<Opener kind="card" />);
    await user.click(screen.getByRole("button", { name: "เปิดตัวอย่าง" }));
    expect(screen.getByText(/แคบไป/)).toBeInTheDocument();
    expect(screen.getByText(/กว้างไป/)).toBeInTheDocument();
    expect(screen.queryByText(/เหรียญที่ระลึก/)).toBeNull();
  });
  it("Esc ปิด + คืนโฟกัสที่ปุ่มที่เปิด", async () => {
    const user = userEvent.setup();
    render(<Opener kind="coin" />);
    const opener = screen.getByRole("button", { name: "เปิดตัวอย่าง" });
    await user.click(opener);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(opener).toHaveFocus();
  });
  it("focus trap: Tab จากองค์ประกอบสุดท้ายวนกลับไปตัวแรก · Shift+Tab ย้อน", async () => {
    const user = userEvent.setup();
    render(<Opener kind="coin" />);
    await user.click(screen.getByRole("button", { name: "เปิดตัวอย่าง" }));
    const close = screen.getByRole("button", { name: "ปิด" });
    expect(close.className).toContain("h-11"); // ปุ่มปิด 44 px
    close.focus();
    await user.tab(); // มีปุ่มเดียวใน dialog → วนกลับตัวเอง ไม่หลุดออกไปหลัง dialog
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(close).toHaveFocus();
  });
  it("พื้นหลังคลิกปิดได้ (ไม่ใช่ alertdialog)", async () => {
    const user = userEvent.setup();
    render(<Opener kind="coin" />);
    await user.click(screen.getByRole("button", { name: "เปิดตัวอย่าง" }));
    const backdrop = document.querySelector('button[aria-hidden="true"]') as HTMLElement;
    fireEvent.click(backdrop);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("G3Sheet (ข้อ 4.3 · A2)", () => {
  it("alertdialog · เช็กลิสต์ตาม ref (บัตร vs เหรียญ) · ปุ่มหลัก = ปรับอีกครั้ง", async () => {
    const onRetry = vi.fn();
    const onAccept = vi.fn();
    const { rerender } = render(<G3Sheet kind="card" onRetry={onRetry} onAccept={onAccept} />);
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveAccessibleName("ขนาดที่เทียบได้ต่างจากมือถือส่วนใหญ่");
    expect(screen.getByText("ใช้บัตรขนาดมาตรฐานแบบบัตร ATM")).toBeInTheDocument();
    expect(screen.getByText("เส้นแดงชิดขอบบัตรทั้ง 2 ข้าง")).toBeInTheDocument();
    expect(screen.queryByText(/เหรียญ/)).toBeNull();
    rerender(<G3Sheet kind="coin" onRetry={onRetry} onAccept={onAccept} />);
    expect(screen.getByText("ใช้เหรียญ 10 บาทหมุนเวียนสองสี (ไม่ใช่เหรียญที่ระลึก)")).toBeInTheDocument();
    expect(screen.getByText("วางเหรียญนอนราบกลางวง")).toBeInTheDocument();
    expect(screen.queryByText(/บัตร/)).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "ปรับอีกครั้ง" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: /ถูกต้องแล้ว ใช้ค่านี้/ }));
    expect(onAccept).toHaveBeenCalledTimes(1);
  });
  it("Esc = ปรับอีกครั้ง (ทางเลือกปลอดภัย ไม่บันทึกค่า)", async () => {
    const onRetry = vi.fn();
    const onAccept = vi.fn();
    render(<G3Sheet kind="coin" onRetry={onRetry} onAccept={onAccept} />);
    await userEvent.keyboard("{Escape}");
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onAccept).not.toHaveBeenCalled();
  });
});

// ใช้ CALIBRATION เพื่อกันค่า config เปลี่ยนโดยเทสต์ไม่รู้ตัว
describe("config ที่เวทีใช้", () => {
  it("เส้นเทียบ 2 px", () => {
    expect(CALIBRATION.STROKE_PX).toBe(2);
  });
});
