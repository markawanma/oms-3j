// lib/ring-builder/viewer/row-presets.ts — พารามิเตอร์ 3D ของแบบแถว 6 แบบ (ลอกจาก docs/3j-jewelry/cad/trinity-ring-preview.html · ค่าตรงตัว)
// 🔴 ค่าทุกตัวเป็น "ค่าประมาณจากรูป รอวัดจริง" (เจ้าของให้เฉพาะแถวเล็ก ~1.5 มม./7 เม็ด ประมาณ 11 พ.ย.) — ห้ามถึงข้อความลูกค้า (X6/Z7)
// ไฟล์นี้ import ได้จาก showcase-rings.ts เท่านั้น (test import graph) · ตัดคอมเมนต์น้ำหนัก/ที่มาของแต่ละค่าออก — ดูต้นฉบับ + *-ring-spec.md
import type { RowParams } from "./row-ring";

const TRINITY: RowParams = {
  setting: "prong4",
  stoneCount: 3,
  innerDiaMm: 17.2,
  stoneMm: 4.0,
  gapMm: 0.3,
  bandWidthMm: 3.2,
  bandWidthBackMm: 2.6,
  bandThickMm: 1.5,
  cornerMm: 0.35,
  headHeightMm: 2.2,
  prongMm: 0.6,
  prongOverMm: 0.3,
  railMm: 0.5
};

const SCROLL6: RowParams = {
  setting: "shared_prong",
  stoneCount: 6,
  innerDiaMm: 17.2,
  stoneMm: 3.0,
  gapMm: 0.3,
  bandWidthMm: 2.8,
  bandWidthBackMm: 1.6,
  bandThickMm: 1.3,
  bandThickBackMm: 0.95,
  taperRad: 1.3,
  cornerMm: 0.3,
  headHeightMm: 2.4,
  prongMm: 0.6,
  prongOverMm: 0.25,
  railMm: 0.45,
  gallery: "scroll",
  scrollWireMm: 0.3,
  scrollRadiusMm: 0.78,
  scrollTurns: 1.0,
  scrollInner: 0.3,
  shoulder: "scroll_relief",
  reliefWireMm: 0.2,
  reliefRadiusMm: 0.4,
  reliefPitchMm: 1.5,
  reliefCount: 3,
  support: "block",
  supportEndDeg: 78,
  supportOutMm: 1.0,
  supportBotMm: 0.5,
  panelBotMm: 0.9,
  panelLenMm: 2.0,
  panelHMm: 1.45,
  panelFrameMm: 0.18
};

const CHANNEL4: RowParams = {
  setting: "channel",
  stoneCount: 4,
  innerDiaMm: 17.2,
  stoneMm: 2.5,
  gapMm: 0.1,
  bandWidthMm: 3.4,
  bandWidthBackMm: 2.8,
  bandThickMm: 2.6,
  bandThickBackMm: 0.9,
  taperRad: 2.0,
  cornerMm: 0.25,
  gallery: "plain",
  shoulder: "plain",
  channelDepthMm: 1.9,
  channelSinkMm: 0.05,
  channelEndMm: 0.1,
  channelInsetMm: 0.04
};

const CHANNEL6: RowParams = {
  setting: "channel",
  stoneCount: 6,
  innerDiaMm: 17.2,
  stoneMm: 2.0,
  gapMm: 0.15,
  bandWidthMm: 3.2,
  bandWidthBackMm: 2.6,
  bandThickMm: 2.5,
  bandThickBackMm: 0.8,
  taperRad: 2.0,
  cornerMm: 0.25,
  gallery: "plain",
  shoulder: "plain",
  channelDepthMm: 1.8,
  channelSinkMm: 0.05,
  channelEndMm: 0.15,
  channelInsetMm: 0.04
};

const BAR7: RowParams = {
  setting: "bar_prong",
  stoneCount: 7,
  innerDiaMm: 17.2,
  stoneMm: 2.4,
  gapMm: 0.66,
  barMm: 0.7,
  barTopMm: 0.2,
  beadOutMm: 0.08,
  bandWidthMm: 3.3,
  bandWidthBackMm: 2.2,
  bandThickMm: 1.3,
  bandThickBackMm: 1.0,
  taperRad: 1.2,
  cornerMm: 0.25,
  headHeightMm: 1.45,
  prongMm: 0.6,
  gallery: "plain",
  shoulder: "plain",
  support: "block",
  supportShape: "wedge",
  supportEndDeg: 72,
  supportOutMm: 1.0,
  supportBotMm: 0.5
};

const SMALL7: RowParams = {
  setting: "window_head",
  stoneCount: 7,
  innerDiaMm: 17.2,
  stoneMm: 1.5,
  gapMm: 0.4,
  bandWidthMm: 2.3,
  bandWidthBackMm: 2.3,
  bandThickMm: 1.0,
  bandThickBackMm: 1.0,
  taperRad: 1.0,
  cornerMm: 0.25,
  headHeightMm: 1.85,
  topDropMm: 0.05,
  prongMm: 0.5,
  prongOverMm: 0.1,
  prongSideFrac: 0.8,
  windowWMm: 1.0,
  windowTopGapMm: 0.25,
  windowBotMm: 0.6,
  gallery: "plain",
  shoulder: "plain",
  support: "block",
  supportShape: "taper",
  supportTaperPow: 1.7,
  supportEndDeg: 59,
  supportOutMm: 1.0,
  supportBotMm: 0.5
};

export const ROW_PRESET_IDS = ["trinity", "scroll6", "channel4", "channel6", "bar7", "small7"] as const;
export type RowDesignId = (typeof ROW_PRESET_IDS)[number];

export const ROW_PRESETS: Readonly<Record<RowDesignId, RowParams>> = {
  trinity: TRINITY,
  scroll6: SCROLL6,
  channel4: CHANNEL4,
  channel6: CHANNEL6,
  bar7: BAR7,
  small7: SMALL7,
};
