// lib/jobs/hash.ts — แฮชที่ระบบใบงานต้องส่งให้ DB (ไม่ส่งค่าดิบ) · server-only
// สัญญา 0172: p_token_hash / p_session_hash = sha256 hex ตัวพิมพ์เล็ก 64 ตัวของสตริง UTF-8 ตรงๆ · p_ip_hash = sha256(ip)
// token ดิบอยู่เฉพาะใน URL ของ QR / cookie httpOnly — ห้าม log / ห้ามใส่ error / ห้ามส่งกลับ client หลังใช้

import "server-only";
import { createHash } from "node:crypto";

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** token บน QR = base64url 43 ตัว (32 bytes) — ยอมช่วง 16–64 เผื่อรุ่นอนาคต · รูปแบบอื่น = ไม่ผ่าน (ไม่ส่งไป DB เลย) */
export const WORKER_TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
/** session token ที่ DB ออกให้ = base64url 43 ตัวเช่นกัน */
export const WORKER_SESSION_RE = /^[A-Za-z0-9_-]{16,64}$/;

export function tokenHashOrNull(raw: unknown): string | null {
  return typeof raw === "string" && WORKER_TOKEN_RE.test(raw) ? sha256Hex(raw) : null;
}

export function sessionHashOrNull(raw: unknown): string | null {
  return typeof raw === "string" && WORKER_SESSION_RE.test(raw) ? sha256Hex(raw) : null;
}

/** sha256 ของ IP (ไม่เก็บ ip ดิบ — PDPA) · ไม่มี IP = null (RPC ข้ามด่าน ip แต่ยังมีด่าน token) */
export function ipHashOrNull(ip: string | null | undefined): string | null {
  const v = (ip ?? "").trim();
  return v ? sha256Hex(v) : null;
}

/** IP แรกจาก x-forwarded-for (Vercel ใส่ client IP ไว้ตัวแรก) · ตัดความยาวกันสตริงประหลาด */
export function clientIpFromHeaders(get: (name: string) => string | null): string | null {
  const xff = get("x-forwarded-for");
  const first = xff?.split(",")[0]?.trim();
  const ip = first || get("x-real-ip")?.trim() || null;
  return ip && ip.length <= 64 ? ip : null;
}
