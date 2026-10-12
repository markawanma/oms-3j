// lib/jobs/origin-server.ts — อ่าน env + header ของ request แล้วหา origin สำหรับ QR (server-only · ไม่ใช่ "use server")
import "server-only";
import { headers } from "next/headers";
import { resolveAppOrigin } from "@/lib/jobs/origin";
import type { OriginResult } from "@/lib/jobs/origin";

export async function currentAppOrigin(): Promise<OriginResult> {
  const h = await headers();
  return resolveAppOrigin({
    appOrigin: process.env.APP_ORIGIN,
    vercelEnv: process.env.VERCEL_ENV,
    nodeEnv: process.env.NODE_ENV,
    host: h.get("x-forwarded-host") ?? h.get("host"),
    proto: h.get("x-forwarded-proto"),
  });
}
