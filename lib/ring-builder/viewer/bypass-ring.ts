// lib/ring-builder/viewer/bypass-ring.ts — โมเดล 3D "แหวนไขว้ พลอยไข่ 2 เม็ด" (pure · ไม่แตะ DOM/WebGL/ไลบรารีภายนอก)
//
// พอร์ตตรงตัวจาก docs/3j-jewelry/cad/trinity-ring-preview.html (BYPASS2 + buildBypassRing) — 🔴 ห้าม refactor คณิตศาสตร์:
// ลำดับการ push จุด/ดัชนี สูตร และค่าคงที่ทุกตัวต้องเท่าต้นฉบับ (ทีมเปิดเทียบกับต้นฉบับด้วยตา)
// ต่างจากต้นฉบับเฉพาะ: (1) เป็น TS (2) ตัด info/notes/spec ทิ้ง — น้ำหนัก/ค่าประมาณจากรูป/หมายเหตุช่าง ห้ามถึงลูกค้า (X6)
// (3) คืน frame {span, cy} สำหรับกล้อง (สูตรเดียวกับ rebuild() ของต้นฉบับ) แทน ring.info
//
// ค่าใน BYPASS2: ovalLong/ovalShort = เจ้าของให้ 12 พ.ย. 69 (7×5 มม.) · ค่าอื่นคือค่าประมาณจากรูปถ่ายของต้นฉบับ (ภาพจำลอง ไม่ใช่ไฟล์ผลิต)
// ตำแหน่งพลอย: gems[0] = พลอยไข่บน · gems[1] = พลอยไข่ล่าง · gems[2..3] = CZ เล็ก (ขาวตายตัว)

type V3 = number[];

export interface BypassParams {
  readonly setting: "bypass";
  readonly stoneCount: number;
  readonly innerDiaMm: number;
  readonly stoneMm: number;
  readonly ovalLongMm: number;
  readonly ovalShortMm: number;
  readonly ovalTiltDeg: number;
  readonly stoneZMm: number;
  readonly stoneXOffMm: number;
  readonly gapMm: number;
  readonly headHeightMm: number;
  readonly bandWidthMm: number;
  readonly bandWidthBackMm: number;
  readonly bandThickMm: number;
  readonly bandThickBackMm: number;
  readonly mountMm: number;
  readonly tipOffsetMm: number;
  readonly rampRad: number;
  readonly prongMm: number;
  readonly prongOverMm: number;
  readonly czMm: number;
  readonly czProngMm: number;
}

export const BYPASS2: BypassParams = {
  setting: "bypass",
  stoneCount: 2,
  innerDiaMm: 17.2,
  stoneMm: 7,
  ovalLongMm: 7,
  ovalShortMm: 5,
  ovalTiltDeg: 20,
  stoneZMm: 2.8,
  stoneXOffMm: 0.9,
  gapMm: 0.6,
  headHeightMm: 2.6,
  bandWidthMm: 3.0,
  bandWidthBackMm: 2.2,
  bandThickMm: 2.3,
  bandThickBackMm: 1.6,
  mountMm: 0.75,
  tipOffsetMm: 1.6,
  rampRad: 2.0,
  prongMm: 0.7,
  prongOverMm: 0.4,
  czMm: 1.5,
  czProngMm: 0.4,
};

export interface RingMesh {
  pos: Float32Array;
  nor: Float32Array;
  idx: Uint16Array;
}

export interface RingGem {
  center: number[];
  normal: number[];
  radiusMm: number;
  mesh: RingMesh;
}

export interface CameraFrame {
  /** ความสูง/กว้างที่กล้องต้องเฟรมให้เห็น (มม.) */
  span: number;
  /** จุดหมุน (มม. แกน y) = กึ่งกลางกรอบทั้งวง */
  cy: number;
}

export interface BypassRing {
  metal: RingMesh;
  /** 4 เม็ด: [พลอยไข่บน, พลอยไข่ล่าง, CZ ข้างเม็ดบน, CZ ข้างเม็ดล่าง] */
  gems: RingGem[];
  frame: CameraFrame;
  vertexCount: number;
}

interface RawMesh {
  pos: number[];
  nor: number[];
  idx: number[];
}

function sub(a: V3, b: V3): V3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot(a: V3, b: V3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function norm(a: V3): V3 {
  const l = Math.sqrt(dot(a, a)) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
function smooth(x: number): number {
  x = Math.max(0, Math.min(1, x));
  return x * x * (3 - 2 * x);
}

function tube(path: V3[], radii: number[], seg: number): RawMesh {
  const L = path.length;
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  for (let ii = 0; ii < L; ii++) {
    const a = path[ii > 0 ? ii - 1 : 0];
    const b = path[ii < L - 1 ? ii + 1 : L - 1];
    const Tn = norm(sub(b, a));
    let ref: V3 = [0, 0, 1];
    if (Math.abs(dot(Tn, ref)) > 0.9) ref = [1, 0, 0];
    const d0 = dot(ref, Tn);
    const Nn = norm([ref[0] - Tn[0] * d0, ref[1] - Tn[1] * d0, ref[2] - Tn[2] * d0]);
    const Bn = cross(Tn, Nn);
    for (let jj = 0; jj < seg; jj++) {
      const an = (2 * Math.PI * jj) / seg;
      const c = Math.cos(an);
      const s = Math.sin(an);
      const nx = c * Nn[0] + s * Bn[0];
      const ny = c * Nn[1] + s * Bn[1];
      const nz = c * Nn[2] + s * Bn[2];
      pos.push(path[ii][0] + radii[ii] * nx, path[ii][1] + radii[ii] * ny, path[ii][2] + radii[ii] * nz);
      nor.push(nx, ny, nz);
    }
  }
  for (let ii = 0; ii < L - 1; ii++) {
    for (let jj = 0; jj < seg; jj++) {
      const j2 = (jj + 1) % seg;
      const q0 = ii * seg + jj;
      const q1 = ii * seg + j2;
      const q2 = (ii + 1) * seg + j2;
      const q3 = (ii + 1) * seg + jj;
      idx.push(q0, q1, q2, q0, q2, q3);
    }
  }
  return { pos, nor, idx };
}

function merge(parts: RawMesh[]): RawMesh {
  const P: number[] = [];
  const N: number[] = [];
  const I: number[] = [];
  let off = 0;
  for (let pi = 0; pi < parts.length; pi++) {
    const m = parts[pi];
    for (let x = 0; x < m.pos.length; x++) {
      P.push(m.pos[x]);
      N.push(m.nor[x]);
    }
    for (let x = 0; x < m.idx.length; x++) I.push(m.idx[x] + off);
    off += m.pos.length / 3;
  }
  return { pos: P, nor: N, idx: I };
}

interface GemFrame {
  u: V3;
  t: V3;
  G: V3;
}

/** พลอยเหลี่ยม: crown 8 ส่วน + pavilion 16 ส่วน ยืด 2 แกน (A แกนยาว · B แกนสั้น) หมุน ph ในระนาบหน้าพลอย */
function ovalGem(fr: GemFrame, A: number, B: number, ph: number, hc: number, gT: number, hp: number): RingMesh {
  const rt = 0.57;
  const rs = 0.8;
  const ys = hc * (1 - (rs * Math.cos(Math.PI / 8) - rt) / (1 - rt));
  const cph = Math.cos(ph);
  const sph = Math.sin(ph);
  function W(r: number, ang: number, y: number): V3 {
    const xl = A * r * Math.cos(ang);
    const zl = B * r * Math.sin(ang);
    const x = xl * cph - zl * sph;
    const z = xl * sph + zl * cph;
    return [fr.G[0] + fr.t[0] * x + fr.u[0] * y, fr.G[1] + fr.t[1] * x + fr.u[1] * y, fr.G[2] + fr.t[2] * x + fr.u[2] * y + z];
  }
  const C0 = W(0, 0, -gT - hp * 0.35);
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  function tri(P1: V3, P2: V3, P3: V3) {
    let nn = norm(cross(sub(P2, P1), sub(P3, P1)));
    const mm = [(P1[0] + P2[0] + P3[0]) / 3 - C0[0], (P1[1] + P2[1] + P3[1]) / 3 - C0[1], (P1[2] + P2[2] + P3[2]) / 3 - C0[2]];
    if (dot(nn, mm) < 0) nn = [-nn[0], -nn[1], -nn[2]];
    const b0 = pos.length / 3;
    pos.push(P1[0], P1[1], P1[2], P2[0], P2[1], P2[2], P3[0], P3[1], P3[2]);
    nor.push(nn[0], nn[1], nn[2], nn[0], nn[1], nn[2], nn[0], nn[1], nn[2]);
    idx.push(b0, b0 + 1, b0 + 2);
  }
  const Tp: V3[] = [];
  const Sp: V3[] = [];
  const Gt: V3[] = [];
  const Gb: V3[] = [];
  for (let kk = 0; kk < 8; kk++) {
    Tp.push(W(rt, (kk * Math.PI) / 4, hc));
    Sp.push(W(rs, ((kk + 0.5) * Math.PI) / 4, ys));
  }
  for (let kk = 0; kk < 16; kk++) {
    Gt.push(W(1, (kk * Math.PI) / 8, 0));
    Gb.push(W(1, (kk * Math.PI) / 8, -gT));
  }
  const top = W(0, 0, hc);
  const culet = W(0, 0, -gT - hp);
  for (let kk = 0; kk < 8; kk++) {
    const k1 = (kk + 1) % 8;
    const km = (kk + 7) % 8;
    tri(top, Tp[kk], Tp[k1]);
    tri(Tp[kk], Tp[k1], Sp[kk]);
    tri(Tp[kk], Sp[km], Gt[2 * kk]);
    tri(Tp[kk], Gt[2 * kk], Sp[kk]);
    tri(Sp[kk], Gt[2 * kk], Gt[2 * kk + 1]);
    tri(Sp[kk], Gt[2 * kk + 1], Gt[(2 * kk + 2) % 16]);
  }
  for (let kk = 0; kk < 16; kk++) {
    const g1 = (kk + 1) % 16;
    tri(Gt[kk], Gt[g1], Gb[g1]);
    tri(Gt[kk], Gb[g1], Gb[kk]);
    tri(culet, Gb[kk], Gb[g1]);
  }
  return { pos: new Float32Array(pos), nor: new Float32Array(nor), idx: new Uint16Array(idx) };
}

export function buildBypassRing(params: BypassParams = BYPASS2): BypassRing {
  const p = params;
  const sgn = -1;
  const innerR = p.innerDiaMm / 2;
  const parts: RawMesh[] = [];
  const gems: RingGem[] = [];
  const dth = p.tipOffsetMm / (innerR + p.bandThickMm);
  const T = 2 * Math.PI + 2 * dth; // ก้านเป็นเกลียว: เริ่มซ้ายของยอดวง วิ่งตามเข็มเกิน 1 รอบ ไปจบขวาของยอดวง

  function zAt(t: number): number {
    if (t <= T / 2) return sgn * p.stoneZMm * (1 - smooth(t / p.rampRad));
    return -sgn * p.stoneZMm * (1 - smooth((T - t) / p.rampRad));
  }
  function bl(t: number): number {
    return smooth((Math.min(t, T - t) - 0.5) / 1.4);
  }
  function hwAt(t: number): number {
    return (p.bandWidthMm + (p.bandWidthBackMm - p.bandWidthMm) * bl(t)) / 2;
  }
  function htAt(t: number): number {
    return (p.bandThickMm + (p.bandThickBackMm - p.bandThickMm) * bl(t)) / 2;
  }
  function thAt(t: number): number {
    return Math.PI / 2 + dth - t;
  }
  function centerAt(t: number): V3 {
    const r = innerR + htAt(t);
    const th = thAt(t);
    return [r * Math.cos(th), r * Math.sin(th), zAt(t)];
  }

  /* ---- ก้าน: กวาดหน้าตัดวงรีตามเส้นเกลียว · ปลาย 2 ข้างปิดเป็นโดมครึ่งวงรี ---- */
  const M = 16;
  const ts: number[] = [];
  const scs: number[] = [];
  const LcRad = 1.1 / (innerR + p.bandThickMm / 2);
  const NMID = 170;
  for (let q = 0; q <= 8; q++) {
    const ph0 = (Math.PI / 2) * q / 8;
    ts.push(LcRad * (1 - Math.cos(ph0)));
    scs.push(Math.sin(ph0));
  }
  for (let q = 1; q < NMID; q++) {
    ts.push(LcRad + ((T - 2 * LcRad) * q) / NMID);
    scs.push(1);
  }
  for (let q = 8; q >= 0; q--) {
    const ph0 = (Math.PI / 2) * q / 8;
    ts.push(T - LcRad * (1 - Math.cos(ph0)));
    scs.push(Math.sin(ph0));
  }
  const sP: number[] = [];
  const sN: number[] = [];
  const sI: number[] = [];
  const R2 = ts.length;
  for (let i = 0; i < R2; i++) {
    const tt = ts[i];
    const c0 = centerAt(tt);
    const cp = centerAt(Math.min(T, tt + 0.01));
    const cm = centerAt(Math.max(0, tt - 0.01));
    const Tn = norm(sub(cp, cm));
    const thx = thAt(tt);
    const er: V3 = [Math.cos(thx), Math.sin(thx), 0];
    const side = norm(cross(Tn, er));
    let rd = norm(cross(side, Tn));
    if (dot(rd, er) < 0) rd = [-rd[0], -rd[1], -rd[2]];
    const hw = hwAt(tt);
    const ht = htAt(tt);
    const sc0 = scs[i];
    for (let j = 0; j < M; j++) {
      const an = (2 * Math.PI * j) / M;
      const ca = Math.cos(an);
      const sa = Math.sin(an);
      sP.push(
        c0[0] + side[0] * hw * sc0 * ca + rd[0] * ht * sc0 * sa,
        c0[1] + side[1] * hw * sc0 * ca + rd[1] * ht * sc0 * sa,
        c0[2] + side[2] * hw * sc0 * ca + rd[2] * ht * sc0 * sa
      );
      const nn = norm([side[0] * ca / hw + rd[0] * sa / ht, side[1] * ca / hw + rd[1] * sa / ht, side[2] * ca / hw + rd[2] * sa / ht]);
      sN.push(nn[0], nn[1], nn[2]);
    }
  }
  for (let i = 0; i < R2 - 1; i++) {
    for (let j = 0; j < M; j++) {
      const j2 = (j + 1) % M;
      const a0 = i * M + j;
      const a1 = i * M + j2;
      const a2 = (i + 1) * M + j2;
      const a3 = (i + 1) * M + j;
      sI.push(a0, a1, a2, a0, a2, a3);
    }
  }
  parts.push({ pos: sP, nor: sN, idx: sI });

  /* ---- พลอยไข่ 2 เม็ด + เตย 4 เขี้ยว/เม็ด ---- */
  const shortD = p.ovalShortMm;
  const A = p.ovalLongMm / 2;
  const B = shortD / 2;
  const phi0 = (p.ovalTiltDeg * Math.PI) / 180;
  const hc = 0.16 * shortD;
  const gT = 0.035 * shortD;
  const hp = 0.43 * shortD;
  const rp = p.prongMm / 2;
  const topSh = innerR + p.bandThickMm; // ผิวบนก้านที่หัว
  const headEff = Math.max(p.headHeightMm, hp + gT + 0.25);
  const Rg = topSh + headEff;

  function frameOf(th: number, r: number, zc: number): GemFrame {
    const u: V3 = [Math.cos(th), Math.sin(th), 0];
    const t: V3 = [Math.sin(th), -Math.cos(th), 0];
    return { u, t, G: [u[0] * r, u[1] * r, zc] };
  }
  // จุดในกรอบพลอย: x ตามแถว · h ตามแนวตั้งฉากหน้า · z ตามแกนนิ้ว · หมุน ph ในระนาบหน้า
  function loc(fr: GemFrame, x: number, h: number, z: number, ph: number): V3 {
    const xr = x * Math.cos(ph) - z * Math.sin(ph);
    const zr = x * Math.sin(ph) + z * Math.cos(ph);
    return [fr.G[0] + fr.t[0] * xr + fr.u[0] * h, fr.G[1] + fr.t[1] * xr + fr.u[1] * h, fr.G[2] + fr.t[2] * xr + fr.u[2] * h + zr];
  }

  interface Stone {
    sx: number;
    zc: number;
    ph: number;
    cz: number;
  }
  const stones: Stone[] = [
    { sx: p.stoneXOffMm, zc: sgn * p.stoneZMm, ph: phi0, cz: 1 },
    { sx: -p.stoneXOffMm, zc: -sgn * p.stoneZMm, ph: -phi0, cz: -1 },
  ];
  const h0 = topSh - 0.5 - Rg;
  const fs = [0, 0.3, 0.65, 1];
  const angs = [1, 3, 5, 7];
  stones.forEach((st) => {
    const fr = frameOf(Math.PI / 2 - st.sx / Rg, Rg, st.zc);
    gems.push({ center: fr.G.slice(), normal: fr.u.slice(), radiusMm: A, mesh: ovalGem(fr, A, B, st.ph, hc, gT, hp) });
    /* ถ้วยรองใต้พลอย (mount): ตัวหัวทึบรูปกรวยวงรีตัดปลาย จากผิวก้านขึ้นไปถึงครึ่งความลึก pavilion */
    (function () {
      const hB = h0;
      const hT = -(gT + 0.5 * hp);
      const sB = p.mountMm;
      const sT = p.mountMm - 0.2;
      const nR = 3;
      const mp: number[] = [];
      const mn: number[] = [];
      const mi: number[] = [];
      for (let rr = 0; rr < nR; rr++) {
        const ff = rr / (nR - 1);
        const ss = sB + (sT - sB) * ff;
        const hh = hB + (hT - hB) * ff;
        for (let jj = 0; jj < 16; jj++) {
          const aa = (2 * Math.PI * jj) / 16;
          const cx = Math.cos(aa);
          const cz2 = Math.sin(aa);
          const pt = loc(fr, A * ss * cx, hh, B * ss * cz2, st.ph);
          mp.push(pt[0], pt[1], pt[2]);
          const nl = norm([(cx * Math.cos(st.ph)) / A - (cz2 * Math.sin(st.ph)) / B, 0, (cx * Math.sin(st.ph)) / A + (cz2 * Math.cos(st.ph)) / B]);
          let nw: V3 = [fr.t[0] * nl[0] + fr.u[0] * 0.35, fr.t[1] * nl[0] + fr.u[1] * 0.35, fr.t[2] * nl[0] + nl[2]];
          nw = norm(nw);
          mn.push(nw[0], nw[1], nw[2]);
        }
      }
      for (let rr = 0; rr < nR - 1; rr++) {
        for (let jj = 0; jj < 16; jj++) {
          const jn = (jj + 1) % 16;
          const b0 = rr * 16 + jj;
          const b1 = rr * 16 + jn;
          const b2 = (rr + 1) * 16 + jn;
          const b3 = (rr + 1) * 16 + jj;
          mi.push(b0, b1, b2, b0, b2, b3);
        }
      }
      const cc = loc(fr, 0, hT, 0, st.ph);
      const cb = mp.length / 3; // ฝาบนของถ้วย (พัด)
      mp.push(cc[0], cc[1], cc[2]);
      mn.push(fr.u[0], fr.u[1], fr.u[2]);
      for (let jj = 0; jj < 16; jj++) {
        const tp2 = (nR - 1) * 16 + jj;
        mp.push(mp[tp2 * 3], mp[tp2 * 3 + 1], mp[tp2 * 3 + 2]);
        mn.push(fr.u[0], fr.u[1], fr.u[2]);
        mi.push(cb, cb + 1 + jj, cb + 1 + ((jj + 1) % 16));
      }
      parts.push({ pos: mp, nor: mn, idx: mi });
    })();
    for (let ai = 0; ai < 4; ai++) {
      const al = (angs[ai] * Math.PI) / 4;
      const ex = (A + 0.6 * rp) * Math.cos(al);
      const ez = (B + 0.6 * rp) * Math.sin(al);
      const path: V3[] = [];
      for (let fi = 0; fi < fs.length; fi++) {
        const sc1 = 0.35 + 0.65 * Math.pow(fs[fi], 0.8); // เตยลู่เข้าหาแกนพลอยที่โคน (เหมือนตะกร้า) แล้วบานออกถึงขอบเอว
        path.push(loc(fr, ex * sc1, h0 * (1 - fs[fi]), ez * sc1, st.ph));
      }
      path.push(loc(fr, ex * 0.93, p.prongOverMm, ez * 0.93, st.ph));
      parts.push(tube(path, [1.25 * rp, 1.05 * rp, 0.9 * rp, 0.8 * rp, 0.3 * rp], 8));
    }
  });

  /* ---- CZ กลมเล็ก 2 เม็ด: ขาวตายตัว ---- */
  const czR = p.czMm / 2;
  const hcC = 0.16 * p.czMm;
  const gTc = 0.035 * p.czMm;
  const hpc = 0.43 * p.czMm;
  const rc = p.czProngMm / 2;
  stones.forEach((st) => {
    let fr: GemFrame;
    let hBase: number;
    if (st.cz > 0) {
      /* CZ ของพลอยบน: ไม่อยู่บนก้าน — เกาะข้างหัวพลอยไข่ ยื่นออกด้านนอกตามแกนนิ้ว มีแขนเงินสั้นเชื่อมจากถ้วยรองใต้พลอยใหญ่ + เตยเล็ก 3 ต้น */
      const sf = frameOf(Math.PI / 2 - st.sx / Rg, Rg, st.zc);
      const sgz = st.zc < 0 ? -1 : 1;
      const xo = 0.45 * A;
      const zo = sgz * (B + czR + 0.25);
      fr = { u: sf.u, t: sf.t, G: loc(sf, xo, 0, zo, st.ph) };
      hBase = -0.8;
      parts.push(tube([loc(sf, xo * 0.5, -1.5, sgz * 1.0, st.ph), loc(sf, xo * 0.9, -1.1, zo * 0.8, st.ph), loc(sf, xo, -0.8, zo, st.ph)], [0.55, 0.5, 0.45], 8));
    } else {
      /* CZ ของพลอยล่าง: อยู่บนก้านรอบสอง */
      const xc = st.sx + st.cz * (A + czR + 0.35);
      const th = Math.PI / 2 - xc / (innerR + p.bandThickMm);
      const tp = Math.PI / 2 + dth - th + 2 * Math.PI;
      fr = frameOf(th, innerR + 2 * htAt(tp) + 0.2, zAt(tp));
      hBase = -0.5;
    }
    gems.push({ center: fr.G.slice(), normal: fr.u.slice(), radiusMm: czR, mesh: ovalGem(fr, czR, czR, 0, hcC, gTc, hpc) });
    for (let ai = 0; ai < 3; ai++) {
      const al = ((90 + 120 * ai) * Math.PI) / 180;
      const ex = (czR + 0.15) * Math.cos(al);
      const ez = (czR + 0.15) * Math.sin(al);
      parts.push(tube([loc(fr, ex * 0.5, hBase, ez * 0.5, 0), loc(fr, ex, 0, ez, 0), loc(fr, ex * 0.85, 0.12, ez * 0.85, 0)], [1.3 * rc, rc, 0.5 * rc], 6));
    }
  });

  const mm = merge(parts);
  const metal: RingMesh = { pos: new Float32Array(mm.pos), nor: new Float32Array(mm.nor), idx: new Uint16Array(mm.idx) };
  let vertexCount = metal.pos.length / 3;
  gems.forEach((g) => {
    vertexCount += g.mesh.pos.length / 3;
  });

  return { metal, gems, frame: computeCameraFrame(gems, { innerDiaMm: p.innerDiaMm, stoneMm: p.stoneMm, girdleRadiusMm: Rg }), vertexCount };
}

/** เฟรมกล้อง — สูตรเดียวกับ rebuild() ของต้นฉบับ (11 พ.ย. เจ้าของ: เฟรมทั้งวง ไม่ซูมเฉพาะแถวพลอย) */
export function computeCameraFrame(
  gems: readonly { center: readonly number[] }[],
  dims: { innerDiaMm: number; stoneMm: number; girdleRadiusMm: number }
): CameraFrame {
  let mx = 0;
  gems.forEach((g) => {
    mx = Math.max(mx, Math.abs(g.center[0]));
  });
  const top = dims.girdleRadiusMm + Math.min(dims.stoneMm * 0.6, 2.4);
  const bot = dims.innerDiaMm / 2 + 1.2;
  const span = Math.max(top + bot, 2 * (mx + dims.stoneMm / 2 + 0.4), 2 * bot); // สูงทั้งวง / กว้างแถว / กว้างวง เอาค่ามากสุด
  const cy = (top - bot) / 2; // จุดหมุน = กึ่งกลางกรอบทั้งวง
  return { span, cy };
}
