// row-ring.test.ts — ด่านหลักของพอร์ต buildRowRing: golden checksum รันจากต้นฉบับ trinity-ring-preview.html (18 พ.ย. 69 · design-ring-showcase-multi.md §2)
// 🔴 ห้ามแก้ golden ให้ตรงโค้ด — ต่าง = กลับไปเทียบต้นฉบับ
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildBypassRing } from "./bypass-ring";
import { ROW_PRESETS, ROW_PRESET_IDS, type RowDesignId } from "./row-presets";
import { buildRowRing } from "./row-ring";
import { SHOWCASE_RING_IDS, clearShowcaseRingCache, getShowcaseRing, mainIndexes } from "./showcase-rings";

const GOLDEN: Record<RowDesignId, { gems: number; metalV: number; metalIdx: number; totalV: number; posChk: number; idxSum: number; midX: number }> = {
  trinity: { gems: 3, metalV: 7488, metalIdx: 44256, totalV: 8352, posChk: 414746.25, idxSum: 163474320, midX: 0 },
  scroll6: { gems: 6, metalV: 14028, metalIdx: 79752, totalV: 15756, posChk: 3100249.738, idxSum: 540473604, midX: 1.65 },
  channel4: { gems: 4, metalV: 8792, metalIdx: 52284, totalV: 9944, posChk: 177311.061, idxSum: 230583280, midX: 1.3 },
  channel6: { gems: 6, metalV: 8792, metalIdx: 52284, totalV: 10520, posChk: 169289.754, idxSum: 230583280, midX: 1.07 },
  bar7: { gems: 7, metalV: 8476, metalIdx: 47280, totalV: 10492, posChk: 713050.048, idxSum: 188699952, midX: 0 },
  small7: { gems: 7, metalV: 9786, metalIdx: 51696, totalV: 11802, posChk: 1466293.708, idxSum: 230753244, midX: 0 },
};

function checksums(metal: { pos: Float32Array; idx: Uint16Array }) {
  let posChk = 0;
  for (let i = 0; i < metal.pos.length; i++) posChk += metal.pos[i] * ((i % 97) + 1);
  let idxSum = 0;
  for (let i = 0; i < metal.idx.length; i++) idxSum += metal.idx[i];
  return { posChk, idxSum };
}

describe("buildRowRing — golden จากต้นฉบับ", () => {
  for (const id of ROW_PRESET_IDS) {
    const g = GOLDEN[id];
    it(`${id}: จำนวนเม็ด/จุด/ดัชนี/checksum ตรงต้นฉบับ`, () => {
      const ring = buildRowRing(ROW_PRESETS[id]);
      expect(ring.gems).toHaveLength(g.gems);
      expect(ring.metal.pos.length / 3).toBe(g.metalV);
      expect(ring.metal.idx.length).toBe(g.metalIdx);
      expect(ring.vertexCount).toBe(g.totalV);
      const { posChk, idxSum } = checksums(ring.metal);
      expect(posChk.toFixed(3)).toBe(g.posChk.toFixed(3));
      expect(idxSum).toBe(g.idxSum);
    });

    it(`${id}: Z8 budget — metal V < 65536 (Uint16 ไม่ wrap) และรวม < 60k`, () => {
      const ring = buildRowRing(ROW_PRESETS[id]);
      expect(ring.metal.pos.length / 3).toBeLessThan(65536);
      expect(ring.vertexCount).toBeLessThan(60000);
    });

    it(`${id}: mesh ไม่มี NaN/Infinity · ดัชนีไม่หลุด · เฟรมกล้องใช้ได้`, () => {
      const ring = buildRowRing(ROW_PRESETS[id]);
      for (const m of [ring.metal, ...ring.gems.map((x) => x.mesh)]) {
        expect(m.pos.every(Number.isFinite)).toBe(true);
        expect(m.nor.every(Number.isFinite)).toBe(true);
        expect(m.pos.length).toBe(m.nor.length);
        expect(m.idx.length % 3).toBe(0);
        const nv = m.pos.length / 3;
        let maxIdx = 0;
        for (let i = 0; i < m.idx.length; i++) if (m.idx[i] > maxIdx) maxIdx = m.idx[i];
        expect(maxIdx).toBeLessThan(nv);
      }
      expect(Number.isFinite(ring.frame.span) && ring.frame.span > 0).toBe(true);
      expect(Number.isFinite(ring.frame.cy)).toBe(true);
    });

    it(`${id}: เม็ดเรียงซ้าย→ขวา และ mainIndexes ชี้เม็ดที่ |x| น้อยสุดจริง`, () => {
      const ring = buildRowRing(ROW_PRESETS[id]);
      const xs = ring.gems.map((x) => x.center[0]);
      for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1]);
      const main = mainIndexes(ring.gems.length);
      const minAbs = Math.min(...xs.map(Math.abs));
      for (const i of main) expect(Math.abs(xs[i]) - minAbs).toBeLessThan(0.01);
      expect(Math.abs(xs[main[0]])).toBeCloseTo(g.midX, 1);
    });

    it(`${id}: deterministic (สองรอบ checksum เท่ากัน)`, () => {
      expect(checksums(buildRowRing(ROW_PRESETS[id]).metal)).toEqual(checksums(buildRowRing(ROW_PRESETS[id]).metal));
    });
  }

  it("ไม่ mutate ROW_PRESETS ตอน build", () => {
    const before = JSON.stringify(ROW_PRESETS);
    for (const id of ROW_PRESET_IDS) buildRowRing(ROW_PRESETS[id]);
    expect(JSON.stringify(ROW_PRESETS)).toBe(before);
  });
});

describe("mainIndexes", () => {
  it("คี่ = 1 เม็ดกลาง · คู่ = 2 เม็ดกลาง", () => {
    expect(mainIndexes(3)).toEqual([1]);
    expect(mainIndexes(7)).toEqual([3]);
    expect(mainIndexes(4)).toEqual([1, 2]);
    expect(mainIndexes(6)).toEqual([2, 3]);
  });
  it("ค่าแปลก = [] ไม่ throw", () => {
    for (const bad of [0, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) expect(mainIndexes(bad)).toEqual([]);
  });
});

describe("getShowcaseRing", () => {
  it("คืนวงของทั้ง 7 แบบ · cache คืนก้อนเดิม", () => {
    clearShowcaseRingCache();
    expect(SHOWCASE_RING_IDS).toHaveLength(7);
    for (const id of SHOWCASE_RING_IDS) {
      const a = getShowcaseRing(id);
      expect(getShowcaseRing(id)).toBe(a);
      expect(a.gems.length).toBeGreaterThanOrEqual(3);
    }
  });
  it("ไขว้ = ผลเดียวกับ buildBypassRing() เดิม (4 เม็ด)", () => {
    const a = getShowcaseRing("bypass2");
    const b = buildBypassRing();
    expect(a.gems).toHaveLength(4);
    expect(a.vertexCount).toBe(b.vertexCount);
    expect(a.metal.pos.length).toBe(b.metal.pos.length);
  });
  it("id นอกรายการ (รวม __proto__/constructor) = throw", () => {
    for (const bad of ["", "nope", "__proto__", "constructor", "toString", "BYPASS2"]) {
      expect(() => getShowcaseRing(bad as never)).toThrow();
    }
  });
});

describe("Z7/Z9 — import graph", () => {
  function sources(): { file: string; src: string }[] {
    const out: { file: string; src: string }[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (["node_modules", ".next", ".git", ".claude", "docs"].includes(name)) continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push({ file: full.replace(/\\/g, "/"), src: readFileSync(full, "utf8") });
      }
    };
    for (const d of ["lib", "app", "components"]) {
      try {
        walk(join(process.cwd(), d));
      } catch {
        /* โฟลเดอร์ไม่มี */
      }
    }
    return out;
  }
  const importers = (re: RegExp) =>
    sources()
      .filter(({ src }) => re.test(src))
      .map(({ file }) => file.split("/").slice(-1)[0])
      .sort();

  it("row-ring ถูก import โดย showcase-rings.ts (ตัวสร้าง) และ row-presets.ts (type เท่านั้น)", () => {
    expect(importers(/from\s+["'][^"']*\/row-ring["']/)).toEqual(["row-presets.ts", "showcase-rings.ts"]);
  });
  it("row-presets ถูก import โดย showcase-rings.ts ตัวเดียว", () => {
    expect(importers(/from\s+["'][^"']*\/row-presets["']/)).toEqual(["showcase-rings.ts"]);
  });
});
