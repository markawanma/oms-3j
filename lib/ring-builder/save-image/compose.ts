// lib/ring-builder/save-image/compose.ts — วาดภาพ "บันทึกรูป" บน canvas 2D แล้วคืน JPEG Blob (ux-ring-save-image §1)
// รับ "ข้อมูล" เท่านั้น (พิกเซลแหวน + แถว + วันที่) ไม่รับ DOM/คอมโพเนนต์ (S16) · ข้อความทุกบรรทัดที่วาดมาจาก whitelist: แถวจาก buildShowcaseDetailRows + SHOWCASE_COPY (S1)
// 🔴 ไม่มี fetch/XHR/sendBeacon/storage/cookie ในไฟล์นี้ (S2/S3 · เทสต์ spy) · ไม่มีลิงก์/QR/LINE ID/โดเมนบนภาพ (Q3)
// สี/ฟอนต์อ่านจาก token จริงของหน้า (readSaveTheme) — ไม่พิมพ์ hex ใหม่ · ฟอนต์ที่ self-host ต้องโหลดเสร็จก่อนวาด (ensureFonts) ไม่งั้นได้ฟอนต์ fallback/กล่อง (S15)
// ปล่อย canvas ทั้งสองใบทันทีหลังเสร็จ (width=0) — iOS จำกัดหน่วยความจำ canvas (N11)
import { SHOWCASE_COPY } from "@/lib/ring-builder/showcase/config";
import { toTopDownStraightRgba } from "@/lib/ring-builder/viewer/capture-pixels";
import {
  CARD_PAD_X,
  CARD_RADIUS,
  FOOT_LINE_H,
  FOOT_PX,
  HEADER_H,
  IMAGE_W,
  LABEL_PX,
  MARGIN_X,
  STAGE_H,
  STAGE_W,
  VALUE_LINE_H,
  VALUE_PX,
  computeSaveLayout,
  type LaidOutRow,
  type MeasureFn,
  type SaveLayout,
} from "./layout";

export const JPEG_QUALITY = 0.92;

/** token สีที่ใช้วาด (อ่านจาก CSS ของหน้า) + stack ฟอนต์ที่หน้าใช้ */
export interface SaveTheme {
  ivory: string;
  text: string;
  textMuted: string;
  border: string;
  borderSoft: string;
  divider: string;
  burgundyDark: string;
  /** font-family ของข้อความทั่วไป (ที่ resolve แล้ว) */
  sans: string;
  /** font-family ของ wordmark (Cormorant) */
  display: string;
}

const COLOR_TOKENS: Record<Exclude<keyof SaveTheme, "sans" | "display">, string> = {
  ivory: "--gq-ivory",
  text: "--gq-text",
  textMuted: "--gq-text-muted",
  border: "--gq-border",
  borderSoft: "--gq-border-soft",
  divider: "--gq-divider",
  burgundyDark: "--gq-burgundy-dark",
};

/** อ่าน token จาก element ที่อยู่ใต้ wrapper ของเครื่องมือ (ที่ประกาศ --gq-*) · ขาดตัวไหน = throw (ผู้เรียกแสดง "สร้างรูปไม่สำเร็จ" — ไม่เดาสี) */
export function readSaveTheme(el: Element): SaveTheme {
  const cs = getComputedStyle(el);
  const read = (name: string) => cs.getPropertyValue(name).trim();
  const out: Partial<SaveTheme> = {};
  for (const [key, cssVar] of Object.entries(COLOR_TOKENS) as [keyof typeof COLOR_TOKENS, string][]) {
    const v = read(cssVar);
    if (!v) throw new Error(`save-image: ไม่พบ token ${cssVar}`);
    out[key] = v;
  }
  const sans = cs.fontFamily.trim();
  const displayVar = read("--font-gem-quiz-display");
  if (!sans || !displayVar) throw new Error("save-image: ไม่พบฟอนต์ของหน้า");
  out.sans = sans;
  out.display = `${displayVar}, serif`;
  return out as SaveTheme;
}

export interface ComposeInput {
  /** RGBA จาก renderer.captureFront(STAGE_W, STAGE_H) ตรงๆ (ล่างขึ้นบน · premultiplied-like) */
  rgba: Uint8Array;
  rows: readonly { label: string; value: string }[];
  /** "25/11/2569" */
  dateText: string;
  theme: SaveTheme;
}

export interface ComposeEnv {
  createCanvas: () => HTMLCanvasElement;
  fonts?: { load(font: string, text?: string): Promise<unknown>; ready: Promise<unknown> } | null;
}

function defaultEnv(): ComposeEnv {
  return { createCanvas: () => document.createElement("canvas"), fonts: typeof document !== "undefined" && "fonts" in document ? document.fonts : null };
}

/** ข้อความทั้งหมดที่ภาพจะวาด — ใช้ทั้งโหลดฟอนต์ (ตัวอักษรที่ต้องใช้) และเทสต์ whitelist */
export function saveImageTexts(rows: readonly { label: string; value: string }[], dateText: string): string[] {
  return [
    SHOWCASE_COPY.saveWordmark,
    SHOWCASE_COPY.badge,
    ...rows.flatMap((r) => [r.label, r.value]),
    SHOWCASE_COPY.saveImageNote,
    SHOWCASE_COPY.notAnOrder,
    SHOWCASE_COPY.savePriceAsOf(dateText),
  ];
}

/** โหลดฟอนต์ที่ภาพใช้ให้เสร็จ (ตัวอักษรที่ใช้จริง · ทุกน้ำหนัก) แล้วรอ fonts.ready · API ไม่มี = ผ่านไปเลย · โหลดล้มไม่ throw (วาดด้วย fallback ดีกว่าไม่ให้บันทึก) */
export async function ensureFonts(theme: SaveTheme, texts: readonly string[], fonts: ComposeEnv["fonts"]): Promise<void> {
  if (!fonts) return;
  const sample = Array.from(new Set(texts.join(""))).join("");
  try {
    await Promise.all([
      fonts.load(`400 ${LABEL_PX}px ${theme.sans}`, sample),
      fonts.load(`500 ${VALUE_PX}px ${theme.sans}`, sample),
      fonts.load(`600 40px ${theme.display}`, SHOWCASE_COPY.saveWordmark),
    ]);
    await fonts.ready;
  } catch {
    // ใช้ฟอนต์ที่มีอยู่
  }
}

function font(weight: number, px: number, family: string) {
  return `${weight} ${px}px ${family}`;
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/** ตัวหนังสือ wordmark เว้นตัว (ไม่พึ่ง ctx.letterSpacing ที่เบราว์เซอร์เก่าไม่มี) — เหมือน tracking-[0.4em] ของหัวหน้า */
function drawSpaced(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, spacing: number) {
  let cx = x;
  for (const ch of Array.from(text)) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + spacing;
  }
}

function drawRow(ctx: CanvasRenderingContext2D, row: LaidOutRow, layout: SaveLayout, theme: SaveTheme, isLast: boolean) {
  const left = layout.card.x + CARD_PAD_X;
  const right = layout.card.x + layout.card.w - CARD_PAD_X;
  const lineCount = Math.max(row.labelLines.length, row.valueLines.length);
  const textBlockH = lineCount * VALUE_LINE_H;
  const top = row.y + (row.h - textBlockH) / 2;
  ctx.textBaseline = "middle";
  ctx.fillStyle = theme.textMuted;
  ctx.font = font(400, LABEL_PX, theme.sans);
  ctx.textAlign = "left";
  row.labelLines.forEach((l, i) => ctx.fillText(l, left, top + i * VALUE_LINE_H + VALUE_LINE_H / 2));
  ctx.fillStyle = theme.text;
  ctx.font = font(500, VALUE_PX, theme.sans);
  ctx.textAlign = "right";
  row.valueLines.forEach((l, i) => ctx.fillText(l, right, top + i * VALUE_LINE_H + VALUE_LINE_H / 2));
  if (!isLast) {
    ctx.strokeStyle = theme.divider;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(left, row.y + row.h);
    ctx.lineTo(right, row.y + row.h);
    ctx.stroke();
  }
}

/** วาดทั้งภาพลง canvas ที่ตั้งขนาดแล้ว (แยกจาก toBlob เพื่อเทสต์ด้วย ctx ปลอม) · ring = พิกเซลมุมหน้าที่ผ่าน toTopDownStraightRgba แล้ว */
export function drawSaveImage(ctx: CanvasRenderingContext2D, layout: SaveLayout, ringCanvas: CanvasImageSource, input: ComposeInput) {
  const { theme } = input;
  ctx.fillStyle = theme.ivory;
  ctx.fillRect(0, 0, layout.width, layout.height);

  // header: wordmark + ป้าย "ภาพจำลอง" (ซื่อตรงแบบเดียวกับ badge บนเวที · Z6)
  ctx.textBaseline = "middle";
  ctx.fillStyle = theme.burgundyDark;
  ctx.font = font(600, 40, theme.display);
  ctx.textAlign = "left";
  drawSpaced(ctx, SHOWCASE_COPY.saveWordmark, MARGIN_X, HEADER_H / 2, 16);
  ctx.font = font(400, FOOT_PX, theme.sans);
  const badgeW = Math.ceil(ctx.measureText(SHOWCASE_COPY.badge).width) + 56;
  const badgeH = 56;
  const badgeX = layout.width - MARGIN_X - badgeW;
  const badgeY = (HEADER_H - badgeH) / 2;
  roundRectPath(ctx, badgeX, badgeY, badgeW, badgeH, badgeH / 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = theme.textMuted;
  ctx.textAlign = "center";
  ctx.fillText(SHOWCASE_COPY.badge, badgeX + badgeW / 2, HEADER_H / 2);

  // stage: พื้นเดียวกับเวที (ขาว → border-soft) + เงาวงรี (สูตรเดียวกับ RingStage: top 66% · สูง 9% · กว้าง 58%) + แหวน
  const { stage } = layout;
  const grad = ctx.createLinearGradient(0, stage.y, 0, stage.y + stage.h);
  grad.addColorStop(0, "#ffffff");
  grad.addColorStop(1, theme.borderSoft);
  ctx.fillStyle = grad;
  ctx.fillRect(stage.x, stage.y, stage.w, stage.h);
  const shadowW = stage.w * 0.58;
  const shadowH = stage.h * 0.09;
  const sx = stage.x + stage.w / 2;
  const sy = stage.y + stage.h * 0.66 + shadowH / 2;
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(shadowW / 2, shadowH / 2);
  const sg = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  sg.addColorStop(0, "rgba(60,48,48,0.22)"); // ค่าเดียวกับเงาใน RingStage.tsx
  sg.addColorStop(0.7, "rgba(60,48,48,0)");
  ctx.fillStyle = sg;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.drawImage(ringCanvas, stage.x, stage.y, stage.w, stage.h);

  // details card
  const { card } = layout;
  roundRectPath(ctx, card.x, card.y, card.w, card.h, CARD_RADIUS);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.strokeStyle = theme.borderSoft;
  ctx.lineWidth = 2;
  ctx.stroke();
  layout.rows.forEach((r, i) => drawRow(ctx, r, layout, theme, i === layout.rows.length - 1));

  // footer: หมายเหตุ + "ยังไม่ใช่การสั่งซื้อ" + ราคา ณ วันที่
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = theme.textMuted;
  ctx.font = font(400, FOOT_PX, theme.sans);
  let fy = layout.footer.y;
  for (const l of [...layout.footer.noteLines, ...layout.footer.orderLines]) {
    ctx.fillText(l, MARGIN_X, fy + FOOT_LINE_H / 2);
    fy += FOOT_LINE_H;
  }
  ctx.fillText(layout.footer.dateLine, MARGIN_X, layout.footer.dateY + FOOT_LINE_H / 2);
}

function measureWith(ctx: CanvasRenderingContext2D, theme: SaveTheme): MeasureFn {
  return (text, px, weight) => {
    ctx.font = font(weight, px, theme.sans);
    return ctx.measureText(text).width;
  };
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("save-image: toBlob คืน null"))), "image/jpeg", JPEG_QUALITY);
    } catch (e) {
      reject(e);
    }
  });
}

/** พิกเซลแหวน (captureFront) + แถว → JPEG Blob · พังตรงไหน = throw (ผู้เรียกแปลงเป็น "สร้างรูปไม่สำเร็จ") · ปล่อย canvas ทุกใบเสมอ */
export async function composeSaveImage(input: ComposeInput, env: ComposeEnv = defaultEnv()): Promise<{ blob: Blob; width: number; height: number }> {
  const canvases: HTMLCanvasElement[] = [];
  const make = () => {
    const c = env.createCanvas();
    canvases.push(c);
    return c;
  };
  try {
    await ensureFonts(input.theme, saveImageTexts(input.rows, input.dateText), env.fonts ?? null);

    const straight = toTopDownStraightRgba(input.rgba, STAGE_W, STAGE_H); // พลิกแถว + un-premultiply (S11)
    const ringCanvas = make();
    ringCanvas.width = STAGE_W;
    ringCanvas.height = STAGE_H;
    const rctx = ringCanvas.getContext("2d");
    if (!rctx) throw new Error("save-image: ไม่มี canvas 2D");
    const imageData = rctx.createImageData(STAGE_W, STAGE_H);
    imageData.data.set(straight);
    rctx.putImageData(imageData, 0, 0);

    const out = make();
    const ctx = out.getContext("2d");
    if (!ctx) throw new Error("save-image: ไม่มี canvas 2D");
    const layout = computeSaveLayout(
      { rows: input.rows, note: SHOWCASE_COPY.saveImageNote, notAnOrder: SHOWCASE_COPY.notAnOrder, dateLine: SHOWCASE_COPY.savePriceAsOf(input.dateText) },
      measureWith(ctx, input.theme)
    );
    out.width = IMAGE_W;
    out.height = layout.height; // ตั้งขนาดหลังวัด — การตั้งขนาดล้าง state ของ ctx (ฟอนต์ ฯลฯ) จึงตั้งใหม่ทุกครั้งใน drawSaveImage
    drawSaveImage(ctx, layout, ringCanvas, input);
    const blob = await toBlob(out);
    return { blob, width: IMAGE_W, height: layout.height };
  } finally {
    for (const c of canvases) {
      c.width = 0;
      c.height = 0;
    }
  }
}

