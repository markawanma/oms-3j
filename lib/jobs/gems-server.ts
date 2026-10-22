// lib/jobs/gems-server.ts — อ่านพลอยของใบฝั่ง server (server-only) สำหรับ getJobDetail / ใบพิมพ์ A5
// 🔴 อ่านเฉพาะตาราง job_gem_bom (ฉลาก snapshot · จำนวน · ตำแหน่ง) — ไม่แตะแคตตาล็อกและตารางราคา (service_role ไม่มีสิทธิ์อ่านตารางราคาอยู่แล้ว) · ไม่มีราคา/เผื่อแตก/ผู้สร้างใน type ที่คืน

import "server-only";
import { db, shopId } from "@/lib/jobs/office-server";
import type { GemsState, JobGemsSummary, PrintGem } from "@/lib/jobs/gems";

/**
 * สรุปพลอยของใบแม่: แถว (ฉลาก/จำนวนต่อชิ้น/รวม = ต่อชิ้น × จำนวนเริ่มผลิต/ตำแหน่ง) + state
 * state: specified (มีรายการ) · unspecified (ไม่มีรายการแต่มีขั้นฝังที่ยังไม่เสร็จ) · not_needed (ไม่มีทั้งคู่ = ใบเดิม/ไม่มีขั้นฝัง)
 * throw เมื่ออ่านไม่ได้ — ผู้เรียกจับแล้วถือเป็น "อ่านไม่ได้" (ไม่ใช่ "ไม่มีพลอย")
 */
export async function loadJobGemsSummary(rootJobId: string, qtyPlanned: number, stages: readonly { code: string; status: string }[]): Promise<JobGemsSummary> {
  const { data, error } = await db()
    .from("job_gem_bom")
    .select("gem_label, qty_per_piece, position_note, line_seq")
    .eq("shop_id", shopId())
    .eq("job_id", rootJobId)
    .order("line_seq", { ascending: true })
    .limit(30);
  if (error) throw error;
  const gems: PrintGem[] = [];
  for (const r of (Array.isArray(data) ? data : []) as Record<string, unknown>[]) {
    const qty = r.qty_per_piece;
    if (typeof r.gem_label !== "string" || typeof qty !== "number" || !Number.isInteger(qty)) continue;
    gems.push({ label: r.gem_label, qtyPerPiece: qty, qtyTotal: qty * qtyPlanned, position: typeof r.position_note === "string" && r.position_note !== "" ? r.position_note : null });
  }
  const gemStagePending = stages.some((s) => s.code === "gem_set" && (s.status === "pending" || s.status === "received"));
  const state: GemsState = gems.length > 0 ? "specified" : gemStagePending ? "unspecified" : "not_needed";
  return { state, gems };
}
