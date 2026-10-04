// app/api/gem-quiz/submit/route.ts
//
// ทางเขียนข้อมูลเดียวของแบบทดสอบเลือกพลอย (design doc §2/§5.2) — Route
// Handler แทน Server Action โดยตั้งใจ (เหตุผล: หน้า /gem-quiz เป็น exempt
// path ของ auth gate, Server Action ที่ import เข้าหน้านั้นจะเลี่ยง
// middleware ไปได้เลย ดู lib/gem-quiz/config.ts หัวไฟล์ + design §1.2).
// เป็นจุดเดียวในฟีเจอร์นี้ที่ถือ service role client — เปิดสาธารณะโดยตั้งใจ
// (ไม่มี session) จึงต้องผ่านด่านทุกชั้นก่อนแตะ DB เสมอ ไม่เชื่อ caller เลย
// แม้แต่ชั้นเดียว (R-3 ของ design doc).
//
// export เฉพาะ POST — Next.js App Router ตอบ 405 ให้อัตโนมัติสำหรับ
// GET/PUT/DELETE/ฯลฯ ที่ไม่มี handler exported (R-1, ไม่ต้องเขียนโค้ดเพิ่ม).
//
// ลำดับด่าน (design §2/§5.2, ทุกข้อ defense-in-depth ซ้ำกับที่ RPC
// analytics.gem_quiz_submit ตรวจอีกชั้นหนึ่ง):
//   L1 same-origin (Origin/Sec-Fetch-Site)
//   body size (content-length + ความยาวจริงหลังอ่าน)
//   L3 honeypot
//   L2 signed form token (รวม GEM_QUIZ_TOKEN_SECRET ไม่ตั้ง → fail closed 503)
//   validate body (lib/gem-quiz/validate.ts, รวม R-13 version mismatch → 409)
//   คำนวณ recommended ใหม่ฝั่ง server (lib/gem-quiz/recommend.ts — ไม่เชื่อ
//     ค่าที่ client ส่งมา, R-8)
//   เรียก RPC ผ่าน service role client
//
// สถานะที่ตอบ (design §5.2 + ตัดสินใจเองนอกเอกสาร — ยืนยันกับ Tech Lead แล้ว
// 4 ต.ค. 69, ดูหมายเหตุที่ "success response" ด้านล่าง):
//   204 = honeypot โดน / token เร็วเกินมนุษย์ / สำเร็จจริง (ดูหมายเหตุ)
//   400 = ไม่ใช่ JSON/token ปลอม-หมดอายุ/validate ไม่ผ่าน
//   403 = ตรวจ same-origin ไม่ผ่าน
//   409 = quiz_version ไม่ตรงกับที่ deploy อยู่ (ผู้ใช้ไม่ผิด ไม่บันทึก)
//   413 = body เกิน 2KB
//   429 = เกิน circuit breaker cap
//   503 = GEM_QUIZ_TOKEN_SECRET ไม่ได้ตั้ง (fail closed, R-9)
//   500 = RPC ล้มเหลวแบบไม่คาดคิด (ไม่ echo DB error กลับ client/log)
//
// client ไม่อ่าน/ไม่แสดง error ใดๆ จากเรสปอนส์นี้เลย (ผลลัพธ์ถูกคำนวณและแสดง
// บนจอไปแล้วก่อนยิง request นี้ — design §2 "fire-and-forget").
import { NextResponse, type NextRequest } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { getDevShopId } from "@/lib/dev/context";
import { verifyFormToken } from "@/lib/gem-quiz/form-token";
import { validateGemQuizBody } from "@/lib/gem-quiz/validate";
import { recommendStoneCodes } from "@/lib/gem-quiz/recommend";
import { readErrorCode } from "@/lib/supabase/postgrest-error";

const MAX_BODY_BYTES = 2048; // R-2

function noContent(status: 204 | 429): NextResponse {
  return new NextResponse(null, { status });
}

function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

/** L1 — Origin (หรือ Sec-Fetch-Site ถ้า browser ไม่ส่ง Origin มา) ต้องตรงกับ
 * host ของ request เอง. ไม่มีทั้งสอง header เลย (ผิดปกติสำหรับ POST จาก
 * browser จริง) ⇒ ปฏิเสธแบบระวังไว้ก่อน (defense-in-depth — ไม่ใช่ด่านหลัก). */
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

  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite) {
    return secFetchSite === "same-origin" || secFetchSite === "same-site" || secFetchSite === "none";
  }

  return false;
}

function isHoneypotTripped(body: Record<string, unknown>): boolean {
  const value = body.hp;
  return value !== undefined && value !== null && value !== "";
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // --- body size (ส่วนที่ 1: content-length header, เช็คเร็ว ก่อนอ่าน body) ---
  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader) {
    const declaredBytes = Number(contentLengthHeader);
    if (Number.isFinite(declaredBytes) && declaredBytes > MAX_BODY_BYTES) {
      return jsonError("body ใหญ่เกินไป", 413);
    }
  }

  // --- L1 same-origin ---
  if (!isSameOrigin(request)) {
    return jsonError("origin ไม่ถูกต้อง", 403);
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return jsonError("อ่าน body ไม่สำเร็จ", 400);
  }

  // --- body size (ส่วนที่ 2: ความยาวจริง — กัน content-length header ที่
  // ขาดไปหรือโกหก) ---
  if (Buffer.byteLength(rawBody, "utf-8") > MAX_BODY_BYTES) {
    return jsonError("body ใหญ่เกินไป", 413);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return jsonError("body ไม่ใช่ JSON ที่ถูกต้อง", 400);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return jsonError("body ต้องเป็น JSON object", 400);
  }
  const body = parsed as Record<string, unknown>;

  // --- L3 honeypot — โดน ⇒ ทิ้งเงียบ ไม่บันทึก ไม่สอน bot ว่าโดนจับ ---
  if (isHoneypotTripped(body)) {
    return noContent(204);
  }

  // --- L2 signed form token (รวมด่าน GEM_QUIZ_TOKEN_SECRET ไม่ตั้ง → 503) ---
  const tokenValue = typeof body.token === "string" ? body.token : null;
  const tokenResult = verifyFormToken(tokenValue);
  if (!tokenResult.ok) {
    if (tokenResult.reason === "secret_unset") {
      return jsonError("ระบบยังไม่พร้อมใช้งาน", 503); // R-9 fail closed
    }
    if (tokenResult.reason === "too_fast") {
      return noContent(204); // R-5 — เงียบ ไม่สอน bot
    }
    // missing / malformed / bad_signature / too_old — R-4
    return jsonError("token ไม่ถูกต้องหรือหมดอายุ", 400);
  }

  // --- validate body ตาม config เวอร์ชันปัจจุบัน ---
  const validated = validateGemQuizBody(body);
  if (!validated.ok) {
    if (validated.kind === "version_mismatch") {
      return jsonError(validated.message, 409); // R-13 — ผู้ใช้ไม่ผิด ไม่บันทึก
    }
    // Security audit L5 (4 ต.ค. 69): validated.message (เช่น "answers มี key
    // ไม่ถูกต้อง: xyz") บอก schema ภายในให้คนที่ probe endpoint นี้ตรงๆ โดยที่
    // client ไม่ได้อ่าน body ของ response นี้อยู่แล้ว (ผลลัพธ์แสดงจากฝั่ง client
    // ไปก่อนแล้ว) ไม่มีประโยชน์ที่ต้องรับความเสี่ยงนี้ — ตอบข้อความทั่วไปแทน
    return jsonError("ข้อมูลไม่ถูกต้อง", 400);
  }

  // --- คำนวณ recommended ใหม่ฝั่ง server เสมอ — ไม่เชื่อค่าที่ client ส่งมา (R-8) ---
  const recommendedStoneCodes = recommendStoneCodes(validated.data.answers);

  try {
    const shopId = getDevShopId();
    const supabase = getServiceClient();

    const { error } = await supabase.schema("analytics").rpc("gem_quiz_submit", {
      p_shop_id: shopId,
      p_quiz_version: validated.data.quizVersion,
      p_src: validated.data.src,
      p_liked_stone_codes: validated.data.likedStoneCodes,
      p_answers: validated.data.answers,
      p_recommended_stone_codes: recommendedStoneCodes,
      p_is_retake: validated.data.isRetake,
    });
    if (error) throw error;
  } catch (err) {
    const code = readErrorCode(err);
    if (code === "P0001") {
      return noContent(429); // circuit breaker (R-12)
    }
    if (code === "22023") {
      // ไม่ควรเกิดจริง (route ตรวจผ่านมาแล้วทุกข้อ) — แต่ RPC ปฏิเสธเองได้เสมอ
      // (defense-in-depth), แมปเป็น 400 เดียวกับ validate ไม่ผ่านชั้นนี้
      return jsonError("ข้อมูลไม่ถูกต้อง", 400);
    }
    // 🔴 ห้าม log error object ทั้งก้อน (memory supabase-error-logging-trap —
    // details/DETAIL อาจพ่วง host/PII) — log แค่ code ที่เป็น enum คงที่
    console.error("gem-quiz submit RPC failed", { code: code ?? "(none)" });
    return jsonError("บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง", 500);
  }

  // สำเร็จจริง — ใช้ 204 เหมือนเคส honeypot/token เร็วเกิน โดยตั้งใจ (ยืนยันกับ
  // Tech Lead แล้ว 4 ต.ค. 69: brief เดิมเขียน "205" ซึ่งไม่ตรงกับสถานะใดใน
  // design §5.2 — เป็น typo ของ "204" จริง). client ไม่อ่าน body ของเรสปอนส์นี้
  // อยู่แล้ว (ผลลัพธ์แสดงจากการคำนวณฝั่ง client ไปก่อนแล้ว) และการให้ "สำเร็จจริง"
  // กับ "honeypot โดนแบบเงียบ" ตอบเหมือนกันทุกประการ (204 ไม่มี body ทั้งคู่)
  // เสริมเจตนาเดิมของ design: bot ไม่มีทางแยกออกว่าถูกบันทึกจริงหรือถูกทิ้งเงียบๆ
  return noContent(204);
}
