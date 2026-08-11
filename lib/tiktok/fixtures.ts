// lib/tiktok/fixtures.ts — MOCK — รอ analytics DB
//
// Typed fixtures for the Dashboard + Ad Copilot screens (design §5). Numbers
// are copied verbatim from docs/3j-jewelry/ops-app/tiktok-ops-app.html
// (the approved mockup) so the real UI renders pixel-identical to what was
// reviewed. NOT live data — every export here is replaced wholesale once the
// analytics DB ships (only lib/tiktok/mock-actions.ts changes, per design §5
// "สลับไฟล์เดียว UI ไม่แก้").

import type {
  BreakdownRow,
  CopilotRecommendation,
  DailyDashboardData,
  DashboardBreakdownDimension,
} from "@/lib/tiktok/types";

// MOCK — รอ analytics DB
export const MOCK_DASHBOARD_DATE = "2026-08-06";

// MOCK — รอ analytics DB
const CHANNEL_BREAKDOWN: BreakdownRow[] = [
  { label: "TikTok Shop", value: 6800, displayValue: "฿6,800", barPct: 100, subLabel: "55%" },
  { label: "Shopee", value: 3900, displayValue: "฿3,900", barPct: 57, subLabel: "31%" },
  { label: "LINE / แชท", value: 1780, displayValue: "฿1,780", barPct: 26, subLabel: "14%" },
];

// MOCK — รอ analytics DB
const PROVINCE_BREAKDOWN: BreakdownRow[] = [
  { label: "กรุงเทพฯ", value: 9, displayValue: "9", barPct: 100 },
  { label: "ชลบุรี", value: 4, displayValue: "4", barPct: 45 },
  { label: "นนทบุรี", value: 3, displayValue: "3", barPct: 33 },
  { label: "ไม่ระบุ", value: 1, displayValue: "1", barPct: 11, isUnknown: true },
];

// MOCK — รอ analytics DB
const ADDRESS_TYPE_BREAKDOWN: BreakdownRow[] = [
  { label: "บ้าน", value: 18, displayValue: "18", barPct: 100 },
  { label: "คอนโด", value: 5, displayValue: "5", barPct: 28 },
  { label: "ไม่ระบุ", value: 1, displayValue: "1", barPct: 6, isUnknown: true, reviewBadge: "ต้อง review" },
];

// MOCK — รอ analytics DB
const TOP_PRODUCTS_BREAKDOWN: BreakdownRow[] = [
  { label: "สร้อยเงินดิสโก้", value: 8, displayValue: "8 ชิ้น", barPct: 100 },
  { label: "จี้ปี่เซียะ", value: 5, displayValue: "5", barPct: 62 },
  { label: "ต่างหูเงิน", value: 4, displayValue: "4", barPct: 50 },
  { label: "เงินแท่ง 1 บาท", value: 2, displayValue: "2", barPct: 25 },
];

// MOCK — รอ analytics DB
export const MOCK_DASHBOARD_DATA: DailyDashboardData = {
  date: MOCK_DASHBOARD_DATE,
  kpis: {
    salesToday: { label: "ยอดขายวันนี้", value: 12480, displayValue: "฿12,480", deltaPct: 12, trend: "up" },
    orderCount: { label: "จำนวนออเดอร์", value: 26, displayValue: "26", deltaPct: -3, trend: "down" },
    profitEstimate: {
      label: "กำไรโดยประมาณ",
      value: 4120,
      displayValue: "฿4,120",
      deltaPct: 5,
      trend: "up",
      coveragePct: 62,
    },
    aov: { label: "ยอดเฉลี่ย/ออเดอร์", value: 480, displayValue: "฿480", deltaPct: 0, trend: "flat" },
  },
  dataQuality: {
    costCoveragePct: 62,
    provinceUnknownPct: 4,
    addressPendingReviewCount: 6,
  },
  breakdown: {
    channel: CHANNEL_BREAKDOWN,
    province: PROVINCE_BREAKDOWN,
    addressType: ADDRESS_TYPE_BREAKDOWN,
    topProducts: TOP_PRODUCTS_BREAKDOWN,
  } satisfies Record<DashboardBreakdownDimension, BreakdownRow[]>,
};

// MOCK — รอ analytics DB + LLM engine — 4 cards, numbers sourced from
// docs/3j-jewelry/analytics/sales-2026-h1-summary.md via the mockup's
// "ฐานการวิเคราะห์" overview (H1 2026 real aggregate, not invented).
export const MOCK_COPILOT_RECOMMENDATIONS: CopilotRecommendation[] = [
  {
    id: "copilot-reactivate-line",
    icon: "MessageCircle",
    title: "Reactivate ลูกค้า LINE เก่า — เปิด pre-order รุ่น Heirloom",
    reasonText:
      "ม.ค.–ก.พ. LINE ทำยอด ~฿15.4M (≈78% ของครึ่งปี) ที่ AOV ฿11k–17k แล้วเงียบ พร้อม AOV ร่วงเหลือ ฿715 — ฐาน high-value นี้ยังไม่ถูก re-engage เลย",
    reasonMetrics: [
      { label: "LINE ต้นปี", value: "฿15.4M" },
      { label: "AOV peak", value: "฿17,106" },
      { label: "ปัจจุบัน", value: "฿715" },
    ],
    confidence: "high",
    status: "pending",
  },
  {
    id: "copilot-tiktok-lookalike",
    icon: "TrendingUp",
    title: "ยิงแอด TikTok เจาะสายมู + lookalike จาก LINE seed",
    reasonText:
      "TikTok โต 0% → 45% ของยอดใน 5 เดือน ออเดอร์/เดือนเพิ่ม 713→1,364 แต่ AOV แค่ ฿715 — สร้าง lookalike จากฐาน LINE ดึงคนคุณภาพแทนการแย่งราคาต่อกรัม",
    reasonMetrics: [
      { label: "TikTok share", value: "45%" },
      { label: "ออเดอร์", value: "×1.9" },
      { label: "AOV", value: "฿715" },
    ],
    confidence: "high",
    status: "pending",
  },
  {
    id: "copilot-pilot-mongkol-live",
    icon: "Sparkles",
    title: "Pilot ไลฟ์ธีมมงคล แทนไลฟ์เงินแท่ง (Tier Live ฿300–800)",
    reasonText:
      "เงินแท่งผูกราคา commodity ร่วง ~20 เท่า (฿12.2M → ฿975k) มงคลตั้งราคาเองได้ margin นิ่ง + มี ~40 SKU พร้อม — แนะนำ pilot 4–6 สัปดาห์ก่อนทุ่มงบ",
    reasonMetrics: [
      { label: "เงินแท่ง", value: "−20×" },
      { label: "มงคล", value: "~40 SKU" },
      { label: "pilot", value: "4–6 wk" },
    ],
    confidence: "medium",
    status: "pending",
  },
  {
    id: "copilot-fix-cost-entry",
    icon: "AlertTriangle",
    title: "แก้การกรอกต้นทุนก่อน — อย่าเพิ่งตัดสินงบจากกำไร",
    reasonText:
      "ต้นทุนกรอกครบแค่ 62% พบออเดอร์ ฿20,441 กรอกต้นทุน ฿50 → margin ปลอมสูง ตราบใดยังไม่แก้ การตัดงบจากกำไรต่อช่องทางเสี่ยงยิงผิดทาง",
    reasonMetrics: [
      { label: "coverage", value: "62%" },
      { label: "ผิด", value: "฿20,441/฿50" },
    ],
    confidence: "low",
    status: "pending",
    isBlocker: true,
  },
];
