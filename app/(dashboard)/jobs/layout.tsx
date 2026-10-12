import type { ReactNode } from "react";
import { JobsSubNav } from "@/components/domain/jobs/JobsSubNav";

// Nested layout ของระบบใบงานผลิต (ออฟฟิศ) — แบบเดียวกับ /oem และ /marketing: แถบสี + แท็บย่อย ทะลุ padding ของ <main>
// print:* — หน้าพิมพ์ (/jobs/[id]/print) ต้องไม่เหลือ offset ลบ/แถบใดๆ บนกระดาษ
export default function JobsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-4 -mt-4 flex flex-col print:mx-0 print:mt-0">
      <div className="h-[3px] shrink-0 bg-gradient-to-r from-primary-600 to-primary-700 print:hidden" aria-hidden="true" />
      <div className="border-b border-zinc-200 bg-white px-4 pt-2.5 pb-1 print:hidden">
        <p className="text-xs font-bold uppercase tracking-wider text-primary-700">ใบงานผลิต</p>
      </div>
      <JobsSubNav />
      <div className="flex-1 px-4 py-4 print:p-0">{children}</div>
    </div>
  );
}
