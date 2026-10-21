// @vitest-environment jsdom
// useShopPhotos — วงจรรูปจากหน้างาน: เลือก (ตัดท้าย) → ย่อทีละรูป → เก็บในเครื่อง → ส่งทีละรูปหลักก่อน → ลองใหม่ (เทียบ server กันซ้ำ) → ล็อก/PIN → ลบ/ตั้งหลัก → ล้าง (revoke)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useShopPhotos } from "./useShopPhotos";
import type { PhotoRef, ServerPhoto, ShopPhotoIo } from "./useShopPhotos";
import type { ImageVariants } from "@/lib/images/client";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

let seq = 0;
const created: string[] = [];
const revoked: string[] = [];
beforeEach(() => {
  seq = 0;
  created.length = 0;
  revoked.length = 0;
  (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = () => {
    const u = `blob:mock-${++seq}`;
    created.push(u);
    return u;
  };
  (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = (u: string) => {
    revoked.push(u);
  };
});

const file = (name: string) => new File([name], name, { type: "image/jpeg" });
const variants = (name: string): ImageVariants => ({
  md: { blob: new Blob([`md-${name}`]), width: 1200, height: 900, bytes: 10, quality: 0.9 },
  sm: { blob: new Blob([`sm-${name}`]), width: 480, height: 360, bytes: 5, quality: 0.9 },
});
const named = (name: string, extra: Record<string, unknown> = {}) => Object.assign(new Error("x"), { name }, extra);

const REF: PhotoRef = { idemKey: "idem-key-0123456789abcdef" };
const sp = (id: string, o: Partial<ServerPhoto> = {}): ServerPhoto => ({ id, smUrl: `https://s/${id}_sm`, mdUrl: `https://s/${id}_md`, isPrimary: false, mine: true, ...o });

/** io จำลอง: upload ตอบรูปใหม่ id = p1, p2… (รูปแรกเป็นหลักอัตโนมัติ) */
function makeIo(over: Partial<ShopPhotoIo> = {}) {
  let n = 0;
  const calls: { fd: FormData }[] = [];
  const io: ShopPhotoIo = {
    upload: vi.fn(async (fd: FormData) => {
      calls.push({ fd });
      n += 1;
      return { ok: true as const, photo: sp(`p${n}`, { isPrimary: n === 1 || fd.get("isPrimary") === "true" }), count: n, max: 3 };
    }),
    remove: vi.fn(async () => ({ ok: true as const, promotedPhotoId: null, already: false })),
    list: vi.fn(async () => ({ ok: true as const, photos: [], count: 0, max: 3, locked: false, lockCode: null })),
    ...over,
  };
  return { io, calls };
}

const setup = (io: ShopPhotoIo, resize?: (f: File) => Promise<ImageVariants>) => renderHook(() => useShopPhotos({ io, resize: resize ?? (async (f) => variants(f.name)) }));
/** รอจน pred เป็นจริง (waitFor ต้อง throw ถึงจะ retry — คืน false เฉยๆ ไม่รอ) */
const settle = async (_r: { current: ReturnType<typeof useShopPhotos> }, pred: () => boolean) =>
  waitFor(
    () => {
      if (!pred()) throw new Error("ยังไม่ถึงสถานะที่รอ");
    },
    { timeout: 3000 },
  );

describe("เลือก/ถ่ายรูป (ก่อนเปิดใบ)", () => {
  it("เลือก 5 ไฟล์ เหลือที่ 3 → รับ 3 + แจ้ง 'ตัด 2 รูปท้ายออก' (amber ไม่ใช่ error) · รูปแรก = รูปหลัก", async () => {
    const { io } = makeIo();
    const { result } = setup(io);
    act(() => result.current.pick([file("a"), file("b"), file("c"), file("d"), file("e")]));
    await settle(result, () => result.current.items.every((i) => i.phase === "ready") && result.current.items.length === 3);
    expect(result.current.notice).toBe("เลือกมา 5 รูป ใส่ได้อีก 3 รูป — ตัด 2 รูปท้ายออก");
    expect(result.current.items.map((i) => i.isPrimary)).toEqual([true, false, false]);
    expect(result.current.remaining).toBe(0);
    expect(result.current.rejections).toEqual([]);
  });

  it("ครบ 3 แล้วเลือกเพิ่ม → ไม่รับ + แจ้งว่าครบ", async () => {
    const { io } = makeIo();
    const { result } = setup(io);
    act(() => result.current.pick([file("a"), file("b"), file("c")]));
    await settle(result, () => result.current.items.every((i) => i.phase === "ready"));
    act(() => result.current.pick([file("d")]));
    expect(result.current.items).toHaveLength(3);
    expect(result.current.notice).toBe("ครบ 3 รูปแล้ว — เอารูปออกก่อนถ้าจะเพิ่ม");
  });

  it("ย่อ 'ทีละรูป' ไม่ขนาน (กันมือถือรุ่นล่างค้าง) · ระหว่างย่อ phase = resizing", async () => {
    let active = 0;
    let peak = 0;
    const resize = async (f: File) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
      return variants(f.name);
    };
    const { io } = makeIo();
    const { result } = setup(io, resize);
    act(() => result.current.pick([file("a"), file("b"), file("c")]));
    expect(result.current.items.map((i) => i.phase)).toEqual(["resizing", "resizing", "resizing"]);
    expect(result.current.resizingCount).toBe(3);
    await settle(result, () => result.current.items.every((i) => i.phase === "ready"));
    expect(peak).toBe(1);
  });

  it("ไฟล์เปิดไม่ได้ (HEIC/เสีย) → แถวแจ้ง ไม่กินช่อง ไม่บล็อก · เลือกหลายไฟล์ = บอกว่า 'รูปที่ n ที่เลือก'", async () => {
    const resize = async (f: File) => {
      if (f.name === "b") throw named("HeicNotSupportedError");
      if (f.name === "c") throw named("ImageDecodeError");
      return variants(f.name);
    };
    const { io } = makeIo();
    const { result } = setup(io, resize);
    act(() => result.current.pick([file("a"), file("b"), file("c")]));
    await settle(result, () => result.current.rejections.length === 2 && result.current.items.every((i) => i.phase === "ready"));
    expect(result.current.items).toHaveLength(1);
    expect(result.current.remaining).toBe(2);
    const texts = result.current.rejections.map((r) => r.text);
    expect(texts[0]).toMatch(/^รูปที่ 3 ที่เลือก — เปิดไฟล์รูปนี้ไม่ได้/);
    expect(texts[1]).toMatch(/^รูปที่ 2 ที่เลือก — ไฟล์ HEIC เปิดไม่ได้/);
    act(() => result.current.dismissRejection(result.current.rejections[0].id));
    expect(result.current.rejections).toHaveLength(1);
  });

  it("ไฟล์เดียวที่เปิดไม่ได้ = ข้อความล้วน ไม่มีคำนำ 'รูปที่ n ที่เลือก' · รูปหลักย้ายไปรูปถัดไปที่ใช้ได้", async () => {
    const resize = async (f: File) => {
      if (f.name === "a") throw named("ImageTooLargeError");
      return variants(f.name);
    };
    const { io } = makeIo();
    const { result } = setup(io, resize);
    act(() => result.current.pick([file("a")]));
    await settle(result, () => result.current.rejections.length === 1);
    expect(result.current.rejections[0].text).toContain("เกิน 1MB");
    expect(result.current.items).toHaveLength(0);
    act(() => result.current.pick([file("b")]));
    await settle(result, () => result.current.items[0]?.phase === "ready");
    expect(result.current.items[0].isPrimary).toBe(true);
  });

  it("ลบรูปหลัก → รูปถัดไปเป็นหลักแทน (invariant ≥1 รูป ⇒ มีหลัก 1) · เอาออกทิ้งในเครื่องทันที + revoke blob URL", async () => {
    const { io } = makeIo();
    const { result } = setup(io);
    act(() => result.current.pick([file("a"), file("b")]));
    await settle(result, () => result.current.items.every((i) => i.phase === "ready"));
    const [a, b] = result.current.items;
    expect(a.isPrimary).toBe(true);
    await act(async () => {
      await result.current.remove(a.key);
    });
    expect(result.current.items.map((i) => i.key)).toEqual([b.key]);
    expect(result.current.items[0].isPrimary).toBe(true);
    expect(io.remove).not.toHaveBeenCalled(); // ยังไม่ถึง server
    expect(revoked).toEqual(expect.arrayContaining(created.slice(0, 2)));
  });

  it("ตั้งรูปหลักในเครื่อง: ดาวย้ายทันที (ไม่เรียก server)", async () => {
    const { io } = makeIo();
    const { result } = setup(io);
    act(() => result.current.pick([file("a"), file("b")]));
    await settle(result, () => result.current.items.every((i) => i.phase === "ready"));
    await act(async () => {
      expect(await result.current.setPrimary(result.current.items[1].key)).toEqual({ ok: true });
    });
    expect(result.current.items.map((i) => i.isPrimary)).toEqual([false, true]);
  });
});

describe("ส่งหลังเปิดใบ — ทีละรูป หลักก่อน", () => {
  it("ส่งรูปหลักก่อนแม้เลือกเป็นรูปที่ 2 · ทีละรูป (concurrency 1) · FormData มี idemKey ของใบ + md/sm + isPrimary เฉพาะรูปหลัก", async () => {
    let active = 0;
    let peak = 0;
    const { io, calls } = makeIo({
      upload: vi.fn(async (fd: FormData) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active -= 1;
        const n = calls.push({ fd });
        return { ok: true as const, photo: sp(`p${n}`, { isPrimary: n === 1 }), count: n, max: 3 };
      }),
    });
    const { result } = setup(io);
    act(() => result.current.pick([file("a"), file("b"), file("c")]));
    await settle(result, () => result.current.items.every((i) => i.phase === "ready"));
    await act(async () => {
      await result.current.setPrimary(result.current.items[1].key); // b = หลัก
    });
    act(() => result.current.start(REF));
    await settle(result, () => result.current.items.every((i) => i.phase === "done"));
    expect(peak).toBe(1);
    const order = calls.map((c) => (c.fd.get("md") as File).size);
    expect(order[0]).toBe("md-b".length); // รูป b (หลัก) ถูกส่งก่อน
    expect(calls[0].fd.get("idemKey")).toBe(REF.idemKey);
    expect(calls[0].fd.get("jobId")).toBeNull();
    expect(calls[0].fd.get("isPrimary")).toBe("true");
    expect(calls[1].fd.get("isPrimary")).toBeNull();
    expect(calls[2].fd.get("isPrimary")).toBeNull();
    expect((calls[0].fd.get("sm") as File).name).toBe("sm.jpg");
    expect(result.current.summary).toBe("done");
    expect(result.current.items.filter((i) => i.isPrimary)).toHaveLength(1);
    expect(result.current.items.find((i) => i.isPrimary)?.serverId).toBe("p1");
  });

  it("อ้างใบด้วย jobId (จอ W-10) → FormData มี jobId ไม่มี idemKey", async () => {
    const { io, calls } = makeIo();
    const { result } = setup(io);
    act(() => result.current.start({ jobId: "11111111-1111-4111-8111-111111111111" }));
    act(() => result.current.pick([file("a")]));
    await settle(result, () => result.current.items[0]?.phase === "done");
    expect(calls[0].fd.get("jobId")).toBe("11111111-1111-4111-8111-111111111111");
    expect(calls[0].fd.get("idemKey")).toBeNull();
  });

  it("เพิ่มรูปหลัง start: ย่อแล้วเข้าคิวส่งเอง (ไม่ต้องกดอะไร)", async () => {
    const { io } = makeIo();
    const { result } = setup(io);
    act(() => result.current.start(REF));
    expect(result.current.started).toBe(true);
    act(() => result.current.pick([file("a")]));
    await settle(result, () => result.current.items[0]?.phase === "done");
    expect(io.upload).toHaveBeenCalledTimes(1);
  });

  it("ส่งล้ม (เน็ต/throw) → error + ลองใหม่ได้ · ปุ่มลองใหม่ส่งซ้ำรูปเดิม (ไม่ซ้ำรูปอื่น)", async () => {
    let fail = true;
    const { io } = makeIo({
      upload: vi.fn(async () => {
        if (fail) throw new Error("network");
        return { ok: true as const, photo: sp("p1", { isPrimary: true }), count: 1, max: 3 };
      }),
    });
    const { result } = setup(io);
    act(() => result.current.pick([file("a")]));
    await settle(result, () => result.current.items[0]?.phase === "ready");
    act(() => result.current.start(REF));
    await settle(result, () => result.current.items[0]?.phase === "error");
    expect(result.current.items[0]).toMatchObject({ retryable: true, ambiguous: true, message: "ส่งไม่สำเร็จ — ลองอีกครั้ง" });
    expect(result.current.summary).toBe("partial");
    fail = false;
    act(() => result.current.retry(result.current.items[0].key));
    await settle(result, () => result.current.items[0]?.phase === "done");
    expect(result.current.summary).toBe("done");
  });

  it("ส่งล้มแบบไม่ทราบผล → ก่อนลองใหม่เทียบรายการกับ server: เจอรูปของเราที่ client ไม่รู้จัก = ถือว่าส่งแล้ว ไม่ส่งซ้ำ (กันรูปซ้ำจนติดเพดาน)", async () => {
    let first = true;
    const { io } = makeIo({
      upload: vi.fn(async () => {
        if (first) {
          first = false;
          throw new Error("timeout"); // server อาจรับไปแล้ว
        }
        return { ok: true as const, photo: sp("dup", { isPrimary: true }), count: 2, max: 3 };
      }),
      list: vi.fn(async () => ({ ok: true as const, photos: [sp("lost1", { isPrimary: true })], count: 1, max: 3, locked: false, lockCode: null })),
    });
    const { result } = setup(io);
    act(() => result.current.pick([file("a")]));
    await settle(result, () => result.current.items[0]?.phase === "ready");
    act(() => result.current.start(REF));
    await settle(result, () => result.current.items[0]?.phase === "error");
    act(() => result.current.retry(result.current.items[0].key));
    await settle(result, () => result.current.items[0]?.phase === "done");
    expect(io.list).toHaveBeenCalledTimes(1);
    expect(io.upload).toHaveBeenCalledTimes(1); // ไม่ส่งซ้ำ
    expect(result.current.items[0].serverId).toBe("lost1");
  });

  it("ลองใหม่หลังไม่ทราบผล แต่ server ไม่มีรูปนั้น → ส่งจริงอีกครั้ง", async () => {
    let n = 0;
    const { io } = makeIo({
      upload: vi.fn(async () => {
        n += 1;
        if (n === 1) throw new Error("drop");
        return { ok: true as const, photo: sp("p1", { isPrimary: true }), count: 1, max: 3 };
      }),
    });
    const { result } = setup(io);
    act(() => result.current.pick([file("a")]));
    await settle(result, () => result.current.items[0]?.phase === "ready");
    act(() => result.current.start(REF));
    await settle(result, () => result.current.items[0]?.phase === "error");
    act(() => result.current.retry(result.current.items[0].key));
    await settle(result, () => result.current.items[0]?.phase === "done");
    expect(io.list).toHaveBeenCalledTimes(1);
    expect(io.upload).toHaveBeenCalledTimes(2);
  });

  it("รูปหลักส่งล้ม รูปอื่นไปก่อน → ดาวยังอยู่ที่รูปที่ผู้ใช้เลือก · ลองใหม่สำเร็จแล้วส่ง isPrimary=true (server สลับให้)", async () => {
    let attempt = 0;
    const flags: (string | null)[] = [];
    const { io } = makeIo({
      upload: vi.fn(async (fd: FormData) => {
        attempt += 1;
        flags.push(fd.get("isPrimary") as string | null);
        if (attempt === 1) return { ok: false as const, error: "ลองใหม่", code: "error" };
        const id = `p${attempt}`;
        return { ok: true as const, photo: sp(id, { isPrimary: fd.get("isPrimary") === "true" || attempt === 2 }), count: attempt, max: 3 };
      }),
    });
    const { result } = setup(io);
    act(() => result.current.pick([file("a"), file("b")]));
    await settle(result, () => result.current.items.every((i) => i.phase === "ready"));
    const [a, b] = result.current.items; // a = หลัก (ส่งล้ม) · b ไปต่อ
    act(() => result.current.start(REF));
    await settle(result, () => result.current.items.find((i) => i.key === b.key)?.phase === "done" && result.current.items.find((i) => i.key === a.key)?.phase === "error");
    expect(result.current.items.find((i) => i.key === a.key)?.isPrimary).toBe(true); // UI ตามที่ผู้ใช้เลือก
    act(() => result.current.retry(a.key));
    await settle(result, () => result.current.items.every((i) => i.phase === "done"));
    expect(flags).toEqual(["true", null, "true"]);
    expect(result.current.items.filter((i) => i.isPrimary).map((i) => i.key)).toEqual([a.key]);
  });
});

describe("ล็อก / PIN / ด่านของ server", () => {
  it("job_locked (ช่างรับงานแล้ว) → ทั้งใบล็อก: รูปที่ยังไม่ส่งกลายเป็น locked ไม่ลองใหม่ ไม่ยิงต่อ", async () => {
    const { io } = makeIo({ upload: vi.fn(async () => ({ ok: false as const, error: "ช่างเริ่มรับงานแล้ว", code: "job_locked" })) });
    const { result } = setup(io);
    act(() => result.current.pick([file("a"), file("b")]));
    await settle(result, () => result.current.items.every((i) => i.phase === "ready"));
    act(() => result.current.start(REF));
    await settle(result, () => result.current.lock === "locked");
    expect(result.current.items.map((i) => i.phase)).toEqual(["locked", "locked"]);
    expect(io.upload).toHaveBeenCalledTimes(1);
    expect(result.current.summary).toBe("locked");
    act(() => result.current.retry(result.current.items[0].key));
    expect(result.current.items[0].phase).toBe("locked");
    act(() => result.current.pick([file("c")])); // ล็อกแล้วเพิ่มไม่ได้
    expect(result.current.items).toHaveLength(2);
    await act(async () => {
      await result.current.remove(result.current.items[0].key); // เอาออกจากในเครื่องได้
    });
    expect(result.current.items).toHaveLength(1);
  });

  it("ล็อกกลางคิว: รูปที่ส่งสำเร็จแล้วยังเป็น done (ไม่ถูกลบ)", async () => {
    let n = 0;
    const { io } = makeIo({
      upload: vi.fn(async () => {
        n += 1;
        if (n === 2) return { ok: false as const, error: "x", code: "job_locked" };
        return { ok: true as const, photo: sp("p1", { isPrimary: true }), count: 1, max: 3 };
      }),
    });
    const { result } = setup(io);
    act(() => result.current.pick([file("a"), file("b"), file("c")]));
    await settle(result, () => result.current.items.every((i) => i.phase === "ready"));
    act(() => result.current.start(REF));
    await settle(result, () => result.current.lock === "locked");
    expect(result.current.items.map((i) => i.phase)).toEqual(["done", "locked", "locked"]);
  });

  it("session หมดเวลา → ทุกรูปที่รออยู่ error 'ใส่ PIN ใหม่' (ไม่ยิงซ้ำให้ล้มทีละรูป) · ใส่ PIN แล้วกดลองใหม่ส่งต่อได้", async () => {
    let expired = true;
    const { io } = makeIo({
      upload: vi.fn(async () => {
        if (expired) return { ok: false as const, error: "หมดเวลาแล้ว — ใส่ PIN ใหม่", code: "session_required" };
        return { ok: true as const, photo: sp(`p${Math.random()}`, { isPrimary: false }), count: 1, max: 3 };
      }),
    });
    const { result } = setup(io);
    act(() => result.current.pick([file("a"), file("b"), file("c")]));
    await settle(result, () => result.current.items.every((i) => i.phase === "ready"));
    act(() => result.current.start(REF));
    await settle(result, () => result.current.items.every((i) => i.phase === "error"));
    expect(io.upload).toHaveBeenCalledTimes(1);
    expect(result.current.items.every((i) => i.needsPin && i.retryable)).toBe(true);
    expect(result.current.lock).toBeNull();
    expired = false;
    act(() => result.current.retryAll());
    await settle(result, () => result.current.items.every((i) => i.phase === "done"));
    expect(result.current.items.some((i) => i.needsPin)).toBe(false);
  });

  it("โควตาหน้างานเต็ม (photo_daily_cap / photo_budget_shopfloor) → ทุกรูปที่รออยู่ error ลองใหม่ไม่ได้ ไม่ยิงซ้ำ (ไม่เผาโควตา/rate limit) · ไม่ล็อกทั้งใบ", async () => {
    for (const code of ["photo_daily_cap", "photo_budget_shopfloor"]) {
      const { io } = makeIo({ upload: vi.fn(async () => ({ ok: false as const, error: "x", code })) });
      const { result, unmount } = setup(io);
      act(() => result.current.pick([file("a"), file("b"), file("c")]));
      await settle(result, () => result.current.items.every((i) => i.phase === "ready"));
      act(() => result.current.start(REF));
      await settle(result, () => result.current.items.every((i) => i.phase === "error"));
      expect(io.upload, code).toHaveBeenCalledTimes(1);
      expect(result.current.items.every((i) => !i.retryable && !i.needsPin), code).toBe(true);
      expect(result.current.items[0].message, code).toBe(code === "photo_daily_cap" ? "วันนี้แนบรูปครบกำหนดแล้ว" : "พื้นที่รูปจากหน้างานเต็มแล้ว — แจ้งออฟฟิศ");
      expect(result.current.lock, code).toBeNull();
      act(() => result.current.retryAll());
      expect(result.current.items.every((i) => i.phase === "error"), code).toBe(true);
      expect(io.upload, code).toHaveBeenCalledTimes(1);
      unmount();
    }
  });

  it("ครบเพดาน/ไฟล์ไม่ผ่านที่ server → error ลองใหม่ไม่ได้ (มีแต่เอาออก) และไม่ล็อกทั้งใบ", async () => {
    const { io } = makeIo({ upload: vi.fn(async () => ({ ok: false as const, error: "ไฟล์ไม่ใช่ JPEG จริง", code: "photo_file_not_jpeg" })) });
    const { result } = setup(io);
    act(() => result.current.pick([file("a")]));
    await settle(result, () => result.current.items[0]?.phase === "ready");
    act(() => result.current.start(REF));
    await settle(result, () => result.current.items[0]?.phase === "error");
    expect(result.current.items[0].retryable).toBe(false);
    expect(result.current.lock).toBeNull();
    act(() => result.current.retry(result.current.items[0].key));
    expect(result.current.items[0].phase).toBe("error");
    expect(io.upload).toHaveBeenCalledTimes(1);
  });
});

describe("ลบ / ตั้งหลักรูปที่ส่งแล้ว", () => {
  async function sent(io: ShopPhotoIo, names = ["a", "b"]) {
    const h = setup(io);
    act(() => h.result.current.pick(names.map(file)));
    await settle(h.result, () => h.result.current.items.every((i) => i.phase === "ready"));
    act(() => h.result.current.start(REF));
    await settle(h.result, () => h.result.current.items.every((i) => i.phase === "done"));
    return h;
  }

  it("ลบรูปที่ส่งแล้ว = เรียก server แล้วทิ้ง · รูปหลักถูกลบ → ดาวย้ายตาม promotedPhotoId ของ server", async () => {
    const { io } = makeIo({ remove: vi.fn(async () => ({ ok: true as const, promotedPhotoId: "p2", already: false })) });
    const { result } = await sent(io);
    const primary = result.current.items.find((i) => i.isPrimary)!;
    expect(primary.serverId).toBe("p1");
    await act(async () => {
      expect(await result.current.remove(primary.key)).toEqual({ ok: true });
    });
    expect(io.remove).toHaveBeenCalledWith("p1");
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]).toMatchObject({ serverId: "p2", isPrimary: true });
  });

  it("ลบล้ม (เน็ต) → รูปยังอยู่ + ข้อความ · ลบล้มเพราะช่างรับงานแล้ว → ล็อกทั้งใบ", async () => {
    let mode: "net" | "lock" = "net";
    const { io } = makeIo({
      remove: vi.fn(async () => {
        if (mode === "net") throw new Error("net");
        return { ok: false as const, error: "ช่างเริ่มรับงานแล้ว", code: "job_locked" };
      }),
    });
    const { result } = await sent(io);
    const k = result.current.items[1].key;
    let r: Awaited<ReturnType<typeof result.current.remove>> | null = null;
    await act(async () => {
      r = await result.current.remove(k);
    });
    expect(r).toEqual({ ok: false, message: "ลบรูปไม่สำเร็จ — เช็คสัญญาณแล้วลองอีกครั้ง" });
    expect(result.current.items).toHaveLength(2);
    mode = "lock";
    await act(async () => {
      r = await result.current.remove(k);
    });
    expect(r).toEqual({ ok: false, message: "ช่างรับงานแล้ว แก้รูปไม่ได้ — แจ้งออฟฟิศ" });
    expect(result.current.lock).toBe("locked");
    expect(result.current.items).toHaveLength(2);
  });

  it("ตั้งรูปหลักของรูปที่ส่งแล้ว: ไม่มี io.setPrimary = ทำไม่ได้ (canSetPrimarySent=false) · มี = optimistic + ย้อนเมื่อล้ม", async () => {
    const a = makeIo();
    const h1 = await sent(a.io);
    expect(h1.result.current.canSetPrimarySent).toBe(false);
    let r: Awaited<ReturnType<typeof h1.result.current.setPrimary>> | null = null;
    await act(async () => {
      r = await h1.result.current.setPrimary(h1.result.current.items[1].key);
    });
    expect(r).toEqual({ ok: false, message: "ตั้งรูปหลักไม่สำเร็จ — ลองอีกครั้ง" });
    expect(h1.result.current.items.map((i) => i.isPrimary)).toEqual([true, false]);

    const setPrimary = vi.fn(async () => ({ ok: false as const, error: "x", code: "error" }));
    const b = makeIo({ setPrimary });
    const h2 = await sent(b.io);
    expect(h2.result.current.canSetPrimarySent).toBe(true);
    await act(async () => {
      r = await h2.result.current.setPrimary(h2.result.current.items[1].key);
    });
    expect(setPrimary).toHaveBeenCalledWith("p2");
    expect(r).toEqual({ ok: false, message: "ตั้งรูปหลักไม่สำเร็จ — ลองอีกครั้ง" });
    expect(h2.result.current.items.map((i) => i.isPrimary)).toEqual([true, false]); // ย้อน
    setPrimary.mockResolvedValueOnce({ ok: true } as never);
    await act(async () => {
      r = await h2.result.current.setPrimary(h2.result.current.items[1].key);
    });
    expect(r).toEqual({ ok: true });
    expect(h2.result.current.items.map((i) => i.isPrimary)).toEqual([false, true]);
  });
});

describe("loadServer (จอ W-10)", () => {
  it("แสดงเฉพาะรูปของตัวเอง (mine) · รูปออฟฟิศ/แคตตาล็อกไม่ขึ้น · ตัวนับนับเฉพาะรูปหน้างาน · ล็อกตาม server", async () => {
    const { io } = makeIo();
    const { result } = renderHook(() => useShopPhotos({ io, enforcePrimary: false, resize: async (f) => variants(f.name) }));
    act(() =>
      result.current.loadServer({
        photos: [sp("m1", { isPrimary: false }), sp("office", { mine: false, isPrimary: true }), sp("m2")],
        locked: false,
        lockCode: null,
      }),
    );
    expect(result.current.items.map((i) => i.serverId)).toEqual(["m1", "m2"]);
    expect(result.current.items.every((i) => i.saved && i.phase === "done")).toBe(true);
    expect(result.current.items.some((i) => i.isPrimary)).toBe(false); // รูปหลักเป็นของออฟฟิศ — ไม่บังคับดาวที่รูปของเรา
    expect(result.current.remaining).toBe(1);
    expect(result.current.lock).toBeNull();
    act(() => result.current.loadServer({ photos: [sp("m1")], locked: true, lockCode: "job_locked" }));
    expect(result.current.lock).toBe("locked");
    act(() => result.current.loadServer({ photos: [sp("m1")], locked: true, lockCode: "job_cancelled" }));
    expect(result.current.lock).toBe("closed");
    act(() => result.current.loadServer({ photos: [sp("m1")], locked: false, lockCode: null }));
    expect(result.current.lock).toBeNull();
  });

  it("โหลดซ้ำคงรูปในเครื่องที่ยังไม่ส่งไว้ · แทนที่รูปที่ server รู้จัก", async () => {
    const { io } = makeIo({ upload: vi.fn(async () => ({ ok: false as const, error: "x", code: "error" })) });
    const { result } = renderHook(() => useShopPhotos({ io, enforcePrimary: false, resize: async (f) => variants(f.name) }));
    act(() => result.current.loadServer({ photos: [sp("m1")], locked: false, lockCode: null }));
    act(() => result.current.start({ jobId: "11111111-1111-4111-8111-111111111111" }));
    act(() => result.current.pick([file("new")]));
    await settle(result, () => result.current.items.some((i) => i.phase === "error"));
    act(() => result.current.loadServer({ photos: [sp("m1"), sp("m9")], locked: false, lockCode: null }));
    expect(result.current.items.map((i) => i.serverId)).toEqual(["m1", "m9", null]);
  });

  it("รูปหลักของ server ตามที่ server บอก (enforcePrimary=false): อัปโหลดรูปแรกของใบ → ได้ดาวตามคำตอบ", async () => {
    const { io } = makeIo();
    const { result } = renderHook(() => useShopPhotos({ io, enforcePrimary: false, resize: async (f) => variants(f.name) }));
    act(() => result.current.loadServer({ photos: [], locked: false, lockCode: null }));
    act(() => result.current.start({ jobId: "11111111-1111-4111-8111-111111111111" }));
    act(() => result.current.pick([file("a")]));
    await settle(result, () => result.current.items[0]?.phase === "done");
    expect(result.current.items[0].isPrimary).toBe(true);
  });
});

describe("reset / unmount / beforeunload / online", () => {
  it("reset ล้างทุกอย่าง + revoke blob URL ทุกอัน · งานที่ค้างกลางอากาศไม่ทำให้รูปกลับมา", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const { io } = makeIo({
      upload: vi.fn(async () => {
        await gate;
        return { ok: true as const, photo: sp("late", { isPrimary: true }), count: 1, max: 3 };
      }),
    });
    const { result } = setup(io);
    act(() => result.current.pick([file("a")]));
    await settle(result, () => result.current.items[0]?.phase === "ready");
    act(() => result.current.start(REF));
    await settle(result, () => result.current.items[0]?.phase === "uploading");
    act(() => result.current.reset());
    expect(result.current.items).toEqual([]);
    expect(result.current.started).toBe(false);
    expect(revoked.length).toBe(created.length);
    release();
    await act(async () => {
      await gate;
    });
    expect(result.current.items).toEqual([]);
  });

  it("unmount = revoke blob URL ทุกอัน", async () => {
    const { io } = makeIo();
    const { result, unmount } = setup(io);
    act(() => result.current.pick([file("a"), file("b")]));
    await settle(result, () => result.current.items.every((i) => i.phase === "ready"));
    expect(created).toHaveLength(4);
    unmount();
    expect(revoked).toHaveLength(4);
  });

  it("beforeunload ลงทะเบียนเมื่อมีรูปค้างหลังเปิดใบ · ถอนเมื่อส่งครบ · ก่อนเปิดใบ (ยังไม่ start) ไม่ลง", async () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const { io } = makeIo({
      upload: vi.fn(async () => {
        await gate;
        return { ok: true as const, photo: sp("p1", { isPrimary: true }), count: 1, max: 3 };
      }),
    });
    const { result } = setup(io);
    act(() => result.current.pick([file("a")]));
    await settle(result, () => result.current.items[0]?.phase === "ready");
    expect(add.mock.calls.some((c) => c[0] === "beforeunload")).toBe(false);
    act(() => result.current.start(REF));
    await settle(result, () => result.current.items[0]?.phase === "uploading");
    expect(add.mock.calls.some((c) => c[0] === "beforeunload")).toBe(true);
    release();
    await settle(result, () => result.current.items[0]?.phase === "done");
    expect(remove.mock.calls.some((c) => c[0] === "beforeunload")).toBe(true);
  });

  it("เน็ตหลุด/กลับมาตาม offline/online", async () => {
    const { io } = makeIo();
    const { result } = setup(io);
    expect(result.current.online).toBe(true);
    const nav = vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(result.current.online).toBe(false);
    nav.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(result.current.online).toBe(true);
  });

  it("Wake Lock ขอเฉพาะช่วงที่มีรูปรอส่ง และปล่อยเมื่อส่งเสร็จ · เบราว์เซอร์ไม่รองรับ = ไม่พัง", async () => {
    const release = vi.fn(async () => undefined);
    const request = vi.fn(async () => ({ release }));
    Object.defineProperty(navigator, "wakeLock", { value: { request }, configurable: true });
    let open: () => void = () => undefined;
    const gate = new Promise<void>((r) => (open = r));
    const { io } = makeIo({
      upload: vi.fn(async () => {
        await gate;
        return { ok: true as const, photo: sp("p1", { isPrimary: true }), count: 1, max: 3 };
      }),
    });
    const { result } = setup(io);
    act(() => result.current.pick([file("a")]));
    await settle(result, () => result.current.items[0]?.phase === "ready");
    expect(request).not.toHaveBeenCalled(); // ก่อนส่งยังไม่ขอ
    act(() => result.current.start(REF));
    await waitFor(() => expect(request).toHaveBeenCalledWith("screen"));
    open();
    await settle(result, () => result.current.items[0]?.phase === "done");
    await waitFor(() => expect(release).toHaveBeenCalled());
    // ไม่รองรับ
    Object.defineProperty(navigator, "wakeLock", { value: undefined, configurable: true });
    const again = makeIo();
    const h = setup(again.io);
    act(() => h.result.current.start(REF));
    act(() => h.result.current.pick([file("z")]));
    await settle(h.result, () => h.result.current.items[0]?.phase === "done");
  });
});
