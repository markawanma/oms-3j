// app/api/ring-builder/quote/route.ts — ออกราคาผูกพัน + รหัสสั่งทำ (อ่านอย่างเดียว · ไม่มีช่องเขียน DB) — design §2/§4/§15.2/§16
// exempt path แบบ exact (`api/ring-builder/quote/?$`) ⇒ route นี้ต้องผ่านด่านทุกชั้นเอง และไม่เชื่อ caller เลย
// export เฉพาะ POST (Next ตอบ 405 ให้ method อื่นเอง)
// ลำดับด่าน: 1) same-origin → 403  2) body ≤ 512 B (header + stream) → 413 · UTF-8/JSON เสีย → 400 · หยดช้า → 408
//   3) schema strict (ไม่รับ shop_id/ราคา/pricedAt) → 400 invalid  4) ไม่มี secret → 503 (ไม่แตะ DB)  5) rb_quote (DB คิดราคาสด) → 400 reason / 409 price_changed / 200 + รหัส · อื่น → 500
// ทุกคำตอบ Cache-Control: no-store · log เฉพาะ code (ห้าม log error ทั้งก้อน — supabase-error-logging-trap)
import { NextResponse, type NextRequest } from "next/server";
import { QUOTE_MAX_BODY_BYTES } from "@/lib/ring-builder/config";
import { issueQuote } from "@/lib/ring-builder/quote-server";
import { parseQuoteRequest } from "@/lib/ring-builder/quote-schema";
import type { QuoteFailure, QuoteResponse } from "@/lib/ring-builder/types";

const BODY_READ_TIMEOUT_MS = 5000;
const NO_STORE = { "Cache-Control": "no-store" } as const;

function respond(body: QuoteResponse, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}
function failure(reason: QuoteFailure["reason"], status: 400 | 403 | 408 | 413 | 500 | 503): NextResponse {
  return respond({ ok: false, reason }, status);
}

/** Origin (ถ้ามี) ต้อง host เท่ากับ request · ไม่มี Origin ต้องเป็น Sec-Fetch-Site: same-origin · ไม่มีทั้งสอง = ปฏิเสธ */
function isSameOrigin(request: NextRequest): boolean {
  const host = request.headers.get("host");
  if (!host) return false;
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  return request.headers.get("sec-fetch-site") === "same-origin";
}

type BodyRead = { kind: "ok"; bytes: Uint8Array } | { kind: "too_large" } | { kind: "timeout" } | { kind: "unreadable" };

async function readBodyLimited(request: NextRequest, maxBytes: number): Promise<BodyRead> {
  const stream = request.body;
  if (!stream) return { kind: "ok", bytes: new Uint8Array(0) };
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), BODY_READ_TIMEOUT_MS);
  });
  try {
    for (;;) {
      const next = await Promise.race([reader.read(), deadline]);
      if (next === "timeout") {
        void reader.cancel().catch(() => {});
        return { kind: "timeout" };
      }
      if (next.done) break;
      if (!(next.value instanceof Uint8Array)) return { kind: "unreadable" };
      total += next.value.byteLength;
      if (total > maxBytes) {
        void reader.cancel().catch(() => {});
        return { kind: "too_large" };
      }
      chunks.push(next.value);
    }
  } catch {
    return { kind: "unreadable" };
  } finally {
    clearTimeout(timer);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  return { kind: "ok", bytes };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isSameOrigin(request)) return failure("forbidden", 403);

  const declared = request.headers.get("content-length");
  if (declared) {
    const n = Number(declared);
    if (Number.isFinite(n) && n > QUOTE_MAX_BODY_BYTES) return failure("too_large", 413);
  }
  const read = await readBodyLimited(request, QUOTE_MAX_BODY_BYTES);
  if (read.kind === "too_large") return failure("too_large", 413);
  if (read.kind === "timeout") return failure("timeout", 408);
  if (read.kind === "unreadable") return failure("bad_body", 400);

  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(read.bytes));
  } catch {
    return failure("bad_body", 400);
  }
  const parsed = parseQuoteRequest(json);
  if (!parsed.ok) return respond({ ok: false, reason: "invalid" }, 400);

  let outcome: Awaited<ReturnType<typeof issueQuote>>;
  try {
    outcome = await issueQuote(parsed.data);
  } catch {
    console.error("ring-builder quote failed", { code: "unexpected" });
    return failure("server", 500);
  }
  switch (outcome.kind) {
    case "ok":
      return respond(outcome.body, 200);
    case "conflict":
      return respond(outcome.body, 409);
    case "rejected":
      return respond(outcome.body, 400);
    case "secret":
      console.error("ring-builder quote unavailable", { code: "secret" });
      return failure("unavailable", 503);
    default:
      console.error("ring-builder quote failed", { code: outcome.code });
      return failure("server", 500);
  }
}
