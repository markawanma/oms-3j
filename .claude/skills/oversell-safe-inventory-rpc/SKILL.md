---
name: oversell-safe-inventory-rpc
description: >-
  Design and review Postgres stock-deduction logic that must never oversell
  under concurrency. Use this whenever you are building or reviewing central
  inventory / stock reservation, reserve-commit-release RPCs, a "cut stock"
  or "deduct on order" flow, or any last-unit / multi-channel / live-sale
  order path where two buyers can race for the same item — especially
  marketplace or TikTok/Shopee-live order ingestion. Also use it when someone
  reports overselling, negative stock, or double-decrement from retried
  webhooks. It encodes a 3-layer defense, a 2-phase reservation model, and the
  idempotency pitfalls that silently corrupt stock.
---

# Oversell-safe inventory RPC

Overselling under concurrency is the classic inventory bug: two orders read
"1 left" at the same time and both succeed. Naive `SELECT then UPDATE` in app
code cannot prevent it. This skill is the pattern that does — proven against a
real concurrent race (two channels fighting for the last unit; exactly one
wins).

Core principle: **let the database serialize the contention, and make the guard
a property of the row write itself — not of a prior read.**

## The 3-layer defense

Build all three. Each catches what the others might miss.

**Layer 1 — atomic conditional UPDATE.** The reservation and its precondition
are one statement. Zero rows returned = insufficient stock = reject. There is no
read-then-write window for a racer to slip through, because Postgres serializes
writes to the same row.
```sql
update central_stock as cs
   set qty_reserved = cs.qty_reserved + n, updated_at = now()
 where cs.product_id = p_id
   and cs.qty_on_hand - cs.qty_reserved >= n   -- the guard
returning cs.* into v_row;
if not found then
  raise exception 'insufficient stock for %', p_id using errcode = 'P0001';
end if;
```

**Layer 2 — a CHECK constraint as the last wall.** Even if buggy code ever
bypasses the RPC, the database physically cannot oversell.
```sql
alter table central_stock
  add constraint chk_reserved_le_on_hand check (qty_reserved <= qty_on_hand);
-- also: check (qty_on_hand >= 0 and qty_reserved >= 0)
```

**Layer 3 — an idempotent ledger.** Webhooks retry and deliver at-least-once; a
crashed worker re-runs. Record every movement in an append-only `stock_ledger`
with a unique idempotency key, inside the **same transaction** as the stock
UPDATE. A replayed event then decrements exactly once.
```sql
-- unique (shop_id, idempotency_key); composed per product for multi-item orders:
--   idem_key := caller_key || ':' || product_id
```

## 2-phase reservation (don't hard-decrement)

Marketplaces have `unpaid`/COD states that cancel often. Hard-decrementing then
restocking corrupts the ledger and opens overshoot windows on re-sync. Model
stock as a state machine and keep `on_hand` = physical truth:
```
available ──reserve(order in)──▶ reserved ──commit(shipped)──▶ committed (on_hand -n, reserved -n)
    ▲                                │
    └────────── release(cancel) ─────┘
available = qty_on_hand - qty_reserved   -- this is what you push back to every channel
```
- `reserve` on order-in; `commit` on ship (on_hand -n, reserved -n); `release`
  on cancel (reserved -n).
- Auto-release stale unpaid reservations after a TTL (a scheduled sweep).
- If reserve fails, the order goes to a manual-review/`oversold_hold` state —
  the marketplace already sold it; you can only guarantee the *first* buyer gets
  the unit and re-push true stock fast.

## Idempotency pitfalls (these bit us — learn them cheaply)

**Compare the SIGNED delta, not the magnitude.** For a signed adjustment RPC
(`adjust_stock(delta)`), guarding idempotency by comparing `abs(delta)` means
`+5` and `-5` under the same idem_key look identical and the opposite-direction
call is silently swallowed as a "retry". Store and compare the signed
`on_hand_delta`; a reused key with a different delta must raise (conflict), not
no-op. (For reserve/commit/release the qty is always a positive magnitude, so
comparing plain `qty` is fine there — the trap is specific to signed deltas.)

**Aggregate per product before the loop.** If one order lists the same
product_id twice, a per-item loop composes the same idem key twice; the second
hits the unique ledger key and gets skipped → silent under-reservation.
`GROUP BY product_id, SUM(qty)` first, then reserve the summed quantity once.

**Idempotent replay = compare then no-op; genuine conflict = raise.** On a
duplicate key, re-read what actually landed: same payload → safe no-op; different
payload → raise `23505`. Never blindly keep the first result.

## Function hygiene
- Make the RPCs `security definer`, `set search_path = public, pg_temp`, and
  grant EXECUTE to `service_role` only — call them from trusted server code, not
  directly from clients. (On Supabase, `revoke from public` is not enough; also
  revoke from `anon, authenticated` — see the `supabase-migrate` skill.)
- Derive tenant/`shop_id` server-side and re-check ownership
  (`product.shop_id = p_shop_id`) inside the function as defense-in-depth.

## How to verify (don't trust reading)
Prove the guarantee with a **concurrent** test, not a sequential one:
- Seed a product with `on_hand = 1`.
- Fire two `reserve_stock` calls for it **at the same time** (parallel
  connections / `Promise.all`, or two near-simultaneous statements).
- Assert: exactly one succeeds, the other is rejected, and
  `qty_reserved <= qty_on_hand` still holds. Run it many times to shrink the
  race window; the Layer-1 UPDATE + Layer-2 CHECK make the outcome deterministic
  regardless of interleaving.
Also test: idempotent replay (same key twice → decrement once), all-or-nothing
multi-item, reserve→commit balances, release, and boundary qty (= stock, > stock, 0/negative rejected).

Reference implementation in this repo: `supabase/migrations/0001` (schema +
constraints), `0006` (aggregate + signed-guard + ambiguity fixes), `0007`
(adjust_stock signed-delta fix).

Answer in the user's language; keep SQL/identifiers in English.
