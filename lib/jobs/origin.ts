// lib/jobs/origin.ts — origin ที่ฝังใน QR ของใบงาน (pure) — security L2 (12 ต.ค.)
// ปัญหา: QR ฝัง URL ของหน้าช่าง ถ้า origin มาจาก Host header ล้วน → พิมพ์จาก preview/localhost แล้วได้ QR ที่ชี้ผิดที่ (หรือ host ปลอมถ้า proxy ตั้งผิด)
// กติกา:
//   1) env APP_ORIGIN ตั้งไว้ = ใช้ค่านี้เสมอ (ไม่สน Host header) · รูปแบบต้องเป็น https://โดเมน[:พอร์ต] ไม่มี path/ท้าย / (หรือ http://localhost[:พอร์ต] สำหรับ dev) · ตั้งผิดรูปแบบ = ปฏิเสธ (fail closed ไม่ถอยไปใช้ Host)
//   2) ไม่ได้ตั้ง = ใช้ Host/X-Forwarded-Host ที่ผ่านการตรวจรูปแบบ (ทางถอยชั่วคราว)
//   3) warning (แถบเตือน print:hidden ในหน้าพิมพ์): ไม่ใช่ production จริง (Vercel preview / dev) หรือ host ที่เปิดหน้าอยู่ไม่ตรงกับ APP_ORIGIN
//      → "พิมพ์จาก preview — QR อาจใช้ไม่ได้" (QR ชี้ production ที่อาจยังไม่มีหน้านี้ / ชี้ localhost ที่ช่างเปิดไม่ได้)
// ค่าจริงของ APP_ORIGIN มาจากเจ้าของ (โดเมน production) — ในเอกสาร/ตัวอย่างใช้ TODO_OWNER_APP_ORIGIN ห้ามแต่ง

export type DeployEnv = "production" | "preview" | "dev";

export interface OriginInput {
  /** process.env.APP_ORIGIN */
  appOrigin: string | undefined;
  /** process.env.VERCEL_ENV (production | preview | development | undefined) */
  vercelEnv: string | undefined;
  /** process.env.NODE_ENV */
  nodeEnv: string | undefined;
  /** x-forwarded-host ?? host (ตัวแรกถ้ามีหลายค่า) */
  host: string | null;
  /** x-forwarded-proto */
  proto: string | null;
}

export type OriginResult =
  | { ok: true; origin: string; host: string; fromEnv: boolean; env: DeployEnv; warning: string | null }
  | { ok: false; error: string };

const HOST_RE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{2,5})?$/i;
const ENV_HTTPS_RE = /^https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d{2,5})?$/;
const ENV_LOCAL_RE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{2,5})?$/;

export const PREVIEW_WARNING = "พิมพ์จาก preview — QR อาจใช้ไม่ได้ (QR ชี้ไปที่เว็บที่ช่างเปิดไม่ถึง หรือเว็บที่ยังไม่มีหน้านี้) ให้พิมพ์จากเว็บ production";
export const ORIGIN_UNKNOWN = "สร้างลิงก์ QR ไม่ได้ — ไม่รู้ที่อยู่เว็บของแอป";
export const ORIGIN_ENV_INVALID = "ตั้งค่า APP_ORIGIN ไม่ถูกต้อง — ต้องเป็น https://โดเมนของแอป (ไม่มี / ท้าย ไม่มี path) ให้แจ้งผู้ดูแลระบบ";

export function deployEnv(vercelEnv: string | undefined, nodeEnv: string | undefined): DeployEnv {
  if (vercelEnv === "production") return "production";
  if (vercelEnv === "preview") return "preview";
  if (vercelEnv === "development") return "dev";
  return nodeEnv === "production" ? "production" : "dev"; // ไม่ใช่ Vercel: next start ที่ NODE_ENV=production ถือเป็น production ที่ติดตั้งเอง
}

function cleanHost(raw: string | null): string | null {
  const h = (raw ?? "").split(",")[0].trim();
  return HOST_RE.test(h) && h.length <= 120 ? h : null;
}

export function resolveAppOrigin(i: OriginInput): OriginResult {
  const env = deployEnv(i.vercelEnv, i.nodeEnv);
  const reqHost = cleanHost(i.host);
  const configured = typeof i.appOrigin === "string" ? i.appOrigin.trim() : "";

  if (configured !== "") {
    if (!ENV_HTTPS_RE.test(configured) && !ENV_LOCAL_RE.test(configured)) return { ok: false, error: ORIGIN_ENV_INVALID };
    const host = configured.replace(/^https?:\/\//, "");
    const mismatch = reqHost !== null && reqHost.toLowerCase() !== host.toLowerCase();
    return { ok: true, origin: configured, host, fromEnv: true, env, warning: env !== "production" || mismatch ? PREVIEW_WARNING : null };
  }

  if (reqHost === null) return { ok: false, error: ORIGIN_UNKNOWN };
  const protoRaw = (i.proto ?? "").split(",")[0].trim();
  const local = reqHost.startsWith("localhost") || reqHost.startsWith("127.");
  const proto = protoRaw === "http" || protoRaw === "https" ? protoRaw : local ? "http" : "https";
  return { ok: true, origin: `${proto}://${reqHost}`, host: reqHost, fromEnv: false, env, warning: env !== "production" ? PREVIEW_WARNING : null };
}
