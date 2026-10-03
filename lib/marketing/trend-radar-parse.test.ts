// lib/marketing/trend-radar-parse.test.ts
//
// Pure in-memory tests, no fetch/network/Supabase involved at all — this
// module takes plain strings in, plain objects out. Fixtures below are
// copied VERBATIM from the real files on disk
// (docs/3j-jewelry/marketing/trend-radar/2026-09-23.md and -27.md as they
// existed 4 ต.ค. 69), not hand-simplified — the brief's own template
// ("### [ชื่อมุม]", "**ประเภท**: value") turned out not to match what the
// task actually wrote on the one real day with an angle (23 ก.ย.), so
// testing against the brief's example instead of the real file would have
// proven nothing.

import { describe, expect, it } from "vitest";
import { extractDateFromFilename, parseTrendRadarDay } from "./trend-radar-parse";

const NOTHING_NEW_FIXTURE = `# Trend Radar — 27 ก.ย. 2569
> วัตถุดิบ ไม่ใช่ content · ห้ามแทรกทับปฏิทิน (\`content-calendar/2026-10.md\` ครอบกินเจ/10.10/ออกพรรษาไว้แล้ว)

## วันนี้ไม่มีอะไรใหม่

ไม่มีมุมไหนผ่านครบ 3 ข้อ: ทำได้ใน 7 วันด้วยของที่มี + มีเหตุผลผูกกับวันที่ + แหล่งอ้างอิงเป็นกลางและมีวันที่

## วันสำคัญใน 14 วันข้างหน้า (27 ก.ย. – 11 ต.ค.)
| วันที่ | เรื่อง | เกี่ยวกับเรายังไง |
|---|---|---|
| 30 ก.ย. – 1 ต.ค. | สิ้นเดือน | ไม่ใช่ช่วงเงินเดือน |

## ที่ตัดทิ้งวันนี้ + เหตุผล
- **ราคาเงินโลก** — ติดมติห้าม broadcast ราคาเงินอยู่แล้ว

## ⚠️ ต้องให้เจ้าของยืนยันก่อนใช้
- ค้างจาก 23 ก.ย.: มีแหวน/กำไล "เส้นเล็ก + เส้นหนา" ให้ใส่ซ้อนในไลฟ์ได้จริงไหม
- (ถ้าอยากให้เรดาร์พิจารณาครั้งหน้า) มีชิ้นผิวทุบ/รมดำ หรือชิ้นลายพระจันทร์ในสต็อกไหม

> หมายเหตุ ops: researcher รอบนี้ใช้เวลา ~6 ชม.
`;

const ONE_ANGLE_FIXTURE = `# Trend Radar — 23 ก.ย. 2569
> วัตถุดิบที่ผ่านด่านข้อเท็จจริงแล้ว ไม่ใช่ content · ห้ามแทรกทับปฏิทิน

## วันสำคัญใน 14 วันข้างหน้า (24 ก.ย. – 7 ต.ค.)
| วันที่ | เรื่อง | เกี่ยวกับเรายังไง |
|---|---|---|
| ศ 25 ก.ย. | ไหว้พระจันทร์ | อ่อน |

## มุมที่หยิบไปทำได้เลย (1 ข้อ)
**1. สาธิตใส่เงินซ้อน 2–3 ชิ้นในไลฟ์ (เส้นเล็กคู่เส้นหนา)**
- **ประเภท:** drive_live
- **ทำไมตอนนี้:** เทรนด์ AW26 ที่เผยแพร่ 11 ก.ย. 69 ชู "ใส่ซ้อนแบบคัด 2–3 ชิ้น" แทนใส่เต็มแขน
- **ต้องมีอะไรถึงถ่ายได้:** แหวน/กำไลเงินที่มีอยู่ ≥1 ชิ้นเส้นเล็ก + ≥1 ชิ้นเส้นหนา
- **แหล่งอ้างอิง:** [FLO London AW26](https://www.flolondon.co.uk/all-posts/the-aw26-jewellery-edit) (11 ก.ย. 69 · ความมั่นใจกลาง · ตรวจเองแล้ว) · [Who What Wear](https://www.whowhatwear.com/fashion/fall-winter-jewelry-trends-2026) (ความมั่นใจกลาง · ยังไม่ได้ตรวจเอง)
- **ด่าน:** ข้อเท็จจริง ✅ (อ้างแค่ "เทรนด์ต่างประเทศ" ไม่มีตัวเลข) · กฎแบรนด์ ✅ (ไม่มีราคา ไม่เทียบราคาเงิน) · ความเสี่ยง ✅
- ⚠️ ห้ามพูดว่า "ฮิตในไทย" เพราะแหล่งเป็นแฟชั่นอังกฤษ/สหรัฐฯ ไม่มีข้อมูลตลาดไทยรองรับ

## ที่ตัดทิ้งวันนี้ + เหตุผล
- **ราคาเงินโลก** — ตัวเลขที่ได้มาขัดกันเอง

## ⚠️ ต้องให้เจ้าของยืนยันก่อนใช้
- มุม 1: ร้านมีแหวน/กำไลที่คู่ "เส้นเล็ก + เส้นหนา" ได้จริงในไลฟ์ไหม (ถ้าไม่มี = ตัดทิ้ง)
- วันออกพรรษา: researcher ให้เป็น 26 ต.ค. ตรงกับปฏิทิน ต.ค. แต่แหล่งอ้างอิงยังไม่ได้ตรวจเอง
`;

describe("extractDateFromFilename", () => {
  it("extracts the date from a well-formed trend-radar filename", () => {
    expect(extractDateFromFilename("2026-09-29.md")).toBe("2026-09-29");
  });

  it("returns null for anything not shaped like YYYY-MM-DD.md", () => {
    expect(extractDateFromFilename("README.md")).toBeNull();
    expect(extractDateFromFilename("2026-09-29.txt")).toBeNull();
    expect(extractDateFromFilename("2026-9-29.md")).toBeNull();
    expect(extractDateFromFilename("not-a-date.md")).toBeNull();
  });
});

describe("parseTrendRadarDay — 'วันนี้ไม่มีอะไรใหม่' day (real fixture, 27 ก.ย. 69)", () => {
  const day = parseTrendRadarDay("2026-09-27", NOTHING_NEW_FIXTURE);

  it("parses ok, hasNothing true, zero angles", () => {
    expect(day.parseOk).toBe(true);
    expect(day.hasNothing).toBe(true);
    expect(day.angles).toEqual([]);
    expect(day.date).toBe("2026-09-27");
  });

  it("still extracts pendingQuestions even on a 'nothing new' day", () => {
    expect(day.pendingQuestions).toEqual([
      'ค้างจาก 23 ก.ย.: มีแหวน/กำไล "เส้นเล็ก + เส้นหนา" ให้ใส่ซ้อนในไลฟ์ได้จริงไหม',
      "(ถ้าอยากให้เรดาร์พิจารณาครั้งหน้า) มีชิ้นผิวทุบ/รมดำ หรือชิ้นลายพระจันทร์ในสต็อกไหม",
    ]);
  });

  it("keeps the full raw markdown regardless of parseOk", () => {
    expect(day.rawMarkdown).toBe(NOTHING_NEW_FIXTURE);
  });
});

describe("parseTrendRadarDay — day with a real angle (real fixture, 23 ก.ย. 69)", () => {
  const day = parseTrendRadarDay("2026-09-23", ONE_ANGLE_FIXTURE);

  it("parses ok, hasNothing false, exactly 1 angle", () => {
    expect(day.parseOk).toBe(true);
    expect(day.hasNothing).toBe(false);
    expect(day.angles).toHaveLength(1);
  });

  it("extracts every typed field of the angle correctly", () => {
    const [angle] = day.angles;
    expect(angle.title).toBe("สาธิตใส่เงินซ้อน 2–3 ชิ้นในไลฟ์ (เส้นเล็กคู่เส้นหนา)");
    expect(angle.contentTypeCode).toBe("drive_live");
    expect(angle.whyNow).toContain("เทรนด์ AW26");
    expect(angle.needs).toContain("≥1 ชิ้นเส้นเล็ก");
    // First link only — the field cites two sources, type carries one URL.
    expect(angle.sourceUrl).toBe("https://www.flolondon.co.uk/all-posts/the-aw26-jewellery-edit");
    expect(angle.confidence).toBe("กลาง");
  });

  it("drops the unrecognized '- ⚠️ ห้ามพูดว่า...' caveat line without breaking the angle", () => {
    // No field on TrendAngle carries this text; this test's real purpose is
    // that the line above didn't throw or corrupt neighboring fields.
    const [angle] = day.angles;
    expect(angle.confidence).toBe("กลาง"); // field set BEFORE the caveat line is untouched by it
  });

  it("extracts pendingQuestions for this day too", () => {
    expect(day.pendingQuestions).toHaveLength(2);
    expect(day.pendingQuestions[0]).toContain("เส้นเล็ก + เส้นหนา");
  });
});

describe("parseTrendRadarDay — tolerates the brief's alternate template shape", () => {
  // The brief's own example uses "### Title" + "**label**: value" (colon
  // OUTSIDE the bold) instead of the real files' "**N. Title**" +
  // "**label:** value" (colon inside). Both must parse to the same result.
  const altShapeFixture = `## มุมที่หยิบไปทำได้เลย
### ไอเดียทดสอบ
- **ประเภท**: knowledge
- **ทำไมตอนนี้**: เหตุผลทดสอบ
- **ต้องมีอะไรถึงถ่ายได้**: อุปกรณ์ทดสอบ
- **แหล่งอ้างอิง**: [Example](https://example.com/a) · ความมั่นใจ: สูง
`;
  const day = parseTrendRadarDay("2026-10-01", altShapeFixture);

  it("parses the alternate shape just as successfully as the real one", () => {
    expect(day.parseOk).toBe(true);
    expect(day.angles).toHaveLength(1);
    const [angle] = day.angles;
    expect(angle.title).toBe("ไอเดียทดสอบ");
    expect(angle.contentTypeCode).toBe("knowledge");
    expect(angle.whyNow).toBe("เหตุผลทดสอบ");
    expect(angle.needs).toBe("อุปกรณ์ทดสอบ");
    expect(angle.sourceUrl).toBe("https://example.com/a");
    expect(angle.confidence).toBe("สูง");
  });
});

describe("parseTrendRadarDay — an unmapped 'ประเภท' value never gets guessed into a code", () => {
  const fixture = `## มุมที่หยิบไปทำได้เลย
**1. ไอเดีย**
- **ประเภท:** เทศกาล
- **ทำไมตอนนี้:** x
`;
  const day = parseTrendRadarDay("2026-10-01", fixture);

  it("contentTypeCode is null, not a guessed/closest value", () => {
    expect(day.angles).toHaveLength(1);
    expect(day.angles[0].contentTypeCode).toBeNull();
  });
});

describe("parseTrendRadarDay — malformed/unexpected markdown must fall back, never throw", () => {
  it("a file with neither 'วันนี้ไม่มีอะไรใหม่' nor a parseable angles section -> parseOk false, rawMarkdown intact", () => {
    const garbled = "# Trend Radar — ??\n\nเนื้อหาที่ไม่ตรงรูปแบบที่คาดไว้เลย ไม่มีหัวข้อ ## ที่รู้จักสักหัวข้อ\n";
    const day = parseTrendRadarDay("2026-10-02", garbled);
    expect(day.parseOk).toBe(false);
    expect(day.hasNothing).toBe(false);
    expect(day.angles).toEqual([]);
    expect(day.rawMarkdown).toBe(garbled);
  });

  it("a 'มุมที่หยิบไปทำได้เลย' heading present but body has no parseable angle -> parseOk false (not 'zero angles today')", () => {
    const garbled = `## มุมที่หยิบไปทำได้เลย (1 ข้อ)
เขียนมาเป็นพารากราฟยาวๆ ไม่มีบรรทัดตัวหนาเดี่ยวๆ เป็นหัวข้อมุมเลย แค่ร้อยแก้ว
`;
    const day = parseTrendRadarDay("2026-10-03", garbled);
    expect(day.parseOk).toBe(false);
    expect(day.angles).toEqual([]);
    expect(day.rawMarkdown).toBe(garbled);
  });

  it("an entirely empty file -> parseOk false, no throw", () => {
    const day = parseTrendRadarDay("2026-10-04", "");
    expect(day.parseOk).toBe(false);
    expect(day.rawMarkdown).toBe("");
  });

  it("CRLF line endings parse identically to LF (Windows-authored file safety)", () => {
    const crlf = NOTHING_NEW_FIXTURE.replace(/\n/g, "\r\n");
    const day = parseTrendRadarDay("2026-09-27", crlf);
    expect(day.parseOk).toBe(true);
    expect(day.hasNothing).toBe(true);
    // rawMarkdown is returned verbatim (CRLF intact) — only the SPLITTING
    // logic normalizes line endings, not the stored raw text.
    expect(day.rawMarkdown).toBe(crlf);
  });
});

describe("parseTrendRadarDay — MAX_LINE_CHARS bounds per-line regex cost (Fix 3)", () => {
  it("a field value far longer than 4000 chars still parses quickly and successfully", () => {
    const hugeValue = "x".repeat(50_000);
    const fixture = `## มุมที่หยิบไปทำได้เลย\n**1. ไอเดีย**\n- **ทำไมตอนนี้:** ${hugeValue}\n`;

    const start = Date.now();
    const day = parseTrendRadarDay("2026-10-04", fixture);
    const elapsedMs = Date.now() - start;

    expect(day.parseOk).toBe(true);
    expect(day.angles).toHaveLength(1);
    // Generous ceiling, not a precise perf budget — this test exists to
    // catch an actual hang/regression, not to pin exact timing.
    expect(elapsedMs).toBeLessThan(1000);
  });

  it("the oversized value is truncated before parsing, but rawMarkdown keeps the full line intact", () => {
    const hugeValue = "y".repeat(50_000);
    const fixture = `## มุมที่หยิบไปทำได้เลย\n**1. ไอเดีย**\n- **ทำไมตอนนี้:** ${hugeValue}\n`;
    const day = parseTrendRadarDay("2026-10-04", fixture);

    expect(day.angles).toHaveLength(1);
    expect(day.angles[0].whyNow?.length).toBeLessThanOrEqual(4000);
    // The fallback/display copy must never lose data to this cap — only the
    // structured-field extraction is bounded.
    expect(day.rawMarkdown).toBe(fixture);
    expect(day.rawMarkdown.length).toBeGreaterThan(50_000);
  });

  it("a line with no closing '**' at all still returns quickly and is dropped as an unrecognized bullet, not thrown", () => {
    const adversarial = "- **" + "a ".repeat(20_000); // deliberately never closes the bold marker
    const fixture = `## มุมที่หยิบไปทำได้เลย\n**1. ไอเดีย**\n${adversarial}\n`;

    const start = Date.now();
    const day = parseTrendRadarDay("2026-10-04", fixture);
    const elapsedMs = Date.now() - start;

    expect(elapsedMs).toBeLessThan(1000);
    expect(day.parseOk).toBe(true);
    expect(day.angles).toHaveLength(1);
  });

  it("a line exactly at the cap (4000 chars) is untouched — boundary is 'over', not 'at'", () => {
    const valueAt4000 = "z".repeat(4000 - "- **ทำไมตอนนี้:** ".length);
    const fixture = `## มุมที่หยิบไปทำได้เลย\n**1. ไอเดีย**\n- **ทำไมตอนนี้:** ${valueAt4000}\n`;
    const day = parseTrendRadarDay("2026-10-04", fixture);

    expect(day.angles[0].whyNow).toBe(valueAt4000);
  });
});
