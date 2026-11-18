// รูปจริงของแหวน 5 รูป (เจ้าของส่งมา 12 พ.ย. 69) — ย่อด้านยาว ≤1200px + ลบ EXIF แล้ว
// static import → Next เสิร์ฟจาก /_next/static (exempt อยู่แล้ว) · 🔴 ห้ามย้ายไป public/ring-builder/ (test เดิมบังคับให้ /ring-builder/x.png ถูก gate)
import type { StaticImageData } from "next/image";
import p1 from "./bypass2-1.jpg";
import p2 from "./bypass2-2.jpg";
import p3 from "./bypass2-3.jpg";
import p4 from "./bypass2-4.jpg";
import p5 from "./bypass2-5.jpg";

export interface ShowcasePhoto {
  src: string;
  width: number;
  height: number;
}

// Next ให้ StaticImageData · vitest (vite) ให้ string url — รับทั้งคู่
function toPhoto(m: StaticImageData | string): ShowcasePhoto {
  return typeof m === "string" ? { src: m, width: 900, height: 1200 } : { src: m.src, width: m.width, height: m.height };
}

export const SHOWCASE_PHOTOS: readonly ShowcasePhoto[] = [p1, p2, p3, p4, p5].map(toPhoto);
