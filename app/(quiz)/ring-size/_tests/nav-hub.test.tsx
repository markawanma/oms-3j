// @vitest-environment jsdom
// ux-tools-navigation §5/§6/§11 — ring-size: ปุ่ม "เครื่องมือ 3J" ทุกจอ + ถามก่อนออกเฉพาะมีค่าที่ปรับไว้ยังไม่บันทึก + R6 "ดูแหวนด้วยเบอร์ N"
//   N3 · N5 · N6 · N11 · N12 · N17 (มติเจ้าของ 24 พ.ย. 69 เขียนทับมติ 18 พ.ย. "ห้ามลิงก์ hub กลางทาง")
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetTrackStateForTests } from "@/lib/ring-size/track";
import { SHOWCASE_PATH } from "@/lib/ring-builder/showcase/config";
import { RingSizeClient } from "../RingSizeClient";
import { mockRects, resetBrowserState, seedCalibration, seedLastResult } from "./setup.test-util";

/** document-level: บันทึกว่าคลิกลิงก์ถูก preventDefault โดยคอมโพเนนต์หรือไม่ (แล้วกัน jsdom navigation เอง) */
let linkClicks: Array<{ href: string | null; prevented: boolean }> = [];
const onDocClick = (e: MouseEvent) => {
  const a = (e.target as HTMLElement | null)?.closest("a");
  if (a) {
    linkClicks.push({ href: a.getAttribute("href"), prevented: e.defaultPrevented });
    e.preventDefault();
  }
};

beforeEach(() => {
  resetBrowserState();
  mockRects(390, 300);
  resetTrackStateForTests();
  linkClicks = [];
  document.addEventListener("click", onDocClick);
});
afterEach(() => {
  document.removeEventListener("click", onDocClick);
  cleanup();
  vi.restoreAllMocks();
  resetBrowserState();
});

const user = () => userEvent.setup();
const btn = (name: string | RegExp) => screen.getByRole("button", { name });
const hub = () => screen.getByRole("link", { name: "กลับหน้าเครื่องมือ 3J" });
const dialog = () => screen.queryByRole("alertdialog");
const LEAVE_BODY = "ค่าที่ปรับไว้และยังไม่บันทึกจะหายไป";

/** กดไป hub แล้วคืนว่าขึ้นด่านถามไหม (ถ้าไม่ขึ้น คลิกต้องปล่อยให้เบราว์เซอร์ไป hub เอง) */
async function clickHub(u: ReturnType<typeof user>): Promise<boolean> {
  const before = linkClicks.length;
  await u.click(hub());
  const click = linkClicks[before];
  expect(click.href).toBe("/");
  const asked = dialog() !== null;
  expect(click.prevented).toBe(asked); // ถาม ⇔ preventDefault
  return asked;
}

async function stay(u: ReturnType<typeof user>) {
  await u.click(screen.getByRole("button", { name: "อยู่ต่อ" }));
  expect(dialog()).toBeNull();
}

describe("R0: ขั้นแรก — ซ้ายบนเป็นลิงก์ข้อความ (โลโก้ไม่ใช่ลิงก์แล้ว)", () => {
  it("'← เครื่องมือ 3J' ≥44px · href '/' · ไม่ target · กดแล้วไม่ถาม", async () => {
    const u = user();
    render(<RingSizeClient />);
    const a = screen.getByRole("link", { name: /เครื่องมือ 3J/ });
    expect(a).toHaveAttribute("href", "/");
    expect(a).not.toHaveAttribute("target");
    expect(a.className).toMatch(/min-h-11/);
    expect(a.textContent).toBe("←เครื่องมือ 3J");
    await u.click(a);
    expect(dialog()).toBeNull();
    expect(linkClicks[0].prevented).toBe(false);
  });
});

describe("N6: จอที่ไม่มีค่าค้าง = ไม่ถาม (R1Pick · R1 · R3 · R4A · G4-ไม่เกี่ยว)", () => {
  it("R1Pick · R1 (สอนบัตร) → ขวาบนมี 'เครื่องมือ 3J' ทุกจอ กดแล้วไม่ถาม", async () => {
    const u = user();
    render(<RingSizeClient />);
    await u.click(btn("เริ่มวัดไซส์")); // R1Pick
    expect(hub()).toHaveAttribute("aria-label", "กลับหน้าเครื่องมือ 3J");
    expect(hub().textContent).toBe("เครื่องมือ 3J");
    expect(await clickHub(u)).toBe(false);
    await u.click(btn(/บัตร 1 ใบ/)); // R1
    expect(await clickHub(u)).toBe(false);
  });

  it("R3 · R4A (มีค่าเทียบเดิม) → ไม่ถาม", async () => {
    seedCalibration({ ref: "coin", pxPerMm: 6 });
    const u = user();
    render(<RingSizeClient />);
    await u.click(await screen.findByRole("button", { name: "เริ่มวัดไซส์" })); // → R3
    expect(await clickHub(u)).toBe(false);
    await u.click(btn(/วางแหวนวงเดิมบนจอ/)); // R4A
    expect(await clickHub(u)).toBe(false);
  });
});

describe("N5: จอเทียบ R2Coin — ถามเมื่อปรับวงแล้วยังไม่ยืนยัน", () => {
  async function toCoin() {
    const u = user();
    render(<RingSizeClient />);
    await u.click(btn("เริ่มวัดไซส์"));
    await u.click(btn(/เหรียญ 10 บาท/));
    return u;
  }

  it("ยังไม่ปรับ = ไม่ถาม · ปรับแล้ว = ถาม (ชื่อ + body ตรง spec) · 'อยู่ต่อ' ค่าที่ปรับไม่หาย · Esc ก็เหมือนกัน", async () => {
    const u = await toCoin();
    expect(await clickHub(u)).toBe(false);

    await u.click(btn("ขยายวงกลมทีละนิด"));
    expect(await clickHub(u)).toBe(true);
    expect(screen.getByRole("alertdialog")).toHaveTextContent("ออกจากขั้นตอนนี้?");
    expect(screen.getByRole("alertdialog")).toHaveTextContent(LEAVE_BODY);
    expect(screen.getByRole("link", { name: "ออกไปหน้าเครื่องมือ" })).toHaveAttribute("href", "/");
    await stay(u);
    expect(btn("วงกลมเท่าเหรียญแล้ว")).toBeEnabled(); // ยังอยู่จอเดิม ค่าที่ปรับค้าง

    expect(await clickHub(u)).toBe(true);
    await u.keyboard("{Escape}");
    expect(dialog()).toBeNull();
    expect(btn("วงกลมเท่าเหรียญแล้ว")).toBeEnabled();
  });

  it("ยืนยันแล้วไป R3 → ถอยกลับมาจอเทียบโดยไม่ขยับ = ไม่ dirty (ค่าบันทึกแล้ว) · ขยับอีก = dirty อีกครั้ง", async () => {
    const u = await toCoin();
    await u.click(btn("ขยายวงกลมทีละนิด"));
    await u.click(btn("วงกลมเท่าเหรียญแล้ว")); // → R3 (บันทึกแล้ว)
    expect(await clickHub(u)).toBe(false); // R3

    await u.click(btn("ย้อนกลับ"));
    await screen.findByText("ปรับวงแดงจนล้อมขอบเหรียญพอดีรอบวง");
    expect(await clickHub(u)).toBe(false); // ค่าตรงกับที่บันทึกไว้ — ไม่มีอะไรจะหาย

    await u.click(btn("ขยายวงกลมทีละนิด"));
    expect(await clickHub(u)).toBe(true);
  });
});

describe("N5/N6: จอวัด R5A / R5B", () => {
  async function toR5(method: "A" | "B") {
    seedCalibration({ ref: "coin", pxPerMm: 6 });
    const u = user();
    render(<RingSizeClient />);
    await u.click(await screen.findByRole("button", { name: "เริ่มวัดไซส์" }));
    await u.click(btn(method === "A" ? /วางแหวนวงเดิมบนจอ/ : /พันกระดาษรอบนิ้ว/));
    await u.click(btn("พร้อมแล้ว เริ่มวัด"));
    return u;
  }

  it("R5A: ยังไม่ปรับ = ไม่ถาม · ปรับ = ถาม · ใช้ค่านี้ → R6 ไม่ถาม · ถอยกลับ R5A โดยไม่ขยับ = ไม่ถาม · ขยับอีก = ถาม", async () => {
    const u = await toR5("A");
    expect(await clickHub(u)).toBe(false);

    fireEvent.change(screen.getByRole("slider"), { target: { value: "17.3" } });
    expect(await clickHub(u)).toBe(true);
    await stay(u);

    await u.click(btn("ใช้ค่านี้")); // R6
    expect(screen.getByTestId("result-size")).toBeInTheDocument();
    expect(await clickHub(u)).toBe(false);

    await u.click(btn("ย้อนกลับ")); // R6 → R5A
    await screen.findByRole("slider");
    expect(await clickHub(u)).toBe(false); // ค่าที่แสดง = ค่าที่ให้ผลล่าสุด

    fireEvent.change(screen.getByRole("slider"), { target: { value: "18.1" } });
    expect(await clickHub(u)).toBe(true);
  });

  it("R5B: ปรับค่าแล้ว = ถาม · ก่อนปรับ = ไม่ถาม", async () => {
    const u = await toR5("B");
    expect(await clickHub(u)).toBe(false);
    fireEvent.click(btn("เพิ่ม 0.5 มม."));
    expect(await clickHub(u)).toBe(true);
    await stay(u);
  });
});

describe("R6: ผลวัด — ปุ่มใหม่ + ลิงก์ท้ายหน้า (N11 · N12 · N17)", () => {
  async function toR6(circ: number) {
    seedCalibration();
    seedLastResult({ circ, method: "A", ref: "coin" });
    const u = user();
    render(<RingSizeClient />);
    await u.click(await screen.findByRole("button", { name: "ดูผลอีกครั้ง" }));
    expect(screen.getByTestId("result-size")).toBeInTheDocument();
    return u;
  }

  it("normal: ปุ่ม 'ดูแหวนด้วยเบอร์ N' = <a href='/ring-builder'> เปล่าๆ (ไม่มี query/hash ใดๆ) · ≥44px · อยู่ก่อนปุ่มแบบทดสอบพลอย · ไม่ target", async () => {
    await toR6(54);
    const a = screen.getByRole("link", { name: "ดูแหวนด้วยเบอร์ 54" });
    expect(SHOWCASE_PATH).toBe("/ring-builder");
    expect(a.getAttribute("href")).toBe("/ring-builder"); // N11: ไม่พกเบอร์/ค่าวัด
    expect(a).not.toHaveAttribute("target");
    expect(a.className).toMatch(/min-h-\[(52|56)px\]/);
    const quiz = screen.getByRole("link", { name: "เล่นเกม: คุณเหมาะกับพลอยอะไร" });
    expect(a.compareDocumentPosition(quiz) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("between: ใช้เบอร์ที่แนะนำ (ใหญ่กว่า) ตามที่แสดง", async () => {
    await toR6(54.4);
    const shown = screen.getByTestId("result-size").textContent;
    expect(screen.getByRole("link", { name: `ดูแหวนด้วยเบอร์ ${shown}` })).toHaveAttribute("href", "/ring-builder");
  });

  it("N17: เบอร์นอกช่วงร้าน (variant out) ไม่แสดงปุ่ม 'ดูแหวนด้วยเบอร์ N'", async () => {
    await toR6(75);
    expect(screen.getByText(/อยู่นอกช่วงที่ร้านทำ/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /ดูแหวนด้วยเบอร์/ })).toBeNull();
  });

  it("N12: กดปุ่มใหม่ไม่ยิง trackCta (ไม่มี beacon/fetch เพิ่ม) — ไม่เพิ่มค่า cta ใหม่", async () => {
    const beacon = vi.fn(() => true);
    Object.defineProperty(navigator, "sendBeacon", { value: beacon, configurable: true, writable: true });
    const fetchSpy = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchSpy);
    const u = await toR6(54);
    const sentBefore = beacon.mock.calls.length + fetchSpy.mock.calls.length;
    await u.click(screen.getByRole("link", { name: "ดูแหวนด้วยเบอร์ 54" }));
    await u.click(screen.getByRole("link", { name: "กลับหน้าเครื่องมือ" }));
    await u.click(hub());
    expect(beacon.mock.calls.length + fetchSpy.mock.calls.length).toBe(sentBefore);
    vi.unstubAllGlobals();
    delete (navigator as unknown as Record<string, unknown>).sendBeacon;
  });

  it("ลิงก์ hub 2 จุด (ขวาบน nav · ท้ายหน้า '← กลับหน้าเครื่องมือ') ไม่ถาม · LINE/แชร์/ร้าน/วัดใหม่/วิธีอื่นยังอยู่ครบ (M7 · Q4)", async () => {
    const u = await toR6(54);
    expect(screen.getByRole("link", { name: "กลับหน้าเครื่องมือ" })).toHaveAttribute("href", "/");
    expect(await clickHub(u)).toBe(false);
    await u.click(screen.getByRole("link", { name: "กลับหน้าเครื่องมือ" }));
    expect(dialog()).toBeNull();
    expect(linkClicks.at(-1)).toMatchObject({ href: "/", prevented: false });
    expect(screen.getByRole("button", { name: "แชร์ / บันทึกผลเป็นรูป" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "วัดใหม่" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ลองวิธีอื่น" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /สั่ง\/ถามแหวนไซส์นี้ทาง LINE/ })).toBeInTheDocument();
  });

  it("ปุ่มถอยบน R6 ยังพากลับ R0 (ผลล่าสุดจากหน้าแรก) ได้ — M11", async () => {
    const u = await toR6(54);
    await u.click(btn("ย้อนกลับ"));
    await waitFor(() => expect(screen.getByRole("button", { name: "ดูผลอีกครั้ง" })).toBeInTheDocument());
  });
});
