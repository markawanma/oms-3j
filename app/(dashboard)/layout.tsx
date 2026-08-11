import type { ReactNode } from "react";
import { ToastProvider } from "@/components/ui/Toast";
import { DashboardShell } from "@/components/layout/DashboardShell";

// Side-nav refactor (docs/3j-jewelry/analytics/phase-b-crm-design.md §4) —
// nav config itself now lives in DashboardShell (desktop sidebar / mobile
// drawer) so it's defined once and shared across breakpoints. This file
// stays a server component; DashboardShell is "use client" only because it
// needs usePathname() + drawer open/close state.
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <DashboardShell>{children}</DashboardShell>
    </ToastProvider>
  );
}
