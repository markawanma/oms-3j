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
