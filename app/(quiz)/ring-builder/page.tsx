import type { Metadata } from "next";
import { SHOWCASE_COPY } from "@/lib/ring-builder/showcase/config";
import { readShowcaseParams } from "@/lib/ring-builder/showcase/quiz-link";
import { RingShowcaseClient } from "./RingShowcaseClient";

// app/(quiz)/ring-builder/page.tsx — หน้า "แบบของ 3J Jewelry" (D1 demo · แหวนไขว้พลอยไข่ 2 เม็ด แบบเดียว)
// server component · ไม่เขียน DB · ไม่ตั้ง secret · ไม่ import "use server" (X5)
// 🔴 อ่านจาก searchParams แค่ key เดียวคือ `g` (รหัสพลอยอันดับ 1–3 จาก quiz) ผ่าน readShowcaseParams — ?price= ?size= ?design= ไม่มีผล (X2)
//    ค่า g ผิดรูปทุกแบบ → top3 = null → โหมดเข้าตรง (CZ ขาว + การ์ดชวนทำ quiz) ไม่ throw (X1)
// 🔴 path นี้ exempt จาก auth gate อยู่แล้วแบบ exact (lib/auth/exempt-path.ts) — ไฟล์นี้ไม่แตะ middleware/exempt-path (X8)
// รูปในหน้า = static import (/_next/static) ไม่ผ่าน public/ring-builder/ (test เดิมบังคับให้ path นั้นถูก gate)

export const metadata: Metadata = {
  title: SHOWCASE_COPY.pageTitle,
  description: SHOWCASE_COPY.pageDescription,
  // ยังเป็น demo — ไม่ให้ search engine เก็บ (เปิดเมื่อเจ้าของสั่ง)
  robots: { index: false, follow: false },
  // g อยู่ใน query — Referer ของ request ที่ออกจากหน้านี้ (LINE/ring-size) เหลือแค่ origin
  referrer: "strict-origin",
};

export default async function RingShowcasePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { top3 } = readShowcaseParams(await searchParams);
  return <RingShowcaseClient top3={top3} />;
}
