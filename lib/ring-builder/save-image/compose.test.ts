// @vitest-environment jsdom
// compose + make-image — S1 ข้อความ whitelist/ไม่มี URL · S2/S3 ไม่มี network/storage · S10 ภาพว่าง · S11 un-premultiply · S15 รอฟอนต์ · N11 ปล่อย canvas
import { afterEach, describe, expect, it, vi } from "vitest";
import { SHOWCASE_COPY } from "@/lib/ring-builder/showcase/config";
import { buildShowcaseDetailRows } from "@/lib/ring-builder/showcase/detail-rows";
import { ensureFonts, composeSaveImage, readSaveTheme, saveImageTexts, type ComposeEnv, type SaveTheme } from "./compose";
import { makeSaveImage, saveFileName } from "./make-image";
import { STAGE_H, STAGE_W } from "./layout";

const THEME: SaveTheme = { ivory: "i", text: "t", textMuted: "m", border: "b", borderSoft: "bs", divider: "d", burgundyDark: "bd", sans: "SansX", display: "DispX, serif" };
const INPUT = { designId: "bypass2", choice: { kind: "direct" }, size: 56 } as const;
const rows = () => buildShowcaseDetailRows(INPUT)!.map((r) => ({ label: r.label, value: r.value }));

function solidRgba(a = 255, rgb = 200): Uint8Array {
  const px = new Uint8Array(STAGE_W * STAGE_H * 4);
  for (let i = 0; i < px.length; i += 4) {
    px[i] = px[i + 1] = px[i + 2] = rgb;
    px[i + 3] = a;
  }
  return px;
}

function fakeEnv() {
  const texts: string[] = [];
  const order: string[] = [];
  const putImageData = vi.fn();
  const canvases: { width: number; height: number; toBlob: ReturnType<typeof vi.fn> }[] = [];
  const grad = { addColorStop: vi.fn() };
  const ctx = {
    fillRect: vi.fn(),
    fillText: vi.fn((t: string) => {
      order.push("draw");
      texts.push(t);
    }),
    measureText: vi.fn((t: string) => ({ width: t.length * 10 })),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arcTo: vi.fn(),
    arc: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    drawImage: vi.fn(),
    createLinearGradient: vi.fn(() => grad),
    createRadialGradient: vi.fn(() => grad),
    createImageData: vi.fn((w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) })),
    putImageData,
  };
  const createCanvas = () => {
    const c = { width: 0, height: 0, getContext: vi.fn(() => ctx), toBlob: vi.fn((cb: (b: Blob | null) => void) => cb(new Blob(["x"], { type: "image/jpeg" }))) };
    canvases.push(c);
    return c as unknown as HTMLCanvasElement;
  };
  const fonts = {
    load: vi.fn(async () => {
      order.push("fontload");
    }),
    ready: Promise.resolve().then(() => {
      order.push("fontready");
    }),
  };
  const env: ComposeEnv = { createCanvas, fonts };
  return { env, ctx, texts, order, putImageData, canvases, fonts };
}

afterEach(() => vi.restoreAllMocks());

describe("composeSaveImage", () => {
  it("คืน JPEG blob q0.92 กว้าง 1080 · สูงตามแถว · ปล่อย canvas ทุกใบ (width=0)", async () => {
    const f = fakeEnv();
    const out = await composeSaveImage({ rgba: solidRgba(), rows: rows(), dateText: "25/11/2569", theme: THEME }, f.env);
    expect(out.width).toBe(1080);
    expect(out.height).toBeGreaterThan(112 + 810);
    expect(out.blob.size).toBeGreaterThan(0);
    const outCanvas = f.canvases[1] as unknown as { toBlob: ReturnType<typeof vi.fn> };
    expect(outCanvas.toBlob.mock.calls[0].slice(1)).toEqual(["image/jpeg", 0.92]);
    for (const c of f.canvases) {
      expect(c.width).toBe(0);
      expect(c.height).toBe(0);
    }
  });

  it("S15: โหลดฟอนต์ + fonts.ready เสร็จก่อนวาดข้อความตัวแรก", async () => {
    const f = fakeEnv();
    await composeSaveImage({ rgba: solidRgba(), rows: rows(), dateText: "25/11/2569", theme: THEME }, f.env);
    expect(f.fonts.load).toHaveBeenCalled();
    expect(f.order.indexOf("draw")).toBeGreaterThan(f.order.lastIndexOf("fontload"));
    expect(f.order.indexOf("draw")).toBeGreaterThan(f.order.indexOf("fontready"));
  });

  it("S1: ข้อความที่วาดทุกตัวมาจาก whitelist (แถว + SHOWCASE_COPY) · สแกนไม่พบ URL/โดเมน/@/line.me", async () => {
    const f = fakeEnv();
    const r = rows();
    await composeSaveImage({ rgba: solidRgba(), rows: r, dateText: "25/11/2569", theme: THEME }, f.env);
    const allowed = saveImageTexts(r, "25/11/2569");
    expect(f.texts.length).toBeGreaterThan(10);
    for (const t of f.texts) {
      expect(allowed.some((a) => a.includes(t) || t.split(/\s+/).every((w) => a.includes(w))), `ข้อความนอก whitelist: ${t}`).toBe(true);
      expect(t).not.toMatch(/https?:|\.com|\.co\.th|@|line\.me/i);
    }
    for (const a of allowed) expect(a).not.toMatch(/https?:|\.com|\.co\.th|@|line\.me/i);
    expect(f.texts.join("")).toContain("ราคา ณ 25/11/2569");
  });

  it("S11: พิกเซลขอบ premultiplied ถูกหารกลับก่อน putImageData (ไม่มี halo ดำ) · แถวพลิกบนลงล่าง", async () => {
    const f = fakeEnv();
    const px = new Uint8Array(STAGE_W * STAGE_H * 4);
    // แถวล่างสุดของ readPixels (index แถว 0) = ขอบกึ่งโปร่ง 110/128 · แถวบนสุด = ทึบ 50
    px.set([110, 110, 110, 128], 0);
    px.set([50, 50, 50, 255], (STAGE_H - 1) * STAGE_W * 4);
    await composeSaveImage({ rgba: px, rows: rows(), dateText: "25/11/2569", theme: THEME }, f.env);
    const data = (f.ctx.createImageData.mock.results[0].value as { data: Uint8ClampedArray }).data;
    expect(Array.from(data.slice(0, 4))).toEqual([50, 50, 50, 255]); // แถวบนสุดของภาพ = แถวสุดท้ายของ readPixels
    const edge = (STAGE_H - 1) * STAGE_W * 4;
    expect(Math.abs(data[edge] - 220)).toBeLessThanOrEqual(2);
    expect(data[edge + 3]).toBe(128);
  });

  it("toBlob คืน null → throw · canvas ถูกปล่อยแม้ล้ม", async () => {
    const f = fakeEnv();
    const env: ComposeEnv = {
      ...f.env,
      createCanvas: () => {
        const c = f.env.createCanvas() as unknown as { toBlob: (cb: (b: Blob | null) => void) => void };
        c.toBlob = (cb) => cb(null);
        return c as unknown as HTMLCanvasElement;
      },
    };
    await expect(composeSaveImage({ rgba: solidRgba(), rows: rows(), dateText: "x", theme: THEME }, env)).rejects.toThrow();
    for (const c of f.canvases) expect(c.width).toBe(0);
  });

  it("พิกเซลขนาดผิด → throw (ไม่ส่งรูปผิดขนาด)", async () => {
    const f = fakeEnv();
    await expect(composeSaveImage({ rgba: new Uint8Array(100), rows: rows(), dateText: "x", theme: THEME }, f.env)).rejects.toThrow();
  });

  it("S2/S3: ไม่มี network/storage/cookie ระหว่างสร้างภาพ", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const xhr = vi.fn();
    vi.stubGlobal("XMLHttpRequest", xhr);
    const beacon = vi.fn();
    Object.defineProperty(navigator, "sendBeacon", { value: beacon, configurable: true });
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const cookieSet = vi.fn();
    const desc = Object.getOwnPropertyDescriptor(Document.prototype, "cookie")!;
    Object.defineProperty(document, "cookie", { configurable: true, get: () => "", set: cookieSet });
    try {
      const f = fakeEnv();
      await composeSaveImage({ rgba: solidRgba(), rows: rows(), dateText: "25/11/2569", theme: THEME }, f.env);
    } finally {
      delete (document as unknown as Record<string, unknown>).cookie;
      Object.defineProperty(Document.prototype, "cookie", desc);
      vi.unstubAllGlobals();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhr).not.toHaveBeenCalled();
    expect(beacon).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(cookieSet).not.toHaveBeenCalled();
  });
});

describe("ensureFonts / readSaveTheme", () => {
  it("ไม่มี fonts API = ผ่านเลย · load ล้ม = ไม่ throw", async () => {
    await expect(ensureFonts(THEME, ["ก"], null)).resolves.toBeUndefined();
    const bad = { load: vi.fn(async () => Promise.reject(new Error("x"))), ready: Promise.resolve() };
    await expect(ensureFonts(THEME, ["ก"], bad)).resolves.toBeUndefined();
  });

  it("อ่าน token จาก computed style · ขาด token = throw (ไม่เดาสี)", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    expect(() => readSaveTheme(el)).toThrow();
    const vars: Record<string, string> = {
      "--gq-ivory": "#1",
      "--gq-text": "#2",
      "--gq-text-muted": "#3",
      "--gq-border": "#4",
      "--gq-border-soft": "#5",
      "--gq-divider": "#6",
      "--gq-burgundy-dark": "#7",
      "--font-gem-quiz-display": "'Cormorant'",
    };
    vi.spyOn(window, "getComputedStyle").mockReturnValue({ getPropertyValue: (n: string) => vars[n] ?? "", fontFamily: "Plex, sans-serif" } as never);
    const t = readSaveTheme(el);
    expect(t).toMatchObject({ ivory: "#1", burgundyDark: "#7", sans: "Plex, sans-serif", display: "'Cormorant', serif" });
    el.remove();
  });
});

describe("makeSaveImage", () => {
  const readTheme = () => THEME;
  const okCompose = vi.fn(async (_i: unknown, _e?: unknown) => ({ blob: new Blob(["x"], { type: "image/jpeg" }), width: 1080, height: 1700 }));
  const base = (over: Record<string, unknown> = {}) => ({
    capture: vi.fn(() => solidRgba()),
    input: INPUT,
    themeEl: document.body,
    now: new Date(2026, 10, 25),
    deps: { readTheme, compose: okCompose },
    ...over,
  });

  it("สำเร็จ: capture(1080,810) ครั้งเดียว ก่อน compose · File jpeg ชื่อตายตัว · alt = รายละเอียดทั้งหมด", async () => {
    okCompose.mockClear();
    const a = base();
    const p = makeSaveImage(a as never);
    expect(a.capture).toHaveBeenCalledTimes(1); // จับภาพ sync ก่อน await แรก
    expect(a.capture).toHaveBeenCalledWith(1080, 810);
    const r = await p;
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error();
    expect(r.file.type).toBe("image/jpeg");
    expect(r.file.name).toBe("3j-ring-20261125.jpg");
    expect(r.alt).toContain("เบอร์ 56");
    expect(r.alt).toContain(SHOWCASE_COPY.summaryPrice);
    expect(okCompose.mock.calls[0][0]).toMatchObject({ dateText: "25/11/2569" });
  });

  it("S10: capture null / ภาพโปร่งใสทั้งใบ / ขนาดผิด → ok:false ไม่เรียก compose", async () => {
    for (const cap of [() => null, () => solidRgba(0), () => new Uint8Array(10)]) {
      okCompose.mockClear();
      await expect(makeSaveImage(base({ capture: vi.fn(cap) }) as never)).resolves.toEqual({ ok: false });
      expect(okCompose).not.toHaveBeenCalled();
    }
  });

  it("S5/S6: input ไม่ผ่านด่านเดียวกับปุ่ม LINE (ไซซ์นอกช่วง/แบบผิด/พลอยผิด) → ไม่จับภาพ ไม่สร้างรูป", async () => {
    for (const input of [
      { designId: "bypass2", choice: { kind: "direct" }, size: 99 },
      { designId: "nope", choice: { kind: "direct" }, size: null },
      { designId: "bypass2", choice: { kind: "rec", index: 1, top: "x", bottom: "y" }, size: null },
    ]) {
      const a = base({ input });
      await expect(makeSaveImage(a as never)).resolves.toEqual({ ok: false });
      expect(a.capture).not.toHaveBeenCalled();
    }
  });

  it("capture throw / อ่านธีมไม่ได้ / compose throw / เกินเวลา → ok:false ไม่ throw", async () => {
    await expect(makeSaveImage(base({ capture: vi.fn(() => { throw new Error("x"); }) }) as never)).resolves.toEqual({ ok: false });
    await expect(makeSaveImage(base({ deps: { readTheme: () => { throw new Error("x"); }, compose: okCompose } }) as never)).resolves.toEqual({ ok: false });
    await expect(makeSaveImage(base({ deps: { readTheme, compose: vi.fn(async () => Promise.reject(new Error("x"))) } }) as never)).resolves.toEqual({ ok: false });
    vi.useFakeTimers();
    try {
      const never = vi.fn(() => new Promise<never>(() => {}));
      const p = makeSaveImage(base({ deps: { readTheme, compose: never }, timeoutMs: 8000 }) as never);
      await vi.advanceTimersByTimeAsync(8001);
      await expect(p).resolves.toEqual({ ok: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it("ชื่อไฟล์ไม่มีข้อมูลลูกค้า", () => {
    expect(saveFileName(new Date(2026, 0, 5))).toBe("3j-ring-20260105.jpg");
  });
});
