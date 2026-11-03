import { barWidthPct } from "@/lib/marketing/ring-size-format";

// PercentBar — แท่งแนวนอนตกแต่งล้วน (ไม่มี chart library) · ข้อมูลจริงอยู่ในตัวเลขข้อความข้างๆ เสมอ จึง aria-hidden
// ไม่ใช้ role=progressbar (ซ้ำ 40+ ตัวต่อหน้า screen reader จะอ่านรก)
// ความยาวคิดเทียบ `max` (ค่ามากสุดของกลุ่ม) — ใช้ inline style เฉพาะ width ที่เป็นค่าไดนามิกจริง
export function PercentBar({
  value,
  max,
  tone = "primary",
  className = "",
}: {
  value: number;
  max: number;
  tone?: "primary" | "amber";
  className?: string;
}) {
  const width = barWidthPct(value, max);
  const fill = tone === "amber" ? "bg-amber-500" : "bg-primary-600";
  return (
    <div className={`h-2 w-full overflow-hidden rounded-full bg-zinc-200 ${className}`} aria-hidden="true">
      <div className={`h-full rounded-full ${fill}`} style={{ width: `${width}%` }} />
    </div>
  );
}
