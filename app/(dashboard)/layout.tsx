import type { ReactNode } from "react";
import { ToastProvider } from "@/components/ui/Toast";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { getSessionUser, getMembership } from "@/lib/auth/session";

// Side-nav refactor (docs/3j-jewelry/analytics/phase-b-crm-design.md §4) —
// nav config itself now lives in DashboardShell (desktop sidebar / mobile
// drawer) so it's defined once and shared across breakpoints. This file
// stays a server component; DashboardShell is "use client" only because it
// needs usePathname() + drawer open/close state.

// Phase A1 (auth infra, additive) + A2-lite (register/approve, 16 ก.ย. 69).
// Used to decide whether DashboardShell shows a sign-out button + email, and
// whether it shows the owner-only "สมาชิก" nav item. Every failure mode
// here (getSessionUser()/getMembership() not wired yet, no session cookie
// under the current DEV_ROLE flow, either call throwing) resolves to
// userEmail=null/role=null — this must never throw and block the page,
// since every page in this app still runs unauthenticated today.
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  let userEmail: string | null = null;
  let role: "owner" | "admin" | "staff" | null = null;
  try {
    const user = await getSessionUser();
    if (user) {
      userEmail = user.email;
      const membership = await getMembership(user.id);
      role = membership?.role ?? null;
    }
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
