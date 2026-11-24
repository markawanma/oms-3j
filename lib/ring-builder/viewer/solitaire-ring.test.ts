// solitaire-ring.test.ts — ด่านหลักของพอร์ต buildSolitaireRing (แบบที่ 8 · design-ring-showcase-multi.md §15.4)
// golden รันจาก "ต้นฉบับ" docs/3j-jewelry/cad/trinity-ring-preview.html (SOLITAIRE บรรทัด 1056–1073 · buildSolitaireRing บรรทัด 1077–1230 ณ commit 695d4f2/c6d0453, 24 พ.ย. 69)
// โดยดึงข้อความฟังก์ชันจาก HTML มารันด้วย node (ไม่ใช่รันจากไฟล์พอร์ต) แล้วคำนวณสูตรเดียวกับ checksums() ใน row-ring.test.ts
// 🔴 ห้ามแก้ golden ให้ตรงโค้ด — ต่าง = กลับไปเทียบต้นฉบับ
import { describe, expect, it } from "vitest";
import { SOLITAIRE, buildSolitaireRing } from "./solitaire-ring";
import { computeCameraFrame } from "./bypass-ring";
import { clearShowcaseRingCache, getShowcaseRing } from "./showcase-rings";

const GOLDEN = {
  gems: 1,
  metalV: 2416,
  metalIdx: 14016,
  totalV: 2704,
  posChk: 252844.085,
  idxSum: 16580256,
  gemV: 288,
  gemIdx: 288,
  gemPos: 178036.391,
  gemIdxSum: 41328,
  gemCenterY: 12.71, // = girdleRadius Rg
  gemRadius: 2,
  span: 24.56,
  cy: 2.83,
};

function checksum(m: { pos: Float32Array; idx: Uint16Array }) {
  let pos = 0;
  for (let i = 0; i < m.pos.length; i++) pos += m.pos[i] * ((i % 97) + 1);
  let idx = 0;
  for (let i = 0; i < m.idx.length; i++) idx += m.idx[i];
  return { pos, idx };
}

describe("buildSolitaireRing — golden จากต้นฉบับ", () => {
  it("เม็ด/จุด/ดัชนี/checksum ของโลหะและพลอยตรงต้นฉบับ", () => {
    const ring = buildSolitaireRing(SOLITAIRE);
    expect(ring.gems).toHaveLength(GOLDEN.gems);
    expect(ring.metal.pos.length / 3).toBe(GOLDEN.metalV);
    expect(ring.metal.idx.length).toBe(GOLDEN.metalIdx);
    expect(ring.vertexCount).toBe(GOLDEN.totalV);
    const m = checksum(ring.metal);
    expect(m.pos.toFixed(3)).toBe(GOLDEN.posChk.toFixed(3));
    expect(m.idx).toBe(GOLDEN.idxSum);
    const g = ring.gems[0];
    expect(g.mesh.pos.length / 3).toBe(GOLDEN.gemV);
    expect(g.mesh.idx.length).toBe(GOLDEN.gemIdx);
    const gc = checksum(g.mesh);
    expect(gc.pos.toFixed(3)).toBe(GOLDEN.gemPos.toFixed(3));
    expect(gc.idx).toBe(GOLDEN.gemIdxSum);
    expect(g.radiusMm).toBe(GOLDEN.gemRadius);
    expect(g.center[0]).toBe(0);
    expect(g.center[1]).toBeCloseTo(GOLDEN.gemCenterY, 6);
    expect(g.center[2]).toBe(0);
    expect(g.normal).toEqual([0, 1, 0]);
  });

  it("frame (span/cy) = สูตร rebuild() ของต้นฉบับ · เท่ากับ computeCameraFrame(girdle=Rg)", () => {
    const ring = buildSolitaireRing(SOLITAIRE);
    expect(ring.frame.span).toBeCloseTo(GOLDEN.span, 6);
    expect(ring.frame.cy).toBeCloseTo(GOLDEN.cy, 6);
    expect(ring.frame).toEqual(computeCameraFrame(ring.gems, { innerDiaMm: SOLITAIRE.innerDiaMm, stoneMm: SOLITAIRE.stoneMm, girdleRadiusMm: ring.gems[0].center[1] }));
  });

  it("Z8 budget — metal V < 65536 (Uint16 ไม่ wrap) · รวม < 60k · ตามสเปก ~2.7k", () => {
    const ring = buildSolitaireRing(SOLITAIRE);
    expect(ring.metal.pos.length / 3).toBeLessThan(65536);
    expect(ring.vertexCount).toBeLessThan(60000);
    expect(ring.vertexCount).toBeGreaterThan(2500);
    expect(ring.vertexCount).toBeLessThan(3000);
  });

  it("mesh ไม่มี NaN/Infinity · ดัชนีไม่หลุด · เฟรมกล้องใช้ได้", () => {
    const ring = buildSolitaireRing(SOLITAIRE);
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

  it("deterministic (สองรอบ checksum เท่ากัน) · ไม่ mutate SOLITAIRE", () => {
    const before = JSON.stringify(SOLITAIRE);
    expect(checksum(buildSolitaireRing(SOLITAIRE).metal)).toEqual(checksum(buildSolitaireRing(SOLITAIRE).metal));
    expect(JSON.stringify(SOLITAIRE)).toBe(before);
  });

  it("Z17: ผลลัพธ์ไม่มี info / notes / params (หมายเหตุช่าง-ค่าประมาณห้ามถึงลูกค้า)", () => {
    const ring = buildSolitaireRing(SOLITAIRE) as unknown as Record<string, unknown>;
    expect(Object.keys(ring).sort()).toEqual(["frame", "gems", "metal", "vertexCount"]);
  });
});

describe("getShowcaseRing('solitaire')", () => {
  it("คืนวงเม็ดเดียว · cache คืนก้อนเดิม · ผลเท่า buildSolitaireRing(SOLITAIRE)", () => {
    clearShowcaseRingCache();
    const a = getShowcaseRing("solitaire");
    expect(getShowcaseRing("solitaire")).toBe(a);
    expect(a.gems).toHaveLength(1);
    expect(a.vertexCount).toBe(GOLDEN.totalV);
  });
});
