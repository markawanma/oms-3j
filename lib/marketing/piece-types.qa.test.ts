// QA (R2-D2) — mapper ของ view + piece-copy: ข้อมูลจาก DB เพี้ยน/ไม่ครบ ต้องไม่ทำให้หน้าล้ม และต้อง "fail-closed" ตรงที่เกี่ยวกับสิทธิ์
import { describe, expect, it } from "vitest";
import { mapConfirmItem, mapInboxCounts, mapPieceEvent, mapPieceRow, mapRecoRow, mapWeeklySummary, PIECE_FULL_COLUMNS, PIECE_LIGHT_COLUMNS } from "./piece-types";
import { buildFullCopy, buildStoryboardText, readCaption, readCta, readSegments, readShots } from "./piece-copy";
import type { ClipBrief } from "./clip-brief";

describe("mapPieceRow — ข้อมูลว่าง/เพี้ยน", () => {
  it("แถวว่าง {} ไม่ throw · อนุมัติไม่ได้ · ไม่มี hook/โพสต์ · ชื่อมีค่าแทน", () => {
    const p = mapPieceRow({});
    expect(p.canApprove).toBe(false);
    expect(p.hooks).toEqual([]);
    expect(p.posts).toEqual([]);
    expect(p.gates).toEqual({ factCheck: null, brandRule: null, riskOwner: null });
    expect(p.title).toBe("(ไม่มีชื่อ)");
    expect(p.confirmPending).toBe(0);
  });

  it("can_approve fail-closed: มีแต่ boolean true เท่านั้นที่เปิดปุ่ม (string/1/'t' ไม่ได้)", () => {
    for (const v of ["true", 1, "t", "yes", {}, [], null, undefined, 0, false]) {
      expect(mapPieceRow({ can_approve: v }).canApprove, String(v)).toBe(false);
    }
    expect(mapPieceRow({ can_approve: true }).canApprove).toBe(true);
  });

  it("ชนิดข้อมูลผิด (hooks เป็น string · gates เป็น array · posts มี null) ไม่ทำให้ล้ม", () => {
    const p = mapPieceRow({ hooks: "x", gates: [1], posts: [null, 5, { post_id: "p" }], clip_brief: "str", confirm_pending: "abc", days_until: "NaN" });
    expect(p.hooks).toEqual([]);
    expect(p.gates.factCheck).toBeNull();
    expect(p.posts).toHaveLength(1);
    expect(p.posts[0].status).toBe("active"); // ค่าเริ่มต้นเมื่อ DB ไม่ส่ง
    expect(p.clipBrief).toBeNull();
    expect(p.confirmPending).toBe(0);
    expect(p.daysUntil).toBeNull();
  });

  it("เลข 0 เป็นค่าจริง (ไม่ถูกทำเป็น null) · สตริงว่างเป็น null", () => {
    const p = mapPieceRow({ baseline_value: 0, pass_threshold: "0", shoot_minutes_est: 0, baseline_spread: "" });
    expect(p.baselineValue).toBe(0);
    expect(p.passThreshold).toBe(0);
    expect(p.shootMinutesEst).toBe(0);
    expect(p.baselineSpread).toBeNull();
  });

  it("effective_piece_status หาย → ใช้สถานะดิบ (ไม่ว่าง)", () => {
    expect(mapPieceRow({ piece_status: "in_review" }).effectiveStatus).toBe("in_review");
    expect(mapPieceRow({ piece_status: "posted", effective_piece_status: "measuring" }).effectiveStatus).toBe("measuring");
  });

  it("hook label นอก A/B → null (ไม่หลุดเป็นตัวอักษรอื่นบนจอ)", () => {
    const p = mapPieceRow({ hooks: [{ id: "h", label: "C", text: "x", hook_type: "question" }, { id: "h2", label: "A", text: "y" }] });
    expect(p.hooks.map((h) => h.label)).toEqual([null, "A"]);
  });

  it("🔴 ชื่อจริงโฮสต์ไม่ผ่าน mapper แม้ view จะส่งมา (display_name / expected_host_display_name)", () => {
    const p = mapPieceRow({ expected_host_id: "h1", expected_host_label: "โฮสต์ A", display_name: "สมชาย ใจดี", expected_host_display_name: "สมชาย ใจดี", host: { display_name: "สมชาย ใจดี" } });
    const json = JSON.stringify(p);
    expect(json).not.toContain("สมชาย");
    expect(json).not.toContain("display_name");
    expect(p.expectedHostLabel).toBe("โฮสต์ A");
  });

  it("วัน: date เป็น YYYY-MM-DD ตามที่ PostgREST ส่ง · ส่วนเวลาถูกตัด · ค่าสั้น/ผิดรูปไม่ throw", () => {
    expect(mapPieceRow({ resolved_start: "2026-10-13" }).resolvedStart).toBe("2026-10-13");
    expect(mapPieceRow({ resolved_start: "2026-10-13T00:00:00" }).resolvedStart).toBe("2026-10-13");
    expect(mapPieceRow({ resolved_start: null }).resolvedStart).toBeNull();
    expect(mapPieceRow({ resolved_start: 20261013 }).resolvedStart).toBeNull();
    expect(() => mapPieceRow({ resolved_start: "x" })).not.toThrow();
  });
});

describe("รายการคอลัมน์ที่ select — ไม่มีชื่อจริงโฮสต์/ต้นทุน และชุดเบาไม่มีคอลัมน์หนัก", () => {
  it("ไม่มี display_name / cost / margin ในคอลัมน์ที่ขอ", () => {
    for (const cols of [PIECE_LIGHT_COLUMNS, PIECE_FULL_COLUMNS]) {
      expect(cols).not.toMatch(/display_name|cost|margin|price/i);
      expect(cols).not.toContain("*");
    }
  });
  it("ชุดเบา (list/นับ) ไม่ดึง content_body / clip_brief (D15 — view หนัก)", () => {
    expect(PIECE_LIGHT_COLUMNS).not.toMatch(/content_body|clip_brief/);
    expect(PIECE_FULL_COLUMNS).toMatch(/content_body/);
    expect(PIECE_FULL_COLUMNS).toMatch(/clip_brief/);
  });
  it("ชุดเต็มมีคอลัมน์ที่หน้า detail ต้องใช้ทุกตัวตามภาคผนวก A (can_approve · gates · confirm_pending · confirm_marker_in_text · hooks · posts · effective_piece_status)", () => {
    for (const c of ["can_approve", "gates", "confirm_pending", "confirm_marker_in_text", "hooks", "posts", "effective_piece_status", "gates_passed", "source_signal_id"]) {
      expect(PIECE_FULL_COLUMNS, c).toContain(c);
    }
  });
});

describe("mapInboxCounts / mapRecoRow / mapWeeklySummary / event", () => {
  it("counts null → ศูนย์ทั้งหมด · review_over_limit ต้องเป็น true เป๊ะ", () => {
    expect(mapInboxCounts(null)).toEqual({ postToday: 0, postOverdueNoLink: 0, reviewQueue: 0, reviewOverLimit: false, ideas: 0, ownerQuestions: 0, shootThisWeek: 0, onHold: 0 });
    expect(mapInboxCounts({ review_over_limit: "true", review_queue: "13" }).reviewOverLimit).toBe(false);
    expect(mapInboxCounts({ review_over_limit: true, review_queue: 13 })).toMatchObject({ reviewOverLimit: true, reviewQueue: 13 });
  });
  it("reco: token ว่าง → null (ไม่สร้างเอง) · title ว่างมีค่าแทน", () => {
    const r = mapRecoRow({ item_kind: "reco", item_id: "i", effective_action: "pending" });
    expect(r.contentToken).toBeNull();
    expect(r.title).toBe("(ไม่มีหัวข้อ)");
    expect(mapRecoRow({ item_kind: "reco", content_token: "abc123" }).contentToken).toBe("abc123");
  });
  it("reco: respond_by แบบ timestamp ถูกตัดเหลือวัน · days_left=0 เป็นค่าจริง", () => {
    const r = mapRecoRow({ respond_by: "2026-10-12T00:00:00", days_left: 0 });
    expect(r.respondBy).toBe("2026-10-12");
    expect(r.daysLeft).toBe(0);
  });
  it("weekly: summary_lines ที่มีสิ่งที่ไม่ใช่ข้อความถูกกรองออก", () => {
    expect(mapWeeklySummary({ id: "w", week_start: "2026-10-05", summary_lines: ["ก", 5, null, "ข"] }).summaryLines).toEqual(["ก", "ข"]);
    expect(mapWeeklySummary({}).weekStart).toBe("");
  });
  it("event: payload ไม่ใช่ object → {} · review_seconds=0 เป็นค่าจริง", () => {
    expect(mapPieceEvent({ payload: "x", seq: "3" }).payload).toEqual({});
    expect(mapPieceEvent({ review_seconds: 0 }).reviewSeconds).toBe(0);
    expect(mapPieceEvent({ seq: "3" }).seq).toBe(3);
  });
  it("confirm item: คำถามว่างมีค่าแทน · answer null คงเป็น null", () => {
    expect(mapConfirmItem({ id: "x" }).question).toBe("(ไม่ระบุ)");
    expect(mapConfirmItem({ id: "x", answer: null }).answer).toBeNull();
  });
});

describe("piece-copy — อ่าน clip_brief ที่ AI ร่างไม่ครบ", () => {
  const brief = (b: unknown) => b as ClipBrief;

  it("brief ว่าง/null/ผิดชนิด ไม่ throw", () => {
    for (const b of [null, undefined, {}, brief({ segments: "x", shots: 5, cta: 3 })]) {
      expect(() => buildFullCopy({ isClip: true, clipBrief: b as ClipBrief, contentBody: null })).not.toThrow();
      expect(readSegments(b as ClipBrief)).toEqual([]);
      expect(readShots(b as ClipBrief)).toEqual([]);
    }
    expect(buildFullCopy({ isClip: true, clipBrief: null, contentBody: null })).toBe("");
  });

  it("segments เรียง hook→body→close เสมอ แม้ข้อมูลสลับลำดับ · บรรทัดว่างถูกข้าม · ไม่เดาแคปชันจาก segments", () => {
    const b = brief({ segments: [{ role: "close", line: "ปิด", duration_sec: 5 }, { role: "hook", line: "เปิด", duration_sec: 3 }, { role: "body", line: "   " }] });
    expect(readSegments(b).map((s) => s.role)).toEqual(["hook", "close"]);
    expect(readCaption(null)).toBeNull();
    expect(readCaption("   \n ")).toBeNull();
    const copy = buildFullCopy({ isClip: true, clipBrief: b, contentBody: null });
    expect(copy).not.toContain("แคปชัน"); // ไม่มี content_body = ไม่ประกอบแคปชันเอง
  });

  it("ช็อต: id ว่าง/ไม่ใช่ string ถูกตัดทิ้ง · done ต้อง true เป๊ะ", () => {
    const shots = readShots(brief({ shots: [{ id: "", desc: "x" }, { id: 5, desc: "y" }, { id: "s1", desc: "ok", done: "true" }, { id: "s2", done: true }, null] }));
    expect(shots.map((s) => [s.id, s.done, s.desc])).toEqual([
      ["s1", false, "ok"],
      ["s2", true, ""],
    ]);
  });

  it("คัดลอกทั้งก้อน: บทพูด → ช็อต → แคปชัน → CTA ตามลำดับ · ชิ้นที่ไม่ใช่คลิป = เนื้อหาล้วน", () => {
    const b = brief({
      segments: [{ role: "hook", line: "เปิดเรื่อง", duration_sec: 3 }],
      shots: [{ id: "s1", desc: "ภาพแรก" }],
      cta: { type: "none", label: "เตือนไลฟ์" },
    });
    const copy = buildFullCopy({ isClip: true, clipBrief: b, contentBody: "แคปชันนี้ #เงิน" });
    const iSeg = copy.indexOf("เปิดเรื่อง");
    const iShot = copy.indexOf("1. ภาพแรก");
    const iCap = copy.indexOf("แคปชัน\nแคปชันนี้");
    const iCta = copy.indexOf("CTA:");
    expect(iSeg).toBeGreaterThanOrEqual(0);
    expect(iSeg).toBeLessThan(iShot);
    expect(iShot).toBeLessThan(iCap);
    expect(iCap).toBeLessThan(iCta);
    expect(buildFullCopy({ isClip: false, clipBrief: b, contentBody: "ข้อความ LINE" })).toBe("ข้อความ LINE");
    expect(buildFullCopy({ isClip: false, clipBrief: b, contentBody: null })).toBe("");
  });

  it("CTA type แปลก → ถือเป็น none · ไม่มี label และ type none → null", () => {
    expect(readCta(brief({ cta: { type: "weird", label: "" } }))).toBeNull();
    expect(readCta(brief({ cta: { type: "weird", label: "ไปดู" } }))?.label).toBe("ไปดู");
    expect(buildStoryboardText(null)).toBe("");
  });

  it("แคปชันที่มี marker [ต้องยืนยัน] ยังอยู่ในข้อความที่คัดลอก (ไม่ถูกกรองทิ้งให้เจ้าของคัดลอกไปโดยไม่รู้)", () => {
    const copy = buildFullCopy({ isClip: true, clipBrief: null, contentBody: "ชื่อ [ต้องยืนยัน: ชื่อชิ้นที่ 1]" });
    expect(copy).toContain("[ต้องยืนยัน: ชื่อชิ้นที่ 1]");
  });
});
