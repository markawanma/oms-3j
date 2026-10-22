// @vitest-environment jsdom
// G1a ใบ A5: ตารางพลอย (หลังตารางขั้น ก่อนหมายเหตุ) · ใบไม่มีพลอย = เดิมเป๊ะ · ไม่ระบุ = บรรทัดเตือน · ล้นหน้า = บันได ตัดรูป → บีบ → แผ่น 2 (ห้ามตัดแถว) · แถบ print:hidden ทุกขั้น · ไม่มีราคา
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

afterEach(cleanup);
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/jobs/x/print" }));
vi.mock("@/lib/actions/job-office-write", () => ({ issueJobQr: vi.fn() }));

import { JobPrintClient, JobSheet } from "./JobPrintClient";
import { JobGemsSecondSheet, JobSheetGems } from "./JobSheetGems";
import { nextGemPrintStep, printGemTotal } from "@/lib/jobs/print-gems";
import type { PrintableJob, PrintableJobGem } from "@/lib/jobs/print";

const gem = (label: string, per: number, total: number, position: string | null = null): PrintableJobGem => ({ label, qtyPerPiece: per, qtyTotal: total, position });
const GEMS = [gem("โกเมน · ไข่ · 4×6 มม.", 2, 70, "บ่าซ้าย-ขวา"), gem("CZ · กลม · 1.5 มม.", 30, 1050, "ล้อมรอบ")];

const job = (o: Partial<PrintableJob> = {}): PrintableJob => ({
  jobId: "11111111-1111-4111-8111-111111111111", jobNo: "JB-0031", designLabel: "แหวนโกเมนไข่", sku: "RG-0418", metalLabel: "เงิน", qtyOrder: 35, qtyPlanned: 35, targetPieceG: 4, metalPlanG: 150, dueDate: null,
  sourceLabel: "งานลูกค้า", weightStartG: null, profileName: null, primaryPhotoUrl: null, gems: [], gemsState: "not_needed",
  stages: [{ seq: 1, name: "หล่อ", weighRequired: true, scrapQtyAsk: true, scrapWeightAsk: false }, { seq: 2, name: "ฝังพลอย", weighRequired: false, scrapQtyAsk: true, scrapWeightAsk: false }],
  ...o,
});
const PHOTO = "https://x.supabase.co/storage/v1/object/sign/job-photos/s/j/p1_md.jpg?token=a";
const withGems = (o: Partial<PrintableJob> = {}) => job({ gems: GEMS, gemsState: "specified", ...o });

describe("JobSheet — ตารางพลอย", () => {
  it("ใบที่ไม่มีขั้นฝังและไม่มีพลอย = ไม่มีองค์ประกอบพลอยเลย (markup เดิม) · มีตารางเดียว (ตารางขั้น)", () => {
    const { container } = render(<JobSheet job={job()} qrSvg={null} />);
    expect(container.querySelector('[data-testid^="sheet-gem"]')).toBeNull();
    expect(screen.getAllByRole("table")).toHaveLength(1);
    expect(container.textContent).not.toContain("พลอย (ขั้นฝังพลอย)");
    expect(container.textContent).not.toContain("พลอย:");
  });
  it("มีพลอย: อยู่หลังตารางขั้น ก่อนกล่องหมายเหตุ · หัวคอลัมน์ · ทุกแถว · รวมต่อแถวและรวมทั้งใบ · เลขชิดขวา tabular-nums", () => {
    const { container } = render(<JobSheet job={withGems()} qrSvg={null} />);
    const stages = screen.getAllByRole("table")[0];
    const gems = screen.getByTestId("sheet-gems-table");
    const note = screen.getByText("หมายเหตุ");
    expect(stages.compareDocumentPosition(gems) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(gems.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(gems).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["ชนิด · รูปทรง · ขนาด", "/ชิ้น", "รวม", "ตำแหน่ง"]);
    const rows = within(gems).getAllByTestId("sheet-gem-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getAllByRole("cell").map((c) => c.textContent)).toEqual(["2", "70", "บ่าซ้าย-ขวา"]);
    expect(rows[0]).toHaveTextContent("โกเมน · ไข่ · 4×6 มม.");
    expect(within(rows[1]).getAllByRole("cell").map((c) => c.textContent)).toEqual(["30", "1,050", "ล้อมรอบ"]);
    expect(screen.getByTestId("sheet-gems")).toHaveTextContent("รวมทั้งใบ 1,120 เม็ด");
    expect(within(rows[1]).getByText("1,050").className).toContain("tabular-nums");
    expect(within(rows[1]).getByText("1,050").className).toContain("whitespace-nowrap");
    expect(container.querySelectorAll("table")).toHaveLength(2);
  });
  it("ไม่ระบุ (มีขั้นฝังแต่ไม่มีรายการ): บรรทัดเดียว 'พลอย: ยังไม่ระบุ — ถามออฟฟิศก่อนฝัง' · ไม่มีตารางพลอย", () => {
    render(<JobSheet job={job({ gemsState: "unspecified" })} qrSvg={null} />);
    expect(screen.getByTestId("sheet-gems-unspecified")).toHaveTextContent("พลอย: ยังไม่ระบุ — ถามออฟฟิศก่อนฝัง");
    expect(screen.queryByTestId("sheet-gems-table")).not.toBeInTheDocument();
    expect(screen.getAllByRole("table")).toHaveLength(1);
  });
  it("ตัวอักษรตารางพลอย ≥ 8pt (ไม่มี 7pt/6pt) · ชื่อ/ตำแหน่งยาวตัดบรรทัดได้", () => {
    const long = gem("ก".repeat(90), 1, 35, "ล้อมรอบ".repeat(10));
    const { container } = render(<JobSheet job={withGems({ gems: [long] })} qrSvg={null} />);
    const html = container.querySelector('[data-testid="sheet-gems"]')!.innerHTML;
    expect(html).not.toMatch(/text-\[(?:[0-7]|7\.\d)pt\]/);
    expect(html).toContain("break-words");
  });
  it("โหมดกระชับ: ครบทุกแถว · ตำแหน่งต่อท้ายชื่อ (8pt) · 3 คอลัมน์", () => {
    render(<JobSheet job={withGems()} qrSvg={null} gemMode="compact" />);
    const t = screen.getByTestId("sheet-gems-table");
    expect(t).toHaveAttribute("data-compact", "1");
    expect(within(t).getAllByRole("columnheader")).toHaveLength(3);
    expect(within(t).getAllByTestId("sheet-gem-row")).toHaveLength(2);
    expect(within(t).getAllByTestId("sheet-gem-row")[0]).toHaveTextContent("โกเมน · ไข่ · 4×6 มม. · บ่าซ้าย-ขวา");
    expect(t.innerHTML).toContain("text-[8pt]");
  });
  it("โหมดแผ่น 2: แผ่นที่ 1 เหลือบรรทัดเดียว 'พลอย 2 รายการ · รวม 1,120 เม็ด — ดูแผ่นที่ 2' + 'แผ่น 1/2' · ไม่มีตารางพลอยบนแผ่น 1", () => {
    render(<JobSheet job={withGems()} qrSvg={null} gemMode="page2" />);
    expect(screen.getByTestId("sheet-gems-pointer")).toHaveTextContent("พลอย 2 รายการ · รวม 1,120 เม็ด — ดูแผ่นที่ 2");
    expect(screen.getByTestId("sheet-gems-pointer")).toHaveTextContent("แผ่น 1/2");
    expect(screen.queryByTestId("sheet-gems-table")).not.toBeInTheDocument();
  });
  it("แผ่นที่ 2: หัว 'พลอย · JB-0031 · ชื่อแบบ' + 'แผ่น 2/2' · ทุกแถว · ไม่มี QR · ขึ้นหน้าใหม่ตอนพิมพ์", () => {
    render(<JobGemsSecondSheet jobNo="JB-0031" designLabel="แหวนโกเมนไข่" gems={GEMS} />);
    const s = screen.getByTestId("sheet-gems-page2");
    expect(s).toHaveTextContent("พลอย · JB-0031 · แหวนโกเมนไข่");
    expect(s).toHaveTextContent("แผ่น 2/2");
    expect(within(s).getAllByTestId("sheet-gem-row")).toHaveLength(2);
    expect(s.className).toContain("print:break-before-page");
    expect(within(s).queryByRole("img")).not.toBeInTheDocument();
    expect(s.textContent).not.toContain("สแกน");
  });
});

describe("บันไดล้นหน้า (JobPrintClient + ตัววัดความสูง)", () => {
  /** วัดแบบสั่งได้: คืนค่าตามขั้นปัจจุบัน (อ่านจาก DOM) — ทดแทน layout ที่ jsdom ไม่มี */
  const stepOf = () => {
    if (screen.queryByTestId("sheet-gems-pointer")) return "page2";
    const t = screen.queryByTestId("sheet-gems-table");
    if (t?.getAttribute("data-compact")) return "compact";
    return screen.queryByTestId("print-photo") ? "normal" : "noPhoto";
  };
  const heightsBy = (h: Partial<Record<string, number>>) =>
    vi.fn(() => {
      const s = stepOf();
      return h[s] ?? 0;
    });
  const rowsTotal = () => screen.getAllByTestId("sheet-gem-row").length;

  beforeEach(() => vi.clearAllMocks());

  it("พอดี (≤ 194 มม.) = ไม่ขยับบันได · ไม่มีแถบ · ไม่มีแผ่น 2", () => {
    const m = heightsBy({ normal: 190 });
    render(<JobPrintClient job={withGems({ primaryPhotoUrl: PHOTO })} measureMm={m} />);
    expect(screen.queryByTestId("print-gems-notice")).not.toBeInTheDocument();
    expect(screen.queryByTestId("sheet-gems-page2")).not.toBeInTheDocument();
    expect(screen.getByTestId("print-photo")).toBeInTheDocument();
  });
  it("ล้น 1 ขั้น (มีรูป) → ตัดรูป + แถบ 'ตัดรูปออก… ช่างดูรูปผ่าน QR' · ตารางพลอยยังเต็ม · ทุกแถวอยู่", () => {
    const m = heightsBy({ normal: 205, noPhoto: 190 });
    render(<JobPrintClient job={withGems({ primaryPhotoUrl: PHOTO })} measureMm={m} />);
    expect(screen.queryByTestId("print-photo")).not.toBeInTheDocument();
    expect(screen.getByTestId("print-gems-notice")).toHaveTextContent("ตัดรูปออกเพื่อให้ตารางพลอยพอดี — ช่างดูรูปผ่าน QR");
    expect(screen.getByTestId("sheet-gems-table")).not.toHaveAttribute("data-compact");
    expect(rowsTotal()).toBe(2);
  });
  it("ล้น 2 ขั้น → บีบเป็นกระชับ + แถบ · ครบทุกแถว", () => {
    const m = heightsBy({ normal: 215, noPhoto: 200, compact: 192 });
    render(<JobPrintClient job={withGems({ primaryPhotoUrl: PHOTO })} measureMm={m} />);
    expect(screen.getByTestId("sheet-gems-table")).toHaveAttribute("data-compact", "1");
    expect(screen.getByTestId("print-gems-notice")).toHaveTextContent("บีบเป็นโหมดกระชับ");
    expect(rowsTotal()).toBe(2);
    expect(screen.queryByTestId("print-photo")).not.toBeInTheDocument();
  });
  it("ล้นทุกขั้น → แผ่นที่ 2 ทั้งก้อน · แผ่น 1 เหลือบรรทัดเดียว · แถบ 'พิมพ์ 2 แผ่น — ติดแผ่น 2 ไว้กับถุงงาน' · รูปกลับมาบนแผ่น 1 · แถวพลอยครบ (ไม่ตัด)", () => {
    const m = heightsBy({ normal: 230, noPhoto: 220, compact: 210, page2: 150 });
    render(<JobPrintClient job={withGems({ primaryPhotoUrl: PHOTO })} measureMm={m} />);
    expect(screen.getByTestId("sheet-gems-pointer")).toBeInTheDocument();
    expect(screen.getByTestId("sheet-gems-page2")).toBeInTheDocument();
    expect(screen.getByTestId("print-gems-notice")).toHaveTextContent("ใบนี้พิมพ์ 2 แผ่น — ติดแผ่น 2 ไว้กับถุงงาน (แผ่น 2 ไม่มี QR)");
    expect(screen.getByTestId("print-photo")).toBeInTheDocument();
    expect(rowsTotal()).toBe(2); // เฉพาะแผ่น 2 มีตาราง
  });
  it("ไม่มีรูปหลัก: ล้นครั้งแรกข้ามขั้น 'ตัดรูป' ไปบีบเลย", () => {
    const m = heightsBy({ normal: 205, noPhoto: 205, compact: 190 });
    render(<JobPrintClient job={withGems()} measureMm={m} />);
    expect(screen.getByTestId("sheet-gems-table")).toHaveAttribute("data-compact", "1");
    expect(screen.getByTestId("print-gems-notice")).not.toHaveTextContent("ตัดรูป");
  });
  it("🔴 พลอย 30 แถว หัวยาว: ทุกขั้นของบันไดแสดงครบ 30 แถว (ห้ามตัดแถว · ห้าม '…และอีก n รายการ')", () => {
    const many = Array.from({ length: 30 }, (_, i) => gem(`ชนิด${i} · กลม · ${i + 1} มม.`, 1 + (i % 5), (1 + (i % 5)) * 35, i % 2 ? "ล้อมรอบ" : null));
    for (const profile of [{ normal: 190 }, { normal: 300, noPhoto: 190 }, { normal: 300, noPhoto: 300, compact: 190 }, { normal: 300, noPhoto: 300, compact: 300 }]) {
      cleanup();
      render(<JobPrintClient job={withGems({ gems: many, primaryPhotoUrl: PHOTO })} measureMm={heightsBy(profile)} />);
      expect(rowsTotal()).toBe(30);
      expect(document.body.textContent).not.toMatch(/และอีก\s*\d+\s*รายการ/);
    }
  });
  it("วัดไม่ได้ (null) = ไม่ขยับบันได · ใบไม่มีพลอยไม่ถูกวัดเลย", () => {
    const m = vi.fn(() => null);
    render(<JobPrintClient job={withGems()} measureMm={m} />);
    expect(screen.queryByTestId("print-gems-notice")).not.toBeInTheDocument();
    cleanup();
    const m2 = vi.fn(() => 999);
    render(<JobPrintClient job={job()} measureMm={m2} />);
    expect(m2).not.toHaveBeenCalled();
    expect(screen.queryByTestId("print-gems-notice")).not.toBeInTheDocument();
  });
  it("แถบเตือนทั้งหมดเป็น print:hidden (อยู่ใน section ออก QR) — ไม่ติดบนกระดาษ", () => {
    const m = heightsBy({ normal: 230, noPhoto: 220, compact: 210, page2: 150 });
    render(<JobPrintClient job={withGems({ primaryPhotoUrl: PHOTO })} measureMm={m} />);
    const bar = screen.getByTestId("print-gems-notice");
    expect(bar.closest("section")!.className).toContain("print:hidden");
  });
  it("ไม่ระบุพลอย: แถบเตือนบนจอ (print:hidden) + บรรทัดบนกระดาษ · อ่านพลอยไม่ได้ (gemsReadFailed) = แถบเตือน ไม่เงียบ", () => {
    const { unmount } = render(<JobPrintClient job={job({ gemsState: "unspecified" })} />);
    const bar = screen.getByTestId("print-gems-unspecified");
    expect(bar).toHaveTextContent("ใบนี้มีขั้นฝังพลอยแต่ยังไม่ระบุพลอย");
    expect(bar.closest("section")!.className).toContain("print:hidden");
    expect(screen.getByTestId("sheet-gems-unspecified")).toBeInTheDocument();
    unmount();
    render(<JobPrintClient job={job()} gemsReadFailed />);
    expect(screen.getByTestId("print-gems-read-failed")).toHaveTextContent("อ่านพลอยของใบนี้ไม่ได้");
    expect(screen.queryByTestId("print-gems-unspecified")).not.toBeInTheDocument();
  });
});

describe("pure: บันไดและยอดรวม", () => {
  it("nextGemPrintStep: มีรูป normal→noPhoto→compact→page2→page2 · ไม่มีรูปข้าม noPhoto", () => {
    expect(nextGemPrintStep("normal", true)).toBe("noPhoto");
    expect(nextGemPrintStep("noPhoto", true)).toBe("compact");
    expect(nextGemPrintStep("compact", true)).toBe("page2");
    expect(nextGemPrintStep("page2", true)).toBe("page2");
    expect(nextGemPrintStep("normal", false)).toBe("compact");
  });
  it("printGemTotal บวกจำนวนเต็ม (หลักล้านไม่เพี้ยน) · ว่าง = 0", () => {
    expect(printGemTotal([{ qtyTotal: 1_000_000 }, { qtyTotal: 70 }])).toBe(1_000_070);
    expect(printGemTotal([])).toBe(0);
  });
  it("JobSheetGems: gems ว่างและไม่ใช่ unspecified = null", () => {
    const { container } = render(<JobSheetGems gems={[]} state="not_needed" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("🔴 ใบพิมพ์ไม่มีราคา/ต้นทุน/เผื่อแตก/รหัสรายการ", () => {
  it("DOM ทั้งแผ่น 1 + แผ่น 2 ไม่มีคำเรื่องเงิน/เผื่อแตก/ผู้ขาย และไม่มี uuid ของรายการ", () => {
    const m = vi.fn(() => 999);
    const { container } = render(<JobPrintClient job={withGems()} measureMm={m} />);
    const sheets = [...container.querySelectorAll("article")].map((a) => a.textContent ?? "").join(" ");
    expect(sheets).not.toMatch(/ราคา|ต้นทุน|บาท|฿|เผื่อแตก|ผู้ขาย|ยังไม่มีราคา/);
    expect(container.innerHTML).not.toMatch(/price|cost|thb|supplier|breakage|gem_item/i);
    // แผ่นที่พิมพ์ (article) ไม่มี uuid ใดๆ (รหัสรายการพลอย/ใบงาน) — ลิงก์ในแถบจอ (print:hidden) ไม่นับ
    const sheetsHtml = [...container.querySelectorAll("article")].map((a) => a.innerHTML).join(" ");
    expect(sheetsHtml).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });
  it("PrintableJobGem มีเฉพาะ 4 key", () => {
    expect(Object.keys(GEMS[0]).sort()).toEqual(["label", "position", "qtyPerPiece", "qtyTotal"]);
  });
});
