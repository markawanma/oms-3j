// @vitest-environment jsdom
// ProductionSpecCostCard — ความบริสุทธิ์แสดงเป็น % (18 ต.ค. 69) · ใบผลิตไม่มีช่องกรอก purity (อ่านจาก SKU เท่านั้น) จึงเป็นเรื่องการแสดงผล
// ค่าที่ DB/RPC ส่งมายังเป็นสัดส่วน 0..1 — การ์ดแปลงตอนแสดงผ่าน lib/units/purity.ts
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ProductionSpecCostCalc } from "@/lib/production/types";
import { ProductionSpecCostCard } from "./ProductionSpecCostCard";

afterEach(cleanup);

const costCalc: ProductionSpecCostCalc = {
  isComplete: true,
  missing: [],
  priceSource: null,
  asOfDate: null,
  laborSteps: [],
  batchLines: [],
  metalPerPiece: 100,
  laborPerPiece: 50,
  batchPerPiece: 10,
  costPiece: 160,
  nreCost: 0,
  nrePerPiece: 0,
  qty: 5,
  isNewDesign: false,
  metalPriceThbPerGram: null,
  unitCost: 160,
};

function renderCard(silverPurity: number | null) {
  render(<ProductionSpecCostCard makeSpec={null} silverWeightG={3.5} silverPurity={silverPurity} costCalc={costCalc} />);
}

describe("ProductionSpecCostCard — ความบริสุทธิ์", () => {
  it("0.925 จาก DB → แสดง 92.50% (ไม่แสดง 0.925)", () => {
    renderCard(0.925);
    expect(screen.getByText("ความบริสุทธิ์ 92.50%")).toBeInTheDocument();
    expect(screen.queryByText(/0\.925/)).toBeNull();
  });

  it("0.9999 → 99.99% · 1 → 100.00%", () => {
    renderCard(0.9999);
    expect(screen.getByText("ความบริสุทธิ์ 99.99%")).toBeInTheDocument();
    cleanup();
    renderCard(1);
    expect(screen.getByText("ความบริสุทธิ์ 100.00%")).toBeInTheDocument();
  });

  it("ไม่มีค่า (null) → — เหมือนเดิม", () => {
    renderCard(null);
    expect(screen.getByText("ความบริสุทธิ์ —")).toBeInTheDocument();
  });
});
