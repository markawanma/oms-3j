import type { SalesScope } from "@/lib/tiktok/types";
import { CHANNEL_LABEL_TH, formatThaiDateOnly } from "@/lib/tiktok/format";

// Mandatory scope disclaimer (design §3, "UI บังคับ scope label") — LINE
// sales (the bulk of H1 revenue per docs/3j-jewelry/analytics) are not in
// `orders` and cannot appear here. Without this line, a user comparing this
// page against the H1 summary file will see numbers ~20x smaller and assume
// something is broken.
export function SalesScopeNote({ scope }: { scope: SalesScope }) {
  const channelLabel =
    scope.channels.length > 0
      ? scope.channels.map((c) => CHANNEL_LABEL_TH[c] ?? c).join(" + ")
      : "ยังไม่มีช่องทางเชื่อมต่อ";

  return (
    <p className="px-0.5 text-xs text-zinc-500">
      ข้อมูลจาก 3J Insight — <span className="font-medium text-zinc-700">{channelLabel}</span> เท่านั้น
      {scope.firstOrderDate && <> ตั้งแต่ {formatThaiDateOnly(scope.firstOrderDate)}</>} · LINE กำลังเชื่อมเข้ามา
    </p>
  );
}
