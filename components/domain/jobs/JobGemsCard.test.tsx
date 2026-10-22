// @vitest-environment jsdom
// G1a: การ์ดพลอยบน /jobs/[id] · กล่องแก้พลอย (หน้าต่างแก้ตาม §5.3) · ตั้งเป็นแม่แบบ SKU — 4 state + ราคาไม่หลุด
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import type { ReactElement } from "react";

afterEach(cleanup);

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }), usePathname: () => "/jobs/J1" }));

const A = { getJobGems: vi.fn(), saveJobGems: vi.fn(), makeSkuGemTemplateFromJob: vi.fn(), getGemOptions: vi.fn() };
vi.mock("@/lib/actions/gems", () => ({
  getJobGems: (...a: unknown[]) => A.getJobGems(...a),
  saveJobGems: (...a: unknown[]) => A.saveJobGems(...a),
  makeSkuGemTemplateFromJob: (...a: unknown[]) => A.makeSkuGemTemplateFromJob(...a),
  getGemOptions: (...a: unknown[]) => A.getGemOptions(...a),
}));

import { ToastProvider } from "@/components/ui/Toast";
import { JobGemsCard } from "@/components/domain/jobs/JobGemsCard";
import { JobGemsEditDialog } from "@/components/domain/jobs/JobGemsEditDialog";
import type { GemBomLine, JobGems, JobGemsSummary } from "@/lib/jobs/gems";

const wrap = (ui: ReactElement) => render(<ToastProvider>{ui}</ToastProvider>);
const JOB = "11111111-1111-4111-8111-111111111111";
const I1 = "44444444-4444-4444-8444-444444444441";
const I2 = "44444444-4444-4444-8444-444444444442";

const bl = (id: string, label: string, q: number, pos: string | null = null, o: Partial<GemBomLine> = {}): GemBomLine => ({ id: `r-${id}`, gemItemId: id, canonicalItemId: id, label, qtyPerPiece: q, qtyTotal: q * 35, position: pos, source: "manual", renamed: false, via: null, ...o });
const L1 = bl(I1, "โกเมน · ไข่ · 4×6 มม.", 2, "บ่าซ้าย-ขวา", { via: "shopfloor" });
const L2 = bl(I2, "CZ · กลม · 1.5 มม.", 30, "ล้อมรอบ");

const summary = (o: Partial<JobGemsSummary> = {}): JobGemsSummary => ({
  state: "specified",
  gems: [
    { label: L1.label, qtyPerPiece: 2, qtyTotal: 70, position: "บ่าซ้าย-ขวา" },
    { label: L2.label, qtyPerPiece: 30, qtyTotal: 1050, position: "ล้อมรอบ" },
  ],
  ...o,
});
const jobGems = (o: Partial<JobGems> = {}): { ok: true; data: JobGems } => ({
  ok: true,
  data: { jobId: JOB, jobNo: "JB-0031", qtyPlanned: 35, window: "free_before_start", state: "specified", gemStage: "pending", lines: [L1, L2], template: null, differsFromTemplate: null, history: [], ...o },
});

const card = (p: Partial<{ sku: string | null; closed: boolean; activeTokens: number; gems: JobGemsSummary | null }> = {}) =>
  wrap(<JobGemsCard jobId={JOB} sku={"sku" in p ? (p.sku as string | null) : "RG-0418"} closed={p.closed ?? false} activeTokens={p.activeTokens ?? 0} gems={"gems" in p ? (p.gems as JobGemsSummary | null) : summary()} />);

beforeEach(() => {
  vi.clearAllMocks();
  A.getJobGems.mockResolvedValue(jobGems());
  A.getGemOptions.mockResolvedValue({ ok: true, data: { types: [], shapes: [], items: [] } });
  A.saveJobGems.mockResolvedValue({ ok: true, data: { summary: { changed: true, count: 2, createdTypes: [], createdShapes: [], createdItems: 0, reused: [], mergedRows: [] }, lines: [], window: "free_before_start" } });
});

describe("JobGemsCard — success", () => {
  it("ตารางจากฉลาก snapshot · รวมจาก DB (70 · 1,050) · สรุป '2 รายการ · 1,120 เม็ด' · semantic table", async () => {
    card();
    expect(screen.getByTestId("job-gems-summary")).toHaveTextContent("2 รายการ · 1,120 เม็ด");
    const t = screen.getByTestId("job-gems-table");
    expect(within(t).getByRole("row", { name: /โกเมน · ไข่ · 4×6 มม\./ })).toHaveTextContent("70");
    expect(within(t).getByRole("row", { name: /CZ · กลม · 1.5 มม\./ })).toHaveTextContent("1,050");
    expect(within(t).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["ชนิด · รูปทรง · ขนาด", "/ชิ้น", "รวม", "ตำแหน่ง"]);
    await waitFor(() => expect(A.getJobGems).toHaveBeenCalledWith(JOB));
  });
  it("ส่วนเสริมโหลดอยู่: skeleton เฉพาะแถบป้าย · ตารางไม่ถูกบัง · เสร็จแล้วขึ้นป้าย 'ใส่จากหน้างาน'", async () => {
    let resolve!: (v: unknown) => void;
    A.getJobGems.mockReturnValue(new Promise((r) => (resolve = r)));
    card();
    expect(screen.getByRole("status", { name: "กำลังโหลดรายละเอียดพลอย" })).toBeInTheDocument();
    expect(screen.getByTestId("job-gems-table")).toBeInTheDocument();
    resolve(jobGems());
    expect(await screen.findByText("ใส่จากหน้างาน")).toBeInTheDocument();
  });
  it("ส่วนเสริมโหลดไม่ได้: ตารางยังอยู่ + ข้อความบอก (ไม่ทำให้หน้าล้ม)", async () => {
    A.getJobGems.mockResolvedValue({ ok: false, error: "x" });
    card();
    expect(await screen.findByText(/โหลดรายละเอียดการแก้ไม่ได้/)).toBeInTheDocument();
    expect(screen.getByTestId("job-gems-table")).toBeInTheDocument();
  });
  it("ต่างจากแม่แบบ → ป้าย + ปุ่ม 'ตั้งเป็นแม่แบบ SKU RG-0418' · ไม่ต่าง → ไม่มีปุ่ม", async () => {
    A.getJobGems.mockResolvedValue(jobGems({ template: [bl(I1, L1.label, 1)], differsFromTemplate: true }));
    const { unmount } = card();
    expect(await screen.findByText("ต่างจากแม่แบบ")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ตั้งเป็นแม่แบบ SKU RG-0418" })).toBeInTheDocument();
    unmount();
    A.getJobGems.mockResolvedValue(jobGems({ template: [L1, L2], differsFromTemplate: false }));
    card();
    await waitFor(() => expect(A.getJobGems).toHaveBeenCalledTimes(2));
    await screen.findByTestId("job-gems-table");
    expect(screen.queryByRole("button", { name: /ตั้งเป็นแม่แบบ SKU/ })).not.toBeInTheDocument();
  });
  it("SKU ยังไม่มีแม่แบบ (template ว่าง) + มีพลอย = เสนอ 'ตั้งเป็นแม่แบบ' · ใบไม่มี SKU = ไม่มีปุ่ม", async () => {
    A.getJobGems.mockResolvedValue(jobGems({ template: [], differsFromTemplate: null }));
    const { unmount } = card();
    expect(await screen.findByRole("button", { name: "ตั้งเป็นแม่แบบ SKU RG-0418" })).toBeInTheDocument();
    unmount();
    A.getJobGems.mockResolvedValue(jobGems({ template: null, differsFromTemplate: null }));
    card({ sku: null });
    await screen.findByTestId("job-gems-table");
    expect(screen.queryByRole("button", { name: /ตั้งเป็นแม่แบบ/ })).not.toBeInTheDocument();
  });
  it("พิมพ์ไปแล้ว n ใบ → แจ้งว่าพลอยที่แก้จะไม่อยู่บนกระดาษ · ไม่มี = ไม่แสดง", async () => {
    const { unmount } = card({ activeTokens: 2 });
    expect(screen.getByTestId("job-gems-printed")).toHaveTextContent("ใบงานถูกพิมพ์ไปแล้ว 2 ใบ — พลอยที่แก้จะไม่อยู่บนกระดาษที่พิมพ์ไปแล้ว");
    unmount();
    card({ activeTokens: 0 });
    expect(screen.queryByTestId("job-gems-printed")).not.toBeInTheDocument();
  });
  it("ประวัติการแก้: เวลา · เหตุผล · +/−/~", async () => {
    A.getJobGems.mockResolvedValue(
      jobGems({ history: [{ at: "2026-10-22T02:12:00Z", phase: "edit", source: "office", reason: "ช่างฝังเปลี่ยนแบบ", before: [{ label: "A", qtyPerPiece: 1, position: null }], after: [{ label: "A", qtyPerPiece: 2, position: null }, { label: "B", qtyPerPiece: 1, position: null }] }] }),
    );
    card();
    const h = await screen.findByTestId("job-gems-history");
    expect(h).toHaveTextContent("เหตุผล: ช่างฝังเปลี่ยนแบบ");
    expect(h).toHaveTextContent("~ แก้ A : 1/ชิ้น → 2/ชิ้น");
    expect(h).toHaveTextContent("+ เพิ่ม B");
  });
});

describe("JobGemsCard — empty / error", () => {
  it("empty (มีขั้นฝัง ยังไม่ระบุ): amber 'ยังไม่ระบุพลอย' + เพิ่มพลอย", async () => {
    card({ gems: { state: "unspecified", gems: [] } });
    expect(screen.getByTestId("job-gems-unspecified")).toHaveTextContent("ยังไม่ระบุพลอย");
    expect(within(screen.getByTestId("job-gems-unspecified")).getByRole("button", { name: "เพิ่มพลอย" })).toBeInTheDocument();
    await waitFor(() => expect(A.getJobGems).toHaveBeenCalled());
  });
  it("empty (ไม่มีขั้นฝัง): ข้อความ neutral · ไม่มีปุ่มเพิ่ม · บอกว่าระบบไม่เพิ่มขั้นให้", async () => {
    card({ gems: { state: "not_needed", gems: [] } });
    expect(screen.getByTestId("job-gems-none")).toHaveTextContent("ใบนี้ไม่มีขั้นฝังพลอย");
    expect(screen.getByTestId("job-gems-none")).toHaveTextContent("ระบบไม่เพิ่มขั้นให้เอง");
    expect(screen.queryByRole("button", { name: /เพิ่มพลอย|แก้พลอย/ })).not.toBeInTheDocument();
    await waitFor(() => expect(A.getJobGems).toHaveBeenCalled());
  });
  it("error (อ่านพลอยไม่ได้ = gems null): 'โหลดพลอยไม่ได้ — โหลดหน้าใหม่' + ปุ่ม · ไม่เรียก getJobGems · ไม่ใช่ 'ไม่มีพลอย'", async () => {
    const user = userEvent.setup();
    card({ gems: null });
    expect(screen.getByRole("alert")).toHaveTextContent("โหลดพลอยไม่ได้ — โหลดหน้าใหม่");
    await user.click(screen.getByRole("button", { name: "โหลดหน้าใหม่" }));
    expect(refresh).toHaveBeenCalled();
    expect(A.getJobGems).not.toHaveBeenCalled();
    expect(screen.queryByText(/ไม่มีพลอย|ไม่ระบุ/)).not.toBeInTheDocument();
  });
  it("ใบปิด/ยกเลิก (closed) หรือหน้าต่างแก้ = closed → ไม่มีปุ่มแก้พลอย", async () => {
    const { unmount } = card({ closed: true });
    await waitFor(() => expect(A.getJobGems).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "แก้พลอย" })).not.toBeInTheDocument();
    unmount();
    A.getJobGems.mockResolvedValue(jobGems({ window: "closed" }));
    card();
    await screen.findByText(/โกเมน · ไข่ · 4×6 มม\./);
    await waitFor(() => expect(screen.queryByRole("button", { name: "แก้พลอย" })).not.toBeInTheDocument());
  });
  it("🔴 การ์ด (staff-safe): ไม่มีราคา/ต้นทุน/เผื่อแตก ใน DOM", async () => {
    A.getJobGems.mockResolvedValue(jobGems({ template: [], history: [{ at: "2026-10-22T02:12:00Z", phase: "edit", source: "office", reason: "x", before: [], after: [{ label: "A", qtyPerPiece: 1, position: null }] }] }));
    const { container } = card({ activeTokens: 1 });
    await screen.findByTestId("job-gems-history");
    expect(container.textContent).not.toMatch(/ราคา|ต้นทุน|บาท|฿|เผื่อแตก/);
    expect(container.innerHTML).not.toMatch(/price|cost|thb|supplier/i);
  });
});

describe("JobGemsEditDialog — หน้าต่างแก้", () => {
  const open = (onClose = vi.fn()) => {
    wrap(<JobGemsEditDialog jobId={JOB} onClose={onClose} />);
    return onClose;
  };
  const save = () => screen.getByRole("button", { name: "บันทึกพลอย" });

  it("loading → ready: แถวที่บันทึกแล้วเป็นรายการเดิม (ฉลากล็อก) · ไม่ต้องเหตุผลเมื่อยังไม่ถึงขั้นฝัง", async () => {
    let resolve!: (v: unknown) => void;
    A.getJobGems.mockReturnValue(new Promise((r) => (resolve = r)));
    open();
    expect(screen.getByRole("status", { name: "กำลังโหลดพลอยของใบ" })).toBeInTheDocument();
    resolve(jobGems());
    expect(await screen.findByTestId("gem-row-label-1")).toHaveTextContent("โกเมน · ไข่ · 4×6 มม.");
    expect(screen.queryByLabelText(/เหตุผลที่แก้/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("gem-edit-banner")).not.toBeInTheDocument();
  });
  it("load error: 'โหลดพลอยไม่ได้ — เช็คสัญญาณ…' + ลองอีกครั้ง", async () => {
    A.getJobGems.mockResolvedValueOnce({ ok: false, error: "ขัดข้อง" }).mockResolvedValueOnce(jobGems());
    const user = userEvent.setup();
    open();
    expect(await screen.findByRole("alert")).toHaveTextContent("โหลดพลอยไม่ได้ — เช็คสัญญาณแล้วลองอีกครั้ง");
    await user.click(screen.getByRole("button", { name: "ลองอีกครั้ง" }));
    expect(await screen.findByTestId("gem-row-label-1")).toBeInTheDocument();
  });
  it("ยังไม่แก้ = บันทึกไม่ได้ ('ยังไม่ได้แก้อะไร') · แก้จำนวนแล้วบันทึก = ส่ง gemItemId ทั้งชุด (ฉลาก snapshot คงเดิม) + toast + ปิด", async () => {
    const user = userEvent.setup();
    const onClose = open();
    await screen.findByTestId("gem-row-label-1");
    expect(save()).toHaveAttribute("aria-disabled", "true");
    await user.click(save());
    expect(A.saveJobGems).not.toHaveBeenCalled();
    const qty = screen.getAllByLabelText("จำนวนต่อชิ้น *")[0];
    await user.clear(qty);
    await user.type(qty, "4");
    expect(save()).not.toHaveAttribute("aria-disabled");
    await user.click(save());
    await waitFor(() => expect(A.saveJobGems).toHaveBeenCalledTimes(1));
    expect(A.saveJobGems.mock.calls[0][0]).toEqual({
      jobId: JOB,
      lines: [{ gemItemId: I1, qtyPerPiece: 4, position: "บ่าซ้าย-ขวา" }, { gemItemId: I2, qtyPerPiece: 30, position: "ล้อมรอบ" }],
      reason: null,
      force: false,
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(refresh).toHaveBeenCalled();
  });
  it("ช่วง office_free (ช่างเริ่มแล้ว ก่อนฝัง): banner เหลือง · ไม่ต้องเหตุผล", async () => {
    A.getJobGems.mockResolvedValue(jobGems({ window: "office_free" }));
    open();
    expect(await screen.findByTestId("gem-edit-banner")).toHaveTextContent("ช่างเริ่มทำงานแล้ว — การแก้ครั้งนี้ผู้จัดการจะไม่เห็นว่าแก้ไว้จนกว่าสแกนใหม่");
    expect(screen.queryByLabelText(/เหตุผลที่แก้/)).not.toBeInTheDocument();
  });
  it("ช่วง reason_required (ขั้นฝังรับแล้ว): banner + ช่องเหตุผล + สรุป +/−/~ · เหตุผลล่องหน/อีโมจิ/จุดล้วนไม่ผ่าน · ผ่านแล้วส่ง reason", async () => {
    A.getJobGems.mockResolvedValue(jobGems({ window: "reason_required" }));
    const user = userEvent.setup();
    open();
    expect(await screen.findByTestId("gem-edit-banner")).toHaveTextContent("ช่างฝังรับงานแล้ว — พลอยที่เปลี่ยนอาจไม่ตรงกับที่ฝังไปแล้ว");
    const qty = screen.getAllByLabelText("จำนวนต่อชิ้น *")[0];
    await user.clear(qty);
    await user.type(qty, "3");
    await user.click(screen.getByRole("button", { name: "ลบพลอยแถว 2" }));
    const sum = screen.getByTestId("gem-edit-summary");
    expect(sum).toHaveTextContent("~ แก้ โกเมน · ไข่ · 4×6 มม. : 2/ชิ้น (บ่าซ้าย-ขวา) → 3/ชิ้น (บ่าซ้าย-ขวา)");
    expect(sum).toHaveTextContent("− ลบ CZ · กลม · 1.5 มม.");
    expect(save()).toHaveAttribute("aria-disabled", "true");
    const reason = screen.getByLabelText(/เหตุผลที่แก้/);
    for (const bad of [" ", "...", "👍", "​​"]) {
      await user.clear(reason);
      await user.type(reason, bad);
      await user.click(save());
      expect(A.saveJobGems).not.toHaveBeenCalled();
    }
    await user.clear(reason);
    await user.type(reason, "ช่างฝังเปลี่ยนแบบ");
    expect(save()).not.toHaveAttribute("aria-disabled");
    await user.click(save());
    await waitFor(() => expect(A.saveJobGems).toHaveBeenCalledTimes(1));
    expect(A.saveJobGems.mock.calls[0][0].reason).toBe("ช่างฝังเปลี่ยนแบบ");
    expect(A.saveJobGems.mock.calls[0][0].lines).toHaveLength(1);
  });
  it("ใบปิด/ยกเลิก (closed): อ่านอย่างเดียว · ไม่มีปุ่มบันทึก", async () => {
    A.getJobGems.mockResolvedValue(jobGems({ window: "closed" }));
    open();
    expect(await screen.findByText("ใบนี้ปิดหรือยกเลิกแล้ว — แก้พลอยไม่ได้")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "บันทึกพลอย" })).not.toBeInTheDocument();
  });
  it("DB ปฏิเสธ (หน้าต่างเปลี่ยนระหว่างแก้): ข้อความในกล่อง · ไม่ปิด · ค่าที่แก้ยังอยู่", async () => {
    A.saveJobGems.mockResolvedValue({ ok: false, error: "ต้องระบุเหตุผลที่มีตัวอักษรหรือตัวเลขจริง", code: "reason_required", gem: { code: "reason_required" } });
    const user = userEvent.setup();
    const onClose = open();
    await screen.findByTestId("gem-row-label-1");
    const qty = screen.getAllByLabelText("จำนวนต่อชิ้น *")[0];
    await user.clear(qty);
    await user.type(qty, "9");
    await user.click(save());
    expect(await screen.findByText("ต้องระบุเหตุผลที่มีตัวอักษรหรือตัวเลขจริง")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getAllByLabelText("จำนวนต่อชิ้น *")[0] as HTMLInputElement).value).toBe("9");
  });
  it("DB ปฏิเสธแถว 2: กล่องแดงที่แถว 2", async () => {
    A.saveJobGems.mockResolvedValue({ ok: false, error: "ไม่พบรายการพลอยที่เลือก", code: "gem_item_invalid", gem: { code: "gem_item_invalid", row: 2, field: "gem_item_id" } });
    const user = userEvent.setup();
    open();
    await screen.findByTestId("gem-row-label-1");
    const qty = screen.getAllByLabelText("จำนวนต่อชิ้น *")[0];
    await user.clear(qty);
    await user.type(qty, "9");
    await user.click(save());
    expect(await screen.findByTestId("gem-server-error-2")).toHaveTextContent("พลอยแถว 2: ไม่พบรายการพลอยที่เลือก");
  });
  it("ปิดกล่องขณะมีแก้ยังไม่บันทึก: ถามยืนยัน 'ทิ้งการแก้พลอย?' · ไม่ยืนยัน = ไม่ปิด", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const onClose = open();
    await screen.findByTestId("gem-row-label-1");
    await user.click(screen.getByRole("button", { name: "ยกเลิก" }));
    expect(confirm).not.toHaveBeenCalled(); // ยังไม่แก้ = ปิดได้เลย
    expect(onClose).toHaveBeenCalledTimes(1);
    cleanup();
    const onClose2 = open();
    await screen.findByTestId("gem-row-label-1");
    const qty = screen.getAllByLabelText("จำนวนต่อชิ้น *")[0];
    await user.clear(qty);
    await user.type(qty, "5");
    await user.click(screen.getByRole("button", { name: "ยกเลิก" }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("ทิ้งการแก้พลอย"));
    expect(onClose2).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    await user.click(screen.getByRole("button", { name: "ยกเลิก" }));
    expect(onClose2).toHaveBeenCalledTimes(1);
    confirm.mockRestore();
  });
});

describe("ตั้งเป็นแม่แบบ SKU", () => {
  it("เปิดจากการ์ด: เทียบแม่แบบ | ใบนี้ + diff + 'มีผลกับใบที่เปิดใหม่' → ยืนยัน = makeSkuGemTemplateFromJob", async () => {
    A.getJobGems.mockResolvedValue(jobGems({ template: [bl(I1, L1.label, 1, "บ่า")], differsFromTemplate: true }));
    A.makeSkuGemTemplateFromJob.mockResolvedValue({ ok: true, data: { summary: { changed: true, count: 2, createdTypes: [], createdShapes: [], createdItems: 0, reused: [], mergedRows: [] }, lines: [], window: null } });
    const user = userEvent.setup();
    card();
    await user.click(await screen.findByRole("button", { name: "ตั้งเป็นแม่แบบ SKU RG-0418" }));
    expect(screen.getByTestId("gem-tpl-old")).toHaveTextContent(`${L1.label} · 1/ชิ้น · บ่า`);
    expect(screen.getByTestId("gem-tpl-new")).toHaveTextContent(L2.label);
    const diff = screen.getByTestId("gem-tpl-diff");
    expect(diff).toHaveTextContent("~ แก้ โกเมน · ไข่ · 4×6 มม.");
    expect(diff).toHaveTextContent("+ เพิ่ม CZ · กลม · 1.5 มม.");
    expect(screen.getByText("จะมีผลกับใบงานที่เปิดใหม่ — ใบที่เปิดแล้วไม่เปลี่ยน")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "ตั้งเป็นแม่แบบ" }));
    await waitFor(() => expect(A.makeSkuGemTemplateFromJob).toHaveBeenCalledWith(JOB));
  });
  it("SKU ไม่มีแม่แบบเดิม = 'แม่แบบใหม่' · DB ปฏิเสธ = ข้อความในกล่อง", async () => {
    A.getJobGems.mockResolvedValue(jobGems({ template: [], differsFromTemplate: null }));
    A.makeSkuGemTemplateFromJob.mockResolvedValue({ ok: false, error: "ใบนี้ไม่มี SKU — ตั้งเป็นแม่แบบไม่ได้" });
    const user = userEvent.setup();
    card();
    await user.click(await screen.findByRole("button", { name: "ตั้งเป็นแม่แบบ SKU RG-0418" }));
    expect(screen.getByText("SKU นี้ยังไม่มีแม่แบบพลอย — จะตั้งเป็นแม่แบบใหม่")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "ตั้งเป็นแม่แบบ" }));
    expect(await screen.findByText("ใบนี้ไม่มี SKU — ตั้งเป็นแม่แบบไม่ได้")).toBeInTheDocument();
  });
});
