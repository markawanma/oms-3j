// @vitest-environment jsdom
// รอบแก้ review/QA ของ useShopPhotos (21 ต.ค.): S1 reset ระหว่างย่อแล้วเลือกใหม่ · S2 ★ ล้มย้อนเฉพาะฟิลด์ดาว · QA🐞1 loadServer merge · QA🐞2 ★ ที่ locked · QA🐞3 maybeSent
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useShopPhotos } from "./useShopPhotos";
import type { PhotoRef, ServerPhoto, ShopPhotoIo } from "./useShopPhotos";
import type { ImageVariants } from "@/lib/images/client";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
beforeEach(() => {
  let n = 0;
  (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = () => `blob:rv-${++n}`;
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
const REF: PhotoRef = { idemKey: "idem-key-0123456789abcdef" };
type Up = Awaited<ReturnType<ShopPhotoIo["upload"]>>;
type SP = Awaited<ReturnType<NonNullable<ShopPhotoIo["setPrimary"]>>>;

function io(over: Partial<ShopPhotoIo> = {}): ShopPhotoIo {
  let n = 0;
  return {
    upload: vi.fn(async () => {
      n += 1;
      return { ok: true as const, photo: sp(`p${n}`, { isPrimary: n === 1 }), count: n, max: 3 };
    }),
    remove: vi.fn(async () => ({ ok: true as const, promotedPhotoId: null, already: false })),
    list: vi.fn(async () => ({ ok: true as const, photos: [], count: 0, max: 3, locked: false, lockCode: null })),
    ...over,
  };
}

describe("S1 — reset ระหว่างย่อรูปแล้วเลือกรูปใหม่: คิวต้องไม่ค้าง", () => {
  it("ย่อรูป a ค้างอยู่ → reset (เปิดอีกใบ/เปลี่ยนคน) → เลือกรูป b ทันที → b ย่อเสร็จเป็น ready (ไม่ค้าง 'กำลังย่อรูป…' ตลอดไป) · ผลของ a ถูกทิ้ง", async () => {
    let releaseA: () => void = () => undefined;
    const gateA = new Promise<void>((r) => (releaseA = r));
    const resize = vi.fn(async (f: File) => {
      if (f.name === "a") await gateA;
      return variants(f.name);
    });
    const { result } = renderHook(() => useShopPhotos({ io: io(), resize }));
    act(() => result.current.pick([file("a")]));
    await settle(() => resize.mock.calls.length === 1); // a กำลังย่อ (flag resizing ค้าง true)
    act(() => result.current.reset());
    act(() => result.current.pick([file("b")]));
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].phase).toBe("resizing");
    await act(async () => releaseA()); // a ย่อเสร็จหลัง reset → ทิ้งผล แต่ต้องเดินคิวต่อไปที่ b
    await settle(() => result.current.items[0]?.phase === "ready");
    expect(resize.mock.calls.map((c) => (c[0] as File).name)).toEqual(["a", "b"]);
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].smUrl).toMatch(/^blob:rv-/);
    // และเลือกรูปต่อไปได้ตามปกติ (flag resizing ถูกปล่อยแล้ว)
    act(() => result.current.pick([file("c")]));
    await settle(() => result.current.items.length === 2 && result.current.items.every((i) => i.phase === "ready"));
  });
});

describe("S2 — ★ ล้ม: ย้อนเฉพาะฟิลด์ดาว ไม่ทับสถานะรูปอื่น", () => {
  it("รูปอื่นส่งเสร็จ (done) ระหว่างรอ setPrimary ของอีกรูป แล้ว setPrimary ล้ม → รูปนั้นยังเป็น done (ไม่ย้อนเป็น queued/uploading) · ดาวกลับที่เดิม", async () => {
    const pending: ((r: Up) => void)[] = [];
    let setPrimaryResolve: (r: SP) => void = () => undefined;
    const i = io({
      upload: vi.fn(
        () =>
          new Promise<Up>((resolve) => {
            pending.push(resolve);
          }),
      ),
      setPrimary: vi.fn(
        () =>
          new Promise<SP>((resolve) => {
            setPrimaryResolve = resolve;
          }),
      ),
    });
    const { result } = renderHook(() => useShopPhotos({ io: i, resize: async (f) => variants(f.name) }));
    act(() => result.current.pick([file("a"), file("b"), file("c")]));
    await settle(() => result.current.items.every((x) => x.phase === "ready"));
    const [a, b, c] = result.current.items;
    act(() => result.current.start(REF));
    await settle(() => pending.length === 1);
    await act(async () => pending[0]({ ok: true, photo: sp("pa", { isPrimary: true }), count: 1, max: 3 })); // a done (หลัก)
    await settle(() => pending.length === 2);
    await act(async () => pending[1]({ ok: true, photo: sp("pb"), count: 2, max: 3 })); // b done
    await settle(() => result.current.items.find((x) => x.key === b.key)?.phase === "done" && pending.length === 3); // c กำลังส่ง
    let p: Promise<Awaited<ReturnType<typeof result.current.setPrimary>>> = Promise.resolve({ ok: true });
    act(() => {
      p = result.current.setPrimary(b.key); // ขอ ★ ที่ b (server ยังไม่ตอบ — ห้ามครอบด้วย act ที่รอผล: act ซ้อนกัน)
    });
    await settle(() => result.current.items.find((x) => x.key === b.key)?.isPrimary === true);
    // ระหว่างรอ: c ส่งเสร็จ
    await act(async () => pending[2]({ ok: true, photo: sp("pc"), count: 3, max: 3 }));
    await settle(() => result.current.items.find((x) => x.key === c.key)?.phase === "done");
    // setPrimary ล้ม
    await act(async () => setPrimaryResolve({ ok: false, error: "x", code: "primary_locked" }));
    const r = await p;
    expect(r).toEqual({ ok: false, message: "รูปหลักออฟฟิศตั้งไว้แล้ว — แจ้งออฟฟิศถ้าจะเปลี่ยน" });
    const byKey = (k: string) => result.current.items.find((x) => x.key === k)!;
    expect(byKey(c.key).phase).toBe("done"); // ไม่ถูกย้อนเป็นสถานะตอนกด (uploading)
    expect(byKey(c.key).serverId).toBe("pc");
    expect(byKey(a.key)).toMatchObject({ isPrimary: true, serverPrimary: true });
    expect(byKey(b.key)).toMatchObject({ isPrimary: false, serverPrimary: false });
    expect(result.current.items.every((x) => x.phase === "done")).toBe(true);
  });
});

describe("QA🐞1 — loadServer เป็น merge", () => {
  it("รูปที่เพิ่งส่งสำเร็จแต่ยังไม่อยู่ใน list (list อ่านก่อนลงทะเบียน) ไม่หาย · ตัวนับถูก · รูปที่ list รู้จักใช้ภาพในเครื่องต่อ (ไม่เปลี่ยน URL) · รูป saved ที่ถูกลบที่อื่นหายตาม list", async () => {
    const pending: ((r: Up) => void)[] = [];
    const i = io({ upload: vi.fn(() => new Promise<Up>((resolve) => pending.push(resolve))) });
    const { result } = renderHook(() => useShopPhotos({ io: i, enforcePrimary: false, resize: async (f) => variants(f.name) }));
    act(() => result.current.loadServer({ photos: [sp("m1", { isPrimary: true }), sp("m0")], locked: false, lockCode: null }));
    act(() => result.current.start({ jobId: "11111111-1111-4111-8111-111111111111" }));
    act(() => result.current.pick([file("new")]));
    await settle(() => pending.length === 1);
    await act(async () => pending[0]({ ok: true, photo: sp("m2"), count: 3, max: 3 }));
    await settle(() => result.current.items.some((x) => x.serverId === "m2"));
    const localUrl = result.current.items.find((x) => x.serverId === "m2")!.smUrl;
    // list เก่า: ไม่มี m2 และไม่มี m0 (m0 ถูกลบที่อื่น)
    act(() => result.current.loadServer({ photos: [sp("m1", { isPrimary: true })], locked: false, lockCode: null }));
    expect(result.current.items.map((x) => x.serverId)).toEqual(["m1", "m2"]);
    expect(result.current.remaining).toBe(1);
    // list ใหม่ที่มี m2 แล้ว: ใช้ภาพในเครื่องต่อ ไม่เปลี่ยน URL เป็น signed URL
    act(() => result.current.loadServer({ photos: [sp("m1", { isPrimary: true }), sp("m2")], locked: false, lockCode: null }));
    expect(result.current.items.map((x) => x.serverId)).toEqual(["m1", "m2"]);
    expect(result.current.items.find((x) => x.serverId === "m2")!.smUrl).toBe(localUrl);
  });

  it("list เก่า + รูปที่เพิ่งส่งถือ ★ อยู่ (ตั้งผ่านไปแล้ว) → ★ ตัวเดียว ไม่ซ้ำกับดาวใน list", async () => {
    const pending: ((r: Up) => void)[] = [];
    const i = io({ upload: vi.fn(() => new Promise<Up>((resolve) => pending.push(resolve))) });
    const { result } = renderHook(() => useShopPhotos({ io: i, enforcePrimary: false, resize: async (f) => variants(f.name) }));
    act(() => result.current.loadServer({ photos: [sp("m1", { isPrimary: true })], locked: false, lockCode: null }));
    act(() => result.current.start({ jobId: "11111111-1111-4111-8111-111111111111" }));
    act(() => result.current.pick([file("new")]));
    await settle(() => result.current.items.some((x) => x.phase === "ready" || x.phase === "queued" || x.phase === "uploading"));
    const newKey = result.current.items.find((x) => x.serverId === null)!.key;
    await act(async () => {
      await result.current.setPrimary(newKey); // ★ ที่รูปใหม่ (ยังไม่ส่ง)
    });
    await settle(() => pending.length === 1);
    await act(async () => pending[0]({ ok: true, photo: sp("m2", { isPrimary: true }), count: 2, max: 3 }));
    await settle(() => result.current.items.some((x) => x.serverId === "m2"));
    act(() => result.current.loadServer({ photos: [sp("m1", { isPrimary: true })], locked: false, lockCode: null }));
    expect(result.current.items.filter((x) => x.isPrimary).map((x) => x.serverId)).toEqual(["m2"]);
  });
});

describe("QA🐞2 — ★ ไม่ค้างที่รูป locked", () => {
  it("W-8: รูปที่ถือ ★ ถูกล็อก (ไม่เคยถึง server) → ★ กลับไปรูปหลักจริงที่ส่งแล้ว", async () => {
    const pending: ((r: Up) => void)[] = [];
    const i = io({ upload: vi.fn(() => new Promise<Up>((resolve) => pending.push(resolve))) });
    const { result } = renderHook(() => useShopPhotos({ io: i, resize: async (f) => variants(f.name) }));
    act(() => result.current.pick([file("a"), file("b")]));
    await settle(() => result.current.items.every((x) => x.phase === "ready"));
    const [a, b] = result.current.items;
    act(() => result.current.start(REF));
    await settle(() => pending.length === 1);
    await act(async () => {
      await result.current.setPrimary(b.key);
    });
    await act(async () => pending[0]({ ok: true, photo: sp("pa", { isPrimary: true }), count: 1, max: 3 }));
    await settle(() => pending.length === 2);
    await act(async () => pending[1]({ ok: false, error: "x", code: "job_locked" }));
    await settle(() => result.current.lock === "locked");
    expect(result.current.items.filter((x) => x.isPrimary).map((x) => x.key)).toEqual([a.key]);
    expect(result.current.items.find((x) => x.key === b.key)).toMatchObject({ phase: "locked", isPrimary: false });
  });

  it("ไม่มีรูปหลักจริงบน server เลย (ไม่มีรูปที่ส่งสำเร็จ) → ★ ยังอยู่ (invariant มีรูป ≥ 1 ⇒ มี ★)", async () => {
    const i = io({ upload: vi.fn(async () => ({ ok: false as const, error: "x", code: "job_locked" })) });
    const { result } = renderHook(() => useShopPhotos({ io: i, resize: async (f) => variants(f.name) }));
    act(() => result.current.pick([file("a"), file("b")]));
    await settle(() => result.current.items.every((x) => x.phase === "ready"));
    act(() => result.current.start(REF));
    await settle(() => result.current.lock === "locked");
    expect(result.current.items.filter((x) => x.isPrimary)).toHaveLength(1);
  });
});

describe("QA🐞3 — maybeSent: ส่งหลุดกลางทางไม่รู้ผล", () => {
  it("throw = maybeSent · server ตอบ (ปฏิเสธ/สำเร็จ) = ไม่ใช่ maybeSent · ลองใหม่สำเร็จ = done", async () => {
    let step = 0;
    const i = io({
      upload: vi.fn(async () => {
        step += 1;
        if (step === 1) throw new Error("net");
        if (step === 2) return { ok: false as const, error: "x", code: "rate_limited" };
        return { ok: true as const, photo: sp("p1", { isPrimary: true }), count: 1, max: 3 };
      }),
    });
    const { result } = renderHook(() => useShopPhotos({ io: i, resize: async (f) => variants(f.name) }));
    act(() => result.current.pick([file("a")]));
    await settle(() => result.current.items[0]?.phase === "ready");
    act(() => result.current.start(REF));
    await settle(() => result.current.items[0]?.phase === "error");
    expect(result.current.items[0].maybeSent).toBe(true);
    act(() => result.current.retry(result.current.items[0].key));
    await settle(() => result.current.items[0]?.phase === "error" && result.current.items[0]?.message?.includes("ส่งถี่") === true);
    expect(result.current.items[0].maybeSent).toBe(false);
    act(() => result.current.retry(result.current.items[0].key));
    await settle(() => result.current.items[0]?.phase === "done");
    expect(result.current.items[0].maybeSent).toBe(false);
  });
});
