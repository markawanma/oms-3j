// @vitest-environment jsdom
// คิวอัปโหลดรูปใบงาน: retry เฉพาะ error+retryable (N4) · ตัดสิน retry จาก code (S3) · ทีละ 2 · ล้างคิวเมื่อสำเร็จ
import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { UPLOAD_CONCURRENCY, useJobPhotoUploads } from "./useJobPhotoUploads";
import type { SendResult } from "./useJobPhotoUploads";
import { JOB_PHOTO_FILE_CODE } from "@/lib/jobs/photos";
import type { JobPhotoRow } from "@/lib/jobs/photos";
import type { ImageVariants } from "@/lib/images/client";

const variants = (): ImageVariants => ({
  md: { blob: new Blob(["m"]), width: 1200, height: 900, bytes: 1, quality: 0.9 },
  sm: { blob: new Blob(["s"]), width: 480, height: 360, bytes: 1, quality: 0.9 },
});
const row: JobPhotoRow = { id: "r1", smUrl: null, mdUrl: null, isPrimary: false, sortOrder: 0, caption: null, source: "office", createdAt: null };
const file = (n = "a.jpg") => new File(["x"], n, { type: "image/jpeg" });

function setup(send: (v: ImageVariants) => Promise<SendResult>) {
  const onUploaded = vi.fn();
  const resize = vi.fn(async () => variants());
  const hook = renderHook(() => useJobPhotoUploads({ send, onUploaded, resize }));
  return { hook, onUploaded, resize };
}

describe("retry — เฉพาะ error ที่ลองใหม่ช่วย (N4)", () => {
  it("code ของด่านไฟล์ทุกตัว = ลองใหม่ไม่ช่วย: retry() ไม่ส่งซ้ำ ไม่ย่อซ้ำ ไม่ดันเข้าคิว", async () => {
    for (const code of Object.values(JOB_PHOTO_FILE_CODE)) {
      const send = vi.fn(async (): Promise<SendResult> => ({ ok: false, error: "ข้อความอะไรก็ได้", code }));
      const { hook, resize } = setup(send);
      act(() => hook.result.current.enqueue([file()]));
      await waitFor(() => expect(hook.result.current.items[0]?.phase).toBe("error"));
      expect(hook.result.current.items[0].retryable, code).toBe(false);
      act(() => hook.result.current.retry(hook.result.current.items[0].id));
      act(() => hook.result.current.retryAll([hook.result.current.items[0].id]));
      await new Promise((r) => setTimeout(r, 20));
      expect(send, code).toHaveBeenCalledTimes(1);
      expect(resize, code).toHaveBeenCalledTimes(1);
      expect(hook.result.current.items[0].phase, code).toBe("error");
      hook.unmount();
    }
  });

  it("ล้มแบบชั่วคราว (ไม่มี code / code อื่น) = ลองใหม่ได้ · retry ซ้ำสองครั้งติดกันส่งครั้งเดียว", async () => {
    const send = vi.fn<(v: ImageVariants) => Promise<SendResult>>();
    send.mockResolvedValueOnce({ ok: false, error: "ชั่วคราว" });
    const { hook, onUploaded } = setup(send);
    act(() => hook.result.current.enqueue([file()]));
    await waitFor(() => expect(hook.result.current.items[0]?.phase).toBe("error"));
    expect(hook.result.current.items[0].retryable).toBe(true);
    let release: (v: SendResult) => void = () => undefined;
    send.mockImplementationOnce(() => new Promise<SendResult>((r) => (release = r)));
    const id = hook.result.current.items[0].id;
    act(() => {
      hook.result.current.retry(id);
      hook.result.current.retry(id);
    });
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    await act(async () => release({ ok: true, data: row }));
    await waitFor(() => expect(hook.result.current.items).toHaveLength(0));
    expect(send).toHaveBeenCalledTimes(2);
    expect(onUploaded).toHaveBeenCalledTimes(1);
  });

  it("รายการที่กำลังส่ง ไม่ถูก retry เข้าคิวซ้ำ", async () => {
    let release: (v: SendResult) => void = () => undefined;
    const send = vi.fn(() => new Promise<SendResult>((r) => (release = r)));
    const { hook } = setup(send);
    act(() => hook.result.current.enqueue([file()]));
    await waitFor(() => expect(hook.result.current.items[0]?.phase).toBe("uploading"));
    act(() => hook.result.current.retry(hook.result.current.items[0].id));
    await new Promise((r) => setTimeout(r, 20));
    expect(send).toHaveBeenCalledTimes(1);
    await act(async () => release({ ok: true, data: row }));
  });
});

describe("ทีละ 2", () => {
  it(`พร้อมกันไม่เกิน ${UPLOAD_CONCURRENCY}`, async () => {
    let inflight = 0;
    let peak = 0;
    const send = vi.fn(async (): Promise<SendResult> => {
      inflight += 1;
      peak = Math.max(peak, inflight);
      await new Promise((r) => setTimeout(r, 10));
      inflight -= 1;
      return { ok: true, data: row };
    });
    const { hook } = setup(send);
    act(() => hook.result.current.enqueue([file("1"), file("2"), file("3"), file("4"), file("5")]));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(5), { timeout: 3000 });
    expect(peak).toBe(UPLOAD_CONCURRENCY);
  });
});
