// @vitest-environment jsdom
// lib/ring-size/track.test.ts — client ส่งสถิติ /ring-size (design-ring-size-analytics §4.1 · §9 เคส 13–23)
//
// แผนที่เคส (brief P2) → เทสต์:
//   A ผลวัดนอก stage 7 ไม่ส่ง · B CTA ไม่พกผล · C g4 เฉพาะ G4 · D ไม่มี src/source · E DNT/GPC/TRACK ปิด/SSR ไม่ส่ง · F ไม่ส่งตัวตน
//   ต้องไม่พัง: ไม่มี sendBeacon/fetch · sessionStorage throw · ไม่มี randomUUID · fetch ล่ม → ไม่ throw ไม่ unhandled rejection
//   throttle 1 วิ ไม่กลืนรอบวัดจริงที่ห่างกัน · dedupe ต่อ stage/cta · ทุก body ผ่าน parseRingTrackBody (route รับได้)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const flags = vi.hoisted(() => ({ trackEnabled: true }));
vi.mock("./config", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./config")>();
  return {
    ...orig,
    get TRACK_ENABLED() {
      return flags.trackEnabled;
    },
  };
});

import { MEASURE_THROTTLE_MS, SID_KEY, resetTrackStateForTests, track, trackMeasured, type MeasuredResult, type TrackSnapshot } from "./track";
import { parseRingTrackBody } from "./track-schema";

type Json = Record<string, unknown>;

const URL_EVENT = "/api/ring-size/event";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ───── ตัวช่วย ─────
const restorers: Array<() => void> = [];

/** ตั้ง/ลบ property บน navigator (jsdom ไม่มี sendBeacon/doNotTrack ให้) แล้วคืนค่าให้ตอนจบเทสต์ */
function setNav(key: string, value: unknown) {
  const had = Object.getOwnPropertyDescriptor(navigator, key);
  Object.defineProperty(navigator, key, { value, configurable: true, writable: true });
  restorers.push(() => {
    if (had) Object.defineProperty(navigator, key, had);
    else delete (navigator as unknown as Json)[key];
  });
}

function setWin(key: string, value: unknown) {
  const had = Object.getOwnPropertyDescriptor(window, key);
  Object.defineProperty(window, key, { value, configurable: true, writable: true });
  restorers.push(() => {
    if (had) Object.defineProperty(window, key, had);
    else delete (window as unknown as Json)[key];
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

/** beacon ที่สำเร็จ — เก็บ (url, Blob) ทุกครั้งที่ถูกเรียก */
function installBeacon(ok = true) {
  const calls: Array<{ url: string; data: unknown }> = [];
  const fn = vi.fn((url: string, data?: BodyInit | null) => {
    calls.push({ url, data });
    return ok;
  });
  setNav("sendBeacon", fn);
  return { fn, calls, bodies: () => Promise.all(calls.map(async (c) => JSON.parse(await readBlob(c.data as Blob)) as Json)) };
}

function installFetch(impl?: () => Promise<unknown>) {
  const fn = vi.fn(impl ?? (() => Promise.resolve({ ok: true })));
  vi.stubGlobal("fetch", fn);
  return fn;
}

let now = 1_700_000_000_000;
beforeEach(() => {
  flags.trackEnabled = true;
  now = 1_700_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  resetTrackStateForTests();
  window.sessionStorage.clear();
  // ค่าเริ่ม: ไม่มี beacon (ให้แต่ละเทสต์เลือกเอง) · fetch ล่มทุกกรณีถ้าไม่ได้ตั้ง
  setNav("sendBeacon", undefined);
  vi.stubGlobal("fetch", undefined);
});
afterEach(() => {
  while (restorers.length) restorers.pop()!();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** ทุก body ที่ส่งต้องผ่านตัวตรวจเดียวกับ route และเล็กกว่า 1 KB */
async function expectAllAcceptedByRoute(beacon: ReturnType<typeof installBeacon>) {
  const raws = await Promise.all(beacon.calls.map((c) => readBlob(c.data as Blob)));
  for (const raw of raws) {
    expect(new TextEncoder().encode(raw).byteLength).toBeLessThan(1024);
    expect(parseRingTrackBody(JSON.parse(raw)).ok, raw).toBe(true);
  }
}

describe("ส่งปกติ: sendBeacon(Blob JSON) ไป endpoint เดียวกับ route", () => {
  it("ส่ง { sid, stage } · url ถูก · Blob เป็น application/json · sync (ไม่ต้อง await)", async () => {
    const b = installBeacon();
    track({ stage: 1 });
    expect(b.fn).toHaveBeenCalledTimes(1); // ก่อน await ใดๆ
    expect(b.calls[0].url).toBe(URL_EVENT);
    expect((b.calls[0].data as Blob).type).toBe("application/json");
    const [body] = await b.bodies();
    expect(Object.keys(body).sort()).toEqual(["sid", "stage"]);
    expect(body.sid).toMatch(UUID_V4);
    expect(body.stage).toBe(1);
  });

  it("stage 0: in_app + is_return พกไปด้วย (bucket เท่านั้น)", async () => {
    const b = installBeacon();
    track({ stage: 0, in_app: "line", is_return: true });
    const [body] = await b.bodies();
    expect(body).toMatchObject({ stage: 0, in_app: "line", is_return: true });
    await expectAllAcceptedByRoute(b);
  });

  it("event ได้ผลวัด (stage 7) พก method + circ_mm + size + between ครบ และผ่านตัวตรวจของ route", async () => {
    const b = installBeacon();
    trackMeasured({ method: "B", circ_mm: 54.4, size: 55, between: true });
    const [body] = await b.bodies();
    expect(body).toMatchObject({ stage: 7, method: "B", circ_mm: 54.4, size: 55, between: true });
    await expectAllAcceptedByRoute(b);
  });
});

describe("session id: crypto.randomUUID ใน sessionStorage (ไม่ระบุตัวตน)", () => {
  it("เป็น UUID v4 · เก็บใน sessionStorage[ringSize:sid:v1] · ทุก event ของหน้าเดียวกันใช้ตัวเดียว", async () => {
    const b = installBeacon();
    track({ stage: 1 });
    track({ stage: 5, method: "A" });
    const bodies = await b.bodies();
    expect(SID_KEY).toBe("ringSize:sid:v1");
    expect(bodies[0].sid).toBe(bodies[1].sid);
    expect(window.sessionStorage.getItem("ringSize:sid:v1")).toBe(bodies[0].sid);
    // ไม่เขียนอะไรลง localStorage / cookie
    expect(window.localStorage.length).toBe(0);
    expect(document.cookie).toBe("");
  });

  it("รีโหลดหน้า (state ในหน่วยความจำหาย แต่ sessionStorage ยังอยู่) → ใช้ sid เดิม · sid ใน storage ที่เสีย/ถูกแก้ → ทิ้งแล้วสร้างใหม่", async () => {
    const b = installBeacon();
    track({ stage: 1 });
    const first = (await b.bodies())[0].sid;
    resetTrackStateForTests();
    track({ stage: 1 });
    expect((await b.bodies())[1].sid).toBe(first);

    resetTrackStateForTests();
    window.sessionStorage.setItem(SID_KEY, "not-a-uuid; DROP TABLE");
    track({ stage: 1 });
    const third = (await b.bodies())[2].sid as string;
    expect(third).toMatch(UUID_V4);
    expect(third).not.toBe(first);
    expect(window.sessionStorage.getItem(SID_KEY)).toBe(third);
  });

  it("sessionStorage throw (อ่าน/เขียนไม่ได้) → ไม่ throw · ถือ sid ในหน่วยความจำ ทุก event ใช้ตัวเดียว", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    const b = installBeacon();
    expect(() => track({ stage: 1 })).not.toThrow();
    expect(() => track({ stage: 5, method: "A" })).not.toThrow();
    const bodies = await b.bodies();
    expect(bodies).toHaveLength(2);
    expect(bodies[0].sid).toMatch(UUID_V4);
    expect(bodies[1].sid).toBe(bodies[0].sid);
  });

  it("ไม่มี crypto.randomUUID → ไม่ส่งเลย (ไม่ยอมสร้าง id เอง) ไม่ throw", () => {
    const b = installBeacon();
    const f = installFetch();
    vi.stubGlobal("crypto", {});
    expect(() => track({ stage: 1 })).not.toThrow();
    expect(b.fn).not.toHaveBeenCalled();
    expect(f).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(SID_KEY)).toBeNull();
  });

  it("ไม่มี crypto เลย → ไม่ส่ง ไม่ throw", () => {
    const b = installBeacon();
    vi.stubGlobal("crypto", undefined);
    expect(() => track({ stage: 1 })).not.toThrow();
    expect(b.fn).not.toHaveBeenCalled();
  });

  it("randomUUID ใช้ไม่ได้ แต่มี sid เดิมใน sessionStorage (แท็บเดิม) → ยังส่งด้วย sid เดิม", async () => {
    const b = installBeacon();
    track({ stage: 1 });
    const sid = (await b.bodies())[0].sid;
    resetTrackStateForTests();
    vi.stubGlobal("crypto", {});
    track({ stage: 5, method: "A" });
    expect((await b.bodies())[1].sid).toBe(sid);
  });
});

describe("E: ไม่ส่งเมื่อผู้ใช้/ระบบปฏิเสธ (ห้ามเรียก beacon/fetch เลย)", () => {
  function expectSilent(fn: () => void) {
    const b = installBeacon();
    const f = installFetch();
    expect(fn).not.toThrow();
    expect(b.fn).not.toHaveBeenCalled();
    expect(f).not.toHaveBeenCalled();
  }

  it("TRACK_ENABLED ปิด", () => {
    flags.trackEnabled = false;
    expectSilent(() => track({ stage: 1 }));
  });
  it("DNT: navigator.doNotTrack = '1'", () => {
    setNav("doNotTrack", "1");
    expectSilent(() => track({ stage: 1 }));
  });
  it("DNT: 'yes' (รูปแบบเก่า) · window.doNotTrack = '1' (Safari เก่า) · msDoNotTrack = '1'", () => {
    setNav("doNotTrack", "yes");
    expectSilent(() => track({ stage: 1 }));
    setNav("doNotTrack", null);
    setWin("doNotTrack", "1");
    expectSilent(() => track({ stage: 2 }));
    setWin("doNotTrack", undefined);
    setNav("msDoNotTrack", "1");
    expectSilent(() => track({ stage: 3 }));
  });
  it("GPC: navigator.globalPrivacyControl = true", () => {
    setNav("globalPrivacyControl", true);
    expectSilent(() => track({ stage: 1 }));
  });
  it("ไม่ได้ปฏิเสธ (DNT '0' · GPC false · ไม่มี) → ส่งปกติ — เคส 'ต้องไม่พัง' ของด่าน DNT", async () => {
    setNav("doNotTrack", "0");
    setNav("globalPrivacyControl", false);
    const b = installBeacon();
    track({ stage: 1 });
    expect(b.fn).toHaveBeenCalledTimes(1);
  });
  it("ตอน opt-out ไม่แตะ sessionStorage ด้วย (ไม่สร้าง sid)", () => {
    setNav("doNotTrack", "1");
    installBeacon();
    track({ stage: 1 });
    expect(window.sessionStorage.getItem(SID_KEY)).toBeNull();
  });
});

describe("A B C D F: สัญญา event — ตัดของที่ไม่ควรไปทิ้งก่อนส่ง (route จะปฏิเสธทั้ง event = ข้อมูลหาย)", () => {
  const RESULT = { circ_mm: 54.4, size: 55, between: true } as const;

  it("A/M1: track() ธรรมดาตัดผลวัดทิ้งเสมอ stage 0-6 (แม้ cast ยัดมา) — event ยังไปแต่ไม่มี circ_mm/size/between · stage 7 แบบนี้ทิ้งทั้ง event", async () => {
    const b = installBeacon();
    for (let stage = 0; stage <= 7; stage++) track({ stage, ...RESULT, method: "B" } as unknown as TrackSnapshot);
    const bodies = await b.bodies();
    expect(bodies).toHaveLength(7); // stage 7 ไม่ใช่ G4/cta → ไม่ส่ง
    for (const body of bodies) {
      expect(body, JSON.stringify(body)).not.toHaveProperty("circ_mm");
      expect(body).not.toHaveProperty("size");
      expect(body).not.toHaveProperty("between");
    }
    await expectAllAcceptedByRoute(b);
  });

  it("A: trackMeasured ด้วยค่าไม่ถูกต้อง (circ นอกช่วง · size ไม่ใช่จำนวนเต็ม/นอกช่วง · between ไม่ใช่ boolean · มีแค่ครึ่งก้อน) → ตัดทั้งก้อน", async () => {
    const b = installBeacon();
    const bad: Array<Partial<MeasuredResult>> = [
      { circ_mm: 200, size: 55 },
      { circ_mm: 54.4, size: 54.5 },
      { circ_mm: 54.4, size: 99 },
      { circ_mm: 54.4, size: 55, between: "yes" as unknown as boolean },
      { circ_mm: 54.4 },
      { size: 55 },
      { circ_mm: NaN, size: 55 },
      { circ_mm: Infinity, size: 55 },
    ];
    for (const r of bad) {
      resetTrackStateForTests();
      trackMeasured({ method: "A", ...r } as unknown as MeasuredResult);
    }
    // ผลที่ไม่ผ่านด่านถูกตัด → เหลือ stage 7 เปล่า → ทิ้งทั้ง event (ไม่ส่ง stage 7 ปลอมโดยไม่มีผล)
    const bodies = await b.bodies();
    expect(bodies).toHaveLength(0);
    // ค่าที่ถูกต้องในเงื่อนไขเดียวกันส่งได้ (กันด่านแน่นเกินจนผลจริงหาย)
    trackMeasured({ method: "A", circ_mm: 54.4, size: 55, between: false });
    expect(await b.bodies()).toHaveLength(1);
    for (const body of bodies) {
      expect(body, JSON.stringify(body)).not.toHaveProperty("circ_mm");
      expect(body).not.toHaveProperty("size");
      expect(body).not.toHaveProperty("between");
    }
    await expectAllAcceptedByRoute(b);
  });

  it("B: event CTA พกแค่ stage + cta — ไม่พก size/circ_mm/between/method/ref/ธงอื่น (ทุก cta)", async () => {
    const b = installBeacon();
    for (const cta of ["line", "share", "shop", "gem_quiz"] as const) {
      track({ stage: 7, cta, ...RESULT, method: "B", ref: "card", g1: true, g4: true, used_a: true } as unknown as TrackSnapshot);
    }
    const bodies = await b.bodies();
    expect(bodies).toHaveLength(4);
    for (const [i, body] of bodies.entries()) {
      expect(Object.keys(body).sort(), JSON.stringify(body)).toEqual(["cta", "sid", "stage"]);
      expect(body.cta).toBe(["line", "share", "shop", "gem_quiz"][i]);
      expect(body.stage).toBe(7);
    }
    await expectAllAcceptedByRoute(b);
  });

  it("C: g4 เฉพาะ event G4 (stage 7 · ไม่พกเบอร์/มม.) — ที่ stage อื่นตัด g4 ทิ้ง · g4:false ไม่ผ่าน", async () => {
    const b = installBeacon();
    track({ stage: 6, method: "A", g4: true }); // ไม่ใช่ G4
    now += 2 * MEASURE_THROTTLE_MS;
    track({ stage: 7, method: "A", g4: true, ...RESULT } as unknown as TrackSnapshot); // G4 พกผลมา → ตัดผล
    now += 2 * MEASURE_THROTTLE_MS;
    track({ stage: 7, method: "A", g4: false }); // ไม่ใช่ G4 → stage 7 เปล่า → ทิ้งทั้ง event
    const [stage6, g4, ...rest] = await b.bodies();
    expect(rest).toEqual([]);
    expect(stage6).not.toHaveProperty("g4");
    expect(g4).toMatchObject({ stage: 7, method: "A", g4: true });
    expect(g4).not.toHaveProperty("circ_mm");
    expect(g4).not.toHaveProperty("size");
    expect(g4).not.toHaveProperty("between");
    await expectAllAcceptedByRoute(b);
  });

  it("D: key src/source (หรือ key แปลกใดๆ) ไม่มีทางไปถึง body · ไม่อ่าน ?src= จาก URL", async () => {
    window.history.replaceState(null, "", "/?src=line&source=tiktok");
    const b = installBeacon();
    track({ stage: 1, src: "line", source: "tiktok", ip: "1.2.3.4", ua: "Mozilla/5.0", cookie: "a=b", name: "สมชาย", phone: "0812345678", line: "@x" } as unknown as TrackSnapshot);
    track({ stage: 0, in_app: "browser", is_return: false, src: "line" } as unknown as TrackSnapshot);
    const bodies = await b.bodies();
    expect(bodies).toHaveLength(2);
    for (const body of bodies) {
      for (const k of Object.keys(body)) expect(["sid", "stage", "in_app", "is_return"], k).toContain(k);
      expect(JSON.stringify(body)).not.toMatch(/1\.2\.3\.4|Mozilla|a=b|สมชาย|0812345678|"src"|"source"|tiktok/);
    }
    window.history.replaceState(null, "", "/");
  });

  it("F: in_app ต้องเป็น bucket (line/tiktok/fb/ig/browser/unknown) — UA ดิบ/ค่าอื่น = ไม่ส่ง event นั้น", () => {
    const b = installBeacon();
    track({ stage: 0, in_app: "Mozilla/5.0 (iPhone) Line/13.0" as unknown as "line" });
    track({ stage: 0, in_app: "wechat" as unknown as "line" });
    expect(b.fn).not.toHaveBeenCalled();
    for (const v of ["line", "tiktok", "fb", "ig", "browser", "unknown"] as const) {
      track({ stage: 0, in_app: v });
    }
    expect(b.fn).toHaveBeenCalledTimes(6);
  });

  it("F/L1/L2: fetch สำรอง = credentials omit (ไม่แนบ cookie — ต่างจาก sendBeacon ที่เบราว์เซอร์แนบตามสเปก ซึ่ง route ไม่อ่าน) · referrerPolicy strict-origin (Referer เหลือแค่ origin ไม่ติด query · Origin ยังอยู่ — ห้าม no-referrer เพราะบาง engine ทำ Origin เป็น null แล้ว route 403) · header มีแค่ Content-Type", () => {
    const f = installFetch();
    track({ stage: 1 });
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(URL_EVENT);
    expect(init).toMatchObject({ method: "POST", keepalive: true, credentials: "omit", referrerPolicy: "strict-origin" });
    expect(init.referrerPolicy).not.toBe("no-referrer");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
  });

  it("in_range ที่ client คำนวณมา ไม่ถูกส่ง (DB ไม่เชื่อ)", async () => {
    const b = installBeacon();
    track({ stage: 6, method: "A", in_range: true });
    const [body] = await b.bodies();
    expect(body).not.toHaveProperty("in_range");
  });
});

describe("M1: ผลวัดส่งได้ทางเดียว = trackMeasured (กันด้วยโครงสร้าง ไม่พึ่ง call site)", () => {
  it("track({stage:7,size:60,circ_mm:60} as any) → body ไม่มี size/circ_mm/between (ตัดที่ runtime ไม่ใช่แค่ type)", async () => {
    const b = installBeacon();
    track({ stage: 7, size: 60, circ_mm: 60 } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    track({ stage: 7, method: "A", size: 60, circ_mm: 60, between: true } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    track({ stage: 6, method: "A", size: 60, circ_mm: 60, between: true } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    const bodies = await b.bodies();
    expect(bodies).toHaveLength(1); // เหลือ stage 6 ตัวเดียว (ตัดผลแล้ว) · สองตัวแรกเป็น stage 7 เปล่า → ทิ้ง
    for (const body of bodies) {
      expect(body, JSON.stringify(body)).not.toHaveProperty("size");
      expect(body).not.toHaveProperty("circ_mm");
      expect(body).not.toHaveProperty("between");
    }
    await expectAllAcceptedByRoute(b);
  });

  it("track() ที่ stage 7 ไม่มีทางทำให้ measure_count เพิ่ม: ไม่มี event ใดที่พก size ออกจาก track() — ลองทุก stage/ทุก cta/G4 พร้อมผลแอบมา", async () => {
    const b = installBeacon();
    for (let stage = 0; stage <= 7; stage++) {
      now += 2 * MEASURE_THROTTLE_MS;
      track({ stage, method: "A", g4: stage === 7 ? true : undefined, size: 55, circ_mm: 54.4, between: false } as unknown as TrackSnapshot);
    }
    for (const cta of ["line", "share", "shop", "gem_quiz"] as const) track({ stage: 7, cta, size: 55 } as unknown as TrackSnapshot);
    for (const body of await b.bodies()) expect(Object.keys(body)).not.toEqual(expect.arrayContaining(["size"]));
  });

  it("trackMeasured = ทางเดียวที่ส่งผล: พก stage 7 + method + circ_mm + size + between ครบ · หยิบทีละ field (key แปลกไม่หลุด)", async () => {
    const b = installBeacon();
    trackMeasured({ method: "B", circ_mm: 54.4, size: 55, between: true, src: "line", cta: "line", g4: true, ip: "1.2.3.4" } as unknown as MeasuredResult);
    const [body] = await b.bodies();
    expect(body).toEqual({ sid: body.sid, stage: 7, method: "B", circ_mm: 54.4, size: 55, between: true });
    await expectAllAcceptedByRoute(b);
  });

  it("trackMeasured ผ่านด่านเดียวกับ track(): DNT/GPC/TRACK ปิด = ไม่ส่ง", () => {
    const r = { method: "A", circ_mm: 54, size: 54, between: false } as const;
    const b = installBeacon();
    setNav("doNotTrack", "1");
    trackMeasured(r);
    setNav("doNotTrack", null);
    setNav("globalPrivacyControl", true);
    trackMeasured(r);
    setNav("globalPrivacyControl", false);
    flags.trackEnabled = false;
    trackMeasured(r);
    expect(b.fn).not.toHaveBeenCalled();
  });
});

describe("stage 7 gate: funnel[7] ห้ามพองจาก call site ผิด — track() ที่ stage 7 ต้องเป็น g4 หรือ cta เท่านั้น", () => {
  it("track({stage:7} as any) และ track({stage:7, method:'a'} as any) → ไม่ส่งเลย (ไม่เรียก beacon/fetch)", () => {
    const b = installBeacon();
    const f = installFetch();
    track({ stage: 7 } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    track({ stage: 7, method: "a" } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(b.fn).not.toHaveBeenCalled();
    expect(f).not.toHaveBeenCalled();
  });

  it("stage 7 แบบอื่นที่ไม่ใช่ G4/cta ก็ทิ้ง: method ปกติ · ธงอื่น (g1 g3 g5) · g4:false · ref · in_app · ผลที่ถูกตัด", () => {
    const b = installBeacon();
    for (const snap of [
      { stage: 7, method: "A" },
      { stage: 7, method: "B", ref: "coin" },
      { stage: 7, g1: true },
      { stage: 7, g3: true, g5: true },
      { stage: 7, g4: false },
      { stage: 7, in_app: "line", is_return: true },
      { stage: 7, used_a: true, used_b: true, saw_between: true },
      { stage: 7, method: "A", circ_mm: 54, size: 54, between: false },
    ]) {
      now += 2 * MEASURE_THROTTLE_MS;
      track(snap as unknown as TrackSnapshot);
    }
    expect(b.fn).not.toHaveBeenCalled();
  });

  it("ต้องไม่พัง: G4 · cta (ทุกตัว) · trackMeasured ที่ถูกต้อง ยังส่งที่ stage 7 ได้ · stage 0-6 ไม่ถูกกระทบ", async () => {
    const b = installBeacon();
    track({ stage: 7, method: "A", g4: true });
    for (const cta of ["line", "share", "shop", "gem_quiz"] as const) track({ stage: 7, cta });
    now += 2 * MEASURE_THROTTLE_MS;
    trackMeasured({ method: "B", circ_mm: 54.4, size: 55, between: true });
    for (let stage = 0; stage <= 6; stage++) track({ stage });
    const bodies = await b.bodies();
    expect(bodies).toHaveLength(1 + 4 + 1 + 7);
    expect(bodies.filter((x) => x.stage === 7).map((x) => (x.g4 ? "g4" : x.cta ? x.cta : "measured"))).toEqual(["g4", "line", "share", "shop", "gem_quiz", "measured"]);
    await expectAllAcceptedByRoute(b);
  });
});

describe("dedupe ต่อ stage/cta · throttle ผลวัด", () => {
  it("stage เดิมซ้ำติดกัน = ส่งครั้งเดียว · stage ต่างกัน = ส่งทุกตัว · stage กระโดด 1→5 ได้", async () => {
    const b = installBeacon();
    track({ stage: 1 });
    track({ stage: 1 });
    track({ stage: 1 });
    track({ stage: 5, method: "A" });
    track({ stage: 5, method: "A" });
    const bodies = await b.bodies();
    expect(bodies.map((x) => x.stage)).toEqual([1, 5]);
  });

  it("method เปลี่ยน (A→B→A) ที่ stage เดิม = ส่งทุกครั้งที่เปลี่ยน (DB เก็บ 'ล่าสุดทับ' ต้องเห็นวิธีปัจจุบัน) · ซ้ำตัวเดิมติดกัน = ทิ้ง", async () => {
    const b = installBeacon();
    for (const m of ["A", "A", "B", "B", "A"] as const) track({ stage: 6, method: m });
    expect((await b.bodies()).map((x) => x.method)).toEqual(["A", "B", "A"]);
  });

  it("stage 4 ref เปลี่ยน (coin→card) ส่งใหม่ · g3/g5 เป็น event ต่างหากจากธรรมดา", async () => {
    const b = installBeacon();
    track({ stage: 4, ref: "coin" });
    track({ stage: 4, ref: "coin" });
    track({ stage: 4, ref: "card" });
    track({ stage: 4, ref: "card", g3: true });
    track({ stage: 4, ref: "card", g3: true });
    expect(await b.bodies()).toHaveLength(3); // coin · card · card+g3 (ที่เหลือซ้ำติดกัน)
  });

  it("cta แต่ละตัวส่งครั้งเดียว (กดซ้ำไม่ส่งซ้ำ) · cta ต่างกันส่งแยก", async () => {
    const b = installBeacon();
    track({ stage: 7, cta: "line" });
    track({ stage: 7, cta: "line" });
    track({ stage: 7, cta: "share" });
    track({ stage: 7, cta: "line" });
    expect((await b.bodies()).map((x) => x.cta)).toEqual(["line", "share"]);
  });

  it("ผลวัดซ้ำภายใน 1 วิ = ทิ้ง (กดซ้ำ) · ห่างกัน ≥ 1 วิ = ส่ง — วัด 3 รอบจริง = stage 7 สามครั้ง", async () => {
    const b = installBeacon();
    const r = { method: "A", circ_mm: 54, size: 54, between: false } as const;
    trackMeasured(r);
    now += MEASURE_THROTTLE_MS - 1;
    trackMeasured(r); // ถี่เกิน
    expect(b.fn).toHaveBeenCalledTimes(1);
    now += 1; // ครบ 1 วิพอดีนับจากครั้งแรก
    trackMeasured(r);
    now += 8000;
    trackMeasured({ ...r, circ_mm: 60.3, size: 60 }); // รอบที่ 3 ค่าต่าง
    const bodies = await b.bodies();
    expect(bodies).toHaveLength(3);
    expect(bodies.every((x) => x.stage === 7 && x.size !== undefined)).toBe(true);
  });

  it("throttle ของผลวัด กับ G4 แยกกัน (G4 หลังได้ผลทันทีไม่ถูกกลืน) · G4 ซ้ำใน 1 วิ ทิ้ง", async () => {
    const b = installBeacon();
    trackMeasured({ method: "A", circ_mm: 54, size: 54, between: false });
    track({ stage: 7, method: "A", g4: true });
    track({ stage: 7, method: "A", g4: true });
    const bodies = await b.bodies();
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toMatchObject({ g4: true });
  });

  it("นาฬิกาย้อนหลัง (เวลาเครื่องถูกปรับ) ไม่ทำให้ติด throttle ค้าง", () => {
    const b = installBeacon();
    const r = { method: "A", circ_mm: 54, size: 54, between: false } as const;
    trackMeasured(r);
    now -= 60_000;
    trackMeasured(r);
    expect(b.fn).toHaveBeenCalledTimes(2);
  });
});

describe("ต้องไม่พัง: ช่องส่งล่ม/ไม่มี → ไม่ throw · ไม่มี unhandled rejection", () => {
  it("sendBeacon คืน false → ตกไป fetch keepalive", () => {
    installBeacon(false);
    const f = installFetch();
    track({ stage: 1 });
    expect(f).toHaveBeenCalledTimes(1);
    expect((f.mock.calls[0] as unknown as [string, RequestInit])[1].keepalive).toBe(true);
  });

  it("sendBeacon throw → ตกไป fetch", () => {
    setNav("sendBeacon", () => {
      throw new TypeError("boom");
    });
    const f = installFetch();
    expect(() => track({ stage: 1 })).not.toThrow();
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("ไม่มี sendBeacon → ใช้ fetch", () => {
    const f = installFetch();
    track({ stage: 1 });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("endpoint ล่ม: fetch reject → จับเงียบ (ไม่มี unhandled rejection)", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      installFetch(() => Promise.reject(new TypeError("Failed to fetch")));
      expect(() => track({ stage: 1 })).not.toThrow();
      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("fetch throw แบบ sync · ไม่มีทั้ง sendBeacon และ fetch · ไม่มี Blob → ไม่ throw", () => {
    vi.stubGlobal("fetch", () => {
      throw new Error("sync boom");
    });
    expect(() => track({ stage: 1 })).not.toThrow();
    vi.stubGlobal("fetch", undefined);
    expect(() => track({ stage: 5, method: "A" })).not.toThrow();
    installBeacon();
    vi.stubGlobal("Blob", undefined);
    expect(() => track({ stage: 6, method: "A" })).not.toThrow();
  });

  it("ขยะเข้า → ไม่ throw ไม่ส่ง (null · undefined · stage ไม่ใช่เลข · stage นอกช่วง · ค่า circular)", () => {
    const b = installBeacon();
    const circular: Record<string, unknown> = { stage: 1 };
    circular.self = circular;
    for (const junk of [null, undefined, 5, "x", {}, { stage: NaN }, { stage: 99 }, { stage: -1 }, { stage: 1.5 }, { stage: "1" }, circular]) {
      expect(() => track(junk as unknown as TrackSnapshot), String(junk)).not.toThrow();
    }
    // circular มี stage 1 ที่ถูกต้อง + key แปลก (self) → key แปลกถูกทิ้ง ส่ง stage 1 ได้ปกติ (1 ครั้ง)
    expect(b.fn).toHaveBeenCalledTimes(1);
  });
});
