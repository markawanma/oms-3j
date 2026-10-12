import type { Metadata } from "next";
import type { ReactNode } from "react";

// app/(worker)/layout.tsx — เปลือกหน้าช่าง (/w/<token> · สาธารณะ · ไม่ผ่าน middleware auth)
// 🔴 กฎโครงสร้าง (เหมือน app/(quiz)): ไฟล์ใต้ app/(worker)/** ห้าม import "use server" ใดๆ ยกเว้น lib/actions/job-worker.ts
// (action ของช่างที่พิสูจน์ตัวด้วย token+PIN เอง) — ห้ามแตะ lib/actions/job-office.ts · lib/auth/session · requireOwnerAdmin
// มีเทสต์ตรวจ module graph (lib/jobs/worker-boundary.test.ts)
// ไม่มี header/nav/ลิงก์ไปหน้าอื่น · token อยู่ใน URL → referrer: no-referrer + noindex (next.config.mjs ใส่ header ซ้ำอีกชั้น)
export const metadata: Metadata = {
  title: "ใบงานผลิต",
  description: "หน้าอัปเดตงานผลิตสำหรับช่าง",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default function WorkerLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-white text-zinc-900">
      <main className="mx-auto w-full max-w-md px-4 py-5 text-lg leading-relaxed">{children}</main>
    </div>
  );
}
