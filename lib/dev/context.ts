// lib/dev/context.ts
//
// DEV-ONLY shortcut (documented in .env.local.example + CLAUDE.md): there is
// no auth/onboarding in this batch. Every server action in this app acts as
// if the current request belongs to exactly one shop, identified by the
// `DEV_SHOP_ID` env var. This file is the single seam that stands in for
// "get the current user's shop_id from their session" — replace the body of
// getDevShopId() with real auth (Supabase Auth session -> shop_member) when
// that ships. Nothing else in the app should read `process.env.DEV_SHOP_ID`
// directly, so that swap only has to happen in one place.
//
// Server-only: this file must never be imported from a "use client" component.
import "server-only";

export function getDevShopId(): string {
  const shopId = process.env.DEV_SHOP_ID;
  if (!shopId || shopId.trim() === "") {
    throw new Error(
      "DEV_SHOP_ID is not set. This MVP has no auth yet — seed a shop " +
        "(see docs/dev-seed.sql) and set DEV_SHOP_ID in .env.local to its id."
    );
  }
  return shopId;
}

export type DevRole = "owner" | "admin" | "staff";

/**
 * DEV-ONLY stand-in for a real Supabase Auth session's `shop_member.role`.
 *
 * Why this exists: the CRM module (docs/3j-jewelry/analytics/phase-b-crm-design.md
 * §2.7, Decision Q7) requires PII (analytics.pii_customer: phone/full name/
 * address) to be visible to owner/admin only, everyone else sees "—". In a
 * real deployment that's enforced by Postgres RLS on pii_customer (0012
 * migration) evaluated against `auth.uid()`. This app has no login yet, and
 * every server action reads through the SERVICE ROLE client
 * (lib/supabase/server.ts), which BYPASSES RLS entirely — so without an
 * explicit application-level check, PII would be visible to anyone who can
 * load a CRM page, regardless of role, silently defeating Q7.
 *
 * This function is that application-level check, gating PII reads in
 * lib/actions/crm.ts until real auth (Supabase Auth + shop_member.role)
 * replaces it — same seam contract as getDevShopId() above. Defaults to
 * "staff" (fail closed) if DEV_ROLE is unset or invalid, so a forgotten env
 * var hides PII instead of leaking it.
 */
export function getDevRole(): DevRole {
  const role = (process.env.DEV_ROLE ?? "staff").trim().toLowerCase();
  if (role === "owner" || role === "admin" || role === "staff") return role;
  return "staff";
}
