import type { ReactNode } from "react";
import { ToastProvider } from "@/components/ui/Toast";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { getUserClient } from "@/lib/supabase/server";

// Side-nav refactor (docs/3j-jewelry/analytics/phase-b-crm-design.md §4) —
// nav config itself now lives in DashboardShell (desktop sidebar / mobile
// drawer) so it's defined once and shared across breakpoints. This file
// stays a server component; DashboardShell is "use client" only because it
// needs usePathname() + drawer open/close state.

// Phase A1 (auth infra, additive) — docs/3j-jewelry/analytics/
// phase-auth-pii-hardening-design.md §A.1/§A.3. Only used to decide whether
// DashboardShell shows a sign-out button. Every failure mode here (no anon
// key configured yet, no session cookie under the current DEV_ROLE flow,
// getUser() erroring) resolves to null — this must never throw and block the
// page, since every page in this app still runs unauthenticated today.
async function getSessionEmail(): Promise<string | null> {
  try {
    const supabase = await getUserClient();
    const { data } = await supabase.auth.getUser();
    return data.user?.email ?? null;
  } catch {
    return null;
  }
}

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const userEmail = await getSessionEmail();
  return (
    <ToastProvider>
      <DashboardShell userEmail={userEmail}>{children}</DashboardShell>
    </ToastProvider>
  );
}
