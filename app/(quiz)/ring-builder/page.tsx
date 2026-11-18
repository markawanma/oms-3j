import type { Metadata } from "next";
import { SHOWCASE_COPY } from "@/lib/ring-builder/showcase/config";
import { readShowcaseParams } from "@/lib/ring-builder/showcase/quiz-link";
import { TOOLS_ORIGIN } from "@/lib/site/hosts";
import { RingShowcaseClient } from "./RingShowcaseClient";

// app/(quiz)/ring-builder/page.tsx — หน้า "แบบของ 3J Jewelry" (D1 demo · D1.2 เลือกได้ 7 แบบแหวน)
// server component · ไม่เขียน DB · ไม่ตั้ง secret · ไม่ import "use server" (X5)
// 🔴 อ่านจาก searchParams แค่ 7 key: g (D1 เดิม) · t · i · q · c · d (design §9.1) + r (แบบแหวน · D1.2 §4 · ไม่มี/ผิด = ไขว้) ผ่าน readShowcaseParams — ?price= ?size= ?design= ไม่มีผล (X2)
//    ทุก key ตรวจแยกกัน ผิดรูป = ถือว่าไม่มี key นั้น → โหมดเข้าตรง (CZ ขาว + การ์ดชวนทำ quiz) ไม่ throw (X1/Y1)
// 🔴 path นี้ exempt จาก auth gate อยู่แล้วแบบ exact (lib/auth/exempt-path.ts) — ไฟล์นี้ไม่แตะ middleware/exempt-path (X8)
// รูปในหน้า = static import (/_next/static) ไม่ผ่าน public/ring-builder/ (test เดิมบังคับให้ path นั้นถูก gate)

export const metadata: Metadata = {
  // P2 (18 พ.ย. 69): หน้านี้อยู่บน tools. · canonical/og:url ไม่มี query (t/i/q/c/d/r เป็น state ของผู้ใช้ ไม่ใช่ตัวตนของหน้า)
  metadataBase: new URL(TOOLS_ORIGIN),
  alternates: { canonical: "/ring-builder" },
  title: SHOWCASE_COPY.pageTitle,
  description: SHOWCASE_COPY.pageDescription,
  // ยังเป็น demo — ไม่ให้ search engine เก็บ (เปิดเมื่อเจ้าของสั่ง)
  robots: { index: false, follow: false },
  // g อยู่ใน query — Referer ของ request ที่ออกจากหน้านี้ (LINE/ring-size) เหลือแค่ origin
  referrer: "strict-origin",
  openGraph: {
    type: "website",
    url: "/ring-builder",
    title: SHOWCASE_COPY.pageTitle,
    description: SHOWCASE_COPY.pageDescription,
    siteName: "3J Jewelry",
    locale: "th_TH",
  },
};

export default async function RingShowcasePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = readShowcaseParams(await searchParams);
  return <RingShowcaseClient params={params} />;
}
