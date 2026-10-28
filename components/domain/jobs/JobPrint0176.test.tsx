// @vitest-environment jsdom
// 0176 ใบพิมพ์ A5: "แบบ: …" · คอลัมน์ตามแบบ · เซลล์ไม่ต้องกรอก = "—" · ใบเดิมคงเดิม · 🔴 ไม่มีป้าย/เตือนทอง/แผนทองบนกระดาษ
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

afterEach(cleanup);
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/jobs/x/print" }));
vi.mock("@/lib/actions/job-office-write", () => ({ issueJobQr: vi.fn() }));

import { JobSheet, sheetColumns } from "./JobPrintClient";
import { toPrintableJob } from "@/lib/jobs/print";
import { findForbiddenKeys } from "@/lib/jobs/worker-view";
import { mapJobDetail } from "@/lib/jobs/types";
import type { StageRow } from "@/lib/jobs/types";

const stage = (code: string, seq: number, o: Partial<StageRow> = {}): StageRow => ({
  id: `s-${code}`, seq, code, name: ({ cast: "หล่อ", file: "ตะไบ", polish: "ขัด", qc: "QC" } as Record<string, string>)[code] ?? code, status: "pending",
  weighRequired: false, scrapQtyAsk: false, scrapWeightAsk: false, metalPresent: true, receivedOn: null, sentOn: null, workerId: null, holderName: null,
  autoClosed: false, qtyIn: null, qtyOut: null, qtyScrap: 0, scrapReason: null, weightInG: null, weightOutG: null, metalAddedG: 0, scrapWeightG: null, weightNote: null, skipReason: null, ...o,
});
const job = (o: Record<string, unknown> = {}) =>
  mapJobDetail({ id: "11111111-1111-4111-8111-111111111111", job_no: "JB-0100", source_kind: "oem", design_label: "แหวนลาย A", metal: "silver", qty_planned: 30, qty_order: 30, status: "open", target_piece_g: 4, metal_plan_g: 120, weight_start_g: 5, profile_id: "p1", profile_name: "แบบ 1 — ชั่งเฉพาะหล่อ", require_final_weight: true, weigh_required: true, ...o })!;
const sheet = (j: ReturnType<typeof job>, stages: StageRow[]) => render(<JobSheet job={toPrintableJob(j, stages)} qrSvg={null} />);
const heads = () => within(screen.getByRole("table")).getAllByRole("columnheader").map((h) => h.textContent);
const rowCells = (name: RegExp) => {
  const tr = screen.getByRole("cell", { name }).closest("tr")!;
  return within(tr).getAllByRole("cell").map((c) => c.textContent);
};

const PROFILED = [
  stage("cast", 1, { weighRequired: true, scrapQtyAsk: true, scrapWeightAsk: true }),
  stage("file", 2, {}),
  stage("polish", 3, { scrapQtyAsk: true }),
];

describe("0176 ใบพิมพ์ — ใบที่มีแบบ", () => {
  it("พิมพ์ 'แบบ: <ชื่อ>' ใต้หัวเรื่อง · คอลัมน์ครบเมื่อมีขั้นที่กรอก (นน.เข้า/ออก · เสีย · เศษ) · ท้ายตาราง '* ขั้นที่ต้องชั่ง'", () => {
    sheet(job(), PROFILED);
    expect(screen.getByText("แบบ: แบบ 1 — ชั่งเฉพาะหล่อ")).toBeInTheDocument();
    expect(heads()).toEqual(["ขั้น", "วันรับ", "ผู้รับเซ็น", "นน.เข้า", "วันส่ง", "นน.ออก", "เสีย", "เศษ (g)", "ผู้ส่งเซ็น"]);
    expect(screen.getByText("* ขั้นที่ต้องชั่งน้ำหนักทุกครั้ง")).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "1. หล่อ *" })).toBeInTheDocument();
  });

  it("เซลล์ที่ขั้นนั้นไม่ต้องกรอก = '—' · ขั้นที่ต้องกรอก = ว่างให้เขียน", () => {
    sheet(job(), PROFILED);
    // [ขั้น, วันรับ, ผู้รับ, นน.เข้า, วันส่ง, นน.ออก, เสีย, เศษ, ผู้ส่ง]
    expect(rowCells(/1\. หล่อ/)).toEqual(["1. หล่อ *", "", "", "", "", "", "", "", ""]);
    expect(rowCells(/2\. ตะไบ/)).toEqual(["2. ตะไบ", "", "", "—", "", "—", "—", "—", ""]);
    expect(rowCells(/3\. ขัด/)).toEqual(["3. ขัด", "", "", "—", "", "—", "", "—", ""]);
  });

  it("ไม่มีขั้นชั่งเลยทั้งใบ → ตัดคอลัมน์ นน.เข้า/ออก + ตัดหมายเหตุ '*' · ไม่มีขั้นถามเสียเลย → ตัดคอลัมน์ เสีย · ไม่มีขั้นถามเศษ → ไม่มีคอลัมน์ เศษ", () => {
    sheet(job(), [stage("cast", 1, { scrapQtyAsk: true }), stage("qc", 2, { scrapQtyAsk: true })]);
    expect(heads()).toEqual(["ขั้น", "วันรับ", "ผู้รับเซ็น", "วันส่ง", "เสีย", "ผู้ส่งเซ็น"]);
    expect(screen.queryByText(/ขั้นที่ต้องชั่งน้ำหนักทุกครั้ง/)).not.toBeInTheDocument();
    cleanup();
    sheet(job(), [stage("cast", 1, { weighRequired: true }), stage("qc", 2, {})]);
    expect(heads()).toEqual(["ขั้น", "วันรับ", "ผู้รับเซ็น", "นน.เข้า", "วันส่ง", "นน.ออก", "ผู้ส่งเซ็น"]);
    cleanup();
    sheet(job(), [stage("cast", 1, {}), stage("qc", 2, {})]);
    expect(heads()).toEqual(["ขั้น", "วันรับ", "ผู้รับเซ็น", "วันส่ง", "ผู้ส่งเซ็น"]);
  });

  it("ขั้นที่ข้ามไม่ถูกนับ (ไม่พิมพ์แถว · ไม่ทำให้คอลัมน์โผล่)", () => {
    sheet(job(), [stage("cast", 1, { scrapQtyAsk: true }), stage("file", 2, { weighRequired: true, status: "skipped" })]);
    expect(heads()).not.toContain("นน.เข้า");
    expect(screen.queryByText(/ตะไบ/)).not.toBeInTheDocument();
  });
});

describe("0176 ใบพิมพ์ — ใบเดิม (ไม่มีแบบ) คงเดิมทุกประการ", () => {
  it("ไม่มีบรรทัด 'แบบ:' · คอลัมน์ครบ 8 · เซลล์ว่างทุกช่อง (ไม่มี '—') · หมายเหตุ '*' ยังอยู่", () => {
    const legacy = [stage("cast", 1, { weighRequired: true, scrapQtyAsk: true }), stage("qc", 2, { scrapQtyAsk: true })];
    sheet(job({ profile_id: null, profile_name: null, require_final_weight: false }), legacy);
    expect(screen.queryByText(/^แบบ:/)).not.toBeInTheDocument();
    expect(heads()).toEqual(["ขั้น", "วันรับ", "ผู้รับเซ็น", "นน.เข้า", "วันส่ง", "นน.ออก", "เสีย", "ผู้ส่งเซ็น"]);
    expect(rowCells(/2\. QC/)).toEqual(["2. QC", "", "", "", "", "", "", ""]);
    expect(screen.getByText("* ขั้นที่ต้องชั่งน้ำหนักทุกครั้ง")).toBeInTheDocument();
  });

  it("ใบเดิมที่ขั้น flag ดูเหมือนปิด (ไม่ถามเสีย/ไม่ชั่งเลย) ก็ยังพิมพ์ครบ 8 คอลัมน์ — ใบเดิมไม่ใช้ flag ใหม่", () => {
    sheet(job({ profile_id: null, profile_name: null }), [stage("cast", 1, {}), stage("qc", 2, {})]);
    expect(heads()).toHaveLength(8);
    expect(sheetColumns({ profileName: null, stages: [] })).toEqual({ weigh: true, scrapQty: true, scrapWeight: false, legacy: true });
  });
});

describe("0176 🔴 ใบพิมพ์ใบทอง — ไม่ถอยการซ่อนแผนทอง · ไม่มีป้าย/เตือนทอง", () => {
  const goldStages = [stage("cast", 1, { weighRequired: true, scrapQtyAsk: true }), stage("file", 2, {}), stage("polish", 3, {})]; // ตะไบ/ขัด = โลหะในมือแต่ไม่ชั่ง (ไม่มีด่าน)
  it("ใบทอง + แบบที่ขั้นโลหะไม่ชั่ง: พิมพ์ชื่อแบบได้ แต่ไม่มีแผนโลหะ/น้ำหนักเป้าหมาย/น้ำหนักตั้งต้น/คำเตือนทอง/ป้ายแดง", () => {
    const { container } = sheet(job({ metal: "gold", weight_start_g: 12.5, target_piece_g: 4, metal_plan_g: 153.6 }), goldStages);
    const t = container.textContent ?? "";
    expect(t).toContain("แบบ: แบบ 1 — ชั่งเฉพาะหล่อ");
    expect(t).not.toContain("โลหะที่ต้องเตรียม");
    expect(t).not.toContain("น้ำหนักเป้าหมาย");
    expect(t).not.toContain("153.6");
    expect(t).not.toContain("12.5");
    expect(t).not.toMatch(/ไม่มีด่าน|กันทองหาย|รับทราบ|ไม่ชั่ง|ทอง · /);
    expect(container.querySelector("[class*=red-]")).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("PrintableJob ประกอบทีละ field: ไม่มี profileId / requireFinalWeight / goldUnguarded / flag ระดับใบ · ไม่มี key ต้องห้าม", () => {
    const p = toPrintableJob(job({ metal: "gold" }), goldStages);
    expect(Object.keys(p).sort()).toEqual(["designLabel", "dueDate", "gems", "gemsState", "jobId", "jobNo", "metalLabel", "metalPlanG", "primaryPhotoUrl", "profileName", "qtyOrder", "qtyPlanned", "sku", "sourceLabel", "stages", "targetPieceG", "weightStartG"]);
    expect(Object.keys(p.stages[0]).sort()).toEqual(["name", "scrapQtyAsk", "scrapWeightAsk", "seq", "weighRequired"]);
    expect([p.targetPieceG, p.metalPlanG, p.weightStartG]).toEqual([null, null, null]);
    expect(findForbiddenKeys(p)).toEqual([]);
    expect(JSON.stringify(p)).not.toMatch(/profile_id|profileId|requireFinal|goldUnguarded|metalPresent|metal_present/);
  });
});
