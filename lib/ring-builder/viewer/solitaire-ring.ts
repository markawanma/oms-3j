// @ts-nocheck — พอร์ต var-style JS แบบตรงตัว (ห้าม refactor) · พฤติกรรมล็อกด้วย golden checksum ใน solitaire-ring.test.ts · type ที่ export ชัดเจน (SolitaireParams · SOLITAIRE · buildSolitaireRing)
// lib/ring-builder/viewer/solitaire-ring.ts — โมเดล 3D "แหวนเม็ดเดี่ยว 6 เตย" (แบบที่ 8 · cathedral) (pure · ไม่แตะ DOM/WebGL/ไลบรารีภายนอก)
//
// พอร์ตตรงตัวจาก docs/3j-jewelry/cad/trinity-ring-preview.html ณ commit 695d4f2/c6d0453 (SOLITAIRE บรรทัด 1056–1073 + buildSolitaireRing บรรทัด 1077–1231) —
// 🔴 ห้าม refactor คณิตศาสตร์: ลำดับการ push จุด/ดัชนี สูตร และค่าคงที่ทุกตัวต้องเท่าต้นฉบับ
// ต่างจากต้นฉบับเฉพาะ: (1) เป็น TS ภายในยังใช้ var/โครงเดิม (2) ตัด notes[] / info / params ออกจากผลลัพธ์ — หมายเหตุช่าง/ค่าประมาณ/น้ำหนัก ห้ามถึงลูกค้า (Z7/Z17)
// (3) คืน {metal, gems, frame, vertexCount} โดย frame = computeCameraFrame (สูตรเดียวกับ rebuild() ของต้นฉบับ · girdleRadiusMm = Rg)
// 🔴 ไฟล์นี้ถูก import ได้จาก showcase-rings.ts เท่านั้น (Z16) — อยู่ใน chunk lazy ของ RingViewer ไม่เข้า first-load · ไม่แตะ row-ring/bypass-ring
// gems ยาว 1 (พลอยกลมเม็ดเดียว) · ค่าที่ยังเป็นค่าประมาณ (รอวัดจริง) อยู่ในคอมเมนต์ของ SOLITAIRE ด้านล่าง
import { computeCameraFrame } from "./bypass-ring";
import type { ViewerRing } from "./ring-types";

export interface SolitaireParams {
  readonly setting: "solitaire";
  readonly stoneCount: number;
  readonly innerDiaMm: number;
  readonly stoneMm: number;
  readonly gapMm: number;
  readonly headHeightMm: number;
  readonly bandWidthMm: number;
  readonly bandWidthBackMm: number;
  readonly bandThickMm: number;
  readonly bandThickBackMm: number;
  readonly prongMm: number;
  readonly prongOverMm: number;
  readonly armMm: number;
  readonly armStartRad: number;
  readonly armF: number;
  readonly cupBaseMm: number;
}

var SOLITAIRE_VALUES = {
  setting: "solitaire",
  stoneCount: 1,
  innerDiaMm: 16.5,        // เจ้าของยืนยัน (สเก็ตช์): วงใน Ø16.5 mm = US 6
  stoneMm: 4.0,            // เจ้าของยืนยัน (สเก็ตช์): พลอยกลม Ø4.0 mm
  gapMm: 0,                // ไม่ใช้ (เม็ดเดียว)
  headHeightMm: 3.9,       // จากผิวบนก้านถึงหน้าพลอย (table) · สเก็ตช์ 4.5 mm แต่เจ้าของสั่ง "เตยสูงเกินไป ต่ำลงนิดนึง" (24 พ.ย. v3) -> เลือก 3.9 mm (TL ให้ช่วง 3.8-4.0)
  bandWidthMm: 1.6,        // ประมาณจากสเก็ตช์ top view — รอวัดจริง (กว้างก้านใต้หัว · เรียวเข้าหาหัว)
  bandWidthBackMm: 2.0,    // ประมาณจากสเก็ตช์ side view — รอวัดจริง (กว้างก้านด้านหลัง/ด้านข้าง)
  bandThickMm: 1.2,        // เจ้าของยืนยัน (สเก็ตช์): ก้านหนา 1.2 mm (ด้านข้าง)
  bandThickBackMm: 1.2,    // เจ้าของยืนยัน: 1.2 mm สม่ำเสมอ (สเก็ตช์ไม่แสดงการเรียวด้านหลัง)
  prongMm: 0.7,            // ประมาณ — รอวัดจริง (เตย 6 ซี่ Ø ~0.7 mm เท่าเกณฑ์หล่อเงิน 925)
  prongOverMm: 0.3,        // ประมาณจากสเก็ตช์ — รอวัดจริง (ปุ่มปลายเตยสูงกว่าขอบเอวพลอย)
  armMm: 0.9,              // ประมาณจากรูปจริง — รอวัดจริง (Ø บ่าที่โคน · ปลายเรียวเหลือ ~90% · บ่าในรูปจริงหนาใกล้เคียงก้าน)
  armStartRad: 0.65,       // ประมาณจากรูปจริง (เจ้าของ v3: ±35-40°) — รอวัดจริง (บ่าแตกจากผิวก้านที่ ~37° จากยอดวง ≈ 5.7 mm ตามเส้นวง · ระนาบเดียวกับก้าน)
  armF: 0.35,              // ประมาณ — ความสูงที่บ่าเสียบซี่เตย (0 = โคนถ้วย · 1 = ขอบเอว) · ยิ่งสูงช่องสามเหลี่ยมยิ่งกว้าง
  cupBaseMm: 2.8           // ประมาณจากคำอธิบาย TL — รอวัดจริง (เส้นผ่านศูนย์กลางโคนถ้วย แคบกว่าพลอย Ø4.0 เล็กน้อย)
};

export const SOLITAIRE: SolitaireParams = SOLITAIRE_VALUES;

export function buildSolitaireRing(params: SolitaireParams = SOLITAIRE): ViewerRing {
  var p = {}, k, i, j, q;
  for(k in params) p[k] = params[k];
  function sub(a,b){return [a[0]-b[0],a[1]-b[1],a[2]-b[2]];}
  function cross(a,b){return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];}
  function dot(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}
  function norm(a){var l=Math.sqrt(dot(a,a))||1;return [a[0]/l,a[1]/l,a[2]/l];}
  function smooth(x){x=Math.max(0,Math.min(1,x));return x*x*(3-2*x);}
  function tube(path, radii, seg){
    var L = path.length, pos = [], nor = [], idx = [], a, b, Tn, ref, d0, Nn, Bn, an, c, s, nx, ny, nz, ii, jj;
    for(ii=0; ii<L; ii++){
      a = path[ii>0?ii-1:0]; b = path[ii<L-1?ii+1:L-1];
      Tn = norm(sub(b,a)); ref = [0,0,1];
      if(Math.abs(dot(Tn,ref)) > 0.9) ref = [1,0,0];
      d0 = dot(ref,Tn);
      Nn = norm([ref[0]-Tn[0]*d0, ref[1]-Tn[1]*d0, ref[2]-Tn[2]*d0]);
      Bn = cross(Tn,Nn);
      for(jj=0; jj<seg; jj++){
        an = 2*Math.PI*jj/seg; c = Math.cos(an); s = Math.sin(an);
        nx = c*Nn[0]+s*Bn[0]; ny = c*Nn[1]+s*Bn[1]; nz = c*Nn[2]+s*Bn[2];
        pos.push(path[ii][0]+radii[ii]*nx, path[ii][1]+radii[ii]*ny, path[ii][2]+radii[ii]*nz);
        nor.push(nx,ny,nz);
      }
    }
    for(ii=0; ii<L-1; ii++) for(jj=0; jj<seg; jj++){
      var j2 = (jj+1)%seg, q0 = ii*seg+jj, q1 = ii*seg+j2, q2 = (ii+1)*seg+j2, q3 = (ii+1)*seg+jj;
      idx.push(q0,q1,q2, q0,q2,q3);
    }
    return {pos:pos, nor:nor, idx:idx};
  }
  function merge(parts){
    var P = [], N = [], I = [], off = 0, m, x, pi;
    for(pi=0; pi<parts.length; pi++){
      m = parts[pi];
      for(x=0; x<m.pos.length; x++){P.push(m.pos[x]); N.push(m.nor[x]);}
      for(x=0; x<m.idx.length; x++) I.push(m.idx[x]+off);
      off += m.pos.length/3;
    }
    return {pos:P, nor:N, idx:I};
  }
  /* พลอยเหลี่ยม: สำเนาโครงเดียวกับ ovalGem ของ buildBypassRing (crown 8 ส่วน + pavilion 16 ส่วน) เรียกด้วย A = B = รัศมี -> พลอยกลม */
  function roundGem(fr, A, B, ph, hc, gT, hp){
    var rt = 0.57, rs = 0.80, ys = hc*(1 - (rs*Math.cos(Math.PI/8) - rt)/(1 - rt)), cph = Math.cos(ph), sph = Math.sin(ph);
    function W(r, ang, y){
      var xl = A*r*Math.cos(ang), zl = B*r*Math.sin(ang), x = xl*cph - zl*sph, z = xl*sph + zl*cph;
      return [fr.G[0]+fr.t[0]*x+fr.u[0]*y, fr.G[1]+fr.t[1]*x+fr.u[1]*y, fr.G[2]+fr.t[2]*x+fr.u[2]*y+z];
    }
    var C0 = W(0,0,-gT-hp*0.35), pos = [], nor = [], idx = [];
    function tri(P1,P2,P3){
      var nn = norm(cross(sub(P2,P1), sub(P3,P1)));
      var mm = [(P1[0]+P2[0]+P3[0])/3-C0[0], (P1[1]+P2[1]+P3[1])/3-C0[1], (P1[2]+P2[2]+P3[2])/3-C0[2]];
      if(dot(nn,mm) < 0) nn = [-nn[0],-nn[1],-nn[2]];
      var b0 = pos.length/3;
      pos.push(P1[0],P1[1],P1[2], P2[0],P2[1],P2[2], P3[0],P3[1],P3[2]);
      nor.push(nn[0],nn[1],nn[2], nn[0],nn[1],nn[2], nn[0],nn[1],nn[2]);
      idx.push(b0,b0+1,b0+2);
    }
    var Tp = [], Sp = [], Gt = [], Gb = [], kk;
    for(kk=0;kk<8;kk++){Tp.push(W(rt, kk*Math.PI/4, hc)); Sp.push(W(rs, (kk+0.5)*Math.PI/4, ys));}
    for(kk=0;kk<16;kk++){Gt.push(W(1, kk*Math.PI/8, 0)); Gb.push(W(1, kk*Math.PI/8, -gT));}
    var top = W(0,0,hc), culet = W(0,0,-gT-hp);
    for(kk=0;kk<8;kk++){
      var k1 = (kk+1)%8, km = (kk+7)%8;
      tri(top, Tp[kk], Tp[k1]);
      tri(Tp[kk], Tp[k1], Sp[kk]);
      tri(Tp[kk], Sp[km], Gt[2*kk]); tri(Tp[kk], Gt[2*kk], Sp[kk]);
      tri(Sp[kk], Gt[2*kk], Gt[2*kk+1]);
      tri(Sp[kk], Gt[2*kk+1], Gt[(2*kk+2)%16]);
    }
    for(kk=0;kk<16;kk++){
      var g1 = (kk+1)%16;
      tri(Gt[kk], Gt[g1], Gb[g1]); tri(Gt[kk], Gb[g1], Gb[kk]);
      tri(culet, Gb[kk], Gb[g1]);
    }
    return {pos:new Float32Array(pos), nor:new Float32Array(nor), idx:new Uint16Array(idx)};
  }

  var innerR = p.innerDiaMm/2, d = p.stoneMm, R = d/2, parts = [], gems = [];
  var hc = 0.16*d, gT = 0.035*d, hp = 0.43*d, rp = p.prongMm/2;
  var topSh = innerR + p.bandThickMm;                                      // ผิวบนก้านที่หัว
  var headEff = Math.max(p.headHeightMm, hc + hp + gT + 0.25);             // headHeightMm = ผิวก้าน -> หน้าพลอย (table) · ขั้นต่ำให้ culet พ้นผิวก้าน 0.25 mm
  var Rg = topSh + headEff - hc;                                           // รัศมีขอบเอวพลอย (จากแกนวง) = ต่ำกว่าหน้าพลอย hc

  /* ---- ก้าน: ห่วงปิดเต็มวง กวาดหน้าตัดวงรี (กว้าง x หนา) · หนา/กว้างที่หัว -> เรียวลงด้านหลัง · ผิวในคงที่ที่ innerR ---- */
  function blAt(a){return smooth((a - 0.4)/1.8);}                          // a = มุมห่างจากยอดวง (0..pi) · 0 = หัว · 1 = ด้านหลัง
  function hwAt(a){return (p.bandWidthMm + (p.bandWidthBackMm - p.bandWidthMm)*blAt(a))/2;}
  function htAt(a){return (p.bandThickMm + (p.bandThickBackMm - p.bandThickMm)*blAt(a))/2;}
  var NB = 120, M = 16, bP = [], bN = [], bI = [], s0, th0, a0, hw0, ht0, rc0, er0, an0, ca0, sa0, nn0;
  for(i=0;i<=NB;i++){                                                      // วงที่ NB = ซ้อนวงที่ 0 (ปิดห่วง ไม่ต้องห่อ index)
    s0 = 2*Math.PI*i/NB; th0 = Math.PI/2 + s0; a0 = Math.min(s0, 2*Math.PI - s0);
    hw0 = hwAt(a0); ht0 = htAt(a0); rc0 = innerR + ht0; er0 = [Math.cos(th0), Math.sin(th0), 0];
    for(j=0;j<M;j++){
      an0 = 2*Math.PI*j/M; ca0 = Math.cos(an0); sa0 = Math.sin(an0);
      bP.push(rc0*er0[0] + er0[0]*ht0*sa0, rc0*er0[1] + er0[1]*ht0*sa0, hw0*ca0);
      nn0 = norm([er0[0]*sa0/ht0, er0[1]*sa0/ht0, ca0/hw0]);
      bN.push(nn0[0], nn0[1], nn0[2]);
    }
  }
  for(i=0;i<NB;i++) for(j=0;j<M;j++){
    var j2 = (j+1)%M, b0 = i*M+j, b1 = i*M+j2, b2 = (i+1)*M+j2, b3 = (i+1)*M+j;
    bI.push(b0, b1, b2, b0, b2, b3);
  }
  parts.push({pos:bP, nor:bN, idx:bI});

  /* ---- พลอยกลมเม็ดเดียว วางตรงยอดวง ---- */
  var fr = {u:[0,1,0], t:[1,0,0], G:[0, Rg, 0]};
  gems.push({center:fr.G.slice(), normal:fr.u.slice(), radiusMm:R, mesh:roundGem(fr, R, R, 0, hc, gT, hp)});

  /* ---- เตย 6 ซี่ (ทุก 60°) ลู่เข้าเป็นตะกร้าแคบที่โคน แล้วบานถึงขอบเอว · ซี่ 0° และ 180° อยู่แนวสัมผัสวง = จุดรับแขนไหล่ ---- */
  var yB = topSh - 0.5, H = Rg - yB, fs = [0, 0.35, 0.7, 1], Rr = R - 0.1, ai, fi, al, ex, ez, sc1, path;   // yB = โคนซี่ (ฝังในก้าน 0.3 mm) · H = ความสูงซี่ · Rr = รัศมีศูนย์กลางซี่ที่ขอบเอว (ผิวนอกซี่ยื่นพ้นขอบเอวแค่ ~0.25 mm)
  var cupR0 = p.cupBaseMm/2/Rr;                                            // สัดส่วนรัศมีโคนถ้วย (ฐานแคบกว่าพลอยเล็กน้อย)
  function scAt(f){return cupR0 + (1 - cupR0)*f;}                          // รัศมีซี่ที่ความสูง f (0 = โคน · 1 = ขอบเอว) เรียวเข้าเล็กน้อยด้านล่าง เกือบตั้งตรง
  for(ai=0; ai<6; ai++){
    al = ai*Math.PI/3; ex = Rr*Math.cos(al); ez = Rr*Math.sin(al); path = [];
    for(fi=0; fi<fs.length; fi++){
      sc1 = scAt(fs[fi]);
      path.push([ex*sc1, yB + H*fs[fi], ez*sc1]);
    }
    path.push([ex*0.97, Rg + 0.15, ez*0.97]);                              // เหนือขอบเอว: ตั้งตรงต่อ แล้วโค้งงุ้มเข้ากดขอบพลอย (ไม่บานออก)
    path.push([ex*0.88, Rg + p.prongOverMm, ez*0.88]);
    path.push([ex*0.84, Rg + p.prongOverMm + 0.12, ez*0.84]);              // ปุ่มกลมปลายเตย (ปิดปลายท่อ)
    parts.push(tube(path, [1.2*rp, 1.1*rp, 1.0*rp, 0.95*rp, 0.9*rp, 0.85*rp, 0.3*rp], 8));
  }

  /* ---- ไหล่ (บ่า) ข้างละ 1 ชิ้น: ก้านวิ่งต่อเนื่องใต้หัวเป็นเส้นเดียว · บ่าแตกจากผิวก้านที่ ~37° จากยอดวง ลาดขึ้นเป็นเส้นตรงเกือบเรียบไปต่อซี่ 0°/180° (ระนาบเดียวกับก้าน)
         ช่องระหว่างก้านกับบ่า = สามเหลี่ยมแคบ มุมแหลมอยู่ด้านนอก ฐานกว้างชิดหัว ---- */
  var sd, aStart = p.armStartRad, fE = p.armF, thA, rA, xE, yE, xA, yA, u, ap, arad, NA = 9;
  for(sd=-1; sd<=1; sd+=2){
    thA = Math.PI/2 - sd*aStart; rA = innerR + htAt(aStart);
    xA = rA*Math.cos(thA); yA = rA*Math.sin(thA);
    xE = sd*(Rr*scAt(fE) + 0.1); yE = yB + H*fE;                           // ปลายบ่าฝังเข้ากลางซี่ (เลื่อนออกนอก 0.1 mm ไม่ให้โผล่เข้าถ้วย)
    ap = []; arad = [];
    for(q=0;q<NA;q++){
      u = q/(NA-1);
      ap.push([xA + (xE-xA)*u, yA + (yE-yA)*u, 0]);                        // เส้นตรง (ไม่ชันโค้ง)
      arad.push(p.armMm/2*(1 - 0.1*u));
    }
    parts.push(tube(ap, arad, 8));
  }

  var mm = merge(parts);
  var metal = {pos:new Float32Array(mm.pos), nor:new Float32Array(mm.nor), idx:new Uint16Array(mm.idx)};
  var vtx = metal.pos.length/3;
  gems.forEach(function(g){vtx += g.mesh.pos.length/3;});
  return { metal: metal, gems: gems, frame: computeCameraFrame(gems, { innerDiaMm: p.innerDiaMm, stoneMm: p.stoneMm, girdleRadiusMm: Rg }), vertexCount: vtx };
}
