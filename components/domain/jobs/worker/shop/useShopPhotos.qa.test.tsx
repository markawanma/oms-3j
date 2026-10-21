// @vitest-environment jsdom
// QA W2-UI (R2-D2 · 21 ต.ค. 69) — เคสขอบของ useShopPhotos ที่เทสต์เดิมยังไม่ครอบ
//  • ต้องไม่พัง: ผู้จัดการย้าย ★ ไปรูปที่ยังไม่ส่งระหว่างที่รูปหลักเดิมกำลังบิน → server จบที่รูปหลักตามที่เลือกล่าสุด และ UI ตรงกับ server
//  • KNOWN-GAP (it.fails): ช่องโหว่ที่เจอจากการอ่านโค้ด — เขียนเป็น it.fails เพื่อบันทึกพฤติกรรมที่ "ควรเป็น": ตอนแก้โค้ดแล้ว it.fails จะแดง → ให้เปลี่ยนเป็น it ธรรมดา
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useShopPhotos } from "./useShopPhotos";
import type { ServerPhoto, ShopPhotoIo } from "./useShopPhotos";
import type { ImageVariants } from "@/lib/images/client";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
beforeEach(() => {
  let n = 0;
  (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = () => `blob:qa-${++n}`;
  (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = () => undefined;
});

const file = (name: string) => new File([name], name, { type: "image/jpeg" });
const variants = (name: string): ImageVariants => ({
  md: { blob: new Blob([`md-${name}`]), width: 1200, height: 900, bytes: 10, quality: 0.9 },
  sm: { blob: new Blob([`sm-${name}`]), width: 480, height: 360, bytes: 5, quality: 0.9 },
});
const sp = (id: string, o: Partial<ServerPhoto> = {}): ServerPhoto => ({ id, smUrl: `https://s/${id}_sm`, mdUrl: `https://s/${id}_md`, isPrimary: false, mine: true, ...o });
const settle = async (pred: () => boolean) =>
  waitFor(
    () => {
      if (!pred()) throw new Error("ยังไม่ถึงสถานะที่รอ");
    },
    { timeout: 3000 },
  );
const JOB = "11111111-1111-4111-8111-111111111111";

/** deferred: คุมเวลาที่ upload แต่ละครั้งตอบกลับ */
function deferredIo() {
  const pending: { fd: FormData; resolve: (r: Awaited<ReturnType<ShopPhotoIo["upload"]>>) => void }[] = [];
  const io: ShopPhotoIo = {
    upload: vi.fn(
      (fd: FormData) =>
        new Promise((resolve) => {
          pending.push({ fd, resolve });
        }),
    ),
    remove: vi.fn(async () => ({ ok: true as const, promotedPhotoId: null, already: false })),
    list: vi.fn(async () => ({ ok: true as const, photos: [], count: 0, max: 3, locked: false, lockCode: null })),
    setPrimary: vi.fn(async () => ({ ok: true as const, changed: true })),
  };
  return { io, pending };
}

describe("ต้องไม่พัง — ย้าย ★ ระหว่างที่รูปหลักเดิมกำลังบิน", () => {
  it("a (หลัก) กำลังส่ง → ผู้จัดการแตะ ★ ที่ b (ยังไม่ส่ง) → server ได้ b เป็นหลักล่าสุด · UI มี ★ ตัวเดียวที่ b · FormData ของ b ขอเป็นหลัก", async () => {
    const { io, pending } = deferredIo();
    const { result } = renderHook(() => useShopPhotos({ io, resize: async (f) => variants(f.name) }));
    act(() => result.current.pick([file("a"), file("b")]));
    await settle(() => result.current.items.every((i) => i.phase === "ready"));
    const [a, b] = result.current.items;
    act(() => result.current.start({ idemKey: "idem-key-0123456789abcdef" }));
    await settle(() => pending.length === 1);
    expect(pending[0].fd.get("isPrimary")).toBe("true"); // a ถูกส่งเป็นหลัก (ตอนนั้น ★ อยู่ที่ a)
    // ระหว่างบิน: ★ ย้ายไป b (รูปในเครื่อง = สลับทันที ไม่เรียก server)
    await act(async () => {
      await result.current.setPrimary(b.key);
    });
    expect(result.current.items.filter((i) => i.isPrimary).map((i) => i.key)).toEqual([b.key]);
    // server ตอบ: a สำเร็จ และเป็นหลัก (ตอนที่ server เห็นคำขอ a ยังไม่มีรูปหลัก)
    await act(async () => {
      pending[0].resolve({ ok: true, photo: sp("pa", { isPrimary: true }), count: 1, max: 3 });
    });
    await settle(() => pending.length === 2);
    expect(result.current.items.find((i) => i.key === a.key)?.phase).toBe("done");
    expect(result.current.items.filter((i) => i.isPrimary).map((i) => i.key)).toEqual([b.key]); // ★ ยังอยู่ที่ b ตามที่ผู้ใช้เลือก (ไม่เด้งกลับไป a)
    expect(pending[1].fd.get("isPrimary")).toBe("true"); // b ขอเป็นหลัก → DB สลับหลักจาก a (UI3b ใน qa-ui-0189.sql)
    await act(async () => {
      pending[1].resolve({ ok: true, photo: sp("pb", { isPrimary: true }), count: 2, max: 3 });
    });
    await settle(() => result.current.items.every((i) => i.phase === "done"));
    const prim = result.current.items.filter((i) => i.isPrimary);
    expect(prim.map((i) => i.key)).toEqual([b.key]);
    expect(result.current.items.find((i) => i.key === a.key)?.serverPrimary).toBe(false); // server เห็น b เป็นหลักแล้ว
    expect(result.current.items.find((i) => i.key === b.key)?.serverPrimary).toBe(true);
  });
});

describe("KNOWN-GAP (it.fails) — พฤติกรรมที่ควรเป็น แต่ตอนนี้ยังไม่เป็น", () => {
  it.fails("W-10: รายการจาก server ที่อ่านก่อนอัปโหลดเสร็จ (ขอลิงก์รูปใหม่เงียบๆ ตอน URL หมดอายุ) ไม่ควรทำให้รูปที่เพิ่งส่งสำเร็จหายจากจอ", async () => {
    const { io, pending } = deferredIo();
    const { result } = renderHook(() => useShopPhotos({ io, enforcePrimary: false, resize: async (f) => variants(f.name) }));
    act(() => result.current.loadServer({ photos: [sp("m1", { isPrimary: true })], locked: false, lockCode: null }));
    act(() => result.current.start({ jobId: JOB }));
    act(() => result.current.pick([file("new")]));
    await settle(() => pending.length === 1);
    // list() ถูกอ่านที่ server "ก่อน" รูปใหม่ลงทะเบียน (ยังเห็นแค่ m1)…
    const staleList = { photos: [sp("m1", { isPrimary: true })], locked: false, lockCode: null };
    // …แต่อัปโหลดสำเร็จก่อนที่ผลของ list จะถึงหน้าจอ
    await act(async () => {
      pending[0].resolve({ ok: true, photo: sp("m2"), count: 2, max: 3 });
    });
    await settle(() => result.current.items.some((i) => i.serverId === "m2"));
    act(() => result.current.loadServer(staleList));
    // ควร: m2 ยังอยู่ (ถ้าหาย ตัวนับ 2/3 ผิด → ผู้จัดการอาจพยายามเพิ่มรูปที่ 4 ที่ DB ไม่รับ)
    expect(result.current.items.map((i) => i.serverId)).toContain("m2");
  });

  it.fails("W-8: ช่างรับงานแล้วระหว่างที่รูปที่ผู้จัดการติด ★ ยังไม่ถูกส่ง — ★ ไม่ควรค้างอยู่ที่รูป locked (ที่ช่างจะไม่ได้เห็น) ขณะที่รูปอื่นที่ส่งแล้วเป็นหลักจริงบน server", async () => {
    const { io, pending } = deferredIo();
    const { result } = renderHook(() => useShopPhotos({ io, resize: async (f) => variants(f.name) }));
    act(() => result.current.pick([file("a"), file("b")]));
    await settle(() => result.current.items.every((i) => i.phase === "ready"));
    const [a, b] = result.current.items;
    act(() => result.current.start({ idemKey: "idem-key-0123456789abcdef" }));
    await settle(() => pending.length === 1);
    await act(async () => {
      await result.current.setPrimary(b.key); // ย้าย ★ ไป b ระหว่าง a บิน
    });
    await act(async () => {
      pending[0].resolve({ ok: true, photo: sp("pa", { isPrimary: true }), count: 1, max: 3 });
    });
    await settle(() => pending.length === 2);
    // ช่างรับงานพอดี: b ถูกปฏิเสธ job_locked
    await act(async () => {
      pending[1].resolve({ ok: false, error: "ช่างเริ่มรับงานแล้ว", code: "job_locked" });
    });
    await settle(() => result.current.items.find((i) => i.key === b.key)?.phase === "locked");
    const locked = result.current.items.find((i) => i.key === b.key)!;
    const sent = result.current.items.find((i) => i.key === a.key)!;
    expect(sent.serverPrimary).toBe(true); // ความจริงบน server: a เป็นหลัก (A5/มือถือช่างจะเห็น a)
    // ควร: ★ ตามความจริงบน server (a) ไม่ใช่ b ที่ไม่เคยถึง server
    expect(locked.isPrimary).toBe(false);
  });
});
