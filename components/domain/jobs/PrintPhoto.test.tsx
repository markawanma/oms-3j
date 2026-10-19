// @vitest-environment jsdom
// ใบพิมพ์ A5 + ใบย่อย + รูปหลัก 30×30 มม. (0182): รูปลอยขวาในหัวใบ · ปุ่มพิมพ์รอรูปโหลด · รูปพัง/หมดเวลา = ตัดรูปออกแล้วพิมพ์ · ใบไม่มีรูป = markup เดิมเป๊ะ
// ต้องไม่พัง: ใบไม่มีรูปปุ่มไม่ถูกกั้น · เตือนไม่บล็อก · ไม่มีตัวเลขเงิน/ชื่อลูกค้า/ชื่อไฟล์บนใบ · ตารางขั้นไม่ถูกแตะ
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import type { ReactElement } from "react";

afterEach(cleanup);

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/jobs" }));
vi.mock("next/link", () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));
const issueJobQr = vi.fn();
vi.mock("@/lib/actions/job-office-write", () => ({ issueJobQr: (...a: unknown[]) => issueJobQr(...a), revokeJobQr: vi.fn() }));
const listJobQr = vi.fn();
vi.mock("@/lib/actions/job-lots", () => ({ listJobQr: (...a: unknown[]) => listJobQr(...a), splitJobLot: vi.fn(), cancelJobLot: vi.fn(), resolveDiscrepancyOffice: vi.fn(), voidDiscrepancy: vi.fn() }));

import { ToastProvider } from "@/components/ui/Toast";
import { JobPrintClient, JobSheet } from "./JobPrintClient";
import { SublotPrintClient, SublotSheet } from "./SublotPrintClient";
import { PRINT_PHOTO_TIMEOUT_MS } from "./photos/usePrintPhoto";
import { toPrintableJob, toPrintableSublot } from "@/lib/jobs/print";
import { mapLotPart } from "@/lib/jobs/lots";
import { mapJobDetail } from "@/lib/jobs/types";
import type { StageRow } from "@/lib/jobs/types";

const wrap = (ui: ReactElement) => render(<ToastProvider>{ui}</ToastProvider>);
const JOB = "11111111-1111-4111-8111-111111111111";
const LOT = "22222222-2222-4222-8222-222222222222";
const PHOTO = "https://abc.supabase.co/storage/v1/object/sign/job-photos/a7c850ee-6776-4c3e-ba72-ba9e8caba2b7/11111111-1111-4111-8111-111111111111/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa_md.jpg?token=tok";

const stage = (code: string, seq: number): StageRow => ({
  id: `s-${code}`, seq, code, name: ({ cast: "หล่อ", file: "ตะไบ", polish: "ขัด" } as Record<string, string>)[code] ?? code, status: "pending",
  weighRequired: false, scrapQtyAsk: true, scrapWeightAsk: false, metalPresent: true, receivedOn: null, sentOn: null, workerId: null, holderName: null,
  autoClosed: false, qtyIn: null, qtyOut: null, qtyScrap: 0, scrapReason: null, weightInG: null, weightOutG: null, metalAddedG: 0, scrapWeightG: null, weightNote: null, skipReason: null,
});
const STAGES = [stage("cast", 1), stage("file", 2), stage("polish", 3)];
const job = () => mapJobDetail({ id: JOB, job_no: "JB-0100", source_kind: "oem", design_label: "แหวนลาย A", sku_snapshot: "RG-001", metal: "silver", qty_planned: 30, qty_order: 30, status: "open", due_date: "2026-10-30", note: "หมายเหตุภายใน บริษัท ลับ" })!;
const printable = (photo: string | null) => toPrintableJob(job(), STAGES, photo);
const part = () => ({ ...mapLotPart({ job_id: LOT, root_job_id: JOB, lot_seq: 2, label: "JB-0100 · ส่วนที่ 2", status: "in_progress", qty_planned: 40, qty_live: 40, stage_code: "polish", stage_name: "ขัด", stage_status: "pending" })!, passedStages: ["หล่อ"] });
const sublot = (photo: string | null) => toPrintableSublot(job(), part(), "2026-10-19", photo)!;
const QR_SVG = '<svg viewBox="0 0 25 25"><rect width="25" height="25"/></svg>';

beforeEach(() => {
  vi.clearAllMocks();
  window.print = vi.fn();
  listJobQr.mockResolvedValue({ ok: true, data: [] });
  issueJobQr.mockResolvedValue({ ok: true, data: { svg: QR_SVG, printNo: 1, jobNo: "JB-0100", revokedPrevious: 0 } });
});

describe("JobSheet (A5) — รูปหลักลอยขวาในหัวใบ", () => {
  it("มีรูป: กล่อง 30×30 มม. ลอยขวา เป็นลูกแรกของคอลัมน์ข้อความ · object-contain (ไม่ตัดขอบ) · มีขอบ · ห่าง QR · alt = เลขใบ ไม่มีชื่อไฟล์/ลูกค้า", () => {
    const { container } = render(<JobSheet job={printable(PHOTO)} qrSvg={QR_SVG} />);
    const box = screen.getByTestId("print-photo");
    expect(box.className).toContain("float-right");
    expect(box.className).toContain("w-[30mm]");
    expect(box.className).toContain("ml-[3mm]"); // ห่างข้อความ · ร่วมกับ gap-3 ของหัวใบ = ห่าง QR ≥ 4 มม.
    const img = within(box).getByRole("img");
    expect(img).toHaveAttribute("src", PHOTO);
    expect(img).toHaveAttribute("alt", "รูปงาน JB-0100");
    expect(img.className).toContain("h-[30mm]");
    expect(img.className).toContain("w-[30mm]");
    expect(img.className).toContain("object-contain");
    expect(img.className).not.toContain("object-cover");
    expect(img.className).toContain("border");
    // ลูกแรกของ div.min-w-0 ในหัวใบ — ข้อความไหลอ้อม
    const col = container.querySelector("header > div.min-w-0")!;
    expect(col.firstElementChild).toBe(box);
    // QR ไม่ถูกแตะ
    expect(container.querySelector('[role="img"][aria-label^="QR สแกน"]')).not.toBeNull();
    expect(screen.getByText("สแกนเพื่อรับ / ส่งต่อ")).toBeInTheDocument();
  });

  it("🔴 ไม่มีตัวเลขเงิน/ชื่อลูกค้า/หมายเหตุภายในบนใบ — รูปไม่พก caption/ที่มา", () => {
    const { container } = render(<JobSheet job={printable(PHOTO)} qrSvg={null} />);
    const text = container.textContent ?? "";
    expect(text).not.toContain("บริษัท ลับ");
    expect(text).not.toMatch(/บาท|฿|THB|ราคา|ต้นทุน/);
    expect(container.querySelectorAll("img")).toHaveLength(1);
  });

  it("ตารางขั้น/หมายเหตุไม่ถูกย่อหรือเพิ่มแถว: จำนวนแถวและความสูงแถวเท่าใบไม่มีรูปเป๊ะ", () => {
    const a = render(<JobSheet job={printable(PHOTO)} qrSvg={null} />);
    const withRows = a.container.querySelectorAll("tbody tr");
    const withClasses = [...withRows].map((r) => r.className);
    a.unmount();
    const b = render(<JobSheet job={printable(null)} qrSvg={null} />);
    expect([...b.container.querySelectorAll("tbody tr")].map((r) => r.className)).toEqual(withClasses);
    expect(withRows).toHaveLength(3);
  });

  it("ใบไม่มีรูป = markup เดิมเป๊ะ: ไม่มีกล่องรูป/<img>/พื้นที่ว่างเผื่อ · เหมือนกับตอนสั่งตัดรูปออก (showPhoto=false) ทุกตัวอักษร", () => {
    const none = render(<JobSheet job={printable(null)} qrSvg={null} />);
    expect(screen.queryByTestId("print-photo")).not.toBeInTheDocument();
    expect(none.container.querySelector("img")).toBeNull();
    const noneHtml = none.container.innerHTML;
    expect(none.container.querySelector("header > div.min-w-0")!.firstElementChild?.tagName).toBe("P");
    none.unmount();
    const cut = render(<JobSheet job={printable(PHOTO)} qrSvg={null} showPhoto={false} />);
    expect(cut.container.innerHTML).toBe(noneHtml);
  });

  it("onLoad/onError ของรูปส่งต่อให้ผู้เรียก", () => {
    const onPhotoLoad = vi.fn();
    const onPhotoError = vi.fn();
    render(<JobSheet job={printable(PHOTO)} qrSvg={null} onPhotoLoad={onPhotoLoad} onPhotoError={onPhotoError} />);
    fireEvent.load(screen.getByRole("img", { name: "รูปงาน JB-0100" }));
    fireEvent.error(screen.getByRole("img", { name: "รูปงาน JB-0100" }));
    expect(onPhotoLoad).toHaveBeenCalledTimes(1);
    expect(onPhotoError).toHaveBeenCalledTimes(1);
  });
});

describe("JobPrintClient — ปุ่มพิมพ์รอรูป", () => {
  const issueBtn = () => screen.getByRole("button", { name: /ออก QR และพิมพ์|กำลังโหลดรูป/ });

  it("มีรูป: ปุ่มปิด + 'กำลังโหลดรูป…' จนรูปโหลดเสร็จ → เปิด · แสดงภาพย่อ + 'รูปหลัก: มี — พิมพ์ 30×30 มม.'", () => {
    render(<JobPrintClient job={printable(PHOTO)} />);
    expect(issueBtn()).toBeDisabled();
    expect(issueBtn()).toHaveTextContent("กำลังโหลดรูป…");
    expect(screen.getByText("กำลังโหลดรูปหลัก…")).toBeInTheDocument();
    fireEvent.load(screen.getAllByRole("img", { name: "รูปงาน JB-0100" })[0]);
    expect(issueBtn()).toBeEnabled();
    expect(issueBtn()).toHaveTextContent("ออก QR และพิมพ์");
    expect(screen.getByText(/รูปหลัก: มี — พิมพ์ 30×30 มม./)).toBeInTheDocument();
  });

  it("โหลดรูปเสร็จ → กดออก QR → issueJobQr แล้ว window.print() (หลังรูป+QR วาดแล้ว)", async () => {
    render(<JobPrintClient job={printable(PHOTO)} />);
    fireEvent.load(screen.getAllByRole("img", { name: "รูปงาน JB-0100" })[0]);
    await userEvent.click(issueBtn());
    await waitFor(() => expect(issueJobQr).toHaveBeenCalledWith(JOB, false));
    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1), { timeout: 2000 });
  });

  it("รูปโหลดไม่ได้ (onError): แถบเหลือง role=alert + 'โหลดหน้าใหม่' · ใบตกกลับเป็นไม่มีรูป (ถอดรูปออก) · ยังพิมพ์ได้ (ไม่บล็อก)", async () => {
    const { container } = render(<JobPrintClient job={printable(PHOTO)} />);
    fireEvent.error(screen.getAllByRole("img", { name: "รูปงาน JB-0100" })[0]);
    expect(screen.getByRole("alert")).toHaveTextContent("โหลดรูปหลักไม่ได้ — ใบจะพิมพ์โดยไม่มีรูป");
    expect(screen.getByRole("button", { name: "โหลดหน้าใหม่" })).toBeInTheDocument();
    expect(screen.queryByTestId("print-photo")).not.toBeInTheDocument();
    expect(container.querySelector("article img")).toBeNull();
    expect(issueBtn()).toBeEnabled();
    await userEvent.click(issueBtn());
    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1), { timeout: 2000 });
  });

  it("รอรูปเกิน 8 วินาที = ถือว่าล้ม (ลิงก์หมดอายุ/ไม่มีเน็ต) → ตัดรูปออก ปุ่มเปิด", () => {
    vi.useFakeTimers();
    try {
      render(<JobPrintClient job={printable(PHOTO)} />);
      expect(issueBtn()).toBeDisabled();
      act(() => void vi.advanceTimersByTime(PRINT_PHOTO_TIMEOUT_MS - 100));
      expect(issueBtn()).toBeDisabled();
      act(() => void vi.advanceTimersByTime(200));
      expect(screen.getByRole("alert")).toHaveTextContent("โหลดรูปหลักไม่ได้");
      expect(screen.queryByTestId("print-photo")).not.toBeInTheDocument();
      expect(issueBtn()).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("ไม่มีรูป: ไม่กั้นปุ่ม · เตือนเบาๆ 'ไม่มีรูป — ใบจะไม่มีรูปหลัก' + ลิงก์ไปเพิ่มรูปที่การ์ด · กดพิมพ์ได้ตามปกติ", async () => {
    const { container } = render(<JobPrintClient job={printable(null)} />);
    expect(issueBtn()).toBeEnabled();
    expect(issueBtn()).toHaveTextContent("ออก QR และพิมพ์");
    expect(screen.getByText(/ไม่มีรูป — ใบจะไม่มีรูปหลัก/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "เพิ่มรูปก่อนพิมพ์" })).toHaveAttribute("href", `/jobs/${JOB}#job-photos`);
    expect(container.querySelector("article img")).toBeNull();
    await userEvent.click(issueBtn());
    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1), { timeout: 2000 });
  });

  it("ข้อความสถานะรูปอยู่ในส่วน print:hidden เท่านั้น — ไม่ขึ้นกระดาษ", () => {
    const { container } = render(<JobPrintClient job={printable(null)} />);
    const status = screen.getByText(/ไม่มีรูป — ใบจะไม่มีรูปหลัก/);
    expect(status.closest(".print\\:hidden")).not.toBeNull();
    expect(container.querySelector("article")!.textContent).not.toContain("ไม่มีรูป");
  });
});

describe("ใบย่อย (SublotSheet) — รูปหลักของใบแม่", () => {
  it("มีรูป: 30×30 มม. อยู่แถวเดียวกับข้อความ 'ผ่านมาแล้ว' · alt = ป้ายใบย่อย · ข้อความยังอยู่ครบ", () => {
    const { container } = render(<SublotSheet sub={sublot(PHOTO)} qrSvg={null} />);
    const box = screen.getByTestId("print-photo");
    expect(within(box).getByRole("img")).toHaveAttribute("alt", "รูปงาน JB-0100 · ส่วนที่ 2");
    expect(within(box).getByRole("img").className).toContain("object-contain");
    expect(box.parentElement!.className).toContain("flex");
    expect(box.parentElement!.textContent).toContain("ผ่านมาแล้ว: หล่อ");
    expect(screen.getByText(/สแกน QR นี้ = เปิดใบงานเดิม/)).toBeInTheDocument();
    expect(container.querySelectorAll("img")).toHaveLength(1);
  });

  it("ไม่มีรูป = markup เดิมเป๊ะ (เหมือนตอนตัดรูปออก)", () => {
    const none = render(<SublotSheet sub={sublot(null)} qrSvg={null} />);
    expect(screen.queryByTestId("print-photo")).not.toBeInTheDocument();
    const html = none.container.innerHTML;
    none.unmount();
    const cut = render(<SublotSheet sub={sublot(PHOTO)} qrSvg={null} showPhoto={false} />);
    expect(cut.container.innerHTML).toBe(html);
  });

  it("SublotPrintClient: มีรูป = ปุ่มรอรูปโหลด → เปิด · รูปพัง = เตือน + พิมพ์แบบไม่มีรูปได้ · ไม่มีรูป = ลิงก์เพิ่มรูป", async () => {
    const a = wrap(<SublotPrintClient sub={sublot(PHOTO)} />);
    const btn = () => screen.getByRole("button", { name: /ออก QR และพิมพ์|กำลังโหลดรูป/ });
    await waitFor(() => expect(listJobQr).toHaveBeenCalled());
    expect(btn()).toBeDisabled();
    expect(btn()).toHaveTextContent("กำลังโหลดรูป…");
    fireEvent.error(screen.getAllByRole("img", { name: "รูปงาน JB-0100 · ส่วนที่ 2" })[0]);
    expect(screen.getByText(/โหลดรูปหลักไม่ได้ — ใบจะพิมพ์โดยไม่มีรูป/)).toBeInTheDocument();
    expect(screen.queryByTestId("print-photo")).not.toBeInTheDocument();
    await waitFor(() => expect(btn()).toBeEnabled());
    a.unmount();
    wrap(<SublotPrintClient sub={sublot(null)} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "ออก QR และพิมพ์" })).toBeEnabled());
    expect(screen.getByRole("link", { name: "เพิ่มรูปก่อนพิมพ์" })).toHaveAttribute("href", `/jobs/${JOB}#job-photos`);
  });
});
