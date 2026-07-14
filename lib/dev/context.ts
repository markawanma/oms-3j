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
