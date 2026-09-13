// lib/supabase/postgrest-error.ts
//
// postgrest-js (src/PostgrestBuilder.ts, current: 2.112.3) parses the
// response body into `error` as a PLAIN object — `{ code, message, details,
// hint }` — and returns it in `{ data, error }`. The `PostgrestError` class
// (which `extends Error`) is only ever `new`'d when `.throwOnError()` is
// chained on the query builder; this codebase never does that. Every
// `if (error) throw error` in lib/actions/*.ts therefore throws a
// non-Error plain object, NOT a `PostgrestError` instance.
//
// `err instanceof Error` on that thrown value is always false in
// production, silently killing any `catch` logic written against it. Read
// `code`/`message` structurally instead — never via `instanceof` — so this
// works for both the plain-object shape (the common path here) and a real
// `Error` (or `Error` with `code` assigned onto it, e.g. `throwOnError()` or
// a manually-constructed error).
//
// Pure module: no imports, no "use server", no "server-only" — safe to
// import from both server actions and plain unit tests.

/** Extracts a usable message from anything a catch block might see. Returns
 * "" (never throws) when there's nothing usable — callers should treat ""
 * as "no message", not as a real empty message from the server. */
export function readErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "";
}

/** Extracts the Postgres SQLSTATE (or PostgREST error code) from anything a
 * catch block might see. Returns undefined when there's no string `code` —
 * never throws. */
export function readErrorCode(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}
