// scripts/lib/google-sheets-auth.mjs
//
// Pure helpers for Google's OAuth2 "server-to-server" (service account JWT
// bearer, RFC 7523) flow — no top-level side effects, no env/file reads, no
// network calls. Safe to import from a test file. All I/O (reading the key
// file, POSTing to the token endpoint, calling the Sheets API) lives in
// capture-silver-price-sheet.mjs, which orchestrates these.
//
// 🔴 Deliberately hand-rolled with node:crypto instead of the `googleapis`
// npm package — this script runs from Windows Task Scheduler every 4h and
// the brief called out not wanting to pull in a large dependency for one
// read-only call. If a second Google API integration shows up later, revisit
// whether `googleapis` (or `google-auth-library` alone) is worth it then.
//
// Flow:
//   1. loadServiceAccountKey (in the orchestrator) reads+parses the key JSON
//      -> extractServiceAccountFields() here validates it has what we need.
//   2. buildJwtClaimSet() + signJwt() produce a signed JWT assertion.
//   3. Orchestrator POSTs { grant_type: jwt-bearer, assertion } to
//      tokenUri -> gets an access_token.
//   4. Orchestrator calls Sheets API `spreadsheets.values.get` with
//      `Authorization: Bearer <access_token>`.

import { createSign } from "node:crypto";

/** RFC 7519 JWT header for RS256 — the only alg Google's service-account
 * flow accepts for this grant type. */
export const JWT_HEADER = { alg: "RS256", typ: "JWT" };

function base64url(input) {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf.toString("base64url");
}

/** Builds the JWT claim set for Google's OAuth2 server-to-server flow.
 * `nowSeconds` is injected (never read from Date.now() internally) so tests
 * can assert exact iat/exp without mocking the clock. `expirySeconds`
 * defaults to Google's own max of 3600. */
export function buildJwtClaimSet({ clientEmail, scope, tokenUri, nowSeconds, expirySeconds = 3600 }) {
  if (!clientEmail) throw new Error("buildJwtClaimSet: clientEmail is required");
  if (!scope) throw new Error("buildJwtClaimSet: scope is required");
  if (!tokenUri) throw new Error("buildJwtClaimSet: tokenUri is required");
  if (!Number.isFinite(nowSeconds)) throw new Error("buildJwtClaimSet: nowSeconds is required");
  return {
    iss: clientEmail,
    scope,
    aud: tokenUri,
    iat: nowSeconds,
    exp: nowSeconds + expirySeconds,
  };
}

/** Signs {header}.{claimSet} with an RSA private key (PEM, PKCS#1/PKCS#8 —
 * whatever format the service-account JSON ships) using RSA-SHA256, and
 * returns the compact JWT string. RSA-SHA256 (PKCS#1 v1.5) signing is
 * deterministic for a given key+input (unlike RSA-PSS), so this function's
 * output is fully reproducible — safe to assert against in tests. */
export function signJwt(claimSet, privateKeyPem, header = JWT_HEADER) {
  if (!privateKeyPem) throw new Error("signJwt: privateKeyPem is required");
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claimSet))}`;
  const signature = createSign("RSA-SHA256").update(signingInput).sign(privateKeyPem);
  return `${signingInput}.${base64url(signature)}`;
}

/** Validates + extracts the fields we need from a parsed service-account key
 * JSON. Throws with a Thai message naming exactly which field(s) are missing
 * — callers must not proceed with partial credentials. */
export function extractServiceAccountFields(json) {
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    throw new Error("ไฟล์ key ไม่ใช่ JSON object ที่ถูกต้อง — ตรวจว่าไฟล์ไม่เสียหาย/ไม่ใช่ไฟล์ผิดประเภท");
  }
  if (json.type && json.type !== "service_account") {
    throw new Error(
      `ไฟล์ key มี type="${json.type}" ซึ่งไม่ใช่ service_account key — ไปที่ Google Cloud Console > IAM & Admin > Service Accounts > Keys แล้วดาวน์โหลด JSON key ของ service account ใหม่ (อย่าใช้ OAuth client / authorized_user file)`
    );
  }
  const missing = [];
  if (!json.client_email) missing.push("client_email");
  if (!json.private_key) missing.push("private_key");
  if (missing.length > 0) {
    throw new Error(
      `ไฟล์ key ขาดฟิลด์: ${missing.join(", ")} — ดาวน์โหลด service account key JSON ใหม่จาก Google Cloud Console (IAM & Admin > Service Accounts > Keys > Add key > JSON)`
    );
  }
  return {
    clientEmail: json.client_email,
    privateKey: json.private_key,
    tokenUri: json.token_uri || "https://oauth2.googleapis.com/token",
  };
}
