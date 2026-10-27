// app/api/ring-size/event/route.qa.test.ts — QA อิสระรอบที่ 2 (27 ต.ค. 69) เสริม route.test.ts ของ dev (ไม่แทนที่)
// design-ring-size-analytics §9: เคส 1 (Origin/Sec-Fetch-Site ทุกแบบ) · 2 (ขอบ 1024/1025 ไบต์ ข้ามอักขระหลายไบต์) · 3 (JSON แปลก)
// · 5 (sid เดิม 41 ครั้ง → 429 ผ่าน RPC จำลองแบบมี state) · 13 (ไม่อ่าน IP/UA/cookie — ล็อกด้วยการอ่านซอร์ส) + เรียกพร้อมกัน
// mock เฉพาะ I/O (service client + getDevShopId) เหมือน route.test.ts · track-schema ไม่ mock
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const rpcMock = vi.fn();
const shopIdMock = vi.fn();

vi.mock("@/lib/dev/context", () => ({ getDevShopId: () => shopIdMock() }));
vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({ schema: () => ({ rpc: rpcMock }) }),
}));

const HOST = "oms-3j.vercel.app";
const ORIGIN = `https://${HOST}`;
const SHOP = "11111111-1111-1111-1111-111111111111";
const SID = "3f2b8c1e-9a4d-4e6b-8c2f-1a2b3c4d5e6f";
const MAX = 1024;
const enc = new TextEncoder();

type Hdrs = Record<string, string | null>;

function makeRequest(opts: { rawBody?: string; bytes?: Uint8Array; headers?: Hdrs } = {}): NextRequest {
  const headers: Record<string, string> = { host: HOST, origin: ORIGIN };
  for (const [k, v] of Object.entries(opts.headers ?? {})) {
    if (v === null) delete headers[k];
    else headers[k] = v;
  }
  const body: BodyInit = opts.bytes ? (opts.bytes as unknown as BodyInit) : (opts.rawBody ?? JSON.stringify({ sid: SID, stage: 1 }));
  return new NextRequest(`https://${HOST}/api/ring-size/event`, { method: "POST", headers, body });
}

function chunkedRequest(bytes: Uint8Array, size: number): NextRequest {
  let offset = 0;
  return new NextRequest(`https://${HOST}/api/ring-size/event`, {
    method: "POST",
    headers: { host: HOST, origin: ORIGIN },
    body: new ReadableStream<Uint8Array>({
      pull(ctrl) {
        if (offset >= bytes.byteLength) return ctrl.close();
        ctrl.enqueue(bytes.slice(offset, offset + size));
        offset += size;
      },
    }),
    duplex: "half",
  } as unknown as ConstructorParameters<typeof NextRequest>[1]);
}

const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

beforeEach(() => {
  rpcMock.mockReset();
  shopIdMock.mockReset();
  errorSpy.mockClear();
  shopIdMock.mockReturnValue(SHOP);
  rpcMock.mockResolvedValue({ data: null, error: null });
});

async function post(req: NextRequest) {
  const { POST } = await import("./route");
  return POST(req);
}

/** snapshot ของ RPC ครั้งที่ n (0-based) */
function snapOf(n = 0): Record<string, unknown> {
  return (rpcMock.mock.calls[n] as [string, Record<string, unknown>])[1].p_snapshot as Record<string, unknown>;
}

describe("QA เคส 1: Origin / Host / Sec-Fetch-Site — ตารางทุกแบบ (ผลลัพธ์จริงของโค้ด · แถว 'ข้อสังเกต' = ปลอมได้จากนอกเบราว์เซอร์อยู่แล้ว ไม่ใช่ auth)", () => {
  it.each<[string, Hdrs, number]>([
    ["Origin พอร์ตมาตรฐาน :443 (URL ตัดพอร์ตดีฟอลต์) ⇒ ผ่าน", { origin: `https://${HOST}:443` }, 204],
    ["Origin พอร์ตแปลก :8443 ขณะ Host ไม่มีพอร์ต ⇒ 403", { origin: `https://${HOST}:8443` }, 403],
    ["Host มีพอร์ต + Origin พอร์ตเดียวกัน (dev/preview) ⇒ ผ่าน", { host: "localhost:3000", origin: "http://localhost:3000" }, 204],
    ["Host มีพอร์ต แต่ Origin ไม่มีพอร์ต ⇒ 403", { host: "localhost:3000", origin: "http://localhost" }, 403],
    ["Origin ตัวพิมพ์ใหญ่ทั้งสตริง (URL normalize เป็นตัวเล็ก) ⇒ ผ่าน", { origin: `HTTPS://${HOST.toUpperCase()}` }, 204],
    ["Host ตัวพิมพ์ใหญ่ vs Origin ตัวเล็ก ⇒ 403 (fail closed · เบราว์เซอร์ส่ง Host ตัวเล็กเสมอ)", { host: HOST.toUpperCase() }, 403],
    ["Origin หลายค่า 'a, b' (header ซ้ำถูกรวม) ⇒ 403", { origin: `${ORIGIN}, https://evil.example` }, 403],
    ["Origin ว่าง + Sec-Fetch-Site: same-origin ⇒ ผ่าน (ตกไปใช้ Sec-Fetch-Site)", { origin: "", "sec-fetch-site": "same-origin" }, 204],
    ["ไม่มี Origin + Sec-Fetch-Site: Same-Origin (ตัวพิมพ์ใหญ่) ⇒ 403 (เทียบเคร่ง)", { origin: null, "sec-fetch-site": "Same-Origin" }, 403],
    ["ไม่มี Origin + Sec-Fetch-Site: same-origin + ซ้ำ 'same-origin, cross-site' ⇒ 403", { origin: null, "sec-fetch-site": "same-origin, cross-site" }, 403],
    ["Origin ชี้ย่อยโดเมนของเรา (api.<host>) ⇒ 403", { origin: `https://api.${HOST}` }, 403],
    ["Origin เป็น scheme อื่น (chrome-extension://x · file://) ⇒ 403", { origin: "chrome-extension://abcdef" }, 403],
    ["ข้อสังเกต: Origin มี userinfo 'https://evil@HOST' ⇒ ผ่าน (URL.host ตัด userinfo · เบราว์เซอร์ไม่เคยส่งแบบนี้ · curl ปลอม Origin ตรง ๆ ได้อยู่แล้ว)", { origin: `https://evil.example@${HOST}` }, 204],
    ["ข้อสังเกต: Origin http:// แต่ host เดียวกัน ⇒ ผ่าน (เทียบ host ไม่เทียบ scheme — ตั้งใจเพื่อ preview หลัง proxy)", { origin: `http://${HOST}` }, 204],
  ])("%s", async (_label, headers, want) => {
    const res = await post(makeRequest({ headers }));
    expect(res.status).toBe(want);
    if (want === 403) expect(rpcMock).not.toHaveBeenCalled();
    else expect(rpcMock).toHaveBeenCalledTimes(1);
  });
});

describe("QA เคส 2: ขอบ 1024/1025 ไบต์ — นับเป็นไบต์ ข้ามอักขระหลายไบต์ / chunk ตัดกลางอักขระ", () => {
  /** JSON object ที่ถูกต้อง + key ไม่รู้จัก x ที่มีอักษรไทยหลายไบต์ แล้วเติม 'a' ให้ยาวเท่า n ไบต์พอดี */
  function thaiBodyOfBytes(n: number): Uint8Array {
    const head = `{"sid":"${SID}","stage":1,"x":"`;
    const tail = `"}`;
    const fixed = enc.encode(head).length + enc.encode(tail).length;
    const thaiChars = Math.floor((n - fixed) / 3) - 1;
    const filler = n - fixed - thaiChars * 3;
    const s = head + "ก".repeat(thaiChars) + "a".repeat(filler) + tail;
    const bytes = enc.encode(s);
    expect(bytes.length).toBe(n);
    return bytes;
  }

  it("ไทยหลายไบต์ยาว 1024 ไบต์พอดี (ผ่านด่านขนาด → 400 เพราะมี key ไม่รู้จัก ไม่ใช่ 413) · 1025 ⇒ 413 · ทั้งแบบ body ก้อนเดียวและ chunk 1 ไบต์ (ตัดกลางอักขระ)", async () => {
    expect((await post(makeRequest({ bytes: thaiBodyOfBytes(MAX) }))).status).toBe(400);
    expect((await post(makeRequest({ bytes: thaiBodyOfBytes(MAX + 1) }))).status).toBe(413);
    expect((await post(chunkedRequest(thaiBodyOfBytes(MAX), 1))).status).toBe(400);
    expect((await post(chunkedRequest(thaiBodyOfBytes(MAX + 1), 1))).status).toBe(413);
    expect((await post(chunkedRequest(thaiBodyOfBytes(MAX), 2))).status).toBe(400); // chunk 2 ไบต์ตัดกลาง 3 ไบต์ของอักษรไทยแน่ ๆ
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("emoji 4 ไบต์ล้วนเกินขนาด: 257 ตัว = 1028 ไบต์ (ตัวอักษรแค่ ~514 code unit) ⇒ 413", async () => {
    const raw = JSON.stringify({ sid: SID, stage: 1, x: "😀".repeat(257) });
    expect(raw.length).toBeLessThan(MAX + 200);
    expect(Buffer.byteLength(raw, "utf-8")).toBeGreaterThan(MAX);
    expect((await post(makeRequest({ rawBody: raw }))).status).toBe(413);
  });

  it("valid 1024 ไบต์ที่ต่อด้วยช่องว่างทั้งแบบก้อนเดียวและ chunk ขนาดต่าง ๆ ⇒ 204 ทุกแบบ (chunk 1/3/7/512/1024)", async () => {
    const base = JSON.stringify({ sid: SID, stage: 1 });
    const bytes = enc.encode(base + " ".repeat(MAX - base.length));
    expect(bytes.length).toBe(MAX);
    expect((await post(makeRequest({ bytes }))).status).toBe(204);
    for (const size of [1, 3, 7, 512, 1024]) expect((await post(chunkedRequest(bytes, size))).status, `chunk ${size}`).toBe(204);
    expect(rpcMock).toHaveBeenCalledTimes(6);
  });

  it("header content-length แปลก ๆ ไม่ทำให้พัง: 'abc' · '-1' · '' ⇒ ไม่ถือว่าเกิน (body จริงตัดสิน) · '1024.5' / '1e4' (Number > 1024) ⇒ 413 (ตัดเร็วจาก header)", async () => {
    for (const cl of ["abc", "-1", ""]) {
      expect((await post(makeRequest({ headers: { "content-length": cl } }))).status, `cl=${JSON.stringify(cl)}`).toBe(204);
    }
    for (const cl of ["1024.5", "1e4", "99999999999999999999"]) {
      expect((await post(makeRequest({ headers: { "content-length": cl } }))).status, `cl=${cl}`).toBe(413);
    }
  });

  it("BOM นำหน้า JSON ที่ถูกต้อง ⇒ 204 (TextDecoder ตัด BOM) — characterization ไม่ใช่ช่องโหว่", async () => {
    const good = enc.encode(JSON.stringify({ sid: SID, stage: 2 }));
    const bytes = new Uint8Array(good.length + 3);
    bytes.set([0xef, 0xbb, 0xbf], 0);
    bytes.set(good, 3);
    const res = await post(makeRequest({ bytes }));
    expect(res.status).toBe(204);
    expect(snapOf()).toEqual({ stage: 2 });
  });
});

describe("QA เคส 3: JSON แปลก — route เป็นคนสร้าง snapshot ใหม่เอง (ไม่ส่งข้อความดิบของ client ไปถึง RPC)", () => {
  it("key ซ้ำ: ค่าสุดท้ายชนะแบบเดียวกับ DB — stage 9 แล้ว 1 ⇒ ผ่าน (stage 1) · stage 1 แล้ว 9 ⇒ 400", async () => {
    expect((await post(makeRequest({ rawBody: `{"sid":"${SID}","stage":9,"stage":1}` }))).status).toBe(204);
    expect(snapOf()).toEqual({ stage: 1 });
    rpcMock.mockClear();
    expect((await post(makeRequest({ rawBody: `{"sid":"${SID}","stage":1,"stage":9}` }))).status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("รูปแบบตัวเลขต่าง ๆ ถูก normalize ก่อนถึง RPC: 1.0 · 1e0 · -0 · 7.0000000000000001 ⇒ RPC เห็นเลขจำนวนเต็มสะอาด (ไม่มี '-0' ไม่มีเลขยกกำลัง)", async () => {
    const cases: Array<[string, number]> = [["1.0", 1], ["1e0", 1], ["-0", 0], ["7.0000000000000001", 7]];
    for (const [lit, want] of cases) {
      rpcMock.mockClear();
      const res = await post(makeRequest({ rawBody: `{"sid":"${SID}","stage":${lit}}` }));
      expect(res.status, lit).toBe(204);
      const wire = JSON.stringify(snapOf()); // สิ่งที่ supabase-js จะ serialize ออกไป
      expect(wire, lit).toBe(`{"stage":${want}}`);
    }
  });

  it("ผลวัดแบบเลขทศนิยมยาว/วิทยาศาสตร์: circ_mm 5.4e1 · size 5.2e1 ⇒ ส่งต่อเป็น 54 / 52", async () => {
    const res = await post(makeRequest({ rawBody: `{"sid":"${SID}","stage":7,"circ_mm":5.4e1,"size":5.2e1}` }));
    expect(res.status).toBe(204);
    expect(JSON.stringify(snapOf())).toBe('{"stage":7,"circ_mm":54,"size":52}');
  });

  it.each<[string, string]>([
    ["NUL ใน key (\\u0000)", `{"sid":"${SID}","stage":1,"a\\u0000b":1}`],
    ["NUL ใน sid", `{"sid":"${SID}\\u0000","stage":1}`],
    ["key ภาษาไทย", `{"sid":"${SID}","stage":1,"ไซส์":1}`],
    ["key ว่าง", `{"sid":"${SID}","stage":1,"":1}`],
    ["key constructor", `{"sid":"${SID}","stage":1,"constructor":1}`],
    ["key toString", `{"sid":"${SID}","stage":1,"toString":1}`],
    ["key hasOwnProperty", `{"sid":"${SID}","stage":1,"hasOwnProperty":1}`],
    ["key __proto__ (own key จาก JSON.parse)", `{"sid":"${SID}","stage":1,"__proto__":{"polluted":true}}`],
    ["in_app มี emoji ต่อท้าย", `{"sid":"${SID}","stage":1,"in_app":"line😀"}`],
    ["in_app fullwidth", `{"sid":"${SID}","stage":1,"in_app":"ｌｉｎｅ"}`],
    ["in_app มีช่องว่างท้าย", `{"sid":"${SID}","stage":1,"in_app":"line "}`],
    ["in_app ภาษาไทย", `{"sid":"${SID}","stage":1,"in_app":"ไลน์"}`],
    ["method เป็น array", `{"sid":"${SID}","stage":1,"method":["A"]}`],
    ["method เป็น object", `{"sid":"${SID}","stage":1,"method":{"v":"A"}}`],
    ["sid เป็น fullwidth digits", `{"sid":"３f2b8c1e-9a4d-4e6b-8c2f-1a2b3c4d5e6f","stage":1}`],
    ["sid UUID nil", `{"sid":"00000000-0000-0000-0000-000000000000","stage":1}`],
    ["sid UUID ไม่มีขีด", `{"sid":"3f2b8c1e9a4d4e6b8c2f1a2b3c4d5e6f","stage":1}`],
    ["sid พร้อมวงเล็บปีกกา", `{"sid":"{${SID}}","stage":1}`],
    ["stage เป็น string ตัวเลข fullwidth", `{"sid":"${SID}","stage":"７"}`],
    ["circ_mm ที่ stage 7 เป็น boolean", `{"sid":"${SID}","stage":7,"circ_mm":true}`],
    ["size ไม่ใช่จำนวนเต็ม (52.5) ที่ stage 7", `{"sid":"${SID}","stage":7,"size":52.5}`],
    ["บูลีนเป็น 0/1", `{"sid":"${SID}","stage":1,"g1":0}`],
    ["nested array 500 ชั้น (~1 KB) ไม่ทำให้พัง", "[".repeat(500) + "]".repeat(500)],
    ["ข้อความล้วนสั้น ๆ (BOM ภายใน)", `{"sid":"${SID}","stage":1}﻿x`],
  ])("ต้องถูกปฏิเสธ 400 · ไม่เรียก RPC · ไม่ throw: %s", async (_l, raw) => {
    const res = await post(makeRequest({ rawBody: raw }));
    expect(res.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("__proto__ ใน body ไม่ทำให้ Object.prototype เปื้อน (prototype pollution)", async () => {
    await post(makeRequest({ rawBody: `{"sid":"${SID}","stage":1,"__proto__":{"polluted":"yes"}}` }));
    await post(makeRequest({ rawBody: `{"sid":"${SID}","stage":1,"constructor":{"prototype":{"polluted":"yes"}}}` }));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("ไม่ echo ค่าที่ client ส่งมาใน response ทุกกรณีที่ปฏิเสธ (marker ใน key / value / sid / ผลวัดผิดที่)", async () => {
    const MARK = "ZZ-MARKER-7731";
    const bodies = [
      `{"sid":"${SID}","stage":1,"${MARK}":1}`,
      `{"sid":"${SID}","stage":1,"in_app":"${MARK}"}`,
      `{"sid":"${MARK}","stage":1}`,
      `{"sid":"${SID}","stage":"${MARK}"}`,
      `${MARK} not json`,
    ];
    for (const raw of bodies) {
      const res = await post(makeRequest({ rawBody: raw }));
      expect(res.status).toBe(400);
      expect(await res.text()).not.toContain(MARK);
    }
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(MARK);
  });
});

describe("QA เคส 5 + 'เรียกซ้ำ/พร้อมกัน': route ต่อกับ RPC แบบมี state (จำลองเพดาน 40 event/sid ใน RPC)", () => {
  /** RPC จำลอง: นับต่อ sid · ครั้งที่ 41 ขึ้นไป ⇒ P0001 (เหมือน ring_size_session_upsert) */
  function statefulRpc() {
    const counts = new Map<string, number>();
    rpcMock.mockImplementation(async (_name: string, params: { p_session_id: string }) => {
      await new Promise((r) => setTimeout(r, Math.random() * 3)); // สลับลำดับ resolve ให้สมจริง
      const n = (counts.get(params.p_session_id) ?? 0) + 1;
      if (n > 40) return { data: null, error: { code: "P0001" } };
      counts.set(params.p_session_id, n);
      return { data: null, error: null };
    });
    return counts;
  }

  it("sid เดิม 100 ครั้งยิงพร้อมกัน ⇒ 204 ได้ 40 · 429 ได้ 60 · ไม่มี status อื่น · 429 ไม่มี body · ไม่ log", async () => {
    statefulRpc();
    const results = await Promise.all(Array.from({ length: 100 }, () => post(makeRequest())));
    const by = new Map<number, number>();
    for (const r of results) by.set(r.status, (by.get(r.status) ?? 0) + 1);
    expect(Object.fromEntries(by)).toEqual({ 204: 40, 429: 60 });
    for (const r of results.filter((x) => x.status === 429)) expect(await r.text()).toBe("");
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("เรียกพร้อมกัน 60 request ปนกัน (ปกติ · origin ผิด · เกินขนาด · JSON พัง · ผลผิด stage) ⇒ แต่ละตัวได้สถานะของตัวเอง ไม่ปนกัน · RPC ถูกเรียกเท่าจำนวนที่ถูกต้องเท่านั้น", async () => {
    statefulRpc();
    const sids = Array.from({ length: 15 }, (_, i) => `3f2b8c1e-9a4d-4e6b-8c2f-1a2b3c4d${String(1000 + i)}`);
    const kinds: Array<{ want: number; req: NextRequest }> = [];
    for (let i = 0; i < 15; i++) {
      kinds.push({ want: 204, req: makeRequest({ rawBody: JSON.stringify({ sid: sids[i], stage: 1 }) }) });
      kinds.push({ want: 403, req: makeRequest({ headers: { origin: "https://evil.example" } }) });
      kinds.push({ want: 413, req: makeRequest({ rawBody: " ".repeat(MAX + 1) }) });
      kinds.push({ want: 400, req: makeRequest({ rawBody: `{"sid":"${sids[i]}","stage":6,"size":50}` }) });
    }
    const results = await Promise.all(kinds.map((k) => post(k.req)));
    results.forEach((r, i) => expect(r.status, `#${i} want ${kinds[i].want}`).toBe(kinds[i].want));
    expect(rpcMock).toHaveBeenCalledTimes(15);
    const called = new Set(rpcMock.mock.calls.map((c) => (c[1] as { p_session_id: string }).p_session_id));
    expect(called).toEqual(new Set(sids));
  });

  it("RPC ล้มชั่วคราวแล้วกลับมา: 500 → 204 ในสอง request ติดกัน (ไม่มี state ค้างใน route) · 429 ไม่ทำให้ request ถัดไปพัง", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { code: "XX000" } });
    rpcMock.mockResolvedValueOnce({ data: null, error: { code: "P0001" } });
    expect((await post(makeRequest())).status).toBe(500);
    expect((await post(makeRequest())).status).toBe(429);
    expect((await post(makeRequest())).status).toBe(204);
  });
});

describe("QA เคส 13 + 'ไม่อ่าน IP/UA/cookie': ล็อกด้วยการอ่านซอร์สของ route + schema + migration", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const route = read("app/api/ring-size/event/route.ts");
  const schema = read("lib/ring-size/track-schema.ts");
  const migration = read("supabase/migrations/0193_ring_size_analytics.sql");

  const code = (src: string) =>
    src
      .split(/\r?\n/) // ไฟล์บน Windows อาจเป็น CRLF — `$` ไม่ match ก่อน \r
      .map((l) => l.replace(/\/\/.*$/, ""))
      .join("\n")
      .replace(/\/\*[\s\S]*?\*\//g, "");

  it("route อ่านเฉพาะ header ใน allowlist: host · origin · sec-fetch-site · content-length", () => {
    const names = [...code(route).matchAll(/headers\.get\(\s*"([^"]+)"\s*\)/g)].map((m) => m[1].toLowerCase());
    expect(new Set(names)).toEqual(new Set(["host", "origin", "sec-fetch-site", "content-length"]));
  });

  it("route ไม่แตะ IP / geo / cookie / UA / next/headers / Referer", () => {
    const c = code(route);
    for (const bad of [/\.ip\b/, /\.geo\b/, /cookies\s*\(/, /\bheaders\s*\(\s*\)/, /next\/headers/, /x-forwarded-for/i, /x-real-ip/i, /cf-connecting-ip/i, /user-agent/i, /referer/i, /set-cookie/i, /\.cookies\b/]) {
      expect(c, String(bad)).not.toMatch(bad);
    }
  });

  it("route ส่งเข้า RPC แค่ 3 พารามิเตอร์ และ import เฉพาะโมดูลที่คาดไว้", () => {
    const rpcArgs = /rpc\(\s*"ring_size_session_upsert"\s*,\s*\{([^}]*)\}/.exec(code(route));
    expect(rpcArgs).not.toBeNull();
    const keys = [...rpcArgs![1].matchAll(/(p_[a-z_]+)\s*:/g)].map((m) => m[1]).sort();
    expect(keys).toEqual(["p_session_id", "p_shop_id", "p_snapshot"]);
    const imports = [...route.matchAll(/^import .* from "([^"]+)";/gm)].map((m) => m[1]).sort();
    expect(imports).toEqual(["@/lib/dev/context", "@/lib/ring-size/track-schema", "@/lib/supabase/postgrest-error", "@/lib/supabase/server", "next/server"]);
  });

  it("track-schema.ts ไม่มี env / network / import ใด ๆ (pure)", () => {
    const c = code(schema);
    expect(c).not.toMatch(/process\.env|fetch\s*\(|sendBeacon|XMLHttpRequest|^\s*import\s/m);
  });

  it("ค่าภายนอกในซอร์สที่ผู้ใช้เห็น/กดได้: route · schema · migration ไม่มี URL / LINE ID / เบอร์ / อีเมล ที่ hardcode", () => {
    for (const [name, src] of [["route", route], ["schema", schema], ["migration", code(migration.replace(/^--.*$/gm, ""))]] as const) {
      const body = name === "migration" ? src : code(src);
      expect(body, `${name}: URL`).not.toMatch(/https?:\/\//i);
      expect(body, `${name}: lin.ee`).not.toMatch(/lin\.ee/i);
      expect(body, `${name}: LINE id @xxx`).not.toMatch(/(^|[\s"'`(])@(?!\/)[a-z0-9][a-z0-9_.-]{2,}/i);
      expect(body, `${name}: phone`).not.toMatch(/\b0[689]\d[- ]?\d{3}[- ]?\d{4}\b/);
      expect(body, `${name}: email`).not.toMatch(/[A-Za-z0-9._-]+@[A-Za-z0-9-]+\.[a-z]{2,}/);
    }
  });

  it("migration: ตารางไม่มีคอลัมน์ที่ระบุตัวตน (ip / ua / cookie / device / ชื่อ / เบอร์ / line / email)", () => {
    const create = /create table if not exists analytics\.ring_size_session \(([\s\S]*?)\n\);/.exec(migration);
    expect(create).not.toBeNull();
    const cols = [...create![1].split(/\r?\n/)].map((l) => /^\s{2}([a-z_]+)\s/.exec(l)?.[1]).filter(Boolean) as string[];
    expect(cols.length).toBe(31);
    for (const c of cols) expect(c, c).not.toMatch(/(^|_)(ip|ua)(_|$)|agent|cookie|device|fingerprint|name|phone|(^|_)tel(_|$)|line_id|email|user_id|address|geo|referrer|(^|_)src(_|$)|source|channel/);
  });
});
