// lib/oversold/types.ts — /orders/oversold follow-up tracker (COO 9.9
// ops-plan-99.md §6), backed by supabase/migrations/0038_oversold_followup.sql
// (analytics.v_oversold_hold_queue + analytics.oversold_followup_upsert RPC).
// Column shapes below are copied 1:1 from that migration — this page is a
// HUMAN follow-up annotation layer only, it never touches order status or
// stock (cancel/refund/fulfil still happens on the existing order flow at
// /orders/[id]).

import type { BadgeTone } from "@/components/ui/Badge";

// ============================================================================
// analytics.v_oversold_hold_queue — one row per order currently held with
// status 'oversold_hold', oldest-held first (ordered by hoursHeld desc in the
// read action). buyerName/buyerPhone are order PII — page is owner/admin
// gated end-to-end (contacting the buyer is the whole point of this page).
// ============================================================================

export interface OversoldHoldRow {
  orderId: string;
  shopId: string;
  externalOrderId: string;
  buyerName: string | null;
  buyerPhone: string | null;
  totalAmount: number;
  liveSessionId: string | null;
  /** ISO timestamp — order's placed_at (falls back to created_at in the view). */
  placedAt: string;
  itemCount: number;
  /** Hours since placedAt, to 1 decimal — drives the SLA badge. */
  hoursHeld: number;
  contactStatus: OversoldContactStatus;
  resolution: OversoldResolution | null;
  note: string | null;
  /** ISO timestamp — null when nobody has logged a follow-up yet. */
  followupUpdatedAt: string | null;
}

export type OversoldContactStatus = "pending" | "contacted" | "resolved";

export type OversoldResolution = "restock" | "swap" | "refund" | "other";

/** analytics.oversold_followup_upsert RPC input. */
export interface UpdateOversoldFollowupInput {
  orderId: string;
  contactStatus: OversoldContactStatus;
  resolution: OversoldResolution | null;
  note: string | null;
}

// ============================================================================
// Cosmetic label/tone lookups only, per "อย่า hardcode business logic ใน
// frontend" — the DB's check constraints are the real source of truth
// (contact_status/resolution). Fallback branches keep the card rendering
// something sane even if the DB ever emits a value not listed here.
// ============================================================================

export const OVERSOLD_CONTACT_STATUS_LABEL_TH: Record<OversoldContactStatus, string> = {
  pending: "รอติดต่อ",
  contacted: "ติดต่อแล้ว",
  resolved: "เคลียร์แล้ว",
};

export const OVERSOLD_CONTACT_STATUS_TONE: Record<OversoldContactStatus, BadgeTone> = {
  pending: "slate",
  contacted: "amber",
  resolved: "green",
};

function isOversoldContactStatus(v: string): v is OversoldContactStatus {
  return v === "pending" || v === "contacted" || v === "resolved";
}

export function oversoldContactStatusLabel(status: string): string {
  return isOversoldContactStatus(status) ? OVERSOLD_CONTACT_STATUS_LABEL_TH[status] : status;
}

export function oversoldContactStatusTone(status: string): BadgeTone {
  return isOversoldContactStatus(status) ? OVERSOLD_CONTACT_STATUS_TONE[status] : "slate";
}

export const OVERSOLD_RESOLUTION_LABEL_TH: Record<OversoldResolution, string> = {
  restock: "รอผลิต/รอเข้าใหม่",
  swap: "เปลี่ยน SKU",
  refund: "คืนเงิน",
  other: "อื่นๆ",
};

function isOversoldResolution(v: string): v is OversoldResolution {
  return v === "restock" || v === "swap" || v === "refund" || v === "other";
}

export function oversoldResolutionLabel(resolution: string): string {
  return isOversoldResolution(resolution) ? OVERSOLD_RESOLUTION_LABEL_TH[resolution] : resolution;
}

// ============================================================================
// SLA thresholds (COO 9.9 ops-plan-99.md §6: 48h SLA to clear a held case).
// ============================================================================

export type OversoldSlaState = "breached" | "warning" | "ok";

export const OVERSOLD_SLA_BREACH_HOURS = 48;
export const OVERSOLD_SLA_WARNING_HOURS = 24;

export function oversoldSlaState(hoursHeld: number): OversoldSlaState {
  if (hoursHeld > OVERSOLD_SLA_BREACH_HOURS) return "breached";
  if (hoursHeld > OVERSOLD_SLA_WARNING_HOURS) return "warning";
  return "ok";
}

export const OVERSOLD_SLA_LABEL_TH: Record<OversoldSlaState, string> = {
  breached: "เกิน SLA",
  warning: "ใกล้ครบ SLA",
  ok: "ปกติ",
};

export const OVERSOLD_SLA_TONE: Record<OversoldSlaState, BadgeTone> = {
  breached: "red",
  warning: "amber",
  ok: "green",
};
