// @vitest-environment jsdom
// QA G1a UI (R2-D2 · 22 ต.ค. 69) — บันไดล้นหน้า A5 x สถานะรูปหลัก (usePrintPhoto): ตัดรูปโดยบันได (noPhoto/compact) ต้องไม่ทำให้ปุ่มพิมพ์ค้าง/ขึ้นข้อความ "โหลดรูปไม่ได้" ผิดๆ
//  it.fails = ช่องที่ QA รายงาน (ผ่านเมื่อพฤติกรรมยังเป็นอย่างที่รายงาน · แก้แล้วจะล้ม → เปลี่ยนเป็น it ธรรมดา)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/jobs/x/print" }));
vi.mock("@/lib/actions/job-office-write", () => ({ issueJobQr: vi.fn() }));

import { JobPrintClient } from "@/components/domain/jobs/JobPrintClient";
import { PRINT_PHOTO_TIMEOUT_MS } from "@/components/domain/jobs/photos/usePrintPhoto";
import type { PrintableJob } from "@/lib/jobs/print";

const PHOTO = "https://x.supabase.co/storage/v1/object/sign/job-photos/s/j/p1_md.jpg?token=a";
const GEMS = [
  { label: "โกเมน · ไข่ · 4×6 มม.", qtyPerPiece: 2, qtyTotal: 70, position: "บ่าซ้าย-ขวา" },
  { label: "CZ · กลม · 1.5 มม.", qtyPerPiece: 30, qtyTotal: 1050, position: "ล้อมรอบ" },
];
const job = (): PrintableJob => ({
  jobId: "11111111-1111-4111-8111-111111111111", jobNo: "JB-0031", designLabel: "แหวนโกเมนไข่", sku: "RG-0418", metalLabel: "เงิน", qtyOrder: 35, qtyPlanned: 35, targetPieceG: 4, metalPlanG: 150, dueDate: null,
  sourceLabel: "งานลูกค้า", weightStartG: null, profileName: null, primaryPhotoUrl: PHOTO, gems: GEMS, gemsState: "specified",
  stages: Array.from({ length: 9 }, (_, i) => ({ seq: i + 1, name: `ขั้น ${i + 1}`, weighRequired: false, scrapQtyAsk: false, scrapWeightAsk: false })),
});
const printBtn = () => screen.getByRole("button", { name: /ออก QR และพิมพ์|กำลังโหลดรูป/ });

describe("บันไดล้นหน้า: ตัดรูป (noPhoto) กับสถานะรูปหลักของหน้าพิมพ์", () => {
  beforeEach(() => vi.useFakeTimers());

  it("ล้นตั้งแต่ mount (รูปยังไม่ทันโหลด) -> บันไดตัดรูป · แถบ noPhoto ขึ้น · พลอยครบทุกแถว", () => {
    render(<JobPrintClient job={job()} measureMm={() => (screen.queryByTestId("print-photo") ? 205 : 190)} />);
    expect(screen.queryByTestId("print-photo")).not.toBeInTheDocument();
    expect(screen.getByTestId("print-gems-notice")).toHaveTextContent("ตัดรูปออกเพื่อให้ตารางพลอยพอดี");
    expect(screen.getAllByTestId("sheet-gem-row")).toHaveLength(2);
  });

  it.fails("บันไดเป็นฝ่ายตัดรูปเอง (รูปไม่เคยโหลดเสร็จ) -> ปุ่ม 'ออก QR และพิมพ์' ต้องกดได้ทันที ไม่ต้องรอ timeout 8 วินาที (วันนี้ <img> ถูกถอดก่อน onLoad -> status ค้าง loading -> ปุ่ม disabled)", () => {
    render(<JobPrintClient job={job()} measureMm={() => (screen.queryByTestId("print-photo") ? 205 : 190)} />);
    expect(printBtn()).toHaveTextContent("ออก QR และพิมพ์");
    expect(printBtn()).toBeEnabled();
  });

  it.fails("บันไดตัดรูปเอง แล้วรอเกิน timeout -> ต้องไม่ขึ้นแถบเหลือง 'โหลดรูปหลักไม่ได้' (ขัดกับแถบ 'ตัดรูปออกเพื่อให้ตารางพลอยพอดี' ที่ขึ้นพร้อมกัน — ผู้ใช้เข้าใจว่ารูปเสีย)", () => {
    render(<JobPrintClient job={job()} measureMm={() => (screen.queryByTestId("print-photo") ? 205 : 190)} />);
    act(() => {
      vi.advanceTimersByTime(PRINT_PHOTO_TIMEOUT_MS + 200);
    });
    expect(screen.queryByText(/โหลดรูปหลักไม่ได้/)).not.toBeInTheDocument();
  });
});
