// QA (R2-D2 · 23 ต.ค. 69) — W3 (0191): "รูปร่างจริงของ RPC" เข้าชั้น TS (worker-server + action)
// ที่มา: lib/jobs/gems-w3.db-contract.qa.fixtures.ts = payload จริงจากการยิง RPC job_worker_* บน DB (ร้านสังเคราะห์ ในทรานแซกชันที่ ROLLBACK)
// เหตุผล: worker-server.gems.test.ts ใช้ payload ที่ทีมเขียนเอง — ไฟล์นี้พิสูจน์ว่าของจริงจาก DB (ชื่อ key/ชนิดตัวเลข/ลำดับ) ผ่านตัวแปลงครบ ไม่ถูกทิ้งเงียบ
// ต้องถูก: catalog/open/replay/get/set/my-list map ครบ · error ทุกแบบที่ DB ส่งจริง (similar · แถวผิด · ต้องตอบ · conflict) เป็นข้อความไทยสะอาดพร้อม gem.row/field
// ต้องไม่พัง: ตัวเลขจาก numeric ของ Postgres · ขนาดสลับด้านเรียงเล็ก→ใหญ่ ("3×6") · แถวที่ DB รวมให้
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { W3_REAL as FX } from "./gems-w3.db-contract.qa.fixtures";

const TOKEN = "Ab3-_xYz0123456789AbCdEfGhIjKlMnOpQrStUvWxY";
const SESSION = "Zz9-_xYz0123456789AbCdEfGhIjKlMnOpQrStUvWxY";
const IDEM = "ik0123456789abcdef0123456789abcdef";
const JOBTOK = "cIU9WS-DUZGrTC9v3LaEWrV7-BeHiX46Y4ZtBJa5YBU";
const JOB = "1ae13bd2-1742-4df4-b4ca-d0dc9e7235af";
const REV = "0123456789abcdef0123456789abcdef";

const rpcMock = vi.fn();
const cookieStore = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (cookieStore.has(n) ? { value: cookieStore.get(n) } : undefined), set: vi.fn() }),
  headers: async () => ({ get: (n: string) => ({ "x-forwarded-for": "203.0.113.9", "user-agent": "qa" })[n.toLowerCase()] ?? null }),
}));
vi.mock("@/lib/supabase/server", () => ({ getServiceClient: () => ({ schema: () => ({ rpc: rpcMock }) }) }));
vi.mock("@/lib/images/signing", () => ({ signImagePaths: async () => new Map<string, string>(), signJobPhotoPaths: async () => new Map<string, string>() }));

import { intakeGemCatalog, intakeJobGems, intakeMyJobs, intakeOpen, intakeSetJobGems } from "@/lib/actions/job-worker";
import { findForbiddenKeys } from "@/lib/jobs/worker-view";
import { loadIntakeGemCatalog, loadIntakeJobGems, openIntakeJob, setIntakeJobGems } from "@/lib/jobs/worker-server";
import type { IntakeOpenInput } from "@/lib/jobs/worker-server";
import { listMyIntakeJobs } from "@/lib/jobs/shop-photo-server";

let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  cookieStore.clear();
  cookieStore.set("w_session", SESSION);
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
const reply = (k: string) => rpcMock.mockResolvedValue({ data: FX[k], error: null });
const base = (o: Partial<IntakeOpenInput> = {}): IntakeOpenInput => ({
  idemKey: IDEM, productId: null, pendingLabel: "แหวน FX", metal: "silver", purity: null, weightG: null, qtyOrder: 3, qtyPlanned: 4, dueDate: null, isNewDesign: false, note: null, ...o,
});
const THAI = /[฀-๿]/;
/** ข้อความที่ถึงผู้ใช้ต้องเป็นไทย ไม่มีรหัส/ชื่อฟังก์ชัน/ตาราง/ราคา */
const clean = (s: string) => THAI.test(s) && !/[a-z]+_[a-z_]+|analytics|supabase|ERROR|select |insert |public\./.test(s) && !/\d{4,}\.\d{2,}/.test(s);

describe("real shapes W3 — catalog", () => {
  it("catalog + SKU มีแม่แบบ: types/shapes/sizes/template map ครบ · hasTemplate true · template 2 แถว (ฉลาก+จำนวน) · ไม่มีราคา", async () => {
    reply("catalog_template");
    const r = await loadIntakeGemCatalog(TOKEN, "22222222-2222-4222-8222-222222222222");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const raw = FX.catalog_template as { types: unknown[]; shapes: unknown[]; sizes: unknown[]; template: unknown[] };
    expect(r.data.types.length).toBe(raw.types.length);
    expect(r.data.shapes.length).toBe(raw.shapes.length);
    expect(r.data.sizes.length).toBe(raw.sizes.length);
    expect(r.data.hasTemplate).toBe(true);
    expect(r.data.template).toHaveLength(2);
    expect(r.data.template.map((t) => t.label)).toEqual(["โกเมน · ไข่ · 4×6 มม.", "CZ · กลม · 1.5 มม."]);
    expect(r.data.template.map((t) => [t.qtyPerPiece, t.position])).toEqual([[2, "ล้อมรอบ"], [30, null]]);
    expect(r.data.shapes.every((s) => typeof s.hasLength === "boolean")).toBe(true);
    expect(r.data.sizes.find((z) => z.sizeA === 4)?.sizeB).toBe(6);
    expect(findForbiddenKeys(r)).toEqual([]);
    expect(JSON.stringify(r)).not.toMatch(/7391|9999\.9999|1234\.5678/);
    // ผ่าน action ก็เหมือนกัน
    reply("catalog_template");
    const a = await intakeGemCatalog(TOKEN, "22222222-2222-4222-8222-222222222222");
    expect(a.ok && a.hasTemplate && a.template.length === 2).toBe(true);
  });

  it("catalog + SKU ไม่มีแม่แบบ: hasTemplate false · template ว่าง", async () => {
    reply("catalog_notemplate");
    const r = await loadIntakeGemCatalog(TOKEN, "22222222-2222-4222-8222-222222222222");
    expect(r.ok && r.data.hasTemplate === false && r.data.template.length === 0).toBe(true);
  });

  it("ไม่มี session (ผลจริงของ DB) → ข้อความไทยสะอาด ไม่มีรหัสดิบ", async () => {
    reply("no_session");
    const r = await loadIntakeGemCatalog(TOKEN, null);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("session_required");
      expect(clean(r.error)).toBe(true);
    }
  });
});

describe("real shapes W3 — เปิดใบพร้อมพลอย", () => {
  const LINES = [{ new_type_name: "x" }];
  it("has สำเร็จ: gem ครบทุก field จริง (count/total/state/ชื่อใหม่/แถวที่ DB รวมให้) · token ถูกส่ง · ไม่มี key ต้องห้าม", async () => {
    reply("open_has");
    const r = await openIntakeJob(TOKEN, base({ gems: { answer: "has", lines: LINES } }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.token).toBe(JOBTOK);
    expect(r.data.gem).toEqual({
      count: 2, total: 148, state: "specified", createdTypes: ["บุษราคัมเอฟเอ็กซ์"], createdShapes: ["ทรงใบมะกอกเอฟเอ็กซ์"], reused: [], mergedRows: [[2, 3]],
    });
    expect(findForbiddenKeys(r)).toEqual([]);
  });

  it("template / none สำเร็จ: gem จริง map ได้ (count 2 · state specified / count 0 · not_needed)", async () => {
    reply("open_template");
    const t = await openIntakeJob(TOKEN, base({ productId: "22222222-2222-4222-8222-222222222222", pendingLabel: null, gems: { answer: "template" } }));
    expect(t.ok && t.data.gem?.count === 2 && t.data.gem.state === "specified" && t.data.sku !== null).toBe(true);
    reply("open_none");
    const n = await openIntakeJob(TOKEN, base({ gems: { answer: "none" } }));
    expect(n.ok && n.data.gem?.count === 0 && n.data.gem.state === "not_needed" && n.data.gem.total === 0).toBe(true);
  });

  it("เปิดใบแบบไม่ส่งคำตอบ (W1 เดิม) ได้ผลจริงที่ map ได้ · gem ว่าง ไม่ล้ม", async () => {
    reply("open_noanswer_nostage");
    const r = await openIntakeJob(TOKEN, base());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.gem?.state ?? "not_needed").toBe("not_needed");
  });

  it("replay (key เดิม): already true · ไม่มี token · gem จาก DB (ไม่ใช่ที่ส่งซ้ำมา)", async () => {
    reply("open_replay");
    const r = await openIntakeJob(TOKEN, base({ gems: { answer: "none" } }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.already).toBe(true);
    expect(r.data.token).toBeNull();
    expect(r.data.gem).toMatchObject({ count: 2, total: 148, state: "specified" });
  });

  it("ชื่อคล้าย (ผลจริง): code gem_similar + similar[] (kind/ชื่อที่พิมพ์/แถว/ชื่อที่มี+uuid) · ข้อความไทยสะอาด · ผ่าน action ถึงหน้าจอครบ", async () => {
    reply("open_similar");
    const r = await openIntakeJob(TOKEN, base({ gems: { answer: "has", lines: LINES } }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("gem_similar");
    expect(clean(r.error)).toBe(true);
    expect(r.similar).toHaveLength(1);
    expect(r.similar?.[0]).toMatchObject({ kind: "type", name: "Garnett", rows: [1] });
    expect(r.similar?.[0].matches[0].name).toBe("Garnet");
    expect(r.similar?.[0].matches[0].id).toMatch(/^[0-9a-f-]{36}$/);
    reply("open_similar");
    const a = await intakeOpen(TOKEN, { idemKey: IDEM, label: "แหวน FX", metal: "silver", qty: 3, gems: { answer: "has", lines: [{ newTypeName: "Garnett", shapeId: "22222222-2222-4222-8222-222222222222", sizeA: 3, qtyPerPiece: 1 }] } });
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.similar?.[0].name).toBe("Garnett");
  });

  it("แถวผิด (ผลจริง): gem_line_invalid + gem.code/row/field · ข้อความ 'พลอยแถว 2: จำนวนต่อชิ้นต้องเป็นเลข 1–1,000'", async () => {
    reply("open_bad_row");
    const r = await openIntakeJob(TOKEN, base({ gems: { answer: "has", lines: LINES } }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("gem_line_invalid");
    expect(r.gem).toEqual({ code: "qty_invalid", row: 2, field: "qty_per_piece" });
    expect(r.error).toBe("พลอยแถว 2: จำนวนต่อชิ้นต้องเป็นเลข 1–1,000");
  });

  it("SKU ไม่มีแม่แบบแต่ตอบ template (ผลจริง): gem_answer_required · ข้อความไทยสะอาด", async () => {
    reply("open_template_required");
    const r = await openIntakeJob(TOKEN, base({ productId: "22222222-2222-4222-8222-222222222222", pendingLabel: null, gems: { answer: "template" } }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("gem_answer_required");
      expect(clean(r.error)).toBe(true);
    }
  });
});

describe("real shapes W3 — W-10 อ่าน/แก้พลอยของใบที่ฉันเปิด", () => {
  it("get จริง: editable · lockCode null · hasGemStage · rev 32 hex · lines (qtyTotal = จำนวน/ชิ้น x ที่เริ่มผลิต) ครบทุกแถว", async () => {
    reply("get_open");
    const r = await loadIntakeJobGems(TOKEN, JOB);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const raw = FX.get_open as { lines: { qty_per_piece: number; qty_total: number; gem_item_id: string }[]; rev: string };
    expect(r.data.rev).toBe(raw.rev);
    expect(r.data.editable).toBe(true);
    expect(r.data.lockCode).toBeNull();
    expect(r.data.hasGemStage).toBe(true);
    expect(r.data.lines).toHaveLength(raw.lines.length);
    expect(r.data.lines.map((l) => l.qtyTotal)).toEqual(raw.lines.map((l) => l.qty_total));
    expect(r.data.lines.every((l) => l.qtyTotal === l.qtyPerPiece * r.data.job.qtyPlanned)).toBe(true);
    expect(r.data.lines.every((l) => l.typeName && l.shapeName)).toBe(true);
    expect(findForbiddenKeys(r)).toEqual([]);
    // ผ่าน action
    reply("get_open");
    const a = await intakeJobGems(TOKEN, JOB);
    expect(a.ok && a.lines.length === raw.lines.length).toBe(true);
  });

  it("set สำเร็จ (ผลจริง): changed · count · lines (qtyTotal) · state · rev ใหม่ · summary ชื่อใหม่ + ชื่อที่ DB ใช้ตัวเดิมให้ (cz → CZ)", async () => {
    reply("set_ok");
    const r = await setIntakeJobGems(TOKEN, { jobId: JOB, lines: [], expectedRev: REV });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.changed).toBe(true);
    expect(r.data.count).toBe(3);
    expect(r.data.lines).toHaveLength(3);
    expect(r.data.state).toBe("specified");
    expect(r.data.rev).toMatch(/^[0-9a-f]{32}$/);
    expect(r.data.summary.createdTypes).toEqual(["ทับทิมเอฟเอ็กซ์"]);
    expect(r.data.summary.reused).toEqual([{ row: 3, kind: "type", typed: "cz", name: "CZ" }]);
    expect(findForbiddenKeys(r)).toEqual([]);
  });

  it("set ล้ม (ผลจริง): ชื่อคล้าย · แถวผิด (ขนาด 0 แถว 2) · conflict (rev เก่า) → ข้อความไทยสะอาด + ข้อมูลแถว/ชื่อ", async () => {
    reply("set_similar");
    const s = await setIntakeJobGems(TOKEN, { jobId: JOB, lines: [], expectedRev: REV });
    expect(!s.ok && s.code === "gem_similar" && s.similar?.[0].rows[0] === 3 && clean(s.error)).toBe(true);
    reply("set_bad_row");
    const b = await setIntakeJobGems(TOKEN, { jobId: JOB, lines: [], expectedRev: REV });
    expect(b.ok).toBe(false);
    if (!b.ok) {
      expect(b.code).toBe("gem_line_invalid");
      expect(b.gem).toMatchObject({ code: "size_invalid", row: 2, field: "size_a" });
      expect(b.error.startsWith("พลอยแถว 2: ")).toBe(true);
    }
    reply("set_conflict");
    const c = await intakeSetJobGems(TOKEN, { jobId: JOB, lines: [], expectedRev: REV });
    expect(!c.ok && c.code === "gem_conflict" && clean(c.error)).toBe(true);
  });
});

describe("real shapes W3 — hub 'ใบที่ฉันเปิด' (W-9)", () => {
  it("my_intake_list จริง: gem_state/gem_count/gem_pieces/gem_editable ถึง TS ครบ (ไม่ถูก 0/null เพราะชื่อ key ไม่ตรง)", async () => {
    reply("my_list");
    const r = await listMyIntakeJobs(TOKEN);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.jobs).toHaveLength(1);
    expect(r.data.jobs[0]).toMatchObject({ gemState: "specified", gemCount: 3, gemPieces: 56, gemEditable: true, editable: true });
    reply("my_list");
    const a = await intakeMyJobs(TOKEN);
    expect(a.ok && a.jobs[0].gemPieces === 56).toBe(true);
  });
});
