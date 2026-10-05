// lib/gem-quiz/recommend.test.ts
//
// 🔴 Oracle test — design doc §4: ไล่ทุก combination ของ
// birth_day(7) × intention(6) × feeling(6) × preference(85 — เลือก 1-3 จาก
// 5 พลอย "แบบเรียงลำดับ" คือ permutation ไม่ใช่ combination เพราะอันดับที่แตะ
// มีผลต่อคะแนน) = 21,420 เคส เทียบ rankGems() (production, lib/gem-quiz/
// recommend.ts) กับ "oracle" ที่พอร์ตจาก rank() ใน design/Quiz.dc.html ของ
// แพ็กเกจเจ้าของ (docs/3j-jewelry/analytics/gem-quiz-v2-handoff/design/
// Quiz.dc.html บรรทัด ~451-557) คำต่อคำ — เขียนแยกเป็นคนละฟังก์ชัน/ไฟล์กับ
// production code โดยตั้งใจ เพื่อให้พิสูจน์ความตรงกับแพ็กเกจจริง ไม่ใช่เทียบ
// กับตัวเอง (ถ้า oracle import จาก recommend.ts/config.ts เทสต์นี้จะไม่มี
// ความหมายอะไรเลย)
//
// ลำดับต้องตรงทั้ง 5 ตำแหน่งทุกเคส — ไม่ตรงแม้เคสเดียวคือบั๊ก ต้องแก้ที่
// recommend.ts ไม่ใช่ลด scope เทสต์นี้
import { describe, expect, it } from "vitest";
import { rankGems, recommendStoneCodes } from "./recommend";
import { GEM_QUIZ_STONE_CODES } from "./config";

// ---------------------------------------------------------------------------
// Oracle — พอร์ตจาก Quiz.dc.html คำต่อคำ (ชื่อตัวแปร/ลำดับเงื่อนไข/ตัวเลข
// คะแนนทุกตัวต้องตรงกับไฟล์ต้นฉบับเป๊ะ) ห้าม import อะไรจาก recommend.ts หรือ
// config.ts มาใช้ในกลุ่มนี้เด็ดขาด
// ---------------------------------------------------------------------------
const ORACLE_IDS = ["garnet", "amethyst", "citrine", "peridot", "blue_topaz"] as const;
type OracleId = (typeof ORACLE_IDS)[number];

const ORACLE_DAYS: Record<string, { s: Partial<Record<OracleId, number>> }> = {
  sun: { s: { garnet: 3, citrine: 2 } },
  mon: { s: { amethyst: 3, blue_topaz: 2 } },
  tue: { s: { garnet: 3, peridot: 2 } },
  wed: { s: { blue_topaz: 3, peridot: 2 } },
  thu: { s: { citrine: 3, amethyst: 2 } },
  fri: { s: { peridot: 3, blue_topaz: 2 } },
  sat: { s: { amethyst: 3, garnet: 2 } },
};

const ORACLE_INTENTS: Record<string, { p: OracleId[]; s: OracleId[] }> = {
  love: { p: ["garnet", "peridot", "blue_topaz"], s: ["amethyst"] },
  wealth: { p: ["citrine", "garnet"], s: ["peridot"] },
  career: { p: ["garnet", "citrine"], s: ["blue_topaz"] },
  confidence: { p: ["garnet", "citrine"], s: ["peridot"] },
  calm: { p: ["amethyst", "blue_topaz"], s: ["peridot"] },
  renewal: { p: ["peridot", "citrine"], s: ["garnet"] },
};

const ORACLE_FEELS: Record<string, { m: OracleId[] }> = {
  energy: { m: ["garnet", "citrine"] },
  calm: { m: ["amethyst", "blue_topaz"] },
  clarity: { m: ["amethyst", "blue_topaz"] },
  renew: { m: ["peridot", "citrine"] },
  open: { m: ["peridot", "blue_topaz", "garnet"] },
  advance: { m: ["citrine", "garnet", "peridot"] },
};

interface OracleAnswers {
  day: string;
  intent: string;
  feel: string;
  prefs: string[];
}

interface OracleRow {
  id: OracleId;
  i: number;
  day: number;
  intent: number;
  feel: number;
  pref: number;
  total: number;
}

/** พอร์ตคำต่อคำจาก Component.prototype.rank() ของ Quiz.dc.html (ไม่ใช้
 * production code ของโปรเจกต์นี้แม้แต่ตัวเดียว) */
function oracleRank(a: OracleAnswers): OracleRow[] {
  const rows: OracleRow[] = ORACLE_IDS.map((id, i) => {
    const day = (ORACLE_DAYS[a.day] && ORACLE_DAYS[a.day].s[id]) || 0;
    const it = ORACLE_INTENTS[a.intent];
    const intent = it ? (it.p.indexOf(id) >= 0 ? 8 : it.s.indexOf(id) >= 0 ? 5 : 0) : 0;
    const fe = ORACLE_FEELS[a.feel];
    const feel = fe && fe.m.indexOf(id) >= 0 ? 7 : 0;
    const pi = a.prefs.indexOf(id);
    const pref = pi === 0 ? 6 : pi === 1 ? 4 : pi === 2 ? 2 : 0;
    return { id, i, day, intent, feel, pref, total: day + intent + feel + pref };
  });
  rows.sort(
    (x, y) => y.total - x.total || y.intent - x.intent || y.feel - x.feel || y.pref - x.pref || y.day - x.day || x.i - y.i
  );
  return rows;
}

/** permutations ของความยาว k จาก arr — ลำดับมีความหมาย (ไม่ใช่ combination) */
function permutations<T>(arr: readonly T[], k: number): T[][] {
  if (k === 0) return [[]];
  const result: T[][] = [];
  arr.forEach((item, idx) => {
    const rest = [...arr.slice(0, idx), ...arr.slice(idx + 1)];
    for (const rec of permutations(rest, k - 1)) result.push([item, ...rec]);
  });
  return result;
}

function allPreferenceCombos(): string[][] {
  return [1, 2, 3].flatMap((k) => permutations(ORACLE_IDS as readonly string[], k));
}

const BIRTH_DAYS = Object.keys(ORACLE_DAYS);
const INTENTIONS = Object.keys(ORACLE_INTENTS);
const FEELINGS = Object.keys(ORACLE_FEELS);
const PREFERENCE_COMBOS = allPreferenceCombos();
const TOTAL_COMBINATIONS = BIRTH_DAYS.length * INTENTIONS.length * FEELINGS.length * PREFERENCE_COMBOS.length;

describe("rankGems / recommendStoneCodes — v2 (5 พลอย)", () => {
  it("sanity: จำนวน combination ตรงกับที่ design doc ระบุ (7×6×6×85 = 21,420)", () => {
    expect(BIRTH_DAYS).toHaveLength(7);
    expect(INTENTIONS).toHaveLength(6);
    expect(FEELINGS).toHaveLength(6);
    expect(PREFERENCE_COMBOS).toHaveLength(85);
    expect(TOTAL_COMBINATIONS).toBe(21420);
  });

  it("smoke test (demo case ของ CLAUDE.md แพ็กเกจ): Garnet → Citrine → Blue Topaz ใน 3 อันดับแรก", () => {
    const ranked = rankGems({
      birthDay: "sun",
      intention: "career",
      feeling: "energy",
      likedStoneCodes: ["garnet", "citrine", "amethyst"],
    });
    expect(ranked.slice(0, 3).map((r) => r.code)).toEqual(["garnet", "citrine", "blue_topaz"]);
  });

  it("rankGems คืนครบ 5 แถวเสมอ — เป็น permutation ของ GEM_QUIZ_STONE_CODES ไม่มีซ้ำ/ไม่มีขาด", () => {
    const ranked = rankGems({ birthDay: "sun", intention: "career", feeling: "energy", likedStoneCodes: [] });
    expect(ranked).toHaveLength(5);
    expect(new Set(ranked.map((r) => r.code))).toEqual(new Set(GEM_QUIZ_STONE_CODES));
  });

  it("ค่าที่ไม่รู้จัก (birthDay/intention/feeling แปลกปลอม) ไม่ throw และยังคืนผล 5 แถว", () => {
    const ranked = rankGems({ birthDay: "not_a_day", intention: "not_real", feeling: "nope", likedStoneCodes: [] });
    expect(ranked).toHaveLength(5);
  });

  it("deterministic — เรียกซ้ำด้วยอินพุตเดียวกันได้ผลเดิมทุกครั้ง", () => {
    const input = { birthDay: "wed", intention: "calm", feeling: "clarity", likedStoneCodes: ["peridot", "garnet"] };
    const first = rankGems(input).map((r) => r.code);
    const second = rankGems(input).map((r) => r.code);
    expect(second).toEqual(first);
  });

  it("recommendStoneCodes คืน array ความยาว 1 เสมอ ตรงกับ rank 1 ของ rankGems", () => {
    const input = { birthDay: "fri", intention: "renewal", feeling: "renew", likedStoneCodes: ["peridot"] };
    expect(recommendStoneCodes(input)).toEqual([rankGems(input)[0].code]);
  });

  describe("🔴 Oracle parity — ทุก 21,420 combination ต้องตรงกับ rank() ของ Quiz.dc.html ทั้ง 5 ตำแหน่ง", () => {
    let checked = 0;
    let mismatchCount = 0;
    const mismatchSamples: string[] = [];
    const winCounts = new Map<OracleId, number>(ORACLE_IDS.map((id) => [id, 0]));

    for (const day of BIRTH_DAYS) {
      for (const intent of INTENTIONS) {
        for (const feel of FEELINGS) {
          for (const prefs of PREFERENCE_COMBOS) {
            checked += 1;
            const expected = oracleRank({ day, intent, feel, prefs }).map((r) => r.id);
            const actual = rankGems({ birthDay: day, intention: intent, feeling: feel, likedStoneCodes: prefs }).map(
              (r) => r.code
            );
            const matches = expected.length === actual.length && expected.every((id, idx) => id === actual[idx]);
            if (!matches) {
              mismatchCount += 1;
              if (mismatchSamples.length < 20) {
                mismatchSamples.push(
                  `day=${day} intent=${intent} feel=${feel} prefs=[${prefs.join(",")}] ` +
                    `expected=[${expected.join(",")}] actual=[${actual.join(",")}]`
                );
              }
            }
            winCounts.set(actual[0] as OracleId, (winCounts.get(actual[0] as OracleId) ?? 0) + 1);
          }
        }
      }
    }

    it(`ไล่ครบ ${TOTAL_COMBINATIONS} combination จริง (ไม่ใช่ sample)`, () => {
      expect(checked).toBe(TOTAL_COMBINATIONS);
    });

    it("ลำดับทั้ง 5 ตำแหน่งตรงกับ oracle ทุกเคส — ไม่ตรงแม้เคสเดียวคือบั๊ก", () => {
      expect(
        mismatchCount,
        `พบ ${mismatchCount}/${TOTAL_COMBINATIONS} เคสที่ลำดับไม่ตรง oracle (ตัวอย่างสูงสุด 20 เคส):\n${mismatchSamples.join("\n")}`
      ).toBe(0);
    });

    // รายงาน (ไม่ assert เนื้อหา — เป็นคำถามธุรกิจ ไม่ใช่บั๊ก): สัดส่วนที่แต่ละ
    // พลอยชนะอันดับ 1 จากทั้ง 21,420 combination เจ้าของจะอยากรู้ตัวเลขนี้
    it("รายงาน: สัดส่วนที่แต่ละพลอยชนะอันดับ 1 จากทั้งหมด (ข้อมูลสำหรับทีมธุรกิจ)", () => {
      const lines = ORACLE_IDS.map((id) => {
        const count = winCounts.get(id) ?? 0;
        const pct = ((count / TOTAL_COMBINATIONS) * 100).toFixed(2);
        return `  ${id}: ${count}/${TOTAL_COMBINATIONS} (${pct}%)`;
      });
      // eslint-disable-next-line no-console
      console.log(`[gem-quiz recommend v2] สัดส่วนชนะอันดับ 1 จาก ${TOTAL_COMBINATIONS} combination:\n${lines.join("\n")}`);
      const totalWins = ORACLE_IDS.reduce((sum, id) => sum + (winCounts.get(id) ?? 0), 0);
      expect(totalWins).toBe(TOTAL_COMBINATIONS); // ยืนยันว่านับครบ ไม่มีเคสหลุดนับ
    });
  });
});
