// lib/jobs/intake-server.ts — ข้อมูลประกอบ "ใบที่เปิดจากหน้างาน" ให้บอร์ดใบงาน (W1 · UX B.10.3) · server-only · ไม่ใช่ "use server"
// เรียกต่อจาก guard() ของ getJobBoard เท่านั้น (ไม่มี guard ในตัว) · query .eq("shop_id") เองทุกตัว · มี .limit() เสมอ
// ใบงานเชื่อมใบผลิตด้วย source_ref = เลข PO (source_kind = production) · ค่าทุกตัวมาจาก v_production_order / v_production_order_item ที่ DB ตัดสินแล้ว (opened_via · acknowledged_at · metal_mismatch)
// ล้ม/อ่านไม่ได้ = { map ว่าง, failed: true } (บอร์ดแสดงแบบเดิม ไม่พังทั้งหน้า — แต่ tile "รอรับทราบ" ต้องขึ้น "—" ไม่ใช่ 0: ศูนย์ที่มาจากการอ่านล้มทำให้เจ้าของเชื่อว่าไม่มีใบค้าง) + log เฉพาะ code · 🔴 ไม่ส่งชื่อผู้เปิด/เงิน/ต้นทุน — มีแค่ธง + เวลา

import "server-only";
import type { BoardIntake } from "@/lib/jobs/types";
import { db, shopId } from "@/lib/jobs/office-server";
import { logJobFailure } from "@/lib/jobs/log";

const rows = (d: unknown): Record<string, unknown>[] => (Array.isArray(d) ? (d as Record<string, unknown>[]) : []);
const CHUNK = 100;

export interface BoardIntakeResult {
  /** po_no → ข้อมูลใบที่เปิดจากหน้างาน (เฉพาะใบผลิต opened_via = shopfloor) */
  map: Map<string, BoardIntake>;
  /** true = อ่านสถานะไม่สำเร็จ (map ว่างไม่ได้แปลว่าไม่มีใบ) */
  failed: boolean;
}

export async function loadBoardIntake(poNos: readonly string[]): Promise<BoardIntakeResult> {
  const out = new Map<string, BoardIntake>();
  const uniq = [...new Set(poNos.filter((p) => typeof p === "string" && p !== ""))];
  if (uniq.length === 0) return { map: out, failed: false };
  try {
    const shop = shopId();
    const chunks: string[][] = [];
    for (let i = 0; i < uniq.length; i += CHUNK) chunks.push(uniq.slice(i, i + CHUNK));
    const orders = new Map<string, { id: string; status: string; ackedAt: string | null; createdAt: string | null }>();
    const results = await Promise.all(
      chunks.map((c) => db().from("v_production_order").select("id, po_no, status, opened_via, acknowledged_at, created_at").eq("shop_id", shop).eq("opened_via", "shopfloor").in("po_no", c).limit(CHUNK)),
    );
    for (const res of results) {
      if (res.error) throw res.error;
      for (const r of rows(res.data)) {
        if (typeof r.po_no !== "string" || typeof r.id !== "string") continue;
        orders.set(r.po_no, {
          id: r.id,
          status: typeof r.status === "string" ? r.status : "",
          ackedAt: typeof r.acknowledged_at === "string" ? r.acknowledged_at : null,
          createdAt: typeof r.created_at === "string" ? r.created_at : null,
        });
      }
    }
    if (orders.size === 0) return { map: out, failed: false };

    // รายการที่โลหะต่างจาก SKU (ที่ระบุโลหะชัด) — DB คำนวณเป็นคอลัมน์ metal_mismatch (ไม่เทียบเองฝั่ง TS)
    const mismatched = new Set<string>();
    const ids = [...orders.values()].map((o) => o.id);
    const idChunks: string[][] = [];
    for (let i = 0; i < ids.length; i += CHUNK) idChunks.push(ids.slice(i, i + CHUNK));
    const itemResults = await Promise.all(idChunks.map((c) => db().from("v_production_order_item").select("production_order_id, metal_mismatch").eq("shop_id", shop).eq("metal_mismatch", true).in("production_order_id", c).limit(500)));
    for (const res of itemResults) {
      if (res.error) throw res.error;
      for (const r of rows(res.data)) if (typeof r.production_order_id === "string" && r.metal_mismatch === true) mismatched.add(r.production_order_id);
    }

    for (const [po, o] of orders) {
      out.set(po, { ackPending: o.status === "open" && o.ackedAt === null, openedAt: o.createdAt, metalMismatch: mismatched.has(o.id) });
    }
    return { map: out, failed: false };
  } catch (err) {
    logJobFailure("loadBoardIntake", err);
    return { map: new Map(), failed: true };
  }
}
