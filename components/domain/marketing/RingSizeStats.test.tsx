// @vitest-environment jsdom
// components/domain/marketing/RingSizeStats.test.tsx — หน้าสรุป /marketing/ring-size ครบ 4 state + เคส UI ใน ux-ring-size-stats.md ท้ายไฟล์
// (ตัวเลขทั้งหมดเป็นข้อมูลทดสอบวางโครง ไม่ใช่ข้อมูลจริง)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import type { RingSizeStats as Data } from "@/lib/marketing/ring-size-stats";
import type { RingSizeFilters } from "@/lib/marketing/ring-size-filters";

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

import { RingSizeStats } from "./RingSizeStats";

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
});

const TODAY = "2026-11-03";
const F30: RingSizeFilters = { from: "2026-10-05", to: TODAY, range: "30d" };

function daily(n: number): { date: string; sessions: number; measured: number }[] {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(`${TODAY}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - i);
    out.push({ date: d.toISOString().slice(0, 10), sessions: (i % 5) + 1, measured: i % 3 });
  }
  return out;
}

function stats(o: Partial<Data> = {}): Data {
  return {
    sessions: 412,
    returning: 60,
    measured: 187,
    shopRange: { min: 50, max: 60 },
    dataSince: "2026-10-01",
    byInApp: { line: 150, tiktok: 30, fb: 70, ig: 2, browser: 140, unknown: 20 },
    funnel: [412, 332, 312, 287, 269, 259, 245, 215],
    abandonAt: [80, 20, 25, 18, 10, 14, 30],
    resultSizes: [
      { size: 54, count: 31 },
      { size: 55, count: 24 },
      { size: 53, count: 22 },
      { size: 40, count: 3 },
      { size: 58, count: 5 },
    ],
    sizeSummary: { belowRange: 3, inRange: 180, aboveRange: 4, betweenCount: 21 },
    circHist: [{ mm: 52, count: 4 }],
    method: { A: 120, B: 73 },
    methodStats: {
      A: { picked: 125, measured: 98, abandonedAtMeasure: 12, invalidSessions: 5, remeasured: 14, between: null },
      B: { picked: 80, measured: 55, abandonedAtMeasure: 9, invalidSessions: 8, remeasured: 17, between: 21 },
    },
    switched: { aToB: 4, bToA: 9, both: 13 },
    sawBetween: 21,
    ref: { card: 78, coin: 115 },
    methodXRef: { aCard: 50, aCoin: 70, bCard: 28, bCoin: 45 },
    cta: { line: 41, share: 12, shop: 9, gemQuiz: 7 },
    friction: { zoomBlocked: 40, calibWarn: 22, invalid: 13, staleRecalib: 9, remeasured: 31 },
    daily: daily(30),
    ...o,
  };
}

const EMPTY: Partial<Data> = {
  sessions: 0,
  returning: 0,
  measured: 0,
  funnel: [0, 0, 0, 0, 0, 0, 0, 0],
  abandonAt: [0, 0, 0, 0, 0, 0, 0],
  resultSizes: [],
  sizeSummary: { belowRange: 0, inRange: 0, aboveRange: 0, betweenCount: 0 },
  byInApp: { line: 0, tiktok: 0, fb: 0, ig: 0, browser: 0, unknown: 0 },
  daily: [],
  circHist: [],
  cta: { line: 0, share: 0, shop: 0, gemQuiz: 0 },
};

function renderPage(
  data: Data | null,
  filters: RingSizeFilters = F30,
  extra: { error?: string; notices?: string[] } = {}
) {
  const result = data ? { ok: true as const, data } : { ok: false as const, error: extra.error ?? "โหลดสถิติไม่สำเร็จ ลองใหม่อีกครั้ง" };
  return render(<RingSizeStats result={result} filters={filters} today={TODAY} notices={extra.notices ?? []} />);
}

const bodyText = () => document.body.textContent ?? "";

function expectFilterBar() {
  expect(screen.getByRole("group", { name: "ช่วงเวลา" })).toBeInTheDocument();
  for (const label of ["7 วัน", "30 วัน", "90 วัน", "180 วัน", "กำหนดเอง"]) {
    expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
  }
}

describe("state: error — แถบกรองยังอยู่ · ไม่เผย message ดิบ · ลองใหม่ได้", () => {
  it("แสดง ErrorState + ปุ่ม 'ลองใหม่' (router.refresh) และแถบกรองยังอยู่", async () => {
    renderPage(null);
    expectFilterBar();
    expect(screen.getByRole("alert")).toHaveTextContent("โหลดสถิติไม่สำเร็จ ลองใหม่อีกครั้ง");
    await userEvent.click(screen.getByRole("button", { name: "ลองใหม่" }));
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(pushMock).not.toHaveBeenCalled();
  });
  it("ใน error state เปลี่ยนช่วงเวลาได้ (กด chip แล้ว push)", async () => {
    renderPage(null);
    await userEvent.click(screen.getByRole("button", { name: "7 วัน" }));
    expect(pushMock).toHaveBeenCalledWith("/marketing/ring-size?range=7d");
  });
  it("ไม่มีลิงก์ 'อ่านวิธีนับ' (ไม่มีส่วนอ่านก่อนตีความให้ลิงก์ไป)", () => {
    renderPage(null);
    expect(screen.queryByRole("link", { name: "อ่านวิธีนับ" })).not.toBeInTheDocument();
  });
});

describe("state: empty — 3 แบบ · แถบกรองอยู่ทุกแบบ (บทเรียน S3)", () => {
  it("ก: ไม่เคยมีข้อมูล (sessions 0 · data_since null)", () => {
    renderPage(stats({ ...EMPTY, dataSince: null }));
    expectFilterBar();
    expect(screen.getByText("ยังไม่มีคนใช้เครื่องมือวัดไซส์")).toBeInTheDocument();
    expect(screen.getByText(/แจ้งทีมพัฒนาให้ตรวจ/)).toBeInTheDocument();
    expect(bodyText()).not.toMatch(/NaN|Infinity|undefined/);
    // ไม่มี section ตัวเลข
    expect(screen.queryByRole("heading", { name: "ส่วนใหญ่ไซส์อะไร" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "อ่านก่อนตีความ" })).toBeInTheDocument();
  });

  it("ข: ช่วงอยู่ก่อนวันเริ่มเก็บ ⇒ ปุ่ม 'ดูตั้งแต่ …' push ช่วงที่ RPC รับได้", async () => {
    renderPage(stats({ ...EMPTY, dataSince: "2026-10-30" }), { from: "2026-09-01", to: "2026-09-30", range: "custom" });
    expectFilterBar();
    expect(screen.getByText("ช่วงนี้อยู่ก่อนวันที่เริ่มเก็บข้อมูล")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /ดูตั้งแต่/ }));
    expect(pushMock).toHaveBeenCalledTimes(1);
    const href = pushMock.mock.calls[0][0] as string;
    const qs = new URLSearchParams(href.split("?")[1]);
    expect(qs.get("to")).toBe(TODAY);
    // data_since ใกล้วันนี้ (< 7 วัน) ⇒ ถอยเป็น 7 วันพอดี (ไม่ให้ RPC ปฏิเสธ)
    expect(qs.get("from")).toBe("2026-10-28");
  });

  it("ค: ช่วงนี้ว่าง (data_since อยู่ก่อนช่วง) ⇒ ปุ่ม 'ขยายเป็น 90 วัน'", async () => {
    renderPage(stats({ ...EMPTY, dataSince: "2026-09-01" }));
    expectFilterBar();
    expect(screen.getByText("ไม่มีการใช้งานในช่วงที่เลือก")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "ขยายเป็น 90 วัน" }));
    expect(pushMock).toHaveBeenCalledWith("/marketing/ring-size?range=90d");
  });

  it("ค: ช่วงกำหนดเองสั้นกว่า 90 วัน ⇒ มีปุ่มขยาย · ยาว ≥ 90 วัน (กดแล้วหดลง) ⇒ ไม่มีปุ่ม", () => {
    const empty = stats({ ...EMPTY, dataSince: "2026-01-01" });
    renderPage(empty, { from: "2026-09-05", to: TODAY, range: "custom" }); // 60 วัน
    expect(screen.getByRole("button", { name: "ขยายเป็น 90 วัน" })).toBeInTheDocument();
    cleanup();
    renderPage(empty, { from: "2026-08-06", to: TODAY, range: "custom" }); // 90 วันพอดี
    expect(screen.queryByRole("button", { name: "ขยายเป็น 90 วัน" })).not.toBeInTheDocument();
    cleanup();
    renderPage(empty, { from: "2026-05-08", to: TODAY, range: "custom" }); // 180 วัน
    expect(screen.queryByRole("button", { name: "ขยายเป็น 90 วัน" })).not.toBeInTheDocument();
  });

  it("ค: ถ้าดู 90/180 วันอยู่แล้ว ไม่มีปุ่มขยาย", () => {
    renderPage(stats({ ...EMPTY, dataSince: "2026-05-01" }), { from: "2026-08-06", to: TODAY, range: "90d" });
    expect(screen.queryByRole("button", { name: "ขยายเป็น 90 วัน" })).not.toBeInTheDocument();
  });
});

describe("state: ข้อมูลน้อย (1–29) — โชว์ 'จำนวน' ไม่โชว์ % ต่อค่า", () => {
  const low = () =>
    stats({
      sessions: 18,
      returning: 2,
      measured: 8,
      funnel: [18, 14, 12, 11, 10, 9, 9, 8],
      abandonAt: [4, 2, 1, 1, 1, 0, 1],
      resultSizes: [{ size: 54, count: 3 }, { size: 55, count: 2 }, { size: 53, count: 1 }],
      sizeSummary: { belowRange: 0, inRange: 8, aboveRange: 0, betweenCount: 1 },
      byInApp: { line: 6, tiktok: 5, fb: 0, ig: 0, browser: 7, unknown: 0 },
      methodStats: {
        A: { picked: 7, measured: 5, abandonedAtMeasure: 1, invalidSessions: 0, remeasured: 1, between: null },
        B: { picked: 4, measured: 3, abandonedAtMeasure: 0, invalidSessions: 1, remeasured: 0, between: 1 },
      },
      daily: daily(10),
    });

  it("มีแถบเตือน amber + ทุกเซลล์เป็น 'n จาก ฐาน' ไม่มี %", () => {
    renderPage(low());
    const banner = screen.getByText(/ข้อมูลยังน้อย — เปิดใช้เพียง 18 ครั้ง/).closest("[role=status]") as HTMLElement;
    expect(banner).toBeInTheDocument();
    expect(banner.className).toMatch(/amber/);
    // ชิป "พบมากสุด": ฐาน = measured 8 ⇒ "3 จาก 8" (ไม่ใช่ 38%) · ในตาราง จำนวนกับ "จาก 8" อยู่คนละเซลล์ติดกัน
    expect(screen.getByText("3 จาก 8")).toBeInTheDocument();
    expect(screen.getAllByText("จาก 8").length).toBeGreaterThan(0);
    // ไม่มีสัญลักษณ์ % ในส่วนตัวเลขของหน้า (ข้อความ "%" ที่เหลืออยู่ได้เฉพาะหัวคอลัมน์ "%" และข้อความอธิบายเกณฑ์)
    const numeric = Array.from(document.querySelectorAll("td")).map((td) => td.textContent ?? "");
    expect(numeric.filter((t) => /\d\s*%/.test(t))).toEqual([]);
    expect(bodyText()).not.toMatch(/NaN|Infinity|undefined/);
  });

  it("ฐาน 30 พอดี ⇒ โชว์ % แล้ว (เส้นแบ่ง)", () => {
    renderPage(low() && stats({ sessions: 30, funnel: [30, 20, 15, 12, 10, 9, 9, 8], abandonAt: [10, 5, 3, 2, 1, 0, 1], byInApp: { line: 15, tiktok: 15, fb: 0, ig: 0, browser: 0, unknown: 0 } }));
    expect(screen.queryByText(/ข้อมูลยังน้อย/)).not.toBeInTheDocument();
    expect(within(screen.getByRole("heading", { name: "เปิดในแอปอะไร" }).closest("section") as HTMLElement).getAllByText("50%").length).toBe(2);
  });
});

describe("state: success — ครบทุก section", () => {
  it("หัว · แถบกรอง · tile 3 ใบ · ทุก h2 เรียงตาม spec", () => {
    renderPage(stats());
    expect(screen.getByRole("heading", { level: 1, name: "สถิติไซส์แหวน" })).toBeInTheDocument();
    expectFilterBar();
    const h2 = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(h2).toEqual([
      "ส่วนใหญ่ไซส์อะไร",
      "วัดด้วยอะไร",
      "คนเลิกกลางทางที่ไหน",
      "เปิดในแอปอะไร",
      "จุดที่คนติด",
      "รายวัน",
      "อ่านก่อนตีความ",
    ]);
    expect(screen.queryByText(/ข้อมูลยังน้อย/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "อ่านวิธีนับ" })).toHaveAttribute("href", "#rs-notes-heading");
  });

  it("tile: LINE ติดป้าย 'ขั้นต่ำ' และไม่มี % ของ LINE · 'ครั้ง' ไม่ใช่ 'คน'", () => {
    renderPage(stats());
    expect(screen.getByText("ขั้นต่ำ — อาจนับขาดบางครั้ง")).toBeInTheDocument();
    expect(screen.getByText("41")).toBeInTheDocument();
    expect(screen.getByText(/หลังเห็นผล \(ขั้นต่ำเช่นกัน\): แชร์ผล 12 · ดูหน้าร้าน 9 · เกมพลอย 7/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 }).parentElement).toHaveTextContent(/ไม่ใช่จำนวนคน/);
    expect(screen.getByText("45% ของที่เปิด")).toBeInTheDocument(); // measured 187 / 412
  });

  it("ตัวเลข 5 หลักคั่นหลักพัน ไม่ตัด k (tile ที่ 360px)", () => {
    renderPage(stats({ sessions: 12345 }));
    expect(screen.getByText("12,345")).toBeInTheDocument();
  });

  it("section ส่วนใหญ่ไซส์อะไร: top3 (เสมอ ⇒ เบอร์เล็กก่อน) · นอกช่วงติดป้าย · ช่วงมาจาก shopRange (ไม่ใช่ 45/68)", () => {
    renderPage(stats());
    const sec = screen.getByRole("heading", { name: "ส่วนใหญ่ไซส์อะไร" }).closest("section") as HTMLElement;
    const chips = within(sec).getAllByRole("listitem");
    expect(chips.map((c) => c.querySelector("p")?.textContent)).toEqual(["เบอร์ 54", "เบอร์ 55", "เบอร์ 53"]);
    // ช่วงร้านในข้อความมาจาก RPC (50–60)
    expect(within(sec).getByText("เบอร์ 50–60 (ช่วงที่ร้านทำ)")).toBeInTheDocument();
    expect(within(sec).getByText("ต่ำกว่าเบอร์ 50 (นอกช่วงที่ร้านทำ)")).toBeInTheDocument();
    expect(within(sec).getByText("สูงกว่าเบอร์ 60 (นอกช่วงที่ร้านทำ)")).toBeInTheDocument();
    expect(sec.textContent).not.toMatch(/45|68/);
    // ตารางเบอร์ = 11 แถว (50..60) ครบรวมเบอร์ที่เป็น 0 — ไม่ใช่ 24 แถวตาม 45–68
    const tables = within(sec).getAllByRole("table");
    const sizeTable = tables[1];
    expect(within(sizeTable).getAllByRole("row").length).toBe(1 + 11);
    // อันดับบนตาราง = ข้อความ ไม่พึ่งสีอย่างเดียว
    expect(within(sizeTable).getByText("อันดับ 1")).toBeInTheDocument();
    expect(within(sizeTable).getByText("อันดับ 2")).toBeInTheDocument();
    expect(within(sizeTable).getByText("อันดับ 3")).toBeInTheDocument();
  });

  it("top3 มีเบอร์นอกช่วงร้าน ⇒ Badge 'นอกช่วงที่ร้านทำ' ที่ชิปนั้น", () => {
    renderPage(stats({ resultSizes: [{ size: 40, count: 9 }, { size: 54, count: 5 }] }));
    const sec = screen.getByRole("heading", { name: "ส่วนใหญ่ไซส์อะไร" }).closest("section") as HTMLElement;
    const chip = within(sec).getAllByRole("listitem")[0];
    expect(chip).toHaveTextContent("เบอร์ 40");
    expect(chip).toHaveTextContent("นอกช่วงที่ร้านทำ");
  });

  it("ไม่ได้ shopRange จาก RPC ⇒ ไม่วาดช่วง/ตารางเบอร์ ไม่ fallback 45/68", () => {
    renderPage(stats({ shopRange: null }));
    const sec = screen.getByRole("heading", { name: "ส่วนใหญ่ไซส์อะไร" }).closest("section") as HTMLElement;
    expect(within(sec).getByText("ยังไม่มีข้อมูลช่วงเบอร์ที่ร้านทำ")).toBeInTheDocument();
    expect(within(sec).queryAllByRole("table").length).toBe(0);
    expect(sec.textContent).not.toMatch(/45|68/);
  });

  it("measured = 0 แต่ sessions > 0 ⇒ 'ยังไม่มีใครวัดได้เบอร์' ไม่ใช่ตารางศูนย์ 24 แถว", () => {
    renderPage(stats({ measured: 0, resultSizes: [], sizeSummary: { belowRange: 0, inRange: 0, aboveRange: 0, betweenCount: 0 } }));
    const sec = screen.getByRole("heading", { name: "ส่วนใหญ่ไซส์อะไร" }).closest("section") as HTMLElement;
    expect(within(sec).getByText("ยังไม่มีใครวัดได้เบอร์ในช่วงนี้")).toBeInTheDocument();
    expect(within(sec).queryAllByRole("table").length).toBe(0);
  });

  it("วัดด้วยอะไร: แถวเปลี่ยนวิธี (switched) · ก้ำกึ่งเฉพาะกระดาษ · ข้อสังเกต · ไม่มีสีเตือน (Q3)", () => {
    renderPage(stats());
    const sec = screen.getByRole("heading", { name: "วัดด้วยอะไร" }).closest("section") as HTMLElement;
    expect(sec).toHaveTextContent("ลองกระดาษแล้วเปลี่ยนมาใช้แหวนวงเดิม 9 ครั้ง");
    expect(sec).toHaveTextContent("ลองแหวนวงเดิมแล้วเปลี่ยนมาใช้กระดาษ 4 ครั้ง");
    const between = within(sec).getByText("ผลก้ำกึ่งระหว่างเบอร์").closest("tr") as HTMLElement;
    const cells = within(between).getAllByRole("cell");
    expect(cells[0]).toHaveTextContent("—"); // แหวนวงเดิม: ไม่มีก้ำกึ่ง
    expect(cells[1]).toHaveTextContent("21");
    expect(sec).toHaveTextContent("ไม่ใช่ความแม่นจริง");
    expect(sec).toHaveTextContent("เทียบสองวิธีไม่ได้");
    // Q3: แสดงตัวเลขอย่างเดียว ไม่มีสีเตือน (ไม่มี class แดง/amber/ส้ม ในส่วนนี้)
    expect(sec.innerHTML).not.toMatch(/text-red|bg-red|amber|orange/);
    // ตัวเลขวัดซ้ำต่อวิธีมาจาก method_stats
    const remeasured = within(sec).getByText("วัดซ้ำ 2 ครั้งขึ้นไป").closest("tr") as HTMLElement;
    expect(remeasured).toHaveTextContent("14");
    expect(remeasured).toHaveTextContent("17");
  });

  it("code review #1: วัดซ้ำ/ก้ำกึ่ง ฐาน = picked (ไม่ใช่ measured) — วัดกระดาษ 2 รอบแล้วไปจบที่แหวนเดิม ต้องไม่ทำ % กระดาษพอง/ถูก clamp", () => {
    // B: picked 80 · measured 30 (ผลล่าสุดเป็นกระดาษแค่ 30) แต่ remeasured 40 / between 48 > measured (คนที่ไปจบที่แหวนเดิม = b_to_a)
    renderPage(
      stats({
        methodStats: {
          A: { picked: 125, measured: 98, abandonedAtMeasure: 12, invalidSessions: 5, remeasured: 25, between: null },
          B: { picked: 80, measured: 30, abandonedAtMeasure: 9, invalidSessions: 8, remeasured: 40, between: 48 },
        },
      })
    );
    const sec = screen.getByRole("heading", { name: "วัดด้วยอะไร" }).closest("section") as HTMLElement;
    const remeasured = within(sec).getByText("วัดซ้ำ 2 ครั้งขึ้นไป").closest("tr") as HTMLElement;
    const rc = within(remeasured).getAllByRole("cell");
    expect(rc[0]).toHaveTextContent("20%"); // 25/125
    expect(rc[1]).toHaveTextContent("40");
    expect(rc[1]).toHaveTextContent("50%"); // 40/80 — ฐานเดิม (measured 30) จะได้ 133% → clamp 100%
    expect(rc[1].textContent).not.toMatch(/100%/);
    const between = within(sec).getByText("ผลก้ำกึ่งระหว่างเบอร์").closest("tr") as HTMLElement;
    const bc = within(between).getAllByRole("cell");
    expect(bc[1]).toHaveTextContent("48");
    expect(bc[1]).toHaveTextContent("60%"); // 48/80
    expect(bc[1].textContent).not.toMatch(/100%/);
    // ป้ายฐานบอกตรงกับที่คำนวณ
    expect(remeasured).toHaveTextContent("ฐาน = ครั้งที่ใช้วิธีนั้น");
    expect(between).toHaveTextContent("ฐาน = ครั้งที่ใช้กระดาษ");
    expect(sec.textContent).not.toMatch(/ฐาน = วัดได้เบอร์/);
  });

  it("code review #1: ฐาน picked ต่อวิธี <30 ⇒ 'จาก N' (ต่อเซลล์) ทั้งวัดซ้ำและก้ำกึ่ง", () => {
    renderPage(
      stats({
        methodStats: {
          A: { picked: 125, measured: 98, abandonedAtMeasure: 12, invalidSessions: 5, remeasured: 25, between: null },
          B: { picked: 29, measured: 10, abandonedAtMeasure: 1, invalidSessions: 2, remeasured: 14, between: 12 },
        },
      })
    );
    const sec = screen.getByRole("heading", { name: "วัดด้วยอะไร" }).closest("section") as HTMLElement;
    for (const label of ["วัดซ้ำ 2 ครั้งขึ้นไป", "ผลก้ำกึ่งระหว่างเบอร์"]) {
      const cells = within(within(sec).getByText(label).closest("tr") as HTMLElement).getAllByRole("cell");
      expect(cells[1]).toHaveTextContent("จาก 29");
      expect(cells[1].textContent).not.toMatch(/%/);
    }
  });

  it("วัดด้วยอะไร: ฐานต่อวิธี <30 ⇒ 'จาก N' (ต่อค่า) ไม่ใช่ % — กระดาษจะเล็กนานสุด", () => {
    renderPage(
      stats({
        methodStats: {
          A: { picked: 125, measured: 98, abandonedAtMeasure: 12, invalidSessions: 5, remeasured: 14, between: null },
          B: { picked: 9, measured: 7, abandonedAtMeasure: 1, invalidSessions: 2, remeasured: 1, between: 3 },
        },
      })
    );
    const sec = screen.getByRole("heading", { name: "วัดด้วยอะไร" }).closest("section") as HTMLElement;
    const row = within(sec).getByText("ค่าวัดผิดปกติ").closest("tr") as HTMLElement;
    const cells = within(row).getAllByRole("cell");
    expect(cells[0]).toHaveTextContent(/4%/); // 5/125
    expect(cells[1]).toHaveTextContent("จาก 9");
    expect(cells[1].textContent).not.toMatch(/%/);
  });

  it("funnel: <ol> 8 ขั้น เลขขั้น = stage+1 · 'หยุดมากสุด' เฉพาะขั้นที่มากสุดในกลุ่ม 1–6 · ได้เบอร์ใช้ measured", () => {
    renderPage(stats());
    const sec = screen.getByRole("heading", { name: "คนเลิกกลางทางที่ไหน" }).closest("section") as HTMLElement;
    const items = within(sec).getAllByRole("listitem");
    expect(items).toHaveLength(8);
    expect(items[0]).toHaveTextContent("1 เปิดหน้า");
    expect(items[7]).toHaveTextContent("8 ถึงหน้าผลลัพธ์");
    expect(items[7]).toHaveTextContent("ได้เบอร์ 187");
    // abandon = [80,20,25,18,10,14,30] ⇒ มากสุดในกลุ่ม 1–6 คือ stage 6 (30) — แม้ stage 0 = 80
    const badges = within(sec).getAllByText("หยุดมากสุด");
    expect(badges).toHaveLength(1);
    expect(items[6]).toContainElement(badges[0]);
    expect(items[0]).not.toHaveTextContent("หยุดมากสุด");
  });

  it("funnel: ทุกค่า 0 ยกเว้นขั้น 1 ⇒ ไม่มี Badge · ไม่ NaN", () => {
    renderPage(stats({ funnel: [412, 0, 0, 0, 0, 0, 0, 0], abandonAt: [412, 0, 0, 0, 0, 0, 0], measured: 0, resultSizes: [] }));
    const sec = screen.getByRole("heading", { name: "คนเลิกกลางทางที่ไหน" }).closest("section") as HTMLElement;
    expect(within(sec).queryByText("หยุดมากสุด")).not.toBeInTheDocument();
    expect(sec.textContent).not.toMatch(/NaN|Infinity/);
  });

  it("measured > funnel[7] (ไม่ควรเกิด) ⇒ ไม่ crash", () => {
    expect(() => renderPage(stats({ measured: 300, funnel: [412, 332, 312, 287, 269, 259, 245, 100] }))).not.toThrow();
    expect(bodyText()).not.toMatch(/NaN|Infinity/);
  });

  it("ช่องทาง: ตารางเดียว 'เปิดในแอปอะไร' ครบ bucket · TikTok มีแถว + ข้อความไม่ใช่ลิงก์ร้าน · ไม่มี CTA ให้แปะลิงก์ TikTok · ไม่มี src", () => {
    renderPage(stats());
    const sec = screen.getByRole("heading", { name: "เปิดในแอปอะไร" }).closest("section") as HTMLElement;
    for (const l of ["LINE", "TikTok", "Facebook", "Instagram", "เบราว์เซอร์ทั่วไป", "ไม่ทราบ"]) {
      expect(within(sec).getByRole("rowheader", { name: l })).toBeInTheDocument();
    }
    expect(sec).toHaveTextContent("ไม่ใช่ลิงก์ที่ร้านวาง");
    expect(sec).toHaveTextContent("อาจจัดผิดกลุ่มได้");
    expect(sec.textContent).not.toMatch(/แปะลิงก์|ควรวางลิงก์|ลิงก์ที่ร้านแปะ/);
    expect(within(sec).queryAllByRole("link")).toHaveLength(0);
    expect(document.body.textContent).not.toMatch(/ช่องทาง\s*\(src\)|src=/);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument(); // ไม่มี select ช่องทาง
    // เรียงมาก→น้อย: LINE(150) ก่อน browser(140)
    const names = within(sec).getAllByRole("rowheader").map((r) => r.textContent);
    expect(names.slice(0, 2)).toEqual(["LINE", "เบราว์เซอร์ทั่วไป"]);
  });

  it("จุดที่คนติด: ฐาน = กดเริ่ม · ชื่อภาษาคน ไม่มีรหัส G1–G5", () => {
    renderPage(stats());
    const sec = screen.getByRole("heading", { name: "จุดที่คนติด" }).closest("section") as HTMLElement;
    expect(sec).toHaveTextContent("% ของที่กดเริ่ม 332 ครั้ง");
    expect(sec).toHaveTextContent("ซูมหน้าจออยู่ เทียบขนาดไม่ได้");
    expect(sec.textContent).not.toMatch(/\bG[1-5]\b/);
    expect(within(sec).getByText("40").closest("tr")).toHaveTextContent("12%");
  });

  it("รายวัน: ใหม่→เก่า 14 วันแรก + ปุ่มขยายทั้งหมด (aria-expanded) แล้วสลับกลับ", async () => {
    renderPage(stats());
    const sec = screen.getByRole("heading", { name: "รายวัน" }).closest("section") as HTMLElement;
    expect(within(sec).getAllByRole("listitem")).toHaveLength(14);
    expect(within(sec).getAllByRole("listitem")[0]).toHaveTextContent("3 พ.ย.");
    const btn = within(sec).getByRole("button", { name: "แสดงทั้งหมด 30 วัน" });
    expect(btn).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(btn);
    expect(within(sec).getAllByRole("listitem")).toHaveLength(30);
    expect(within(sec).getByRole("button", { name: /แสดงแค่ 14 วันล่าสุด/ })).toHaveAttribute("aria-expanded", "true");
  });

  it("รายวัน ≤ 14 วัน ⇒ ไม่มีปุ่มขยาย", () => {
    renderPage(stats({ daily: daily(7) }));
    const sec = screen.getByRole("heading", { name: "รายวัน" }).closest("section") as HTMLElement;
    expect(within(sec).queryByRole("button")).not.toBeInTheDocument();
  });

  it("data_since หลังจุดเริ่มช่วง ⇒ notice + แถวคั่น + ตัดวันก่อนหน้า (ไม่โชว์เป็น 0 ครั้ง)", () => {
    renderPage(stats({ dataSince: "2026-10-28", daily: daily(30) }));
    expect(screen.getByText(/เริ่มมีข้อมูลตั้งแต่ 28 ต\.ค\. 2569 — ก่อนหน้านั้นยังไม่ได้เก็บ/)).toBeInTheDocument();
    const sec = screen.getByRole("heading", { name: "รายวัน" }).closest("section") as HTMLElement;
    expect(within(sec).getAllByRole("listitem")).toHaveLength(7 + 1); // 28 ต.ค.–3 พ.ย. = 7 วัน + แถวคั่น
    expect(within(sec).getByText("— ก่อนวันนี้ยังไม่ได้เก็บข้อมูล —")).toBeInTheDocument();
  });

  it("การกระจายเส้นรอบวง พับไว้ (ค่าเริ่มต้นปิด) แล้วเปิดได้", async () => {
    renderPage(stats());
    const toggle = screen.getByRole("button", { name: /การกระจายเส้นรอบวง/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("อ่านก่อนตีความ: ไม่มีคำต้องห้าม (PDPA / ปลอดภัยตามกฎหมาย / session / RPC / G1–G5)", () => {
    renderPage(stats());
    expect(bodyText()).not.toMatch(/PDPA|ปลอดภัยตามกฎหมาย|session|RPC|migration|\bG[1-5]\b/i);
    expect(screen.getByRole("heading", { name: "อ่านก่อนตีความ" })).toBeInTheDocument();
  });
});

describe("section ว่าง/ไม่มี key ⇒ 'ยังไม่มีข้อมูล' ไม่ crash (ไม่พูดถึง migration)", () => {
  it("ทุก section = null", () => {
    const nulls: Partial<Data> = {
      shopRange: null,
      byInApp: null,
      funnel: null,
      abandonAt: null,
      resultSizes: null,
      sizeSummary: null,
      circHist: null,
      method: null,
      methodStats: null,
      switched: null,
      sawBetween: null,
      ref: null,
      methodXRef: null,
      cta: null,
      friction: null,
      daily: null,
    };
    expect(() => renderPage(stats(nulls))).not.toThrow();
    expect(screen.getAllByText("ยังไม่มีข้อมูล").length).toBeGreaterThanOrEqual(5);
    expect(bodyText()).not.toMatch(/migration|NaN|Infinity|undefined/i);
    expect(screen.getByText("ขั้นต่ำ — อาจนับขาดบางครั้ง")).toBeInTheDocument(); // tile LINE ยังมีป้าย แม้ไม่มีค่า
  });
});

describe("แถบกรอง — chip / กำหนดเอง / notice", () => {
  it("aria-pressed ตามช่วงที่ใช้ · กด chip push URL ที่ถูกต้อง (30 วัน = URL สะอาด)", async () => {
    renderPage(stats(), { from: "2026-10-28", to: TODAY, range: "7d" });
    expect(screen.getByRole("button", { name: "7 วัน" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "30 วัน" })).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(screen.getByRole("button", { name: "30 วัน" }));
    expect(pushMock).toHaveBeenLastCalledWith("/marketing/ring-size");
    await userEvent.click(screen.getByRole("button", { name: "180 วัน" }));
    expect(pushMock).toHaveBeenLastCalledWith("/marketing/ring-size?range=180d");
    expect(pushMock.mock.calls.every((c) => !String(c[0]).includes("src"))).toBe(true);
  });

  it("กำหนดเอง: เปลี่ยนวันที่ไม่ push (U5) · ต้องกด 'ดูข้อมูล' · push เป็น from/to", async () => {
    renderPage(stats());
    await userEvent.click(screen.getByRole("button", { name: "กำหนดเอง" }));
    const form = screen.getByRole("form", { name: "กำหนดช่วงวันที่เอง" });
    const [fromInput, toInput] = within(form).getAllByLabelText(/ตั้งแต่|ถึง/) as HTMLInputElement[];
    fireEvent.change(fromInput, { target: { value: "2026-09-26" } });
    fireEvent.change(toInput, { target: { value: "2026-10-25" } });
    expect(pushMock).not.toHaveBeenCalled();
    await userEvent.click(within(form).getByRole("button", { name: "ดูข้อมูล" }));
    expect(pushMock).toHaveBeenCalledWith("/marketing/ring-size?from=2026-09-26&to=2026-10-25");
  });

  it("กำหนดเอง: ช่วงสั้นกว่า 7 วัน / ย้อนเกิน 180 วัน / from>to / ในอนาคต ⇒ แจ้งผิด ไม่ push", async () => {
    renderPage(stats());
    await userEvent.click(screen.getByRole("button", { name: "กำหนดเอง" }));
    const form = screen.getByRole("form", { name: "กำหนดช่วงวันที่เอง" });
    const [fromInput, toInput] = within(form).getAllByLabelText(/ตั้งแต่|ถึง/) as HTMLInputElement[];
    const submit = within(form).getByRole("button", { name: "ดูข้อมูล" });
    const cases: [string, string][] = [
      ["2026-10-30", "2026-11-03"], // 5 วัน
      ["2026-05-01", "2026-11-03"], // เกิน 180 วัน
      ["2026-11-03", "2026-10-01"], // from > to
      ["2026-10-20", "2026-12-25"], // to อนาคต
      ["2025-01-01", "2025-02-01"], // ก่อนเริ่มเก็บ (เก่ากว่า 180 วัน)
    ];
    for (const [from, to] of cases) {
      fireEvent.change(fromInput, { target: { value: from } });
      fireEvent.change(toInput, { target: { value: to } });
      await userEvent.click(submit);
      expect(screen.getByRole("alert")).toBeInTheDocument();
    }
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("กำหนดเอง: input มี min = วันนี้−179 และ max = วันนี้ (ไทย)", async () => {
    renderPage(stats());
    await userEvent.click(screen.getByRole("button", { name: "กำหนดเอง" }));
    const form = screen.getByRole("form", { name: "กำหนดช่วงวันที่เอง" });
    for (const input of within(form).getAllByLabelText(/ตั้งแต่|ถึง/) as HTMLInputElement[]) {
      expect(input.min).toBe("2026-05-08");
      expect(input.max).toBe(TODAY);
    }
  });

  it("notice ที่ server ปรับ URL ให้ แสดงเป็น role=status (ไม่ปรับเงียบ)", () => {
    renderPage(stats(), F30, { notices: ["ปรับช่วงวันที่ให้ไม่เกิน 180 วัน"] });
    expect(screen.getByText("ปรับช่วงวันที่ให้ไม่เกิน 180 วัน").closest("[role=status]")).toBeInTheDocument();
  });

  it("สรุปช่วงที่กำลังดู + วันเริ่มมีข้อมูล + ข้อความ retention 180 วัน", () => {
    renderPage(stats());
    expect(screen.getByText(/แสดง 5 ต\.ค\. 2569 – 3 พ\.ย\. 2569 · เริ่มมีข้อมูล 1 ต\.ค\. 2569/)).toBeInTheDocument();
    expect(screen.getByText("ระบบเก็บข้อมูลย้อนหลัง 180 วัน")).toBeInTheDocument();
  });
});

describe("ความปลอดภัยของ DOM (เคส 8)", () => {
  it("ป้าย/ข้อความที่มาจากข้อมูลไม่ถูกตีความเป็น HTML", () => {
    renderPage(stats(), F30, { notices: ['<img src=x onerror="window.__x=1">'] });
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByText(/<img src=x/)).toBeInTheDocument();
  });
});
