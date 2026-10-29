// lib/jobs/lots-server.ts — อ่านต้นไม้ส่วนย่อยของใบงาน (L1 · 0181) · server-only · ไม่ใช่ "use server"
// เรียกต่อจาก guard() ของ getJobDetail/getJobBoard เท่านั้น (ไม่มี guard ในตัว) · query .eq("shop_id") เองทุกตัว · มี .limit() เสมอ
// ใช้เฉพาะเมธอดที่ test mock ได้ (select/eq/in/order/limit) · ล้ม = คืน null (หน้าใบงาน/บอร์ดตกกลับไปแบบเดิม ไม่พังทั้งหน้า) + log เฉพาะ code
// 🔴 ไม่มีราคา/ต้นทุน/ชื่อลูกค้า (view ไม่มี) · ไม่ส่งชื่อผู้เปิดใบ

import "server-only";
import { DISCREPANCY_COLUMNS, LOT_STAGE_COLUMNS, TREE_COLUMNS, TREE_LOSS_COLUMNS, TREE_SUMMARY_COLUMNS, RECEIVE_LOCK_STRIKES, mapDiscrepancy, mapLotPart, mapLotsSummary, mapTreeStageLoss, toBoardLots } from "@/lib/jobs/lots";
import type { BoardLots, JobLotsData, LotPart, TreeStageLoss } from "@/lib/jobs/lots";
import { db, shopId } from "@/lib/jobs/office-server";
import { logJobFailure } from "@/lib/jobs/log";

const rows = (d: unknown): Record<string, unknown>[] => (Array.isArray(d) ? (d as Record<string, unknown>[]) : []);
const sortParts = (a: LotPart, b: LotPart) => a.lotSeq - b.lotSeq;

/** ใบแม่ 1 ใบ → ส่วนทั้งหมด + ยอดรวม + ส่วนต่าง · ใบเดี่ยวที่ไม่เคยแยก = parts 1 แถว (ผู้เรียกใช้ hasLots() ตัดสินว่าจะแสดงแผงไหม) · null = อ่านไม่ได้ */
export async function loadJobLots(rootJobId: string, stageNames: Record<string, string>, metalStages: ReadonlySet<string> = new Set()): Promise<JobLotsData | null> {
  try {
    const shop = shopId();
    const [treeRes, discRes] = await Promise.all([
      db().from("v_job_tree").select(TREE_COLUMNS).eq("shop_id", shop).eq("root_job_id", rootJobId).order("lot_seq", { ascending: true }).limit(60),
      db().from("v_job_discrepancy").select(DISCREPANCY_COLUMNS).eq("shop_id", shop).eq("root_job_id", rootJobId).order("created_at", { ascending: true }).limit(100),
    ]);
    if (treeRes.error) throw treeRes.error;
    if (discRes.error) throw discRes.error;
    const parts = rows(treeRes.data).map(mapLotPart).filter((p): p is LotPart => p !== null).sort(sortParts);
    if (parts.length === 0) return null;
    const discRows = rows(discRes.data);

    // ขั้นของทุกส่วน: ผู้ถือ (seq ที่ received) + ขั้นที่ผ่านมา + ชื่อขั้นสำหรับส่วนต่าง
    const ids = parts.map((p) => p.jobId);
    const needSummary = parts.length > 1 || discRows.length > 0;
    const [stRes, sumRes, lossRes] = await Promise.all([
      db().from("job_stage").select(LOT_STAGE_COLUMNS).eq("shop_id", shop).in("job_id", ids).order("seq", { ascending: true }).limit(600),
      needSummary ? db().from("v_job_tree_summary").select(TREE_SUMMARY_COLUMNS).eq("shop_id", shop).eq("root_job_id", rootJobId).maybeSingle() : Promise.resolve({ data: null, error: null }),
      // M-A: น้ำหนักสูญเสีย/ส่วนต่างส่งมอบของทุกใบในต้นไม้ — ดึงเมื่อมีหลายส่วนเท่านั้น (ใบเดี่ยวหน้าเดิมใช้ loss ของใบเอง)
      parts.length > 1
        ? db().from("v_job_tree_stage_loss").select(TREE_LOSS_COLUMNS).eq("shop_id", shop).eq("root_job_id", rootJobId).order("lot_seq", { ascending: true }).limit(600)
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (stRes.error) throw stRes.error;
    if (sumRes.error) throw sumRes.error;
    if (lossRes.error) throw lossRes.error;

    const stageById: Record<string, { name: string; code: string; weighRequired: boolean }> = {};
    const byJob = new Map<string, LotPart>(parts.map((p) => [p.jobId, p]));
    const pendingId = new Map<string, string>(); // job_id → id ของขั้นรอรับต่ำสุด
    const stagesOf = new Map<string, { id: string; seq: number; status: string; qtyIn: number | null; qtyOut: number | null }[]>();
    for (const s of rows(stRes.data)) {
      const id = typeof s.id === "string" ? s.id : null;
      const jobId = typeof s.job_id === "string" ? s.job_id : null;
      const code = typeof s.stage_code === "string" ? s.stage_code : null;
      const seq = typeof s.seq === "number" ? s.seq : null;
      if (!id || !jobId || !code || seq === null) continue;
      const name = stageNames[code] ?? code;
      stageById[id] = { name, code, weighRequired: s.weigh_required === true };
      const list = stagesOf.get(jobId) ?? [];
      list.push({ id, seq, status: typeof s.status === "string" ? s.status : "", qtyIn: typeof s.qty_in === "number" ? s.qty_in : null, qtyOut: typeof s.qty_out === "number" ? s.qty_out : null });
      stagesOf.set(jobId, list);
      const part = byJob.get(jobId);
      if (!part) continue;
      if (typeof s.arrive_discrepancy_id === "string" && s.arrive_discrepancy_id !== "") part.fromArrive = true;
      if (s.status === "received") {
        part.holdSeq = seq;
        part.holdWeighRequired = s.weigh_required === true;
      }
      const wIn = typeof s.weight_in_g === "number" ? s.weight_in_g : null;
      const wOut = typeof s.weight_out_g === "number" ? s.weight_out_g : null;
      // 0195 M2: ถือโลหะแล้ว = มีขั้นที่รับ/ส่งแล้วและโลหะอยู่ในมือที่ขั้นนั้น (ทอง + ของเสีย = ต้องชั่งเสมอ — ตรงกับ job_lot_cancel_core)
      if ((s.status === "received" || s.status === "sent") && metalStages.has(code)) part.holdsMetal = true;
      // ขั้นชั่งที่ "ชั่งแล้ว" เท่านั้น (M-D) — ตั้งชั่งแต่ยังไม่มีน้ำหนักเลย = ยังไม่ถึงขั้นชั่ง
      if (s.weigh_required === true && s.status !== "skipped" && (wIn !== null || wOut !== null)) part.hasWeighStage = true;
      // น้ำหนักล่าสุด: ขั้นไม่ข้าม seq สูงสุดที่มีน้ำหนัก (เรียงตาม seq จาก query → ตัวหลังชนะ) — pre-check เท่านั้น
      if (s.status !== "skipped" && (wIn !== null || wOut !== null)) {
        const added = typeof s.metal_added_g === "number" ? s.metal_added_g : 0;
        part.latestWeightG = wOut ?? (wIn as number) + added;
      }
      if (s.status === "pending" && (part.pendingSeq === null || seq < part.pendingSeq)) {
        part.pendingSeq = seq;
        part.pendingStageName = name;
        part.pendingStageCode = code;
        part.pendingWeighRequired = s.weigh_required === true;
        pendingId.set(jobId, id);
      }
      if (s.status === "sent" || s.status === "skipped") part.passedStages.push(name);
    }
    // L-2: ขั้นรอรับที่ถูกล็อก (ทอง รับไม่ครบ ชั่งไม่ตรงครบ 3 ครั้ง) — นับจาก event weigh/handoff_mismatch partial ที่ DB บันทึก · อ่านไม่ได้ = ไม่แสดงป้ายล็อก (ไม่พังหน้า)
    if (pendingId.size > 0) {
      try {
        const ev = await db().from("job_event").select("job_id, job_stage_id, payload").eq("shop_id", shop).in("job_id", [...pendingId.keys()]).eq("event_type", "weigh").limit(400);
        if (ev.error) throw ev.error;
        const strikes = new Map<string, number>();
        for (const e of rows(ev.data)) {
          const p = e.payload as { kind?: unknown; partial?: unknown } | null;
          const sid = typeof e.job_stage_id === "string" ? e.job_stage_id : null;
          if (sid && p && p.kind === "handoff_mismatch" && (p.partial === true || p.partial === "true")) strikes.set(sid, (strikes.get(sid) ?? 0) + 1);
        }
        for (const [jid, sid] of pendingId) {
          const part = byJob.get(jid);
          if (part && (strikes.get(sid) ?? 0) >= RECEIVE_LOCK_STRIKES) part.receiveLocked = true;
        }
      } catch (err) {
        logJobFailure("loadJobLots.lock", err);
      }
    }
    // จำนวนที่คาดว่าจะได้รับ (ช่อง "ได้รับจริงกี่ชิ้น" ของออฟฟิศ): ขั้นก่อนที่ไม่ข้าม — ส่งแล้ว = qty_out · ถืออยู่ = qty_in · ไม่มีขั้นก่อน = จำนวนของส่วน · หักส่วนต่างที่ยังนับอยู่ (ไม่ถูก void)
    const voided = new Set(discRows.map((d) => (typeof d.void_of_id === "string" ? d.void_of_id : null)).filter((x): x is string => x !== null));
    for (const [jid, pid] of pendingId) {
      const part = byJob.get(jid);
      if (!part || part.pendingSeq === null) continue;
      const prev = (stagesOf.get(jid) ?? []).filter((x) => x.seq < (part.pendingSeq as number) && x.status !== "skipped").sort((a, b) => b.seq - a.seq)[0];
      if (!prev) {
        part.pendingQtyExpected = part.qtyPlanned;
        continue;
      }
      const base = prev.status === "received" ? prev.qtyIn : prev.qtyOut;
      if (base === null) continue;
      const gap = discRows
        .filter((d) => d.from_stage_id === prev.id && d.to_stage_id === pid && (d.status === "open" || d.status === "resolved") && typeof d.id === "string" && !voided.has(d.id))
        .reduce((n, d) => n + (typeof d.qty === "number" ? d.qty : 0), 0);
      part.pendingQtyExpected = base - gap;
    }
    const labelByJob = Object.fromEntries(parts.map((p) => [p.jobId, p.label]));
    const discrepancies = discRows.map((r) => mapDiscrepancy(r, { stageById, labelByJob })).filter((d): d is NonNullable<typeof d> => d !== null);
    const summary = sumRes.data ? mapLotsSummary(sumRes.data as unknown as Record<string, unknown>) : null;
    const treeLoss: TreeStageLoss[] | undefined = lossRes.data ? rows(lossRes.data).map(mapTreeStageLoss).filter((l): l is TreeStageLoss => l !== null) : undefined;
    return { parts, summary, discrepancies, ...(treeLoss ? { treeLoss } : {}) };
  } catch (err) {
    logJobFailure("loadJobLots", err);
    return null;
  }
}

/** ใบนี้เป็นส่วนย่อยไหม — คืน id ใบแม่ (ส่วนย่อยเท่านั้น) · ไม่ใช่/อ่านไม่ได้ = null */
export async function findLotRoot(jobId: string): Promise<string | null> {
  try {
    const { data, error } = await db().from("v_job_tree").select("job_id, root_job_id, parent_job_id").eq("shop_id", shopId()).eq("job_id", jobId).maybeSingle();
    if (error) throw error;
    const r = data as { root_job_id?: unknown; parent_job_id?: unknown } | null;
    return r && typeof r.parent_job_id === "string" && typeof r.root_job_id === "string" && r.root_job_id !== jobId ? r.root_job_id : null;
  } catch (err) {
    logJobFailure("findLotRoot", err);
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
