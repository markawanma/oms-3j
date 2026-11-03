// @vitest-environment jsdom
// QA ข้ามชั้น (P2 · design-ring-size-analytics §9 เคส 14 16 17 21 22):
//   RingSizeClient จริง + track.ts จริง  →  ดักทุก body ที่ขึ้นสาย (sendBeacon / fetch keepalive)  →  ยิงเข้า POST ของ route จริง
//   (app/api/ring-size/event/route.ts · mock เฉพาะ I/O: service client + getDevShopId)
// เป้า: body ที่ client สร้าง "ต้องผ่านด่านของ route ทุกก้อน" (ก้อนที่ถูกปฏิเสธ = ข้อมูลหายเงียบบน prod เพราะ client ไม่อ่าน response)
// + สัญญา event ที่ DB นับ "ทุกครั้งที่ field โผล่" (ผลวัดเฉพาะ stage 7 · cta ไม่พกผล · g4 เฉพาะ G4 · ไม่มี src/source)
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { circToRec } from "@/lib/ring-size/size";
import { resetTrackStateForTests } from "@/lib/ring-size/track";
import { RING_SNAPSHOT_KEYS } from "@/lib/ring-size/track-schema";
import { RingSizeClient } from "../RingSizeClient";
import { LineCta } from "../_components/LineCta";
import { mockRects, resetBrowserState, seedCalibration, seedLastResult, setVisualViewport } from "./setup.test-util";

const { rpcMock, shopIdMock } = vi.hoisted(() => ({ rpcMock: vi.fn(), shopIdMock: vi.fn() }));
vi.mock("@/lib/dev/context", () => ({ getDevShopId: () => shopIdMock() }));
vi.mock("@/lib/supabase/server", () => ({ getServiceClient: () => ({ schema: () => ({ rpc: rpcMock }) }) }));

import { POST } from "@/app/api/ring-size/event/route";

type Body = Record<string, unknown>;
interface Wire {
  via: "beacon" | "fetch";
  text: string;
  contentType: string;
}

const HOST = "app.example.test"; // ค่าทดสอบ — ไม่ใช่โดเมนจริง
const ORIGIN = `https://${HOST}`;
const SHOP = "11111111-1111-1111-1111-111111111111";
const RESULT_KEYS = ["circ_mm", "size", "between"] as const;
const hasResult = (b: Body) => RESULT_KEYS.some((k) => k in b);

const restorers: Array<() => void> = [];
function setNav(key: string, value: unknown) {
  const had = Object.getOwnPropertyDescriptor(navigator, key);
  Object.defineProperty(navigator, key, { value, configurable: true, writable: true });
  restorers.push(() => {
    if (had) Object.defineProperty(navigator, key, had);
    else delete (navigator as unknown as Body)[key];
  });
}

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(blob);
  });
}

/** ดักช่องส่งทั้งสอง — beacon ก่อน (คืน true) หรือ fetch ล้วน (เมื่อ viaFetch) */
function installWire(viaFetch = false) {
  const wires: Wire[] = [];
  const pending: Array<Promise<void>> = [];
  if (viaFetch) {
    setNav("sendBeacon", undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: { body: string; headers: Record<string, string>; keepalive?: boolean; credentials?: string }) => {
        expect(init.keepalive).toBe(true);
        expect(init.credentials).toBe("omit");
        wires.push({ via: "fetch", text: init.body, contentType: init.headers["Content-Type"] });
        return Promise.resolve({ ok: true });
      })
    );
  } else {
    setNav(
      "sendBeacon",
      vi.fn((url: string, data: Blob) => {
        expect(url).toBe("/api/ring-size/event");
        pending.push(readBlob(data).then((text) => void wires.push({ via: "beacon", text, contentType: data.type })));
        return true;
      })
    );
  }
  return {
    wires: async () => {
      await Promise.all(pending);
      return wires;
    },
  };
}

/**
 * NextRequest จริงใช้ใน jsdom ไม่ได้: undici ส่ง chunk เป็น Uint8Array ข้าม realm → `value instanceof Uint8Array` ใน route เป็น false
 * (ได้ 400 "อ่าน body ไม่สำเร็จ" กับ body ที่ถูกต้อง — เป็นข้อจำกัดของสภาพแวดล้อมเทสต์ ไม่ใช่บั๊กของ route · route.test.ts ใน node env ครอบ NextRequest จริงแล้ว)
 * จึงส่ง request แบบ duck-typed ที่มี headers + body stream ชนิดเดียวกับที่ route อ่านจริง — โค้ดของ route รันจริงทุกบรรทัด
 */
function makeRequest(w: Wire): NextRequest {
  const bytes = new Uint8Array(Buffer.from(w.text, "utf-8"));
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(bytes);
      c.close();
    },
  });
  const headers = new Headers({ host: HOST, origin: ORIGIN, "content-type": w.contentType || "text/plain", "content-length": String(bytes.byteLength) });
  return { headers, body } as unknown as NextRequest;
}

/**
 * ยิงทุกก้อนเข้า route จริง → ต้อง 204 ทุกก้อน · RPC ได้ (sid, snapshot ตรงกับที่ client ส่งเป๊ะ — route ไม่ตัด/ไม่เติม field)
 * + สัญญา event ฝั่ง wire
 */
async function replayAndCheck(wires: Wire[]): Promise<Body[]> {
  rpcMock.mockClear();
  const bodies: Body[] = [];
  for (const w of wires) {
    const res = await POST(makeRequest(w));
    expect(res.status, `route ปฏิเสธ body นี้ (ข้อมูลจะหายเงียบบน prod): ${w.text}`).toBe(204);
    expect(Buffer.byteLength(w.text, "utf-8"), "เพดาน 1 KB ของ route").toBeLessThanOrEqual(1024);
    bodies.push(JSON.parse(w.text) as Body);
  }
  expect(rpcMock).toHaveBeenCalledTimes(wires.length);
  rpcMock.mock.calls.forEach(([name, params], i) => {
    const { sid, ...snapshot } = bodies[i];
    expect(name).toBe("ring_size_session_upsert");
    expect(params).toEqual({ p_shop_id: SHOP, p_session_id: sid, p_snapshot: snapshot });
  });
  assertEventContract(bodies);
  return bodies;
}

function assertEventContract(bodies: Body[]) {
  for (const b of bodies) {
    const label = JSON.stringify(b);
    for (const k of Object.keys(b)) expect(["sid", ...RING_SNAPSHOT_KEYS], `key แปลก ${k}`).toContain(k);
    expect(label).not.toMatch(/"src"|"source"|"ip"|"ua"|cookie|Mozilla|"in_range"/);
    if (hasResult(b)) {
      expect(b.stage, `ผลวัดนอก stage 7: ${label}`).toBe(7);
      expect(b, `ผลวัดปนกับ cta: ${label}`).not.toHaveProperty("cta");
      expect(b, `ผลวัดปนกับ g4: ${label}`).not.toHaveProperty("g4");
      expect(typeof b.circ_mm).toBe("number");
      expect(Number.isInteger(b.size)).toBe(true);
      expect(typeof b.between).toBe("boolean");
      expect(["A", "B"]).toContain(b.method); // DB ใช้วิธีตอนนั้นตั้ง result_method / measure_count_a/b
    }
    if ("cta" in b) expect(Object.keys(b).sort(), `cta พกของเกิน: ${label}`).toEqual(["cta", "sid", "stage"]);
    if ("g4" in b) {
      expect(b.stage).toBe(7);
      expect(b.g4).toBe(true);
      expect(["A", "B"]).toContain(b.method);
    }
  }
  expect(new Set(bodies.map((x) => x.sid)).size, "ทั้งหน้าเดียวต้อง sid เดียว").toBeLessThanOrEqual(1);
}

/** จำลองการรวมของ DB (monotonic) เฉพาะส่วนที่นับ "ทุกครั้งที่ field โผล่" — ใช้ยืนยันว่าสายที่ client ส่งนับออกมาตรงกับสิ่งที่ผู้ใช้ทำ */
function fold(bodies: Body[]) {
  const s = { maxStage: -1, measure: 0, measureA: 0, measureB: 0, invalidA: 0, invalidB: 0, resultMethod: null as string | null, ctas: [] as string[] };
  for (const b of bodies) {
    s.maxStage = Math.max(s.maxStage, b.stage as number);
    if (b.size !== undefined) {
      s.measure++;
      if (b.method === "A") s.measureA++;
      else s.measureB++;
      s.resultMethod = b.method as string;
    }
    if (b.g4 === true) b.method === "A" ? s.invalidA++ : s.invalidB++;
    if (typeof b.cta === "string") s.ctas.push(b.cta);
  }
  return s;
}

const user = () => userEvent.setup();
const btn = (name: string | RegExp) => screen.getByRole("button", { name });
const RULER = { name: "ไม้บรรทัด ลากเส้นแดงขึ้นลงได้" };
const RING_SLIDER = { name: "ปรับขนาดวงกลมให้เท่ารูแหวน" };

let clock = 0;
beforeEach(() => {
  resetBrowserState();
  mockRects(390, 300);
  resetTrackStateForTests();
  window.sessionStorage.clear();
  clock = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => (clock += 1500)); // throttle 1 วิของผลวัดไม่บังรอบจริง
  setNav("sendBeacon", undefined);
  vi.stubGlobal("fetch", undefined);
  rpcMock.mockReset();
  shopIdMock.mockReset();
  shopIdMock.mockReturnValue(SHOP);
  rpcMock.mockResolvedValue({ data: null, error: null });
  Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(async () => {}) }, configurable: true });
  const block = (e: Event) => e.preventDefault(); // กัน jsdom นำทางจริง (React handler ทำงานก่อน root)
  document.addEventListener("click", block);
  restorers.push(() => document.removeEventListener("click", block));
});
afterEach(() => {
  cleanup();
  while (restorers.length) restorers.pop()!();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetBrowserState();
});

async function paperMeasure(u: ReturnType<typeof user>, ups: number) {
  await u.click(btn(/พันกระดาษรอบนิ้ว/));
  await u.click(btn("พร้อมแล้ว เริ่มวัด"));
  const ruler = screen.getByRole("slider", RULER);
  for (let i = 0; i < ups; i++) fireEvent.keyDown(ruler, { key: "ArrowUp" });
  await u.click(btn("ใช้ค่านี้"));
  expect(screen.getByTestId("result-size")).toBeInTheDocument();
}

describe("ข้ามชั้น: ทุก body ที่ client สร้าง ผ่าน route จริง (204) และ RPC ได้ snapshot เดิมเป๊ะ", () => {
  it("คนใหม่ · เหรียญ · วิธีแหวน: stage 0→7 ครบ (7 พกผล) · ทุกก้อน 204", async () => {
    const w = installWire();
    const u = user();
    render(<RingSizeClient />);
    await u.click(await screen.findByRole("button", { name: "เริ่มวัดไซส์" }));
    await u.click(btn(/เหรียญ 10 บาท/));
    await u.click(btn("ขยายวงกลมทีละนิด"));
    await u.click(btn("วงกลมเท่าเหรียญแล้ว"));
    await u.click(btn(/วางแหวนวงเดิมบนจอ/));
    await u.click(btn("พร้อมแล้ว เริ่มวัด"));
    await u.click(btn("เพิ่มขนาดวงกลมทีละนิด"));
    await u.click(btn("ใช้ค่านี้"));
    const bodies = await replayAndCheck(await w.wires());
    expect(bodies.map((b) => b.stage)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(fold(bodies)).toMatchObject({ maxStage: 7, measure: 1, measureA: 1, resultMethod: "A" });
  });

  it("คนกลับมา · วิธีกระดาษ · ผลระหว่างเบอร์ (between=true) · กระโดด 1→5", async () => {
    seedCalibration();
    const w = installWire();
    const u = user();
    render(<RingSizeClient />);
    await u.click(await screen.findByRole("button", { name: "เริ่มวัดไซส์" }));
    await paperMeasure(u, 5); // 47.5 → ระหว่างเบอร์
    expect(circToRec(47.5, "B")!.between).not.toBeNull();
    const bodies = await replayAndCheck(await w.wires());
    expect(bodies.map((b) => b.stage)).toEqual([0, 1, 5, 6, 7]);
    expect(bodies[0]).toMatchObject({ is_return: true });
    expect(bodies[4]).toMatchObject({ between: true, method: "B" });
  });

  it("G1 ซูม (เทียบจอ + จอวัด) · G3 (ค่านอกช่วงปกติ) · G5 (ค่าเทียบเก่าไม่ตรง) — ทุกธงผ่าน route", async () => {
    // G3
    const w1 = installWire();
    const u = user();
    render(<RingSizeClient />);
    await u.click(await screen.findByRole("button", { name: "เริ่มวัดไซส์" }));
    await u.click(btn(/เหรียญ 10 บาท/));
    fireEvent.change(screen.getByRole("slider", { name: "ปรับขนาดวงกลมเทียบเหรียญ" }), { target: { value: "3.5" } });
    await u.click(btn("วงกลมเท่าเหรียญแล้ว"));
    await u.click(btn("ถูกต้องแล้ว ใช้ค่านี้"));
    const g3 = await replayAndCheck(await w1.wires());
    expect(g3.some((b) => b.g3 === true && b.stage === 4)).toBe(true);

    // G5
    cleanup();
    resetBrowserState();
    mockRects(390, 300);
    resetTrackStateForTests();
    seedCalibration({ ref: "coin", dpr: 3 });
    const w2 = installWire();
    render(<RingSizeClient />);
    await u.click(await screen.findByRole("button", { name: "เริ่มวัดไซส์" }));
    fireEvent.change(screen.getByRole("slider"), { target: { value: "6" } });
    await u.click(btn("วงกลมเท่าเหรียญแล้ว"));
    const g5 = await replayAndCheck(await w2.wires());
    expect(g5.some((b) => b.g5 === true && b.stage === 4)).toBe(true);

    // G1 ที่จอเทียบ + จอวัด
    cleanup();
    resetBrowserState();
    mockRects(390, 300);
    resetTrackStateForTests();
    setVisualViewport({ scale: 1.6, height: 700, addEventListener: () => {}, removeEventListener: () => {} } as unknown as VisualViewport);
    seedCalibration();
    const w3 = installWire();
    render(<RingSizeClient />);
    await u.click(await screen.findByRole("button", { name: "เริ่มวัดไซส์" }));
    await u.click(btn(/วางแหวนวงเดิมบนจอ/));
    await u.click(btn("พร้อมแล้ว เริ่มวัด"));
    const g1 = await replayAndCheck(await w3.wires());
    expect(g1.filter((b) => b.g1 === true).map((b) => `${b.stage}${b.method ?? ""}`)).toEqual(["6A"]);
  });

  it("G4 (วัดผิดปกติ) แล้ววัดใหม่ได้ผล: g4 ไม่พกเบอร์ · ผลมาแยก event · นับ invalid 1 / measure 1", async () => {
    seedCalibration();
    const w = installWire();
    const u = user();
    render(<RingSizeClient />);
    await u.click(await screen.findByRole("button", { name: "เริ่มวัดไซส์" }));
    await u.click(btn(/วางแหวนวงเดิมบนจอ/));
    await u.click(btn("พร้อมแล้ว เริ่มวัด"));
    fireEvent.change(screen.getByRole("slider", RING_SLIDER), { target: { value: "12" } });
    await u.click(btn("ใช้ค่านี้"));
    expect(screen.getByRole("alert")).toHaveTextContent("ค่านี้อยู่นอกช่วงที่เครื่องมือวัดได้");
    await u.click(btn("วัดใหม่"));
    fireEvent.change(screen.getByRole("slider", RING_SLIDER), { target: { value: "14" } });
    await u.click(btn("ใช้ค่านี้"));
    const bodies = await replayAndCheck(await w.wires());
    expect(fold(bodies)).toMatchObject({ invalidA: 1, invalidB: 0, measure: 1, measureA: 1, maxStage: 7 });
  });

  it("2 วิธีใน session เดียว (B → A → B): measure_count แยกวิธี · result_method = วิธีของผลล่าสุด · stage 5/6 ตามวิธีที่เปลี่ยน", async () => {
    seedCalibration();
    const w = installWire();
    const u = user();
    render(<RingSizeClient />);
    await u.click(await screen.findByRole("button", { name: "เริ่มวัดไซส์" }));
    await paperMeasure(u, 1); // B ผลที่ 1
    await u.click(btn("ลองวิธีอื่น")); // → A
    await u.click(btn("พร้อมแล้ว เริ่มวัด"));
    fireEvent.change(screen.getByRole("slider", RING_SLIDER), { target: { value: "15" } });
    await u.click(btn("ใช้ค่านี้")); // A ผลที่ 2
    expect(screen.getByTestId("result-size")).toBeInTheDocument();
    await u.click(btn("ลองวิธีอื่น")); // → B
    await u.click(btn("พร้อมแล้ว เริ่มวัด"));
    fireEvent.keyDown(screen.getByRole("slider", RULER), { key: "ArrowDown" });
    await u.click(btn("ใช้ค่านี้")); // B ผลที่ 3
    const bodies = await replayAndCheck(await w.wires());
    expect(fold(bodies)).toMatchObject({ measure: 3, measureA: 1, measureB: 2, resultMethod: "B", invalidA: 0, invalidB: 0 });
    expect(bodies.filter((b) => b.stage === 6).map((b) => b.method)).toEqual(["B", "A", "B"]);
  });

  it("วัด 3 รอบ (วิธีเดียว): 3 event ผล · แต่ละก้อนผ่าน route · stage 5/6 ส่งครั้งเดียว", async () => {
    seedCalibration();
    const w = installWire();
    const u = user();
    render(<RingSizeClient />);
    await u.click(await screen.findByRole("button", { name: "เริ่มวัดไซส์" }));
    for (let round = 0; round < 3; round++) {
      if (round > 0) await u.click(btn("วัดใหม่"));
      await paperMeasure(u, 1);
    }
    const bodies = await replayAndCheck(await w.wires());
    expect(fold(bodies)).toMatchObject({ measure: 3, measureB: 3, resultMethod: "B" });
    expect(bodies.filter((b) => b.stage === 5)).toHaveLength(1);
    expect(bodies.filter((b) => b.stage === 6)).toHaveLength(1);
  });

  it("CTA ทุกตัวที่กดได้จริงบน prod config (share · gem_quiz · line ทั้ง 3 ทาง): พกแค่ stage+cta · ไม่เพิ่ม measure · ผ่าน route", async () => {
    seedCalibration();
    const w = installWire();
    const u = user();
    render(<RingSizeClient />);
    await u.click(await screen.findByRole("button", { name: "เริ่มวัดไซส์" }));
    await paperMeasure(u, 1);
    await u.click(btn("แชร์ / บันทึกผลเป็นรูป"));
    await u.click(screen.getByRole("link", { name: "เล่นเกม: คุณเหมาะกับพลอยอะไร" }));
    await u.click(screen.getByRole("link", { name: "เปิดแชท LINE" })); // ลิงก์สำรอง
    const bodies = await replayAndCheck(await w.wires());
    const s = fold(bodies);
    expect(s.ctas.sort()).toEqual(["gem_quiz", "line", "share"]);
    expect(s.measure).toBe(1); // CTA ไม่เพิ่มรอบวัด
    expect(s.maxStage).toBe(7);
  });

  it("LINE หลัก (copyThenOpen) ผ่าน route · beacon ก่อน navigate", async () => {
    const order: string[] = [];
    const w = installWire();
    const beacon = navigator.sendBeacon as unknown as ReturnType<typeof vi.fn>;
    const orig = beacon.getMockImplementation()!;
    beacon.mockImplementation((url: string, data: Blob) => {
      order.push("beacon");
      return orig(url, data);
    });
    const navigate = vi.fn(() => void order.push("navigate"));
    render(<LineCta input={{ size: circToRec(54, "A")!, method: "A", ref: "coin" }} label="L" navigate={navigate} />);
    await user().click(screen.getByRole("button", { name: "L" }));
    await vi.waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(order).toEqual(["beacon", "navigate"]);
    const bodies = await replayAndCheck(await w.wires());
    expect(bodies).toEqual([{ sid: bodies[0].sid, stage: 7, cta: "line" }]);
  });

  it("ดูผลเดิม (viewLastResult) แล้วกด CTA: ไม่มี event ผล · measure = 0 · stage 7 มาจาก cta เท่านั้น", async () => {
    seedCalibration();
    seedLastResult({ circ: 54, method: "A", ref: "coin" });
    const w = installWire();
    const u = user();
    render(<RingSizeClient />);
    await u.click(await screen.findByRole("button", { name: "ดูผลอีกครั้ง" }));
    await u.click(btn("แชร์ / บันทึกผลเป็นรูป"));
    const bodies = await replayAndCheck(await w.wires());
    expect(bodies.filter(hasResult)).toHaveLength(0);
    expect(fold(bodies)).toMatchObject({ measure: 0, ctas: ["share"] });
  });

  it("ช่อง fetch keepalive (ไม่มี sendBeacon): body เดียวกัน ผ่าน route ทุกก้อน · header มีแค่ Content-Type", async () => {
    seedCalibration();
    const w = installWire(true);
    const u = user();
    render(<RingSizeClient />);
    await u.click(await screen.findByRole("button", { name: "เริ่มวัดไซส์" }));
    await paperMeasure(u, 1);
    await u.click(btn("แชร์ / บันทึกผลเป็นรูป"));
    const wires = await w.wires();
    expect(wires.length).toBeGreaterThan(4);
    expect(wires.every((x) => x.via === "fetch" && x.contentType === "application/json")).toBe(true);
    const bodies = await replayAndCheck(wires);
    expect(fold(bodies)).toMatchObject({ measure: 1, ctas: ["share"] });
  });

  it("UA เป็นเว็บวิวของ LINE/TikTok/FB/IG ผ่าน route และไม่มี UA ดิบในสาย", async () => {
    for (const ua of [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Line/13.5.0",
      "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 BytedanceWebview/d8a21c6",
      "Mozilla/5.0 (iPhone) AppleWebKit/605 [FBAN/FBIOS;FBAV/450.0]",
      "Mozilla/5.0 (iPhone) AppleWebKit/605 Instagram 300.0",
      "", // ว่าง = unknown
    ]) {
      cleanup();
      resetTrackStateForTests();
      const w = installWire();
      setNav("userAgent", ua);
      render(<RingSizeClient />);
      const bodies = await replayAndCheck(await w.wires());
      expect(["line", "tiktok", "fb", "ig", "unknown"]).toContain(bodies[0].in_app);
      expect(JSON.stringify(bodies)).not.toMatch(/Mozilla|Bytedance|FBAN|Instagram/);
    }
  });
});

describe("ต้องไม่พัง: รีโหลดหน้า (เปิดหน้าใหม่ในแท็บเดิม) ใช้ sid เดิม · sid ผ่านด่าน route", () => {
  it("sid ใน sessionStorage ถูกใช้ซ้ำหลัง reset state ของหน้า · ค่าใน sessionStorage ที่เสีย → สร้างใหม่ที่ route รับ", async () => {
    const w1 = installWire();
    render(<RingSizeClient />);
    const first = await replayAndCheck(await w1.wires());
    cleanup();
    resetTrackStateForTests(); // เหมือนรีโหลด: หน่วยความจำหาย sessionStorage อยู่
    const w2 = installWire();
    render(<RingSizeClient />);
    const second = await replayAndCheck(await w2.wires());
    expect(second[0].sid).toBe(first[0].sid);

    cleanup();
    resetTrackStateForTests();
    window.sessionStorage.setItem("ringSize:sid:v1", "not-a-uuid'; drop table x;--");
    const w3 = installWire();
    render(<RingSizeClient />);
    const third = await replayAndCheck(await w3.wires());
    expect(third[0].sid).not.toBe("not-a-uuid'; drop table x;--");
  });
});
