// scripts/provision-member.mjs — A0 provisioning (design §A.5).
//
// Links an EXISTING Supabase Auth user to the shop as owner/admin/staff by
// inserting a public.shop_member row (service-role, bypasses RLS). This is the
// bootstrap path that replaces self-serve signup — the auth user must already
// exist (Supabase dashboard -> Authentication -> Users -> Add user, or an
// invite), because we deliberately keep provisioning a service-role-only flow
// (0002's comment), not a public UI.
//
// Usage (env has Node v24 at C:\Program Files\nodejs):
//   node --env-file=.env.local scripts/provision-member.mjs <email> <owner|admin|staff>
//
// Idempotent: re-running for the same user updates their role.

import { createClient } from "@supabase/supabase-js";

const [, , emailArg, roleArg] = process.argv;
const email = (emailArg ?? "").trim().toLowerCase();
const role = (roleArg ?? "").trim();

const VALID_ROLES = ["owner", "admin", "staff"];

function die(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

if (!email) die("usage: node --env-file=.env.local scripts/provision-member.mjs <email> <owner|admin|staff>");
if (!VALID_ROLES.includes(role)) die(`role must be one of ${VALID_ROLES.join("/")} (got: "${role}")`);

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) die("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing (source .env.local via --env-file)");

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

// 1. find the auth user by email (paginate admin.listUsers — no direct
//    getUserByEmail in supabase-js).
async function findAuthUserId(targetEmail) {
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) die(`listUsers failed: ${error.message}`);
    const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === targetEmail);
    if (hit) return hit.id;
    if (data.users.length < 200) break; // last page
  }
  return null;
}

const userId = await findAuthUserId(email);
if (!userId) {
  die(
    `no Supabase Auth user with email "${email}". Create it first: ` +
      `Supabase dashboard -> Authentication -> Users -> Add user (auto-confirm), then re-run.`
  );
}

// 2. resolve the shop (single-shop app — oldest shop).
const { data: shop, error: shopErr } = await admin
  .schema("public")
  .from("shop")
  .select("id, name")
  .order("created_at", { ascending: true })
  .limit(1)
  .maybeSingle();
if (shopErr) die(`shop lookup failed: ${shopErr.message}`);
if (!shop) die("no shop row found");

// 3. upsert shop_member (idempotent on shop_id+user_id).
const { error: upsertErr } = await admin
  .schema("public")
  .from("shop_member")
  .upsert({ shop_id: shop.id, user_id: userId, role }, { onConflict: "shop_id,user_id" });
if (upsertErr) die(`shop_member upsert failed: ${upsertErr.message}`);

console.log(`✓ provisioned ${email} as ${role} on shop "${shop.name}" (${shop.id})`);
