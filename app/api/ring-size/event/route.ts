// app/api/ring-size/event/route.ts
//
// ทางเขียนข้อมูลเดียวของสถิติ /ring-size (design-ring-size-analytics §2/§5) — Route Handler แทน Server Action
// โดยตั้งใจ: หน้า /ring-size เป็น exempt path ของ auth gate (middleware matcher) · Server Action ที่ import เข้าหน้านั้น
// จะเลี่ยง gate ได้ · endpoint นี้ก็ exempt แบบ exact path (`api/ring-size/event/?$`) เช่นกัน ⇒ ต้องผ่านด่านทุกชั้นเอง
// และไม่เชื่อ caller เลย (RPC analytics.ring_size_session_upsert ตรวจซ้ำอีกชั้น)
//
// export เฉพาะ POST — Next.js ตอบ 405 ให้ GET/PUT/DELETE/PATCH เอง
//
// ลำดับด่าน:
//   1) same-origin (Origin ต้องตรง host · ไม่มี Origin ต้องเป็น Sec-Fetch-Site: same-origin) → 403
//   2) ขนาด body ≤ 1 KB ทั้ง content-length header และความยาวจริงหลังอ่าน (ไบต์ ไม่ใช่ตัวอักษร) → 413
//   3) JSON object + allowlist/ชนิด/ช่วง (lib/ring-size/track-schema.ts) → 400
//   4) shop จาก env (getDevShopId) — ไม่รับ shop_id จาก client → ไม่มี env = 500 โดยไม่ echo
//   5) RPC ผ่าน service role: 22023 → 400 · P0001 (เกินเพดาน/breaker) → 429 เงียบ · อื่น → 500 · สำเร็จ → 204
//
// ข้อมูลที่ไปถึง RPC = (shop จาก env, session id, snapshot ที่ตรวจแล้ว) เท่านั้น — ไม่อ่าน IP/User-Agent/cookie
// หรือ header ใดนอกจาก origin/host/sec-fetch-site/content-length เพื่อตัดสินด่าน (ไม่ระบุตัวตน)
//
// ทุกคำตอบ Cache-Control: no-store · client ไม่อ่าน body (ส่งแบบ beacon/keepalive ล้มเงียบ) ·
// log เฉพาะ code ที่เป็น enum คงที่ ไม่ log error ทั้งก้อน (memory supabase-error-logging-trap)
import { NextResponse, type NextRequest } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { getDevShopId } from "@/lib/dev/context";
import { readErrorCode } from "@/lib/supabase/postgrest-error";
import { parseRingTrackBody } from "@/lib/ring-size/track-schema";

const MAX_BODY_BYTES = 1024;
const NO_STORE = { "Cache-Control": "no-store" } as const;

function empty(status: 204 | 429): NextResponse {
  return new NextResponse(null, { status, headers: NO_STORE });
}

function fail(message: string, status: 400 | 403 | 413 | 500): NextResponse {
  return NextResponse.json({ error: message }, { status, headers: NO_STORE });
}

/** Origin (ถ้ามี) ต้องมี host เท่ากับ host ของ request · ไม่มี Origin ⇒ ต้องมี Sec-Fetch-Site: same-origin เท่านั้น
 * (เข้มกว่า gem quiz ที่ยอม same-site/none — endpoint นี้ไม่มีเหตุให้เว็บพี่น้องในโดเมนเดียวกันเรียก)
 * ไม่มีทั้งสอง header ⇒ ปฏิเสธ (browser จริงส่ง Origin หรือ Sec-Fetch-Site มากับ POST เสมอ) */
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

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isSameOrigin(request)) {
    return fail("origin ไม่ถูกต้อง", 403);
  }

  // ขนาด body ส่วนที่ 1: header (เช็คเร็ว ก่อนอ่าน body)
  const declared = request.headers.get("content-length");
  if (declared) {
    const bytes = Number(declared);
    if (Number.isFinite(bytes) && bytes > MAX_BODY_BYTES) return fail("body ใหญ่เกินไป", 413);
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return fail("อ่าน body ไม่สำเร็จ", 400);
  }

  // ขนาด body ส่วนที่ 2: ความยาวจริงเป็นไบต์ — กัน header ที่ขาด/โกหก และอักขระหลายไบต์
  if (Buffer.byteLength(rawBody, "utf-8") > MAX_BODY_BYTES) {
    return fail("body ใหญ่เกินไป", 413);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    return fail("ข้อมูลไม่ถูกต้อง", 400);
  }

  // ข้อความทั่วไปเสมอ — ไม่บอกว่าผิดที่ field ไหน (คน probe ไม่ควรได้ schema)
  const parsed = parseRingTrackBody(parsedJson);
  if (!parsed.ok) {
    return fail("ข้อมูลไม่ถูกต้อง", 400);
  }

  let shopId: string;
  try {
    shopId = getDevShopId();
  } catch {
    // ไม่ log ข้อความของ error (มีชื่อตัวแปร env) และไม่ echo กลับ client
    console.error("ring-size event: shop unavailable");
    return fail("บันทึกไม่สำเร็จ", 500);
  }

  try {
    const { error } = await getServiceClient()
      .schema("analytics")
      .rpc("ring_size_session_upsert", {
        p_shop_id: shopId,
        p_session_id: parsed.data.sessionId,
        p_snapshot: parsed.data.snapshot,
      });
    if (error) throw error;
  } catch (err) {
    const code = readErrorCode(err);
    if (code === "P0001") return empty(429); // เกิน event_count ของ session หรือ circuit breaker — เงียบ
    if (code === "22023") return fail("ข้อมูลไม่ถูกต้อง", 400); // ไม่ควรเกิดจริง (ผ่านด่าน 3 มาแล้ว) แต่ RPC ปฏิเสธเองได้
    // 🔴 ห้าม log error ทั้งก้อน (details/DETAIL พ่วง host/PII) — log แค่ code
    console.error("ring-size event RPC failed", { code: code ?? "(none)" });
    return fail("บันทึกไม่สำเร็จ", 500);
  }

  return empty(204);
}
