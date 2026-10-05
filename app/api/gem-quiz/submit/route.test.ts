// app/api/gem-quiz/submit/route.test.ts — ครอบเคส R-1/R-2/R-3/R-4/R-5/R-8/
// R-12/R-13 ของ design doc §5.5 ที่เป็นหน้าที่ของ route.ts เอง (R-6/R-7 ถูก
// ครอบแบบ unit ที่ lib/gem-quiz/validate.test.ts ไปแล้ว — ที่นี่แค่ยืนยันว่า
// route แมป validate ไม่ผ่านเป็นสถานะ HTTP ที่ถูกต้อง). lib/gem-quiz/validate.ts
// และ lib/gem-quiz/recommend.ts ไม่ mock (pure, เร็ว, ให้ coverage จริงว่า
// route ต่อกับสองไฟล์นี้ถูก) — mock เฉพาะ I/O ภายนอก: form-token (timing),
// service client (DB), getDevShopId (env).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { QUIZ_VERSION } from "@/lib/gem-quiz/config";

const verifyFormTokenMock = vi.fn();
const rpcMock = vi.fn();

vi.mock("@/lib/gem-quiz/form-token", () => ({
  verifyFormToken: (...args: unknown[]) => verifyFormTokenMock(...args),
}));

vi.mock("@/lib/dev/context", () => ({
  getDevShopId: () => "11111111-1111-1111-1111-111111111111",
}));

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({
    schema: () => ({ rpc: rpcMock }),
  }),
}));

const ORIGIN = "https://oms-3j.vercel.app";
const HOST = "oms-3j.vercel.app";

function makeRequest(opts: {
  body?: unknown;
  rawBody?: string;
  headers?: Record<string, string>;
  method?: string;
}): NextRequest {
  const bodyStr = opts.rawBody ?? JSON.stringify(opts.body ?? {});
  return new NextRequest(`https://${HOST}/api/gem-quiz/submit`, {
    method: opts.method ?? "POST",
    headers: {
      origin: ORIGIN,
      host: HOST,
      "content-type": "application/json",
      ...opts.headers,
    },
    body: bodyStr,
  });
}

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: QUIZ_VERSION,
    src: "card",
    token: "doesnt-matter-mocked",
    hp: "",
    liked: ["blue_topaz", "garnet"],
    answers: { birth_day: "sun", intention: "career", feeling: "energy", jewelry_type: "ring" },
    retake: false,
    ...overrides,
  };
}

beforeEach(() => {
  verifyFormTokenMock.mockReset();
  rpcMock.mockReset();
  verifyFormTokenMock.mockReturnValue({ ok: true });
  rpcMock.mockResolvedValue({ data: null, error: null });
});

describe("POST /api/gem-quiz/submit", () => {
  it("R-1: export เฉพาะ POST (ไม่มี GET/PUT/DELETE/PATCH export) — Next.js ตอบ 405 ให้อัตโนมัติ", async () => {
    const mod = await import("./route");
    expect(typeof mod.POST).toBe("function");
    expect((mod as Record<string, unknown>).GET).toBeUndefined();
    expect((mod as Record<string, unknown>).PUT).toBeUndefined();
    expect((mod as Record<string, unknown>).DELETE).toBeUndefined();
    expect((mod as Record<string, unknown>).PATCH).toBeUndefined();
  });

  it("happy path: body ถูกต้องครบ + token ผ่าน ⇒ 204, RPC ถูกเรียกด้วยพารามิเตอร์ที่ validate/recommend คำนวณ", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeRequest({ body: validBody() }));
    expect(res.status).toBe(204);
    expect(rpcMock).toHaveBeenCalledTimes(1);
    const [rpcName, params] = rpcMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(rpcName).toBe("gem_quiz_submit");
    expect(params.p_shop_id).toBe("11111111-1111-1111-1111-111111111111");
    expect(params.p_src).toBe("card");
    expect(params.p_liked_stone_codes).toEqual(["blue_topaz", "garnet"]);
    // recommended ต้องมี 1 ตัว (B4) และเป็นรหัสจริง — คำนวณจริงโดย recommend.ts
    // ไม่ได้ mock (R-8: server คำนวณเอง ไม่เชื่อ client)
    expect(Array.isArray(params.p_recommended_stone_codes)).toBe(true);
    expect((params.p_recommended_stone_codes as string[]).length).toBe(1);
  });

  it("R-8: client ส่ง recommended/shop_id มาเอง ⇒ ค่าที่ไปถึง RPC เป็นของ server เท่านั้น ไม่ใช่ของ client", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        body: validBody({
          recommended: ["ruby", "sapphire"], // ไม่อยู่ใน contract เลย — validate.ts ทิ้งอยู่แล้ว
          shop_id: "99999999-9999-9999-9999-999999999999",
        }),
      })
    );
    expect(res.status).toBe(204);
    const [, params] = rpcMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(params.p_shop_id).toBe("11111111-1111-1111-1111-111111111111"); // จาก getDevShopId() เท่านั้น
    expect(params.p_recommended_stone_codes).not.toEqual(["ruby", "sapphire"]); // ไม่เชื่อ client
  });

  describe("R-2: body size", () => {
    it("content-length header บอกเกิน 2KB ⇒ 413 (ไม่อ่าน body เลย)", async () => {
      const { POST } = await import("./route");
      const req = makeRequest({ body: validBody(), headers: { "content-length": "99999" } });
      const res = await POST(req);
      expect(res.status).toBe(413);
    });

    it("content-length ไม่ตรง/ขาด แต่ body จริงเกิน 2KB ⇒ 413 (เช็คความยาวจริงหลังอ่าน)", async () => {
      const { POST } = await import("./route");
      const bigAnswerValue = "a".repeat(3000); // เกิน 2KB แน่นอน แม้ answers.value นี้จะไม่ผ่าน regex ต่อก็ตาม — ต้องตก 413 ก่อนถึงขั้น validate เนื้อหา
      const req = makeRequest({
        rawBody: JSON.stringify(validBody({ answers: { intention: bigAnswerValue } })),
        headers: { "content-length": "10" }, // โกหก header ว่าเล็ก
      });
      const res = await POST(req);
      expect(res.status).toBe(413);
    });
  });

  describe("R-3: same-origin (L1)", () => {
    it("Origin เป็นโดเมนอื่น ⇒ 403", async () => {
      const { POST } = await import("./route");
      const req = makeRequest({ body: validBody(), headers: { origin: "https://evil.example.com" } });
      const res = await POST(req);
      expect(res.status).toBe(403);
    });

    it("ไม่มี Origin แต่ sec-fetch-site: same-origin ⇒ ผ่าน L1 (ไปต่อจนถึง 204)", async () => {
      const { POST } = await import("./route");
      const req = new NextRequest(`https://${HOST}/api/gem-quiz/submit`, {
        method: "POST",
        headers: { host: HOST, "content-type": "application/json", "sec-fetch-site": "same-origin" },
        body: JSON.stringify(validBody()),
      });
      const res = await POST(req);
      expect(res.status).toBe(204);
    });

    it("ไม่มี Origin และไม่มี sec-fetch-site เลย ⇒ 403 (ระวังไว้ก่อน)", async () => {
      const { POST } = await import("./route");
      const req = new NextRequest(`https://${HOST}/api/gem-quiz/submit`, {
        method: "POST",
        headers: { host: HOST, "content-type": "application/json" },
        body: JSON.stringify(validBody()),
      });
      const res = await POST(req);
      expect(res.status).toBe(403);
    });

    it("body ไม่ใช่ JSON ที่ถูกต้อง ⇒ 400", async () => {
      const { POST } = await import("./route");
      const req = makeRequest({ rawBody: "{not valid json" });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it("body เป็น JSON array ไม่ใช่ object ⇒ 400", async () => {
      const { POST } = await import("./route");
      const req = makeRequest({ rawBody: "[1,2,3]" });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    // QA เพิ่ม: body ที่เป็น valid JSON ตามสเปค JSON แต่ค่าชั้นบนสุดไม่ใช่ object
    // เลย (ไม่ใช่แค่ array) — JSON.parse ผ่านได้เฉย ๆ, ด่านที่ต้องจับคือเช็ค
    // typeof ถัดมา ไม่ใช่เช็ค JSON.parse throw/not-throw
    it.each([
      ["number เปล่า", "42"],
      ["string เปล่า (แต่เป็น valid JSON เพราะมี quote)", '"hello"'],
      ["boolean เปล่า", "true"],
      ["null เปล่า", "null"],
    ])("body เป็น valid JSON แต่ค่าชั้นบนสุดเป็น %s (ไม่ใช่ object) ⇒ 400", async (_label, rawBody) => {
      const { POST } = await import("./route");
      const req = makeRequest({ rawBody });
      const res = await POST(req);
      expect(res.status).toBe(400);
      expect(rpcMock).not.toHaveBeenCalled();
    });
  });

  describe("L3 honeypot + L2 token (R-4/R-5/R-9)", () => {
    it("honeypot (hp) มีค่า ⇒ 204 เงียบ ไม่เรียก RPC เลย", async () => {
      const { POST } = await import("./route");
      const res = await POST(makeRequest({ body: validBody({ hp: "i-am-a-bot" }) }));
      expect(res.status).toBe(204);
      expect(rpcMock).not.toHaveBeenCalled();
    });

    it("R-9: token secret ไม่ตั้ง (form-token คืน secret_unset) ⇒ 503, ไม่เรียก RPC", async () => {
      verifyFormTokenMock.mockReturnValue({ ok: false, reason: "secret_unset" });
      const { POST } = await import("./route");
      const res = await POST(makeRequest({ body: validBody() }));
      expect(res.status).toBe(503);
      expect(rpcMock).not.toHaveBeenCalled();
    });

    it("R-5: token เร็วเกินมนุษย์ (too_fast) ⇒ 204 เงียบ ไม่เรียก RPC", async () => {
      verifyFormTokenMock.mockReturnValue({ ok: false, reason: "too_fast" });
      const { POST } = await import("./route");
      const res = await POST(makeRequest({ body: validBody() }));
      expect(res.status).toBe(204);
      expect(rpcMock).not.toHaveBeenCalled();
    });

    it.each(["missing", "malformed", "bad_signature", "too_old"] as const)(
      "R-4: token reason=%s ⇒ 400, ไม่เรียก RPC",
      async (reason) => {
        verifyFormTokenMock.mockReturnValue({ ok: false, reason });
        const { POST } = await import("./route");
        const res = await POST(makeRequest({ body: validBody() }));
        expect(res.status).toBe(400);
        expect(rpcMock).not.toHaveBeenCalled();
      }
    );
  });

  describe("validate ไม่ผ่าน (R-6/R-7 — ตรรกะจริงอยู่ที่ validate.test.ts, ที่นี่ยืนยันการแมปสถานะ)", () => {
    it("liked มีรหัสไม่จริง ⇒ 400", async () => {
      const { POST } = await import("./route");
      const res = await POST(makeRequest({ body: validBody({ liked: ["not_a_real_stone"] }) }));
      expect(res.status).toBe(400);
      expect(rpcMock).not.toHaveBeenCalled();
    });

    it("liked มี code พลอยที่ปิดแล้วใน v2 (ruby — เลิกใช้ตาม migration 0157) ⇒ 400", async () => {
      const { POST } = await import("./route");
      const res = await POST(makeRequest({ body: validBody({ liked: ["ruby"] }) }));
      expect(res.status).toBe(400);
      expect(rpcMock).not.toHaveBeenCalled();
    });

    it("liked ว่างเปล่า (v2: ไม่มี 'ยังไม่มีในใจ' อีกแล้ว ต้องเลือกอย่างน้อย 1) ⇒ 400", async () => {
      const { POST } = await import("./route");
      const res = await POST(makeRequest({ body: validBody({ liked: [] }) }));
      expect(res.status).toBe(400);
      expect(rpcMock).not.toHaveBeenCalled();
    });

    it("answers ไม่ครบ 4 คำถาม (ขาด jewelry_type) ⇒ 400", async () => {
      const { POST } = await import("./route");
      const res = await POST(
        makeRequest({ body: validBody({ answers: { birth_day: "sun", intention: "career", feeling: "energy" } }) })
      );
      expect(res.status).toBe(400);
      expect(rpcMock).not.toHaveBeenCalled();
    });

    it("R-13: quiz_version ไม่ตรงกับ config ปัจจุบัน ⇒ 409 ไม่ใช่ 400", async () => {
      const { POST } = await import("./route");
      const res = await POST(makeRequest({ body: validBody({ v: QUIZ_VERSION + 1 }) }));
      expect(res.status).toBe(409);
      expect(rpcMock).not.toHaveBeenCalled();
    });
  });

  describe("RPC error mapping (R-12)", () => {
    it("RPC ปฏิเสธด้วย P0001 (circuit breaker) ⇒ 429, ไม่ echo error body", async () => {
      rpcMock.mockResolvedValue({ data: null, error: { code: "P0001", message: "เกิน cap" } });
      const { POST } = await import("./route");
      const res = await POST(makeRequest({ body: validBody() }));
      expect(res.status).toBe(429);
    });

    it("RPC ปฏิเสธด้วย 22023 (validation ที่ DB เจอเพิ่ม) ⇒ 400", async () => {
      rpcMock.mockResolvedValue({ data: null, error: { code: "22023", message: "..." } });
      const { POST } = await import("./route");
      const res = await POST(makeRequest({ body: validBody() }));
      expect(res.status).toBe(400);
    });

    it("RPC ล้มเหลวแบบไม่คาดคิด (error อื่น) ⇒ 500 และไม่ echo error object ทั้งก้อนกลับ client", async () => {
      rpcMock.mockResolvedValue({
        data: null,
        error: { code: "XX000", message: "internal postgres error with secret host info" },
      });
      const { POST } = await import("./route");
      const res = await POST(makeRequest({ body: validBody() }));
      expect(res.status).toBe(500);
      const bodyText = await res.text();
      expect(bodyText).not.toContain("secret host info");
    });
  });
});
