// @vitest-environment jsdom
// components/domain/marketing/RingSizeStats.qa.test.tsx — QA อิสระ (qa/ring-size-p3): state · กติกาตัวเลขบนจอ · ถ้อยคำ · ค่าภายนอก
//
// ต่างจาก RingSizeStats.test.tsx ของ dev: ข้อมูลเข้าผ่าน parseRingSizeStats (รูปร่างตาม SQL จริง) ไม่ใช่ object ที่ประกอบมือ ·
// กวาดข้อความที่ render จริงหาคำต้องห้าม/NaN/ค่า 45·68 ที่ hardcode/ลิงก์ภายนอก ทุก state · ขอบ 29 vs 30 ต่อเซลล์ · ปุ่มนำทางต้องให้ URL ที่ผ่านด่าน
// (ตัวเลขทั้งหมดเป็นข้อมูลวางโครง ไม่ใช่ข้อมูลจริง · ช่วงเบอร์ร้านในเทสต์ = 50–60 ตั้งใจให้ต่างจาก 45–68 เพื่อจับ hardcode)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { MARKETING_NAV } from "@/lib/marketing/nav";
import { checkRingStatsRange, parseRingSizeFilters, type RingSizeFilters } from "@/lib/marketing/ring-size-filters";
import { parseRingSizeStats } from "@/lib/marketing/ring-size-stats";

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock, refresh: refreshMock }) }));

import { RingSizeStats } from "./RingSizeStats";

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

const TODAY = "2026-11-03";
const DAY = 86_400_000;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const F30: RingSizeFilters = { from: addDays(TODAY, -29), to: TODAY, range: "30d" };

const BANNED = /PDPA|ปลอดภัยตามกฎหมาย|session|RPC|migration|\bstage\b|\bG[1-5]\b/i;
const BAD = /NaN|Infinity|undefined|\bnull\b|\[object/;

type Raw = Record<string, any>;

/** payload รูปร่างเดียวกับที่ SQL ประกอบ (0193 ส่วน 5) · consistent: funnel/abandon_at หักกัน · ค่า default ไม่มี 45/68 เป็นเบอร์ร้าน */
function raw(o: Raw = {}): Raw {
  const sessions = o.sessions ?? 412;
  return {
    sessions,
    returning: 60,
    measured: 187,
    shop_range: { min: 50, max: 60 },
    data_since: addDays(TODAY, -40),
    by_in_app: { line: 150, tiktok: 30, fb: 70, ig: 2, browser: 140, unknown: 20 },
    funnel: [412, 332, 312, 287, 269, 259, 245, 215],
    abandon_at: [80, 20, 25, 18, 10, 14, 30],
    result_sizes: [
      { size: 54, count: 31 },
      { size: 55, count: 24 },
      { size: 53, count: 22 },
      { size: 48, count: 3 },
      { size: 63, count: 4 },
      { size: 50, count: 1 },
    ],
    size_summary: { below_range: 3, in_range: 180, above_range: 4, between_count: 21 },
    circ_hist: [{ mm: 52, count: 4 }],
    method: { A: 120, B: 73 },
    method_stats: {
      A: { picked: 125, measured: 98, abandoned_at_measure: 12, invalid_sessions: 5, remeasured: 14, between: null },
      B: { picked: 80, measured: 55, abandoned_at_measure: 9, invalid_sessions: 8, remeasured: 17, between: 21 },
    },
    switched: { a_to_b: 4, b_to_a: 9, both: 13 },
    saw_between: 21,
    ref: { card: 78, coin: 115 },
    method_x_ref: { A_card: 50, A_coin: 70, B_card: 28, B_coin: 47 },
    cta: { line: 41, share: 12, shop: 9, gem_quiz: 7 },
    friction: { zoom_blocked: 40, calib_warn: 22, invalid: 13, stale_recalib: 9, remeasured: 31 },
    daily: daily(30),
    ...o,
    ...(o.sessions === undefined ? {} : { sessions }),
  };
}

function daily(n: number, f: (i: number) => [number, number] = (i) => [(i % 5) + 1, i % 3]) {
  return Array.from({ length: n }, (_, k) => {
    const [s, m] = f(k);
    return { date: addDays(TODAY, -(n - 1 - k)), sessions: s, measured: m };
  });
}

const EMPTY_RAW: Raw = {
  sessions: 0,
  returning: 0,
  measured: 0,
  data_since: null,
  by_in_app: { line: 0, tiktok: 0, fb: 0, ig: 0, browser: 0, unknown: 0 },
  funnel: [0, 0, 0, 0, 0, 0, 0, 0],
  abandon_at: [0, 0, 0, 0, 0, 0, 0],
  result_sizes: [],
  size_summary: { below_range: 0, in_range: 0, above_range: 0, between_count: 0 },
  circ_hist: [],
  method: { A: 0, B: 0 },
  method_stats: {
    A: { picked: 0, measured: 0, abandoned_at_measure: 0, invalid_sessions: 0, remeasured: 0, between: null },
    B: { picked: 0, measured: 0, abandoned_at_measure: 0, invalid_sessions: 0, remeasured: 0, between: 0 },
  },
  switched: { a_to_b: 0, b_to_a: 0, both: 0 },
  saw_between: 0,
  ref: { card: 0, coin: 0 },
  method_x_ref: { A_card: 0, A_coin: 0, B_card: 0, B_coin: 0 },
  cta: { line: 0, share: 0, shop: 0, gem_quiz: 0 },
  friction: { zoom_blocked: 0, calib_warn: 0, invalid: 0, stale_recalib: 0, remeasured: 0 },
  daily: daily(30, () => [0, 0]),
};

function renderRaw(r: Raw, filters: RingSizeFilters = F30, notices: string[] = []) {
  const data = parseRingSizeStats(r);
  expect(data, "fixture ต้องผ่าน parser (รูปร่างตาม SQL)").not.toBeNull();
  return render(<RingSizeStats result={{ ok: true, data: data! }} filters={filters} today={TODAY} notices={notices} />);
}
const bodyText = () => document.body.textContent ?? "";
const numericPct = /(?:\d|<1)%/;

function sweep(label: string) {
  const t = bodyText();
  expect(t, `${label}: คำต้องห้าม`).not.toMatch(BANNED);
  expect(t, `${label}: NaN/undefined/null บนจอ`).not.toMatch(BAD);
  // ไม่มีค่าภายนอก: ทุกลิงก์ต้องเป็น anchor ภายในหน้า · ไม่มี URL/LINE ID/เบอร์/อีเมลในข้อความหรือ attribute
  for (const a of Array.from(document.querySelectorAll("a"))) expect(a.getAttribute("href") ?? "", label).toMatch(/^#/);
  // xmlns ของ SVG ไอคอน (lucide) เป็นค่ามาตรฐาน W3C ไม่ใช่ลิงก์ที่ผู้ใช้เห็น/กด — ตัดออกก่อนสแกน
  const html = document.body.innerHTML.replace(/xmlns="[^"]*"/g, "");
  expect(html, `${label}: ค่าภายนอก`).not.toMatch(/https?:\/\/|lin\.ee|@[a-z0-9_.]+\b|\btel:|\bmailto:|\b0\d{1,2}-?\d{3}-?\d{4}\b/i);
  // ความกว้างแท่งต้องเป็นเลขจริง 0..100
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("[style]"))) {
    const m = /width:\s*(\d{1,3})%/.exec(el.getAttribute("style") ?? "");
    expect(m, `${label}: style width`).not.toBeNull();
    expect(Number(m![1])).toBeLessThanOrEqual(100);
  }
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(screen.getByRole("group", { name: "ช่วงเวลา" }), `${label}: แถบกรองต้องอยู่`).toBeInTheDocument();
}

describe("QA5 — ทุก state: แถบกรองอยู่ · ไม่มีคำต้องห้าม/NaN/ลิงก์ภายนอก · แท่งเป็นเลขจริง", () => {
  const states: [string, () => void][] = [
    ["success", () => renderRaw(raw())],
    ["ไม่เคยมีข้อมูล (data_since null · 0 ครั้ง)", () => renderRaw(EMPTY_RAW)],
    ["ช่วงอยู่ก่อนเริ่มเก็บ", () => renderRaw({ ...EMPTY_RAW, data_since: addDays(TODAY, 2) })],
    ["ช่วงว่าง (มีข้อมูลก่อนหน้า)", () => renderRaw({ ...EMPTY_RAW, data_since: addDays(TODAY, -100) })],
    ["ข้อมูลน้อย 1 ครั้ง", () => renderRaw(raw({ sessions: 1, returning: 0, measured: 0, funnel: [1, 0, 0, 0, 0, 0, 0, 0], abandon_at: [1, 0, 0, 0, 0, 0, 0], result_sizes: [], size_summary: { below_range: 0, in_range: 0, above_range: 0, between_count: 0 } }))],
    ["ฐาน 29", () => renderRaw(lowBase(29))],
    ["ฐาน 30", () => renderRaw(lowBase(30))],
    ["ตัวเลข 6 หลัก", () => renderRaw(raw({ sessions: 123456, measured: 99999, funnel: [123456, 100000, 90000, 80000, 70000, 60000, 50000, 40000], cta: { line: 99999, share: 12345, shop: 1, gem_quiz: 0 } }))],
    ["วัดได้ 0 แต่เปิด > 0", () => renderRaw(raw({ sessions: 50, measured: 0, funnel: [50, 0, 0, 0, 0, 0, 0, 0], abandon_at: [50, 0, 0, 0, 0, 0, 0], result_sizes: [], size_summary: { below_range: 0, in_range: 0, above_range: 0, between_count: 0 } }))],
    ["error", () => render(<RingSizeStats result={{ ok: false, error: "โหลดสถิติไม่สำเร็จ ลองใหม่อีกครั้ง" }} filters={F30} today={TODAY} notices={[]} />)],
    ["ไม่มี shop_range", () => renderRaw(raw({ shop_range: { min: 20, max: 10 } }))],
    ["section ผิดรูปทั้งหมด", () => renderRaw({ sessions: 5, returning: 0, measured: 0 })],
    ["notices หลายข้อ", () => renderRaw(raw(), F30, ["ปรับ A", "ปรับ B"])],
  ];
  it.each(states)("%s", (name, go) => {
    go();
    sweep(name);
  });
});

/** ฐานทุกตัว = n ให้ดูเส้นแบ่ง 29/30 (ตัวเลขทุกช่อง ≤ n) */
function lowBase(n: number): Raw {
  const half = Math.floor(n / 2);
  return raw({
    sessions: n,
    returning: 1,
    measured: n,
    funnel: [n, n, n, n, n, n, n, n],
    abandon_at: [0, 0, 0, 0, 0, 0, 0],
    result_sizes: [{ size: 54, count: half }, { size: 55, count: n - half }],
    size_summary: { below_range: 0, in_range: n, above_range: 0, between_count: 1 },
    by_in_app: { line: n, tiktok: 0, fb: 0, ig: 0, browser: 0, unknown: 0 },
    method: { A: n, B: 0 },
    method_stats: {
      A: { picked: n, measured: n, abandoned_at_measure: 1, invalid_sessions: 1, remeasured: 1, between: null },
      B: { picked: n, measured: n, abandoned_at_measure: 1, invalid_sessions: 1, remeasured: 1, between: 1 },
    },
    friction: { zoom_blocked: 1, calib_warn: 1, invalid: 1, stale_recalib: 1, remeasured: 1 },
    daily: daily(14, () => [1, 1]),
    cta: { line: 1, share: 1, shop: 1, gem_quiz: 1 },
  });
}

describe("QA4 — เส้นแบ่งฐาน 29 vs 30 บนจอจริง", () => {
  it("ทุกฐาน = 29 ⇒ ไม่มีตัวเลข % ที่ไหนบนจอเลย (มีแต่ 'n จาก N')", () => {
    renderRaw(lowBase(29));
    expect(bodyText()).not.toMatch(numericPct);
    expect(bodyText()).toContain("ข้อมูลยังน้อย — เปิดใช้เพียง 29 ครั้ง");
    expect(bodyText()).toMatch(/จาก 29/);
  });

  it("ทุกฐาน = 30 ⇒ % ขึ้นทั้ง tile / ไซส์ / funnel / ช่องทาง / จุดที่คนติด · ไม่มีแถบ 'ข้อมูลยังน้อย'", () => {
    renderRaw(lowBase(30));
    expect(bodyText()).not.toContain("ข้อมูลยังน้อย");
    expect(bodyText()).toMatch(/100% ของที่เปิด/); // tile วัดได้เบอร์ (30/30)
    expect(within(screen.getByRole("region", { name: "คนเลิกกลางทางที่ไหน" })).getAllByText(/100%/).length).toBeGreaterThan(0);
    expect(within(screen.getByRole("region", { name: "จุดที่คนติด" })).getAllByText("3%").length).toBe(4); // 1/30 = 3.3%
    expect(within(screen.getByRole("region", { name: "เปิดในแอปอะไร" })).getAllByText("100%")).toHaveLength(1);
  });
});

describe("QA4 — ต่อเซลล์: คนละฐาน คนละกติกา ('3 จาก 8' ข้างเซลล์ที่โชว์ %)", () => {
  function methodRow(label: string) {
    const card = screen.getByRole("region", { name: "วัดด้วยอะไร" });
    // หัวแถวมีบรรทัดรอง (hint) ปนอยู่ — จับด้วยข้อความบรรทัดแรกที่ตรงเป๊ะ
    const th = within(card).getAllByRole("rowheader").find((h) => h.firstChild?.textContent === label);
    expect(th, `แถว "${label}"`).toBeDefined();
    const row = th!.closest("tr")!;
    const cells = within(row).getAllByRole("cell");
    return cells.map((c) => c.textContent ?? "");
  }

  it("A.picked=8 (ต่ำกว่า 30) · B.picked=40 ⇒ เซลล์ A = '3' + 'จาก 8' ไม่มี % · เซลล์ B = '20' + '50%'", () => {
    renderRaw(
      raw({
        method_stats: {
          A: { picked: 8, measured: 3, abandoned_at_measure: 2, invalid_sessions: 1, remeasured: 0, between: null },
          B: { picked: 40, measured: 20, abandoned_at_measure: 8, invalid_sessions: 4, remeasured: 5, between: 2 },
        },
      })
    );
    const [a, b] = methodRow("วัดได้เบอร์");
    expect(a).toBe("3จาก 8");
    expect(b).toBe("2050%");
    const [aAb, bAb] = methodRow("เลิกที่หน้าวัด");
    expect(aAb).toBe("2จาก 8");
    expect(bAb).toBe("820%");
    // วัดซ้ำใช้ฐาน = picked ของวิธีนั้น (code review #1: ตัวตั้ง measure_count_x>=2 เป็นระดับ session ครอบด้วย used_x ไม่ใช่ measured)
    // A: 8 ⇒ ต่ำกว่า 30 · B: 40 ⇒ โชว์ % (5/40 = 13%)
    const [aRe, bRe] = methodRow("วัดซ้ำ 2 ครั้งขึ้นไป");
    expect(aRe).toBe("0จาก 8");
    expect(bRe).toBe("513%");
    expect(bodyText()).not.toMatch(BAD);
  });

  it("ฐานเป็น 0 (ไม่มีใครใช้กระดาษ) ⇒ ทุกเซลล์ฐานโชว์ '—' · ไม่ NaN", () => {
    renderRaw(
      raw({
        method_stats: {
          A: { picked: 40, measured: 40, abandoned_at_measure: 0, invalid_sessions: 0, remeasured: 0, between: null },
          B: { picked: 0, measured: 0, abandoned_at_measure: 0, invalid_sessions: 0, remeasured: 0, between: 0 },
        },
      })
    );
    for (const l of ["วัดได้เบอร์", "เลิกที่หน้าวัด", "ค่าวัดผิดปกติ", "วัดซ้ำ 2 ครั้งขึ้นไป", "ผลก้ำกึ่งระหว่างเบอร์"]) {
      const cells = methodRow(l);
      expect(cells[1], l).toBe("0—");
    }
    expect(bodyText()).not.toMatch(BAD);
  });

  it("friction ฐาน = กดเริ่ม: funnel[1]=0 ⇒ '—' ไม่ NaN · funnel[1]=29 ⇒ จาก 29 · =30 ⇒ %", () => {
    for (const [started, expectFn] of [
      [0, (t: string) => expect(t).toContain("—")],
      [29, (t: string) => expect(t).toContain("จาก 29")],
      [30, (t: string) => expect(t).toMatch(/\d+%/)],
    ] as const) {
      cleanup();
      renderRaw(raw({ funnel: [412, started, 0, 0, 0, 0, 0, 0], friction: { zoom_blocked: 4, calib_warn: 3, invalid: 2, stale_recalib: 1, remeasured: 0 } }));
      const card = screen.getByRole("region", { name: "จุดที่คนติด" });
      expectFn(card.textContent ?? "");
      expect(card.textContent).not.toMatch(BAD);
    }
  });

  it("'<1%' ขึ้นจริงที่ช่องทาง (2 จาก 1,000) · ช่องที่เป็น 0 ถูกซ่อน · ไม่มี '0%'", () => {
    renderRaw(
      raw({
        sessions: 1000,
        by_in_app: { line: 600, tiktok: 398, fb: 0, ig: 2, browser: 0, unknown: 0 },
        funnel: [1000, 900, 800, 700, 600, 500, 400, 300],
        abandon_at: [100, 100, 100, 100, 100, 100, 100],
      })
    );
    const card = screen.getByRole("region", { name: "เปิดในแอปอะไร" });
    const ig = within(card).getByRole("rowheader", { name: "Instagram" }).closest("tr")!;
    expect(ig.textContent).toContain("<1%");
    expect(within(card).queryByRole("rowheader", { name: "Facebook" })).toBeNull();
    expect(card.textContent).not.toMatch(/(?<!\d)0%/);
  });

  it("ตัวเลข 5–6 หลักใน tile ไม่ถูกตัดเป็น k/M · คั่นหลักพัน", () => {
    renderRaw(raw({ sessions: 123456, measured: 99999, cta: { line: 12345, share: 0, shop: 0, gem_quiz: 0 } }));
    const t = bodyText();
    expect(t).toContain("123,456");
    expect(t).toContain("99,999");
    expect(t).toContain("12,345");
    expect(t).not.toMatch(/\d[kKmM]\b/);
  });
});

describe("QA4 — แหล่งตัวเลขของ tile: 'วัดได้เบอร์' = measured เสมอ (ไม่ใช่ funnel[7] ที่รวมหน้า 'ค่าวัดผิดปกติ')", () => {
  it("measured=187 แต่ funnel[7]=215 ⇒ tile ที่ 2 โชว์ 187 · แถวท้าย funnel โชว์ 'ได้เบอร์ 187' · tile 1 = sessions · tile 3 = cta.line", () => {
    renderRaw(raw({ sessions: 412, measured: 187, funnel: [412, 332, 312, 287, 269, 259, 245, 215], cta: { line: 41, share: 12, shop: 9, gem_quiz: 7 } }));
    const tiles = Array.from(document.querySelector(".grid-cols-3")!.children).map((c) => c.textContent ?? "");
    expect(tiles).toHaveLength(3);
    expect(tiles[0]).toContain("เปิดใช้");
    expect(tiles[0]).toContain("412");
    expect(tiles[1]).toContain("วัดได้เบอร์");
    expect(tiles[1]).toContain("187");
    expect(tiles[1]).not.toContain("215");
    expect(tiles[2]).toContain("กดปุ่ม LINE");
    expect(tiles[2]).toContain("41");
    expect(tiles[2]).not.toMatch(/\d+%/); // LINE ไม่โชว์ % (ฐานไม่ใช่ measured)
    const funnel = screen.getByRole("region", { name: "คนเลิกกลางทางที่ไหน" });
    expect(funnel.textContent).toContain("ได้เบอร์ 187");
    expect(funnel.textContent).not.toContain("ได้เบอร์ 215");
  });

  it("แถบ 'หลังเห็นผล' ใช้ค่า share/shop/gem_quiz ถูกช่อง (ค่าไม่ซ้ำกัน)", () => {
    renderRaw(raw({ cta: { line: 41, share: 12, shop: 9, gem_quiz: 7 } }));
    expect(bodyText()).toContain("แชร์ผล 12 · ดูหน้าร้าน 9 · เกมพลอย 7");
  });
});

describe("QA7 — ไม่ hardcode ช่วงเบอร์ร้าน 45/68 (ใช้ shop_range จาก RPC = 50–60 ในเทสต์)", () => {
  it("ตารางเบอร์ = 50..60 เท่านั้น · ป้ายช่วงใช้ 50/60 · ไม่มีคำว่า เบอร์ 45/68 ที่ไหนเลย", () => {
    renderRaw(raw());
    const card = screen.getByRole("region", { name: "ส่วนใหญ่ไซส์อะไร" });
    const table = within(card).getByRole("table", { name: /ทุกเบอร์ 50 ถึง 60/ });
    const sizes = within(table)
      .getAllByRole("rowheader")
      .map((th) => Number(/^\d+/.exec(th.textContent ?? "")![0]));
    expect(sizes).toEqual([50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60]);
    const t = bodyText();
    expect(t).toContain("ต่ำกว่าเบอร์ 50 (นอกช่วงที่ร้านทำ)");
    expect(t).toContain("เบอร์ 50–60 (ช่วงที่ร้านทำ)");
    expect(t).toContain("สูงกว่าเบอร์ 60 (นอกช่วงที่ร้านทำ)");
    expect(t).not.toMatch(/เบอร์\s*(45|68)\b|45\s*[–-]\s*68/);
  });

  it("เบอร์นอกช่วงร้านติด Badge 'นอกช่วงที่ร้านทำ' เฉพาะที่นอกช่วงจริง (เทียบ 50–60 ไม่ใช่ 45–68)", () => {
    // 48 อยู่นอก 50–60 แต่อยู่ใน 45–68 — ถ้า hardcode จะไม่ติดป้าย
    renderRaw(raw({ result_sizes: [{ size: 48, count: 90 }, { size: 55, count: 50 }, { size: 63, count: 40 }] }));
    const card = screen.getByRole("region", { name: "ส่วนใหญ่ไซส์อะไร" });
    const chips = within(card).getAllByRole("listitem");
    const by = (n: number) => chips.find((c) => c.textContent?.includes(`เบอร์ ${n}`))!;
    expect(by(48).textContent).toContain("นอกช่วงที่ร้านทำ");
    expect(by(63).textContent).toContain("นอกช่วงที่ร้านทำ");
    expect(by(55).textContent).not.toContain("นอกช่วงที่ร้านทำ");
  });
});

describe("QA5 — รายวัน: ช่วง 180 วัน · ขอบ data_since · all-zero", () => {
  it("180 แถว ⇒ เริ่ม 14 แถว · ขยาย → 180 · ย่อ → 14 · aria-expanded ตาม", async () => {
    renderRaw(raw({ daily: daily(180), data_since: addDays(TODAY, -179) }), { from: addDays(TODAY, -179), to: TODAY, range: "180d" });
    const list = document.getElementById("rs-daily-list")!;
    expect(list.querySelectorAll("li")).toHaveLength(14);
    const btn = screen.getByRole("button", { name: "แสดงทั้งหมด 180 วัน" });
    expect(btn).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(btn);
    expect(list.querySelectorAll("li")).toHaveLength(180);
    expect(screen.getByRole("button", { name: "แสดงแค่ 14 วันล่าสุด" })).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(screen.getByRole("button", { name: "แสดงแค่ 14 วันล่าสุด" }));
    expect(list.querySelectorAll("li")).toHaveLength(14);
    // วันล่าสุดอยู่บนสุด (ใหม่→เก่า)
    expect(list.querySelector("li")!.textContent).toContain("3 พ.ย.");
  });

  it("ทุกวันเป็น 0 แต่ sessions รวม > 0 (ข้อมูลไม่สอดคล้อง) ⇒ ไม่ NaN · แท่งกว้าง 0%", () => {
    renderRaw(raw({ daily: daily(30, () => [0, 0]) }));
    sweep("daily all-zero");
    expect(document.getElementById("rs-daily-list")!.querySelectorAll("[style]")).not.toHaveLength(0);
    for (const el of Array.from(document.getElementById("rs-daily-list")!.querySelectorAll<HTMLElement>("[style]"))) {
      expect(el.getAttribute("style")).toContain("width: 0%");
    }
  });

  it("data_since = from ⇒ ไม่มี notice 'เริ่มมีข้อมูลตั้งแต่' · = from+1 ⇒ มี + แถวคั่นท้ายรายการ · แถวก่อน data_since ถูกตัด", () => {
    renderRaw(raw({ data_since: F30.from }));
    expect(bodyText()).not.toContain("เริ่มมีข้อมูลตั้งแต่");
    expect(bodyText()).not.toContain("ยังไม่ได้เก็บข้อมูล");
    cleanup();
    renderRaw(raw({ data_since: addDays(F30.from, 1) }));
    expect(bodyText()).toContain("เริ่มมีข้อมูลตั้งแต่");
    // 30 วัน − 1 วันที่ถูกตัด = 29 แถว (> 14 ⇒ ต้องขยายก่อนจึงเห็นแถวคั่นท้าย)
    expect(screen.getByRole("button", { name: "แสดงทั้งหมด 29 วัน" })).toBeInTheDocument();
  });
});

describe("QA5 — ปุ่มนำทางใน empty state ต้องให้ URL ที่ผ่านด่านเสมอ", () => {
  it.each([2, 1, 30, 400])("ก่อนเริ่มเก็บ (data_since = วันนี้+%i) ⇒ ปุ่ม 'ดูตั้งแต่' push URL ที่ parse แล้วผ่านด่าน RPC", async (ahead) => {
    renderRaw({ ...EMPTY_RAW, data_since: addDays(TODAY, ahead) });
    await userEvent.click(screen.getByRole("button", { name: /^ดูตั้งแต่/ }));
    expect(pushMock).toHaveBeenCalledTimes(1);
    const url = new URL(String(pushMock.mock.calls[0][0]), "https://x.invalid");
    const f = parseRingSizeFilters(Object.fromEntries(url.searchParams), TODAY);
    expect(f.notices).toEqual([]);
    expect(checkRingStatsRange(f.from, f.to)).toBeNull();
  });

  it("ช่วงว่าง 7 วัน ⇒ 'ขยายเป็น 90 วัน' push ?range=90d", async () => {
    renderRaw({ ...EMPTY_RAW, data_since: addDays(TODAY, -100) }, { from: addDays(TODAY, -6), to: TODAY, range: "7d" });
    await userEvent.click(screen.getByRole("button", { name: "ขยายเป็น 90 วัน" }));
    expect(pushMock).toHaveBeenCalledWith("/marketing/ring-size?range=90d");
  });

  // regression ของ BUG-QA-1 (แก้ใน 5572449): ช่วง "กำหนดเอง" ที่ยาว ≥ 90 วันแล้วว่าง ต้องไม่เสนอ "ขยายเป็น 90 วัน" (กดแล้วหดลง) —
  //   canExpand นับจำนวนวันของช่วงปัจจุบัน (< 90) ไม่ใช่ดูแค่ชื่อ range (เดิมเป็น it.fails)
  it("[BUG-QA-1] custom 150 วันที่ว่าง ⇒ ไม่ควรเสนอ 'ขยายเป็น 90 วัน' (กดแล้วหดลง)", () => {
    renderRaw({ ...EMPTY_RAW, data_since: addDays(TODAY, -170) }, { from: addDays(TODAY, -149), to: TODAY, range: "custom" });
    expect(screen.queryByRole("button", { name: "ขยายเป็น 90 วัน" })).toBeNull();
  });
});

describe("QA3 — ฟอร์มกำหนดเอง: ขอบ 6/7 วัน · 179/180 วัน · ว่าง · อนาคต ⇒ ไม่ push (หรือ push เฉพาะที่ผ่าน)", () => {
  async function submit(from: string, to: string) {
    renderRaw(raw());
    await userEvent.click(screen.getByRole("button", { name: "กำหนดเอง" }));
    const form = screen.getByRole("form", { name: "กำหนดช่วงวันที่เอง" });
    const [fromInput, toInput] = Array.from(form.querySelectorAll<HTMLInputElement>('input[type="date"]'));
    fireEvent.change(fromInput, { target: { value: from } });
    fireEvent.change(toInput, { target: { value: to } });
    fireEvent.submit(form); // ข้ามการตรวจ min/max ของเบราว์เซอร์ — พิสูจน์ว่าโค้ดตรวจเอง
  }

  it.each([
    ["6 วัน (to−from = 5)", addDays(TODAY, -5), TODAY, false],
    ["7 วันพอดี", addDays(TODAY, -6), TODAY, true],
    ["180 วันพอดี (ย้อนถึง today−179)", addDays(TODAY, -179), TODAY, true],
    ["181 วัน (today−180)", addDays(TODAY, -180), TODAY, false],
    ["180 วันแต่เลื่อนไปก่อนขอบ retention (today−180..today−1)", addDays(TODAY, -180), addDays(TODAY, -1), false],
    ["to = พรุ่งนี้", addDays(TODAY, -10), addDays(TODAY, 1), false],
    ["from > to", TODAY, addDays(TODAY, -10), false],
    ["ช่อง from ว่าง", "", TODAY, false],
    ["ทั้งสองช่องว่าง", "", "", false],
    ["วันเดียว", TODAY, TODAY, false],
  ] as [string, string, string, boolean][])("%s", async (_n, from, to, shouldPush) => {
    await submit(from, to);
    if (shouldPush) {
      expect(pushMock).toHaveBeenCalledTimes(1);
      const url = new URL(String(pushMock.mock.calls[0][0]), "https://x.invalid");
      expect(url.searchParams.get("from")).toBe(from);
      expect(url.searchParams.get("to")).toBe(to);
      expect(screen.queryByRole("alert")).toBeNull();
    } else {
      expect(pushMock).not.toHaveBeenCalled();
      const alert = screen.getByRole("alert");
      expect(alert.textContent).not.toBe("");
      expect(alert.textContent).not.toMatch(BAD);
    }
  });
});

describe("QA6 — nav/regression ใน diff", () => {
  it("เมนู 'ไซส์แหวน' อยู่ที่ 'เพิ่มเติม' เท่านั้น · แถบล่างมือถือหลัก ≤ 4 · href ไม่ซ้ำ · gem-quiz ยังอยู่ติดกัน", () => {
    const row = MARKETING_NAV.find((i) => i.href === "/marketing/ring-size")!;
    expect(row).toMatchObject({ label: "ไซส์แหวน", tab: "more", mobile: "more", sidebar: false });
    expect(MARKETING_NAV.filter((i) => i.mobile === "main").length).toBeLessThanOrEqual(4);
    expect(new Set(MARKETING_NAV.map((i) => i.href)).size).toBe(MARKETING_NAV.length);
    expect(MARKETING_NAV.filter((i) => i.href.includes("ring-size"))).toHaveLength(1);
    const gem = MARKETING_NAV.find((i) => i.href === "/marketing/gem-quiz")!;
    expect(gem).toMatchObject({ tab: "more", mobile: "more", sidebar: false });
  });
});
