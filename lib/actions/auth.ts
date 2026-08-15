"use server";

// lib/actions/auth.ts — Phase A1 (auth infra, additive). See
// docs/3j-jewelry/analytics/phase-auth-pii-hardening-design.md §A.1/§A.3.
//
// Deliberately separate from the other 14 files in lib/actions/ (crm,
// catalog, marketing, dashboard, orders, ...): those all still read
// getDevRole()/getDevShopId()/getServiceClient() unchanged (A2 swaps them).
// This file only touches the new getUserClient() seam and never existed
// before, so there's nothing here for A2 to migrate.

import { redirect } from "next/navigation";
import { getUserClient } from "@/lib/supabase/server";

/** Signs the current Supabase Auth session out, then redirects to /login.
 * Only rendered from app/(dashboard)/layout.tsx when a real session exists
 * (see getSessionEmail() there) — a no-op call from the current DEV_ROLE
 * flow (no session cookie) still succeeds harmlessly, it just has nothing to
 * clear. */
export async function signOut(): Promise<void> {
  const supabase = await getUserClient();
  await supabase.auth.signOut();
  redirect("/login");
}
