import type { ReactNode } from "react";
import { ToastProvider } from "@/components/ui/Toast";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { getSessionUser } from "@/lib/auth/session";
import { getEffectiveRole } from "@/lib/auth/role";

// Side-nav refactor (docs/3j-jewelry/analytics/phase-b-crm-design.md §4) —
// nav config itself now lives in DashboardShell (desktop sidebar / mobile
// drawer) so it's defined once and shared across breakpoints. This file
// stays a server component; DashboardShell is "use client" only because it
// needs usePathname() + drawer open/close state.

// Phase A1 (auth infra, additive) + A2-lite (register/approve, 16 ก.ย. 69).
// Used to decide whether DashboardShell shows a sign-out button + email, and
// whether it shows the owner-only "สมาชิก" nav item.
//
// role now comes from getEffectiveRole() (lib/auth/role.ts, 17 ก.ย. 69 fix)
// instead of computing it locally from getSessionUser()/getMembership() —
// every page below decides its own owner-only gate with the exact same
// function, so the sidebar and the page it links to can never disagree
// (the prod bug this whole change fixes: nav said one thing, the page's own
// getDevRole() check said another). Every failure mode here (no session
// cookie, AUTH_GATE off, either call throwing) still resolves safely:
// getEffectiveRole() itself never throws — it falls back to getDevRole()
// when there's no session — so userEmail=null/role=<DEV_ROLE> at worst,
// never a thrown error blocking the page.
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  let userEmail: string | null = null;
  let role: "owner" | "admin" | "staff" | null = null;
  try {
    const user = await getSessionUser();
    userEmail = user?.email ?? null;
    role = await getEffectiveRole();
  } catch {
    userEmail = null;
    role = null;
  }

  return (
    <ToastProvider>
      <DashboardShell userEmail={userEmail} role={role}>
        {children}
      </DashboardShell>
    </ToastProvider>
  );
}
