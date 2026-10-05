// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { GEM_QUIZ_QUESTIONS, GEM_QUIZ_STONES, MAX_LIKED_STONES, QUIZ_VERSION } from "@/lib/gem-quiz/config";
import { GemQuizClient } from "./GemQuizClient";

// เหตุผลเดียวกับ components/ui/CollapsibleSection.test.tsx: vitest.config.ts
// ไม่ได้เปิด test.globals ดังนั้น @testing-library/react ไม่ auto-cleanup เอง
afterEach(cleanup);

const DONE_KEY = `gemQuizDone:v${QUIZ_VERSION}`;

function renderQuiz(token: string | null = "test-token") {
  return render(<GemQuizClient token={token} />);
}

/** เดินแบบทดสอบให้ครบจนถึงหน้าผลลัพธ์ — ข้าม Q1 ด้วย "ยังไม่มีในใจ" แล้วเลือก
 * ตัวเลือกแรกของทุกคำถามแนะนำ (เนื้อหาเป็น placeholder ยังไม่ผ่าน 3 ด่าน
 * content — เทสต์นี้ไม่สนใจเนื้อหา สนใจแค่ flow/data). */
async function completeQuizToResult(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "ยังไม่มีในใจ" }));
  for (const question of GEM_QUIZ_QUESTIONS) {
    const firstOption = question.options[0];
    await user.click(screen.getByLabelText(firstOption.labelTh));
    await user.click(screen.getByRole("button", { name: "ถัดไป" }));
  }
  await screen.findByRole("heading", { name: "ผลลัพธ์ของคุณ" });
}

describe("GemQuizClient", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("สลับลำดับ 12 พลอยได้โดยไม่ error — ครบทั้ง 12 ตัวเสมอไม่ว่าจะสุ่มลำดับไหน", () => {
    renderQuiz();
    for (const stone of GEM_QUIZ_STONES) {
      expect(screen.getByLabelText(stone.labelTh)).toBeInTheDocument();
    }
  });

  it(`เลือกพลอยที่ชอบได้ไม่เกิน ${MAX_LIKED_STONES} ตัว — ตัวถัดไปถูก disable ทันที`, async () => {
    const user = userEvent.setup();
    renderQuiz();

    const checkboxes = GEM_QUIZ_STONES.map((s) => screen.getByLabelText(s.labelTh));
    for (let i = 0; i < MAX_LIKED_STONES; i++) {
      await user.click(checkboxes[i]);
      expect(checkboxes[i]).toBeChecked();
    }

    const extra = checkboxes[MAX_LIKED_STONES];
    expect(extra).toBeDisabled();
    await user.click(extra); // userEvent ไม่คลิกช่องที่ disabled จริง — ยืนยันว่าสถานะไม่เปลี่ยน
    expect(extra).not.toBeChecked();

    // ติ๊กออกตัวหนึ่งแล้วตัวที่ถูก disable ไว้ต้องกลับมากดได้ (ไม่ใช่ล็อกค้าง)
    await user.click(checkboxes[0]);
    expect(extra).not.toBeDisabled();
  });

  it("ทำซ้ำ (retake) จริง — ส่ง retake:true เมื่อ localStorage มีธงจากครั้งก่อนอยู่แล้ว (mock localStorage)", async () => {
    window.localStorage.setItem(DONE_KEY, "1");
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    renderQuiz();
    await completeQuizToResult(user);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/gem-quiz/submit");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.retake).toBe(true);
    expect(body.v).toBe(QUIZ_VERSION);
    expect(body.token).toBe("test-token");

    // สำเร็จ -> ต้อง set ธงไว้ (ยังเป็น "1" เดิม แต่ยืนยันว่า path สำเร็จไม่ลบ/พัง)
    await waitFor(() => expect(window.localStorage.getItem(DONE_KEY)).toBe("1"));
  });

  it("ทำครั้งแรก (ไม่มีธงใน localStorage) — ส่ง retake:false แล้ว set ธงหลังสำเร็จ", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    renderQuiz();
    await completeQuizToResult(user);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.retake).toBe(false);

    await waitFor(() => expect(window.localStorage.getItem(DONE_KEY)).toBe("1"));
  });

  it("fetch ล้ม (เน็ตหลุด) — ไม่ throw ออกมาให้ test fail และหน้าผลลัพธ์ยังอยู่ปกติ (N-4)", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    renderQuiz();
    await completeQuizToResult(user);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    // ผลลัพธ์ยังแสดงอยู่ปกติ — ไม่มีกล่อง error ใดๆ โผล่มา (design §5.2: client
    // ไม่แสดง error ใดๆ จาก submit นี้เลย)
    expect(screen.getByRole("heading", { name: "ผลลัพธ์ของคุณ" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // ล้มเหลว -> ไม่ set ธง (markDone ไม่ถูกเรียกเพราะ .then ไม่ fire ตอน reject)
    expect(window.localStorage.getItem(DONE_KEY)).toBeNull();
  });

  it("localStorage ถูกบล็อก (in-app browser, N-2) — ไม่ throw ตอน mount และยังทำแบบทดสอบได้ปกติ", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("localStorage blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("localStorage blocked");
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    expect(() => renderQuiz()).not.toThrow();
    await completeQuizToResult(user);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    // อ่านธงไม่ได้ -> ถือว่าไม่ retake (fail safe ไปทาง false ไม่ใช่ throw)
    expect(body.retake).toBe(false);
  });
});
