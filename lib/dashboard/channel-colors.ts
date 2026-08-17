// lib/dashboard/channel-colors.ts — fixed color per sales channel, used by
// the "ยอดขายตามช่องทาง" donut on /dashboard (0054). Keyed by
// analytics.dim_channel.code; `default` is the fallback for any channel code
// not yet listed here (new channel added to dim_channel before this map is
// updated) so the donut never breaks, it just renders neutral gray.
export const CHANNEL_COLOR: Record<string, string> = {
  tiktok: "#0f172a",
  line_oa: "#06c755",
  shopee: "#ee4d2d",
  facebook: "#1877f2",
  lazada: "#4f46e5",
  default: "#a1a1aa",
};
