// รูปจริงของแหวน 5 รูป (เจ้าของส่งมา 12 พ.ย. 69) — ย่อด้านยาว ≤1200px + ลบ EXIF แล้ว
// static import → Next เสิร์ฟจาก /_next/static (exempt อยู่แล้ว) · 🔴 ห้ามย้ายไป public/ring-builder/ (test เดิมบังคับให้ /ring-builder/x.png ถูก gate)
import type { StaticImageData } from "next/image";
import p1 from "./bypass2-1.jpg";
import p2 from "./bypass2-2.jpg";
import p3 from "./bypass2-3.jpg";
import p4 from "./bypass2-4.jpg";
import p5 from "./bypass2-5.jpg";
import type { ShowcaseDesignId } from "@/lib/ring-builder/showcase/designs";

export interface ShowcasePhoto {
  src: string;
  width: number;
  height: number;
}

// Next ให้ StaticImageData · vitest (vite) ให้ string url — รับทั้งคู่
function toPhoto(m: StaticImageData | string): ShowcasePhoto {
  return typeof m === "string" ? { src: m, width: 900, height: 1200 } : { src: m.src, width: m.width, height: m.height };
}

// รูปถ่ายจริงต่อแบบ — มีเฉพาะแบบไขว้ (5 รูป) · แบบอื่นว่าง = UI แสดงการ์ด "ยังไม่มีรูปถ่ายจริง" ห้ามเอารูปแบบอื่นมาแทน (Z6)
// TODO_OWNER_PHOTOS — เจ้าของยังไม่ได้ส่งรูปถ่ายจริงของ 6 แบบใหม่ · ได้รูปแล้ว: ย่อด้านยาว ≤1200px + ลบ EXIF → วางใน _assets/ → static import เพิ่มที่นี่ (ห้ามใช้ public/)
export const SHOWCASE_PHOTOS: Readonly<Record<ShowcaseDesignId, readonly ShowcasePhoto[]>> = {
  bypass2: [p1, p2, p3, p4, p5].map(toPhoto),
  trinity: [],
  scroll6: [],
  channel4: [],
  channel6: [],
  bar7: [],
  small7: [],
};
