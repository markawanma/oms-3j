// RelativeBar — แท่งแนวนอน "ยาวเทียบค่ามากสุดของกลุ่ม" ตกแต่งล้วน (ไม่มี chart library)
// ⚠️ ไม่ใช่ % จริง: `PercentBar` ใน GemQuizStats วาด count/ฐาน (= %) ส่วนตัวนี้ความยาว = value/max ของกลุ่มเดียวกัน
//    เพื่อให้เห็นรูปการกระจาย — ตัวเลข/% ที่ถูกต้องอยู่ในข้อความข้างๆ เสมอ จึง aria-hidden ·
//    ไม่ใช้ role=progressbar (ซ้ำ 40+ ตัวต่อหน้า screen reader จะอ่านรก)
// ใช้ inline style เฉพาะ width ที่เป็นค่าไดนามิกจริง · ไม่ import จาก lib/ (ui primitive พึ่งตัวเองได้)

function sane(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;
}

/** ความยาวแท่ง 0..100 (จำนวนเต็ม) เทียบค่าสูงสุด · มีของแต่เล็กมาก ⇒ อย่างน้อย 2 ให้เห็นแท่ง · หาร 0/ค่าเพี้ยน ⇒ 0 */
export function relativeBarWidth(value: number, max: number): number {
  const v = sane(value);
  const m = sane(max);
  if (v <= 0 || m <= 0) return 0;
  return Math.max(2, Math.min(100, Math.round((v / m) * 100)));
}

export function RelativeBar({
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
  const width = relativeBarWidth(value, max);
  const fill = tone === "amber" ? "bg-amber-500" : "bg-primary-600";
  return (
    <div className={`h-2 w-full overflow-hidden rounded-full bg-zinc-200 ${className}`} aria-hidden="true">
      <div className={`h-full rounded-full ${fill}`} style={{ width: `${width}%` }} />
    </div>
  );
}
