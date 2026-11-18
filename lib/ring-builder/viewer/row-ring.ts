// @ts-nocheck — พอร์ต var-style JS ~600 บรรทัดแบบตรงตัว (ห้าม refactor) · พฤติกรรมล็อกด้วย golden checksum ใน row-ring.test.ts · type ของ API ที่ export ประกาศชัดเจน (RowParams/buildRowRing/ViewerRing)
// lib/ring-builder/viewer/row-ring.ts — โมเดล 3D "แหวนแถว" (generator เดียว: ฝังล็อค · เตย · ก้นหอย · TRINITY · แถวเล็ก) (pure · ไม่แตะ DOM/WebGL/ไลบรารีภายนอก)
//
// พอร์ตตรงตัวจาก docs/3j-jewelry/cad/trinity-ring-preview.html (ROW_DEFAULTS + buildRowRing) — 🔴 ห้าม refactor คณิตศาสตร์:
// ลำดับการ push จุด/ดัชนี สูตร และค่าคงที่ทุกตัวต้องเท่าต้นฉบับ (ทีมเปิดเทียบกับต้นฉบับด้วยตา) · golden checksum ใน row-ring.test.ts คือด่านหลัก
// ต่างจากต้นฉบับเฉพาะ: (1) เป็น TS ภายในยังใช้ var/โครงเดิม (2) ตัด notes[] และ info (น้ำหนัก/หมายเหตุช่าง/ค่าประมาณจากรูป) ทิ้ง — ห้ามถึงลูกค้า (X6/Z7)
// (3) คืน {metal, gems, frame, vertexCount} โดย frame = computeCameraFrame (สูตรเดียวกับ rebuild() ของต้นฉบับ)
// 🔴 ไฟล์นี้ถูก import ได้จาก showcase-rings.ts เท่านั้น (Z9) — อยู่ใน chunk lazy ของ RingViewer ไม่เข้า first-load
// gems เรียงซ้าย → ขวา (x เพิ่ม)
import { computeCameraFrame } from "./bypass-ring";
import type { ViewerRing } from "./ring-types";

export type RowSetting = "prong4" | "shared_prong" | "shared_bead" | "channel" | "bar_prong" | "window_head";

/** ค่าที่ generator มีค่าเริ่มต้นให้ครบ (ROW_DEFAULTS) */
interface RowCore {
  setting: RowSetting;
  stoneCount: number;
  innerDiaMm: number;
  stoneMm: number;
  gapMm: number;
  bandWidthMm: number;
  bandWidthBackMm: number;
  bandThickMm: number;
  cornerMm: number;
  headHeightMm: number;
  prongMm: number;
  prongOverMm: number;
  railMm: number;
  prongAtEnds: boolean;
  taperRad: number;
  gallery: "plain" | "scroll";
  shoulder: "plain" | "scroll_relief";
  scrollWireMm: number;
  scrollRadiusMm: number;
  scrollTurns: number;
  scrollInner: number;
  reliefWireMm: number;
  reliefRadiusMm: number;
  reliefPitchMm: number;
  reliefCount: number;
  support: "none" | "block";
  supportEndDeg: number;
  supportOutMm: number;
  supportBotMm: number;
  panelBotMm: number;
  panelLenMm: number;
  panelHMm: number;
  panelFrameMm: number;
  channelDepthMm: number;
  channelSinkMm: number;
  channelEndMm: number;
  channelInsetMm: number;
  barMm: number;
  barTopMm: number;
  beadOutMm: number;
  windowWMm: number;
  windowTopGapMm: number;
  windowBotMm: number;
  topDropMm: number;
  prongSideFrac: number;
}

/** ค่าที่ไม่มีค่าเริ่มต้น (ไม่ตั้ง = พฤติกรรมเดิม) */
interface RowExtra {
  bandThickBackMm?: number;
  supportShape?: "wedge" | "taper";
  supportTaperPow?: number;
}

type RowDefaults = RowCore;
type RowResolved = RowCore & RowExtra;

export type RowParams = Pick<RowCore, "setting" | "stoneCount" | "innerDiaMm" | "stoneMm"> & Partial<RowCore> & RowExtra;

// ค่าสำรองของ generator เท่านั้น ไม่ใช่ค่าของแบบใด (ตามต้นฉบับ)
const ROW_DEFAULTS: RowDefaults = {
  setting: "prong4", stoneCount: 3, innerDiaMm: 17.2, stoneMm: 3.0, gapMm: 0.2,
  bandWidthMm: 3.0, bandWidthBackMm: 3.0, bandThickMm: 1.5, cornerMm: 0.3,
  headHeightMm: 2.0, prongMm: 0.7, prongOverMm: 0.3, railMm: 0.5, prongAtEnds: true,
  taperRad: 1.1, gallery: "plain", shoulder: "plain",
  scrollWireMm: 0.3, scrollRadiusMm: 0.75, scrollTurns: 1.0, scrollInner: 0.3,
  reliefWireMm: 0.2, reliefRadiusMm: 0.4, reliefPitchMm: 1.5, reliefCount: 3,
  support: "none", supportEndDeg: 78, supportOutMm: 1.0, supportBotMm: 0.5,
  panelBotMm: 0.9, panelLenMm: 2.0, panelHMm: 1.45, panelFrameMm: 0.18,
  channelDepthMm: 2.0, channelSinkMm: 0.05, channelEndMm: 0.1, channelInsetMm: 0.04,
  barMm: 0.5, barTopMm: 0.2, beadOutMm: 0.08,
  windowWMm: 1.1, windowTopGapMm: 0.35, windowBotMm: 0.3, topDropMm: 0.05, prongSideFrac: 0.8
};

function mergeParams(params: RowParams): RowResolved {
  const p: Record<string, unknown> = { ...ROW_DEFAULTS };
  const src = params as unknown as Record<string, unknown>;
  for (const k in src) if (src[k] !== undefined) p[k] = src[k];
  return p as unknown as RowResolved;
}

/* eslint-disable */
// ด้านล่าง = ตัว generator ตามต้นฉบับ (สไตล์ var/ฟังก์ชันซ้อน) — ไม่จัดรูปแบบใหม่เพื่อให้เทียบกับต้นฉบับได้

export function buildRowRing(params: RowParams): ViewerRing {
  const p = mergeParams(params);

  /* ---- helper เวกเตอร์ ---- */
  function sub(a,b){return [a[0]-b[0],a[1]-b[1],a[2]-b[2]];}
  function cross(a,b){return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];}
  function dot(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}
  function norm(a){var l=Math.sqrt(dot(a,a))||1;return [a[0]/l,a[1]/l,a[2]/l];}
  function smooth(t){t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);}

  /* ---- ค่าคำนวณพื้นฐาน ---- */
  var n = Math.max(1, Math.min(9, Math.round(p.stoneCount)));
  var d = p.stoneMm, rg = d/2;
  var T = p.bandThickMm, innerR = p.innerDiaMm/2, Rout = innerR + T, Rc = innerR + T/2;
  var hc = 0.16*d, gT = 0.035*d, hp = 0.43*d;       // crown / girdle / pavilion ตามสัดส่วนกลมมาตรฐาน
  var rp = p.prongMm/2;
  var head, chD = 0, chIw = 0, chWall = 0;          // chD/chIw/chWall ใช้เฉพาะ setting "channel"
  if(p.setting === "shared_bead"){
    head = Math.max(0.15, hp + gT - T + 0.45);      // ฝังเสมอ: ยกขึ้นเท่าที่ culet ไม่ทะลุผิวในตัวเรือน
  } else if(p.setting === "channel"){
    /* channel: ผิวหน้าพลอย (table) อยู่ต่ำกว่าขอบบนผนัง channelSinkMm -> ขอบเอวจมใต้ขอบผนัง hc+sink (ผนังบังขอบเอวเมื่อมองข้าง) */
    head = -(hc + p.channelSinkMm);
    chD = Math.min(p.channelDepthMm, T - 0.5);
    chIw = Math.max(0.3, rg - p.channelInsetMm);
    chWall = p.bandWidthMm/2 - chIw;
    var culetBelow = hc + p.channelSinkMm + gT + hp;          // culet ต่ำกว่าขอบบนผนังเท่านี้
  } else {
    var minHead = hp + gT + 0.25;                  // culet ต้องห่างผิวตัวเรือน >= 0.25 mm
    head = Math.max(p.headHeightMm, minHead);
  }
  var Rg = Rout + head;                             // รัศมีจากแกนวงแหวนถึงกลางขอบเอวพลอย
  var pitch = d + p.gapMm;
  var dphi = 2*Math.asin(Math.min(0.99, pitch/(2*Rg)));   // มุมระหว่างเม็ด ให้ระยะ chord ระหว่างเม็ด = pitch
  var spanDeg = n*dphi*180/Math.PI;

  var frames = [], i, j;
  for(i=0;i<n;i++){
    var phi = Math.PI/2 + ((n-1)/2 - i)*dphi;       // i=0 อยู่ซ้ายสุด (x น้อยสุด)
    var u = [Math.cos(phi), Math.sin(phi), 0];      // normal ของเม็ด (ชี้ออกนอกวง)
    var t = [Math.sin(phi), -Math.cos(phi), 0];     // ทิศตามแถว
    frames.push({phi:phi, u:u, t:t, G:[u[0]*Rg, u[1]*Rg, 0]});
  }

  /* ---- mesh builder ---- */
  function tube(path, radii, seg){
    var L = path.length, pos = [], nor = [], idx = [], a, b, Tn, ref, d0, Nn, Bn, an, c, s, nx, ny, nz;
    for(var ii=0; ii<L; ii++){
      a = path[ii>0?ii-1:0]; b = path[ii<L-1?ii+1:L-1];
      Tn = norm(sub(b,a)); ref = [0,0,1];
      if(Math.abs(dot(Tn,ref)) > 0.9) ref = [1,0,0];
      d0 = dot(ref,Tn);
      Nn = norm([ref[0]-Tn[0]*d0, ref[1]-Tn[1]*d0, ref[2]-Tn[2]*d0]);
      Bn = cross(Tn,Nn);
      for(var jj=0; jj<seg; jj++){
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
  function sphere(c, r, lat, lon){
    var pos = [], nor = [], idx = [], ii, jj, th, ph, nx, ny, nz;
    for(ii=0; ii<=lat; ii++){
      th = Math.PI*ii/lat;
      for(jj=0; jj<=lon; jj++){
        ph = 2*Math.PI*jj/lon;
        nx = Math.sin(th)*Math.cos(ph); ny = Math.cos(th); nz = Math.sin(th)*Math.sin(ph);
        pos.push(c[0]+r*nx, c[1]+r*ny, c[2]+r*nz); nor.push(nx,ny,nz);
      }
    }
    for(ii=0; ii<lat; ii++) for(jj=0; jj<lon; jj++){
      var q = ii*(lon+1)+jj;
      idx.push(q, q+1, q+lon+2, q, q+lon+2, q+lon+1);
    }
    return {pos:pos, nor:nor, idx:idx};
  }
  function merge(parts){
    var P = [], N = [], I = [], off = 0, m, x;
    for(var pi=0; pi<parts.length; pi++){
      m = parts[pi];
      for(x=0; x<m.pos.length; x++){P.push(m.pos[x]); N.push(m.nor[x]);}
      for(x=0; x<m.idx.length; x++) I.push(m.idx[x]+off);
      off += m.pos.length/3;
    }
    return {pos:P, nor:N, idx:I};
  }
  function finalize(m){
    return {pos:new Float32Array(m.pos), nor:new Float32Array(m.nor), idx:new Uint16Array(m.idx)};
  }
  function fill(len, v){var o = [], q; for(q=0;q<len;q++) o.push(v); return o;}
  function seg2(a, b, r){return tube([a, [(a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2], b], [r,r,r], 8);}

  /* ---- เส้นก้นหอยต่อเนื่อง (running scroll) ในระนาบ 2 มิติ (x=ตามแถว, y=สูง) ----
     คาบ = px ต่อก้นหอย 1 ตัว: คลื่นไซน์ต่อเนื่อง + ก้นหอยห้อยที่ยอดคลื่น (ม้วนตามเข็ม) สลับกับท้องคลื่น (ทวนเข็ม)
     คืน array ของ polyline [[x,y],...] — ก้นหอยแตะคลื่นที่ยอด/ท้อง (เส้นซ้อนทับกันเป็นลายโปร่งที่เชื่อมกัน) */
  function scrollChain(cnt, px, A, R0, turns, rIn, pad, step){
    var paths = [], x0 = -(cnt-1)/2*px, xa = x0 - pad, xb = x0 + (cnt-1)*px + pad;
    var ns = Math.max(8, Math.ceil((xb-xa)/step)), w = [], q, kk, x, Th = 2*Math.PI*turns;
    for(q=0;q<=ns;q++){x = xa + (xb-xa)*q/ns; w.push([x, A*Math.cos(Math.PI*(x-x0)/px)]);}
    paths.push(w);
    for(kk=0;kk<cnt;kk++){
      var sgn = (kk%2===0) ? 1 : -1, cx = x0 + kk*px, cy = sgn*(A-R0), a0 = sgn > 0 ? Math.PI/2 : -Math.PI/2;
      var cs = Math.max(20, Math.ceil(Th*R0/step*1.4)), sp = [], tt, rr, an;
      for(q=0;q<=cs;q++){
        tt = Th*q/cs; rr = R0*(1-(1-rIn)*tt/Th); an = a0 - sgn*tt;
        sp.push([cx + rr*Math.cos(an), cy + rr*Math.sin(an)]);
      }
      paths.push(sp);
    }
    return paths;
  }

  /* ---- ตัวเรือน: กวาดหน้าตัดสี่เหลี่ยมมุมมนรอบวง กว้าง/หนาเรียวลงหลังแถวพลอย ---- */
  var NA = 6, M = 4*(NA+1), NSEG = 240;
  function profile(hw, ht, r){
    r = Math.min(r, hw*0.9, ht*0.9);
    var cx = hw-r, cy = ht-r, out = [], cs = [[cx,cy,0],[-cx,cy,Math.PI/2],[-cx,-cy,Math.PI],[cx,-cy,1.5*Math.PI]], c, kk, a;
    for(c=0;c<4;c++) for(kk=0;kk<=NA;kk++){
      a = cs[c][2] + (Math.PI/2)*(kk/NA);
      out.push([cs[c][0]+r*Math.cos(a), cs[c][1]+r*Math.sin(a), Math.cos(a), Math.sin(a)]);   // x=แกนนิ้ว y=รัศมี nx ny=normal
    }
    return out;
  }
  var rowHalf = ((n-1)/2)*dphi + dphi/2 + 0.02;
  var TB = (p.bandThickBackMm === undefined) ? T : p.bandThickBackMm;     // หนาด้านหลัง (ไม่ตั้ง = เท่าด้านหน้า)
  function blendAt(thx){                                                    // 0 = หน้า (ใต้แถวพลอย) -> 1 = หลัง
    var dl = Math.abs(Math.atan2(Math.sin(thx-Math.PI/2), Math.cos(thx-Math.PI/2)));
    return smooth((dl-rowHalf)/p.taperRad);
  }
  function widthAt(bl){return p.bandWidthMm + (p.bandWidthBackMm - p.bandWidthMm)*bl;}
  function thickAt(bl){return T + (TB - T)*bl;}
  var bPos = [], bNor = [], bIdx = [];
  var NSEGB = (p.setting === "channel") ? 0 : NSEG;                        // channel สร้างตัวเรือนในบล็อกแยกด้านล่าง
  for(i=0;i<NSEGB;i++){
    var th =2*Math.PI*i/NSEG, co = Math.cos(th), si = Math.sin(th);
    var bl0 = blendAt(th), Tt = thickAt(bl0);
    var pr = profile(widthAt(bl0)/2, Tt/2, p.cornerMm);
    for(j=0;j<M;j++){
      var rr = innerR + Tt/2 + pr[j][1];                                    // ผิวในคงที่ที่ innerR เสมอ (ไซซ์ไม่เพี้ยน)
      bPos.push(rr*co, rr*si, pr[j][0]);
      bNor.push(pr[j][3]*co, pr[j][3]*si, pr[j][2]);
    }
  }
  for(i=0;i<NSEGB;i++) for(j=0;j<M;j++){
    var i2 = (i+1)%NSEG, j2 = (j+1)%M;
    bIdx.push(i*M+j, i2*M+j, i2*M+j2, i*M+j, i2*M+j2, i*M+j2);
  }
  if(p.setting === "channel"){
    /* ตัวเรือนฝังล็อค: หน้าตัดสี่เหลี่ยมมุมมน + ร่องราง (notch) กลางผิวบนเฉพาะช่วงแถวพลอย
       ผนังสองข้างกับหัว/ท้ายแถวทึบเป็นชิ้นเดียวกับตัวเรือน (ไม่มี boolean) · ปลายรางมีแผ่นปิดหัว/ท้ายแยก
       ring ที่ปลายราง 2 ใบซ้อนมุมเดียวกัน (ลึก 0 กับลึกเต็ม) แล้วไม่ต่อหน้ากัน เพื่อให้ผนังปลายรางตั้งฉาก */
    var chHalf = ((n-1)/2)*dphi + (rg + p.channelEndMm)/Rg;                  // ครึ่งความยาวรางเป็นเรเดียน (วัดที่รัศมีเอวพลอย)
    var thR = Math.PI/2 - chHalf, thL = Math.PI/2 + chHalf;
    var chProfile = function(hw, ht, r, iw, D){
      r = Math.min(r, hw*0.9, ht*0.9);
      var cx = hw-r, cy = ht-r, out = [], cs = [[cx,cy,0],[-cx,cy,Math.PI/2],[-cx,-cy,Math.PI],[cx,-cy,1.5*Math.PI]], c, kk, a;
      for(c=0;c<4;c++){
        for(kk=0;kk<=NA;kk++){
          a = cs[c][2] + (Math.PI/2)*(kk/NA);
          out.push([cs[c][0]+r*Math.cos(a), cs[c][1]+r*Math.sin(a), Math.cos(a), Math.sin(a)]);
        }
        if(c===0){      // หลังมุมบนขวา: ขอบบนผนัง -> ผนังใน -> พื้นราง -> ผนังใน -> ขอบบนผนังอีกข้าง (จุดซ้อนตำแหน่งเดียวกันแต่ normal ต่างกัน = ขอบคม)
          out.push([iw,ht,0,1],[iw,ht,-1,0],[iw,ht-D,-1,0],[iw,ht-D,0,1],[-iw,ht-D,0,1],[-iw,ht-D,1,0],[-iw,ht,1,0],[-iw,ht,0,1]);
        }
      }
      return out;
    };
    var MC = 4*(NA+1) + 8, items = [], cri, thU;
    for(cri=0;cri<NSEG;cri++){
      thU = 2*Math.PI*cri/NSEG;
      items.push({th:thU, ord:1, depth:(Math.abs(thU-Math.PI/2) < chHalf ? chD : 0), brk:false});
    }
    items.push({th:thR, ord:0, depth:0, brk:true}, {th:thR, ord:1, depth:chD, brk:false},
               {th:thL, ord:0, depth:chD, brk:true}, {th:thL, ord:1, depth:0, brk:false});
    items.sort(function(x, y){return (x.th - y.th) || (x.ord - y.ord);});
    items.forEach(function(it){
      var co1 = Math.cos(it.th), si1 = Math.sin(it.th), bl1 = blendAt(it.th), Tt1 = thickAt(bl1), jj;
      var pr1 = chProfile(widthAt(bl1)/2, Tt1/2, p.cornerMm, chIw, it.depth);
      for(jj=0;jj<MC;jj++){
        var rr1 = innerR + Tt1/2 + pr1[jj][1];
        bPos.push(rr1*co1, rr1*si1, pr1[jj][0]);
        bNor.push(pr1[jj][3]*co1, pr1[jj][3]*si1, pr1[jj][2]);
      }
    });
    var nIt = items.length, ri, jc, ra, rb2, jn;
    for(ri=0;ri<nIt;ri++){
      if(items[ri].brk) continue;
      ra = ri*MC; rb2 = ((ri+1)%nIt)*MC;
      for(jc=0;jc<MC;jc++){
        jn = (jc+1)%MC;
        bIdx.push(ra+jc, rb2+jc, rb2+jn, ra+jc, rb2+jn, ra+jn);
      }
    }
    /* แผ่นปิดหัว/ท้ายราง (ผนังตั้งฉากกับแนวแถว หันเข้าหาพลอย) */
    [[thR, 1],[thL, -1]].forEach(function(e){
      var thE = e[0], sg = e[1], b0 = bPos.length/3, nx = -Math.sin(thE)*sg, ny = Math.cos(thE)*sg;
      var cc = Math.cos(thE), ss = Math.sin(thE), rb = Rout - chD, rt = Rout;
      bPos.push(rb*cc, rb*ss, -chIw,  rt*cc, rt*ss, -chIw,  rt*cc, rt*ss, chIw,  rb*cc, rb*ss, chIw);
      for(var qv=0;qv<4;qv++) bNor.push(nx, ny, 0);
      bIdx.push(b0, b0+1, b0+2, b0, b0+2, b0+3);
    });
  }
  var parts = [{pos:bPos, nor:bNor, idx:bIdx}];

  /* ---- การฝัง ---- */
  var f, a, blockBuilt = false;
  if(p.setting === "prong4"){
    /* เขี้ยว 4 ต่อเม็ด ที่มุมทแยง (45/135/225/315 องศา) ปลายงอทับขอบเอว */
    var rho = rg + 0.6*rp, over = p.prongOverMm;
    for(i=0;i<n;i++){
      f = frames[i];
      for(a=1;a<8;a+=2){
        var al = a*Math.PI/4, cx = Math.cos(al), sx = Math.sin(al);
        var P = function(rad, h){
          var x = rad*cx, z = rad*sx;
          return [f.G[0]+f.t[0]*x+f.u[0]*h, f.G[1]+f.t[1]*x+f.u[1]*h, f.G[2]+f.t[2]*x+f.u[2]*h+z];
        };
        var path = [P(rho,-head-0.2), P(rho,0), P(rho-0.25*rp,over*0.55), P(rho-0.8*rp,over*0.9), P(rho-1.3*rp,over*0.95)];
        parts.push(tube(path, [1.15*rp, rp, 0.85*rp, 0.65*rp, 0.2*rp], 8));
      }
    }
    /* ราวเชื่อมโคนเขี้ยว ข้างละเส้นตามโค้ง ผ่านศูนย์กลางเขี้ยวทุกต้น (gallery เปิดโล่งอยู่ใต้เม็ด) */
    var off = rho*Math.SQRT1_2, Rrail = Rout + head*0.4;
    var phiA = frames[0].phi + off/Rrail, phiB = frames[n-1].phi - off/Rrail;
    var steps = Math.max(3, Math.ceil((phiA-phiB)/0.06));
    for(var sg=-1; sg<=1; sg+=2){
      var rpath = [], rrad = [];
      for(i=0;i<=steps;i++){
        var ph = phiA + (phiB-phiA)*i/steps;
        rpath.push([Rrail*Math.cos(ph), Rrail*Math.sin(ph), sg*off]);
        rrad.push(p.railMm/2);
      }
      parts.push(tube(rpath, rrad, 8));
    }
  } else if(p.setting === "shared_prong" || p.setting === "bar_prong" || p.setting === "window_head"){
    /* shared_prong: หัวยก = ผนังข้างหัว 2 ข้าง (z=±zw) + ราวบนรองเอวพลอย + เขี้ยวเล็กร่วมระหว่างเม็ด 2 ต้น/ช่อง
       (ช่องระหว่างเม็ด + หัวท้ายแถว) ปลายเขี้ยวเป็นหัวมนทับขอบเอวพลอย — พิกัด (x ตามแถว, y สูง, z ข้าง) แปลงเป็นโค้งวงแหวนด้วย G3 */
    var zw = 0.62*rg, wR = p.scrollWireMm/2, rR = p.railMm/2;
    var Rtop = (p.setting === "bar_prong") ? Rg + p.barTopMm : (p.setting === "window_head" ? Rg - p.topDropMm : Rg - 0.3), Hg = Rtop - Rout, Rmid = Rout + Hg/2, pitchX = Rmid*dphi, Lx = n*pitchX;
    var G3 = function(x, y, z){var ph = Math.PI/2 - x/Rmid, r = Rmid + y; return [r*Math.cos(ph), r*Math.sin(ph), z];};
    var nsx = Math.max(8, Math.ceil(Lx/0.4)), sg2, q2, e2, pts2;
    if(p.setting === "shared_prong"){      // ราว/ผนังข้างหัว/เขี้ยวร่วม เฉพาะหนามเตยร่วม (bar_prong ข้ามไปสร้างบาร์ใน else ด้านล่าง)
    /* ราวบน 2 ข้าง (แท่นรองเอวพลอย) + ปิดหัวท้าย: เสาตั้ง + คานข้าม */
    for(sg2=-1; sg2<=1; sg2+=2){
      pts2 = [];
      for(q2=0;q2<=nsx;q2++) pts2.push(G3(-Lx/2 + Lx*q2/nsx, Hg/2, sg2*zw));
      parts.push(tube(pts2, fill(pts2.length, rR), 8));
    }
    for(e2=-1; e2<=1; e2+=2){
      /* เสาตั้งหัวท้ายใช้เฉพาะเมื่อไม่มีก้านรับข้าง (ถ้ามีก้านทึบ ก้านทำหน้าที่แทน — เลิกใช้เสาบางทแยงเดิม) */
      if(p.support !== "block") for(sg2=-1; sg2<=1; sg2+=2) parts.push(seg2(G3(e2*Lx/2, -Hg/2+0.05, sg2*zw), G3(e2*Lx/2, Hg/2, sg2*zw), rR));
      parts.push(seg2(G3(e2*Lx/2, Hg/2, -zw), G3(e2*Lx/2, Hg/2, zw), rR));
    }
    /* ผนังข้างหัว */
    if(p.gallery === "scroll"){
      var gA = Hg/2 - wR, gR0 = Math.min(p.scrollRadiusMm, gA*0.98);
      var chain = scrollChain(n, pitchX, gA, gR0, p.scrollTurns, p.scrollInner, pitchX/2, 0.25);
      for(sg2=-1; sg2<=1; sg2+=2) chain.forEach(function(path){
        var gp = path.map(function(q){return G3(q[0], q[1], sg2*zw);});
        parts.push(tube(gp, fill(gp.length, wR), 6));
      });
    } else {
      /* plain: แผ่นผนังบางเรียบ 2 ผิวต่อข้าง (ความหนา = scrollWireMm) */
      var sp = [], sn = [], si2 = [], ss2, zz, vi, ph2;
      for(sg2=-1; sg2<=1; sg2+=2) for(ss2=-1; ss2<=1; ss2+=2){
        zz = sg2*zw + ss2*wR; vi = sp.length/3;
        for(q2=0;q2<=nsx;q2++){
          ph2 = Math.PI/2 - (-Lx/2 + Lx*q2/nsx)/Rmid;
          sp.push(Rout*Math.cos(ph2), Rout*Math.sin(ph2), zz, Rtop*Math.cos(ph2), Rtop*Math.sin(ph2), zz);
          sn.push(0,0,ss2, 0,0,ss2);
        }
        for(q2=0;q2<nsx;q2++){var ia = vi + q2*2; si2.push(ia,ia+1,ia+3, ia,ia+3,ia+2);}
      }
      parts.push({pos:sp, nor:sn, idx:si2});
    }
    /* เขี้ยวร่วม: ช่อง i = 0..n (หัวท้ายเปิดตาม prongAtEnds) */
    for(i=0;i<=n;i++){
      if(!p.prongAtEnds && (i===0 || i===n)) continue;
      var pg = Math.PI/2 + ((n-1)/2 - (i-0.5))*dphi, cg = Math.cos(pg), sg = Math.sin(pg);
      for(sg2=-1; sg2<=1; sg2+=2){
        var PP = function(r, z){return [r*cg, r*sg, z];};
        var tipC = PP(Rg + p.prongOverMm, sg2*zw*0.86);
        parts.push(tube([PP(Rtop-0.05, sg2*zw), PP(Rg-0.1, sg2*zw*0.98), PP(Rg+0.05, sg2*zw*0.92), tipC], [1.1*rp, rp, 0.95*rp, 0.8*rp], 8));
        parts.push(sphere(tipC, 1.15*rp, 5, 8));
      }
    }
    } else {
      if(p.setting === "bar_prong"){
      /* bar_prong: บาร์สี่เหลี่ยมขวางแถว n+1 ซี่ (คั่นระหว่างเม็ด + หัวท้าย) กว้างเท่าตัวเรือน ตั้งจากผิวตัวเรือน
         ยอดสูงเหนือขอบเอวพลอย barTopMm · ช่องระหว่างบาร์เปิดโล่ง (ขอบบนเป็นซี่หวี) · เตยเล็กกลม 1 เม็ด/ด้านข้าง/พลอย (รวม 2/เม็ด)
         ใช้ก้านรับข้าง (support = "block") ร่วมกับ shared_prong ด้านล่าง */
      var bxT = p.barMm/2, bxZ = widthAt(0)/2, bxR0 = Rout - 0.1, bxR1 = Rg + p.barTopMm;
      var bxBox = function(ph0){
        var cs0 = Math.cos(ph0), sn0 = Math.sin(ph0), er = [cs0, sn0, 0], et = [-sn0, cs0, 0], bp = [], bn = [], bi = [];
        var cn = function(a, r, c){return [er[0]*r + et[0]*a*bxT, er[1]*r + et[1]*a*bxT, c*bxZ];};
        var quad = function(A, B, C, D, nv){
          var b0 = bp.length/3;
          [A, B, C, D].forEach(function(q){bp.push(q[0], q[1], q[2]); bn.push(nv[0], nv[1], nv[2]);});
          bi.push(b0, b0+1, b0+2, b0, b0+2, b0+3);
        };
        quad(cn(-1,bxR1,-1), cn(1,bxR1,-1), cn(1,bxR1,1), cn(-1,bxR1,1), er);                               // ยอดบาร์
        quad(cn(-1,bxR0,-1), cn(1,bxR0,-1), cn(1,bxR0,1), cn(-1,bxR0,1), [-er[0], -er[1], 0]);              // ฐาน (ฝังใต้ผิวตัวเรือน)
        quad(cn(1,bxR0,-1), cn(1,bxR1,-1), cn(1,bxR1,1), cn(1,bxR0,1), et);                                  // ด้านหนึ่งหันเข้าเม็ด
        quad(cn(-1,bxR0,-1), cn(-1,bxR1,-1), cn(-1,bxR1,1), cn(-1,bxR0,1), [-et[0], -et[1], 0]);             // อีกด้านหันเข้าเม็ด
        quad(cn(-1,bxR0,1), cn(1,bxR0,1), cn(1,bxR1,1), cn(-1,bxR1,1), [0, 0, 1]);                          // ข้างตัวเรือน +z
        quad(cn(-1,bxR0,-1), cn(1,bxR0,-1), cn(1,bxR1,-1), cn(-1,bxR1,-1), [0, 0, -1]);                     // ข้างตัวเรือน -z
        return {pos:bp, nor:bn, idx:bi};
      };
      for(i=0;i<=n;i++) parts.push(bxBox(Math.PI/2 + ((n-1)/2 - (i-0.5))*dphi));
      /* เตยเล็ก: เม็ดกลมที่ขอบเอวพลอยด้านข้างตัวเรือน (z = ±(รัศมีพลอย + beadOutMm)) + ก้านสั้นลงฝังตัวเรือน */
      var bdR = 1.15*rp, bdZ = rg + p.beadOutMm;
      for(i=0;i<n;i++){
        f = frames[i];
        for(sg2=-1; sg2<=1; sg2+=2){
          var BP = function(r){return [r*Math.cos(f.phi), r*Math.sin(f.phi), sg2*bdZ];};
          var bdTop = Rg + 0.03;
          parts.push(tube([BP(Rout-0.1), BP((Rout-0.1+bdTop)/2), BP(bdTop)], [1.1*rp, rp, 0.95*rp], 8));
          parts.push(sphere(BP(bdTop), bdR, 5, 8));
        }
      }
      } else {
      /* window_head: หัวบล็อกกว้างเท่าตัวเรือน สร้างเป็นเปลือก (ไม่มี boolean):
         ผนังข้าง 2 ด้าน = แผ่นที่เจาะช่อง D (ปลายบนโค้ง ล่างตรง) ใต้พลอยทุกเม็ด + ผนังอุโมงค์ช่อง (เห็นก้นพลอยทะลุช่อง) + ผิวบนโค้งตามวง
         + เตยเล็กร่วม 2 ข้างต่อช่องระหว่างเม็ด · ปลายหัวใช้ก้านรับข้างแบบ wedge ร่วมด้านล่าง
         ช่องเป็นพิกัด (s ตามแถว, y รัศมี) ต่อเซลล์ 1 เม็ด · ใช้ "รังสี" จากกลางช่อง จับคู่จุดขอบเซลล์กับขอบช่องเพื่อเรียงสามเหลี่ยมวงแหวน */
        var whHW = widthAt(0)/2, whRm = (Rout + Rtop)/2, whSh = whRm*dphi/2;
        var whWw = p.windowWMm, whYc = Rtop - p.windowTopGapMm - whWw/2, whYb = Rout + p.windowBotMm, whRb = Rout - 0.2;
        var whH1 = Rtop - whYc, whH2 = whYc - whRb, whHd = whYc - whYb, whT = [], whK, whE, whZ;
        for(whK=0; whK<24; whK++) whT.push(2*Math.PI*whK/24);
        [[whSh, whH1], [-whSh, whH1], [-whSh, -whH2], [whSh, -whH2], [whWw/2, -whHd], [-whWw/2, -whHd]].forEach(function(cr){
          var tc = Math.atan2(cr[1], cr[0]); whT.push(tc < 0 ? tc + 2*Math.PI : tc);       // มุมของมุมเซลล์/มุมช่อง ให้จุดตกตรงมุมพอดี
        });
        whT.sort(function(x, y){return x - y;});
        var whM = whT.length;
        var whRay = function(t){
          var c = Math.cos(t), s = Math.sin(t), ac = Math.max(Math.abs(c), 1e-6), as = Math.max(Math.abs(s), 1e-6);
          var to = Math.min(whSh/ac, s > 0 ? whH1/as : whH2/as);                          // ขอบเซลล์สี่เหลี่ยม
          var th = s > 0 ? whWw/2 : Math.min((whWw/2)/ac, whHd/as);                       // ขอบช่อง D: ครึ่งวงกลมบน + ข้างตรง + ก้นตรง
          return [to*c, to*s, th*c, th*s];
        };
        for(i=0;i<n;i++){
          f = frames[i];
          var whPos = function(s, y, z){var an = f.phi - s/whRm, r = whYc + y; return [r*Math.cos(an), r*Math.sin(an), z];};
          var tnP = [], tnN = [], tnI = [], wk, wr, q0, wk2;
          for(var sgw=-1; sgw<=1; sgw+=2){
            var wP = [], wN = [], wI = [];
            for(wk=0; wk<whM; wk++){
              wr = whRay(whT[wk]); wk2 = (wk+1)%whM;
              q0 = whPos(wr[0], wr[1], sgw*whHW); wP.push(q0[0], q0[1], q0[2]); wN.push(0, 0, sgw);
              q0 = whPos(wr[2], wr[3], sgw*whHW); wP.push(q0[0], q0[1], q0[2]); wN.push(0, 0, sgw);
              wI.push(2*wk, 2*wk2, 2*wk2+1, 2*wk, 2*wk2+1, 2*wk+1);
            }
            parts.push({pos:wP, nor:wN, idx:wI});
          }
          for(wk=0; wk<whM; wk++){                                                         // ผนังอุโมงค์ช่อง (normal ชี้เข้าช่อง)
            wr = whRay(whT[wk]); wk2 = (wk+1)%whM;
            var hl = Math.sqrt(wr[2]*wr[2] + wr[3]*wr[3]) || 1, hs = wr[2]/hl, hy = wr[3]/hl;
            var an2 = f.phi - wr[2]/whRm, ex = Math.cos(an2), ey = Math.sin(an2);
            for(whE=-1; whE<=1; whE+=2){
              q0 = whPos(wr[2], wr[3], whE*whHW); tnP.push(q0[0], q0[1], q0[2]);
              tnN.push(-(hs*ey + hy*ex), -(-hs*ex + hy*ey), 0);
            }
            tnI.push(2*wk, 2*wk2, 2*wk2+1, 2*wk, 2*wk2+1, 2*wk+1);
          }
          parts.push({pos:tnP, nor:tnN, idx:tnI});
        }
        /* ผิวบนหัว: แถบโค้งที่รัศมี Rtop ตลอดแถวพลอย กว้างเท่าตัวเรือน */
        var whNa = n*6, wtP = [], wtN = [], wtI = [], whA, whPh, whQ;
        for(whA=0; whA<=whNa; whA++){
          whPh = Math.PI/2 + n*dphi/2 - n*dphi*whA/whNa;
          for(whZ=-1; whZ<=1; whZ+=2){wtP.push(Rtop*Math.cos(whPh), Rtop*Math.sin(whPh), whZ*whHW); wtN.push(Math.cos(whPh), Math.sin(whPh), 0);}
          if(whA < whNa){whQ = 2*whA; wtI.push(whQ, whQ+1, whQ+3, whQ, whQ+3, whQ+2);}
        }
        parts.push({pos:wtP, nor:wtN, idx:wtI});
        /* เตยเล็กร่วม: ช่องระหว่างเม็ด + หัวท้ายแถว ด้านละ 1 ต้น ที่ขอบข้างพลอย (z = ±zp) ปลายเป็นหัวกลมเล็กยื่นเหนือขอบเอวนิดเดียว */
        var whZp = rg*p.prongSideFrac;
        for(i=0;i<=n;i++){
          var whPg = Math.PI/2 + ((n-1)/2 - (i-0.5))*dphi, whCg = Math.cos(whPg), whSg = Math.sin(whPg);
          for(sg2=-1; sg2<=1; sg2+=2){
            var WPp = function(r){return [r*whCg, r*whSg, sg2*whZp];};
            var whTip = Rg + p.prongOverMm;
            parts.push(tube([WPp(Rtop-0.1), WPp(Rg-0.05), WPp(whTip)], [1.1*rp, rp, 0.9*rp], 8));
            parts.push(sphere(WPp(whTip), 1.1*rp, 5, 8));
          }
        }
      }
    }
    /* ---- ก้านรับข้าง (side support): ก้านทึบหัวท้ายแถว ยกจากตัวเรือนขึ้นไปถึงปลายแกลเลอรี ----
       หน้าตัดในระนาบแหวน (α = มุมจากยอดแหวน, r = รัศมี):
         ขอบใน = เส้นรัศมีที่ α0 (ปลายแถวพลอย) · ขอบบน = โค้ง Rtop แล้วตกเป็นเส้นตั้งตรง x = xOut ตามเส้นขาวของเจ้าของ
         ขอบล่าง = rBot (ฝังในตัวเรือน) · สิ้นสุดที่ α1 · ฉีดตามความกว้าง z = ±(กว้างตัวเรือนที่มุมนั้น/2 + 0.02-0.05 mm) */
    if(p.support === "block"){
      blockBuilt = true;
      var a0 = n*dphi/2, a1 = Math.max(a0+0.2, p.supportEndDeg*Math.PI/180);
      var xOut = Rtop*Math.sin(a0) + p.supportOutMm;                         // ประมาณจากรูป
      var rBot = innerR + p.supportBotMm;                                    // ประมาณจากรูป
      /* supportShape "wedge" (ใช้กับ bar_prong): ไม่มีหน้าตั้ง — ผิวนอกเป็นโค้ง Rtop จนถึงปลายแถว แล้วเป็นเส้นเฉียงตรงลงไปบรรจบผิวนอกตัวเรือนที่ α1
         เก็บเส้นเป็นพิกัด (u = r·sinα, v = r·cosα) · แบบเดิม (ไม่ตั้ง supportShape) ใช้เส้นตั้งตามเส้นเจ้าของเหมือนเดิมทุกประการ */
      /* supportShape "taper" (opt-in · ใช้กับ window_head): ความหนาหัวลดลงตามโค้งวงแบบนุ่ม r(α) = rผิวนอกตัวเรือน + (Rtop − r)·(1−u)^k
         u = (α−α0)/(α1−α0) · k = supportTaperPow (ค่าเริ่ม 1.7) — มุมบนที่ปลายแถวคมเล็กน้อย ปลายล่างสัมผัสผิวก้านแบบนุ่ม ไม่มีหน้าตั้ง */
      var taper = (p.supportShape === "taper"), tPow = (p.supportTaperPow === undefined) ? 1.7 : p.supportTaperPow;
      var wedge = (p.supportShape === "wedge"), wN = null, wU0 = 0, wV0 = 0;
      if(wedge){
        var wr1 = innerR + thickAt(blendAt(Math.PI/2 + a1));                 // ผิวนอกตัวเรือนที่ปลายลิ่ม
        wU0 = Rtop*Math.sin(a0); wV0 = Rtop*Math.cos(a0);
        var wdu = wr1*Math.sin(a1) - wU0, wdv = wr1*Math.cos(a1) - wV0, wl = Math.sqrt(wdu*wdu + wdv*wdv);
        wN = [-wdv/wl, wdu/wl];                                              // normal ของเส้นเฉียงในพิกัด (u,v)
        if(wN[0]*wU0 + wN[1]*wV0 < 0) wN = [-wN[0], -wN[1]];                 // ให้ชี้ออกนอกวง
      }
      var rTopA = function(al){
        if(taper){
          var tu = Math.max(0, Math.min(1, (al - a0)/(a1 - a0))), trb = innerR + thickAt(blendAt(Math.PI/2 + al));
          return Math.max(trb + (Rtop - trb)*Math.pow(1 - tu, tPow), rBot + 0.3);
        }
        if(wedge){
          if(al <= a0) return Rtop;
          var dn = wN[0]*Math.sin(al) + wN[1]*Math.cos(al);
          if(dn < 1e-4) return rBot + 0.3;
          return Math.max(Math.min((wN[0]*wU0 + wN[1]*wV0)/dn, Rtop), rBot + 0.3);
        }
        var sn = Math.sin(al), rv = Rtop;
        if(sn > 1e-4) rv = Math.min(Rtop, xOut/sn);
        return Math.max(rv, rBot + 0.3);
      };
      var lipA = (wedge || taper) ? 0.01 : 0.02, lipB = (wedge || taper) ? 0 : 0.03;              // ขอบแผ่นกว้างกว่าตัวเรือนเล็กน้อย (ลิ่มเกือบเสมอข้าง)
      var hwA = function(al){return widthAt(blendAt(Math.PI/2+al))/2 + lipA + lipB*(1-smooth((al-a0)/(a1-a0)));};
      var posAt = function(sdv, al, rv, zv){var th3 = Math.PI/2 + sdv*al; return [rv*Math.cos(th3), rv*Math.sin(th3), zv];};
      var gridM = function(na, nb, Pf, Nf){
        var gp = [], gn = [], gi = [], ia, jb, pt, nv, qq;
        for(ia=0; ia<=na; ia++) for(jb=0; jb<=nb; jb++){
          pt = Pf(ia/na, jb/nb); nv = Nf(ia/na, jb/nb);
          gp.push(pt[0],pt[1],pt[2]); gn.push(nv[0],nv[1],nv[2]);
        }
        for(ia=0; ia<na; ia++) for(jb=0; jb<nb; jb++){
          qq = ia*(nb+1)+jb;
          gi.push(qq, qq+nb+1, qq+nb+2, qq, qq+nb+2, qq+1);
        }
        return {pos:gp, nor:gn, idx:gi};
      };
      var sdb, zb, eb;
      for(sdb=-1; sdb<=1; sdb+=2){
        /* ผิวข้าง 2 ด้าน (z = ±) */
        for(zb=-1; zb<=1; zb+=2) parts.push(gridM(18, 4, function(uu, vv){
          var al = a0 + (a1-a0)*uu;
          return posAt(sdb, al, rBot + (rTopA(al)-rBot)*vv, zb*hwA(al));
        }, function(){return [0, 0, zb];}));
        /* ผิวบน/ขอบนอก (ช่วงโค้ง Rtop = ผิวรองหัว · ช่วงตั้ง = ขอบนอกตามเส้นเจ้าของ) */
        parts.push(gridM(18, 1, function(uu, vv){
          var al = a0 + (a1-a0)*uu;
          return posAt(sdb, al, rTopA(al), (2*vv-1)*hwA(al));
        }, function(uu){
          var al = a0 + (a1-a0)*uu, th4 = Math.PI/2 + sdb*al;
          if(wedge && al > a0) return [-sdb*wN[0], wN[1], 0];
          if(taper && al > a0){                                               // normal ของโค้ง: ต่างค่าเชิงตัวเลขของ r(α) ในพิกัด (u,v)
            var tr = rTopA(al), tdr = (rTopA(Math.min(al + 0.01, a1)) - rTopA(Math.max(al - 0.01, a0)))/(Math.min(al + 0.01, a1) - Math.max(al - 0.01, a0));
            var tTu = tdr*Math.sin(al) + tr*Math.cos(al), tTv = tdr*Math.cos(al) - tr*Math.sin(al), tL = Math.sqrt(tTu*tTu + tTv*tTv) || 1;
            return [-sdb*(-tTv/tL), tTu/tL, 0];
          }
          return rTopA(al) < Rtop - 1e-6 ? [-sdb, 0, 0] : [Math.cos(th4), Math.sin(th4), 0];
        }));
        /* หน้าตัดปลาย 2 ด้าน (eb=0 ด้านหันเข้าแกลเลอรี · eb=1 ด้านลาดจม) */
        for(eb=0; eb<=1; eb++) parts.push(gridM(1, 1, function(uu, vv){
          var al = eb ? a1 : a0;
          return posAt(sdb, al, rBot + (rTopA(al)-rBot)*uu, (2*vv-1)*hwA(al));
        }, function(){
          var al = eb ? a1 : a0, th5 = Math.PI/2 + sdb*al, sgE = eb ? -1 : 1;
          return [sgE*sdb*Math.sin(th5), -sgE*sdb*Math.cos(th5), 0];
        }));
      }
      /* กรอบสันนูน + ลาย S นูน ในกรอบ บนผิวข้างก้านรับข้างทั้ง 4 ผิว (2 ปลาย x 2 ด้าน) */
      if(p.shoulder === "scroll_relief"){
        var rp0 = innerR + p.panelBotMm, rp1 = rp0 + p.panelHMm, ap0 = a0 + 0.08;
        var ap1 = ap0 + p.panelLenMm/((rp0+rp1)/2);
        rp1 = Math.min(rp1, rTopA(ap1) - 0.25);                                // ไม่ให้กรอบชนเพดานก้าน
        if(ap1 > a1 - 0.05 || rp1 - rp0 < 0.8){
        } else {
          var rf = p.panelFrameMm/2, rws = p.reliefWireMm/2, rcen = (rp0+rp1)/2, acen = (ap0+ap1)/2;
          var As2 = (rp1-rp0)/2 - p.panelFrameMm - 0.08 - rws;                 // ครึ่งสูงที่ใช้ได้ของลาย S
          var pxs = (p.panelLenMm - 2*p.panelFrameMm - 0.24)/2;                // ระยะห่างม้วน S 2 ม้วน
          var mapP = function(sdv, al, rv, zsv, lift){return posAt(sdv, al, rv, zsv*(hwA(al)+lift));};
          var egs = [[ap0,rp0,ap1,rp0],[ap0,rp1,ap1,rp1],[ap0,rp0,ap0,rp1],[ap1,rp0,ap1,rp1]];
          var chs2 = As2 > 0.15 ? scrollChain(2, pxs, As2, Math.min(p.reliefRadiusMm, As2*0.95), 0.9, 0.3, pxs/2, 0.2) : [];
          var sdp, zsp;
          for(sdp=-1; sdp<=1; sdp+=2) for(zsp=-1; zsp<=1; zsp+=2){
            egs.forEach(function(eg){
              var nst = (eg[1] === eg[3]) ? 8 : 4, ep = [], es;
              for(es=0; es<=nst; es++) ep.push(mapP(sdp, eg[0]+(eg[2]-eg[0])*es/nst, eg[1]+(eg[3]-eg[1])*es/nst, zsp, 0));
              parts.push(tube(ep, fill(ep.length, rf), 6));
            });
            chs2.forEach(function(path){
              var sp3 = path.map(function(q3){return mapP(sdp, acen + q3[0]/rcen, rcen + q3[1], zsp, 0.02);});
              parts.push(tube(sp3, fill(sp3.length, rws), 6));
            });
          }
        }
      }
    }
  } else if(p.setting === "channel"){
    /* channel: ไม่มีเขี้ยว/เม็ดเสริม — ผนังรางเป็นส่วนของตัวเรือน (สร้างในขั้นตัวเรือนด้านบน) */
  } else {
    /* shared_bead: เม็ดกลมเล็ก 2 เม็ดต่อช่องระหว่างพลอย (ซ้ายขวาของแหวน) + ที่หัวท้ายถ้าเปิด */
    var rb = Math.max(rp, 0.32), zb = rg*0.74, Rb = Rout + Math.max(0.12, head-0.05);
    for(i=0;i<=n;i++){
      if(!p.prongAtEnds && (i===0 || i===n)) continue;
      var pm = Math.PI/2 + ((n-1)/2 - (i-0.5))*dphi;
      for(var s2=-1; s2<=1; s2+=2) parts.push(sphere([Rb*Math.cos(pm), Rb*Math.sin(pm), s2*zb], rb, 6, 10));
    }
  }
  /* ---- ลายก้นหอยนูนบนไหล่: เส้นก้นหอยต่อเนื่องแปะบนด้านข้างตัวเรือนทั้ง 2 ด้านของแต่ละไหล่ ยกจากผิว ~ reliefWireMm/2 ----
     (เป็นเส้นหลอดกลมวางบนผิว ไม่ใช่การแกะลึก — พอให้เห็นลายและไม่หนักเครื่อง) */
  if(p.shoulder === "scroll_relief" && !blockBuilt){
    var rw =p.reliefWireMm/2, pS = p.reliefPitchMm, cS = Math.max(2, Math.round(p.reliefCount));
    var halfL = (cS-1)/2*pS + pS/2, Rs = innerR + T/2, sd, zs;
    for(sd=-1; sd<=1; sd+=2){
      var thC = Math.PI/2 + sd*(rowHalf + 0.10 + halfL/Rs);               // กึ่งกลางลาย เริ่มพ้นปลายแถวพลอยเล็กน้อย
      var As = thickAt(blendAt(thC))/2 - p.cornerMm - rw;                 // สูงที่ใช้ได้บนผิวข้างเรียบ
      if(As < 0.12){break;}
      var chs = scrollChain(cS, pS, As, Math.min(p.reliefRadiusMm, As*0.95), 0.9, 0.3, pS/2, 0.2);
      for(zs=-1; zs<=1; zs+=2) chs.forEach(function(path){
        var rp2 = path.map(function(q){
          var th2 = thC + sd*q[0]/Rs, bl2 = blendAt(th2), r2 = innerR + thickAt(bl2)/2 + q[1];
          return [r2*Math.cos(th2), r2*Math.sin(th2), zs*widthAt(bl2)/2];
        });
        parts.push(tube(rp2, fill(rp2.length, rw), 6));
      });
    }
  }
  var metal = finalize(merge(parts));

  /* ---- พลอยกลม: flat facet 8 ส่วนมงกุฎ (table + star + kite + upper girdle) + pavilion 16 ส่วน ---- */
  function buildGem(fr){
    var rt = 0.57*rg, rs = 0.80*rg;
    var ys = hc*(1 - (rs*Math.cos(Math.PI/8) - rt)/(rg - rt));      // ความสูง star ให้ kite เป็นระนาบ
    var G = fr.G, uu = fr.u, tt = fr.t;
    function W(r, ang, y){
      var x = r*Math.cos(ang), z = r*Math.sin(ang);
      return [G[0]+tt[0]*x+uu[0]*y, G[1]+tt[1]*x+uu[1]*y, G[2]+tt[2]*x+uu[2]*y+z];
    }
    var C0 = W(0,0,-gT-hp*0.35), pos = [], nor = [], idx = [];
    function tri(A,B,C){
      var nn = norm(cross(sub(B,A), sub(C,A)));
      var mm = [(A[0]+B[0]+C[0])/3-C0[0], (A[1]+B[1]+C[1])/3-C0[1], (A[2]+B[2]+C[2])/3-C0[2]];
      if(dot(nn,mm) < 0) nn = [-nn[0],-nn[1],-nn[2]];
      var b0 = pos.length/3;
      pos.push(A[0],A[1],A[2], B[0],B[1],B[2], C[0],C[1],C[2]);
      nor.push(nn[0],nn[1],nn[2], nn[0],nn[1],nn[2], nn[0],nn[1],nn[2]);
      idx.push(b0,b0+1,b0+2);
    }
    var Tp = [], Sp = [], Gt = [], Gb = [], kk;
    for(kk=0;kk<8;kk++){Tp.push(W(rt, kk*Math.PI/4, hc)); Sp.push(W(rs, (kk+0.5)*Math.PI/4, ys));}
    for(kk=0;kk<16;kk++){Gt.push(W(rg, kk*Math.PI/8, 0)); Gb.push(W(rg, kk*Math.PI/8, -gT));}
    var top = W(0,0,hc), culet = W(0,0,-gT-hp);
    for(kk=0;kk<8;kk++){
      var k1 = (kk+1)%8, km = (kk+7)%8;
      tri(top, Tp[kk], Tp[k1]);                                   // table
      tri(Tp[kk], Tp[k1], Sp[kk]);                                // star
      tri(Tp[kk], Sp[km], Gt[2*kk]); tri(Tp[kk], Gt[2*kk], Sp[kk]);   // kite (2 สามเหลี่ยมระนาบเดียวกัน)
      tri(Sp[kk], Gt[2*kk], Gt[2*kk+1]);                          // upper girdle
      tri(Sp[kk], Gt[2*kk+1], Gt[(2*kk+2)%16]);
    }
    for(kk=0;kk<16;kk++){
      var g1 = (kk+1)%16;
      tri(Gt[kk], Gt[g1], Gb[g1]); tri(Gt[kk], Gb[g1], Gb[kk]);   // girdle
      tri(culet, Gb[kk], Gb[g1]);                                 // pavilion
    }
    return {pos:new Float32Array(pos), nor:new Float32Array(nor), idx:new Uint16Array(idx)};
  }
  var gems = [];
  for(i=0;i<n;i++) gems.push({center:frames[i].G.slice(), normal:frames[i].u.slice(), radiusMm:rg, mesh:buildGem(frames[i])});

  var vtx = metal.pos.length/3;
  gems.forEach(function(g){vtx += g.mesh.pos.length/3;});

  return { metal: metal, gems: gems, frame: computeCameraFrame(gems, { innerDiaMm: p.innerDiaMm, stoneMm: p.stoneMm, girdleRadiusMm: Rg }), vertexCount: vtx };
}
