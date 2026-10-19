// รูปบนหน้าช่าง /w/ (0182) — ช่องทางสาธารณะ: เซ็น URL เฉพาะ path ที่ RPC ส่งมาหลังระบุตัว · ก่อน PIN ไม่มีรูป · path ดิบไม่ถึง client · URL หมดอายุ 15 นาที · เซ็นล้มไม่ล้มหน้า
//   + sanitizeWorkerView allowlist ของ photos (key อื่นทิ้ง · URL ต้องเป็น signed URL ของ job-photos)
import { beforeEach, describe, expect, it, vi } from "vitest";

const SHOP = "a7c850ee-6776-4c3e-ba72-ba9e8caba2b7";
const JOB = "11111111-1111-4111-8111-111111111111";
const WID = "33333333-3333-4333-8333-333333333333";
const TOKEN = "Ab3-_xYz0123456789AbCdEfGhIjKlMnOpQrStUvWxY";
const PH1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PH2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const md = (id: string) => `${SHOP}/${JOB}/${id}_md.jpg`;
const sm = (id: string) => `${SHOP}/${JOB}/${id}_sm.jpg`;
const signedUrl = (p: string) => `https://abc.supabase.co/storage/v1/object/sign/job-photos/${p}?token=tok`;

const rpcMock = vi.fn();
const createSignedUrls = vi.fn();
const fromBucket = vi.fn(() => ({ createSignedUrls }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "Zz9-_xYz0123456789AbCdEfGhIjKlMnOpQrStUvWxY" }) }), headers: async () => ({ get: () => null }) }));
vi.mock("@/lib/supabase/server", () => ({ getServiceClient: () => ({ schema: () => ({ rpc: rpcMock }), storage: { from: fromBucket } }) }));

import { loadWorkerView } from "@/lib/jobs/worker-server";
import { findForbiddenKeys, sanitizeWorkerView } from "@/lib/jobs/worker-view";

const stage = { seq: 1, code: "cast", name: "หล่อ", status: "pending" };
const anon = (job: Record<string, unknown> = {}) => ({
  ok: true, job: { job_no: "JB-0001", status: "open", stages: [stage], has_profile: false, ...job }, viewer: null, session_expired: false, next_action: "identify",
  action_stage: null, prev_weight_out_g: null, held_by: null, workers: [{ id: WID, display_name: "ช่างเอ" }], scrap_reasons: [], parts: null, my_actions: null,
});
const identified = (photos: unknown) => ({
  ...anon({ design_label: "แหวนลาย A", sku: "RG-001", metal: "silver", qty_planned: 10, due_date: "2026-10-30", ...(photos === undefined ? {} : { photos }) }),
  viewer: { worker_id: WID, display_name: "ช่างเอ" }, next_action: "receive", action_stage: { seq: 1, code: "cast", name: "หล่อ", weight_required: false },
});
const rpcPhoto = (id: string, o: Record<string, unknown> = {}) => ({ id, sm_path: sm(id), md_path: md(id), is_primary: false, caption: null, ...o });
const signAll = (paths: string[]) => ({ data: paths.map((p) => ({ path: p, signedUrl: signedUrl(p), error: null })), error: null });

let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  createSignedUrls.mockImplementation(async (paths: string[]) => signAll(paths));
});

describe("loadWorkerView + รูป — หลังระบุตัวเท่านั้น", () => {
  it("ช่างที่ระบุตัวแล้ว: ได้ job.photos (signed URL 15 นาที ของ bucket job-photos) · รูปหลักมาก่อน · เซ็นรวดเดียว · เซ็นเฉพาะ path ที่ RPC ส่งมา", async () => {
    rpcMock.mockResolvedValue({ data: identified([rpcPhoto(PH1, { is_primary: true, caption: "ด้านข้าง" }), rpcPhoto(PH2)]), error: null });
    const r = await loadWorkerView(TOKEN);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(fromBucket).toHaveBeenCalledTimes(1);
    expect(fromBucket).toHaveBeenCalledWith("job-photos");
    expect(createSignedUrls).toHaveBeenCalledTimes(1);
    const [paths, ttl] = createSignedUrls.mock.calls[0] as [string[], number];
    expect(ttl).toBe(900);
    expect([...paths].sort()).toEqual([md(PH1), md(PH2), sm(PH1), sm(PH2)].sort());
    expect(r.data.job.photos).toEqual([
      { id: PH1, smUrl: signedUrl(sm(PH1)), mdUrl: signedUrl(md(PH1)), isPrimary: true, caption: "ด้านข้าง" },
      { id: PH2, smUrl: signedUrl(sm(PH2)), mdUrl: signedUrl(md(PH2)), isPrimary: false, caption: null },
    ]);
  });

  it("🔴 path ดิบ/ชื่อ key ของ DB ไม่ถึง client: ทั้ง view ไม่มี sm_path/md_path/storage_path/product_image_id/uploaded_by · ไม่มี key ต้องห้ามเดิม", async () => {
    rpcMock.mockResolvedValue({ data: identified([rpcPhoto(PH1, { is_primary: true, storage_path: md(PH1), product_image_id: "x", uploaded_by: "u", bytes: 9, source: "office", deleted_at: null })]), error: null });
    const r = await loadWorkerView(TOKEN);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // signed URL ของ Supabase ฝัง path ไว้ใน URL เองโดยธรรมชาติ (มี token กำกับ) — ตรวจว่านอก URL ไม่มี path/ชื่อ field ดิบ
    const json = JSON.stringify(r.data).replace(/"https:[^"]*"/g, "\"<url>\"");
    for (const leak of ["sm_path", "md_path", "storage_path", "product_image_id", "uploaded_by", "bytes", "source", "deleted", SHOP, `${JOB}/`, `${PH1}_md`, `${PH1}_sm`]) expect(json, leak).not.toContain(leak);
    expect(Object.keys((r.data.job.photos ?? [])[0]).sort()).toEqual(["caption", "id", "isPrimary", "mdUrl", "smUrl"]);
    expect(findForbiddenKeys(r.data)).toEqual([]);
  });

  it("ก่อนใส่ PIN (ไม่มี viewer): ไม่เซ็น ไม่มี photos — แม้ RPC (ผิดพลาด) ส่งรูปมา ก็ถูกทิ้งและไม่ยิง Storage", async () => {
    rpcMock.mockResolvedValue({ data: anon({ photos: [rpcPhoto(PH1, { is_primary: true })] }), error: null });
    const r = await loadWorkerView(TOKEN);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect("photos" in r.data.job).toBe(false);
    expect(createSignedUrls).not.toHaveBeenCalled();
    expect(fromBucket).not.toHaveBeenCalled();
    expect(JSON.stringify(r.data)).not.toContain(PH1);
  });

  it("ใบไม่มีรูป (ไม่มี key photos): ไม่ยิง Storage เลย · view เหมือนเดิม (ไม่มี key photos)", async () => {
    rpcMock.mockResolvedValue({ data: identified(undefined), error: null });
    const r = await loadWorkerView(TOKEN);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect("photos" in r.data.job).toBe(false);
    expect(fromBucket).not.toHaveBeenCalled();
  });

  it("path ที่ไม่ตรงรูปแบบของ job-photos (traversal · bucket อื่น · พิมพ์ใหญ่ · ชื่อเดิม) ไม่ถูกเซ็นเด็ดขาด · รูปนั้นหาย", async () => {
    const bad = (p: string) => ({ id: PH2, sm_path: p, md_path: p, is_primary: false, caption: null });
    rpcMock.mockResolvedValue({ data: identified([bad("../../etc/passwd"), bad(`product-images/${SHOP}/x/${PH2}_md.jpg`), bad(md(PH2).toUpperCase()), bad(`${SHOP}/${JOB}/photo.jpg`), rpcPhoto(PH1)]), error: null });
    const r = await loadWorkerView(TOKEN);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [paths] = createSignedUrls.mock.calls[0] as [string[]];
    expect([...paths].sort()).toEqual([md(PH1), sm(PH1)].sort());
    expect((r.data.job.photos ?? []).map((p) => p.id)).toEqual([PH1]);
  });

  it("เซ็นล้ม 1 รูป = รูปนั้นหาย รูปอื่นยังอยู่ · เซ็นล้มทุกรูป/Storage ล่ม = ไม่มี key photos แต่หน้าช่างยังใช้งานได้ (ไม่ล้มทั้งหน้า) · ไม่ log path/URL", async () => {
    createSignedUrls.mockResolvedValueOnce({ data: [{ path: md(PH1), signedUrl: signedUrl(md(PH1)), error: null }, { path: sm(PH1), signedUrl: signedUrl(sm(PH1)), error: null }, { path: md(PH2), signedUrl: null, error: "Object not found" }, { path: sm(PH2), signedUrl: null, error: "Object not found" }], error: null });
    rpcMock.mockResolvedValue({ data: identified([rpcPhoto(PH1, { is_primary: true }), rpcPhoto(PH2)]), error: null });
    let r = await loadWorkerView(TOKEN);
    expect(r.ok && (r.data.job.photos ?? []).map((p) => p.id)).toEqual([PH1]);

    createSignedUrls.mockRejectedValueOnce(new Error(`ECONNRESET udqmamplbymxnknkjnkz.supabase.co ${md(PH1)}`));
    rpcMock.mockResolvedValue({ data: identified([rpcPhoto(PH1, { is_primary: true })]), error: null });
    r = await loadWorkerView(TOKEN);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect("photos" in r.data.job).toBe(false);
    expect(r.data.nextAction).toBe("receive");
    const logged = JSON.stringify(errSpy.mock.calls);
    for (const leak of [SHOP, JOB, PH1, "udqmamplbymxnknkjnkz", "ECONNRESET", "https://"]) expect(logged, leak).not.toContain(leak);
  });

  it("เซ็นได้แค่ md หรือ sm อย่างเดียว: อีกตัวใช้ URL ที่มีแทน (รูปไม่หาย)", async () => {
    createSignedUrls.mockResolvedValueOnce({ data: [{ path: md(PH1), signedUrl: signedUrl(md(PH1)), error: null }, { path: sm(PH1), signedUrl: null, error: "x" }], error: null });
    rpcMock.mockResolvedValue({ data: identified([rpcPhoto(PH1, { is_primary: true })]), error: null });
    const r = await loadWorkerView(TOKEN);
    expect(r.ok && r.data.job.photos).toEqual([{ id: PH1, smUrl: signedUrl(md(PH1)), mdUrl: signedUrl(md(PH1)), isPrimary: true, caption: null }]);
  });

  it("เกิน 20 รูป (ไม่ควรเกิด — DB จำกัดแล้ว) ตัดที่ 20 · ไม่เซ็นเกิน 40 path", async () => {
    const ids = Array.from({ length: 25 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    rpcMock.mockResolvedValue({ data: identified(ids.map((id, i) => rpcPhoto(id, { is_primary: i === 0 }))), error: null });
    const r = await loadWorkerView(TOKEN);
    expect(r.ok && (r.data.job.photos ?? []).length).toBe(20);
    expect((createSignedUrls.mock.calls[0][0] as string[]).length).toBe(40);
  });
});

describe("sanitizeWorkerView — allowlist photos (ด่านซ้ำฝั่งแอป)", () => {
  const withPhotos = (photos: unknown, extra: Record<string, unknown> = {}) => ({ ...identified(photos), ...extra });
  const ok = (id: string, o: Record<string, unknown> = {}) => ({ id, sm_url: signedUrl(sm(id)), md_url: signedUrl(md(id)), is_primary: false, caption: null, ...o });

  it("รับเฉพาะ {id, sm_url, md_url, is_primary, caption} → camelCase · key อื่นทิ้ง (รวม path ดิบถ้าหลุดมา)", () => {
    const v = sanitizeWorkerView(withPhotos([ok(PH1, { is_primary: true, caption: "ซ้าย", sm_path: sm(PH1), md_path: md(PH1), storage_path: "x", product_image_id: "y", uploaded_by: "z" })]));
    expect(v?.job.photos).toEqual([{ id: PH1, smUrl: signedUrl(sm(PH1)), mdUrl: signedUrl(md(PH1)), isPrimary: true, caption: "ซ้าย" }]);
    expect(JSON.stringify(v)).not.toMatch(/sm_path|md_path|storage_path|product_image_id|uploaded_by/);
  });

  it("URL ที่ไม่ใช่ signed URL ของ job-photos (path ดิบ · http · bucket แคตตาล็อก · ภายนอก · javascript:) ถูกทิ้ง · ไม่มี URL ที่ใช้ได้ = ทิ้งรูป · ไม่เหลือรูป = ไม่มี key", () => {
    const badUrls = [md(PH1), "http://abc.supabase.co/storage/v1/object/sign/job-photos/x", "https://abc.supabase.co/storage/v1/object/sign/product-images/x?token=t", "https://evil.example/p.jpg", "javascript:alert(1)", null];
    for (const u of badUrls) {
      const v = sanitizeWorkerView(withPhotos([{ id: PH1, sm_url: u, md_url: u, is_primary: true, caption: null }]));
      expect(v && "photos" in v.job, String(u)).toBe(false);
    }
    // ผสม: sm ดี md เสีย → ใช้ sm ทั้งสองช่อง
    const v = sanitizeWorkerView(withPhotos([ok(PH1, { md_url: "https://evil.example/x" })]));
    expect(v?.job.photos?.[0]).toMatchObject({ smUrl: signedUrl(sm(PH1)), mdUrl: signedUrl(sm(PH1)) });
  });

  it("id ไม่ใช่ uuid · ไม่ใช่ object · caption ยาวเกิน 60 → ตัด/ทิ้ง · เกิน 20 รูปตัด", () => {
    const v = sanitizeWorkerView(withPhotos([ok("not-a-uuid"), "x", null, 5, ok(PH2, { caption: "ก".repeat(100) })]));
    expect(v?.job.photos).toHaveLength(1);
    expect(v?.job.photos?.[0].caption).toHaveLength(60);
    const many = Array.from({ length: 30 }, (_, i) => ok(`00000000-0000-4000-8000-${String(i).padStart(12, "0")}`));
    expect(sanitizeWorkerView(withPhotos(many))?.job.photos).toHaveLength(20);
  });

  it("ก่อนระบุตัว (viewer null / ไม่มี design_label) ไม่ใส่ photos แม้ raw มี · photos ไม่ใช่ array = ไม่ใส่", () => {
    const raw = anon({ photos: [ok(PH1)] });
    const v = sanitizeWorkerView(raw);
    expect(v && "photos" in v.job).toBe(false);
    const noViewer = { ...identified([ok(PH1)]), viewer: null };
    const v2 = sanitizeWorkerView(noViewer);
    expect(v2 && "photos" in v2.job).toBe(false);
    expect(sanitizeWorkerView(withPhotos("nope"))?.job.photos).toBeUndefined();
    expect(sanitizeWorkerView(withPhotos({ 0: ok(PH1) }))?.job.photos).toBeUndefined();
  });

  it("ต้องไม่พัง: ใบไม่มีรูป = view เท่าเดิมเป๊ะ (ไม่มี key photos) · key ใหม่ไม่ชน FORBIDDEN_KEY_PATTERN", () => {
    const v = sanitizeWorkerView(identified(undefined));
    expect(v).not.toBeNull();
    expect("photos" in (v?.job ?? {})).toBe(false);
    const withP = sanitizeWorkerView(withPhotos([ok(PH1, { is_primary: true, caption: "ด้านข้าง" })]));
    expect(findForbiddenKeys(withP)).toEqual([]);
    // ส่วนที่เหลือของ view เท่ากับใบไม่มีรูป
    const a = JSON.parse(JSON.stringify(withP));
    delete a.job.photos;
    expect(a).toEqual(JSON.parse(JSON.stringify(v)));
  });
});
