"use server";

// lib/actions/job-worker.ts — server action ของหน้าช่าง /w/<token> (สาธารณะ — ไม่ผ่าน middleware · พิสูจน์ตัวด้วย token + PIN ที่ DB)
// ไฟล์นี้เป็น "use server" ไฟล์เดียวที่หน้า /w/ ใช้ได้ — ห้าม import action ออฟฟิศ (job-office) เข้า graph ของหน้านี้ (มีเทสต์)
// ทุก action: ตรวจชนิด/ช่วง input ก่อนถึง DB (ไม่ส่งค่าผิดรูปไปให้ RPC) · ไม่รับ stage_code จาก client (RPC คำนวณขั้นเอง มีแค่ expectedSeq)
// session ช่าง: cookie httpOnly · secure (production) · sameSite=lax · path=/w · อายุตาม DB (≤ 12 ชม.) · เก็บ session token ดิบ (DB เก็บแค่ sha256)

import { cookies } from "next/headers";
import { parseCount, parsePin, parseScrapReason, parseSeq, parseWeight, parseWeightOrZero, isUuid } from "@/lib/jobs/input";
import { WORKER_SESSION_COOKIE, revokeWorkerSession, verifyWorkerPin, workerReceive, workerSend } from "@/lib/jobs/worker-server";
import { WORKER_CODE_TH } from "@/lib/jobs/messages";

export type WorkerActionResult =
  | { ok: true; already?: boolean; message?: string | null }
  | { ok: false; error: string; code?: string; retryAfterSeconds?: number };

const bad = (error: string): WorkerActionResult => ({ ok: false, error });

export async function workerLogin(token: string, workerId: string, pin: string): Promise<WorkerActionResult> {
  if (!isUuid(workerId)) return bad(WORKER_CODE_TH.bad_credentials);
  const p = parsePin(pin);
  if (!p.ok) return bad(p.error);
  const r = await verifyWorkerPin(token, workerId, p.value);
  if (!r.ok) return { ok: false, error: r.error, code: r.code, retryAfterSeconds: r.retryAfterSeconds };
  const jar = await cookies();
  jar.set(WORKER_SESSION_COOKIE, r.data.sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/w",
    maxAge: r.data.maxAgeSeconds,
  });
  return { ok: true };
}

export async function workerLogout(): Promise<WorkerActionResult> {
  await revokeWorkerSession();
  const jar = await cookies();
  jar.set(WORKER_SESSION_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/w", maxAge: 0 });
  return { ok: true };
}

export async function workerReceiveStage(token: string, expectedSeq: number, weightIn: string | null): Promise<WorkerActionResult> {
  const seq = parseSeq(expectedSeq);
  if (!seq.ok) return bad(seq.error);
  const w = parseWeight(weightIn, "น้ำหนักเข้า");
  if (!w.ok) return bad(w.error);
  const r = await workerReceive(token, { expectedSeq: seq.value, weightInG: w.value });
  return r.ok ? { ok: true, already: r.data.already, message: r.data.message } : { ok: false, error: r.error, code: r.code, retryAfterSeconds: r.retryAfterSeconds };
}

export interface WorkerSendInput {
  expectedSeq: number;
  weightOut: string | null;
  qtyScrap: number;
  scrapReason: string | null;
  metalAdded: string | null;
}

export async function workerSendStage(token: string, input: WorkerSendInput): Promise<WorkerActionResult> {
  if (typeof input !== "object" || input === null) return bad("ข้อมูลไม่ถูกต้อง");
  const seq = parseSeq(input.expectedSeq);
  if (!seq.ok) return bad(seq.error);
  const w = parseWeight(input.weightOut, "น้ำหนักออก");
  if (!w.ok) return bad(w.error);
  const scrap = parseCount(input.qtyScrap, "จำนวนของเสีย", 1000);
  if (!scrap.ok) return bad(scrap.error);
  const reason = parseScrapReason(input.scrapReason, scrap.value);
  if (!reason.ok) return bad(reason.error);
  const added = parseWeightOrZero(input.metalAdded, "เติมโลหะ");
  if (!added.ok) return bad(added.error);
  const r = await workerSend(token, { expectedSeq: seq.value, weightOutG: w.value, qtyScrap: scrap.value, scrapReason: reason.value, metalAddedG: added.value });
  return r.ok ? { ok: true, already: r.data.already, message: r.data.message } : { ok: false, error: r.error, code: r.code, retryAfterSeconds: r.retryAfterSeconds };
}
