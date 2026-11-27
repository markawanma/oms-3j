// deliver — ลำดับ A (Web Share ไฟล์) → needSheet · S7 ไม่อ้างว่า "บันทึกแล้ว" (คืน shared เฉยๆ) · S8 AbortError = aborted เงียบ
import { describe, expect, it, vi } from "vitest";
import { canShareFile, deliverImage, type ShareNavigator } from "./deliver";

const file = () => new File([new Uint8Array([1, 2, 3])], "3j-ring-20261125.jpg", { type: "image/jpeg" });
const nav = (over: Partial<ShareNavigator> = {}) =>
  ({ canShare: vi.fn(() => true), share: vi.fn(async () => undefined), ...over }) as unknown as ShareNavigator & {
    canShare: ReturnType<typeof vi.fn>;
    share: ReturnType<typeof vi.fn>;
  };
const rejectWith = (name: string) => vi.fn(async () => Promise.reject(Object.assign(new Error("x"), { name })));

describe("deliverImage", () => {
  it("canShare จริง → share พร้อมไฟล์เท่านั้น (ไม่ส่ง title/text/url) → shared", async () => {
    const n = nav();
    const f = file();
    await expect(deliverImage(f, n)).resolves.toBe("shared");
    expect(n.canShare).toHaveBeenCalledWith({ files: [f] });
    expect(n.share).toHaveBeenCalledTimes(1);
    const arg = n.share.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(arg)).toEqual(["files"]); // ไม่พาลิงก์/ข้อความไปกับรูป
  });

  it("S8: AbortError (ผู้ใช้ยกเลิกเมนูแชร์) → aborted ไม่ใช่ needSheet/ไม่ throw", async () => {
    await expect(deliverImage(file(), nav({ share: rejectWith("AbortError") }))).resolves.toBe("aborted");
  });

  it("NotAllowedError (gesture หมดอายุ) / error อื่น → needSheet (ล้มได้ทุกขั้น ไม่มีทางตัน)", async () => {
    for (const name of ["NotAllowedError", "TypeError", "DataError"]) {
      await expect(deliverImage(file(), nav({ share: rejectWith(name) }))).resolves.toBe("needSheet");
    }
    await expect(deliverImage(file(), nav({ share: vi.fn(async () => Promise.reject("string error")) }))).resolves.toBe("needSheet");
  });

  it("canShare เป็น false / throw / ไม่มี API → needSheet โดยไม่เรียก share", async () => {
    const a = nav({ canShare: vi.fn(() => false) });
    await expect(deliverImage(file(), a)).resolves.toBe("needSheet");
    expect(a.share).not.toHaveBeenCalled();
    const b = nav({
      canShare: vi.fn(() => {
        throw new Error("boom");
      }),
    });
    await expect(deliverImage(file(), b)).resolves.toBe("needSheet");
    expect(b.share).not.toHaveBeenCalled();
    await expect(deliverImage(file(), {})).resolves.toBe("needSheet");
    const noCanShare = { share: vi.fn() };
    await expect(deliverImage(file(), noCanShare)).resolves.toBe("needSheet"); // ไม่มี canShare = ไม่เสี่ยงเรียก share ด้วยไฟล์
    expect(noCanShare.share).not.toHaveBeenCalled();
    await expect(deliverImage(file(), undefined)).resolves.toBe("needSheet");
  });

  it("share ถูกเรียกแบบ sync ในการเรียกเดียว (ไม่มี await ก่อนหน้า) — ให้อยู่ใน gesture ของปุ่มใน sheet", () => {
    const n = nav();
    void deliverImage(file(), n);
    expect(n.share).toHaveBeenCalledTimes(1);
  });

  it("เรียก canShare/share แบบ method ของ navigator (this ไม่หลุด)", async () => {
    const self = {
      ok: true,
      canShare() {
        return this.ok;
      },
      async share() {
        if (!this.ok) throw new Error("this หลุด");
      },
    };
    await expect(deliverImage(file(), self as unknown as ShareNavigator)).resolves.toBe("shared");
  });
});

describe("canShareFile", () => {
  it("true เฉพาะเมื่อมีทั้ง share + canShare และ canShare === true", () => {
    expect(canShareFile(file(), nav())).toBe(true);
    expect(canShareFile(file(), nav({ canShare: vi.fn(() => false) }))).toBe(false);
    expect(canShareFile(file(), {})).toBe(false);
  });
});
