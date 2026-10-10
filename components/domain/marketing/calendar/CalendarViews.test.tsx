// @vitest-environment jsdom
// ปฏิทินใหม่: 3 มุมมอง · งานหลายวันคร่อมสิ้นเดือน · ธง/ปุ่มเลื่อน · แผนเดิม · ตัวกรอง · เพิ่มชิ้นงาน (ไม่แตะ DB — action ถูก mock)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { ToastProvider } from "@/components/ui/Toast";

afterEach(cleanup);

const replace = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh, push: vi.fn() }), usePathname: () => "/marketing/calendar" }));
const createPiece = vi.fn();
vi.mock("@/lib/actions/content-calendar", () => ({ createPiece: (...a: unknown[]) => createPiece(...a) }));
vi.mock("@/lib/actions/content-pieces", () => ({ deferPiece: vi.fn(), advancePiece: vi.fn() }));
const createManualTask = vi.fn();
vi.mock("@/lib/actions/calendar", () => ({ createManualTask: (...a: unknown[]) => createManualTask(...a) }));

import { CalendarToolbar, LegacyLane, ListView, MonthView, WeekView } from "./CalendarViews";
import { CalendarPieceCard, canDeferPiece } from "./CalendarPieceCard";
import { CalendarOverdue } from "./CalendarOverdue";
import { mapPieceRow } from "@/lib/marketing/piece-types";
import type { PieceRow } from "@/lib/marketing/piece-types";
import type { LegacyStep } from "@/lib/marketing/calendar-types";

const TYPES = [{ code: "know", labelTh: "ความรู้", colorHex: "#1f3a5f", sortOrder: 1 }];
const TODAY = "2026-10-09";

function piece(over: Record<string, unknown> = {}): PieceRow {
  return mapPieceRow({
    step_id: "s" + Math.random().toString(36).slice(2, 8),
    campaign_id: "c1",
    title: "ชิ้นทดสอบ",
    piece_status: "planned",
    effective_piece_status: "planned",
    piece_kind: "short_clip",
    channel: "tiktok",
    resolved_start: "2026-10-08",
    ...over,
  });
}

const wrap = (ui: React.ReactNode) => render(<ToastProvider>{ui}</ToastProvider>);

describe("WeekView", () => {
  it("7 วัน · วันนี้มี aria-current และป้าย 'วันนี้' · วันว่างบอก 'ไม่มีชิ้นงาน'", () => {
    wrap(<WeekView weekFrom="2026-10-05" pieces={[piece({ title: "คลิป A" })]} festivals={[]} contentTypes={TYPES} todayTh={TODAY} />);
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(7);
    expect(screen.getByText("คลิป A")).toBeInTheDocument();
    expect(screen.getAllByText("ไม่มีชิ้นงาน")).toHaveLength(6);
    const today = document.querySelector('[aria-current="date"]');
    expect(today).toHaveTextContent("ศุกร์");
    expect(today).toHaveTextContent("วันนี้");
  });

  it("งานหลายวันคร่อมสิ้นเดือน (30 ต.ค.–1 พ.ย.) = แถบเดียวบนหัวสัปดาห์ ไม่ซ้ำในช่องวัน · กดแถบไปหน้าชิ้นงาน", () => {
    const span = piece({ title: "งานคร่อมเดือน", resolved_start: "2026-10-30", resolved_end: "2026-11-01" });
    wrap(<WeekView weekFrom="2026-10-26" pieces={[span]} festivals={[]} contentTypes={TYPES} todayTh={TODAY} />);
    // ไม่มีในช่องวันใดเลย
    const dayList = document.querySelector("ol") as HTMLElement;
    expect(within(dayList).queryByText("งานคร่อมเดือน")).not.toBeInTheDocument();
    // มีในแถบ PC (ลิงก์) และรายการรวมมือถือ (การ์ด) อย่างละที่เดียว
    const links = screen.getAllByRole("link", { name: /งานคร่อมเดือน/ });
    expect(links.length).toBe(2);
    for (const l of links) expect(l).toHaveAttribute("href", `/marketing/pieces/${span.stepId}?from=calendar`);
    expect(screen.getByText(/งานต่อเนื่อง 1 รายการ/)).toBeInTheDocument();
    expect(document.querySelector("details")?.hasAttribute("open")).toBe(false); // พับไว้ — กางได้
    expect(screen.getAllByText(/30 ต\.ค\. – 1 พ\.ย\./).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/ช่วง/).length).toBeGreaterThan(0);
  });

  it("แถบพาดช่วงวัน: ตัดให้อยู่ในสัปดาห์ · สัปดาห์ถัดไปของงานเดิมก็มีแถบ (ไม่หายตอนข้ามเดือน)", () => {
    const span = piece({ title: "งานคร่อมเดือน", resolved_start: "2026-10-30", resolved_end: "2026-11-03" });
    wrap(<WeekView weekFrom="2026-11-02" pieces={[span]} festivals={[]} contentTypes={TYPES} todayTh={TODAY} />);
    expect(screen.getAllByRole("link", { name: /งานคร่อมเดือน/ }).length).toBe(2);
  });

  it("งานวันเดียวยังอยู่ในช่องวัน · ไม่มีแถบเมื่อไม่มีงานหลายวัน", () => {
    wrap(<WeekView weekFrom="2026-10-05" pieces={[piece({ title: "วันเดียว" })]} festivals={[]} contentTypes={TYPES} todayTh={TODAY} />);
    expect(screen.queryByText(/งานต่อเนื่อง d+ รายการ/)).not.toBeInTheDocument();
    expect(within(document.querySelector("ol") as HTMLElement).getByText("วันเดียว")).toBeInTheDocument();
  });

  it("เทศกาลหลายวัน = แถบ (PC) + รายการรวม (มือถือ) ไม่ซ้ำทุกวัน · ไม่มีแถวโฮสต์รายวัน", () => {
    wrap(
      <WeekView
        weekFrom="2026-10-05"
        pieces={[]}
        festivals={[{ name: "กินเจ", from: "2026-10-10", to: "2026-10-18" }]}
        contentTypes={TYPES}
        todayTh={TODAY}
      />
    );
    expect(screen.getAllByText(/เทศกาล: กินเจ/)).toHaveLength(2); // เสาร์ + อาทิตย์
    expect(screen.queryByText(/โฮสต์ A|งดไลฟ์|ยังไม่ระบุโฮสต์/)).not.toBeInTheDocument();
  });

  it("เรียงในวัน: มีเวลาก่อน → ช่วง → ไม่ระบุ", () => {
    const rows = [
      piece({ title: "ไม่ระบุ" }),
      piece({ title: "ก่อนไลฟ์", time_slot: "before_live" }),
      piece({ title: "ตอนเช้าตรู่", start_time: "07:00" }),
    ];
    wrap(<WeekView weekFrom="2026-10-05" pieces={rows} festivals={[]} contentTypes={TYPES} todayTh={TODAY} />);
    const titles = screen.getAllByText(/ไม่ระบุ|ก่อนไลฟ์|ตอนเช้าตรู่/, { selector: "span.font-semibold.leading-snug" }).map((e) => e.textContent);
    expect(titles).toEqual(["ตอนเช้าตรู่", "ก่อนไลฟ์", "ไม่ระบุ"]);
  });
});

describe("CalendarPieceCard", () => {
  it("ลิงก์ไปหน้าชิ้นงาน · ธงเป็นข้อความ (ต้องถ่าย/รอเงื่อนไข/ต้องยืนยัน/ยังไม่วางลิงก์) ตาม flag_* จาก DB", () => {
    const p = piece({
      title: "การ์ดธง",
      flag_needs_shoot: true,
      flag_on_hold: true,
      hold_reason: "รอของ",
      flag_confirm_pending: true,
      flag_no_link_overdue: true,
    });
    wrap(<CalendarPieceCard piece={p} contentTypes={TYPES} todayTh={TODAY} />);
    expect(screen.getByRole("link", { name: /การ์ดธง/ })).toHaveAttribute("href", `/marketing/pieces/${p.stepId}?from=calendar`);
    for (const t of ["ต้องถ่าย", "รอเงื่อนไข", "ต้องยืนยัน", "ยังไม่วางลิงก์"]) expect(screen.getByText(t)).toBeInTheDocument();
    expect(screen.getByText(/รอ: รอของ/)).toBeInTheDocument();
  });

  it("มีภาพแล้ว แสดงเมื่อ footage has/shot และไม่ใช่ posted และไม่ซ้อนกับ ต้องถ่าย", () => {
    wrap(<CalendarPieceCard piece={piece({ footage_status: "has_footage" })} contentTypes={TYPES} todayTh={TODAY} />);
    expect(screen.getByText("มีภาพแล้ว")).toBeInTheDocument();
  });

  it("ปุ่มเลื่อนวัน: มีเฉพาะ planned..produced ที่มีวัน — idea/posted/cancelled ไม่แสดงปุ่มที่ DB จะปฏิเสธ", () => {
    for (const s of ["planned", "drafting", "in_review", "approved", "produced"]) {
      expect(canDeferPiece({ pieceStatus: s, resolvedStart: "2026-10-09" }), s).toBe(true);
    }
    for (const s of ["idea", "posted", "cancelled"]) expect(canDeferPiece({ pieceStatus: s, resolvedStart: "2026-10-09" }), s).toBe(false);
    expect(canDeferPiece({ pieceStatus: "planned", resolvedStart: null })).toBe(false);
    wrap(<CalendarPieceCard piece={piece({ piece_status: "posted", effective_piece_status: "posted" })} contentTypes={TYPES} todayTh={TODAY} />);
    expect(screen.queryByRole("button", { name: /เลื่อนวัน/ })).not.toBeInTheDocument();
  });

  it("กดเลื่อน → กล่องเหตุผลบังคับ (ไม่ลากวาง) · ปุ่มยืนยันปิดจนใส่เหตุผลและวันใหม่", async () => {
    wrap(<CalendarPieceCard piece={piece({ title: "เลื่อนฉัน" })} contentTypes={TYPES} todayTh={TODAY} />);
    await userEvent.click(screen.getByRole("button", { name: /เลื่อนวัน เลื่อนฉัน/ }));
    const dlg = await screen.findByRole("dialog");
    expect(within(dlg).getByRole("button", { name: "เลื่อนวัน" })).toBeDisabled();
  });
});

describe("MonthView", () => {
  it("จำนวนชิ้นเป็นข้อความ (ไม่ใช่จุดอย่างเดียว) · งานหลายวันนับทุกวัน · วันที่เลือกแสดงรายการด้านล่าง", () => {
    const rows = [piece({ title: "หลายวัน", resolved_start: "2026-10-30", resolved_end: "2026-11-01" }), piece({ title: "วันเดียว", resolved_start: "2026-10-31" })];
    wrap(
      <MonthView
        state={{ view: "month", d: "2026-10-31" }}
        anchor="2026-10-31"
        selectedDay="2026-10-31"
        pieces={rows}
        festivals={[]}
        contentTypes={TYPES}
        todayTh={TODAY}
      />
    );
    const cell31 = screen.getByRole("link", { name: /31 ต\.ค\./ });
    expect(cell31).toHaveTextContent("2 ชิ้น");
    expect(screen.getByRole("link", { name: /1 พ\.ย\./ })).toHaveTextContent("1 ชิ้น");
    expect(screen.getAllByText("หลายวัน").length).toBeGreaterThan(0);
    expect(screen.getByText("วันเดียว")).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader")).toHaveLength(7);
  });
  it("วันที่ไม่มีงาน: บอกชัดและชี้ปุ่มเพิ่ม", () => {
    wrap(<MonthView state={{ view: "month" }} anchor="2026-10-15" selectedDay="2026-10-15" pieces={[]} festivals={[]} contentTypes={TYPES} todayTh={TODAY} />);
    expect(screen.getByText(/ไม่มีชิ้นงานในวันนี้/)).toBeInTheDocument();
  });
});

describe("ListView", () => {
  it("เฉพาะวันที่มีงาน · ว่างทั้งเดือนมีข้อความ", () => {
    wrap(<ListView anchor="2026-10-15" pieces={[piece({ title: "ข", resolved_start: "2026-10-20" })]} festivals={[]} contentTypes={TYPES} todayTh={TODAY} />);
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(1);
    cleanup();
    wrap(<ListView anchor="2026-10-15" pieces={[]} festivals={[]} contentTypes={TYPES} todayTh={TODAY} />);
    expect(screen.getByText(/ไม่มีชิ้นงานใน/)).toBeInTheDocument();
  });
});

describe("LegacyLane — แผนเดิมไม่หาย", () => {
  const steps: LegacyStep[] = [
    {
      stepId: "old-1",
      campaignId: "c9",
      campaignName: "โปร 9.9",
      campaignType: "promo",
      title: "ส่ง LINE broadcast",
      resolvedStart: "2026-10-07",
      resolvedEnd: null,
      channel: "line_oa",
      startTime: "20:00",
      effectiveStatus: "scheduled",
      contentTypeCode: "know",
      stepOrigin: "template",
    },
  ];
  it("ลิงก์ไปหน้าเดิม /marketing/calendar/[id] · ป้าย 'แผนเดิม' · ไม่มีปุ่มเขียนข้อมูล", () => {
    wrap(<LegacyLane steps={steps} from="2026-10-05" to="2026-10-11" contentTypes={TYPES} filtersActive={false} />);
    expect(screen.getByRole("link", { name: /ส่ง LINE broadcast/ })).toHaveAttribute("href", "/marketing/calendar/old-1");
    expect(screen.getAllByText("แผนเดิม").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
  it("ไม่มี step เก่า = ไม่แสดงส่วนนี้ · มีตัวกรอง = บอกว่าไม่ใช้กับแผนเดิม", () => {
    const { container } = wrap(<LegacyLane steps={[]} from="a" to="b" contentTypes={[]} filtersActive={false} />);
    expect(container.textContent).toBe("");
    cleanup();
    wrap(<LegacyLane steps={steps} from="2026-10-05" to="2026-10-11" contentTypes={TYPES} filtersActive />);
    expect(screen.getByText(/ตัวกรองด้านบนไม่ใช้กับแผนเดิม/)).toBeInTheDocument();
  });
});

describe("CalendarOverdue", () => {
  it("แสดงชื่อ+วัน+สถานะ+ปุ่ม เลื่อน/ยกเลิก (เลื่อนเฉพาะที่ DB อนุญาต) · ว่าง = ไม่แสดง", async () => {
    const { container } = wrap(<CalendarOverdue pieces={[]} todayTh={TODAY} />);
    expect(container.textContent).toBe("");
    cleanup();
    wrap(<CalendarOverdue pieces={[piece({ title: "ค้างอยู่", resolved_start: "2026-10-04" })]} todayTh={TODAY} />);
    expect(screen.getAllByText("ค้างอยู่").length).toBeGreaterThan(0);
    expect(screen.getByText(/ค้าง 1 ชิ้น/)).toBeInTheDocument(); // บรรทัดพับของมือถือ
    await userEvent.click(screen.getAllByRole("button", { name: "ยกเลิก" })[0]);
    expect(await screen.findByRole("dialog")).toHaveTextContent("ยกเลิกชิ้นงาน");
  });
});

describe("CalendarOverdue — code review ข้อ 8", () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => piece({ title: `ค้างชิ้น${i + 1}`, resolved_start: "2026-10-04", step_id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}` }));
  const pc = (container: HTMLElement) => container.querySelector('[class~="lg:block"]') as HTMLElement; // ชุด PC (รายการเต็ม)

  it("มุมมองปกติ: แสดง 3 ชิ้น + 'และอีก n ชิ้น' เป็นลิงก์ไปชิ้นงานทั้งหมด", () => {
    const { container } = wrap(<CalendarOverdue pieces={many(5)} todayTh={TODAY} />);
    const desk = pc(container);
    expect(within(desk).getAllByRole("listitem")).toHaveLength(3);
    expect(within(desk).getByText(/และอีก 2 ชิ้น/)).toBeInTheDocument();
    expect(within(desk).getByRole("link", { name: "ดูทั้งหมดที่ชิ้นงานทั้งหมด" })).toHaveAttribute("href", "/marketing/pieces");
  });

  it("มุมมองรายการ (showAll): แสดงครบทุกชิ้นที่โหลด ไม่มี 'และอีก n ชิ้น'", () => {
    const { container } = wrap(<CalendarOverdue pieces={many(5)} todayTh={TODAY} showAll />);
    const desk = pc(container);
    expect(within(desk).getAllByRole("listitem")).toHaveLength(5);
    expect(within(desk).queryByText(/และอีก/)).not.toBeInTheDocument();
  });

  it("showAll แต่ถึงเพดานที่ action ส่งมา (12) → บอกว่าอาจมีมากกว่า + ลิงก์ (ไม่ตัดเงียบ)", () => {
    const { container } = wrap(<CalendarOverdue pieces={many(12)} todayTh={TODAY} showAll />);
    expect(within(pc(container)).getByText(/อาจมีมากกว่านี้/)).toBeInTheDocument();
    cleanup();
    const { container: c2 } = wrap(<CalendarOverdue pieces={many(11)} todayTh={TODAY} showAll />);
    expect(within(pc(c2)).queryByText(/อาจมีมากกว่านี้/)).not.toBeInTheDocument();
  });

  it("กล่องที่มีปุ่มไม่ใช่ live region (ไม่มี role=status)", () => {
    const { container } = wrap(<CalendarOverdue pieces={many(1)} todayTh={TODAY} />);
    expect(container.querySelector('[role="status"]')).toBeNull();
  });
});

describe("CalendarToolbar", () => {
  const options = { campaigns: [{ value: "c1", label: "ปิดเดือน" }], channels: [{ value: "tiktok", label: "TikTok" }], statuses: [], types: [] };
  it("‹ › วันนี้ เป็นลิงก์คง view/filter · มุมมองมี aria-current · ปุ่มเพิ่มชิ้นงาน", () => {
    wrap(<CalendarToolbar state={{ view: "week", d: "2026-10-08", campaign: "c1" }} anchor="2026-10-08" todayTh={TODAY} options={options} typeLabels={{}} />);
    expect(screen.getByRole("link", { name: "สัปดาห์ก่อน" })).toHaveAttribute("href", "/marketing/calendar?view=week&d=2026-10-01&campaign=c1");
    expect(screen.getByRole("link", { name: "สัปดาห์ถัดไป" })).toHaveAttribute("href", "/marketing/calendar?view=week&d=2026-10-15&campaign=c1");
    expect(screen.getByRole("link", { name: "วันนี้" })).toHaveAttribute("href", "/marketing/calendar?view=week&d=2026-10-09&campaign=c1");
    const nav = screen.getByRole("navigation", { name: "มุมมองปฏิทิน" });
    expect(within(nav).getByRole("link", { name: "สัปดาห์" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "เดือน" })).toHaveAttribute("href", "/marketing/calendar?view=month&d=2026-10-08&campaign=c1");
    expect(screen.getByRole("button", { name: /เพิ่มชิ้นงาน/ })).toBeInTheDocument();
  });
  it("เดือน: ‹ › เปลี่ยนทีละเดือน", () => {
    wrap(<CalendarToolbar state={{ view: "month", d: "2026-10-31" }} anchor="2026-10-31" todayTh={TODAY} options={options} typeLabels={{}} />);
    expect(screen.getByRole("link", { name: "เดือนถัดไป" })).toHaveAttribute("href", "/marketing/calendar?view=month&d=2026-11-01");
  });
  it("เปลี่ยนตัวกรอง → router.replace ไป URL ที่คง view/วัน (ใช้ชุดบน PC)", async () => {
    replace.mockClear();
    wrap(<CalendarToolbar state={{ view: "week", d: "2026-10-08" }} anchor="2026-10-08" todayTh={TODAY} options={options} typeLabels={{}} />);
    const sel = document.getElementById("cal-d-channel") as HTMLSelectElement;
    await userEvent.selectOptions(sel, "tiktok");
    expect(replace).toHaveBeenCalledWith("/marketing/calendar?view=week&d=2026-10-08&channel=tiktok", { scroll: false });
  });
});

describe("เพิ่มชิ้นงาน (content_piece_create)", () => {
  beforeEach(() => {
    createPiece.mockReset();
    refresh.mockClear();
  });
  async function open() {
    wrap(<CalendarToolbar state={{ view: "week", d: "2026-10-12" }} anchor="2026-10-12" todayTh={TODAY} options={{ campaigns: [], channels: [], statuses: [], types: [] }} typeLabels={{}} />);
    await userEvent.click(screen.getByRole("button", { name: /เพิ่มชิ้นงาน/ }));
    return await screen.findByRole("dialog");
  }
  it("ช่องทางถูกตัดให้เข้าคู่กับชนิด (ไม่ให้เลือกแล้วฟ้อง) · ปุ่มส่งปิดจนกรอกครบ", async () => {
    const dlg = await open();
    const send = within(dlg).getByRole("button", { name: "เพิ่มชิ้นงาน" });
    expect(send).toBeDisabled();
    expect(within(dlg).getByLabelText("ช่องทาง")).toBeDisabled();
    await userEvent.selectOptions(within(dlg).getByLabelText("ชนิดชิ้นงาน"), "line_message");
    const options = within(within(dlg).getByLabelText("ช่องทาง")).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["เลือกช่องทาง", "LINE OA"]);
    await userEvent.selectOptions(within(dlg).getByLabelText("ชนิดชิ้นงาน"), "short_clip");
    expect(within(within(dlg).getByLabelText("ช่องทาง")).getAllByRole("option").map((o) => o.textContent)).toEqual(["เลือกช่องทาง", "TikTok", "TikTok LIVE"]);
  });
  it("กรอกครบ → เรียก createPiece ด้วยค่าที่เลือก · สำเร็จแล้ว refresh · ล้มเหลวคงค่าที่พิมพ์", async () => {
    createPiece.mockResolvedValueOnce({ ok: false, error: "วันที่อยู่นอกช่วง" }).mockResolvedValueOnce({ ok: true, data: { stepId: "x" } });
    const dlg = await open();
    await userEvent.type(within(dlg).getByLabelText("ชื่อชิ้นงาน"), "คลิปใหม่");
    await userEvent.selectOptions(within(dlg).getByLabelText("ชนิดชิ้นงาน"), "short_clip");
    await userEvent.selectOptions(within(dlg).getByLabelText("ช่องทาง"), "tiktok");
    await userEvent.click(within(dlg).getByRole("radio", { name: "เงินแท่ง" }));
    const send = within(dlg).getByRole("button", { name: "เพิ่มชิ้นงาน" });
    expect(send).toBeEnabled();
    await userEvent.click(send);
    expect(createPiece).toHaveBeenCalledWith({ title: "คลิปใหม่", pieceKind: "short_clip", channel: "tiktok", customerGroup: "silver_bar", date: "2026-10-12" });
    expect(await within(dlg).findByRole("alert")).toHaveTextContent("วันที่อยู่นอกช่วง");
    expect(within(dlg).getByLabelText("ชื่อชิ้นงาน")).toHaveValue("คลิปใหม่");
    await userEvent.click(send);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});

describe("งานหลายวันในเดือน/รายการ (มติเจ้าของ 10 ต.ค.)", () => {
  const span = piece({ title: "กินเจ", resolved_start: "2026-10-10", resolved_end: "2026-10-18" });
  it("เดือน: นับทุกวันที่คร่อมแต่ติดเครื่องหมาย ↔ + คำอธิบายว่าเป็นงานต่อเนื่อง · การ์ดของวันที่เลือกบอกช่วงวัน", () => {
    wrap(<MonthView state={{ view: "month" }} anchor="2026-10-12" selectedDay="2026-10-12" pieces={[span]} festivals={[]} contentTypes={TYPES} todayTh={TODAY} />);
    expect(screen.getByRole("link", { name: /12 ต.ค./ })).toHaveAccessibleName(/รวมงานต่อเนื่อง 1/);
    expect(screen.getByText(/รวมงานต่อเนื่องหลายวัน/)).toBeInTheDocument();
    expect(screen.getAllByText("ต่อเนื่อง").length).toBe(1);
    expect(screen.getByText(/ช่วง .*10 ต.ค./)).toBeInTheDocument();
  });
  it("รายการ: แสดงครั้งเดียวที่วันเริ่ม พร้อมช่วงวัน (ไม่ซ้ำทุกวัน)", () => {
    wrap(<ListView anchor="2026-10-15" pieces={[span]} festivals={[]} contentTypes={TYPES} todayTh={TODAY} />);
    expect(screen.getAllByText("กินเจ")).toHaveLength(1);
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(1);
    expect(screen.getByText(/ช่วง/)).toBeInTheDocument();
  });
  it("รายการ: งานที่เริ่มก่อนเดือนนี้ → แสดงครั้งเดียวที่วันแรกของเดือน", () => {
    const early = piece({ title: "ข้ามเดือน", resolved_start: "2026-09-25", resolved_end: "2026-10-03" });
    wrap(<ListView anchor="2026-10-15" pieces={[early]} festivals={[]} contentTypes={TYPES} todayTh={TODAY} />);
    expect(screen.getAllByText("ข้ามเดือน")).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("1");
  });
  it("รายการ: เทศกาลหลายวันแสดงครั้งเดียว", () => {
    wrap(<ListView anchor="2026-10-15" pieces={[]} festivals={[{ name: "กินเจ", from: "2026-10-10", to: "2026-10-18" }]} contentTypes={TYPES} todayTh={TODAY} />);
    expect(screen.getAllByText(/เทศกาล: กินเจ/)).toHaveLength(1);
  });
});

describe("AddMenu — เพิ่มชิ้นงาน + เพิ่มแผนเดิม คู่กัน (มติเจ้าของ 10 ต.ค.)", () => {
  const options = { campaigns: [], channels: [], statuses: [], types: [] };
  const mount = () => wrap(<CalendarToolbar state={{ view: "week", d: "2026-10-12" }} anchor="2026-10-12" todayTh={TODAY} options={options} typeLabels={{}} />);
  it("PC: ปุ่มสองปุ่มชื่อไม่สับสน", () => {
    mount();
    expect(screen.getByRole("button", { name: /เพิ่มชิ้นงาน/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /เพิ่มแผนเดิม/ })).toBeInTheDocument();
  });
  it("BUG-QA-2: เมนูมือถือชิดซ้ายของปุ่ม (ไม่ right-0) และกว้างไม่เกินจอ — ไม่ล้นขอบซ้าย", async () => {
    mount();
    await userEvent.click(screen.getByRole("button", { name: /^เพิ่ม$/ }));
    const list = screen.getByRole("list", { name: "เลือกสิ่งที่จะเพิ่ม" });
    expect(list.className).toContain("left-0");
    expect(list.className).not.toContain("right-0");
    expect(list.className).toContain("100vw");
  });
  it("มือถือ: ปุ่ม 'เพิ่ม' เดียว → เมนูมี 2 ตัวเลือกพร้อมคำอธิบาย · เลือกแผนเดิมเปิดฟอร์มเดิม · Escape คืนโฟกัส", async () => {
    mount();
    const trigger = screen.getByRole("button", { name: /^เพิ่ม$/ });
    await userEvent.click(trigger);
    const list = screen.getByRole("list", { name: "เลือกสิ่งที่จะเพิ่ม" });
    expect(within(list).getAllByRole("button").map((b) => b.textContent)).toEqual([
      expect.stringContaining("เพิ่มชิ้นงาน"),
      expect.stringContaining("เพิ่มแผนเดิม"),
    ]);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("list", { name: "เลือกสิ่งที่จะเพิ่ม" })).not.toBeInTheDocument();
    await userEvent.click(trigger);
    await userEvent.click(within(screen.getByRole("list", { name: "เลือกสิ่งที่จะเพิ่ม" })).getByRole("button", { name: /เพิ่มแผนเดิม/ }));
    expect(await screen.findByRole("dialog", { name: "เพิ่มแผนเอง" })).toBeInTheDocument();
  });
  it("มือถือ: เลือกเพิ่มชิ้นงาน → เปิดกล่องชิ้นงานใหม่", async () => {
    mount();
    await userEvent.click(screen.getByRole("button", { name: /^เพิ่ม$/ }));
    await userEvent.click(within(screen.getByRole("list", { name: "เลือกสิ่งที่จะเพิ่ม" })).getByRole("button", { name: /เพิ่มชิ้นงาน/ }));
    expect(await screen.findByRole("dialog")).toHaveTextContent("เพิ่มชิ้นงาน");
  });
});
