// lib/live/channel-account.ts — resolves the shop's manual TikTok Live channel_account.
//
// Moved out of lib/actions/live.ts (H1 Phase 3, 27 ต.ค. 69). Everything exported
// from a "use server" file becomes a public POST endpoint, so this helper —
// which takes a client-supplied shopId and throws internal error text — was
// accidentally an unauthenticated action. A plain server-only module is not
// dispatchable from the browser; callers (live.ts startLiveSession,
// quick-order.ts createQuickOrder) guard themselves BEFORE reaching here.
import "server-only";
import { getServiceClient } from "@/lib/supabase/server";

/**
 * Every live-order action needs the shop's manual TikTok "channel" —
 * seeded in docs/dev-seed.sql as channel_account(channel=tiktok,
 * external_shop_id='manual-live').
 */
export async function getManualTiktokChannelAccountId(shopId: string): Promise<string> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("channel_account")
    .select("id, channel:channel_id!inner(code)")
    .eq("shop_id", shopId)
    .eq("external_shop_id", "manual-live")
    .eq("channel.code", "tiktok")
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new Error("ไม่พบ channel_account สำหรับ TikTok Live แบบ manual — ต้อง seed ก่อน (ดู docs/dev-seed.sql)");
  }
  return (data as any).id as string;
}
