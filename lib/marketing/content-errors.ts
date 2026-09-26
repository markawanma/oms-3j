// lib/marketing/content-errors.ts
//
// Pure module (no "use server", no "server-only") holding the content
// measurement RPC error mappers — same reasoning as calendar-errors.ts:
// lib/actions/content.ts is a "use server" module and can only export async
// functions, so these plain mapper functions live here to stay unit-testable
// directly and importable from both actions and tests.

// relative import — vitest.config.ts has no "@" alias (same as calendar-errors.ts)
import { readErrorCode, readErrorMessage } from "../supabase/postgrest-error";

/** Maps analytics.content_post_upsert errors (0148 §3) to Thai messages that
 * tell the owner what to do next, preferring the stable SQLSTATE over
 * message text where one is available. */
export function mapContentPostRpcError(err: unknown, fallback: string): string {
  const code = readErrorCode(err);
  if (code === "22023") {
    const msg = readErrorMessage(err);
    if (msg.includes("ต้องขึ้นต้นด้วย http")) {
      return "ลิงก์ต้องขึ้นต้นด้วย http:// หรือ https:// — ลองวางลิงก์ใหม่อีกครั้ง";
    }
    if (msg.includes("posted_at") && msg.includes("อยู่ในอนาคต")) {
      return "วันที่โพสต์อยู่ในอนาคต — แก้วันที่ให้ตรงกับตอนที่โพสต์จริงก่อนบันทึก";
    }
    if (msg.includes("p_post_url") && msg.includes("ยาวเกิน")) {
      return "ลิงก์ยาวเกินไป (เกิน 500 ตัวอักษร)";
    }
    if (msg.includes("p_external_id") && msg.includes("ยาวเกิน")) {
      // 26 ก.ย. 69: used to suggest "ลองวางลิงก์แบบสั้นแทน" — now WRONG advice.
      // lib/marketing/tiktok-link.ts canonicalizes every TikTok link (short
      // or long) down to the same fixed https://www.tiktok.com/@user/video/id
      // shape before this RPC ever sees p_external_id, so a short link can't
      // make this error go away — the actual fix is a bad/garbled URL.
      return "ลิงก์นี้มีความยาวผิดปกติ (เกิน 500 ตัวอักษร) — ตรวจว่าไม่ได้วางลิงก์ผิดหรือมีอักขระซ้ำหลุดเข้ามา";
    }
    if (msg.includes("มีสถานะ") && msg.includes("อยู่แล้ว")) {
      return "ลิงก์นี้เคยถูกลบ/ตั้งเป็นส่วนตัวไว้ก่อนหน้านี้ — ต้องเปิดกลับมาใช้ก่อนถึงจะบันทึกทับได้";
    }
    if (msg.includes("age_days") && msg.includes("ติดลบ")) {
      return "แก้วันที่โพสต์นี้ไม่ได้ — จะทำให้ตัวเลขที่เคยกรอกไว้แล้วมีอายุติดลบ";
    }
    if (msg.includes("content_type_code ไม่ถูกต้อง")) {
      return "ประเภทเนื้อหาที่เลือกไม่ถูกต้อง ลองเลือกใหม่";
    }
    if (msg.includes("ไม่พบ artifact")) {
      return "ไม่พบงานในปฏิทินที่จะผูกลิงก์นี้ด้วย — งานอาจถูกลบไปแล้ว";
    }
    if (msg.includes("ห้ามเป็นค่าว่าง")) {
      return "กรุณาวางลิงก์โพสต์ก่อนบันทึก";
    }
  }
  if (code === "23505") {
    return "ลิงก์นี้ถูกบันทึกไว้แล้วก่อนหน้านี้";
  }
  return fallback;
}

/** Maps analytics.content_post_metric_upsert / content_post_set_status
 * errors (0148 §4/§5) to Thai messages. */
export function mapContentMetricRpcError(err: unknown, fallback: string): string {
  const code = readErrorCode(err);
  if (code === "22023") {
    const msg = readErrorMessage(err);
    if (msg.includes("ต้องส่งตัวเลขจริงอย่างน้อย 1 ค่า")) {
      return "กรอกอย่างน้อย 1 ช่องก่อนบันทึก — ช่องที่ไม่รู้เว้นว่างไว้ได้";
    }
    if (msg.includes("ติดลบไม่ได้")) {
      return "ตัวเลขติดลบไม่ได้ ตรวจดูอีกครั้ง";
    }
    if (msg.includes("ไม่พบโพสต์")) {
      return "ไม่พบโพสต์นี้ในร้าน — อาจถูกลบไปแล้ว";
    }
    if (msg.includes("age_days ติดลบ")) {
      return "โพสต์นี้ปล่อยวันที่ในอนาคต — อ่านค่ายังไม่ได้จนกว่าจะถึงวันนั้นจริง";
    }
    if (msg.includes("status ไม่ถูกต้อง")) {
      return "สถานะโพสต์ไม่ถูกต้อง";
    }
  }
  return fallback;
}
