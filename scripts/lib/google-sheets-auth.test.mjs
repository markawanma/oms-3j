// scripts/lib/google-sheets-auth.test.mjs
//
// Unit tests for the pure JWT-bearer helpers in google-sheets-auth.mjs. No
// network — signature correctness is verified with a locally-generated RSA
// keypair (node:crypto), which is exactly what a real Google service-account
// key looks like (RSA, PEM). Real end-to-end auth against Google's token
// endpoint cannot be tested until a real credential exists (see feat/
// sheets-api-auth brief) — see the report back to Tech Lead for the verify
// command to run once one does.

import { createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildJwtClaimSet,
  extractServiceAccountFields,
  JWT_HEADER,
  signJwt,
} from "./google-sheets-auth.mjs";

function decodeBase64Url(str) {
  return Buffer.from(str, "base64url").toString("utf8");
}

describe("buildJwtClaimSet", () => {
  it("sets iss/scope/aud from inputs and exp = iat + 3600 by default (Google's max)", () => {
    const claims = buildJwtClaimSet({
      clientEmail: "svc@project.iam.gserviceaccount.com",
      scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
      tokenUri: "https://oauth2.googleapis.com/token",
      nowSeconds: 1_700_000_000,
    });
    expect(claims).toEqual({
      iss: "svc@project.iam.gserviceaccount.com",
      scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
      aud: "https://oauth2.googleapis.com/token",
      iat: 1_700_000_000,
      exp: 1_700_003_600,
    });
  });

  it("respects a custom expirySeconds", () => {
    const claims = buildJwtClaimSet({
      clientEmail: "svc@project.iam.gserviceaccount.com",
      scope: "s",
      tokenUri: "https://oauth2.googleapis.com/token",
      nowSeconds: 100,
      expirySeconds: 60,
    });
    expect(claims.exp).toBe(160);
  });

  it.each([
    ["clientEmail", { scope: "s", tokenUri: "t", nowSeconds: 1 }],
    ["scope", { clientEmail: "e", tokenUri: "t", nowSeconds: 1 }],
    ["tokenUri", { clientEmail: "e", scope: "s", nowSeconds: 1 }],
    ["nowSeconds", { clientEmail: "e", scope: "s", tokenUri: "t" }],
  ])("throws naming the missing field when %s is absent (never send a malformed assertion)", (field, args) => {
    expect(() => buildJwtClaimSet(args)).toThrow(new RegExp(field));
  });
});

describe("signJwt", () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

  it("produces a JWT whose header/claims round-trip and whose signature verifies against the matching public key", () => {
    const claims = buildJwtClaimSet({
      clientEmail: "svc@project.iam.gserviceaccount.com",
      scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
      tokenUri: "https://oauth2.googleapis.com/token",
      nowSeconds: 1_700_000_000,
    });
    const jwt = signJwt(claims, privateKey);
    const parts = jwt.split(".");
    expect(parts).toHaveLength(3);
    const [headerPart, claimsPart, sigPart] = parts;

    expect(JSON.parse(decodeBase64Url(headerPart))).toEqual(JWT_HEADER);
    expect(JSON.parse(decodeBase64Url(claimsPart))).toEqual(claims);

    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${headerPart}.${claimsPart}`);
    expect(verifier.verify(publicKey, Buffer.from(sigPart, "base64url"))).toBe(true);
  });

  it("a signature made with a DIFFERENT private key does NOT verify against our public key (catches a broken signer silently emitting garbage)", () => {
    const otherKeyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const claims = buildJwtClaimSet({
      clientEmail: "svc@project.iam.gserviceaccount.com",
      scope: "s",
      tokenUri: "https://oauth2.googleapis.com/token",
      nowSeconds: 1,
    });
    const jwt = signJwt(claims, otherKeyPair.privateKey);
    const [headerPart, claimsPart, sigPart] = jwt.split(".");
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${headerPart}.${claimsPart}`);
    expect(verifier.verify(publicKey, Buffer.from(sigPart, "base64url"))).toBe(false);
  });

  it("throws if privateKeyPem is missing", () => {
    const claims = buildJwtClaimSet({ clientEmail: "e", scope: "s", tokenUri: "t", nowSeconds: 1 });
    expect(() => signJwt(claims, undefined)).toThrow(/privateKeyPem/);
  });
});

describe("extractServiceAccountFields", () => {
  it("extracts clientEmail/privateKey/tokenUri from a well-formed key JSON", () => {
    const result = extractServiceAccountFields({
      type: "service_account",
      client_email: "svc@project.iam.gserviceaccount.com",
      private_key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n",
      token_uri: "https://oauth2.googleapis.com/token",
    });
    expect(result).toEqual({
      clientEmail: "svc@project.iam.gserviceaccount.com",
      privateKey: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n",
      tokenUri: "https://oauth2.googleapis.com/token",
    });
  });

  it("defaults tokenUri to Google's endpoint if the key file omits it", () => {
    const result = extractServiceAccountFields({
      client_email: "svc@project.iam.gserviceaccount.com",
      private_key: "key",
    });
    expect(result.tokenUri).toBe("https://oauth2.googleapis.com/token");
  });

  it("names client_email in the error when it is absent", () => {
    expect(() => extractServiceAccountFields({ private_key: "key" })).toThrow(/client_email/);
  });

  it("names private_key in the error when it is absent", () => {
    expect(() => extractServiceAccountFields({ client_email: "svc@x.iam.gserviceaccount.com" })).toThrow(/private_key/);
  });

  it("names BOTH missing fields when both are absent", () => {
    expect(() => extractServiceAccountFields({})).toThrow(/client_email.*private_key|private_key.*client_email/);
  });

  it("rejects a key file whose type is not service_account (e.g. an OAuth client-secret / authorized_user file)", () => {
    expect(() =>
      extractServiceAccountFields({ type: "authorized_user", client_email: "x", private_key: "y" })
    ).toThrow(/service_account/);
  });

  it.each([null, undefined, "nope", 42, ["a", "b"]])("rejects non-object input (%j)", (input) => {
    expect(() => extractServiceAccountFields(input)).toThrow();
  });
});
