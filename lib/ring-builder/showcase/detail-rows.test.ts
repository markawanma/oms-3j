// detail-rows — แถวสรุปแหล่งเดียว (จอสรุป · ภาพบันทึกรูป · ต่อไปหน้า preview LINE) · N8 โครงเดิม · S6 ไม่มีค่าว่าง/undefined · P1d editTarget แถวเดียวต่อกลุ่ม
import { describe, expect, it } from "vitest";
import { GEM_QUIZ_STONES } from "@/lib/gem-quiz/config";
import { SHOWCASE_COPY, formatPriceThb } from "./config";
import { DESIGNS, ownSlotCount, roleMainLabel, roleSubLabel, type ShowcaseDesign } from "./designs";
import { buildShowcaseDetailRows } from "./detail-rows";
import { fillAll } from "./own-slots";
import type { ShowcaseChoice } from "./line-message";
import { CZ_SLOT } from "./quiz-link";

const STONE_A = GEM_QUIZ_STONES[0].code;
const STONE_B = GEM_QUIZ_STONES[1].code;

/** ทุก kind ของ choice ที่ใช้ได้กับแบบนั้น */
function choicesFor(d: ShowcaseDesign): ShowcaseChoice[] {
  const out: ShowcaseChoice[] = [{ kind: "direct" }, { kind: "rec", index: 2, top: STONE_A, bottom: STONE_B }];
  if (d.layout.kind === "row") {
    out.push({ kind: "direct", unpicked: true }, { kind: "ownSlots", codes: fillAll(ownSlotCount(d), STONE_A) });
    out.push({ kind: "ownSlots", codes: Array.from({ length: ownSlotCount(d) }, (_, i) => (i % 2 === 0 ? STONE_A : CZ_SLOT)) });
  } else {
    out.push({ kind: "own", top: STONE_A, bottom: CZ_SLOT });
  }
  return out;
}

describe("buildShowcaseDetailRows", () => {
  it("ไขว้ + ชุดแนะนำ: ลำดับ แบบแหวน · พลอย · หลัก · เสริม · CZ เล็ก · ไซซ์ · ราคา (เหมือนจอสรุปเดิม)", () => {
    const d = DESIGNS.find((x) => x.id === "bypass2")!;
    const rows = buildShowcaseDetailRows({ designId: "bypass2", choice: { kind: "rec", index: 1, top: STONE_A, bottom: STONE_B }, size: 56 })!;
    expect(rows.map((r) => r.label)).toEqual([
      SHOWCASE_COPY.summaryDesign,
      SHOWCASE_COPY.summaryGems,
      roleMainLabel(d),
      roleSubLabel(d),
      SHOWCASE_COPY.summaryExtraCz,
      SHOWCASE_COPY.summarySize,
      SHOWCASE_COPY.summaryPrice,
    ]);
    expect(rows.find((r) => r.label === SHOWCASE_COPY.summarySize)?.value).toBe("เบอร์ 56");
    expect(rows[rows.length - 1].value).toBe(formatPriceThb("bypass2"));
    expect(rows[0].value).toBe(d.name);
  });

  it("ไซซ์ null = 'รอแอดมินช่วยเช็ก' (ไม่ว่าง/0/undefined)", () => {
    const rows = buildShowcaseDetailRows({ designId: "trinity", choice: { kind: "direct" }, size: null })!;
    expect(rows.find((r) => r.label === SHOWCASE_COPY.summarySize)?.value).toBe(SHOWCASE_COPY.sizePending);
  });

  it("S6: ทุกแบบ × ทุก kind × ไซซ์ null/มี — ไม่มีค่าว่าง · ไม่มี undefined/null/NaN · ราคาต่อแบบมาจาก formatPriceThb แถวสุดท้าย", () => {
    for (const d of DESIGNS) {
      for (const choice of choicesFor(d)) {
        for (const size of [null, d.sizes[0]]) {
          const rows = buildShowcaseDetailRows({ designId: d.id, choice, size })!;
          expect(rows, `${d.id}/${choice.kind}`).not.toBeNull();
          for (const r of rows) {
            expect(r.label.trim()).not.toBe("");
            expect(r.value.trim(), `${d.id}/${choice.kind}/${r.label}`).not.toBe("");
            expect(`${r.label}${r.value}`).not.toMatch(/undefined|null|NaN/);
            expect(r.value).not.toBe("—"); // choice ที่ถูกต้องต้องแปลได้ครบ (— = แปลไม่ได้)
          }
          expect(rows[rows.length - 1]).toMatchObject({ label: SHOWCASE_COPY.summaryPrice, value: formatPriceThb(d.id), editTarget: null });
        }
      }
    }
  });

  it("แบบเม็ดเดี่ยว (solitaire): พลอยเม็ดเดี่ยวแถวเดียว ไม่มีหลัก/เสริม/CZ เล็ก · ราคาจาก config", () => {
    const rows = buildShowcaseDetailRows({ designId: "solitaire", choice: { kind: "ownSlots", codes: [STONE_A] }, size: null })!;
    const labels = rows.map((r) => r.label);
    expect(labels).toContain(SHOWCASE_COPY.singleStoneLabel);
    expect(labels.join("|")).not.toMatch(/หลัก|เสริม|CZ เล็ก/);
    expect(rows[rows.length - 1].value).toBe(formatPriceThb("solitaire"));
  });

  it("แถวที่ยังไม่เลือกพลอย (เลือกเอง · แบบแถว) ไม่มีแถวหลัก/เสริม", () => {
    const rows = buildShowcaseDetailRows({ designId: "channel4", choice: { kind: "direct", unpicked: true }, size: null })!;
    expect(rows.find((r) => r.label === SHOWCASE_COPY.summaryGems)?.value).toBe(SHOWCASE_COPY.gemNone);
    expect(rows.map((r) => r.label).join("|")).not.toMatch(/หลัก|เสริม/);
  });

  it("P1d editTarget: ปรากฏเฉพาะ แบบแหวน=design · พลอย=gems · ไซซ์=size อย่างละ 1 แถว · แถวย่อย/CZ เล็ก/ราคาไม่มี", () => {
    for (const d of DESIGNS) {
      for (const choice of choicesFor(d)) {
        const rows = buildShowcaseDetailRows({ designId: d.id, choice, size: null })!;
        const targets = rows.filter((r) => r.editTarget !== null);
        expect(targets.map((r) => [r.label, r.editTarget])).toEqual([
          [SHOWCASE_COPY.summaryDesign, "design"],
          [SHOWCASE_COPY.summaryGems, "gems"],
          [SHOWCASE_COPY.summarySize, "size"],
        ]);
      }
    }
  });

  it("designId นอก whitelist / input ผิดรูป = null (ไม่ fallback) · choice ผิดรูป = ค่าพลอย '—' (พฤติกรรมเดิมของจอ)", () => {
    expect(buildShowcaseDetailRows({ designId: "nope" as never, choice: { kind: "direct" }, size: null })).toBeNull();
    expect(buildShowcaseDetailRows(null as never)).toBeNull();
    const rows = buildShowcaseDetailRows({ designId: "bypass2", choice: { kind: "rec", index: 9, top: STONE_A, bottom: STONE_B }, size: null })!;
    expect(rows.find((r) => r.label === SHOWCASE_COPY.summaryGems)?.value).toBe("—");
  });

  it("S18: ไม่มีตัวเลขภายใน — มีเฉพาะราคาขายของแบบ (แถวเดียวที่มีตัวเลขเงิน)", () => {
    for (const d of DESIGNS) {
      const rows = buildShowcaseDetailRows({ designId: d.id, choice: { kind: "direct" }, size: d.sizes[0] })!;
      const withBaht = rows.filter((r) => /บาท/.test(r.value));
      expect(withBaht.map((r) => r.label)).toEqual([SHOWCASE_COPY.summaryPrice]);
    }
  });
});
