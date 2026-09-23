// scripts/lib/format-error.mjs
//
// Pure helper — ไม่มี side effect, ไม่อ่าน env, ไม่ยิง network. ทำ error
// ให้เป็นข้อความบรรทัดเดียวที่ปลอดภัยพอจะลง log ของสคริปต์ที่รันจาก
// Windows Task Scheduler / CI
//
// 🔴 ทำไมห้าม console.error(err) ทั้งก้อน:
// console.error ของ Node เรียก util.inspect ให้อัตโนมัติ ซึ่งพิมพ์ทั้ง stack
// และ cause chain ออกมาหมด — `fetch failed` ของ undici พ่วง err.cause ที่มี
// host/port/URL ของปลายทางติดมาด้วย สำหรับสคริปต์ชุดนี้คือ Supabase project
// URL (subdomain = project ref) ของเดิมพิมพ์ทั้งก้อน — เจอตอน security audit
// 23 ก.ย. 69 (ระดับ Low: log อยู่บนเครื่องเรา แต่ไม่มีเหตุผลให้มันหลุดตั้งแต่แรก)
//
// 🔴 ห้ามพิมพ์ `details` ของ PostgrestError ด้วย — ตรวจซอร์สจริงของ
// @supabase/postgrest-js 2.112.3 (dist/index.cjs:398-410) แล้ว: เวอร์ชันนี้
// **ไม่ได้ทิ้ง cause** มันย้าย cause.message + cause.stack ทั้งก้อนไปไว้ใน
// `details` ⇒ `details` มีหน้าตาแบบนี้ตอนต่อ Supabase ไม่ติด
//     TypeError: fetch failed
//     Caused by: Error: getaddrinfo ENOTFOUND <project-ref>.supabase.co (ENOTFOUND)
//         at GetAddrInfoReqWrap.onlookup ...
// และฝั่ง Postgres เองก็ใส่ `DETAIL: Failing row contains (...)` ให้กับ
// not-null/check violation ⇒ ชื่อ+เบอร์ลูกค้าทั้งแถวหลุดลง log ได้ (PDPA)
// `hint` ไม่มีทั้งสองอย่าง (เป็นข้อความแนะนำที่ Postgres/PostgREST สร้างเอง)
// จึงเอาออก log ได้ และมีค่าในการ debug จริง
//
// 🔴 กับดักที่ทำให้ลอก `${err.name}: ${err.message}` ตรงๆ ไม่พอ:
// supabase-js คืน error เป็น plain object ไม่ใช่ instance ของ Error (ไม่มี
// .name) — และสคริปต์ชุดนี้ `throw error` ตัวนั้นต่อขึ้นมาที่ catch ชั้นบน
// สุดเป็นเคสที่เจอบ่อยที่สุด ถ้าใช้ err.name ตรงๆ จะได้ log ว่า
// "undefined: ..." ซึ่งอ่านแล้วงงกว่าเดิม
//
// ฝั่งแอปมี lib/supabase/postgrest-error.ts (readErrorMessage/readErrorCode)
// ที่อ่าน message/code แบบ structural ด้วยเหตุผลเดียวกัน — ไฟล์นี้ไม่ import
// ตัวนั้นเพราะสคริปต์ใน scripts/ รันด้วย `node` ตรงๆ ไม่ผ่าน bundler จึง
// import .ts ไม่ได้ ถ้าจะแก้กฎการอ่าน error ให้แก้ให้ตรงกันทั้งสองไฟล์
//
// สิ่งที่ยอมให้ออก log: name · message (ผ่าน redact+clamp) · code (SQLSTATE) ·
// cause.code · hint       สิ่งที่ไม่ยอม: cause.message · stack · details · object ดิบ

const MAX_LEN = 300;

/** อ่าน string property แบบไม่ยอมให้ getter/Proxy ที่ throw ฆ่าทั้งฟังก์ชัน */
function readString(obj, key) {
  try {
    const v = obj[key];
    return typeof v === "string" && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

/**
 * message ไม่ใช่ช่องที่เชื่อได้ มันคือข้อความที่คน throw เขียนมาเอง:
 *  - postgrest-js ยัด "body ดิบ" ของ response ที่ไม่ใช่ JSON ลง message ตรงๆ
 *    (หน้า error ของ gateway มีชื่อโฮสต์อยู่ในนั้น)
 *  - Playwright ต่อบล็อก `Call log:` หลายบรรทัด (มี URL) ท้าย message เอง
 * ⇒ ยุบเหลือบรรทัดเดียว (log ของ Task Scheduler อ่านง่ายกว่า) + กลบ URL/host
 *   + จำกัดความยาว ไม่งั้น JSDoc ข้างล่างจะเป็นสัญญาที่ไม่จริง
 */
function redact(text) {
  return text
    .replace(/https?:\/\/\S+/gi, "<url>")
    .replace(/\b[a-z0-9-]+\.supabase\.(?:co|in|net)\b/gi, "<supabase-host>")
    .replace(/\s+/g, " ")
    .trim();
}

function clamp(text) {
  return text.length > MAX_LEN ? `${text.slice(0, MAX_LEN)}… (อีก ${text.length - MAX_LEN} ตัวอักษร)` : text;
}

/**
 * cause.code (ENOTFOUND · ECONNREFUSED · UND_ERR_CONNECT_TIMEOUT ·
 * CERT_HAS_EXPIRED) เป็น enum สั้นๆ ไม่มี host/port — ต่างจาก cause.message
 * และ cause.stack ที่ยังห้ามแตะ ไม่มีบรรทัดนี้ log จะบอกได้แค่ "fetch failed"
 * เฉยๆ ซึ่งแยกไม่ออกว่า DNS ตาย / ต่อไม่ติด / timeout / cert หมดอายุ
 */
function readCauseCode(err) {
  try {
    const cause = err.cause;
    if (cause !== null && typeof cause === "object") return readString(cause, "code");
  } catch {
    /* getter ที่ throw */
  }
  return null;
}

function isErrorInstance(err) {
  try {
    return err instanceof Error; // Proxy getPrototypeOf trap throw ได้
  } catch {
    return false;
  }
}

function typeLabel(err) {
  try {
    // `||` ไม่ใช่ `??` — class นิรนามได้ name เป็น "" ไม่ใช่ undefined
    return err.constructor?.name || "Object";
  } catch {
    return "Object";
  }
}

/**
 * @param {unknown} err  อะไรก็ได้ที่ถูก throw ขึ้นมา
 * @returns {string} ข้อความบรรทัดเดียว ไม่มี stack/cause.message/details
 *   และกลบ URL/Supabase host ที่อาจปนมาใน message — ฟังก์ชันนี้ไม่ throw
 */
export function formatError(err) {
  try {
    // typeof "function" เข้าทางนี้ด้วย ไม่งั้น String(fn) พิมพ์ซอร์สทั้งก้อน
    if (err !== null && (typeof err === "object" || typeof err === "function")) {
      const message = readString(err, "message");
      const code = readString(err, "code");
      const name = readString(err, "name") ?? (isErrorInstance(err) ? "Error" : null);
      const hint = readString(err, "hint");

      const body = message ? clamp(redact(message)) : null;
      const causeCode = readCauseCode(err);
      // `code` ชนะ `name`: PostgrestError/AuthError ของ supabase-js extends
      // Error แต่ยังต้องเห็น SQLSTATE — เช็ค instanceof ก่อนจะกิน code หาย
      const head = code ?? name;
      const tail = (causeCode ? ` (cause ${causeCode})` : "") + (hint ? ` · hint: ${redact(hint)}` : "");

      // ไม่ prefix ซ้ำเวลา message ขึ้นต้นด้วย head อยู่แล้ว (SystemError ของ
      // Node: code "ENOENT" + message "ENOENT: no such file or directory ...")
      if (head && body) return body.startsWith(head) ? `${body}${tail}` : `${head}: ${body}${tail}`;
      if (body) return `${body}${tail}`;
      if (code) return `error code ${code}${tail}`;
      if (name) return `${name} (ไม่มี message)${tail}`;
      return `(error object ไม่มี message/code — ชนิด ${typeLabel(err)})`;
    }

    // primitive ที่ถูก throw (string/number/symbol/undefined) — String()
    // รับได้หมด รวม symbol (ต่างจาก template literal ที่ throw)
    return clamp(redact(String(err)));
  } catch {
    // ห้าม throw ออกจาก catch handler เด็ดขาด — ข้อความจริงจะหายทั้งบรรทัด
    // แล้วกลายเป็น unhandled rejection ที่พิมพ์ stack ของตัวเองแทน
    return "(formatError อ่าน error ตัวนี้ไม่ได้ — ดู exit code)";
  }
}
