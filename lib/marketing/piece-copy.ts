// lib/marketing/piece-copy.ts — ประกอบข้อความ "คัดลอกทั้งก้อน" ของชิ้นงาน (storyboard + แคปชัน + CTA ตามลำดับ)
// และอ่านโครง clip_brief แบบทนข้อมูลไม่ครบ (AI ร่างอาจขาดบางช่อง — renderer ต้องไม่ throw)
//
// Pure — ห้ามประกอบแคปชันจาก segments (§4 preflight 2): แคปชัน = content_body ของ artifact เท่านั้น
// preflight Q1b (9 ต.ค. 69): content_body ของ short_form_clip 13/13 แถวที่มีค่า = ข้อความแคปชัน (8 แถวมี #แฮชแท็ก, 1 แถวขึ้นต้น "แคปชัน #15")
// → ใช้เป็นแคปชันได้ · ไม่มีค่า = "ยังไม่มีแคปชัน"

import { CTA_TYPE_LABEL } from "@/lib/marketing/clip-brief";
import type { ClipBrief, ClipCtaType, ClipSegmentRole, ClipShot } from "@/lib/marketing/clip-brief";

export const SEGMENT_ROLE_TH: Record<ClipSegmentRole, string> = {
  hook: "เปิดเรื่อง",
  body: "เนื้อหา",
  close: "ปิดท้าย",
};

export interface SegmentView {
  role: ClipSegmentRole;
  line: string;
  durationSec: number | null;
  shotRef: string;
}

export interface ShotView {
  id: string;
  desc: string;
  done: boolean;
  refRole: ClipSegmentRole | null;
}

const ROLES: ClipSegmentRole[] = ["hook", "body", "close"];

export function readSegments(brief: ClipBrief | null | undefined): SegmentView[] {
  const segs = Array.isArray(brief?.segments) ? brief!.segments : [];
  const out: SegmentView[] = [];
  for (const role of ROLES) {
    const s = segs.find((x) => x && x.role === role);
    if (!s) continue;
    const line = typeof s.line === "string" ? s.line.trim() : "";
    if (!line) continue;
    out.push({
      role,
      line,
      durationSec: typeof s.duration_sec === "number" && Number.isFinite(s.duration_sec) ? s.duration_sec : null,
      shotRef: typeof s.shot === "string" ? s.shot : "",
    });
  }
  return out;
}

export function readShots(brief: ClipBrief | null | undefined): ShotView[] {
  const shots: ClipShot[] = Array.isArray(brief?.shots) ? brief!.shots : [];
  return shots
    .filter((s) => s && typeof s.id === "string" && s.id !== "")
    .map((s) => ({
      id: s.id,
      desc: typeof s.desc === "string" ? s.desc : "",
      done: s.done === true,
      refRole: s.ref_role && ROLES.includes(s.ref_role) ? s.ref_role : null,
    }));
}

export function readCta(brief: ClipBrief | null | undefined): { typeLabel: string; label: string; type: ClipCtaType } | null {
  const cta = brief?.cta;
  if (!cta || typeof cta !== "object") return null;
  const type = (cta.type in CTA_TYPE_LABEL ? cta.type : "none") as ClipCtaType;
  if (type === "none" && !cta.label) return null;
  return { type, typeLabel: CTA_TYPE_LABEL[type], label: typeof cta.label === "string" ? cta.label : "" };
}

/** แคปชันของคลิป = content_body (ไม่ประกอบจาก segments) — ว่าง/มีแต่ช่องว่าง = null */
export function readCaption(contentBody: string | null | undefined): string | null {
  const t = (contentBody ?? "").trim();
  return t ? t : null;
}

/** ข้อความ storyboard ล้วน (บทพูด + ช็อต) สำหรับคัดลอก */
export function buildStoryboardText(brief: ClipBrief | null | undefined): string {
  const lines: string[] = [];
  const segments = readSegments(brief);
  if (segments.length > 0) {
    lines.push("บทพูด");
    for (const s of segments) {
      lines.push(`- ${SEGMENT_ROLE_TH[s.role]}${s.durationSec !== null ? ` (${s.durationSec} วิ)` : ""}: ${s.line}`);
    }
  }
  const shots = readShots(brief);
  if (shots.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("ช็อต");
    shots.forEach((s, i) => lines.push(`${i + 1}. ${s.desc}`));
  }
  return lines.join("\n");
}

/** คัดลอกทั้งก้อน: storyboard → แคปชัน → CTA ตามลำดับ (ชิ้นที่ไม่ใช่คลิป = content_body ทั้งก้อน) */
export function buildFullCopy(input: {
  isClip: boolean;
  clipBrief: ClipBrief | null | undefined;
  contentBody: string | null | undefined;
}): string {
  const caption = readCaption(input.contentBody);
  if (!input.isClip) return caption ?? "";
  const parts: string[] = [];
  const board = buildStoryboardText(input.clipBrief);
  if (board) parts.push(board);
  if (caption) parts.push(`แคปชัน\n${caption}`);
  const cta = readCta(input.clipBrief);
  if (cta) parts.push(`CTA: ${cta.typeLabel}${cta.label ? ` — ${cta.label}` : ""}`);
  return parts.join("\n\n");
}
