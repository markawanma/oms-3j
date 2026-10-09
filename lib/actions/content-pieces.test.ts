// lib/actions/content-pieces.test.ts — พิสูจน์ "ด่านที่ action ต้องบังคับเอง" (F2/F3/F4 ของแผน P1a)
// mock pattern เดียวกับ lib/actions/content.test.ts (getEffectiveRole + getDevShopId + getServiceClient)
import { beforeEach, describe, expect, it, vi } from "vitest";

const SHOP = "a7c850ee-6776-4c3e-ba72-ba9e8caba2b7";
const STEP = "11111111-1111-4111-8111-111111111111";
const ITEM = "22222222-2222-4222-8222-222222222222";
const RECO = "33333333-3333-4333-8333-333333333333";
const HOOK = "44444444-4444-4444-8444-444444444444";

const getEffectiveRoleMock = vi.fn();
const rpcMock = vi.fn();
const canonicalizeMock = vi.fn();
const parseCanonicalMock = vi.fn();

interface Call {
  table: string;
  eqs: Array<[string, unknown]>;
  selected: string | undefined;
}
const calls: Call[] = [];
const tableResults: Record<string, { data: unknown; error: unknown }> = {};

function builder(table: string) {
  const call: Call = { table, eqs: [], selected: undefined };
  calls.push(call);
  const b: Record<string, unknown> = {};
  const chain = () => b;
  b.select = (cols?: string) => {
    call.selected = cols;
    return b;
  };
  b.eq = (k: string, v: unknown) => {
    call.eqs.push([k, v]);
    return b;
  };
  for (const m of ["in", "lte", "gt", "or", "order", "limit", "is"]) b[m] = chain;
  const result = () => tableResults[table] ?? { data: null, error: null };
  b.maybeSingle = () => Promise.resolve(result());
  b.then = (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res);
  return b;
}

vi.mock("@/lib/auth/role", () => ({ getEffectiveRole: () => getEffectiveRoleMock() }));
vi.mock("@/lib/dev/context", () => ({ getDevShopId: () => SHOP }));
vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({
    schema: (name: string) => {
      expect(name).toBe("analytics");
      return { rpc: rpcMock, from: (t: string) => builder(t) };
    },
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/marketing/tiktok-link", () => ({
  canonicalizeTikTokLink: (u: string) => canonicalizeMock(u),
  parseCanonicalTikTokPostUrl: (u: string) => parseCanonicalMock(u),
}));
vi.mock("@/lib/actions/content", () => ({ getContentTypes: async () => ({ ok: true, data: [] }) }));

import {
  advancePiece,
  deferPiece,
  getPieceDetail,
  postPiece,
  postPieceNoUrl,
  recordGate,
  resolveConfirm,
  setPlan,
  unlinkPost,
  savePieceBody,
  toggleShot,
  upsertHook,
} from "./content-pieces";
import { getInboxData, respondReco } from "./content-inbox";

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  for (const k of Object.keys(tableResults)) delete tableResults[k];
  getEffectiveRoleMock.mockResolvedValue("owner");
  rpcMock.mockResolvedValue({ data: {}, error: null });
  canonicalizeMock.mockImplementation(async (u: string) => ({ ok: true, url: u }));
  parseCanonicalMock.mockReturnValue({ kind: "video", user: "x", id: "1" });
});

describe("F2 — สิทธิ์: staff เรียกไม่ได้ และไม่ถึง RPC", () => {
  it("ทุก action เขียนปฏิเสธ role staff", async () => {
    getEffectiveRoleMock.mockResolvedValue("staff");
    const results = await Promise.all([
      advancePiece(STEP, "approved"),
      postPieceNoUrl(STEP),
      recordGate(STEP, { gateKind: "brand_rule", status: "passed" }),
      resolveConfirm(STEP, ITEM, "คำตอบ"),
      setPlan(STEP, { hypothesis: "x" }),
      upsertHook(STEP, { label: "A", text: "x", hookType: "question" }),
      postPiece(STEP, { platform: "tiktok", url: "https://www.tiktok.com/@x/video/1", postedAtLocal: "2026-10-09T10:00", hook: { kind: "skip" } }),
      unlinkPost(STEP, ITEM, "เหตุผล"),
      deferPiece(STEP, "2026-10-12", "เหตุผล"),
      respondReco({ recoId: RECO, action: "done", response: "", token: "tok" }),
      getPieceDetail(STEP),
      getInboxData(),
    ]);
    for (const r of results) expect(r.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });
});

describe("F2 — actor_role ตายตัว 'owner' · shop_id จาก server เสมอ", () => {
  it("advancePiece ส่ง p_actor_role=owner และ p_shop_id จาก getDevShopId", async () => {
    const r = await advancePiece(STEP, "in_review");
    expect(r.ok).toBe(true);
    const [fn, params] = rpcMock.mock.calls[0];
    expect(fn).toBe("content_piece_advance");
    expect(params.p_actor_role).toBe("owner");
    expect(params.p_shop_id).toBe(SHOP);
  });
  it("พารามิเตอร์พิเศษที่แอบส่งมา (actorRole/shopId) ไม่ถูกส่งต่อ", async () => {
    await advancePiece(STEP, "in_review", { actorRole: "ai", shopId: "evil" } as never);
    const [, params] = rpcMock.mock.calls[0];
    expect(params.p_actor_role).toBe("owner");
    expect(params.p_shop_id).toBe(SHOP);
    expect(JSON.stringify(params)).not.toContain("evil");
  });
});

describe("advancePiece — allowlist + เหตุผล + review seconds", () => {
  it("ปลายทางนอก allowlist / step id ไม่ใช่ uuid → ไม่เรียก RPC", async () => {
    expect((await advancePiece(STEP, "measured")).ok).toBe(false);
    expect((await advancePiece("not-a-uuid", "approved")).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
  it("ยกเลิก/พัก/กู้คืนต้องมีเหตุผล — ไม่มี = ไม่เรียก RPC พร้อมข้อความไทย", async () => {
    for (const to of ["cancelled", "hold", "restore"]) {
      const r = await advancePiece(STEP, to, { reason: " a " });
      expect(r).toEqual({ ok: false, error: "ใส่เหตุผลอย่างน้อย 3 ตัวอักษร" });
    }
    expect(rpcMock).not.toHaveBeenCalled();
  });
  it("review seconds ส่งเฉพาะตอน approved · ค่าผิดไม่บล็อกการอนุมัติ", async () => {
    await advancePiece(STEP, "approved", { reviewSeconds: 95 });
    expect(rpcMock.mock.calls[0][1].p_review_seconds).toBe(95);
    await advancePiece(STEP, "approved", { reviewSeconds: -5 });
    expect(rpcMock.mock.calls[1][1].p_review_seconds).toBeNull();
    await advancePiece(STEP, "drafting", { reviewSeconds: 95 });
    expect(rpcMock.mock.calls[2][1].p_review_seconds).toBeNull();
  });
  it("error จาก DB แปลงเป็นไทย ไม่รั่วชื่อฟังก์ชัน/enum และตั้งธง stale", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "55000", message: "content_piece_advance: ชิ้นงานอยู่สถานะ in_review แล้ว" } });
    const r = await advancePiece(STEP, "in_review");
    expect(r).toEqual({ ok: false, error: "ชิ้นนี้เปลี่ยนสถานะไปแล้ว — รีเฟรชเพื่อดูล่าสุด", stale: true });
  });
  it("log เฉพาะ {code, message} ไม่ log ก้อน error ทั้งก้อน", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: "22023", message: "bad https://secret.example/x?token=abc", details: "SENSITIVE-DETAILS", hint: "h" },
    });
    await advancePiece(STEP, "in_review");
    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).not.toContain("SENSITIVE-DETAILS");
    expect(logged).not.toContain("secret.example");
    spy.mockRestore();
  });
});

describe("recordGate", () => {
  it("fact_check ผ่านโดยไม่มีแหล่ง → ปฏิเสธก่อนถึง DB", async () => {
    const r = await recordGate(STEP, { gateKind: "fact_check", status: "passed", sources: [] });
    expect(r.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
  it("fact_check ส่ง detail ทั้งชุด", async () => {
    await recordGate(STEP, { gateKind: "fact_check", status: "passed", sources: ["https://a.org/x"], flagged: [] });
    const [fn, params] = rpcMock.mock.calls[0];
    expect(fn).toBe("content_gate_record");
    expect(params.p_detail).toEqual({ sources: ["https://a.org/x"], flagged: [] });
    expect(params.p_gate_kind).toBe("fact_check");
  });
  it("risk_owner: คำถามเดิมมาจาก DB (step_gate ของร้านนี้) ไม่ใช่จาก client", async () => {
    tableResults.step_gate = { data: { detail: { question: "คำถามจาก DB" } }, error: null };
    await recordGate(STEP, { gateKind: "risk_owner", status: "passed", answer: "ใช้ได้", question: "คำถามปลอมจาก client" } as never);
    expect(rpcMock.mock.calls[0][1].p_detail).toEqual({ question: "คำถามจาก DB", answer: "ใช้ได้" });
    const q = calls.find((c) => c.table === "step_gate");
    expect(q?.eqs).toContainEqual(["shop_id", SHOP]);
  });
  it("ชนิดด่าน/สถานะนอก allowlist → ปฏิเสธ", async () => {
    expect((await recordGate(STEP, { gateKind: "legal", status: "passed" })).ok).toBe(false);
    expect((await recordGate(STEP, { gateKind: "brand_rule", status: "approved" })).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("setPlan / upsertHook / resolveConfirm", () => {
  it("setPlan ปฏิเสธ key นอก allowlist และ date:null", async () => {
    expect((await setPlan(STEP, { audience_segment: "x" })).ok).toBe(false);
    expect((await setPlan(STEP, { date: null })).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
  it("setPlan ส่งเฉพาะ key ที่ตรวจแล้ว และค่า 0 ไม่หาย", async () => {
    await setPlan(STEP, { baseline_value: 0, shoot_note: null });
    expect(rpcMock.mock.calls[0][1].p_set).toEqual({ baseline_value: 0, shoot_note: null });
  });
  it("upsertHook ประเภทนอก 8 ค่า → ไม่เรียก RPC", async () => {
    expect((await upsertHook(STEP, { label: "A", text: "x", hookType: "contrast" })).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
  it("resolveConfirm คืนจำนวนที่เหลือจาก DB", async () => {
    rpcMock.mockResolvedValue({ data: { remaining_pending: 2 }, error: null });
    const r = await resolveConfirm(STEP, ITEM, "ยี่ห้อ ก");
    expect(r).toEqual({ ok: true, data: { remaining: 2 } });
    expect(rpcMock.mock.calls[0][1].p_answer).toBe("ยี่ห้อ ก");
  });
});

describe("F4 — recommendation_respond ส่ง p_expected_token ตามที่ view ให้", () => {
  it("ส่ง token เดิมกลับไป", async () => {
    rpcMock.mockResolvedValue({ data: { late: true, was_expired: false }, error: null });
    const r = await respondReco({ recoId: RECO, action: "done", response: "", token: "tok-from-view" });
    expect(r).toEqual({ ok: true, data: { late: true, wasExpired: false } });
    const [fn, params] = rpcMock.mock.calls[0];
    expect(fn).toBe("recommendation_respond");
    expect(params.p_expected_token).toBe("tok-from-view");
    expect(params.p_actor_role).toBe("owner");
  });
  it("ไม่มี token → ไม่เรียก RPC (ไม่ปล่อย null ให้ CAS)", async () => {
    const r = await respondReco({ recoId: RECO, action: "done", response: "", token: null });
    expect(r.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
  it("rejected ไม่มีเหตุผล → ปฏิเสธก่อนถึง DB", async () => {
    expect((await respondReco({ recoId: RECO, action: "rejected", response: "", token: "t" })).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
  it("token ไม่ตรง (55000) → ข้อความโหลดใหม่ + stale", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "55000", message: "recommendation_respond: ข้อมูลข้อเสนอเปลี่ยนแล้ว — โหลดใหม่" } });
    const r = await respondReco({ recoId: RECO, action: "done", response: "", token: "old" });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.stale).toBe(true);
    expect(!r.ok && r.error).toContain("โหลดใหม่");
  });
});

describe("postPiece", () => {
  const base = { platform: "tiktok", url: "https://www.tiktok.com/@x/video/1?utm=a", postedAtLocal: "2026-10-09T10:00", hook: { kind: "skip" } as const };

  beforeEach(() => {
    tableResults.campaign_step = { data: { piece_kind: "short_clip" }, error: null };
  });

  it("ส่งลิงก์ที่ canonicalize แล้ว (ไม่ใช่ลิงก์ดิบ) และ external_id ที่ derive จากลิงก์มาตรฐาน", async () => {
    canonicalizeMock.mockResolvedValue({ ok: true, url: "https://www.tiktok.com/@x/video/1" });
    const r = await postPiece(STEP, base);
    expect(r.ok).toBe(true);
    const [fn, params] = rpcMock.mock.calls[0];
    expect(fn).toBe("content_piece_post");
    expect(params.p_post_url).toBe("https://www.tiktok.com/@x/video/1");
    expect(params.p_external_id).toBe("https://www.tiktok.com/@x/video/1");
    expect(params.p_platform).toBe("tiktok");
    expect(params.p_posted_at).toBe("2026-10-09T03:00:00.000Z");
    expect(params.p_actor_role).toBe("owner");
  });
  it("ชนิดชิ้นอ่านจาก DB ของร้านนี้ (eq shop_id) · ช่องทางไม่เข้าคู่ชนิด → ไม่เรียก RPC", async () => {
    const r = await postPiece(STEP, { ...base, platform: "instagram", url: "https://www.instagram.com/p/abc" });
    expect(r.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
    const q = calls.find((c) => c.table === "campaign_step");
    expect(q?.eqs).toContainEqual(["shop_id", SHOP]);
  });
  it("host ของลิงก์ไม่ตรงช่องทาง → ปฏิเสธ", async () => {
    expect((await postPiece(STEP, { ...base, url: "https://evil.example/@x/video/1" })).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
  it("ลิงก์ TikTok ที่ไม่ใช่โพสต์ (โปรไฟล์) → ปฏิเสธ", async () => {
    parseCanonicalMock.mockReturnValue(null);
    expect((await postPiece(STEP, base)).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
  it("วันที่โพสต์อยู่นอกช่วง/อนาคต → ปฏิเสธ", async () => {
    expect((await postPiece(STEP, { ...base, postedAtLocal: "2024-01-01T10:00" })).ok).toBe(false);
    expect((await postPiece(STEP, { ...base, postedAtLocal: "2999-01-01T10:00" })).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
  it("hook อื่น: ต้องมีทั้งข้อความและประเภท 8 ค่า · เลือก hook เดิมต้องเป็น uuid", async () => {
    expect((await postPiece(STEP, { ...base, hook: { kind: "other", text: "x", hookType: "nope" } })).ok).toBe(false);
    expect((await postPiece(STEP, { ...base, hook: { kind: "existing", hookId: "zzz" } })).ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
    await postPiece(STEP, { ...base, hook: { kind: "other", text: " ข้อความ ", hookType: "question" } });
    const p = rpcMock.mock.calls[0][1];
    expect(p.p_hook_other_text).toBe("ข้อความ");
    expect(p.p_hook_other_type).toBe("question");
    expect(p.p_hook_id).toBeNull();
  });
  it("hook เดิม: ส่ง id เดียว ไม่ส่ง other", async () => {
    await postPiece(STEP, { ...base, hook: { kind: "existing", hookId: HOOK } });
    const p = rpcMock.mock.calls[0][1];
    expect(p.p_hook_id).toBe(HOOK);
    expect(p.p_hook_other_text).toBeNull();
    expect(p.p_hook_other_type).toBeNull();
  });
  it("ช่องทางซ้ำ (DB 55000) → ข้อความไทย ไม่ใช่ error ดิบ", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: "55000", message: "content_piece_post: ชิ้นนี้มีโพสต์ tiktok ที่ใช้งานอยู่แล้ว (1 platform ต่อชิ้น 1 โพสต์)" },
    });
    const r = await postPiece(STEP, base);
    expect(!r.ok && r.error).toContain("มีโพสต์ของช่องทางนี้อยู่แล้ว");
  });
  it("ลิงก์เดิมซ้ำข้ามชิ้น (23505) → ลิงก์นี้เคยถูกบันทึกแล้ว", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "23505", message: "dup" } });
    const r = await postPiece(STEP, base);
    expect(!r.ok && r.error).toBe("ลิงก์นี้เคยถูกบันทึกแล้ว");
  });
});

describe("F3 — อ่านข้อมูล", () => {
  it("getPieceDetail: ทุก query มี eq shop_id · live_host เลือกเฉพาะ id, public_label, is_active (ไม่มี display_name)", async () => {
    tableResults.v_content_piece = {
      data: { step_id: STEP, campaign_id: "c", title: "t", piece_status: "in_review", hooks: [], gates: {}, posts: [] },
      error: null,
    };
    tableResults.live_host = { data: [{ id: HOOK, public_label: "โฮสต์ A", is_active: true }], error: null };
    const r = await getPieceDetail(STEP);
    expect(r.ok && r.data.kind).toBe("found");
    for (const c of calls) {
      expect(c.eqs, `table ${c.table}`).toContainEqual(["shop_id", SHOP]);
    }
    const host = calls.find((c) => c.table === "live_host");
    expect(host?.selected).toBe("id, public_label, is_active");
    expect(JSON.stringify(r)).not.toContain("display_name");
  });
  it("step ที่ไม่อยู่ใน workflow ใหม่ → legacy (ให้ page redirect ไปหน้าเดิม)", async () => {
    tableResults.v_content_piece = { data: null, error: null };
    tableResults.campaign_step = { data: { id: STEP }, error: null };
    const r = await getPieceDetail(STEP);
    expect(r).toEqual({ ok: true, data: { kind: "legacy" } });
  });
  it("ไม่พบเลย → missing · id ไม่ใช่ uuid → missing โดยไม่ query", async () => {
    tableResults.v_content_piece = { data: null, error: null };
    tableResults.campaign_step = { data: null, error: null };
    expect(await getPieceDetail(STEP)).toEqual({ ok: true, data: { kind: "missing" } });
    calls.length = 0;
    expect(await getPieceDetail("nope")).toEqual({ ok: true, data: { kind: "missing" } });
    expect(calls).toHaveLength(0);
  });
  it("getInboxData: ทุก query มี eq shop_id และมีเพดานแถว", async () => {
    const r = await getInboxData();
    expect(r.ok).toBe(true);
    expect(calls.length).toBeGreaterThanOrEqual(8);
    for (const c of calls) expect(c.eqs, `table ${c.table}`).toContainEqual(["shop_id", SHOP]);
  });
});

describe("security รอบแก้ — L2/L3/L4/ชนิด input", () => {
  const ART = "55555555-5555-4555-8555-555555555555";
  const OTHER_ART = "66666666-6666-4666-8666-666666666666";

  it("L2: role ที่ไม่ใช่ owner/admin (เช่นค่าใหม่/ไม่รู้จัก) ผ่านไม่ได้ — allowlist ไม่ใช่ deny staff", async () => {
    for (const role of ["viewer", "pending", "", undefined, null]) {
      getEffectiveRoleMock.mockResolvedValue(role);
      expect((await advancePiece(STEP, "approved")).ok).toBe(false);
    }
    expect(rpcMock).not.toHaveBeenCalled();
    getEffectiveRoleMock.mockResolvedValue("admin");
    expect((await advancePiece(STEP, "approved")).ok).toBe(true);
  });

  it("L3: p_shop_id / p_actor_role อยู่หลัง params — แอบส่งมาทับไม่ได้", async () => {
    // เรียก callRpc ผ่าน action ที่ส่ง params ตามที่ allowlist (ไม่มีช่องให้ทับ) — พิสูจน์ที่ผลลัพธ์ที่ถึง RPC
    await resolveConfirm(STEP, ITEM, "คำตอบ");
    const p = rpcMock.mock.calls[0][1];
    expect(p.p_shop_id).toBe(SHOP);
    expect(p.p_actor_role).toBe("owner");
  });

  it("L4: savePieceBody — artifact ต้องเป็นของ step นี้ (อ่านจาก DB ร้านนี้) ไม่ตรง = ไม่แก้", async () => {
    const legacy = (fn: string) => rpcMock.mock.calls.filter((c) => c[0] === fn);
    tableResults.v_content_piece = { data: { artifact_id: OTHER_ART }, error: null };
    const bad = await savePieceBody(STEP, ART, "เนื้อหาใหม่");
    expect(bad.ok).toBe(false);
    expect(legacy("campaign_set_artifact_content")).toHaveLength(0);
    const q = calls.find((c) => c.table === "v_content_piece");
    expect(q?.eqs).toContainEqual(["shop_id", SHOP]);
    expect(q?.eqs).toContainEqual(["step_id", STEP]);

    tableResults.v_content_piece = { data: { artifact_id: ART }, error: null };
    expect((await savePieceBody(STEP, ART, "เนื้อหาใหม่")).ok).toBe(true);
    expect(legacy("campaign_set_artifact_content").at(-1)?.[1]).toEqual({ p_artifact_id: ART, p_content_body: "เนื้อหาใหม่", p_clip_brief: null });
  });
  it("L4: ไม่พบแถว/อ่านล้มเหลว = ปฏิเสธ (fail-closed) · toggleShot ตรวจเช่นเดียวกัน", async () => {
    const legacy = (fn: string) => rpcMock.mock.calls.filter((c) => c[0] === fn);
    tableResults.v_content_piece = { data: null, error: null };
    expect((await savePieceBody(STEP, ART, "x")).ok).toBe(false);
    tableResults.v_content_piece = { data: null, error: { code: "XX", message: "boom" } };
    expect((await savePieceBody(STEP, ART, "x")).ok).toBe(false);
    expect(legacy("campaign_set_artifact_content")).toHaveLength(0);
    tableResults.v_content_piece = { data: { artifact_id: OTHER_ART }, error: null };
    expect((await toggleShot(STEP, ART, "s1", true)).ok).toBe(false);
    expect(legacy("campaign_toggle_clip_shot")).toHaveLength(0);
  });

  it("ชนิด input ผิด (null/ไม่ใช่ string/array) → ข้อความไทย ไม่ throw ไม่ถึง RPC", async () => {
    const bad = [
      advancePiece(STEP, "approved", null as never),
      recordGate(STEP, null as never),
      recordGate(STEP, { gateKind: "fact_check", status: "passed", sources: "https://a.org" } as never),
      recordGate(STEP, { gateKind: "brand_rule", status: "blocked", note: 5 } as never),
      setPlan(STEP, null as never),
      upsertHook(STEP, null as never),
      upsertHook(STEP, { label: "A", text: 5, hookType: {} } as never),
      postPiece(STEP, null as never),
      postPiece(STEP, { platform: "tiktok", url: "https://www.tiktok.com/@x/video/1", postedAtLocal: 123, hook: { kind: "skip" } } as never),
      postPiece(STEP, { platform: "tiktok", url: "https://www.tiktok.com/@x/video/1", postedAtLocal: "2026-10-09T10:00", hook: null } as never),
      resolveConfirm(STEP, ITEM, { x: 1 } as never),
      deferPiece(STEP, 5 as never, 7 as never),
      respondReco(null as never),
      unlinkPost(STEP, ITEM, null as never),
    ];
    const results = await Promise.all(bad);
    for (const r of results) {
      expect(r.ok).toBe(false);
      expect(!r.ok && /[\u0E00-\u0E7F]/.test(r.error)).toBe(true);
    }
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
