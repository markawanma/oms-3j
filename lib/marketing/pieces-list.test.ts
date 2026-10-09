import { describe, expect, it } from "vitest";
import { OPEN_STATUSES, PAGE_SIZE, cleanSearch, hasActiveFilter, ilikePattern, parsePiecesQuery, piecesHref, postedSince, sortAscending } from "./pieces-list";

const CAMPAIGN = "11111111-1111-4111-8111-111111111111";

describe("parsePiecesQuery", () => {
  it("ค่าเริ่มต้น = ยังไม่ปิด หน้า 1 ไม่มีตัวกรอง", () => {
    const q = parsePiecesQuery({});
    expect(q).toEqual({ status: "open", withPosted: false, campaign: "", channel: "", q: "", page: 1 });
    expect(hasActiveFilter(q)).toBe(false);
  });

  it("ค่านอก allowlist (สถานะ/ช่องทาง/uuid/หน้า) ถูกทิ้ง — ไม่ผ่านเข้า query", () => {
    const q = parsePiecesQuery({ status: "drop table", channel: "myspace", campaign: "x' or 1=1", page: "-4", posted: "1" });
    expect(q.status).toBe("open");
    expect(q.channel).toBe("");
    expect(q.campaign).toBe("");
    expect(q.page).toBe(1);
    expect(q.withPosted).toBe(true); // open + posted=1 ถูกต้อง
  });

  it("รับค่าถูกต้อง · หน้าเกินเพดานถูกตัด · array ใช้ค่าแรก", () => {
    const q = parsePiecesQuery({ status: ["cancelled", "idea"], channel: "tiktok", campaign: CAMPAIGN, page: "999999", q: "  แหวน  " });
    expect(q).toMatchObject({ status: "cancelled", channel: "tiktok", campaign: CAMPAIGN, page: 200, q: "แหวน", withPosted: false });
  });

  it("posted=1 มีผลเฉพาะสถานะ open", () => {
    expect(parsePiecesQuery({ status: "idea", posted: "1" }).withPosted).toBe(false);
  });
});

describe("ค้นชื่อ", () => {
  it("ตัดอักขระควบคุม/ช่องว่างซ้ำ/ความยาวเกิน", () => {
    expect(cleanSearch("a\u0000b\n\tc")).toBe("a b c");
    expect(cleanSearch("x".repeat(500))).toHaveLength(80);
  });
  it("pattern ILIKE: % _ \\ * ในคำค้นไม่กลายเป็น wildcard ของผู้ใช้", () => {
    expect(ilikePattern("100%_ok")).toBe("*100 ok*");
    expect(ilikePattern("a*b\\c")).toBe("*a b c*");
    expect(ilikePattern("แหวน")).toBe("*แหวน*");
  });
});

describe("piecesHref", () => {
  const base = parsePiecesQuery({});
  it("ไม่ใส่ค่าเริ่มต้น/ค่าว่าง · เปลี่ยนตัวกรองแล้วกลับหน้า 1", () => {
    expect(piecesHref(base)).toBe("/marketing/pieces");
    const q = parsePiecesQuery({ status: "cancelled", q: "ก", page: "3" });
    expect(piecesHref(q)).toBe("/marketing/pieces?status=cancelled&q=%E0%B8%81");
    expect(piecesHref(q, { page: 4 })).toContain("page=4");
  });
  it("round-trip: href → parse ได้ query เดิม", () => {
    const q = parsePiecesQuery({ campaign: CAMPAIGN, channel: "line_oa", q: "ไลฟ์", posted: "1", page: "2" });
    const url = new URL(`http://x${piecesHref(q, { page: 2 })}`);
    const back = parsePiecesQuery(Object.fromEntries(url.searchParams));
    expect(back).toEqual(q);
  });
  it("เปลี่ยนไปสถานะอื่นแล้ว posted=1 หายไป", () => {
    const q = parsePiecesQuery({ posted: "1" });
    expect(piecesHref(q, { status: "idea", withPosted: false })).toBe("/marketing/pieces?status=idea");
  });
});

describe("ช่วงโพสต์ / เรียง / ขนาดหน้า", () => {
  it("60 วันย้อนหลังจากวันนี้ (ไทย)", () => {
    expect(postedSince("2026-10-10")).toBe("2026-08-11");
  });
  it("ยังไม่ปิด = ใกล้ก่อน · โพสต์/ยกเลิก/รวมโพสต์ = ใหม่ก่อน", () => {
    expect(sortAscending(parsePiecesQuery({}))).toBe(true);
    expect(sortAscending(parsePiecesQuery({ status: "posted" }))).toBe(false);
    expect(sortAscending(parsePiecesQuery({ status: "cancelled" }))).toBe(false);
    expect(sortAscending(parsePiecesQuery({ posted: "1" }))).toBe(false);
  });
  it("ค่าคงที่: หน้าละ 50 · ยังไม่ปิดไม่รวม posted/cancelled", () => {
    expect(PAGE_SIZE).toBe(50);
    expect(OPEN_STATUSES).not.toContain("posted");
    expect(OPEN_STATUSES).not.toContain("cancelled");
  });
});
