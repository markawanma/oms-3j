// @vitest-environment jsdom
// SignalCard: แสดงตัวเลขดิบ/ป้ายจาก DB (ไม่คำนวณเอง) · ป้ายยังไม่สุก · วัด mass ไม่ได้ · ลิงก์ปลอดภัย · หยิบ/ไม่ใช้/เก็บไว้ก่อน/force
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { ToastProvider } from "@/components/ui/Toast";

afterEach(cleanup);

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }), usePathname: () => "/marketing/research" }));
const pickSignal = vi.fn();
const setSignalStatus = vi.fn();
vi.mock("@/lib/actions/content-signals", () => ({ pickSignal: (...a: unknown[]) => pickSignal(...a), setSignalStatus: (...a: unknown[]) => setSignalStatus(...a) }));

import { SignalCard } from "./SignalCard";
import type { SignalRow } from "@/lib/marketing/signal-types";

const SIG = "11111111-1111-4111-8111-111111111111";
const STEP = "22222222-2222-4222-8222-222222222222";
const sig = (o: Partial<SignalRow> = {}): SignalRow => ({
  id: SIG, kind: "reference_clip", source: "owner", seenOn: "2026-10-09", url: "https://www.tiktok.com/@a/video/1", summary: "คลิปบอกตรงเรื่องไลฟ์", hookText: "ชิ้นนี้ขึ้นไลฟ์คืนนี้", hookType: "direct_live",
  platform: "tiktok", account: "@a", followers: 1000, views: 2500, likes: null, comments: null, saves: 40, shares: null, metricsApprox: true, postedOn: "2026-10-08", customerGroup: null, whyItWorks: null,
  status: "new", statusReason: null, reviewOn: null, pickedStepId: null, massRatio: 2.5, massLabel: "mass", isUnripe: false, saveRate: 0.016, createdAt: null, ...o,
});
const renderCard = (s: SignalRow, piece?: { title: string; status: string }) =>
  render(
    <ToastProvider>
      <ul>
        <SignalCard signal={s} piece={piece} todayTh="2026-10-10" />
      </ul>
    </ToastProvider>
  );

beforeEach(() => {
  vi.clearAllMocks();
  pickSignal.mockResolvedValue({ ok: true, data: { stepId: STEP } });
  setSignalStatus.mockResolvedValue({ ok: true, data: undefined });
});

describe("SignalCard — แสดงผล", () => {
  it("ตัวเลขดิบ + ป้ายจาก DB + (ประมาณ) · ไม่เห็น = — ไม่ใช่ 0 · ประโยคเปิดเรียก 'ตอนจับ'", () => {
    renderCard(sig());
    expect(screen.getByText(/วิว 2,500 · ผู้ติดตาม 1,000 · ไลก์ — · คอมเมนต์ — · บันทึก 40 · แชร์ —/)).toBeInTheDocument();
    expect(screen.getByText(/ประมาณ/)).toBeInTheDocument();
    expect(screen.getByText(/คนดูมากกว่าผู้ติดตามมาก · วิว ÷ ผู้ติดตาม ≈ 2.5×/)).toBeInTheDocument();
    expect(screen.getByText(/ประโยคเปิดตอนจับ/)).toBeInTheDocument();
  });

  it("วัด mass ไม่ได้ → แสดงวิวดิบ ไม่เดา · ยังไม่สุก → ป้ายเตือน · ไม่มีตัวเลขเลย → บอกชัด", () => {
    const { unmount } = renderCard(sig({ massLabel: "unknown", massRatio: null, followers: null, isUnripe: true }));
    expect(screen.getByText(/วัด mass ไม่ได้ · แสดงวิวดิบ ไม่เดา/)).toBeInTheDocument();
    expect(screen.getByText(/ยังไม่สุก/)).toBeInTheDocument();
    unmount();
    renderCard(sig({ views: null, followers: null, saves: null, massLabel: "unknown", massRatio: null }));
    expect(screen.getByText(/ยังไม่ได้ใส่ตัวเลข — วัด mass ไม่ได้/)).toBeInTheDocument();
  });

  it("ลิงก์: http(s) เปิดแท็บใหม่ noopener · javascript: ไม่เป็นลิงก์", () => {
    const { unmount } = renderCard(sig());
    const a = screen.getByRole("link", { name: /เปิดคลิป/ });
    expect(a).toHaveAttribute("target", "_blank");
    expect(a.getAttribute("rel")).toContain("noopener");
    unmount();
    renderCard(sig({ url: "javascript:alert(1)" }));
    expect(screen.queryByRole("link", { name: /เปิดคลิป/ })).not.toBeInTheDocument();
  });

  it("หยิบแล้ว → ลิงก์ไปชิ้นงาน + ไม่มีปุ่มหยิบ/ไม่ใช้/เก็บไว้ก่อน", () => {
    renderCard(sig({ status: "picked", pickedStepId: STEP }), { title: "ไอเดียจากสัญญาณ", status: "idea" });
    expect(screen.getByRole("link", { name: /ไอเดียจากสัญญาณ/ })).toHaveAttribute("href", `/marketing/pieces/${STEP}?from=research`);
    for (const n of ["หยิบเป็นไอเดีย", "ไม่ใช้", "เก็บไว้ก่อน"]) expect(screen.queryByRole("button", { name: n })).not.toBeInTheDocument();
  });
});

describe("SignalCard — หยิบเป็นไอเดีย", () => {
  it("ช่องทางเลือกได้เฉพาะที่เข้าคู่ชนิด · กรอกครบแล้วส่ง pickSignal", async () => {
    renderCard(sig({ customerGroup: "jewelry_925" }));
    await userEvent.click(screen.getByRole("button", { name: "หยิบเป็นไอเดีย" }));
    const dialog = await screen.findByRole("dialog");
    const channel = within(dialog).getByLabelText("ช่องทาง");
    expect(channel).toBeDisabled();
    await userEvent.selectOptions(within(dialog).getByLabelText("ชนิดชิ้นงาน"), "short_clip");
    expect(within(channel).queryByRole("option", { name: "LINE OA" })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "หยิบเป็นไอเดีย" })).toBeDisabled();
    await userEvent.selectOptions(channel, "tiktok");
    await userEvent.click(within(dialog).getByRole("button", { name: "หยิบเป็นไอเดีย" }));
    await waitFor(() => expect(pickSignal).toHaveBeenCalledWith(SIG, { title: "คลิปบอกตรงเรื่องไลฟ์", pieceKind: "short_clip", channel: "tiktok", customerGroup: "jewelry_925" }));
    expect(await within(dialog).findByRole("link", { name: "ไปคัดไอเดีย" })).toHaveAttribute("href", "/marketing/triage");
    expect(refresh).not.toHaveBeenCalled(); // ยังไม่รีเฟรชทันที — ผู้ใช้ต้องเห็นข้อความสำเร็จก่อน
    await userEvent.click(within(dialog).getAllByRole("button", { name: "ปิด" })[0]);
    expect(refresh).toHaveBeenCalledTimes(1); // รีเฟรชตอนปิดกล่อง
  });

  it("DB ปฏิเสธ → กล่องค้างพร้อมข้อความไทย", async () => {
    pickSignal.mockResolvedValue({ ok: false, error: "สัญญาณนี้ถูกหยิบเป็นชิ้นงานแล้ว", pickedStepId: STEP });
    renderCard(sig({ customerGroup: "silver_bar" }));
    await userEvent.click(screen.getByRole("button", { name: "หยิบเป็นไอเดีย" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.selectOptions(within(dialog).getByLabelText("ชนิดชิ้นงาน"), "ig_fb_post");
    await userEvent.selectOptions(within(dialog).getByLabelText("ช่องทาง"), "facebook");
    await userEvent.click(within(dialog).getByRole("button", { name: "หยิบเป็นไอเดีย" }));
    expect(await within(dialog).findByText("สัญญาณนี้ถูกหยิบเป็นชิ้นงานแล้ว")).toBeInTheDocument();
    // หยิบซ้ำ → ลิงก์ไปชิ้นเดิม (code review ข้อ 5) · ไม่รีเฟรชเอง
    expect(within(dialog).getByRole("link", { name: "ไปดูชิ้นงานที่หยิบไว้แล้ว" })).toHaveAttribute("href", `/marketing/pieces/${STEP}?from=research`);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("SignalCard — ไม่ใช้ / เก็บไว้ก่อน / force", () => {
  it("ไม่ใช้ต้องมีเหตุผล ≥3 ก่อนกดได้", async () => {
    renderCard(sig());
    await userEvent.click(screen.getByRole("button", { name: "ไม่ใช้" }));
    const dialog = await screen.findByRole("dialog");
    const ok = within(dialog).getByRole("button", { name: "ไม่ใช้" });
    expect(ok).toBeDisabled();
    await userEvent.type(within(dialog).getByRole("textbox"), "ซ้ำกับของเดิม");
    await userEvent.click(ok);
    await waitFor(() => expect(setSignalStatus).toHaveBeenCalledWith(SIG, { status: "rejected", reason: "ซ้ำกับของเดิม", reviewOn: "", force: false }));
    expect(refresh).toHaveBeenCalled();
  });

  it("เก็บไว้ก่อนต้องเลือกวัน", async () => {
    renderCard(sig());
    await userEvent.click(screen.getByRole("button", { name: "เก็บไว้ก่อน" }));
    const dialog = await screen.findByRole("dialog");
    const ok = within(dialog).getByRole("button", { name: "เก็บไว้ก่อน" });
    expect(ok).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText("กลับมาดูวันที่"), "2026-10-20");
    expect(ok).toBeEnabled();
  });

  it("DB บอกหยิบเป็นชิ้นงานแล้ว → ขอยืนยันซ้ำ (ลิงก์ชิ้นที่กระทบ) → ยืนยันส่ง force=true", async () => {
    setSignalStatus.mockResolvedValueOnce({ ok: false, needsForce: true, pickedStepId: STEP, error: "สัญญาณนี้ถูกหยิบเป็นชิ้นงานแล้ว — ตั้งสถานะใหม่จะไม่ลบหรือยกเลิกชิ้นงานที่ผูกอยู่" });
    renderCard(sig());
    await userEvent.click(screen.getByRole("button", { name: "ไม่ใช้" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByRole("textbox"), "ไม่ใช้แล้ว");
    await userEvent.click(within(dialog).getByRole("button", { name: "ไม่ใช้" }));
    expect(await within(dialog).findByText(/ไม่ลบหรือยกเลิกชิ้นงานที่ผูกอยู่/)).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "ดูชิ้นงานที่ได้รับผลกระทบ" })).toHaveAttribute("href", `/marketing/pieces/${STEP}?from=research`);
    await userEvent.click(within(dialog).getByRole("button", { name: "ยืนยันตั้งสถานะ" }));
    await waitFor(() => expect(setSignalStatus).toHaveBeenLastCalledWith(SIG, expect.objectContaining({ status: "rejected", force: true })));
  });

  it("กลับมาใช้ (rejected/deferred → new) ไม่ต้องมีกล่อง", async () => {
    renderCard(sig({ status: "rejected", statusReason: "ซ้ำ" }));
    await userEvent.click(screen.getByRole("button", { name: "กลับมาใช้" }));
    await waitFor(() => expect(setSignalStatus).toHaveBeenCalledWith(SIG, { status: "new" }));
  });
});
