/**
 * Pure active-tab resolution for the Marketing sub-nav.
 *
 * Longest-match wins (same rule as DashboardShell.activeNavHref): once
 * "/marketing" is itself a tab, a plain `startsWith` would light it up on every
 * /marketing/* page. The bare root only matches exactly; every other href
 * matches itself or a child segment, and the most specific href is the one
 * highlighted.
 */
export function pathMatchesHref(pathname: string, href: string): boolean {
  if (href === "/marketing") return pathname === "/marketing";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function activeTabHref(pathname: string | null | undefined, hrefs: readonly string[]): string | null {
  if (!pathname) return null;
  let best: string | null = null;
  for (const href of hrefs) {
    if (pathMatchesHref(pathname, href) && (best === null || href.length > best.length)) best = href;
  }
  return best;
}

/**
 * หน้าในสายการตลาดที่ขยายความกว้างเนื้อหา (PC 2 คอลัมน์ — แผน §5.3): หน้าแรก "งานที่รอฉัน" · ปฏิทิน (สัปดาห์ 7 คอลัมน์) · หน้าชิ้นงาน
 * หน้าอื่นทั้งแอปคงความกว้างเดิม (max-w-3xl) — DashboardShell เรียกฟังก์ชันนี้เพื่อเลือก max-width ของ <main>
 */
export function isWideMarketingPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return pathname === "/marketing" || pathname === "/marketing/calendar" || pathname.startsWith("/marketing/pieces/");
}
