// ข้อมูลจำลองสำหรับเทสต์หลังบ้านออกแบบแหวน — ชื่อพลอย/แบบเป็นป้ายทดสอบล้วน (ไม่ใช่ชื่อจริงของร้าน) · ตัวเลขเงิน 480/80/120 ตามกติกา brief
import type { AdminCatalog, AdminDesign, AdminOffer, AdminShape, AdminStone, CodeCheckView } from "@/lib/ring-builder/admin-types";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const ID = { round: U(1), oval: U(2), stoneA: U(10), stoneB: U(11), offerA1: U(20), offerA2: U(21), design1: U(30), design2: U(31) };

export const shapeRound: AdminShape = { id: ID.round, nameTh: "กลม", renderKind: "round", isActive: true, sort: 1, usedByActiveDesigns: 2, usedByDesigns: 2, statusChangedAt: "2026-11-10T00:00:00Z" };
export const shapeOval: AdminShape = { id: ID.oval, nameTh: "ไข่", renderKind: "oval", isActive: true, sort: 2, usedByActiveDesigns: 0, usedByDesigns: 0, statusChangedAt: "2026-11-10T00:00:00Z" };

export const offerA1: AdminOffer = { id: ID.offerA1, shapeId: ID.round, shapeName: "กลม", stoneMm100: { major: 200, minor: 200 }, stoneLabel: "2×2", isActive: true, priceThb: 80 };
export const offerA2: AdminOffer = { id: ID.offerA2, shapeId: ID.oval, shapeName: "ไข่", stoneMm100: { major: 400, minor: 300 }, stoneLabel: "4×3", isActive: true, priceThb: 120 };

export const stoneA: AdminStone = {
  id: ID.stoneA, stoneNo: 1, nameTh: "พลอยทดสอบ A", shortName: "ทดA", colorHex: "#112233", isActive: true, sort: 1, offers: [offerA1, offerA2],
  coverage: { visibleDesigns: 3, sellableDesigns: 2, missing: [{ designNo: 2, designName: "แบบทดสอบ ข", stoneCount: 5, shapeName: "กลม", stoneLabel: "3×3", reason: "no_offer" }] },
};
export const stoneB: AdminStone = {
  id: ID.stoneB, stoneNo: 2, nameTh: "พลอยทดสอบ B", shortName: "ทดB", colorHex: "#445566", isActive: false, sort: 2, offers: [],
  coverage: { visibleDesigns: 0, sellableDesigns: 0, missing: [] },
};

export const design1: AdminDesign = {
  id: ID.design1, designNo: 1, name: "แบบทดสอบ ก", stoneCount: 3, shapeId: ID.round, shapeName: "กลม", shapeKind: "round", shapeActive: true,
  stoneMm100: { major: 200, minor: 200 }, stoneLabel: "2×2", stoneAxis: null, sizeMin: 53, sizeMax: 68, bodyPriceThb: 480, cardImageUrl: null,
  isActive: true, published: true, locked: true, visible: true, hiddenReason: null, statusChangedAt: "2026-11-10T00:00:00Z", statusChangedLabel: "เปิดเมื่อ 10 พ.ย. 2569", sort: 1, sellableStones: 4,
};
export const design2: AdminDesign = {
  ...design1, id: ID.design2, designNo: 2, name: "แบบทดสอบ ข", stoneCount: 5, sizeMin: 45, sizeMax: 68, bodyPriceThb: null,
  isActive: true, published: false, locked: false, visible: false, hiddenReason: "draft", sellableStones: 0, sort: 2,
};

export const catalogFull: AdminCatalog = {
  catalogAt: "2026-11-10T00:00:00Z", sizes: { min: 45, max: 68 }, shapes: [shapeRound, shapeOval], designs: [design1, design2], stones: [stoneA, stoneB],
};
export const catalogEmpty: AdminCatalog = { catalogAt: "2026-11-10T00:00:00Z", sizes: { min: 45, max: 68 }, shapes: [shapeRound, shapeOval], designs: [], stones: [] };

export const checkView: CodeCheckView = {
  code: "3JR-AAAAA-BBBBB", designNo: 1, designName: "แบบทดสอบ ก", stoneCount: 5, shapeName: "กลม", stoneLabel: "2×2", size: 54, sizeStatus: "ok", sizeMin: 53, sizeMax: 68,
  pricedAt: "2026-11-09T07:32:00Z", pricedAtLabel: "9 พ.ย. 2569 14:32", ageDays: 1, designActive: true, designClosedLabel: null,
  lines: [
    { pos: 1, stoneNo: 1, name: "พลอยทดสอบ A", closedNow: false },
    { pos: 2, stoneNo: 0, name: "CZ ขาว", closedNow: false },
    { pos: 3, stoneNo: 2, name: "พลอยทดสอบ B", closedNow: true },
  ],
  rows: [
    { label: "ตัวเรือน", count: null, included: false, creationThb: 480, currentThb: 480, diffThb: 0 },
    { label: "พลอยทดสอบ A", count: 2, included: false, creationThb: 160, currentThb: 180, diffThb: 20 },
    { label: "CZ ขาว", count: 3, included: true, creationThb: null, currentThb: null, diffThb: null },
  ],
  creationTotalThb: 640, currentTotalThb: 660, diffTotalThb: 20, signedTotalThb: 640, historyMatchesSignedTotal: true,
  closedStones: [{ stoneNo: 2, name: "พลอยทดสอบ B" }],
  summaryText: "SUMMARY-TEXT-FROM-SERVER", priceNoticeText: "PRICE-NOTICE-FROM-SERVER",
};
