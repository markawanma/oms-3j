// class ที่ใช้ซ้ำใน ring-size — token `--rs-*` ประกาศที่ ring-size/layout.tsx จุดเดียว
//
// ฟอนต์: serif (Noto Serif Thai) โหลดแค่ weight 500/600 → ใช้ font-semibold (600) เท่านั้น ห้าม font-bold
// (ไม่งั้นเบราว์เซอร์สังเคราะห์ตัวหนาเอง) · sans (IBM Plex Sans Thai) 400/500/600
// สีตัวหนังสือที่เป็น "กฎตัดสินใจ/คำใบ้/คำเตือน" ใช้ --rs-text-3 และขนาด ≥ 15 px

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export const SERIF = "font-quiz-serif";
export const TEXT = "text-[var(--rs-text)]";
export const TEXT_2 = "text-[var(--rs-text-2)]";
export const TEXT_3 = "text-[var(--rs-text-3)]";
export const BRAND_TEXT = "text-[var(--rs-brand)]";

export const CARD = "rounded-[22px] border border-[var(--rs-border)] bg-[var(--rs-surface)]";
export const PAGE_X = "px-[22px]";

/** วงโฟกัสสำหรับคีย์บอร์ด */
export const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rs-brand)]";

/** ลิงก์ข้อความ — พื้นที่แตะ ≥ 44 px */
export const LINK =
  "inline-flex min-h-[44px] items-center justify-center px-1 font-semibold text-[var(--rs-brand)] hover:text-[var(--rs-brand-hover)] underline-offset-4 hover:underline " +
  FOCUS;

export const TAP_44 = "min-h-[44px] min-w-[44px]";
