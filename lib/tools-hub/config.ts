// lib/tools-hub/config.ts — ข้อมูล + copy ของหน้ารวมเครื่องมือลูกค้า (hub) จุดเดียว (ux-tools-hub.md §2 §9)
// pure: ไม่อ่าน env · ไม่ import "use server" (หน้าอยู่ใต้ (quiz) ซึ่ง exempt จาก auth gate)
//
// ค่าที่เจ้าของเคาะแล้ว (18 พ.ย. 69 — บันทึกใน ux-tools-hub.md ข้อ 12): ลำดับการ์ด วัดไซซ์ → แบบทดสอบพลอย → ดูแหวน · หัวข้อ "เครื่องมือเลือกแหวนของ 3J" · ไม่มีคำสัญญาเชิงบริการใต้หัวข้อ
// ค่าติดต่อ: ใช้ LINE_OA_URL เดิมเท่านั้น (เจ้าของยืนยัน 24 ต.ค. 69) · ไม่ใส่เบอร์/อีเมล/social อื่น
import { GEM_QUIZ_PATH, RING_SIZE_PATH, SHOWCASE_PATH, formatPriceThb, leadTimeLabel } from "@/lib/ring-builder/showcase/config";

export type HubToolId = "ring-builder" | "gem-quiz" | "ring-size";

export interface HubTool {
  id: HubToolId;
  /** <a href> ธรรมดา relative — ห้าม next/link (header XFO/CSP/Permissions-Policy ติดเฉพาะตอนโหลดหน้าเต็ม · design L2/R3) */
  href: string;
  variant: "primary" | "outline";
  title: string;
  description: string;
  /** เลขราคา/ระยะเวลาต้องมาจากฟังก์ชันเดิม ห้ามพิมพ์เลข */
  meta: string;
  cta: string;
}

/** array นี้คือลำดับที่แสดง · การ์ดแรกเป็น primary เสมอ (ปุ่มหลักเดียว) */
export const HUB_TOOLS: readonly HubTool[] = [
  {
    id: "ring-size",
    href: RING_SIZE_PATH,
    variant: "primary",
    title: "วัดไซซ์แหวน",
    description: "วัดนิ้วด้วยหน้าจอมือถือ ไม่ต้องไปร้าน ไม่ต้องมีอุปกรณ์พิเศษ",
    meta: "ไม่กี่นาที · ใช้เหรียญ 10 บาทหรือบัตร 1 ใบ",
    cta: "วัดไซซ์",
  },
  {
    id: "gem-quiz",
    href: GEM_QUIZ_PATH,
    variant: "outline",
    title: "แบบทดสอบพลอยประจำวัน",
    description: "ตอบ 5 คำถามสั้นๆ เพื่อดูพลอยที่เข้ากับวันของคุณ",
    meta: "ไม่ถึง 1 นาที · ได้พลอยแนะนำ 3 แบบ",
    cta: "ทำแบบทดสอบ",
  },
  {
    id: "ring-builder",
    href: SHOWCASE_PATH,
    variant: "outline",
    title: "ดูแหวนและลองพลอย",
    description: "ดูแหวนไขว้พลอยไข่ 2 เม็ด ลองสลับพลอยบนแหวน เลือกไซซ์ แล้วส่งให้แอดมินยืนยัน",
    meta: `${formatPriceThb()} · ${leadTimeLabel()}`,
    cta: "ดูแหวน",
  },
];

export const TOOLS_HUB_COPY = {
  pageTitle: "เครื่องมือเลือกแหวน | 3J Jewelry",
  pageDescription: "เครื่องมือเลือกแหวนของ 3J Jewelry — ดูแหวน ทำแบบทดสอบพลอย วัดไซซ์แหวนด้วยมือถือ",
  heading: "เครื่องมือเลือกแหวนของ 3J",
  subheading: "เริ่มจากสิ่งที่อยากทำตอนนี้",
  toolsLabel: "เครื่องมือ",
  lastMeasured: (n: number) => `ผลวัดล่าสุด: เบอร์ ${n}`,
  contactHeading: "ไม่แน่ใจจะเริ่มตรงไหน? ทักแอดมินได้",
  contactCta: "ทักแอดมินทาง LINE",
  footnote: "ภาพแหวนในเครื่องมือเป็นภาพจำลอง ยังไม่ใช่การสั่งซื้อ",
} as const;
