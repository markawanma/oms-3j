// @vitest-environment jsdom
// QA (R2-D2) — PieceActionBar ทุกสถานะ: ปุ่มหลัก + เมนู ⋯ ตามตาราง "ปุ่มหลักตามสถานะ" (content-ui-build-plan.md §2.4)
// ไล่ "ห้ามผ่าน" F1 (อนุมัติ enabled ⇔ can_approve) และ F11 (ถอยจาก approved ได้ทางเดียว = เมนู ⋯ → ถอนอนุมัติ…)
// ไม่แตะ DB: server action ทั้งหมดถูก mock
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { ToastProvider } from "@/components/ui/Toast";

afterEach(cleanup);

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }) }));

const advancePiece = vi.fn();
const unlinkPost = vi.fn();
const deferPiece = vi.fn();
vi.mock("@/lib/actions/content-pieces", () => ({
  advancePiece: (...a: unknown[]) => advancePiece(...a),
  unlinkPost: (...a: unknown[]) => unlinkPost(...a),
  deferPiece: (...a: unknown[]) => deferPiece(...a),
  setPlan: vi.fn(),
  postPiece: vi.fn(),
  postPieceNoUrl: vi.fn(),
}));
vi.mock("@/lib/actions/content", () => ({ inspectContentLink: vi.fn() }));

import { PieceActionBar } from "./PieceActionBar";
import { mapPieceRow } from "@/lib/marketing/piece-types";
import type { PieceRow } from "@/lib/marketing/piece-types";

const STEP = "11111111-1111-4111-8111-111111111111";

function piece(over: Record<string, unknown>): PieceRow {
  return mapPieceRow({
    step_id: STEP,
    campaign_id: "c1",
    title: "ชิ้นทดสอบ",
    piece_status: "planned",
    effective_piece_status: "planned",
    piece_kind: "short_clip",
    channel: "tiktok",
    resolved_start: "2026-10-12",
    can_approve: false,
    ...over,
  });
}

function mount(p: PieceRow, restoreForcesReview = false) {
  return render(
    <ToastProvider>
      <PieceActionBar piece={p} hosts={[]} contentTypes={[]} todayTh="2026-10-09" restoreForcesReview={restoreForcesReview} />
    </ToastProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  advancePiece.mockResolvedValue({ ok: true, data: { to: "x" } });
  unlinkPost.mockResolvedValue({ ok: true, data: undefined });
});

async function menuItems(): Promise<string[]> {
  const more = screen.queryByRole("button", { name: "เมนูเพิ่มเติม" });
  if (!more) return [];
  await userEvent.click(more);
  return within(screen.getByRole("list", { name: "การกระทำเพิ่มเติม" })).getAllByRole("button").map((el) => el.textContent ?? "");
}

function topLevelButtons(): string[] {
  return screen.getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent ?? "");
}

interface Row {
  name: string;
  over: Record<string, unknown>;
  primary: string | null; // null = ไม่มีปุ่มหลัก
  menu: string[]; // ลำดับตามที่แสดง
  note?: RegExp;
}

// ตาราง §2.4 (ปุ่มรอง/เมนู ⋯) — "ย้อนเป็นไอเดีย…" ถูกตัดโดยตั้งใจ (D11: set_plan ล้างวันไม่ได้) → ตรวจว่าไม่โผล่
const ROWS: Row[] = [
  { name: "idea", over: { piece_status: "idea", effective_piece_status: "idea", resolved_start: null }, primary: "วางแผน…", menu: ["พักรอเงื่อนไข…", "ไม่ทำ (ยกเลิก)…"] },
  { name: "planned", over: {}, primary: null, menu: ["เริ่มร่างเอง", "เลื่อนวัน…", "พักรอเงื่อนไข…", "ยกเลิกชิ้นงาน…"], note: /รอ AI ร่าง/ },
  { name: "drafting", over: { piece_status: "drafting", effective_piece_status: "drafting" }, primary: "ส่งตรวจ", menu: ["ย้อนเป็นวางแผน…", "เลื่อนวัน…", "พักรอเงื่อนไข…", "ยกเลิกชิ้นงาน…"] },
  { name: "in_review", over: { piece_status: "in_review", effective_piece_status: "in_review", can_approve: true }, primary: "อนุมัติ", menu: ["ส่งกลับแก้…", "เลื่อนวัน…", "พักรอเงื่อนไข…", "ยกเลิกชิ้นงาน…"] },
  { name: "approved คลิป needs_shoot", over: { piece_status: "approved", effective_piece_status: "approved", footage_status: "needs_shoot" }, primary: "ถ่ายแล้ว", menu: ["ถอนอนุมัติ…", "เลื่อนวัน…", "พักรอเงื่อนไข…", "ยกเลิกชิ้นงาน…"] },
  { name: "approved คลิป มีภาพแล้ว", over: { piece_status: "approved", effective_piece_status: "approved", footage_status: "has_footage" }, primary: "โพสต์แล้ว", menu: ["ถอนอนุมัติ…", "เลื่อนวัน…", "พักรอเงื่อนไข…", "ยกเลิกชิ้นงาน…"] },
  { name: "approved LINE", over: { piece_status: "approved", effective_piece_status: "approved", piece_kind: "line_message", channel: "line_oa" }, primary: "โพสต์แล้ว", menu: ["ถอนอนุมัติ…", "เลื่อนวัน…", "พักรอเงื่อนไข…", "ยกเลิกชิ้นงาน…"] },
  { name: "produced", over: { piece_status: "produced", effective_piece_status: "produced", footage_status: "shot" }, primary: "โพสต์แล้ว", menu: ["ย้อนเป็นอนุมัติแล้ว…", "เลื่อนวัน…", "พักรอเงื่อนไข…", "ยกเลิกชิ้นงาน…"] },
  { name: "posted", over: { piece_status: "posted", effective_piece_status: "posted" }, primary: null, menu: ["ปลดโพสต์…"] },
  { name: "measuring (raw posted)", over: { piece_status: "posted", effective_piece_status: "measuring" }, primary: null, menu: ["ปลดโพสต์…"] },
  { name: "measured (raw posted)", over: { piece_status: "posted", effective_piece_status: "measured" }, primary: null, menu: ["ปลดโพสต์…"] },
  { name: "missed_measure (raw posted)", over: { piece_status: "posted", effective_piece_status: "missed_measure" }, primary: null, menu: ["ปลดโพสต์…"] },
  { name: "on_hold (raw approved)", over: { piece_status: "approved", effective_piece_status: "on_hold", hold_reason: "รอของ" }, primary: "กลับมาทำต่อ", menu: ["ยกเลิกชิ้นงาน…"] },
  { name: "on_hold (raw in_review)", over: { piece_status: "in_review", effective_piece_status: "on_hold", hold_reason: "รอของ" }, primary: "กลับมาทำต่อ", menu: ["ยกเลิกชิ้นงาน…"] },
  { name: "cancelled", over: { piece_status: "cancelled", effective_piece_status: "cancelled" }, primary: "กู้คืน…", menu: [] },
];

describe("PieceActionBar — ปุ่มหลัก + เมนู ⋯ ทุกสถานะ", () => {
  for (const row of ROWS) {
    it(`${row.name}: ปุ่มหลัก=${row.primary ?? "(ไม่มี)"} · เมนู=[${row.menu.join(" | ")}]`, async () => {
      mount(piece(row.over));
      const names = topLevelButtons();
      const nonMore = names.filter((n) => n !== "เมนูเพิ่มเติม");
      if (row.primary) {
        expect(nonMore, "ต้องมีปุ่มหลักเดียว ไม่มีปุ่มลอยอื่น (F11)").toEqual([row.primary]);
      } else {
        expect(nonMore, "ไม่มีปุ่มหลัก").toEqual([]);
      }
      if (row.note) expect(screen.getByText(row.note)).toBeInTheDocument();
      const items = await menuItems();
      expect(items).toEqual(row.menu);
      // ไม่มี "ย้อนเป็นไอเดีย" ที่ไหนเลย (D11) และไม่มีทางถอยอื่นนอกรายการ
      expect(items.join("|")).not.toContain("ไอเดีย…");
    });
  }

  it("ชิ้นที่ posted ไม่มีปุ่มหลักและมีข้อความบอก (ไม่ใช่แถบว่าง)", () => {
    mount(piece({ piece_status: "posted", effective_piece_status: "posted" }));
    expect(screen.getByText("ไม่มีขั้นถัดไปที่ต้องกดตอนนี้")).toBeInTheDocument();
  });

  it("cancelled: ไม่มีเมนู ⋯ เลย (มีทางเดียวคือ กู้คืน…)", () => {
    mount(piece({ piece_status: "cancelled", effective_piece_status: "cancelled" }));
    expect(screen.queryByRole("button", { name: "เมนูเพิ่มเติม" })).toBeNull();
  });
});

describe("F1 — ปุ่มอนุมัติ enabled ⇔ can_approve (ค่าจาก DB)", () => {
  it("can_approve=false → disabled + มีข้อความอธิบายบนจอ · กดแล้วไม่เรียก action", async () => {
    mount(piece({ piece_status: "in_review", effective_piece_status: "in_review", can_approve: false }));
    const btn = screen.getByRole("button", { name: "อนุมัติ" });
    expect(btn).toBeDisabled();
    expect(screen.getByText(/อนุมัติได้เมื่อผ่านครบทุกอย่าง/)).toBeInTheDocument();
    await userEvent.click(btn);
    expect(advancePiece).not.toHaveBeenCalled();
  });

  it("can_approve ไม่ใช่ boolean true (เช่น string 'true' / 1) → fail-closed (disabled)", () => {
    mount(piece({ piece_status: "in_review", effective_piece_status: "in_review", can_approve: "true" }));
    expect(screen.getByRole("button", { name: "อนุมัติ" })).toBeDisabled();
  });

  it("can_approve=true → enabled · กดแล้วส่ง to=approved พร้อม reviewSeconds เป็นจำนวนเต็ม ≥ 0 · แล้ว refresh", async () => {
    mount(piece({ piece_status: "in_review", effective_piece_status: "in_review", can_approve: true }));
    const btn = screen.getByRole("button", { name: "อนุมัติ" });
    expect(btn).toBeEnabled();
    await userEvent.click(btn);
    await waitFor(() => expect(advancePiece).toHaveBeenCalledTimes(1));
    const [step, to, opts] = advancePiece.mock.calls[0];
    expect(step).toBe(STEP);
    expect(to).toBe("approved");
    expect(Number.isInteger(opts.reviewSeconds) && opts.reviewSeconds >= 0).toBe(true);
    expect(opts.reason).toBeUndefined();
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("สถานะอื่นไม่มีปุ่ม 'อนุมัติ' ในแถบ (แม้ can_approve=true)", () => {
    for (const s of ["drafting", "approved", "produced", "posted"]) {
      const { unmount } = mount(piece({ piece_status: s, effective_piece_status: s, can_approve: true }));
      expect(screen.queryByRole("button", { name: "อนุมัติ" }), s).toBeNull();
      unmount();
    }
  });
});

describe("F11 — การถอยสถานะจาก approved มีทางเดียว: เมนู ⋯ → ถอนอนุมัติ… (เหตุผลบังคับ)", () => {
  it("ถอนอนุมัติ: ปุ่มยืนยัน disabled จนมีเหตุผล ≥ 3 ตัวอักษรจริง (ช่องว่าง/อักขระล่องหนไม่นับ) แล้วส่ง to=in_review + reason", async () => {
    mount(piece({ piece_status: "approved", effective_piece_status: "approved", footage_status: "has_footage" }));
    await userEvent.click(screen.getByRole("button", { name: "เมนูเพิ่มเติม" }));
    await userEvent.click(screen.getByRole("button", { name: "ถอนอนุมัติ…" }));
    const dlg = await screen.findByRole("dialog");
    const confirm = within(dlg).getByRole("button", { name: "ถอนอนุมัติ" });
    expect(confirm).toBeDisabled();
    const ta = within(dlg).getByRole("textbox");
    await userEvent.type(ta, "ab");
    expect(confirm).toBeDisabled();
    await userEvent.clear(ta);
    await userEvent.type(ta, "   ");
    expect(confirm).toBeDisabled();
    await userEvent.clear(ta);
    await userEvent.type(ta, "ข้อความผิด");
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    await waitFor(() => expect(advancePiece).toHaveBeenCalledWith(STEP, "in_review", { reason: "ข้อความผิด" }));
  });

  // รอบแก้ (QA Low): แท็บเก่ากว่า DB (stale) → ปิดกล่องเหตุผล + แจ้งข้อความ + refresh (เดิมค้างกล่องที่กดซ้ำไม่ได้แล้ว)
  it("DB ปฏิเสธ (55000 stale) → ปิดกล่อง · refresh", async () => {
    advancePiece.mockResolvedValue({ ok: false, error: "ชิ้นนี้เปลี่ยนสถานะไปแล้ว — รีเฟรชเพื่อดูล่าสุด", stale: true });
    mount(piece({ piece_status: "approved", effective_piece_status: "approved", footage_status: "has_footage" }));
    await userEvent.click(screen.getByRole("button", { name: "เมนูเพิ่มเติม" }));
    await userEvent.click(screen.getByRole("button", { name: "ถอนอนุมัติ…" }));
    const dlg = await screen.findByRole("dialog");
    await userEvent.type(within(dlg).getByRole("textbox"), "เหตุผลยาวๆ");
    await userEvent.click(within(dlg).getByRole("button", { name: "ถอนอนุมัติ" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(refresh).toHaveBeenCalled();
  });

  it("DB ปฏิเสธแบบไม่ stale → ข้อความไทยอยู่ในกล่อง · คงเหตุผลที่พิมพ์ไว้", async () => {
    advancePiece.mockResolvedValue({ ok: false, error: "ใส่เหตุผลอย่างน้อย 3 ตัวอักษร" });
    mount(piece({ piece_status: "approved", effective_piece_status: "approved", footage_status: "has_footage" }));
    await userEvent.click(screen.getByRole("button", { name: "เมนูเพิ่มเติม" }));
    await userEvent.click(screen.getByRole("button", { name: "ถอนอนุมัติ…" }));
    const dlg = await screen.findByRole("dialog");
    const ta = within(dlg).getByRole("textbox") as HTMLTextAreaElement;
    await userEvent.type(ta, "เหตุผลยาวๆ ที่ห้ามหาย");
    await userEvent.click(within(dlg).getByRole("button", { name: "ถอนอนุมัติ" }));
    expect(await within(dlg).findByRole("alert")).toHaveTextContent("ใส่เหตุผล");
    expect(ta.value).toBe("เหตุผลยาวๆ ที่ห้ามหาย");
  });
});

describe("ปลดโพสต์", () => {
  it("LINE/สตอรี่ (ไม่มีแถวโพสต์) → ย้อนสถานะตรง posted→approved พร้อมเหตุผล ไม่เรียก unlinkPost", async () => {
    mount(piece({ piece_status: "posted", effective_piece_status: "posted", piece_kind: "line_message", channel: "line_oa" }));
    await userEvent.click(screen.getByRole("button", { name: "เมนูเพิ่มเติม" }));
    await userEvent.click(screen.getByRole("button", { name: "ปลดโพสต์…" }));
    const dlg = await screen.findByRole("dialog");
    await userEvent.type(within(dlg).getByRole("textbox"), "ส่งผิดกลุ่ม");
    await userEvent.click(within(dlg).getByRole("button", { name: "ปลดโพสต์" }));
    await waitFor(() => expect(advancePiece).toHaveBeenCalledWith(STEP, "approved", { reason: "ส่งผิดกลุ่ม" }));
    expect(unlinkPost).not.toHaveBeenCalled();
  });

  it("คลิป: ปลดทีละโพสต์ที่ active เท่านั้น · หยุดทันทีที่ใบใดใบหนึ่งล้มเหลว (ไม่ปลดต่อ)", async () => {
    unlinkPost.mockResolvedValueOnce({ ok: false, error: "ปลดไม่สำเร็จ" });
    mount(
      piece({
        piece_status: "posted",
        effective_piece_status: "posted",
        posts: [
          { post_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", platform: "facebook", post_url: "https://x.example/a", status: "active" },
          { post_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", platform: "instagram", post_url: "https://x.example/b", status: "deleted" },
          { post_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", platform: "tiktok", post_url: "https://x.example/c", status: "active" },
        ],
      })
    );
    await userEvent.click(screen.getByRole("button", { name: "เมนูเพิ่มเติม" }));
    await userEvent.click(screen.getByRole("button", { name: "ปลดโพสต์…" }));
    const dlg = await screen.findByRole("dialog");
    await userEvent.type(within(dlg).getByRole("textbox"), "ลิงก์ผิด");
    await userEvent.click(within(dlg).getByRole("button", { name: "ปลดโพสต์" }));
    await waitFor(() => expect(unlinkPost).toHaveBeenCalledTimes(1));
    expect(unlinkPost.mock.calls[0][1]).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(await within(dlg).findByRole("alert")).toHaveTextContent("ปลดไม่สำเร็จ");
    expect(advancePiece).not.toHaveBeenCalled();
  });
});

describe("กู้คืน", () => {
  it("เคยอนุมัติ/ผลิตแล้ว → กล่องบอก 'ต้องอนุมัติใหม่' · ไม่เคย → ไม่มีข้อความนี้", async () => {
    const { unmount } = mount(piece({ piece_status: "cancelled", effective_piece_status: "cancelled" }), true);
    await userEvent.click(screen.getByRole("button", { name: "กู้คืน…" }));
    expect(await screen.findByText(/ต้องอนุมัติใหม่/)).toBeInTheDocument();
    unmount();
    cleanup();
    mount(piece({ piece_status: "cancelled", effective_piece_status: "cancelled" }), false);
    await userEvent.click(screen.getByRole("button", { name: "กู้คืน…" }));
    await screen.findByRole("dialog");
    expect(screen.queryByText(/ต้องอนุมัติใหม่/)).toBeNull();
  });
});

describe("ปุ่มหลักอื่น", () => {
  it("ส่งตรวจ → in_review · ถ่ายแล้ว → produced · กลับมาทำต่อ → resume (ไม่ส่งเหตุผล)", async () => {
    mount(piece({ piece_status: "drafting", effective_piece_status: "drafting" }));
    await userEvent.click(screen.getByRole("button", { name: "ส่งตรวจ" }));
    await waitFor(() => expect(advancePiece).toHaveBeenLastCalledWith(STEP, "in_review", undefined));
    cleanup();
    mount(piece({ piece_status: "approved", effective_piece_status: "approved", footage_status: "needs_shoot" }));
    await userEvent.click(screen.getByRole("button", { name: "ถ่ายแล้ว" }));
    await waitFor(() => expect(advancePiece).toHaveBeenLastCalledWith(STEP, "produced", undefined));
    cleanup();
    mount(piece({ piece_status: "approved", effective_piece_status: "on_hold", hold_reason: "รอ" }));
    await userEvent.click(screen.getByRole("button", { name: "กลับมาทำต่อ" }));
    await waitFor(() => expect(advancePiece).toHaveBeenLastCalledWith(STEP, "resume", undefined));
  });

  it("ดับเบิลคลิกปุ่มหลัก ไม่ยิง action ซ้ำขณะรอ (busy)", async () => {
    let release: (v: unknown) => void = () => {};
    advancePiece.mockReturnValue(new Promise((r) => (release = r)));
    mount(piece({ piece_status: "drafting", effective_piece_status: "drafting" }));
    const btn = screen.getByRole("button", { name: "ส่งตรวจ" });
    await userEvent.click(btn);
    await userEvent.click(btn);
    expect(advancePiece).toHaveBeenCalledTimes(1);
    release({ ok: true, data: { to: "in_review" } });
  });
});
