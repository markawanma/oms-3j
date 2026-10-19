// lib/images/signing.ts — เซ็น URL ชั่วคราวของ bucket private: TTL 15 นาทีของรูปใบงาน · 1 ชม. ของแคตตาล็อก · ล้ม 1 รูปไม่ล้มทั้งชุด · log ไม่มี path/error ทั้งก้อน
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { JOB_PHOTOS_BUCKET, JOB_PHOTO_SIGNED_URL_TTL_S, BUCKET } from "./constants";
import { SIGNED_URL_TTL_SECONDS, signImagePath, signImagePaths, signJobPhotoPaths, signPaths } from "./signing";

const SHOP = "a7c850ee-6776-4c3e-ba72-ba9e8caba2b7";
const JOB = "11111111-1111-4111-8111-111111111111";
const P1 = `${SHOP}/${JOB}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa_md.jpg`;
const P2 = `${SHOP}/${JOB}/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb_sm.jpg`;

const createSignedUrls = vi.fn();
const fromMock = vi.fn(() => ({ createSignedUrls }));
const client = { storage: { from: fromMock } } as unknown as SupabaseClient;
let errSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => errSpy.mockRestore());

describe("TTL", () => {
  it("รูปใบงาน = 15 นาที (900 วิ) · แคตตาล็อกเดิม = 1 ชั่วโมง (ไม่เปลี่ยน)", () => {
    expect(JOB_PHOTO_SIGNED_URL_TTL_S).toBe(900);
    expect(SIGNED_URL_TTL_SECONDS).toBe(3600);
  });
});

describe("signJobPhotoPaths", () => {
  it("เซ็นเฉพาะ bucket job-photos ด้วย TTL 900 · เรียก Storage ครั้งเดียวต่อชุด (batch) · path ซ้ำ/ว่าง/null ถูกตัด", async () => {
    createSignedUrls.mockResolvedValue({ data: [{ path: P1, signedUrl: "https://x.supabase.co/storage/v1/object/sign/job-photos/p1?token=t", error: null }, { path: P2, signedUrl: "https://x.supabase.co/storage/v1/object/sign/job-photos/p2?token=t", error: null }], error: null });
    const m = await signJobPhotoPaths(client, [P1, P2, P1, "", null, undefined]);
    expect(fromMock).toHaveBeenCalledTimes(1);
    expect(fromMock).toHaveBeenCalledWith(JOB_PHOTOS_BUCKET);
    expect(createSignedUrls).toHaveBeenCalledTimes(1);
    expect(createSignedUrls).toHaveBeenCalledWith([P1, P2], 900);
    expect(m.get(P1)).toContain("/storage/v1/object/sign/job-photos/");
    expect(m.size).toBe(2);
  });

  it("ไม่มี path เลย = ไม่ยิง Storage", async () => {
    expect((await signJobPhotoPaths(client, [])).size).toBe(0);
    expect((await signJobPhotoPaths(client, [null, ""])).size).toBe(0);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("เซ็นล้ม 1 รูป (entry.error) = รูปนั้นหายจากผล · รูปอื่นยังได้ URL · ไม่ throw (หน้าไม่ล้ม)", async () => {
    createSignedUrls.mockResolvedValue({ data: [{ path: P1, signedUrl: "https://x.supabase.co/s1", error: null }, { path: P2, signedUrl: null, error: "Object not found" }], error: null });
    const m = await signJobPhotoPaths(client, [P1, P2]);
    expect(m.has(P1)).toBe(true);
    expect(m.has(P2)).toBe(false);
  });

  it("Storage ล่มทั้งชุด (error / throw) = Map ว่าง ไม่ throw · log เฉพาะ bucket + จำนวน + code — ไม่มี path/URL/ข้อความ error/host", async () => {
    createSignedUrls.mockResolvedValueOnce({ data: null, error: { message: "getaddrinfo ENOTFOUND udqmamplbymxnknkjnkz.supabase.co", details: "Caused by: stack...", code: "ETIMEDOUT" } });
    expect((await signJobPhotoPaths(client, [P1])).size).toBe(0);
    createSignedUrls.mockRejectedValueOnce(Object.assign(new Error("secret host udqmamplbymxnknkjnkz.supabase.co"), { name: "TypeError" }));
    expect((await signJobPhotoPaths(client, [P2])).size).toBe(0);
    const logged = JSON.stringify(errSpy.mock.calls);
    expect(errSpy).toHaveBeenCalledTimes(2);
    expect(logged).not.toContain(SHOP);
    expect(logged).not.toContain(JOB);
    expect(logged).not.toContain("udqmamplbymxnknkjnkz");
    expect(logged).not.toContain("ENOTFOUND");
    expect(logged).not.toContain("stack");
    expect(logged).toContain("ETIMEDOUT");
  });
});

describe("แคตตาล็อกเดิมไม่เปลี่ยน (ย้ายไฟล์มาแล้วต้องใช้ได้เหมือนเดิม)", () => {
  it("signImagePaths = bucket product-images · TTL 3600 · signImagePath = 1 path", async () => {
    createSignedUrls.mockResolvedValue({ data: [{ path: P1, signedUrl: "https://x.supabase.co/c1", error: null }], error: null });
    const m = await signImagePaths(client, [P1, null]);
    expect(fromMock).toHaveBeenCalledWith(BUCKET);
    expect(createSignedUrls).toHaveBeenCalledWith([P1], 3600);
    expect(m.get(P1)).toBe("https://x.supabase.co/c1");
    createSignedUrls.mockResolvedValue({ data: [{ path: P1, signedUrl: "https://x.supabase.co/c1", error: null }], error: null });
    expect(await signImagePath(client, P1)).toBe("https://x.supabase.co/c1");
    expect(await signImagePath(client, null)).toBeNull();
    expect(await signImagePath(client, "")).toBeNull();
  });

  it("signPaths รับ bucket/ttl ที่ผู้เรียกกำหนด", async () => {
    createSignedUrls.mockResolvedValue({ data: [], error: null });
    await signPaths(client, "some-bucket", [P1], 42);
    expect(fromMock).toHaveBeenCalledWith("some-bucket");
    expect(createSignedUrls).toHaveBeenCalledWith([P1], 42);
  });
});
