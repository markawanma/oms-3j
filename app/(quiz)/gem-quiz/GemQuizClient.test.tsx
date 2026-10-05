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
// จอ loading รอจริง ~1.5s (GemQuizClient.tsx's LOADING_DURATION_MS) — ไม่ mock
// timer (userEvent ต้องการ real timer) ใช้ timeout ของ findBy ที่ยาวพอแทน
const RESULT_TIMEOUT = 3000;

function question(code: string) {
  const q = GEM_QUIZ_QUESTIONS.find((item) => item.code === code);
  if (!q) throw new Error(`ไม่พบคำถาม ${code}`);
  return q;
}
function optionLabel(questionCode: string, optionCode: string): string {
  const opt = question(questionCode).options.find((o) => o.code === optionCode);
  if (!opt) throw new Error(`ไม่พบตัวเลือก ${questionCode}.${optionCode}`);
  return opt.labelTh;
}

function renderQuiz(token: string | null = "test-token") {
  return render(<GemQuizClient token={token} />);
}

/** เดินแบบทดสอบให้ครบจนถึงหน้าผลลัพธ์ — ค่าเริ่มต้นคือเคส "oracle demo" เดียวกับ
 * lib/gem-quiz/recommend.test.ts/result.test.ts (sun/career/energy/
 * [garnet,citrine,amethyst]/ring ⇒ rank1=garnet, top3=[garnet,citrine,
 * blue_topaz]) เพื่อให้ assert ผลลัพธ์ที่เจาะจงได้ ไม่ใช่แค่ "ไปถึงจอผลลัพธ์". */
async function completeQuizToResult(
  user: ReturnType<typeof userEvent.setup>,
  opts: {
    birthDay?: string;
    intention?: string;
    feeling?: string;
    likedNames?: string[];
    jewelryType?: string;
  } = {}
) {
  const {
    birthDay = "sun",
    intention = "career",
    feeling = "energy",
    likedNames = ["Garnet", "Citrine", "Amethyst"],
    jewelryType = "ring",
  } = opts;

  await user.click(screen.getByRole("button", { name: "เริ่มทำแบบทดสอบ" }));

  await user.click(screen.getByRole("button", { name: optionLabel("birth_day", birthDay) }));
  await user.click(screen.getByRole("button", { name: "ถัดไป" }));

  await user.click(screen.getByRole("button", { name: optionLabel("intention", intention) }));
  await user.click(screen.getByRole("button", { name: "ถัดไป" }));

  await user.click(screen.getByRole("button", { name: optionLabel("feeling", feeling) }));
  await user.click(screen.getByRole("button", { name: "ถัดไป" }));

  for (const name of likedNames) {
    await user.click(screen.getByRole("button", { name: new RegExp(name) }));
  }
  await user.click(screen.getByRole("button", { name: "ถัดไป" }));

  await user.click(screen.getByRole("button", { name: optionLabel("jewelry_type", jewelryType) }));
  await user.click(screen.getByRole("button", { name: "ถัดไป" }));

  await screen.findByRole("heading", { name: "ทำไมถึงเหมาะกับคุณวันนี้?" }, { timeout: RESULT_TIMEOUT });
}

describe("GemQuizClient", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("แสดงจอ landing ก่อนเสมอ แล้วไปคำถามแรกเมื่อกดเริ่ม", async () => {
    const user = userEvent.setup();
    renderQuiz();
    expect(screen.getByRole("heading", { name: /DAILY/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "เริ่มทำแบบทดสอบ" }));
    expect(screen.getByRole("heading", { name: question("birth_day").labelTh })).toBeInTheDocument();
  });

  it("ปุ่มถัดไปของ Q1 disable จนกว่าจะเลือกคำตอบ", async () => {
    const user = userEvent.setup();
    renderQuiz();
    await user.click(screen.getByRole("button", { name: "เริ่มทำแบบทดสอบ" }));

    expect(screen.getByRole("button", { name: "ถัดไป" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: optionLabel("birth_day", "sun") }));
    expect(screen.getByRole("button", { name: "ถัดไป" })).toBeEnabled();
  });

  it("ปุ่มย้อนกลับจาก Q1 กลับไปที่ landing ได้", async () => {
    const user = userEvent.setup();
    renderQuiz();
    await user.click(screen.getByRole("button", { name: "เริ่มทำแบบทดสอบ" }));
    await user.click(screen.getByRole("button", { name: "ย้อนกลับ" }));
    expect(screen.getByRole("heading", { name: /DAILY/ })).toBeInTheDocument();
  });

  it(`Q4 เลือกพลอยที่ชอบได้ไม่เกิน ${MAX_LIKED_STONES} ตัว — ตัวถัดไปถูก disable ทันที`, async () => {
    const user = userEvent.setup();
    renderQuiz();
    await user.click(screen.getByRole("button", { name: "เริ่มทำแบบทดสอบ" }));
    await user.click(screen.getByRole("button", { name: optionLabel("birth_day", "sun") }));
    await user.click(screen.getByRole("button", { name: "ถัดไป" }));
    await user.click(screen.getByRole("button", { name: optionLabel("intention", "career") }));
    await user.click(screen.getByRole("button", { name: "ถัดไป" }));
    await user.click(screen.getByRole("button", { name: optionLabel("feeling", "energy") }));
    await user.click(screen.getByRole("button", { name: "ถัดไป" }));

    // เลือก MAX_LIKED_STONES ตัวแรกตาม config order (ไม่สนใจลำดับที่ถูกสุ่ม)
    const toPick = GEM_QUIZ_STONES.slice(0, MAX_LIKED_STONES);
    for (const stone of toPick) {
      await user.click(screen.getByRole("button", { name: new RegExp(stone.nameEn) }));
    }
    const remaining = GEM_QUIZ_STONES.slice(MAX_LIKED_STONES);
    for (const stone of remaining) {
      expect(screen.getByRole("button", { name: new RegExp(stone.nameEn) })).toBeDisabled();
    }

    // ติ๊กออกตัวหนึ่ง -> ตัวที่เหลือต้องกลับมากดได้ (ไม่ใช่ล็อกค้าง)
    await user.click(screen.getByRole("button", { name: new RegExp(toPick[0].nameEn) }));
    for (const stone of remaining) {
      expect(screen.getByRole("button", { name: new RegExp(stone.nameEn) })).not.toBeDisabled();
    }
  });

  it("เดินจนถึงหน้าผลลัพธ์ตรงกับ oracle demo — garnet rank1, alternatives = citrine/blue topaz", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    renderQuiz();
    await completeQuizToResult(user);

    expect(screen.getByRole("heading", { name: "GARNET" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Citrine/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Blue Topaz/ })).toBeInTheDocument();
    expect(screen.getByText("Power + Abundance")).toBeInTheDocument();
  }, 10000);

  it("ทำครั้งแรก (ไม่มีธงใน localStorage) — ส่ง retake:false แล้ว set ธงเฉพาะตอนได้ 204", async () => {
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
    expect(body.retake).toBe(false);
    expect(body.v).toBe(QUIZ_VERSION);
    expect(body.token).toBe("test-token");
    expect(body.liked).toEqual(["garnet", "citrine", "amethyst"]);
    expect(body.answers).toEqual({ birth_day: "sun", intention: "career", feeling: "energy", jewelry_type: "ring" });

    await waitFor(() => expect(window.localStorage.getItem(DONE_KEY)).toBe("1"));
  }, 10000);

  it("🔴 response ไม่ใช่ 204 (เช่น 400 ข้อมูลไม่ถูกต้อง) — ห้าม set ธงว่าทำแล้ว", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    renderQuiz();
    await completeQuizToResult(user);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    // ให้ event loop ไหลผ่าน .then() ของ fetch ก่อนเช็ค — กันเช็คเร็วเกินไป
    await new Promise((r) => setTimeout(r, 50));
    expect(window.localStorage.getItem(DONE_KEY)).toBeNull();
  }, 10000);

  it("ทำซ้ำ (retake) จริง — ส่ง retake:true เมื่อ localStorage มีธงจากครั้งก่อนอยู่แล้ว", async () => {
    window.localStorage.setItem(DONE_KEY, "1");
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    renderQuiz();
    await completeQuizToResult(user);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.retake).toBe(true);
  }, 10000);

  it("fetch ล้ม (เน็ตหลุด) — ไม่ throw ออกมาให้ test fail และหน้าผลลัพธ์ยังอยู่ปกติ (N-4)", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    renderQuiz();
    await completeQuizToResult(user);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("heading", { name: "GARNET" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(window.localStorage.getItem(DONE_KEY)).toBeNull();
  }, 10000);

  it("localStorage ถูกบล็อก (in-app browser, N-2) — ไม่ throw ตอน mount/submit และยังทำแบบทดสอบได้ปกติ", async () => {
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
  }, 10000);

  it("แตะพลอยทางเลือกในหน้าผลลัพธ์ — สลับ hero โดยไม่ยิง submit ซ้ำ", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    renderQuiz();
    await completeQuizToResult(user);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: /Citrine/ }));
    expect(screen.getByRole("heading", { name: "CITRINE" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /กลับไปที่พลอยแนะนำอันดับ 1/ })).toBeInTheDocument();

    // สลับ hero ไม่ใช่การตอบคำถามใหม่ — ไม่ยิง submit เพิ่ม
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: /กลับไปที่พลอยแนะนำอันดับ 1/ }));
    expect(screen.getByRole("heading", { name: "GARNET" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  }, 10000);

  it("กด 'ทำแบบทดสอบใหม่' แล้วทำรอบสองได้ และยิง submit รอบสองด้วย retake:true (รอบแรกสำเร็จแล้ว)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    renderQuiz();
    await completeQuizToResult(user);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(window.localStorage.getItem(DONE_KEY)).toBe("1"));

    await user.click(screen.getByRole("button", { name: "ทำแบบทดสอบใหม่" }));
    expect(screen.getByRole("heading", { name: /DAILY/ })).toBeInTheDocument();

    await completeQuizToResult(user, { intention: "love", likedNames: ["Peridot"] });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const secondBody = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
    expect(secondBody.retake).toBe(true);
    expect(secondBody.liked).toEqual(["peridot"]);
  }, 15000);

  it("honeypot field ซ่อนจากคนจริงแต่ mount อยู่เสมอทุกจอ (L3)", async () => {
    const user = userEvent.setup();
    renderQuiz();
    expect(document.querySelector('input[name="hp"]')).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "เริ่มทำแบบทดสอบ" }));
    const hp = document.querySelector('input[name="hp"]');
    expect(hp).toBeInTheDocument();
    expect(hp).toHaveAttribute("aria-hidden", "true");
    expect(hp).toHaveAttribute("tabindex", "-1");
  });
});
