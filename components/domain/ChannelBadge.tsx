import { Badge } from "@/components/ui/Badge";
import type { ChannelCode } from "@/lib/types";

// Channel colors deliberately distinct from the primary indigo (ux-ui design:
// "ไม่ชนสี Shopee ส้ม/TikTok ดำ ที่ใช้เป็น channel badge").
const CHANNEL_CONFIG: Record<ChannelCode, { label: string; tone: "orange" | "black" | "indigo" }> = {
  shopee: { label: "Shopee", tone: "orange" },
  tiktok: { label: "TikTok Shop", tone: "black" },
  lazada: { label: "Lazada", tone: "indigo" },
};

export function ChannelBadge({ channel }: { channel: ChannelCode }) {
  const config = CHANNEL_CONFIG[channel] ?? { label: channel, tone: "slate" as const };
  return <Badge tone={config.tone as any}>{config.label}</Badge>;
}
