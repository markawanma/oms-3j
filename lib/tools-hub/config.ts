// lib/tools-hub/config.ts — ข้อมูล + copy ของหน้ารวมเครื่องมือลูกค้า (hub) จุดเดียว (ux-tools-hub.md §2 §9)
// pure: ไม่อ่าน env · ไม่ import "use server" (หน้าอยู่ใต้ (quiz) ซึ่ง exempt จาก auth gate)
//
// ค่าที่เจ้าของเคาะแล้ว (18 พ.ย. 69 — บันทึกใน ux-tools-hub.md ข้อ 12): ลำดับการ์ด วัดไซซ์ → แบบทดสอบพลอย → ดูแหวน · การ์ดทั้ง 3 ใบสไตล์เดียวกัน (outline) · หัวข้อ "เครื่องมือเลือกแหวนของ 3J" · ไม่มีคำสัญญาเชิงบริการใต้หัวข้อ
// ค่าติดต่อ: ใช้ LINE_OA_URL เดิมเท่านั้น (เจ้าของยืนยัน 24 ต.ค. 69) · ไม่ใส่เบอร์/อีเมล/social อื่น
import { DESIGNS } from "@/lib/ring-builder/showcase/designs";
import { GEM_QUIZ_PATH, RING_SIZE_PATH, SHOWCASE_PATH, leadTimeLabel } from "@/lib/ring-builder/showcase/config";

export type HubToolId = "ring-builder" | "gem-quiz" | "ring-size";

export interface HubTool {
  id: HubToolId;
  /** <a href> ธรรมดา relative — ห้าม next/link (header XFO/CSP/Permissions-Policy ติดเฉพาะตอนโหลดหน้าเต็ม · design L2/R3) */
  href: string;
  title: string;
  description: string;
  /** ระยะเวลาต้องมาจากฟังก์ชันเดิม ห้ามพิมพ์เลข · hub ไม่แสดงราคา (ราคาต่อแบบ — มติ TL 24 พ.ย. 69) */
  meta: string;
  cta: string;
}

/** array นี้คือลำดับที่แสดง · การ์ดทั้งหมดสไตล์เดียวกัน ไม่มีการ์ดเด่น (มติเจ้าของ 18 พ.ย. 69) */
export const HUB_TOOLS: readonly HubTool[] = [
  {
    id: "ring-size",
    href: RING_SIZE_PATH,
    title: "วัดไซซ์แหวน",
    description: "วัดนิ้วด้วยหน้าจอมือถือ ไม่ต้องไปร้าน ไม่ต้องมีอุปกรณ์พิเศษ",
    meta: "ไม่กี่นาที · ใช้เหรียญ 10 บาทหรือบัตร 1 ใบ",
    cta: "วัดไซซ์",
  },
  {
    id: "gem-quiz",
    href: GEM_QUIZ_PATH,
    title: "แบบทดสอบพลอยประจำวัน",
    description: "ตอบ 5 คำถามสั้นๆ เพื่อดูพลอยที่เข้ากับวันของคุณ",
    meta: "ไม่ถึง 1 นาที · ได้พลอยแนะนำ 3 แบบ",
    cta: "ทำแบบทดสอบ",
  },
  {
    id: "ring-builder",
    href: SHOWCASE_PATH,
    title: "ดูแหวนและลองพลอย",
    description: `เลือกแบบแหวน ${DESIGNS.length} แบบ ลองสลับพลอยบนแหวน เลือกไซซ์ แล้วส่งให้แอดมินยืนยัน`,
    meta: leadTimeLabel(),
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
