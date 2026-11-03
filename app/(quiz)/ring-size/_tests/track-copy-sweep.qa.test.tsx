// @vitest-environment jsdom
// QA copy (design-ring-size-analytics §4.4 · §9 เคส 23): TRACK_ENABLED เปิด (ค่า default จริง) —
//   (1) COPY.r6.privacy ตรงประโยคใน design §4.4 ทุกตัวอักษร (อ่านจากเอกสารจริง ไม่ใช่ลอกซ้ำในเทสต์)
//   (2) ทุกจอที่ผู้ใช้เห็นระหว่าง flow ไม่มี "จนกว่าคุณจะกดส่ง" / "ร้านนับสถิติรวม" / "ไม่ได้รับชื่อหรือข้อมูลส่วนตัว"
//   (3) ข้อความความเป็นส่วนตัวไม่พูดเกิน/น้อยกว่าที่ track.ts ส่งจริง: ล็อกชุด key ที่ขึ้นสายจริงทั้ง flow — เพิ่ม/ลด field = เทสต์ล้ม บังคับทบทวนถ้อยคำ
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COPY, TRACK_ENABLED } from "@/lib/ring-size/config";
import { resetTrackStateForTests } from "@/lib/ring-size/track";
import { RingSizeClient } from "../RingSizeClient";
import { mockRects, resetBrowserState, seedCalibration } from "./setup.test-util";

const user = () => userEvent.setup();
const btn = (name: string | RegExp) => screen.getByRole("button", { name });
const restorers: Array<() => void> = [];

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(blob);
  });
}

beforeEach(() => {
  resetBrowserState();
  mockRects(390, 300);
  resetTrackStateForTests();
  window.sessionStorage.clear();
  let clock = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => (clock += 1500));
  vi.stubGlobal("fetch", undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(async () => {}) }, configurable: true });
  const block = (e: Event) => e.preventDefault();
  document.addEventListener("click", block);
  restorers.push(() => document.removeEventListener("click", block));
});
afterEach(() => {
  cleanup();
  while (restorers.length) restorers.pop()!();
  delete (navigator as unknown as Record<string, unknown>).sendBeacon;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetBrowserState();
});

describe("(1) ถ้อยคำตรงเอกสารที่เจ้าของอนุมัติ", () => {
  it("COPY.r6.privacy เท่ากับประโยคใน design-ring-size-analytics.md §4.4 ทุกตัวอักษร (อ่านจากไฟล์)", () => {
    const doc = readFileSync(join(process.cwd(), "docs/3j-jewelry/oms/design-ring-size-analytics.md"), "utf8");
    const m = /`COPY\.r6\.privacy` แทนทั้งประโยค: "([^"\n]+)"/.exec(doc);
    expect(m, "ไม่พบประโยค §4.4 ในเอกสาร").not.toBeNull();
    expect(COPY.r6.privacy).toBe(m![1]);
  });

  it("flag เปิดอยู่จริง (ไม่ใช่เทสต์ที่รันตอนปิดแล้วผ่านเฉยๆ)", () => {
    expect(TRACK_ENABLED).toBe(true);
  });
});

describe("(2)+(3) เดินทั้ง flow ตอนเปิดสถิติ", () => {
  it("ทุกจอ: ไม่มีคำสัญญาเดิม · R1Pick/R6 ใช้ข้อความใหม่ · key ที่ขึ้นสายจริงตรงกับที่ถ้อยคำครอบคลุม", async () => {
    const sent: string[] = [];
    const pending: Array<Promise<void>> = [];
    Object.defineProperty(navigator, "sendBeacon", {
      value: (_u: string, d: Blob) => (pending.push(readBlob(d).then((t) => void sent.push(t))), true),
      configurable: true,
      writable: true,
    });
    const seen: string[] = [];
    const snap = () => seen.push(document.body.textContent ?? "");
    seedCalibration({ ref: "coin", dpr: 3 }); // ค่าเทียบเก่าไม่ตรงเครื่อง → ได้ G5
    const u = user();
    render(<RingSizeClient />);
    snap(); // R0
    await u.click(await screen.findByRole("button", { name: "เริ่มวัดไซส์" })); // G5 → เด้งไปจอเทียบ
    snap();
    fireEvent.change(screen.getByRole("slider"), { target: { value: "3.5" } }); // ค่านอกช่วง → G3
    await u.click(btn("วงกลมเท่าเหรียญแล้ว"));
    snap(); // G3 sheet
    await u.click(btn("ถูกต้องแล้ว ใช้ค่านี้"));
    snap(); // R3
    await u.click(btn(/วางแหวนวงเดิมบนจอ/));
    await u.click(btn("พร้อมแล้ว เริ่มวัด"));
    snap(); // R5A
    fireEvent.change(screen.getByRole("slider", { name: "ปรับขนาดวงกลมให้เท่ารูแหวน" }), { target: { value: "2" } });
    await u.click(btn("ใช้ค่านี้")); // ค่า 2 มม. = ผิดปกติ → G4
    snap();
    await vi.waitFor(() => expect(sent.length).toBeGreaterThan(3));

    for (const t of seen) {
      expect(t).not.toContain("จนกว่าคุณจะกดส่ง");
      expect(t).not.toContain("ร้านนับสถิติรวม");
      expect(t).not.toMatch(/ไม่ได้รับชื่อหรือข้อมูลส่วนตัว/);
    }

    await Promise.all(pending);
    const keys = new Set(sent.flatMap((t) => Object.keys(JSON.parse(t) as object)));
    // ชุด field ที่ client ส่งได้ทั้งหมดในสายจริง (sid = สุ่มต่อแท็บ ไม่ใช่รหัสเครื่อง) — ถ้อยคำ §4.4 ครอบ:
    //   "เบอร์ที่วัดได้"(size · circ_mm · between) · "วิธีวัด"(method) · "ปุ่มที่กด"(cta) · "ประเภทแอป"(in_app) · "เช่น" = ตัวอย่าง ไม่ใช่รายการครบ
    //   ที่ถ้อยคำไม่ได้ระบุชื่อ (อยู่ใต้ "เช่น"): stage(ขั้นที่ไปถึง) · is_return(เคยมีค่าเทียบ/ผลในเครื่อง) · ref(เหรียญ/บัตร) · g1/g3/g4/g5(ธงเตือนจอ/ค่าผิดปกติ)
    expect([...keys].sort()).toEqual(["g3", "g4", "g5", "in_app", "is_return", "method", "ref", "sid", "stage"].sort());
  });

  it("ผลวัดถึง R6: ข้อความ R1Pick/R6 ตรงข้อความใหม่เป๊ะ · ไม่มีข้อความ *Off ปน", async () => {
    const sent: string[] = [];
    const pending: Array<Promise<void>> = [];
    Object.defineProperty(navigator, "sendBeacon", {
      value: (_u: string, d: Blob) => (pending.push(readBlob(d).then((t) => void sent.push(t))), true),
      configurable: true,
      writable: true,
    });
    const u = user();
    render(<RingSizeClient />);
    await u.click(await screen.findByRole("button", { name: "เริ่มวัดไซส์" }));
    expect(screen.getByText(COPY.pick.privacyBody)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(COPY.pick.privacyBodyOff);
    cleanup();
    resetBrowserState();
    mockRects(390, 300);
    seedCalibration();
    render(<RingSizeClient />);
    await u.click(await screen.findByRole("button", { name: "เริ่มวัดไซส์" }));
    await u.click(btn(/พันกระดาษรอบนิ้ว/));
    await u.click(btn("พร้อมแล้ว เริ่มวัด"));
    fireEvent.keyDown(screen.getByRole("slider", { name: "ไม้บรรทัด ลากเส้นแดงขึ้นลงได้" }), { key: "ArrowUp" });
    await u.click(btn("ใช้ค่านี้"));
    expect(screen.getByText(COPY.r6.privacy)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(COPY.r6.privacyOff);
    expect(document.body.textContent).not.toContain("จนกว่าคุณจะกดส่ง");

    // ชุด key ของ flow วัด + ปุ่ม: "เบอร์ที่วัดได้"=size/circ_mm/between · "วิธีวัด"=method · "ปุ่มที่กด"=cta · "ประเภทแอป"=in_app (ไม่มี used_a/used_b/saw_between/in_range/src)
    await u.click(btn("แชร์ / บันทึกผลเป็นรูป"));
    await Promise.all(pending);
    const keys = new Set(sent.flatMap((t) => Object.keys(JSON.parse(t) as object)));
    expect([...keys].sort()).toEqual(["between", "circ_mm", "cta", "in_app", "is_return", "method", "sid", "size", "stage"].sort());
  });
});
