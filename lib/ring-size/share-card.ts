// lib/ring-size/share-card.ts — วาดการ์ด "ไซส์แหวนของฉัน" 1080×1350 (R7) บน canvas ในเครื่อง
//
// กติกา: ไม่ส่งรูปขึ้นเซิร์ฟเวอร์ · โลโก้จากไฟล์ในโปรเจกต์ (same-origin — กัน canvas taint) · ตัวหนังสือเล็กสุด ≥ 34 px
// ห้ามราคา/สรรพคุณ/ชื่อ/เบอร์โทร/ชื่อธุรกิจในเครือ/ภาพคน · ไม่ throw เมื่อฟอนต์ล้ม (ตกไปฟอนต์ระบบ)
// ค่าจริงทุกตัวมาจากผลวัด — ไม่มีเลขตัวอย่างฝังที่นี่ (เบอร์/มม. 1 ทศนิยม/วันที่วัดจริง รูปแบบ พ.ศ.)
import { COPY, SHARE_CARD_URL } from "./config";
import { formatMm, formatThaiDate } from "./size";

export const SHARE_CARD_WIDTH = 1080;
export const SHARE_CARD_HEIGHT = 1350;
/** ตัวหนังสือเล็กสุดบนการ์ด (px) */
export const SHARE_CARD_MIN_FONT_PX = 34;

export interface ShareCardData {
  rec: number;
  /** เส้นรอบวงที่ปัด 0.1 แล้ว */
  circ: number;
  /** เวลาที่วัด (ms) */
  measuredAt: number;
}

export interface ShareCardFonts {
  serif: string;
  sans: string;
}

export const SYSTEM_FONTS: ShareCardFonts = { serif: "serif", sans: "sans-serif" };

/** ส่วนของ CanvasRenderingContext2D ที่ใช้จริง (ให้เทสต์ฉีด ctx ปลอมได้) */
export type Ctx2D = Pick<
  CanvasRenderingContext2D,
  | "fillStyle"
  | "strokeStyle"
  | "lineWidth"
  | "font"
  | "textAlign"
  | "textBaseline"
  | "fillRect"
  | "beginPath"
  | "moveTo"
  | "lineTo"
  | "arcTo"
  | "arc"
  | "closePath"
  | "stroke"
  | "fill"
  | "fillText"
  | "measureText"
  | "drawImage"
>;

const C = {
  bg: "#FBF7F2",
  frame: "#E3D1BD",
  ringFat: "#F1E4D8",
  ringThin: "#E6D3BE",
  text: "#2B1E1E",
  textSoft: "#5C4D49",
  brand: "#7d1316",
  gold: "#C8A777",
} as const;

function roundedRectPath(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number) {
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

/** ตัดบรรทัดตามช่องว่าง ไม่เกิน maxLines (ข้อความที่เหลือต่อท้ายบรรทัดสุดท้าย) */
export function wrapText(ctx: Pick<Ctx2D, "measureText">, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const trial = line ? `${line} ${word}` : word;
    if (ctx.measureText(trial).width <= maxWidth || !line) {
      line = trial;
    } else if (lines.length < maxLines - 1) {
      lines.push(line);
      line = word;
    } else {
      line = `${line} ${words.slice(i).join(" ")}`.trim();
      break;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** วาดการ์ดลง ctx (ขนาด 1080×1350) — logo เป็น null ได้ (ข้ามโลโก้ ไม่ throw) */
export function drawShareCard(
  ctx: Ctx2D,
  data: ShareCardData,
  opts: { fonts?: ShareCardFonts; logo?: CanvasImageSource | null; logoAspect?: number } = {}
): void {
  const fonts = opts.fonts ?? SYSTEM_FONTS;
  const W = SHARE_CARD_WIDTH;
  const H = SHARE_CARD_HEIGHT;
  const cx = W / 2;

  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  // กรอบ + วงแหวนตกแต่ง
  ctx.strokeStyle = C.frame;
  ctx.lineWidth = 2;
  roundedRectPath(ctx, 40, 40, W - 80, H - 80, 48);
  ctx.stroke();
  ctx.strokeStyle = C.ringFat;
  ctx.lineWidth = 56;
  ctx.beginPath();
  ctx.arc(cx, 680, 300, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = C.ringThin;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, 680, 342, 0, Math.PI * 2);
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  // โลโก้ (สูง 150)
  const logoH = 150;
  if (opts.logo) {
    try {
      const logoW = logoH * (opts.logoAspect && opts.logoAspect > 0 ? opts.logoAspect : 2.4);
      ctx.drawImage(opts.logo, cx - logoW / 2, 96, logoW, logoH);
    } catch {
      // โลโก้วาดไม่ได้ — ข้าม การ์ดยังครบเนื้อหา
    }
  }

  // หัวเรื่อง
  ctx.fillStyle = C.textSoft;
  ctx.font = `600 56px ${fonts.serif}`;
  ctx.fillText(COPY.share.title, cx, 96 + logoH + 120);

  // "เบอร์" + เลขเบอร์ใหญ่ (serif 600 — ห้ามขอ 700)
  const labelFont = `600 72px ${fonts.serif}`;
  const numFont = `600 380px ${fonts.serif}`;
  const label = COPY.r6.sizePrefix;
  const num = String(data.rec);
  ctx.font = labelFont;
  const labelW = ctx.measureText(label).width;
  ctx.font = numFont;
  const numW = ctx.measureText(num).width;
  const gap = 22;
  const startX = cx - (labelW + gap + numW) / 2;
  const baseY = 700;
  ctx.fillStyle = C.brand;
  ctx.textAlign = "left";
  ctx.font = labelFont;
  ctx.fillText(label, startX, baseY);
  ctx.font = numFont;
  ctx.fillText(num, startX + labelW + gap, baseY);
  ctx.textAlign = "center";

  // เส้นรอบวง (1 ทศนิยม)
  ctx.fillStyle = C.text;
  ctx.font = `400 44px ${fonts.sans}`;
  ctx.fillText(COPY.r6.circ(formatMm(data.circ)), cx, baseY + 90);

  // ข้อความเล็ก (≥ 34 px · ไม่เกิน 2 บรรทัด)
  ctx.fillStyle = C.textSoft;
  ctx.font = `400 ${SHARE_CARD_MIN_FONT_PX}px ${fonts.sans}`;
  const lines = wrapText(ctx, COPY.share.footer, W - 2 * 130, 2);
  lines.forEach((l, i) => ctx.fillText(l, cx, baseY + 160 + i * 48));

  // ท้ายการ์ด
  let y = H - 84;
  ctx.fillStyle = C.brand;
  ctx.font = `600 40px ${fonts.serif}`;
  ctx.fillText(COPY.share.footerBrand, cx, y);
  if (SHARE_CARD_URL) {
    y -= 56;
    ctx.fillStyle = C.textSoft;
    ctx.font = `400 ${SHARE_CARD_MIN_FONT_PX}px ${fonts.sans}`;
    ctx.fillText(SHARE_CARD_URL, cx, y);
  }
  y -= 70;
  ctx.fillStyle = C.gold;
  ctx.fillRect(cx - 60, y, 120, 2);
  y -= 40;
  ctx.fillStyle = C.textSoft;
  ctx.font = `400 36px ${fonts.sans}`;
  ctx.fillText(COPY.share.dated(formatThaiDate(data.measuredAt, COPY.months)), cx, y);
}

// ───────────────────────── ฝั่งเบราว์เซอร์ ─────────────────────────

function loadImage(src: string, timeoutMs = 4000): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      const timer = setTimeout(() => resolve(null), timeoutMs);
      img.onload = () => {
        clearTimeout(timer);
        resolve(img);
      };
      img.onerror = () => {
        clearTimeout(timer);
        resolve(null);
      };
      img.src = src;
    } catch {
      resolve(null);
    }
  });
}

/** รอฟอนต์พร้อม (ไม่เกิน timeoutMs) — ล้ม/ไม่มี document.fonts = ไปต่อด้วยฟอนต์ที่มี */
async function waitForFonts(fonts: ShareCardFonts, timeoutMs = 2000): Promise<void> {
  try {
    const set = typeof document !== "undefined" ? document.fonts : undefined;
    if (!set) return;
    const sample = `${COPY.share.title} ${COPY.r6.sizePrefix} 0123456789`;
    await Promise.race([
      Promise.all([set.load(`600 56px ${fonts.serif}`, sample), set.load(`400 44px ${fonts.sans}`, sample)]).then(() => set.ready),
      new Promise((r) => setTimeout(r, timeoutMs)),
    ]);
  } catch {
    // ฟอนต์ล้ม — ตกไปฟอนต์ระบบ
  }
}

/** สร้าง data URL (PNG) ของการ์ด — โยน Error ถ้า canvas ใช้ไม่ได้ (ผู้เรียกแสดงข้อความ "ทำรูปไม่สำเร็จ") */
export async function renderShareCardDataUrl(data: ShareCardData, fonts: ShareCardFonts = SYSTEM_FONTS, logoSrc = "/3j-logo.png"): Promise<string> {
  await waitForFonts(fonts);
  const logo = await loadImage(logoSrc);
  const canvas = document.createElement("canvas");
  canvas.width = SHARE_CARD_WIDTH;
  canvas.height = SHARE_CARD_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas ใช้ไม่ได้");
  drawShareCard(ctx, data, {
    fonts,
    logo,
    logoAspect: logo && logo.naturalHeight > 0 ? logo.naturalWidth / logo.naturalHeight : undefined,
  });
  return canvas.toDataURL("image/png");
}

/** data URL → File สำหรับ navigator.share({ files }) — ไม่ใช้ fetch/blob: URL */
export function dataUrlToFile(dataUrl: string, name: string): File | null {
  try {
    const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
    if (!m) return null;
    const bin = atob(m[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], name, { type: m[1] });
  } catch {
    return null;
  }
}

/** ข้อความที่คัดลอก (ทางสำรองของ R7) */
export function buildShareText(rec: number, circ: number): string {
  return COPY.share.text(rec, formatMm(circ));
}
