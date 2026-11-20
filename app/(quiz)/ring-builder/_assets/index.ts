// รูปจริงของแหวน 5 รูป (เจ้าของส่งมา 12 พ.ย. 69) — ย่อด้านยาว ≤1200px + ลบ EXIF แล้ว
// static import → Next เสิร์ฟจาก /_next/static (exempt อยู่แล้ว) · 🔴 ห้ามย้ายไป public/ring-builder/ (test เดิมบังคับให้ /ring-builder/x.png ถูก gate)
import type { StaticImageData } from "next/image";
import p1 from "./bypass2-1.jpg";
import p2 from "./bypass2-2.jpg";
import p3 from "./bypass2-3.jpg";
import p4 from "./bypass2-4.jpg";
import p5 from "./bypass2-5.jpg";
import trinity1 from "./trinity-1.jpg";
import trinity2 from "./trinity-2.jpg";
import trinity3 from "./trinity-3.jpg";
import trinity4 from "./trinity-4.jpg";
import scroll61 from "./scroll6-1.jpg";
import scroll62 from "./scroll6-2.jpg";
import scroll63 from "./scroll6-3.jpg";
import scroll64 from "./scroll6-4.jpg";
import channel41 from "./channel4-1.jpg";
import channel42 from "./channel4-2.jpg";
import channel43 from "./channel4-3.jpg";
import channel44 from "./channel4-4.jpg";
import channel61 from "./channel6-1.jpg";
import channel62 from "./channel6-2.jpg";
import channel63 from "./channel6-3.jpg";
import channel64 from "./channel6-4.jpg";
import bar71 from "./bar7-1.jpg";
import bar72 from "./bar7-2.jpg";
import bar73 from "./bar7-3.jpg";
import bar74 from "./bar7-4.jpg";
import small71 from "./small7-1.jpg";
import small72 from "./small7-2.jpg";
import small73 from "./small7-3.jpg";
import small74 from "./small7-4.jpg";
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

// รูปถ่ายจริงต่อแบบ — ไขว้ 5 รูป · อีก 6 แบบ 4 รูป/แบบ (เจ้าของส่งมา 20 พ.ย. 69 · 900x1200 · ลบ EXIF แล้ว · ห้ามใช้ public/)
// แบบในอนาคตที่ยังไม่มีรูป = ใส่ [] → UI แสดงการ์ด "ยังไม่มีรูปถ่ายจริง" · ห้ามเอารูปแบบอื่นมาแทน (Z6)
export const SHOWCASE_PHOTOS: Readonly<Record<ShowcaseDesignId, readonly ShowcasePhoto[]>> = {
  bypass2: [p1, p2, p3, p4, p5].map(toPhoto),
  trinity: [trinity1, trinity2, trinity3, trinity4].map(toPhoto),
  scroll6: [scroll61, scroll62, scroll63, scroll64].map(toPhoto),
  channel4: [channel41, channel42, channel43, channel44].map(toPhoto),
  channel6: [channel61, channel62, channel63, channel64].map(toPhoto),
  bar7: [bar71, bar72, bar73, bar74].map(toPhoto),
  small7: [small71, small72, small73, small74].map(toPhoto),
};
