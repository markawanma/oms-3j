// lib/supabase/postgrest-error.ts
//
// postgrest-js returns `{ data, error }` with `error` as a PLAIN object
// (`{ code, message, details, hint }`), not a `PostgrestError` instance —
// that class only gets `new`'d when `.throwOnError()` is chained, which this
// repo never does. So `err instanceof Error` is always false here; read
// `code`/`message` structurally instead.
//
// Pure module: no imports, no "use server", no "server-only" — safe to
// import from both server actions and plain unit tests.

/** Extracts a usable message from anything a catch block might see. Returns
 * "" (never throws for plain data — a throwing getter/Proxy is out of scope;
 * PostgREST payloads come from JSON.parse) when there's nothing usable —
 * callers should treat "" as "no message", not as a real empty message from
 * the server. */
export function readErrorMessage(err: unknown): string {
  if (typeof err !== "object" || err === null) return "";
  const message = (err as { message?: unknown }).message;
  return typeof message === "string" ? message : "";
}

/** Extracts the Postgres SQLSTATE (or PostgREST error code) from anything a
 * catch block might see. Returns undefined when there's no string `code` —
 * never throws. */
export function readErrorCode(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}
