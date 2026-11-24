// @vitest-environment jsdom
// ux-tools-navigation §4/§5/§11 — gem-quiz: ทุกจอ = 1 history entry · ถอยทีละจอ · guard รีโหลด · Loading replace · restart · สถิติไม่ส่งซ้ำ · ถามก่อนออก
//   N1 · N5 · N6 · N7 · N8 · N9 · N10 (ตามมติ TL: ถอยไปแก้แล้วดูผลใหม่ = ไม่ส่งซ้ำ · ทำแบบทดสอบใหม่ = รอบใหม่ retake=true)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { GEM_QUIZ_QUESTIONS } from "@/lib/gem-quiz/config";
import { GemQuizClient } from "./GemQuizClient";

const RESULT_TIMEOUT = 3500;
type U = ReturnType<typeof userEvent.setup>;

const label = (q: string, o: string) => {
  const opt = GEM_QUIZ_QUESTIONS.find((x) => x.code === q)?.options.find((x) => x.code === o);
  if (!opt) throw new Error(`ไม่พบ ${q}.${o}`);
  return opt.labelTh;
};
const qTitle = (q: string) => GEM_QUIZ_QUESTIONS.find((x) => x.code === q)!.labelTh;
const btn = (name: string | RegExp) => screen.getByRole("button", { name });
const next = (u: U) => u.click(btn("ถัดไป"));

async function start(u: U) {
  await u.click(btn("เริ่มทำแบบทดสอบ"));
}
async function answerQ1(u: U, v = "sun") {
  await u.click(btn(label("birth_day", v)));
  await next(u);
}
async function answerQ2(u: U, v = "career") {
  await u.click(btn(label("intention", v)));
  await next(u);
}
async function answerQ3(u: U, v = "energy") {
  await u.click(btn(label("feeling", v)));
  await next(u);
}
async function answerQ4(u: U) {
  await u.click(btn(/Garnet/));
  await next(u);
}
async function answerQ5(u: U, v = "ring") {
  await u.click(btn(label("jewelry_type", v)));
  await next(u); // → loading → result (replace)
}
async function toResult(u: U) {
  await start(u);
  await answerQ1(u);
  await answerQ2(u);
  await answerQ3(u);
  await answerQ4(u);
  await answerQ5(u);
  await screen.findByRole("heading", { name: "ทำไมถึงเหมาะกับคุณวันนี้?" }, { timeout: RESULT_TIMEOUT });
}

/** document-level: บันทึกว่าคลิกลิงก์ถูก preventDefault โดยคอมโพเนนต์หรือไม่ (แล้วกัน jsdom navigation เอง) */
let linkClicks: boolean[] = [];
const onDocClick = (e: MouseEvent) => {
  if ((e.target as HTMLElement | null)?.closest("a")) {
    linkClicks.push(e.defaultPrevented);
    e.preventDefault();
  }
};

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "");
  linkClicks = [];
  document.addEventListener("click", onDocClick);
  vi.restoreAllMocks();
});
afterEach(() => {
  document.removeEventListener("click", onDocClick);
  cleanup();
  vi.unstubAllGlobals();
});

const gqState = () => window.history.state as { gq?: string; i?: number; __NA?: boolean } | null;

describe("history: ลำดับ entry (N7 · N9)", () => {
  it("Landing(0) → Q1..Q5 push ทีละ entry · Loading push แล้ว Result ใช้ replaceState (ไม่เหลือ entry ของ Loading)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    const push = vi.spyOn(window.history, "pushState");
    const replace = vi.spyOn(window.history, "replaceState");
    const u = userEvent.setup();
    render(<GemQuizClient token="t" />);
    expect(gqState()).toMatchObject({ gq: "landing", i: 0 });

    await toResult(u);

    expect(push.mock.calls.map((c) => (c[0] as { gq: string; i: number }).gq)).toEqual(["q1", "q2", "q3", "q4", "q5", "loading"]);
    expect(push.mock.calls.map((c) => (c[0] as { i: number }).i)).toEqual([1, 2, 3, 4, 5, 6]);
    // ครั้งสุดท้ายของ replace = Loading → Result ที่ entry เดิม (i = 6) · ไม่มี push ของ result
    const last = replace.mock.calls.at(-1)![0] as { gq: string; i: number };
    expect(last).toMatchObject({ gq: "result", i: 6 });
    expect(push.mock.calls.some((c) => (c[0] as { gq: string }).gq === "result")).toBe(false);
    expect(gqState()).toMatchObject({ gq: "result", i: 6 });
  });

  it("N9: history.state เดิม (__NA ของ Next) ไม่ถูกเขียนทับ — ยังอยู่หลัง push/replace ทุกครั้ง", async () => {
    window.history.replaceState({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: ["t"] }, "");
    const u = userEvent.setup();
    render(<GemQuizClient token="t" />);
    expect(gqState()?.__NA).toBe(true); // replace ตอน mount
    await start(u);
    await answerQ1(u);
    expect(gqState()).toMatchObject({ __NA: true, gq: "q2", i: 2 });
    expect((window.history.state as Record<string, unknown>).__PRIVATE_NEXTJS_INTERNALS_TREE).toEqual(["t"]);
  });
});

describe("ปุ่มถอยบนจอ + Back ของเครื่อง", () => {
  it("Q3 → ถอยทีละจอ Q2 → Q1 → Landing โดยคำตอบไม่หาย (history.back จริง)", async () => {
    const u = userEvent.setup();
    render(<GemQuizClient token="t" />);
    await start(u);
    await answerQ1(u);
    await answerQ2(u);
    expect(screen.getByRole("heading", { name: qTitle("feeling") })).toBeInTheDocument();

    await u.click(btn("ย้อนกลับ"));
    expect(await screen.findByRole("heading", { name: qTitle("intention") })).toBeInTheDocument();
    expect(btn(label("intention", "career"))).toHaveAttribute("aria-pressed", "true"); // คำตอบค้าง
    expect(gqState()).toMatchObject({ gq: "q2", i: 2 });

    await u.click(btn("ย้อนกลับ"));
    expect(await screen.findByRole("heading", { name: qTitle("birth_day") })).toBeInTheDocument();
    expect(btn(label("birth_day", "sun"))).toHaveAttribute("aria-pressed", "true");

    await u.click(btn("ย้อนกลับ"));
    expect(await screen.findByRole("heading", { name: /DAILY/ })).toBeInTheDocument();
  });

  it("Back ของเครื่อง (popstate จริง) ถอยทีละจอเหมือนปุ่มบนจอ · Forward กลับมาได้", async () => {
    const u = userEvent.setup();
    render(<GemQuizClient token="t" />);
    await start(u);
    await answerQ1(u);
    await act(async () => {
      window.history.back();
    });
    expect(await screen.findByRole("heading", { name: qTitle("birth_day") })).toBeInTheDocument();
    await act(async () => {
      window.history.forward();
    });
    expect(await screen.findByRole("heading", { name: qTitle("intention") })).toBeInTheDocument();
  });

  it("กดถอยรัวก่อน popstate มา → history.back() ถูกเรียกครั้งเดียว (กันหลุดหน้า)", async () => {
    const u = userEvent.setup();
    render(<GemQuizClient token="t" />);
    await start(u);
    await answerQ1(u);
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    const b = btn("ย้อนกลับ");
    fireEvent.click(b);
    fireEvent.click(b);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("N1: entry ก่อนหน้าไม่ใช่จอปลายทาง (เช่น รีโหลดกลางทาง) → ไม่เรียก history.back() · pushState ไปปลายทางแทน", async () => {
    const u = userEvent.setup();
    render(<GemQuizClient token="t" />);
    await start(u);
    await answerQ1(u); // Q2 (i=2)
    // จำลอง: เบราว์เซอร์พาไป entry ที่ index 5 ซึ่งเป็น Q1 แต่ entry ก่อนหน้า (4) ไม่รู้จักในสแตก
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: { gq: "q1", i: 5 } }));
    });
    expect(screen.getByRole("heading", { name: qTitle("birth_day") })).toBeInTheDocument();
    const back = vi.spyOn(window.history, "back");
    const push = vi.spyOn(window.history, "pushState");
    await u.click(btn("ย้อนกลับ"));
    expect(back).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { name: /DAILY/ })).toBeInTheDocument(); // จอเปลี่ยนทันที ไม่รอ popstate
  });

  it("Landing ไม่มีปุ่มถอย (ขั้นแรก — มีแต่ลิงก์ hub ซ้ายบน)", () => {
    render(<GemQuizClient token="t" />);
    expect(screen.queryByRole("button", { name: "ย้อนกลับ" })).toBeNull();
    expect(screen.getByRole("link", { name: /เครื่องมือ 3J/ })).toHaveAttribute("href", "/");
  });

  it("history API พัง (pushState throw) → ปุ่มบนจอยังเดินได้ ไม่ throw (M9)", async () => {
    vi.spyOn(window.history, "pushState").mockImplementation(() => {
      throw new Error("blocked");
    });
    const u = userEvent.setup();
    render(<GemQuizClient token="t" />);
    await start(u);
    await answerQ1(u);
    expect(screen.getByRole("heading", { name: qTitle("intention") })).toBeInTheDocument();
    await u.click(btn("ย้อนกลับ")); // stack รู้ว่า entry ก่อนหน้า = q1 → ลอง back() (ไม่ throw) ; ถ้า popstate ไม่มา จอยังอยู่ — ไม่พังก็พอ
  });
});

describe("N8: guard popstate/รีโหลด — จอที่ไม่มีคำตอบรองรับ → Landing ไม่ค้างจอว่าง", () => {
  it.each(["q2", "q3", "q4", "q5", "loading", "result"])("popstate ไป %s โดยไม่มีคำตอบ → Landing + replaceState ที่ entry นั้น", (id) => {
    render(<GemQuizClient token="t" />);
    const replace = vi.spyOn(window.history, "replaceState");
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: { gq: id, i: 4 } }));
    });
    expect(screen.getByRole("heading", { name: /DAILY/ })).toBeInTheDocument();
    expect(replace).toHaveBeenCalled();
    expect((replace.mock.calls.at(-1)![0] as { gq: string; i: number })).toMatchObject({ gq: "landing", i: 4 });
  });

  it("รีโหลดกลางทาง: history.state ค้าง {gq:'q3', i:3} แต่คำตอบหาย → เริ่ม Landing (i คงเดิม) · กด Back ไป entry ที่ค้างก็ตก Landing", () => {
    window.history.replaceState({ gq: "q3", i: 3 }, "");
    render(<GemQuizClient token="t" />);
    expect(screen.getByRole("heading", { name: /DAILY/ })).toBeInTheDocument();
    expect(gqState()).toMatchObject({ gq: "landing", i: 3 });
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: { gq: "q2", i: 2 } }));
    });
    expect(screen.getByRole("heading", { name: /DAILY/ })).toBeInTheDocument();
  });

  it("ต้องไม่พัง: popstate ไป q1 (ไม่ต้องมีคำตอบ) เข้าได้ปกติ", async () => {
    const u = userEvent.setup();
    render(<GemQuizClient token="t" />);
    await start(u);
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: { gq: "q1", i: 1 } }));
    });
    expect(screen.getByRole("heading", { name: qTitle("birth_day") })).toBeInTheDocument();
  });
});

describe("Loading / Result / restart (N7)", () => {
  it("Back จาก Result → Q5 (ไม่เจอ Loading วน) · timer ไม่ยิงซ้ำ · Next จาก Q5 ดูผลใหม่ได้", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    const u = userEvent.setup();
    render(<GemQuizClient token="t" />);
    await toResult(u);

    await u.click(btn("ย้อนกลับ"));
    expect(await screen.findByRole("heading", { name: qTitle("jewelry_type") })).toBeInTheDocument();
    expect(btn(label("jewelry_type", "ring"))).toHaveAttribute("aria-pressed", "true");
    expect(gqState()).toMatchObject({ gq: "q5", i: 5 });
    await new Promise((r) => setTimeout(r, 1700)); // เกินเวลา loading — ต้องยังอยู่ Q5
    expect(screen.getByRole("heading", { name: qTitle("jewelry_type") })).toBeInTheDocument();

    await next(u);
    expect(await screen.findByRole("heading", { name: "ทำไมถึงเหมาะกับคุณวันนี้?" }, { timeout: RESULT_TIMEOUT })).toBeInTheDocument();
  }, 15000);

  it("Back ระหว่าง Loading → Q5 และ timer ถูกเคลียร์ (ไม่เด้งไปผลเอง)", async () => {
    const u = userEvent.setup();
    render(<GemQuizClient token="t" />);
    await start(u);
    await answerQ1(u);
    await answerQ2(u);
    await answerQ3(u);
    await answerQ4(u);
    await u.click(btn(label("jewelry_type", "ring")));
    await next(u); // → loading (push)
    expect(gqState()).toMatchObject({ gq: "loading", i: 6 });
    await act(async () => {
      window.history.back();
    });
    expect(await screen.findByRole("heading", { name: qTitle("jewelry_type") })).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 1700));
    expect(screen.getByRole("heading", { name: qTitle("jewelry_type") })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "ทำไมถึงเหมาะกับคุณวันนี้?" })).toBeNull();
  }, 15000);

  it("'ทำแบบทดสอบใหม่': ล้างคำตอบ + history.go(-i) กลับ entry แรก (ไม่ push Landing ใหม่) · จอเป็น Landing ทันที", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    const u = userEvent.setup();
    render(<GemQuizClient token="t" />);
    await toResult(u);
    const go = vi.spyOn(window.history, "go");
    const push = vi.spyOn(window.history, "pushState");
    await u.click(btn("ทำแบบทดสอบใหม่"));
    expect(go).toHaveBeenCalledWith(-6);
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: /DAILY/ })).toBeInTheDocument();
    await waitFor(() => expect(gqState()).toMatchObject({ gq: "landing", i: 0 }));
    // เริ่มใหม่ต้องเป็นคำตอบว่างจริง
    await start(u);
    expect(btn(label("birth_day", "sun"))).toHaveAttribute("aria-pressed", "false");
    expect(btn("ถัดไป")).toBeDisabled();
  }, 15000);

  it("กด 'เริ่ม' เร็วกว่า popstate ของ restart → ไม่ push (ไม่ถูกดึงกลับ Landing) · popstate มาแล้วเริ่มได้ปกติ", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    const u = userEvent.setup();
    render(<GemQuizClient token="t" />);
    await toResult(u);
    // go() ไม่ทำอะไร = จำลอง popstate ที่ยังมาไม่ถึง
    vi.spyOn(window.history, "go").mockImplementation(() => {});
    await u.click(btn("ทำแบบทดสอบใหม่"));
    const push = vi.spyOn(window.history, "pushState");
    fireEvent.click(btn("เริ่มทำแบบทดสอบ"));
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: /DAILY/ })).toBeInTheDocument();
    // popstate มาถึง → ปลดล็อก
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: { gq: "landing", i: 0 } }));
    });
    await start(u);
    expect(screen.getByRole("heading", { name: qTitle("birth_day") })).toBeInTheDocument();
    expect(push).toHaveBeenCalledTimes(1);
  }, 15000);

  it("Forward หลังเริ่มใหม่ (entry เก่ายังอยู่) → Landing ไม่ใช่จอผลของคำตอบที่ถูกล้าง", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    const u = userEvent.setup();
    render(<GemQuizClient token="t" />);
    await toResult(u);
    await u.click(btn("ทำแบบทดสอบใหม่"));
    await waitFor(() => expect(gqState()).toMatchObject({ gq: "landing", i: 0 }));
    await act(async () => {
      window.history.forward();
    });
    await waitFor(() => expect(screen.getByRole("heading", { name: /DAILY/ })).toBeInTheDocument());
    expect(screen.queryByRole("heading", { name: "ทำไมถึงเหมาะกับคุณวันนี้?" })).toBeNull();
  }, 15000);

  it("ผล: ซ้ายบนเป็น 'ย้อนกลับ' (ไม่ใช่ 'เริ่มใหม่') · ขวาบน 'เครื่องมือ 3J' · ท้ายหน้า 'กลับหน้าเครื่องมือ' · ปุ่ม 'ทำแบบทดสอบใหม่' มีตัวเดียว (Q3)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    const u = userEvent.setup();
    render(<GemQuizClient token="t" />);
    await toResult(u);
    expect(screen.queryByRole("button", { name: "เริ่มใหม่" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "ย้อนกลับ" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "ทำแบบทดสอบใหม่" })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "กลับหน้าเครื่องมือ 3J" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "กลับหน้าเครื่องมือ" })).toHaveAttribute("href", "/");
    // M2: ปุ่มหลักไป ring-builder ยังเป็น URL เดิม
    expect(screen.getByRole("link", { name: /ลองพลอยของคุณบนแหวน/ }).getAttribute("href")).toMatch(/^\/ring-builder\?t=[^&]+&i=/); // (byte-equal กับ buildShowcaseHref ล็อกที่ GemQuizClient.test.tsx)
    // N6: ผลไม่ถือเป็นงานค้าง — กดไป hub ไม่ถาม
    await u.click(screen.getByRole("link", { name: "กลับหน้าเครื่องมือ 3J" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(linkClicks.at(-1)).toBe(false);
  }, 15000);
});

describe("N10: สถิติ (submit) — ครั้งเดียวต่อรอบ", () => {
  const submitCalls = (f: ReturnType<typeof vi.fn>) => f.mock.calls.filter((c) => String(c[0]).includes("/api/gem-quiz/submit"));

  it("ถอยไป Q5 แล้วดูผลใหม่ด้วยคำตอบเดิม → ไม่ส่งซ้ำ · แก้คำตอบแล้วดูผลใหม่ → ก็ไม่ส่งซ้ำ (มติ TL Q5)", async () => {
    const f = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", f);
    const u = userEvent.setup();
    render(<GemQuizClient token="t" />);
    await toResult(u);
    expect(submitCalls(f)).toHaveLength(1);
    expect(JSON.parse(submitCalls(f)[0][1].body as string)).toMatchObject({ retake: false });

    // เดิม: ถอยแล้วกดถัดไปทันที
    await u.click(btn("ย้อนกลับ"));
    await screen.findByRole("heading", { name: qTitle("jewelry_type") });
    await next(u);
    await screen.findByRole("heading", { name: "ทำไมถึงเหมาะกับคุณวันนี้?" }, { timeout: RESULT_TIMEOUT });
    expect(submitCalls(f)).toHaveLength(1);

    // แก้คำตอบ (ring → necklace) แล้วดูผลใหม่
    await u.click(btn("ย้อนกลับ"));
    await screen.findByRole("heading", { name: qTitle("jewelry_type") });
    await u.click(btn(label("jewelry_type", "necklace")));
    await next(u);
    await screen.findByRole("heading", { name: "ทำไมถึงเหมาะกับคุณวันนี้?" }, { timeout: RESULT_TIMEOUT });
    expect(submitCalls(f)).toHaveLength(1);
  }, 30000);

  it("'ทำแบบทดสอบใหม่' = รอบใหม่จริง → ส่งอีกครั้งด้วย retake=true (พฤติกรรมเดิมไม่พัง)", async () => {
    const f = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", f);
    const u = userEvent.setup();
    render(<GemQuizClient token="t" />);
    await toResult(u);
    await u.click(btn("ทำแบบทดสอบใหม่"));
    await waitFor(() => expect(gqState()).toMatchObject({ gq: "landing", i: 0 }));
    await start(u);
    await answerQ1(u);
    await answerQ2(u);
    await answerQ3(u);
    await answerQ4(u);
    await answerQ5(u);
    await screen.findByRole("heading", { name: "ทำไมถึงเหมาะกับคุณวันนี้?" }, { timeout: RESULT_TIMEOUT });
    expect(submitCalls(f)).toHaveLength(2);
    expect(JSON.parse(submitCalls(f)[1][1].body as string)).toMatchObject({ retake: true });
  }, 30000);
});

describe("ถามก่อนออก (N5 · N6): เฉพาะมีคำตอบ ≥ 2 บนจอคำถาม", () => {
  const hub = () => screen.getByRole("link", { name: "กลับหน้าเครื่องมือ 3J" });

  it("N6: Landing · Q1 (0 คำตอบ) · Q2 (1 คำตอบ) กดแล้วไม่ถาม — ลิงก์ปกติ", async () => {
    const u = userEvent.setup();
    render(<GemQuizClient token="t" />);
    await u.click(screen.getByRole("link", { name: /เครื่องมือ 3J/ })); // landing
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(linkClicks.at(-1)).toBe(false);

    await start(u);
    await u.click(hub()); // Q1
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(linkClicks.at(-1)).toBe(false);

    await answerQ1(u);
    await u.click(hub()); // Q2 · 1 คำตอบ
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(linkClicks.at(-1)).toBe(false);
  });

  it("N5: Q3 (2 คำตอบ) → ถาม · 'อยู่ต่อ' = กลับ Q3 คำตอบไม่หาย โฟกัสกลับที่ลิงก์ · Esc ก็เหมือนกัน", async () => {
    const u = userEvent.setup();
    render(<GemQuizClient token="t" />);
    await start(u);
    await answerQ1(u);
    await answerQ2(u);
    await u.click(hub());
    expect(linkClicks.at(-1)).toBe(true);
    expect(screen.getByRole("alertdialog")).toHaveTextContent("ออกจากขั้นตอนนี้?");
    expect(screen.getByRole("alertdialog")).toHaveTextContent("คำตอบที่เลือกไว้จะหายไป");
    expect(screen.getByRole("button", { name: "อยู่ต่อ" })).toHaveFocus();

    await u.click(screen.getByRole("button", { name: "อยู่ต่อ" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("heading", { name: qTitle("feeling") })).toBeInTheDocument();
    await waitFor(() => expect(hub()).toHaveFocus());

    await u.click(hub());
    await u.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("heading", { name: qTitle("feeling") })).toBeInTheDocument();
  });

  it("Q4 (3 คำตอบ) · Q5 (4–5 คำตอบ) ถาม · ถอยกลับไป Q1 พร้อมคำตอบ 5 ข้อ ก็ยังถาม (นับจากงานที่ค้างจริง ไม่ใช่ตำแหน่งจอ)", async () => {
    const u = userEvent.setup();
    render(<GemQuizClient token="t" />);
    await start(u);
    await answerQ1(u);
    await answerQ2(u);
    await answerQ3(u); // Q4
    await u.click(hub());
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "อยู่ต่อ" }));
    await answerQ4(u); // Q5
    await waitFor(() => expect(screen.getByRole("heading", { name: qTitle("jewelry_type") })).toBeInTheDocument());
    await u.click(hub());
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "อยู่ต่อ" }));

    // ถอยถึง Q1: Q5 → Q4 (เลือกพลอย) → Q3 → Q2 → Q1
    await u.click(btn("ย้อนกลับ"));
    expect(await screen.findByRole("heading", { name: "พลอยไหนดึงดูดคุณที่สุด?" })).toBeInTheDocument();
    for (const t of ["feeling", "intention", "birth_day"]) {
      await u.click(btn("ย้อนกลับ"));
      expect(await screen.findByRole("heading", { name: qTitle(t) })).toBeInTheDocument();
    }
    await u.click(hub());
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("ถอยขั้น (ปุ่มบนจอ) ไม่ถามเลย แม้มีคำตอบ", async () => {
    const u = userEvent.setup();
    render(<GemQuizClient token="t" />);
    await start(u);
    await answerQ1(u);
    await answerQ2(u);
    await u.click(btn("ย้อนกลับ"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
