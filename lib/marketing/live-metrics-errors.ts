// lib/marketing/live-metrics-errors.ts
//
// Pure module (no "use server", no "server-only") holding the live-metrics
// RPC error mappers — same reasoning as content-errors.ts: lib/actions/
// live-metrics.ts is a "use server" module and can only export async
// functions, so these plain mapper functions live here to stay unit-testable
// directly and importable from both actions and tests.

// relative import — vitest.config.ts has no "@" alias (same as content-errors.ts)
import { readErrorCode, readErrorMessage } from "../supabase/postgrest-error";

/** Maps analytics.live_session_upsert errors (0121) to Thai messages.
 *
 * 🔴 Unlike content_post_upsert's raises (0148, which all use
 * `using errcode = '22023'`), live_session_upsert's raises (0121, applied
 * 16 ก.ย. 69 — before this codebase's convention of pinning a stable
 * SQLSTATE on every validation raise existed) never set an explicit errcode,
 * so plpgsql's default SQLSTATE for a bare `raise exception` applies:
 * P0001 (`raise_exception`). This mapper checks for P0001, not 22023 — do
 * not copy the 22023 check from mapContentPostRpcError below, it would never
 * match anything this RPC actually raises. */
export function mapLiveSessionUpsertRpcError(err: unknown, fallback: string): string {
  const code = readErrorCode(err);
  if (code === "42501") {
    return "เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่บันทึกข้อมูลไลฟ์ได้";
  }
  if (code === "P0001") {
    const msg = readErrorMessage(err);
    if (msg.includes("ต้องระบุ shop") || msg.includes("p_shop_id is required")) {
      return "ขาดข้อมูลร้าน — ลองโหลดหน้านี้ใหม่อีกครั้ง";
    }
    if (msg.includes("viewer สูงสุดต้องไม่ติดลบ")) {
      return "คนดูพีคติดลบไม่ได้";
    }
    if (msg.includes("p_note ยาวเกิน")) {
      return "หมายเหตุยาวเกิน 500 ตัวอักษร";
    }
    if (msg.includes("เวลาเริ่มกับเวลาเลิกไลฟ์ห้ามเท่ากัน")) {
      return "เวลาเริ่มกับเวลาเลิกไลฟ์ห้ามเท่ากัน — ตรวจอีกครั้ง";
    }
    if (msg.includes("เวลาเริ่ม-เลิกน่าจะสลับกัน")) {
      return "เวลาเริ่ม-เลิกน่าจะสลับกัน (ได้ไลฟ์ยาวเกิน 12 ชั่วโมง) — ตรวจเวลาอีกครั้ง";
    }
    if (msg.includes("invalid source")) {
      // ไม่ควรเกิดจริงจากฟอร์มนี้ — action ส่ง p_source: 'admin_ui' ตายตัวเสมอ,
      // เก็บไว้เผื่อ RPC เปลี่ยนรายการค่าที่รับในอนาคตแล้วฟอร์มนี้ตามไม่ทัน
      return "ข้อมูลแหล่งที่มาไม่ถูกต้อง — ติดต่อทีมพัฒนา";
    }
  }
  return fallback;
}

/** Maps analytics.channel_follower_upsert errors (0153) to Thai messages.
 * Every validation raise in that RPC sets `using errcode = '22023'`
 * explicitly (following content_post_upsert's newer convention, not
 * live_session_upsert's older one) — check 22023, same as
 * mapContentPostRpcError. */
export function mapChannelFollowerUpsertRpcError(err: unknown, fallback: string): string {
  const code = readErrorCode(err);
  if (code === "42501") {
    return "เฉพาะเจ้าของร้าน/แอดมินเท่านั้นที่บันทึกจำนวนเพื่อน LINE ได้";
  }
  if (code === "22023") {
    const msg = readErrorMessage(err);
    if (msg.includes("ต้องระบุร้าน")) {
      return "ขาดข้อมูลร้าน — ลองโหลดหน้านี้ใหม่อีกครั้ง";
    }
    if (msg.includes("ต้องระบุช่องทาง วันที่ และจำนวนผู้ติดตาม")) {
      return "กรุณากรอกจำนวนเพื่อน LINE ก่อนบันทึก";
    }
    if (msg.includes("ช่องทางไม่ถูกต้อง")) {
      return "ช่องทางไม่ถูกต้อง — ติดต่อทีมพัฒนา";
    }
    if (msg.includes("จำนวนผู้ติดตามต้องไม่ติดลบ")) {
      return "จำนวนเพื่อน LINE ติดลบไม่ได้";
    }
    if (msg.includes("อยู่ในอนาคต")) {
      return "วันที่นี้อยู่ในอนาคต — ระบบบันทึกให้เฉพาะวันนี้เท่านั้น";
    }
  }
  return fallback;
}
