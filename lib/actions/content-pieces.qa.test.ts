// QA (R2-D2) — เคสที่ content-pieces.test.ts ยังไม่ครอบ:
//  · ขอบเขตวัน "วันนี้" ตามเวลาไทย (BKK) ของกองงาน/สัปดาห์ — 00:00–07:00 ไทยต้องไม่ถอยเป็นเมื่อวาน (บทเรียน UTC เหลื่อมวัน)
//  · แต่ละส่วนของหน้าแรกล้มได้อิสระ (กองหนึ่งล้ม กองอื่นยังมา) และข้อความ error ไม่รั่ว
//  · staff ถูกปฏิเสธครบทุก action ที่เหลือ (อ่าน + savePieceBody + toggleShot + getRecoInbox + isWorkflowPiece)
//  · อินพุตสุดโต่งของ defer / unlink / savePieceBody / toggleShot / recordGate / postPiece
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SHOP = "a7c850ee-6776-4c3e-ba72-ba9e8caba2b7";
const STEP = "11111111-1111-4111-8111-111111111111";
const ART = "55555555-5555-4555-8555-555555555555";
const POST = "66666666-6666-4666-8666-666666666666";

const getEffectiveRoleMock = vi.fn();
const rpcMock = vi.fn();
// savePieceBody/toggleShot เรียก RPC เดิมของบอร์ดผ่าน service client เอง (รอบแก้ code review ข้อ 4) → ตรวจที่ rpcMock
const legacyCalls = (fn: string) => rpcMock.mock.calls.filter((c) => c[0] === fn);

interface Op {
  table: string;
  ops: Array<[string, ...unknown[]]>;
}
const calls: Op[] = [];
const tableResults: Record<string, { data: unknown; error: unknown; count?: number }> = {};

function builder(table: string) {
  const call: Op = { table, ops: [] };
  calls.push(call);
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "neq", "not", "in", "lte", "gt", "gte", "or", "order", "limit", "is"]) {
    b[m] = (...args: unknown[]) => {
      call.ops.push([m, ...args]);
      return b;
    };
  }
  const result = () => tableResults[table] ?? { data: [], error: null };
  b.maybeSingle = () => Promise.resolve(result());
  b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej);
  return b;
}
const opsOf = (table: string, name: string) => calls.filter((c) => c.table === table).flatMap((c) => c.ops.filter((o) => o[0] === name));

vi.mock("@/lib/auth/role", () => ({ getEffectiveRole: () => getEffectiveRoleMock() }));
vi.mock("@/lib/dev/context", () => ({ getDevShopId: () => SHOP }));
vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({ schema: () => ({ rpc: rpcMock, from: (t: string) => builder(t) }) }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/marketing/tiktok-link", () => ({
  canonicalizeTikTokLink: async (u: string) => ({ ok: true, url: u }),
  parseCanonicalTikTokPostUrl: () => ({ kind: "video", user: "x", id: "1" }),
}));
vi.mock("@/lib/actions/content", () => ({ getContentTypes: async () => ({ ok: true, data: [] }) }));

import {
  advancePiece,
  deferPiece,
  isWorkflowPiece,
  postPiece,
  recordGate,
  savePieceBody,
  toggleShot,
  unlinkPost,
} from "./content-pieces";
import { getInboxData, getRecoInbox } from "./content-inbox";

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  for (const k of Object.keys(tableResults)) delete tableResults[k];
  getEffectiveRoleMock.mockResolvedValue("owner");
  rpcMock.mockResolvedValue({ data: {}, error: null });
});
afterEach(() => vi.useRealTimers());

describe("วัน 'วันนี้' ตามเวลาไทยในกองงานหน้าแรก (ไม่ใช่ UTC)", () => {
  const cases: Array<{ name: string; now: string; today: string; from: string; to: string }> = [
    // ศุกร์ 9 ต.ค. 2569 00:30 ไทย = 8 ต.ค. 17:30 UTC — UTC จะผิดเป็น 8 ต.ค.
    { name: "00:30 ไทย (ยังเป็นเมื่อวานใน UTC)", now: "2026-10-08T17:30:00Z", today: "2026-10-09", from: "2026-10-05", to: "2026-10-11" },
    { name: "06:59 ไทย", now: "2026-10-08T23:59:00Z", today: "2026-10-09", from: "2026-10-05", to: "2026-10-11" },
    { name: "23:59 ไทย", now: "2026-10-09T16:59:00Z", today: "2026-10-09", from: "2026-10-05", to: "2026-10-11" },
    { name: "00:00 ไทยของวันถัดไป", now: "2026-10-09T17:00:00Z", today: "2026-10-10", from: "2026-10-05", to: "2026-10-11" },
    // คืนวันอาทิตย์ 11 ต.ค. 23:30 ไทย = 16:30 UTC → ยังเป็นสัปดาห์เดิม · เที่ยงคืนไทยขึ้นสัปดาห์ใหม่ (จ. 12 ต.ค.)
    { name: "อาทิตย์ 23:30 ไทย", now: "2026-10-11T16:30:00Z", today: "2026-10-11", from: "2026-10-05", to: "2026-10-11" },
    { name: "จันทร์ 00:00 ไทย = ขึ้นสัปดาห์ใหม่", now: "2026-10-11T17:00:00Z", today: "2026-10-12", from: "2026-10-12", to: "2026-10-18" },
  ];
  for (const c of cases) {
    it(c.name, async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(c.now));
      const r = await getInboxData();
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.data.todayTh).toBe(c.today);
      expect(r.data.weekFrom).toBe(c.from);
      expect(r.data.weekTo).toBe(c.to);
      // กอง "วันนี้ต้องโพสต์": เกณฑ์วันที่ที่ส่งเข้า query = วันไทย
      const lte = opsOf("v_content_piece_calendar", "lte").map((o) => o[2]);
      expect(lte).toContain(c.today); // post pile
      expect(lte).toContain(c.to); // week overlap
      const gt = opsOf("v_content_piece_calendar", "gt").map((o) => o[2]);
      expect(gt).toContain(c.today); // งานถัดไปต้อง "หลังวันนี้ไทย" ไม่ใช่ UTC
      // overlap ของสัปดาห์ใช้ปลาย-ต้นสัปดาห์ไทย
      const orExpr = String(opsOf("v_content_piece_calendar", "or")[0]?.[1] ?? "");
      expect(orExpr).toContain(`resolved_end.gte.${c.from}`);
      expect(orExpr).toContain(`resolved_start.gte.${c.from}`);
    });
  }
});

describe("getInboxData — แต่ละส่วนล้มได้อิสระ", () => {
  it("v_content_piece ล้ม (รออนุมัติ) → กองนั้น ok=false ข้อความไทย · กองอื่นยัง ok · ไม่รั่ว error ดิบ", async () => {
    tableResults.v_content_piece = { data: null, error: { code: "57014", message: "canceling statement due to statement timeout on analytics.v_content_piece (p_secret=abc)" } };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await getInboxData();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.reviewRows.ok).toBe(false);
    if (!r.data.reviewRows.ok) {
      expect(r.data.reviewRows.error).toBe('โหลดกอง "รออนุมัติ" ไม่สำเร็จ');
      expect(r.data.reviewRows.error).not.toMatch(/analytics|57014|p_secret|timeout/i);
    }
    expect(r.data.counts.ok).toBe(true);
    expect(r.data.postRows.ok).toBe(true);
    expect(r.data.reco.ok).toBe(true);
    // log เฉพาะ {code,message} ที่ redact แล้ว — ไม่ใช่ก้อน error
    expect(spy).toHaveBeenCalled();
    for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toMatch(/"details"|"hint"/);
    spy.mockRestore();
  });

  it("ทุกส่วนล้มพร้อมกัน → ยังได้ ok:true ที่มี Part ล้มทั้งหมด (หน้าไม่ crash)", async () => {
    const boom = { data: null, error: { code: "XX000", message: "down" } };
    for (const t of ["v_content_inbox_counts", "v_content_piece_calendar", "v_content_piece", "v_recommendation_inbox", "content_weekly_summary", "v_content_entry_queue", "v_line_quota_28d"]) {
      tableResults[t] = boom;
    }
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await getInboxData();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const k of ["counts", "postRows", "reviewRows", "weekRows", "reco", "weekly", "entryTodayCount", "lineQuota", "nextScheduled"] as const) {
      expect(r.data[k].ok, k).toBe(false);
    }
    spy.mockRestore();
  });

  it("flag_no_link_overdue → เก็บ step id ไว้เฉพาะ true เท่านั้น (ไม่นับ truthy อื่น)", async () => {
    tableResults.v_content_piece_calendar = {
      data: [
        { step_id: "a", piece_status: "approved", resolved_start: "2026-10-08", flag_no_link_overdue: true, title: "A" },
        { step_id: "b", piece_status: "approved", resolved_start: "2026-10-08", flag_no_link_overdue: "true", title: "B" },
        { step_id: "c", piece_status: "approved", resolved_start: "2026-10-08", flag_no_link_overdue: false, title: "C" },
      ],
      error: null,
    };
    const r = await getInboxData();
    expect(r.ok && r.data.overdueNoLinkIds).toEqual(["a"]);
  });
});

describe("สิทธิ์ staff — action ที่เหลือ", () => {
  it("อ่าน/เขียนที่ยังไม่ครอบ ถูกปฏิเสธและไม่แตะ DB", async () => {
    getEffectiveRoleMock.mockResolvedValue("staff");
    const results = await Promise.all([
      savePieceBody(STEP, ART, "x"),
      toggleShot(STEP, ART, "s1", true),
      getRecoInbox(),
    ]);
    for (const r of results) expect(r.ok).toBe(false);
    expect(await isWorkflowPiece(STEP)).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
    expect(legacyCalls("campaign_set_artifact_content")).toHaveLength(0);
    expect(legacyCalls("campaign_toggle_clip_shot")).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });
});

describe("getRecoInbox / isWorkflowPiece", () => {
  it("getRecoInbox กรอง shop_id + มีเพดานแถว", async () => {
    await getRecoInbox();
    expect(opsOf("v_recommendation_inbox", "eq")).toContainEqual(["eq", "shop_id", SHOP]);
    // รอบแก้ code review ข้อ 3: query แยก "รอตอบ" (eq pending เรียง respond_by nulls last) กับ "ประวัติ" (neq pending) — รอตอบไม่หลุดเมื่อประวัติเกินเพดาน
    expect(opsOf("v_recommendation_inbox", "limit").length).toBe(2);
    expect(opsOf("v_recommendation_inbox", "eq")).toContainEqual(["eq", "effective_action", "pending"]);
    expect(opsOf("v_recommendation_inbox", "neq")).toContainEqual(["neq", "effective_action", "pending"]);
    expect(opsOf("v_recommendation_inbox", "order")).toContainEqual(["order", "respond_by", { ascending: true, nullsFirst: false }]);
  });
  it("isWorkflowPiece: uuid ผิด → false โดยไม่ query · DB ล้ม → false (ไม่ redirect ผิด) · พบแถว → true", async () => {
    expect(await isWorkflowPiece("../../etc")).toBe(false);
    expect(calls).toHaveLength(0);
    tableResults.campaign_step = { data: null, error: { code: "XX000", message: "down" } };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await isWorkflowPiece(STEP)).toBe(false);
    spy.mockRestore();
    tableResults.campaign_step = { data: { id: STEP }, error: null };
    expect(await isWorkflowPiece(STEP)).toBe(true);
    tableResults.campaign_step = { data: null, error: null };
    expect(await isWorkflowPiece(STEP)).toBe(false);
    expect(opsOf("campaign_step", "eq")).toContainEqual(["eq", "shop_id", SHOP]);
    expect(opsOf("campaign_step", "not")).toContainEqual(["not", "piece_status", "is", null]);
  });
});

describe("อินพุตสุดโต่ง — ต้องไม่ถึง RPC", () => {
  // security L4 (รอบแก้): savePieceBody/toggleShot ตรวจว่า artifact เป็นของ step นี้จาก v_content_piece ก่อนเรียกของเดิม
  beforeEach(() => {
    tableResults.v_content_piece = { data: { artifact_id: ART }, error: null };
  });

  it("advancePiece: เหตุผลยาว > 500 · เหตุผลเป็นอักขระล่องหนล้วน · to เป็นค่าแปลก (ว่าง/null/ตัวพิมพ์ใหญ่/ชื่อฟังก์ชัน)", async () => {
    expect((await advancePiece(STEP, "cancelled", { reason: "ก".repeat(501) })).ok).toBe(false);
    expect((await advancePiece(STEP, "cancelled", { reason: "​​​​" })).ok).toBe(false);
    for (const to of ["", "APPROVED", "approved ", "content_piece_advance", "measured", "missed_measure", null as unknown as string, undefined as unknown as string]) {
      expect((await advancePiece(STEP, to)).ok, String(to)).toBe(false);
    }
    expect(rpcMock).not.toHaveBeenCalled();
  });
  it("advancePiece: เหตุผล 500 ตัวพอดี ผ่าน · emoji/ไทยนับเป็นตัวอักษร", async () => {
    expect((await advancePiece(STEP, "cancelled", { reason: "ก".repeat(500) })).ok).toBe(true);
    expect((await advancePiece(STEP, "hold", { reason: "รอ😀" })).ok).toBe(true);
    expect(rpcMock).toHaveBeenCalledTimes(2);
  });
  it("advancePiece: reviewSeconds สุดโต่ง (NaN / Infinity / 86401 / ทศนิยม) → null หรือปัดลง ไม่ปฏิเสธการอนุมัติ", async () => {
    for (const s of [Number.NaN, Number.POSITIVE_INFINITY, 86_401, -1]) {
      rpcMock.mockClear();
      expect((await advancePiece(STEP, "approved", { reviewSeconds: s })).ok).toBe(true);
      expect(rpcMock.mock.calls[0][1].p_review_seconds).toBeNull();
    }
    rpcMock.mockClear();
    await advancePiece(STEP, "approved", { reviewSeconds: 59.9 });
    expect(rpcMock.mock.calls[0][1].p_review_seconds).toBe(59);
    rpcMock.mockClear();
    await advancePiece(STEP, "approved", { reviewSeconds: 0 });
    expect(rpcMock.mock.calls[0][1].p_review_seconds).toBe(0); // 0 เป็นค่าจริง
  });

  it("deferPiece: วันที่ไม่มีจริง/รูปแบบผิด/เวลาผิด/เหตุผลสั้น → ไม่เรียก RPC", async () => {
    for (const d of ["2026-02-30", "2026-13-01", "12/10/2026", "", "2026-10-9", "2026-10-09T00:00"]) {
      expect((await deferPiece(STEP, d, "เหตุผลดี")).ok, d).toBe(false);
    }
    for (const t of ["25:00", "9:00", "12:60", "ab:cd"]) {
      expect((await deferPiece(STEP, "2026-10-12", "เหตุผลดี", t)).ok, t).toBe(false);
    }
    expect((await deferPiece(STEP, "2026-10-12", "ab")).ok).toBe(false);
    expect((await deferPiece(STEP, "2026-10-12", "ก".repeat(501))).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
  it("deferPiece: ถูกต้อง → ส่งวัน/เวลา/เหตุผล (ไม่มีเวลา = null)", async () => {
    await deferPiece(STEP, "2026-10-12", "ลูกค้าขอเลื่อน");
    expect(rpcMock.mock.calls[0][1]).toMatchObject({ p_new_date: "2026-10-12", p_reason: "ลูกค้าขอเลื่อน", p_new_time: null });
    await deferPiece(STEP, "2026-10-12", "ลูกค้าขอเลื่อน", "09:30");
    expect(rpcMock.mock.calls[1][1].p_new_time).toBe("09:30");
  });

  it("unlinkPost: post id ไม่ใช่ uuid / เหตุผลว่าง → ไม่เรียก RPC", async () => {
    expect((await unlinkPost(STEP, "x", "เหตุผลดี")).ok).toBe(false);
    expect((await unlinkPost(STEP, POST, "  ")).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
    expect((await unlinkPost(STEP, POST, "ลิงก์ผิด")).ok).toBe(true);
    expect(rpcMock.mock.calls[0][0]).toBe("content_post_unlink_step");
  });

  it("savePieceBody: เนื้อหา > 20,000 / id ผิด / ไม่ใช่ string → ไม่เรียก setArtifactContent", async () => {
    expect((await savePieceBody(STEP, ART, "ก".repeat(20_001))).ok).toBe(false);
    expect((await savePieceBody("x", ART, "ok")).ok).toBe(false);
    expect((await savePieceBody(STEP, "x", "ok")).ok).toBe(false);
    expect((await savePieceBody(STEP, ART, 123 as unknown as string)).ok).toBe(false);
    expect(legacyCalls("campaign_set_artifact_content")).toHaveLength(0);
    expect((await savePieceBody(STEP, ART, "ก".repeat(20_000))).ok).toBe(true);
    expect(legacyCalls("campaign_set_artifact_content").at(-1)?.[1]).toEqual({ p_artifact_id: ART, p_content_body: "ก".repeat(20_000), p_clip_brief: null });
  });
  it("savePieceBody: เนื้อหาว่าง (ล้างข้อความ) ส่งต่อให้ DB ตัดสิน — ไม่ถูก action ทิ้งเงียบ", async () => {
    expect((await savePieceBody(STEP, ART, "")).ok).toBe(true);
    expect(legacyCalls("campaign_set_artifact_content").at(-1)?.[1]).toEqual({ p_artifact_id: ART, p_content_body: "", p_clip_brief: null });
  });
  it("savePieceBody: error จาก action เดิม ส่งต่อข้อความ (ไม่กลืน)", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { code: "55000", message: "campaign_set_artifact_content: อนุมัติแล้ว ห้ามแก้เนื้อหา" } });
    expect(await savePieceBody(STEP, ART, "x")).toEqual({ ok: false, error: "อนุมัติแล้วแก้เนื้อหาไม่ได้ — ส่งกลับก่อน", stale: false });
  });

  it("toggleShot: shot id ว่าง/ยาว > 80/ไม่ใช่ string · done ที่ไม่ใช่ true เป๊ะ = false", async () => {
    expect((await toggleShot(STEP, ART, "", true)).ok).toBe(false);
    expect((await toggleShot(STEP, ART, "s".repeat(81), true)).ok).toBe(false);
    expect((await toggleShot(STEP, ART, 5 as unknown as string, true)).ok).toBe(false);
    expect((await toggleShot(STEP, "x", "s1", true)).ok).toBe(false);
    expect(legacyCalls("campaign_toggle_clip_shot")).toHaveLength(0);
    await toggleShot(STEP, ART, "s1", "true" as unknown as boolean);
    expect(legacyCalls("campaign_toggle_clip_shot").at(-1)?.[1]).toEqual({ p_artifact_id: ART, p_shot_id: "s1", p_done: false });
    await toggleShot(STEP, ART, "s".repeat(80), true);
    expect(legacyCalls("campaign_toggle_clip_shot").at(-1)?.[1]).toEqual({ p_artifact_id: ART, p_shot_id: "s".repeat(80), p_done: true });
  });

  it("recordGate: risk_owner คำตอบที่ซ่อน [ต้องยืนยัน ด้วยอักขระล่องหนคั่นกลาง → ถูกจับ ไม่ถึง RPC", async () => {
    tableResults.step_gate = { data: { detail: { question: "ถามอะไร" } }, error: null };
    for (const a of ["[ต้องยืนยัน: x]", "[ ต้อง ยืนยัน: x]", "[ต้อง​ยืนยัน: x]", "[​ต้องยืนยัน]"]) {
      const r = await recordGate(STEP, { gateKind: "risk_owner", status: "passed", answer: a });
      expect(r.ok, JSON.stringify(a)).toBe(false);
    }
    expect(rpcMock).not.toHaveBeenCalled();
  });
  it("recordGate: risk_owner อ่านคำถามเดิมล้ม → ไม่ส่ง RPC (ไม่เขียนทับ detail ทิ้งคำถาม) · ข้อความไทย", async () => {
    tableResults.step_gate = { data: null, error: { code: "XX000", message: "down" } };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await recordGate(STEP, { gateKind: "risk_owner", status: "passed", answer: "ตอบ" });
    expect(r.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
    spy.mockRestore();
  });
  it("recordGate: brand_rule/fact_check รายการยาวเกิน / ลิงก์สุดโต่ง → ไม่ถึง RPC", async () => {
    const many = Array.from({ length: 31 }, (_, i) => `https://example.com/${i}`);
    expect((await recordGate(STEP, { gateKind: "fact_check", status: "pending", sources: many })).ok).toBe(false);
    expect((await recordGate(STEP, { gateKind: "fact_check", status: "pending", sources: ["https://example.com/" + "a".repeat(500)] })).ok).toBe(false);
    expect((await recordGate(STEP, { gateKind: "brand_rule", status: "blocked", rulesHit: ["x".repeat(301)] })).ok).toBe(false);
    expect((await recordGate(STEP, { gateKind: "brand_rule", status: "blocked", rulesHit: "not-an-array" as unknown as string[] })).ok).toBe(false);
    expect((await recordGate(STEP, { gateKind: "fact_check", status: "pending", sources: ["https://a.example/x"], note: "n".repeat(501) })).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
  it("recordGate: แหล่งซ้ำถูกรวมเหลือหนึ่ง · ส่งทั้งชุดทุกครั้ง", async () => {
    await recordGate(STEP, { gateKind: "fact_check", status: "passed", sources: ["https://a.example/x", "https://a.example/x"], flagged: [] });
    expect(rpcMock.mock.calls[0][1].p_detail).toEqual({ sources: ["https://a.example/x"], flagged: [] });
  });
});

describe("postPiece — อินพุตสุดโต่ง", () => {
  beforeEach(() => {
    tableResults.campaign_step = { data: { piece_kind: "short_clip" }, error: null };
  });
  const base = { platform: "tiktok", url: "https://www.tiktok.com/@x/video/1", postedAtLocal: "2026-10-09T10:00", hook: { kind: "skip" } as const };

  it("ลิงก์ยาว > 2048 → ปฏิเสธก่อนถึง DB/ก่อน fetch", async () => {
    const r = await postPiece(STEP, { ...base, url: "https://www.tiktok.com/@x/video/" + "1".repeat(2100) });
    expect(r.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0); // ไม่ทันอ่านชนิดชิ้นด้วยซ้ำ
  });
  it("ช่องทาง/hook แปลก (line, ว่าง, kind ไม่รู้จัก, hookType นอก 8) → ปฏิเสธ", async () => {
    expect((await postPiece(STEP, { ...base, platform: "line" })).ok).toBe(false);
    expect((await postPiece(STEP, { ...base, platform: "" })).ok).toBe(false);
    expect((await postPiece(STEP, { ...base, hook: { kind: "weird" } as never })).ok).toBe(false);
    expect((await postPiece(STEP, { ...base, hook: { kind: "other", text: "x", hookType: "nope" } })).ok).toBe(false);
    expect((await postPiece(STEP, { ...base, hook: { kind: "other", text: "x".repeat(501), hookType: "question" } })).ok).toBe(false);
    expect((await postPiece(STEP, { ...base, hook: { kind: "other", text: "​ ", hookType: "question" } })).ok).toBe(false);
    expect((await postPiece(STEP, { ...base, hook: { kind: "existing", hookId: "x" } })).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
  it("ชนิดชิ้นอ่านจาก DB ไม่ได้ (error) → ไม่ถึง RPC · ข้อความไทย", async () => {
    tableResults.campaign_step = { data: null, error: { code: "XX000", message: "down" } };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await postPiece(STEP, base);
    expect(r).toEqual({ ok: false, error: "บันทึกโพสต์ไม่สำเร็จ ลองใหม่อีกครั้ง" });
    expect(rpcMock).not.toHaveBeenCalled();
    spy.mockRestore();
  });
  it("ชิ้นไม่มีชนิด (null) หรือเป็น LINE → ไม่มีช่องทางโพสต์ให้", async () => {
    tableResults.campaign_step = { data: { piece_kind: null }, error: null };
    expect((await postPiece(STEP, base)).ok).toBe(false);
    tableResults.campaign_step = { data: { piece_kind: "line_message" }, error: null };
    expect((await postPiece(STEP, base)).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
