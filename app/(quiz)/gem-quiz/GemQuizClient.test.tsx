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

  // --- QA เพิ่มเติม (R2-D2) — เคสที่ Tech Lead ยังไม่ได้กดเอง ---

  it("ย้อนกลับ (ปุ่มในแอป) จาก Q3 กลับไป Q2 แล้ว Q1 — คำตอบที่เลือกไว้ต้องยังอยู่ ไม่ถูกเคลียร์", async () => {
    const user = userEvent.setup();
    renderQuiz();
    await user.click(screen.getByRole("button", { name: "เริ่มทำแบบทดสอบ" }));

    await user.click(screen.getByRole("button", { name: optionLabel("birth_day", "mon") }));
    await user.click(screen.getByRole("button", { name: "ถัดไป" }));
    await user.click(screen.getByRole("button", { name: optionLabel("intention", "wealth") }));
    await user.click(screen.getByRole("button", { name: "ถัดไป" }));
    // อยู่ที่ Q3 แล้ว ยังไม่เลือกอะไร
    expect(screen.getByRole("heading", { name: question("feeling").labelTh })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "ย้อนกลับ" })); // Q3 -> Q2
    expect(screen.getByRole("button", { name: optionLabel("intention", "wealth") })).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    await user.click(screen.getByRole("button", { name: "ย้อนกลับ" })); // Q2 -> Q1
    expect(screen.getByRole("button", { name: optionLabel("birth_day", "mon") })).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    // เดินหน้าใหม่อีกครั้ง — ปุ่มถัดไปต้อง enabled ทันทีเพราะคำตอบเดิมยังอยู่ ไม่ต้องเลือกใหม่
    await user.click(screen.getByRole("button", { name: "ถัดไป" })); // Q1 -> Q2
    expect(screen.getByRole("button", { name: optionLabel("intention", "wealth") })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("button", { name: "ถัดไป" })).toBeEnabled();
  });

  it("Q4: เลือก A,B,C แล้วยกเลิก A (toggle off) — B,C ต้องเลื่อนอันดับเป็น 1,2 ไม่ใช่ค้างที่ 2,3", async () => {
    const user = userEvent.setup();
    renderQuiz();
    await user.click(screen.getByRole("button", { name: "เริ่มทำแบบทดสอบ" }));
    await user.click(screen.getByRole("button", { name: optionLabel("birth_day", "sun") }));
    await user.click(screen.getByRole("button", { name: "ถัดไป" }));
    await user.click(screen.getByRole("button", { name: optionLabel("intention", "career") }));
    await user.click(screen.getByRole("button", { name: "ถัดไป" }));
    await user.click(screen.getByRole("button", { name: optionLabel("feeling", "energy") }));
    await user.click(screen.getByRole("button", { name: "ถัดไป" }));

    const [stoneA, stoneB, stoneC] = GEM_QUIZ_STONES.slice(0, 3);
    await user.click(screen.getByRole("button", { name: new RegExp(stoneA.nameEn) }));
    await user.click(screen.getByRole("button", { name: new RegExp(stoneB.nameEn) }));
    await user.click(screen.getByRole("button", { name: new RegExp(stoneC.nameEn) }));

    // ก่อนยกเลิก: A=1, B=2, C=3 (rank badge คือ aria-hidden span มีตัวเลข — เช็คผ่านข้อความในปุ่มทั้งก้อน)
    expect(screen.getByRole("button", { name: new RegExp(stoneA.nameEn) }).textContent).toContain("1");
    expect(screen.getByRole("button", { name: new RegExp(stoneB.nameEn) }).textContent).toContain("2");
    expect(screen.getByRole("button", { name: new RegExp(stoneC.nameEn) }).textContent).toContain("3");

    await user.click(screen.getByRole("button", { name: new RegExp(stoneA.nameEn) })); // toggle off A

    expect(screen.getByRole("button", { name: new RegExp(stoneA.nameEn) })).toHaveAttribute("aria-pressed", "false");
    // B ต้องเลื่อนมาเป็นอันดับ 1 (ไม่ใช่ค้างที่ 2) และ C ต้องเป็นอันดับ 2 (ไม่ใช่ค้างที่ 3)
    expect(screen.getByRole("button", { name: new RegExp(stoneB.nameEn) }).textContent).toContain("1");
    expect(screen.getByRole("button", { name: new RegExp(stoneB.nameEn) }).textContent).not.toContain("2");
    expect(screen.getByRole("button", { name: new RegExp(stoneC.nameEn) }).textContent).toContain("2");
    expect(screen.getByRole("button", { name: new RegExp(stoneC.nameEn) }).textContent).not.toContain("3");
  });

  it("Q4: เลือกพลอยแค่ 1 ตัว (ขั้นต่ำ MIN_LIKED_STONES=1) — ปุ่มถัดไปต้อง enabled และไปต่อได้ปกติ", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    renderQuiz();
    await user.click(screen.getByRole("button", { name: "เริ่มทำแบบทดสอบ" }));
    await user.click(screen.getByRole("button", { name: optionLabel("birth_day", "sun") }));
    await user.click(screen.getByRole("button", { name: "ถัดไป" }));
    await user.click(screen.getByRole("button", { name: optionLabel("intention", "career") }));
    await user.click(screen.getByRole("button", { name: "ถัดไป" }));
    await user.click(screen.getByRole("button", { name: optionLabel("feeling", "energy") }));
    await user.click(screen.getByRole("button", { name: "ถัดไป" }));

    expect(screen.getByRole("button", { name: "ถัดไป" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: new RegExp(GEM_QUIZ_STONES[0].nameEn) }));
    expect(screen.getByRole("button", { name: "ถัดไป" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "ถัดไป" }));
    await user.click(screen.getByRole("button", { name: optionLabel("jewelry_type", "ring") }));
    await user.click(screen.getByRole("button", { name: "ถัดไป" }));

    await screen.findByRole("heading", { name: "ทำไมถึงเหมาะกับคุณวันนี้?" }, { timeout: RESULT_TIMEOUT });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.liked).toEqual([GEM_QUIZ_STONES[0].code]);
  }, 10000);

  it("รีเฟรชหน้ากลางคำถาม (remount ใหม่) — กลับไป landing เสมอ ไม่มี state persist ข้าม reload (ตามดีไซน์ ไม่เก็บ progress)", async () => {
    const user = userEvent.setup();
    const { unmount } = renderQuiz();
    await user.click(screen.getByRole("button", { name: "เริ่มทำแบบทดสอบ" }));
    await user.click(screen.getByRole("button", { name: optionLabel("birth_day", "sun") }));
    await user.click(screen.getByRole("button", { name: "ถัดไป" }));
    expect(screen.getByRole("heading", { name: question("intention").labelTh })).toBeInTheDocument();

    // จำลอง full page reload: unmount (ไม่มี sessionStorage/pushState เก็บ state อยู่ในโค้ดปัจจุบัน) แล้ว render ใหม่
    unmount();
    renderQuiz();
    expect(screen.getByRole("heading", { name: /DAILY/ })).toBeInTheDocument();
  });

  it("เข้า /gem-quiz ซ้ำหลังทำสำเร็จไปแล้ว (localStorage มีธง gemQuizDone) — เริ่มที่ landing ปกติ ไม่ auto-redirect ไม่ถูกบล็อก", async () => {
    window.localStorage.setItem(DONE_KEY, "1");
    renderQuiz();
    // ต้องเห็น landing ตามปกติ (ไม่ redirect ไปหน้าอื่น ไม่มีข้อความบล็อก "ทำไปแล้ว")
    expect(screen.getByRole("heading", { name: /DAILY/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "เริ่มทำแบบทดสอบ" })).toBeEnabled();
  });

  it("ไม่มี history.pushState ระหว่างเปลี่ยนคำถาม — ปุ่มย้อนกลับของเบราว์เซอร์จะไม่ย้อนคำถามในแอป (behavior ที่ยังไม่ implement ตาม design doc O9 ไม่บล็อก prod) — ยืนยันว่าไม่ throw/ไม่พังถ้ามี popstate ลอยมาเฉยๆ ระหว่างทำแบบทดสอบ",
    async () => {
      const pushStateSpy = vi.spyOn(window.history, "pushState");
      const user = userEvent.setup();
      renderQuiz();
      await user.click(screen.getByRole("button", { name: "เริ่มทำแบบทดสอบ" }));
      await user.click(screen.getByRole("button", { name: optionLabel("birth_day", "sun") }));
      await user.click(screen.getByRole("button", { name: "ถัดไป" }));

      // ยืนยันข้อสังเกต: โค้ดปัจจุบันไม่เรียก pushState เลย -> ไม่มี history entry ต่อคำถาม
      expect(pushStateSpy).not.toHaveBeenCalled();

      // จำลอง popstate ลอยมา (เช่นผู้ใช้กดย้อนกลับเบราว์เซอร์จริง) — ต้องไม่ throw/ไม่พังหน้า
      expect(() => window.dispatchEvent(new PopStateEvent("popstate"))).not.toThrow();
      expect(screen.getByRole("heading", { name: question("intention").labelTh })).toBeInTheDocument();
    }
  );

  it("Accessibility: Tab ไล่ทีละปุ่มได้ครบ Landing -> Q1 โดยไม่ใช้เมาส์เลย และกด Enter ทำงานเหมือนคลิก", async () => {
    const user = userEvent.setup();
    renderQuiz();

    await user.tab(); // honeypot (tabIndex=-1 ต้องถูกข้าม) -> ปุ่มเริ่มทำแบบทดสอบ
    expect(screen.getByRole("button", { name: "เริ่มทำแบบทดสอบ" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("heading", { name: question("birth_day").labelTh })).toBeInTheDocument();

    // ไล่ Tab จนถึงตัวเลือกแรกของ Q1 แล้วกด Space เพื่อเลือก (ปุ่มตัวแรกของจอคือ "ย้อนกลับ")
    await user.tab(); // ปุ่มย้อนกลับ (header)
    await user.tab(); // ตัวเลือกวันเกิดตัวแรก (sun)
    const firstOption = screen.getByRole("button", { name: optionLabel("birth_day", "sun") });
    expect(firstOption).toHaveFocus();
    expect(firstOption).toHaveAttribute("aria-pressed", "false");

    await user.keyboard(" ");
    expect(firstOption).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "ถัดไป" })).toBeEnabled();
  });

  it("aria-pressed ของตัวเลือก Q2 (grid) สลับถูกต้องตาม state จริง ไม่ใช่แค่สายตา", async () => {
    const user = userEvent.setup();
    renderQuiz();
    await user.click(screen.getByRole("button", { name: "เริ่มทำแบบทดสอบ" }));
    await user.click(screen.getByRole("button", { name: optionLabel("birth_day", "sun") }));
    await user.click(screen.getByRole("button", { name: "ถัดไป" }));

    const loveBtn = screen.getByRole("button", { name: optionLabel("intention", "love") });
    const wealthBtn = screen.getByRole("button", { name: optionLabel("intention", "wealth") });
    expect(loveBtn).toHaveAttribute("aria-pressed", "false");
    expect(wealthBtn).toHaveAttribute("aria-pressed", "false");

    await user.click(loveBtn);
    expect(loveBtn).toHaveAttribute("aria-pressed", "true");
    expect(wealthBtn).toHaveAttribute("aria-pressed", "false");

    // single-select: เลือกตัวอื่นแทน -> ตัวเดิมต้องกลับเป็น false (ไม่ใช่ multi-select ค้าง)
    await user.click(wealthBtn);
    expect(wealthBtn).toHaveAttribute("aria-pressed", "true");
    expect(loveBtn).toHaveAttribute("aria-pressed", "false");
  });
});
