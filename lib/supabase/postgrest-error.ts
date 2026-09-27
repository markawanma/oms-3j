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

/** Masks every `scheme://...` URL substring in `text` down to a fixed
 * placeholder — for logging a message that might echo caller-supplied input
 * verbatim. Real incident this guards: a Postgres `raise` can interpolate a
 * raw parameter straight into its message (e.g. content_post_upsert's own
 * p_post_url check, supabase/migrations/0148_content_post.sql ~:320 "ได้รับ:
 * %") — for platforms whose post_url isn't canonicalized before storage
 * (Facebook/Instagram/LINE OA, see lib/marketing/tiktok-link.ts's header),
 * that raw value can carry another platform's tracking/session query
 * params. `console.error(err)` on the whole error object would print that
 * straight into logs.
 *
 * Same masking rule as scripts/lib/format-error.mjs's redact() (full mask,
 * not origin-only — a query string can carry an identifier and there's no
 * reason to keep any part of it in a log line) — reimplemented here, not
 * imported, because that file is plain Node/.mjs and can't be imported into
 * this "use server"-adjacent module; keep both in sync if the masking rule
 * ever changes. */
export function redactUrls(text: string): string {
  return text.replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, "<url>");
}
