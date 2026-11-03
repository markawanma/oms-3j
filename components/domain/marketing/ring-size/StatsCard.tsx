import type { ReactNode } from "react";

// การ์ดมาตรฐานของหน้าสรุปไซส์แหวน — class เดียวกับ GemQuizStats (ไม่เพิ่ม token ใหม่) แต่หัวเป็น h2 จริง (gem quiz ข้ามไป h3)
// สีข้อความรอง zinc-600/500 เท่านั้น — ห้าม zinc-400 กับข้อความ (ต่ำกว่า WCAG AA)
export function StatsCard({
  id,
  title,
  base,
  children,
}: {
  /** ใช้สร้าง id ของหัว (aria-labelledby) — ต้องไม่ซ้ำในหน้า */
  id: string;
  title: string;
  /** ฐานหารของการ์ด เช่น "จากที่วัดได้ 187 ครั้ง" */
  base?: string;
  children: ReactNode;
}) {
  const headingId = `${id}-heading`;
  return (
    <section aria-labelledby={headingId} className="space-y-3 rounded-lg border border-zinc-200 bg-white p-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h2 id={headingId} className="text-sm font-bold text-zinc-800">
          {title}
        </h2>
        {base && <p className="text-xs text-zinc-600">{base}</p>}
      </div>
      {children}
    </section>
  );
}

/** ส่วนที่ RPC ไม่ได้ส่งมา/ผิดรูป — โชว์ข้อความเดียว ไม่ crash ไม่พูดถึง migration (ศัพท์ dev ไม่ขึ้นจอเจ้าของ) */
export function NoData({ children = "ยังไม่มีข้อมูล" }: { children?: ReactNode }) {
  return <p className="text-sm text-zinc-500">{children}</p>;
}
