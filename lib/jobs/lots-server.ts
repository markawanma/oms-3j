// lib/jobs/lots-server.ts — อ่านต้นไม้ส่วนย่อยของใบงาน (L1 · 0181) · server-only · ไม่ใช่ "use server"
// เรียกต่อจาก guard() ของ getJobDetail/getJobBoard เท่านั้น (ไม่มี guard ในตัว) · query .eq("shop_id") เองทุกตัว · มี .limit() เสมอ
// ใช้เฉพาะเมธอดที่ test mock ได้ (select/eq/in/order/limit) · ล้ม = คืน null (หน้าใบงาน/บอร์ดตกกลับไปแบบเดิม ไม่พังทั้งหน้า) + log เฉพาะ code
// 🔴 ไม่มีราคา/ต้นทุน/ชื่อลูกค้า (view ไม่มี) · ไม่ส่งชื่อผู้เปิดใบ

import "server-only";
import { DISCREPANCY_COLUMNS, LOT_STAGE_COLUMNS, TREE_COLUMNS, TREE_SUMMARY_COLUMNS, mapDiscrepancy, mapLotPart, mapLotsSummary, toBoardLots } from "@/lib/jobs/lots";
import type { BoardLots, JobLotsData, LotPart } from "@/lib/jobs/lots";
import { db, shopId } from "@/lib/jobs/office-server";
import { logJobFailure } from "@/lib/jobs/log";

const rows = (d: unknown): Record<string, unknown>[] => (Array.isArray(d) ? (d as Record<string, unknown>[]) : []);
const sortParts = (a: LotPart, b: LotPart) => a.lotSeq - b.lotSeq;

/** ใบแม่ 1 ใบ → ส่วนทั้งหมด + ยอดรวม + ส่วนต่าง · ใบเดี่ยวที่ไม่เคยแยก = parts 1 แถว (ผู้เรียกใช้ hasLots() ตัดสินว่าจะแสดงแผงไหม) · null = อ่านไม่ได้ */
export async function loadJobLots(rootJobId: string, stageNames: Record<string, string>): Promise<JobLotsData | null> {
  try {
    const shop = shopId();
    const [treeRes, discRes] = await Promise.all([
      db().from("v_job_tree").select(TREE_COLUMNS).eq("shop_id", shop).eq("root_job_id", rootJobId).order("lot_seq", { ascending: true }).limit(60),
      db().from("job_discrepancy").select(DISCREPANCY_COLUMNS).eq("shop_id", shop).eq("root_job_id", rootJobId).order("created_at", { ascending: true }).limit(100),
    ]);
    if (treeRes.error) throw treeRes.error;
    if (discRes.error) throw discRes.error;
    const parts = rows(treeRes.data).map(mapLotPart).filter((p): p is LotPart => p !== null).sort(sortParts);
    if (parts.length === 0) return null;
    const discRows = rows(discRes.data);

    // ขั้นของทุกส่วน: ผู้ถือ (seq ที่ received) + ขั้นที่ผ่านมา + ชื่อขั้นสำหรับส่วนต่าง
    const ids = parts.map((p) => p.jobId);
    const needSummary = parts.length > 1 || discRows.length > 0;
    const [stRes, sumRes] = await Promise.all([
      db().from("job_stage").select(LOT_STAGE_COLUMNS).eq("shop_id", shop).in("job_id", ids).order("seq", { ascending: true }).limit(600),
      needSummary ? db().from("v_job_tree_summary").select(TREE_SUMMARY_COLUMNS).eq("shop_id", shop).eq("root_job_id", rootJobId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    ]);
    if (stRes.error) throw stRes.error;
    if (sumRes.error) throw sumRes.error;

    const stageById: Record<string, { name: string }> = {};
    const byJob = new Map<string, LotPart>(parts.map((p) => [p.jobId, p]));
    for (const s of rows(stRes.data)) {
      const id = typeof s.id === "string" ? s.id : null;
      const jobId = typeof s.job_id === "string" ? s.job_id : null;
      const code = typeof s.stage_code === "string" ? s.stage_code : null;
      const seq = typeof s.seq === "number" ? s.seq : null;
      if (!id || !jobId || !code || seq === null) continue;
      const name = stageNames[code] ?? code;
      stageById[id] = { name };
      const part = byJob.get(jobId);
      if (!part) continue;
      if (s.status === "received") part.holdSeq = seq;
      if (s.status === "sent" || s.status === "skipped") part.passedStages.push(name);
    }
    const labelByJob = Object.fromEntries(parts.map((p) => [p.jobId, p.label]));
    const discrepancies = discRows.map((r) => mapDiscrepancy(r, { stageById, labelByJob })).filter((d): d is NonNullable<typeof d> => d !== null);
    const summary = sumRes.data ? mapLotsSummary(sumRes.data as unknown as Record<string, unknown>) : null;
    return { parts, summary, discrepancies };
  } catch (err) {
    logJobFailure("loadJobLots", err);
    return null;
  }
}

/** บอร์ด: ใบแม่หลายส่วน/มีส่วนต่าง → บรรทัด "เสร็จ x/N · …" · map ตาม root id · ล้ม = map ว่าง (บอร์ดแสดงแบบเดิม) */
export async function loadBoardLots(rootIds: string[]): Promise<Map<string, BoardLots>> {
  const out = new Map<string, BoardLots>();
  if (rootIds.length === 0) return out;
  try {
    const shop = shopId();
    const ids = rootIds.slice(0, 200);
    const [sumRes, treeRes] = await Promise.all([
      db().from("v_job_tree_summary").select(TREE_SUMMARY_COLUMNS).eq("shop_id", shop).in("root_job_id", ids).limit(200),
      db().from("v_job_tree").select(TREE_COLUMNS).eq("shop_id", shop).in("root_job_id", ids).order("lot_seq", { ascending: true }).limit(1000),
    ]);
    if (sumRes.error) throw sumRes.error;
    if (treeRes.error) throw treeRes.error;
    const partsByRoot = new Map<string, LotPart[]>();
    for (const r of rows(treeRes.data)) {
      const p = mapLotPart(r);
      const root = typeof r.root_job_id === "string" ? r.root_job_id : null;
      if (!p || !root) continue;
      const list = partsByRoot.get(root) ?? [];
      list.push(p);
      partsByRoot.set(root, list);
    }
    for (const r of rows(sumRes.data)) {
      const summary = mapLotsSummary(r);
      if (!summary) continue;
      const bl = toBoardLots({ parts: partsByRoot.get(summary.rootJobId) ?? [], summary });
      if (bl) out.set(summary.rootJobId, bl);
    }
    return out;
  } catch (err) {
    logJobFailure("loadBoardLots", err);
    return new Map();
  }
}
